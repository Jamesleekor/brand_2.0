import { getLegalPlacements, resolvePlacementOutcome } from '../engine';
import type { GameState } from '../engine';
import { evaluateStateForAI } from './evaluateState';
import { getAIProfile } from './profiles';
import type { AIPlacementCandidate, AIProfile } from './types';

const ROW_ORDER = { top: 0, middle: 1, bottom: 2 } as const;
const TARGET_ORDER = { ai: 0, player: 1 } as const;

function compareCandidateOrder(a: AIPlacementCandidate, b: AIPlacementCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (TARGET_ORDER[a.placement.targetSide] !== TARGET_ORDER[b.placement.targetSide]) {
    return TARGET_ORDER[a.placement.targetSide] - TARGET_ORDER[b.placement.targetSide];
  }
  return ROW_ORDER[a.placement.row] - ROW_ORDER[b.placement.row];
}

export function rankAIPlacementCandidates(
  state: GameState,
  profile: AIProfile = getAIProfile(state.difficulty),
): AIPlacementCandidate[] {
  if (state.currentSide !== 'ai') {
    throw new Error('타카투카 기본 AI는 AI 차례에서만 Placement를 평가할 수 있습니다.');
  }
  if (state.phase !== 'awaiting_action' || state.turn.currentDie === null) {
    throw new Error('타카투카 기본 AI는 awaiting_action 상태와 currentDie가 필요합니다.');
  }

  const placements = getLegalPlacements(state, 'ai', state.turn.currentDie);
  const candidates = placements.map((placement): AIPlacementCandidate => {
    const action = { type: 'PLACE_DIE', targetSide: placement.targetSide, row: placement.row } as const;
    const outcome = resolvePlacementOutcome(state, action, 'ai');
    return {
      action,
      placement,
      score: evaluateStateForAI(outcome.nextState, profile),
      resultingState: outcome.nextState,
    };
  });

  return candidates.sort(compareCandidateOrder);
}
