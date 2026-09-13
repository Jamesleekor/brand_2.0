import {
  TIKATUKA_ROW_IDS,
  calculateBoardScores,
  getLegalPlacements,
  isRowFull,
  resolvePlacementOutcome,
} from '../engine';
import type { DieValue, GameAction, GameState } from '../engine';
import { createHypotheticalTazzaState } from './evaluateTazza';
import { createHypotheticalHoldState } from './turnSimulation';
import type { AIAdvancedActionCandidate, AIProfile } from './types';

const DIE_VALUES: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
const STRATEGIC_RERANK_WEIGHT = 2.25;
const MAX_STRATEGIC_DELTA = 7;

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
    if (aiScore > playerScore) return 2.5;
    if (playerScore > aiScore) return -2.5;
    return 0;
  }

  const aiOpen = 3 - aiBoard.rows[row].dice.length;
  const playerOpen = 3 - playerBoard.rows[row].dice.length;
  const uncertaintyScale = 6 + (aiOpen + playerOpen) * 1.5;
  return Math.tanh((aiScore - playerScore) / uncertaintyScale);
}

/**
 * Strategic, win-condition-aware state value from the AI perspective.
 * The second-best row carries the most weight because two row wins decide the match.
 */
export function evaluateStrategicWinPlan(state: GameState): number {
  if (state.phase === 'game_over' && state.winner !== null) {
    if (state.winner === 'ai') return 1_000;
    if (state.winner === 'player') return -1_000;
    return 0;
  }

  const values = TIKATUKA_ROW_IDS.map((row) => rowStrategicValue(state, row)).sort((a, b) => b - a);
  const securedWins = TIKATUKA_ROW_IDS.filter((row) => {
    const aiBoard = state.sides.ai.board;
    const playerBoard = state.sides.player.board;
    if (!isRowFull(aiBoard, row) || !isRowFull(playerBoard, row)) return false;
    const scores = {
      ai: calculateBoardScores(aiBoard)[row],
      player: calculateBoardScores(playerBoard)[row],
    };
    return scores.ai > scores.player;
  }).length;
  const securedLosses = TIKATUKA_ROW_IDS.filter((row) => {
    const aiBoard = state.sides.ai.board;
    const playerBoard = state.sides.player.board;
    if (!isRowFull(aiBoard, row) || !isRowFull(playerBoard, row)) return false;
    const scores = {
      ai: calculateBoardScores(aiBoard)[row],
      player: calculateBoardScores(playerBoard)[row],
    };
    return scores.player > scores.ai;
  }).length;

  let score = values[0] * 7 + values[1] * 24 + values[2] * 2;
  score += securedWins * 12;
  score -= securedLosses * 12;
  if (securedWins >= 2) score += 80;
  if (securedLosses >= 2) score -= 80;
  return score;
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

function strategicActionValue(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }>,
): number {
  if (action.type === 'PLACE_DIE') {
    return evaluateStrategicWinPlan(resolvePlacementOutcome(state, action, 'ai').nextState);
  }

  if (action.type === 'HOLD') {
    return evaluateStrategicWinPlan(createHypotheticalHoldState(state, 'ai'));
  }

  let expected = 0;
  for (const value of DIE_VALUES) {
    const rerolled = createHypotheticalTazzaState(state, 'ai', value);
    expected += bestImmediateStrategicPlacementValue(rerolled) / DIE_VALUES.length;
  }
  return expected;
}

function clampStrategicDelta(delta: number): number {
  return Math.max(-MAX_STRATEGIC_DELTA, Math.min(MAX_STRATEGIC_DELTA, delta));
}

/**
 * Strategic rerank is deliberately bounded. The depth-2 search now already knows
 * about the second-row objective at Lv.9+, so this layer only breaks tactically
 * plausible choices toward the cleaner win plan. It cannot rescue a candidate
 * that the tactical search considers far worse.
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
  const tacticalGapLimit = profile.difficulty >= 10 ? 24 : 14;
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

  // Keep tactically implausible options visible for diagnostics, but never let the
  // strategic overlay promote them into the shortlist.
  const demoted = ineligible.map((candidate) => ({
    action: candidate.action,
    score: candidate.score - 1_000_000,
  } satisfies AIAdvancedActionCandidate));

  return { rankedCandidates: [...strategic, ...demoted], baseOrder: baseCandidates };
}
