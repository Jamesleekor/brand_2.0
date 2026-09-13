import {
  SeededRandomSource,
  canHold,
  canUseTazza,
  countBoardDice,
  dispatchTikatukaAction,
  getLegalPlacements,
  resolvePlacementOutcome,
} from '../engine';
import type {
  DieValue,
  EngineDependencies,
  GameAction,
  GameState,
  RandomSource,
  Side,
} from '../engine';
import { evaluateStateForAI } from './evaluateState';
import { createHypotheticalTazzaState } from './evaluateTazza';
import { evaluateStrategicWinPlan } from './strategic';
import { createHypotheticalHoldState } from './turnSimulation';
import type { AIAdvancedActionCandidate, AIProfile } from './types';

const DIE_VALUES: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
const MAX_ROLLOUT_ACTIONS = 180;
const MAX_SEED = 0x7fff_ffff;
const STRATEGIC_ROLLOUT_WEIGHT = 3.75;

export interface WinProbabilityCandidate {
  action: AIAdvancedActionCandidate['action'];
  baseScore: number;
  estimatedWinProbability: number;
  rawWins: number;
  rawDraws: number;
  rawLosses: number;
  unresolved: number;
  samples: number;
}

export interface WinProbabilityRanking {
  rankedCandidates: readonly WinProbabilityCandidate[];
  shortlistSize: number;
  samplesPerCandidate: number;
}

interface RolloutPlan {
  shortlistSize: 2 | 3;
  initialSamplesPerCandidate: number;
  maxSamplesPerCandidate: number;
  extensionGap: number;
}

interface RolloutOutcome {
  probabilityScore: number;
  result: 'ai' | 'player' | 'draw' | 'unresolved';
}

interface ScoredRolloutAction {
  action: Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }>;
  utility: number;
}

function rolloutPlanForState(state: GameState): RolloutPlan {
  const occupied = countBoardDice(state.sides.ai.board) + countBoardDice(state.sides.player.board);

  // Early-game futures are highly noisy, so keep them cheap. As the board matures,
  // root decisions become much more decisive and extra samples are worth the cost.
  if (occupied >= 14) {
    return { shortlistSize: 3, initialSamplesPerCandidate: 48, maxSamplesPerCandidate: 96, extensionGap: 0.06 };
  }
  if (occupied >= 8) {
    return { shortlistSize: 3, initialSamplesPerCandidate: 28, maxSamplesPerCandidate: 56, extensionGap: 0.07 };
  }
  return { shortlistSize: 2, initialSamplesPerCandidate: 16, maxSamplesPerCandidate: 32, extensionGap: 0.08 };
}

function stateUtility(state: GameState, profile: AIProfile): number {
  return evaluateStateForAI(state, profile) + evaluateStrategicWinPlan(state) * STRATEGIC_ROLLOUT_WEIGHT;
}

function bestImmediatePlacementUtility(state: GameState, profile: AIProfile): number {
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null) return stateUtility(state, profile);

  const placements = getLegalPlacements(state, state.currentSide, die);
  if (placements.length === 0) return stateUtility(state, profile);

  const utilities = placements.map((placement) => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    const outcome = resolvePlacementOutcome(state, action, state.currentSide);
    return stateUtility(outcome.nextState, profile);
  });
  return state.currentSide === 'ai' ? Math.max(...utilities) : Math.min(...utilities);
}

function expectedTazzaUtility(state: GameState, side: Side, profile: AIProfile): number {
  let expected = 0;
  for (const value of DIE_VALUES) {
    const rerolled = createHypotheticalTazzaState(state, side, value);
    expected += bestImmediatePlacementUtility(rerolled, profile) / DIE_VALUES.length;
  }
  return expected;
}

function holdUtility(state: GameState, side: Side, profile: AIProfile): number {
  const die = state.turn.currentDie;
  if (die === null) return stateUtility(state, profile);

  const held = createHypotheticalHoldState(state, side);
  const retainedValue = die.value + (die.kind === 'shield' ? 2 : 0);
  const tempoCost = 2.5;
  const sideAdjustment = retainedValue * 0.45;
  return side === 'ai'
    ? stateUtility(held, profile) - tempoCost + sideAdjustment
    : stateUtility(held, profile) + tempoCost - sideAdjustment;
}

