import { getLegalPlacements, resolvePlacementOutcome } from '../engine';
import { canHold } from '../engine/rules/hold';
import { canUseTazza } from '../engine/rules/tazza';
import type { DieValue, GameAction, GameState, Side } from '../engine/types';
import { evaluateStateForAI } from './evaluateState';
import { createHypotheticalTazzaState } from './evaluateTazza';
import {
  createAISearchContext,
  enterAISearchState,
  leaveAISearchState,
  type AISearchLimits,
} from './searchContext';
import { createAIStateHash } from './stateHash';
import {
  createHypotheticalForcedPassState,
  createHypotheticalHoldState,
  enumerateNextTurnStates,
} from './turnSimulation';
import type { AIAdvancedActionCandidate, AIProfile } from './types';

const DIE_VALUES: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
const ROW_ORDER = { top: 0, middle: 1, bottom: 2 } as const;
const TARGET_ORDER = { ai: 0, player: 1 } as const;
const ACTION_ORDER = { PLACE_DIE: 0, USE_TAZZA: 1, HOLD: 2 } as const;

export type AdvancedStateEvaluator = (state: GameState, profile: AIProfile) => number;

export interface AdvancedSearchOptions {
  limits?: Partial<AISearchLimits>;
  now?: () => number;
  /** Optional AI-only leaf evaluator. Generic/player balance search keeps the default evaluator. */
  evaluateState?: AdvancedStateEvaluator;
}

export interface AdvancedAIRanking {
  rankedCandidates: readonly AIAdvancedActionCandidate[];
  nodesVisited: number;
  searchAbortReason: ReturnType<typeof createAISearchContext>['abortedBy'];
}

function compareActionTieBreak(a: AIAdvancedActionCandidate, b: AIAdvancedActionCandidate): number {
  const actionOrder = ACTION_ORDER[a.action.type] - ACTION_ORDER[b.action.type];
  if (actionOrder !== 0) return actionOrder;
  if (a.action.type === 'PLACE_DIE' && b.action.type === 'PLACE_DIE') {
    const targetOrder = TARGET_ORDER[a.action.targetSide] - TARGET_ORDER[b.action.targetSide];
    if (targetOrder !== 0) return targetOrder;
    return ROW_ORDER[a.action.row] - ROW_ORDER[b.action.row];
  }
  return 0;
}

function compareAdvancedCandidatesForSide(
  side: Side,
  a: AIAdvancedActionCandidate,
  b: AIAdvancedActionCandidate,
): number {
  if (b.score !== a.score) return side === 'ai' ? b.score - a.score : a.score - b.score;
  return compareActionTieBreak(a, b);
}

function afterCompletedTurnValue(
  turnEndState: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
  evaluator: AdvancedStateEvaluator,
): number {
  if (turnEndState.phase === 'game_over' || futureDepth <= 0) {
    return evaluator(turnEndState, profile);
  }

  let expected = 0;
  for (const branch of enumerateNextTurnStates(turnEndState)) {
    expected += branch.probability * bestTurnValue(branch.state, futureDepth - 1, profile, context, evaluator);
  }
  return expected;
}

function placementActionValue(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' }>,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
  evaluator: AdvancedStateEvaluator,
): number {
  const outcome = resolvePlacementOutcome(state, action, state.currentSide);
  return afterCompletedTurnValue(outcome.nextState, futureDepth, profile, context, evaluator);
}

function tazzaActionValue(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
  evaluator: AdvancedStateEvaluator,
): number {
  let total = 0;
  for (const value of DIE_VALUES) {
    const hypothetical = createHypotheticalTazzaState(state, state.currentSide, value);
    total += bestTurnValue(hypothetical, futureDepth, profile, context, evaluator) / DIE_VALUES.length;
  }
  return total;
}

function holdActionValue(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
  evaluator: AdvancedStateEvaluator,
): number {
  const held = createHypotheticalHoldState(state, state.currentSide);
  return afterCompletedTurnValue(held, futureDepth, profile, context, evaluator);
}

