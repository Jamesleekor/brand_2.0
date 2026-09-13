import { canUseTazza } from '../engine/rules/tazza';
import type { DieValue, GameState, Side } from '../engine/types';
import { rankAIPlacementCandidates } from './evaluatePlacement';
import { getAIProfile } from './profiles';
import type { AIProfile } from './types';

export interface AITazzaOutcomeValue {
  value: DieValue;
  bestPlacementScore: number;
}

export interface AITazzaEvaluation {
  currentBestScore: number;
  rerollExpectedScore: number;
  expectedGain: number;
  shouldUseTazza: boolean;
  outcomes: readonly AITazzaOutcomeValue[];
}

export function createHypotheticalTazzaState(
  state: GameState,
  side: Side,
  value: DieValue,
): GameState {
  const currentDie = state.turn.currentDie;
  if (!canUseTazza(state, side) || currentDie === null || currentDie.kind !== 'normal') {
    throw new Error('라카루카 search에서 Tazza 가상 상태를 만들 수 없는 상태입니다.');
  }

  return {
    ...state,
    sides: {
      ...state.sides,
      [side]: {
        ...state.sides[side],
        skills: {
          ...state.sides[side].skills,
          tazzaRemaining: state.sides[side].skills.tazzaRemaining - 1,
        },
      },
    },
    stats: {
      ...state.stats,
      [side]: {
        ...state.stats[side],
        tazzaUsed: state.stats[side].tazzaUsed + 1,
      },
    },
    turn: {
      ...state.turn,
      currentDie: {
        ...currentDie,
        value,
      },
      source: 'rolled',
      tazzaUsedThisTurn: true,
    },
  };
}

/** Enumerates 1..6 at uniform probability; never touches gameRng. */
export function evaluateAITazza(
  state: GameState,
  profile: AIProfile = getAIProfile(state.difficulty),
): AITazzaEvaluation {
  if (!canUseTazza(state, 'ai')) {
    throw new Error('라카루카 AI는 현재 상태에서 Tazza를 사용할 수 없습니다.');
  }

  const currentRanked = rankAIPlacementCandidates(state, profile);
  if (currentRanked.length === 0) throw new Error('Tazza 평가 전에 현재 주사위의 합법 Placement가 필요합니다.');
  const currentBestScore = currentRanked[0].score;

  const values: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
  const outcomes = values.map((value): AITazzaOutcomeValue => {
    const hypothetical = createHypotheticalTazzaState(state, 'ai', value);
    const ranked = rankAIPlacementCandidates(hypothetical, profile);
    if (ranked.length === 0) throw new Error(`Tazza 가상 눈 ${value}에서 합법 Placement가 없습니다.`);
    return { value, bestPlacementScore: ranked[0].score };
  });

  const rerollExpectedScore = outcomes.reduce((sum, item) => sum + item.bestPlacementScore, 0) / outcomes.length;
  const expectedGain = rerollExpectedScore - currentBestScore;
  return {
    currentBestScore,
    rerollExpectedScore,
    expectedGain,
    shouldUseTazza: expectedGain > 0,
    outcomes,
  };
}