/**
 * Fast deterministic rollout policy for both sides. It is deliberately much
 * cheaper than depth-2 search: one-ply placement value plus Tazza expectation
 * and a small HOLD option value. The same policy is used for every candidate so
 * the root comparison stays fair.
 */
export function chooseFastRolloutAction(state: GameState, profile: AIProfile): ScoredRolloutAction {
  const side = state.currentSide;
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null) {
    throw new Error('라카루카 rollout 정책은 awaiting_action 상태에서만 행동할 수 있습니다.');
  }

  const scored: ScoredRolloutAction[] = getLegalPlacements(state, side, die).map((placement) => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    const outcome = resolvePlacementOutcome(state, action, side);
    return { action, utility: stateUtility(outcome.nextState, profile) };
  });

  if (canUseTazza(state, side)) {
    scored.push({ action: { type: 'USE_TAZZA' }, utility: expectedTazzaUtility(state, side, profile) });
  }
  if (canHold(state, side)) {
    scored.push({ action: { type: 'HOLD' }, utility: holdUtility(state, side, profile) });
  }
  if (scored.length === 0) {
    throw new Error('라카루카 rollout 정책에 합법적인 행동이 없습니다.');
  }

  let best = scored[0];
  for (let index = 1; index < scored.length; index += 1) {
    const candidate = scored[index];
    const isBetter = side === 'ai' ? candidate.utility > best.utility : candidate.utility < best.utility;
    if (isBetter) best = candidate;
  }
  return best;
}

function createRolloutDependencies(seed: number, label: string): EngineDependencies {
  const aiSeed = ((seed ^ 0x5bd1e995) >>> 0) || 1;
  let counter = 0;
  return {
    gameRng: new SeededRandomSource(seed),
    aiRng: new SeededRandomSource(aiSeed),
    createId: () => `rollout-${label}-${++counter}`,
  };
}

function unresolvedProbabilityScore(state: GameState): number {
  const strategic = evaluateStrategicWinPlan(state);
  return 0.5 + Math.tanh(strategic / 50) * 0.46;
}

function runRollout(
  state: GameState,
  rootAction: AIAdvancedActionCandidate['action'],
  seed: number,
  profile: AIProfile,
  label: string,
): RolloutOutcome {
  const deps = createRolloutDependencies(seed, label);
  let working = dispatchTikatukaAction(state, rootAction, deps, 'ai').nextState;

  for (let actionCount = 0; actionCount < MAX_ROLLOUT_ACTIONS; actionCount += 1) {
    if (working.phase === 'game_over') {
      if (working.winner === 'ai') return { probabilityScore: 1, result: 'ai' };
      if (working.winner === 'player') return { probabilityScore: 0, result: 'player' };
      return { probabilityScore: 0.35, result: 'draw' };
    }

    if (working.phase !== 'awaiting_action' || working.turn.currentDie === null) {
      throw new Error('라카루카 rollout이 행동 가능한 턴 상태를 벗어났습니다.');
    }

    const choice = chooseFastRolloutAction(working, profile);
    working = dispatchTikatukaAction(working, choice.action, deps, working.currentSide).nextState;
  }

  return { probabilityScore: unresolvedProbabilityScore(working), result: 'unresolved' };
}

function collectSeeds(aiRng: RandomSource, count: number): number[] {
  return Array.from({ length: count }, () => aiRng.nextInt(1, MAX_SEED));
}

function emptyResult(candidate: AIAdvancedActionCandidate): WinProbabilityCandidate {
  return {
    action: candidate.action,
    baseScore: candidate.score,
    estimatedWinProbability: 0,
    rawWins: 0,
    rawDraws: 0,
    rawLosses: 0,
    unresolved: 0,
    samples: 0,
  };
}

