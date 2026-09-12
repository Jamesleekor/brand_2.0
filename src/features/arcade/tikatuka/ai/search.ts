import { getLegalPlacements, resolvePlacementOutcome } from '../engine';
import { canHold } from '../engine/rules/hold';
import { canUseTazza } from '../engine/rules/tazza';
import type { DieValue, GameAction, GameState } from '../engine/types';
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

export interface AdvancedSearchOptions {
  limits?: Partial<AISearchLimits>;
  now?: () => number;
}

export interface AdvancedAIRanking {
  rankedCandidates: readonly AIAdvancedActionCandidate[];
  nodesVisited: number;
  searchAbortReason: ReturnType<typeof createAISearchContext>['abortedBy'];
}

function compareAdvancedCandidates(a: AIAdvancedActionCandidate, b: AIAdvancedActionCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  const actionOrder = ACTION_ORDER[a.action.type] - ACTION_ORDER[b.action.type];
  if (actionOrder !== 0) return actionOrder;
  if (a.action.type === 'PLACE_DIE' && b.action.type === 'PLACE_DIE') {
    const targetOrder = TARGET_ORDER[a.action.targetSide] - TARGET_ORDER[b.action.targetSide];
    if (targetOrder !== 0) return targetOrder;
    return ROW_ORDER[a.action.row] - ROW_ORDER[b.action.row];
  }
  return 0;
}

function afterCompletedTurnValue(
  turnEndState: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
): number {
  if (turnEndState.phase === 'game_over' || futureDepth <= 0) {
    return evaluateStateForAI(turnEndState, profile);
  }

  let expected = 0;
  for (const branch of enumerateNextTurnStates(turnEndState)) {
    expected += branch.probability * bestTurnValue(branch.state, futureDepth - 1, profile, context);
  }
  return expected;
}

function placementActionValue(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' }>,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
): number {
  const outcome = resolvePlacementOutcome(state, action, state.currentSide);
  return afterCompletedTurnValue(outcome.nextState, futureDepth, profile, context);
}

function tazzaActionValue(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
): number {
  let total = 0;
  for (const value of DIE_VALUES) {
    const hypothetical = createHypotheticalTazzaState(state, state.currentSide, value);
    total += bestTurnValue(hypothetical, futureDepth, profile, context) / DIE_VALUES.length;
  }
  return total;
}

function holdActionValue(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
): number {
  const held = createHypotheticalHoldState(state, state.currentSide);
  return afterCompletedTurnValue(held, futureDepth, profile, context);
}

function collectTurnActionValues(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
): AIAdvancedActionCandidate[] {
  const side = state.currentSide;
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null) return [];

  const placements = getLegalPlacements(state, side, die);
  const candidates: AIAdvancedActionCandidate[] = placements.map((placement) => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    return { action, score: placementActionValue(state, action, futureDepth, profile, context) };
  });

  if (canUseTazza(state, side)) {
    candidates.push({ action: { type: 'USE_TAZZA' }, score: tazzaActionValue(state, futureDepth, profile, context) });
  }
  if (canHold(state, side)) {
    candidates.push({ action: { type: 'HOLD' }, score: holdActionValue(state, futureDepth, profile, context) });
  }
  return candidates;
}

function bestTurnValue(
  state: GameState,
  futureDepth: number,
  profile: AIProfile,
  context: ReturnType<typeof createAISearchContext>,
): number {
  if (state.phase === 'game_over') return evaluateStateForAI(state, profile);

  const memoKey = `${createAIStateHash(state)}|future:${futureDepth}`;
  const memo = context.memo.get(memoKey);
  if (memo !== undefined) return memo;

  const visit = enterAISearchState(context, state);
  if (!visit.ok) return evaluateStateForAI(state, profile);

  try {
    const die = state.turn.currentDie;
    if (state.phase !== 'awaiting_action' || die === null) return evaluateStateForAI(state, profile);

    // Live engine performs Forced Pass automatically before exposing an actionable turn.
    // Search mirrors that rule before considering optional Tazza/HOLD.
    if (getLegalPlacements(state, state.currentSide, die).length === 0) {
      const passed = createHypotheticalForcedPassState(state);
      const value = afterCompletedTurnValue(passed, futureDepth, profile, context);
      context.memo.set(memoKey, value);
      return value;
    }

    const candidates = collectTurnActionValues(state, futureDepth, profile, context);
    if (candidates.length === 0) return evaluateStateForAI(state, profile);

    const value = state.currentSide === 'ai'
      ? Math.max(...candidates.map((candidate) => candidate.score))
      : Math.min(...candidates.map((candidate) => candidate.score));
    context.memo.set(memoKey, value);
    return value;
  } finally {
    leaveAISearchState(context, visit.hash);
  }
}

export function rankAdvancedAIActions(
  state: GameState,
  profile: AIProfile,
  options?: AdvancedSearchOptions,
): AdvancedAIRanking {
  if (state.currentSide !== 'ai' || state.phase !== 'awaiting_action' || state.turn.currentDie === null) {
    throw new Error('타카투카 고급 AI는 AI awaiting_action 상태에서만 행동을 평가할 수 있습니다.');
  }
  if (getLegalPlacements(state, 'ai', state.turn.currentDie).length === 0) {
    throw new Error('타카투카 고급 AI root에는 자동 Forced Pass 이전의 상태를 전달할 수 없습니다.');
  }

  const context = createAISearchContext(options);
  const candidates = collectTurnActionValues(state, profile.searchDepth, profile, context).sort(compareAdvancedCandidates);
  if (candidates.length === 0) throw new Error('타카투카 고급 AI에 합법적인 행동 후보가 없습니다.');

  return {
    rankedCandidates: candidates,
    nodesVisited: context.nodesVisited,
    searchAbortReason: context.abortedBy,
  };
}
