import {
  TIKATUKA_ROW_IDS,
  calculateBoardScores,
  countBoardDice,
  getLegalPlacements,
  isRowFull,
  resolvePlacementOutcome,
} from '../engine';
import type { DieValue, GameAction, GameState } from '../engine';
import { evaluateStateForAI } from './evaluateState';
import { createHypotheticalTazzaState } from './evaluateTazza';
import {
  createHypotheticalHoldState,
  enumerateNextTurnStates,
} from './turnSimulation';
import type { AIAdvancedActionCandidate, AIProfile } from './types';

const DIE_VALUES: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
const STRATEGIC_RERANK_WEIGHT = 3.0;
const MAX_STRATEGIC_DELTA = 10;
const IMMEDIATE_PLAN_WEIGHT = 0.3;
const NEXT_REPLY_WEIGHT = 0.7;

export interface StrategicAIRanking {
  rankedCandidates: readonly AIAdvancedActionCandidate[];
  baseOrder: readonly AIAdvancedActionCandidate[];
}

function rowStrategicValue(state: GameState, row: (typeof TIKATUKA_ROW_IDS)[number]): number {
  const aiBoard = state.sides.ai.board;
  const playerBoard = state.sides.player.board;
  const aiScore = calculateBoardScores(aiBoard)[row];
  const playerScore = calculateBoardScores(playerBoard)[row];

  if (isRowFull(aiBoard, row) && isRowFull(playerBoard, row)) {
    if (aiScore > playerScore) return 2.75;
    if (playerScore > aiScore) return -2.75;
    return 0;
  }

  const aiOpen = 3 - aiBoard.rows[row].dice.length;
  const playerOpen = 3 - playerBoard.rows[row].dice.length;
  const uncertaintyScale = 5.5 + (aiOpen + playerOpen) * 1.35;
  return Math.tanh((aiScore - playerScore) / uncertaintyScale);
}

/**
 * Strategic, win-condition-aware state value from the AI perspective.
 * The second-best row is deliberately dominant: two row wins decide the match,
 * while inflating an already-safe first row is mostly wasted value.
 */
export function evaluateStrategicWinPlan(state: GameState): number {
  if (state.phase === 'game_over' && state.winner !== null) {
    if (state.winner === 'ai') return 1_000;
    if (state.winner === 'player') return -1_000;
    return 0;
  }

  const aiBoard = state.sides.ai.board;
  const playerBoard = state.sides.player.board;
  const aiScores = calculateBoardScores(aiBoard);
  const playerScores = calculateBoardScores(playerBoard);
  const values = TIKATUKA_ROW_IDS.map((row) => rowStrategicValue(state, row)).sort((a, b) => b - a);

  let securedWins = 0;
  let securedLosses = 0;
  for (const row of TIKATUKA_ROW_IDS) {
    if (!isRowFull(aiBoard, row) || !isRowFull(playerBoard, row)) continue;
    if (aiScores[row] > playerScores[row]) securedWins += 1;
    else if (playerScores[row] > aiScores[row]) securedLosses += 1;
  }

  let score = values[0] * 8 + values[1] * 30 + values[2] * 2;
  score += securedWins * 18;
  score -= securedLosses * 18;
  if (securedWins >= 2) score += 140;
  if (securedLosses >= 2) score -= 140;
  return score;
}

/**
 * Production-only high-level leaf evaluator for Lv9/Lv10. The benchmark's strong
 * player keeps the generic evaluator, while the late-game opponents carry their
 * two-row plan through every leaf of the depth-2 tree instead of only reranking
 * the root after search has finished.
 */
export function evaluateHighLevelSearchState(state: GameState, profile: AIProfile): number {
  const base = evaluateStateForAI(state, profile);
  if (state.phase === 'game_over') return base;

  const occupied = countBoardDice(state.sides.ai.board) + countBoardDice(state.sides.player.board);
  const maturity = occupied >= 14 ? 1 : occupied >= 10 ? 0.82 : occupied >= 6 ? 0.58 : 0.35;
  const strategicWeight = profile.difficulty >= 10 ? 1.15 : 0.9;
  return base + evaluateStrategicWinPlan(state) * maturity * strategicWeight;
}

function bestImmediateStrategicPlacementValue(state: GameState): number {
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null) return evaluateStrategicWinPlan(state);

  const placements = getLegalPlacements(state, state.currentSide, die);
  if (placements.length === 0) return evaluateStrategicWinPlan(state);

  const values = placements.map((placement) => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    return evaluateStrategicWinPlan(resolvePlacementOutcome(state, action, state.currentSide).nextState);
  });
  return state.currentSide === 'ai' ? Math.max(...values) : Math.min(...values);
}