function addSamples(
  state: GameState,
  shortlist: readonly AIAdvancedActionCandidate[],
  results: WinProbabilityCandidate[],
  seeds: readonly number[],
  profile: AIProfile,
  sampleOffset: number,
): void {
  shortlist.forEach((candidate, candidateIndex) => {
    let probabilityTotal = results[candidateIndex].estimatedWinProbability * results[candidateIndex].samples;

    seeds.forEach((seed, seedIndex) => {
      const outcome = runRollout(
        state,
        candidate.action,
        seed,
        profile,
        `${candidateIndex}-${sampleOffset + seedIndex}`,
      );
      probabilityTotal += outcome.probabilityScore;
      if (outcome.result === 'ai') results[candidateIndex].rawWins += 1;
      else if (outcome.result === 'player') results[candidateIndex].rawLosses += 1;
      else if (outcome.result === 'draw') results[candidateIndex].rawDraws += 1;
      else results[candidateIndex].unresolved += 1;
    });

    results[candidateIndex].samples += seeds.length;
    results[candidateIndex].estimatedWinProbability = probabilityTotal / results[candidateIndex].samples;
  });
}

function sortProbabilityResults(results: WinProbabilityCandidate[]): void {
  const originalIndex = new Map(results.map((candidate, index) => [candidate, index]));
  results.sort((a, b) => {
    if (b.estimatedWinProbability !== a.estimatedWinProbability) {
      return b.estimatedWinProbability - a.estimatedWinProbability;
    }
    if (b.rawWins !== a.rawWins) return b.rawWins - a.rawWins;
    if (b.rawDraws !== a.rawDraws) return b.rawDraws - a.rawDraws;
    if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
  });
}

/**
 * Lv.10 root selector. It never reads or consumes the live gameRng. The caller's
 * aiRng is used only to create independent Monte Carlo futures, and the same seed
 * set is replayed for every shortlisted action (common-random-number comparison).
 *
 * Sampling is adaptive: clear decisions stop after the first batch; close calls
 * receive a second common seed batch, up to 96 samples per candidate in the late
 * game. This spends computation where one move is most likely to decide the match.
 */
export function rankWinProbabilityAIActions(
  state: GameState,
  aiRng: RandomSource,
  strategicCandidates: readonly AIAdvancedActionCandidate[],
  profile: AIProfile,
): WinProbabilityRanking {
  if (state.currentSide !== 'ai' || state.phase !== 'awaiting_action' || state.turn.currentDie === null) {
    throw new Error('라카루카 승리확률 AI는 AI awaiting_action 상태에서만 사용할 수 있습니다.');
  }
  if (strategicCandidates.length === 0) {
    throw new Error('라카루카 승리확률 AI에 전략 후보가 없습니다.');
  }

  const plan = rolloutPlanForState(state);
  const shortlist = strategicCandidates.slice(0, Math.min(plan.shortlistSize, strategicCandidates.length));
  const results = shortlist.map(emptyResult);

  const initialSeeds = collectSeeds(aiRng, plan.initialSamplesPerCandidate);
  addSamples(state, shortlist, results, initialSeeds, profile, 0);
  sortProbabilityResults(results);

  if (results.length >= 2) {
    const gap = results[0].estimatedWinProbability - results[1].estimatedWinProbability;
    if (gap <= plan.extensionGap && plan.maxSamplesPerCandidate > plan.initialSamplesPerCandidate) {
      const additionalCount = plan.maxSamplesPerCandidate - plan.initialSamplesPerCandidate;
      const extraSeeds = collectSeeds(aiRng, additionalCount);

      // Results were sorted after the first batch, so rebuild the candidate order
      // from those same result objects before accumulating the common extra seeds.
      const adaptiveShortlist = results.map((result) => ({
        action: result.action,
        score: result.baseScore,
      } satisfies AIAdvancedActionCandidate));
      addSamples(
        state,
        adaptiveShortlist,
        results,
        extraSeeds,
        profile,
        plan.initialSamplesPerCandidate,
      );
      sortProbabilityResults(results);
    }
  }

  return {
    rankedCandidates: results,
    shortlistSize: shortlist.length,
    samplesPerCandidate: results[0]?.samples ?? plan.initialSamplesPerCandidate,
  };
}