function collectTurnActionValues(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
  evaluator: AdvancedStateEvaluator,
): AIAdvancedActionCandidate[] {
  const side = state.currentSide;
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null) return [];

  const placements = getLegalPlacements(state, side, die);
  const candidates: AIAdvancedActionCandidate[] = placements.map((placement) => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    return { action, score: placementActionValue(state, action, futureDepth, profile, context, evaluator) };
  });

  if (canUseTazza(state, side)) {
    candidates.push({ action: { type: 'USE_TAZZA' }, score: tazzaActionValue(state, futureDepth, profile, context, evaluator) });
  }
  if (canHold(state, side)) {
    candidates.push({ action: { type: 'HOLD' }, score: holdActionValue(state, futureDepth, profile, context, evaluator) });
  }
  return candidates;
}

function bestTurnValue(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
  evaluator: AdvancedStateEvaluator,
): number {
  if (state.phase === 'game_over') return evaluator(state, profile);

  const memoKey = `${createAIStateHash(state)}|future:${futureDepth}`;
  const memo = context.memo.get(memoKey);
  if (memo !== undefined) return memo;

  const visit = enterAISearchState(context, state);
  if (!visit.ok) return evaluator(state, profile);

  try {
    const die = state.turn.currentDie;
    if (state.phase !== 'awaiting_action' || die === null) return evaluator(state, profile);

    if (getLegalPlacements(state, state.currentSide, die).length === 0) {
      const passed = createHypotheticalForcedPassState(state);
      const value = afterCompletedTurnValue(passed, futureDepth, profile, context, evaluator);
      context.memo.set(memoKey, value);
      return value;
    }

    const candidates = collectTurnActionValues(state, futureDepth, profile, context, evaluator);
    if (candidates.length === 0) return evaluator(state, profile);

    const value = state.currentSide === 'ai'
      ? Math.max(...candidates.map((candidate) => candidate.score))
      : Math.min(...candidates.map((candidate) => candidate.score));
    context.memo.set(memoKey, value);
    return value;
  } finally {
    leaveAISearchState(context, visit.hash);
  }
}

/**
 * Symmetric root ranking used by balance simulations. The heuristic remains AI-centric,
 * so AI sorts high-to-low while Player sorts low-to-high. Production AI may optionally
 * inject a stronger leaf evaluator; the generic player proxy deliberately does not.
 */
export function rankAdvancedTurnActions(
  state: GameState,
  profile: AIProfile,
  options?: AdvancedSearchOptions,
): AdvancedAIRanking {
  if (state.phase !== 'awaiting_action' || state.turn.currentDie === null) {
    throw new Error('라카루카 고급 탐색은 awaiting_action 상태에서만 행동을 평가할 수 있습니다.');
  }
  if (getLegalPlacements(state, state.currentSide, state.turn.currentDie).length === 0) {
    throw new Error('라카루카 고급 탐색 root에는 자동 Forced Pass 이전의 상태를 전달할 수 없습니다.');
  }

  const context = createAISearchContext({ limits: options?.limits, now: options?.now });
  const evaluator = options?.evaluateState ?? evaluateStateForAI;
  const side = state.currentSide;
  const candidates = collectTurnActionValues(state, profile.searchDepth, profile, context, evaluator)
    .sort((a, b) => compareAdvancedCandidatesForSide(side, a, b));
  if (candidates.length === 0) throw new Error('라카루카 고급 탐색에 합법적인 행동 후보가 없습니다.');

  return {
    rankedCandidates: candidates,
    nodesVisited: context.nodesVisited,
    searchAbortReason: context.abortedBy,
  };
}

export function rankAdvancedAIActions(
  state: GameState,
  profile: AIProfile,
  options?: AdvancedSearchOptions,
): AdvancedAIRanking {
  if (state.currentSide !== 'ai') {
    throw new Error('라카루카 고급 AI는 AI 턴에서만 행동을 평가할 수 있습니다.');
  }
  return rankAdvancedTurnActions(state, profile, options);
}