/**
 * Cheap opponent-threat pass used only by Lv9/Lv10 root strategy.
 * It asks: after this turn ends, across every possible next die, how well can the
 * opponent immediately answer? This is intentionally separate from the generic
 * depth-2 evaluator so Lv8 remains frozen and the high-level opponents gain a
 * recognisable "protect the second row" identity.
 */
function expectedNextReplyStrategicValue(turnEndState: GameState): number {
  if (turnEndState.phase === 'game_over') return evaluateStrategicWinPlan(turnEndState);

  const branches = enumerateNextTurnStates(turnEndState);
  if (branches.length === 0) return evaluateStrategicWinPlan(turnEndState);

  let expected = 0;
  for (const branch of branches) {
    expected += branch.probability * bestImmediateStrategicPlacementValue(branch.state);
  }
  return expected;
}

function threatAwareTurnEndValue(turnEndState: GameState): number {
  const immediate = evaluateStrategicWinPlan(turnEndState);
  if (turnEndState.phase === 'game_over') return immediate;
  const reply = expectedNextReplyStrategicValue(turnEndState);
  return immediate * IMMEDIATE_PLAN_WEIGHT + reply * NEXT_REPLY_WEIGHT;
}

function bestAITurnCompletionValue(state: GameState): number {
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null) return evaluateStrategicWinPlan(state);
  const placements = getLegalPlacements(state, 'ai', die);
  if (placements.length === 0) return evaluateStrategicWinPlan(state);

  return Math.max(...placements.map((placement) => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    const outcome = resolvePlacementOutcome(state, action, 'ai');
    return threatAwareTurnEndValue(outcome.nextState);
  }));
}

function strategicActionValue(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }>,
): number {
  if (action.type === 'PLACE_DIE') {
    return threatAwareTurnEndValue(resolvePlacementOutcome(state, action, 'ai').nextState);
  }

  if (action.type === 'HOLD') {
    return threatAwareTurnEndValue(createHypotheticalHoldState(state, 'ai'));
  }

  let expected = 0;
  for (const value of DIE_VALUES) {
    const rerolled = createHypotheticalTazzaState(state, 'ai', value);
    expected += bestAITurnCompletionValue(rerolled) / DIE_VALUES.length;
  }
  return expected;
}

function clampStrategicDelta(delta: number): number {
  return Math.max(-MAX_STRATEGIC_DELTA, Math.min(MAX_STRATEGIC_DELTA, delta));
}

/**
 * Strategic rerank remains bounded by the depth-2 tactical score. The strategic
 * layer can choose among credible tactical actions, but it cannot promote a move
 * that the base search considers clearly unsound.
 */
export function rerankStrategicAIActions(
  state: GameState,
  baseCandidates: readonly AIAdvancedActionCandidate[],
  profile: AIProfile,
): StrategicAIRanking {
  if (state.currentSide !== 'ai' || state.phase !== 'awaiting_action' || state.turn.currentDie === null) {
    throw new Error('라카루카 전략 재평가는 AI awaiting_action 상태에서만 사용할 수 있습니다.');
  }
  if (baseCandidates.length === 0) {
    throw new Error('라카루카 전략 재평가에 기본 행동 후보가 없습니다.');
  }

  const baseline = evaluateStrategicWinPlan(state);
  const bestBaseScore = baseCandidates[0].score;
  const tacticalGapLimit = profile.difficulty >= 10 ? 20 : 12;
  const eligible = baseCandidates.filter((candidate) => bestBaseScore - candidate.score <= tacticalGapLimit);
  const ineligible = baseCandidates.filter((candidate) => bestBaseScore - candidate.score > tacticalGapLimit);
  const originalIndex = new Map(baseCandidates.map((candidate, index) => [candidate.action, index]));

  const strategic = eligible.map((candidate) => {
    const strategicDelta = clampStrategicDelta(strategicActionValue(state, candidate.action) - baseline);
    return {
      action: candidate.action,
      score: candidate.score + strategicDelta * STRATEGIC_RERANK_WEIGHT,
    } satisfies AIAdvancedActionCandidate;
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (originalIndex.get(a.action) ?? 0) - (originalIndex.get(b.action) ?? 0);
  });

  const demoted = ineligible.map((candidate) => ({
    action: candidate.action,
    score: candidate.score - 1_000_000,
  } satisfies AIAdvancedActionCandidate));

  return { rankedCandidates: [...strategic, ...demoted], baseOrder: baseCandidates };
}
