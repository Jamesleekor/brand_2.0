import { canUseTazza } from '../engine/rules/tazza';
import type { DieValue, GameState } from '../engine/types';
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
  value: DieValue,
): GameState {
  const currentDie = state.turn.currentDie;
  if (!canUseTazza(state, 'ai') || currentDie === null || currentDie.kind !== 'normal') {
    throw new Error('타카투카 AI Tazza 가상 상태를 만들 수 없는 상태입니다.');
  }

  return {
    ...state,
    sides: {
      ...state.sides,
      ai: {
        ...state.sides.ai,
        skills: {
          ...state.sides.ai.skills,
          tazzaRemaining: state.sides.ai.skills.tazzaRemaining - 1,
        },
      },
    },
    stats: {
      ...state.stats,
      ai: {
        ...state.stats.ai,
        tazzaUsed: state.stats.ai.tazzaUsed + 1,
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

/**
 * Evaluates Tazza without touching gameRng.
 * The six legal reroll values are enumerated at uniform 1/6 probability.
 */
export function evaluateAITazza(
  state: GameState,
  profile: AIProfile = getAIProfile(state.difficulty),
): AITazzaEvaluation {
  if (!canUseTazza(state, 'ai')) {
    throw new Error('타카투카 AI는 현재 상태에서 Tazza를 사용할 수 없습니다.');
  }

  const currentRanked = rankAIPlacementCandidates(state, profile);
  if (currentRanked.length === 0) {
    throw new Error('Tazza 평가 전에 현재 주사위의 합법 Placement가 필요합니다.');
  }
  const currentBestScore = currentRanked[0].score;

  const values: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
  const outcomes = values.map((value): AITazzaOutcomeValue => {
    const hypothetical = createHypotheticalTazzaState(state, value);
    const ranked = rankAIPlacementCandidates(hypothetical, profile);
    if (ranked.length === 0) {
      throw new Error(`Tazza 가상 눈 ${value}에서 합법 Placement가 없습니다.`);
    }
    return {
      value,
      bestPlacementScore: ranked[0].score,
    };
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
