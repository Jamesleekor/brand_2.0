import type { GameState, RandomSource } from '../engine';
import { getAIProfile } from './profiles';
import { rankAIPlacementCandidates } from './evaluatePlacement';
import type { AIBasicChoice, AIPlacementCandidate, AIProfile } from './types';

function nextUnit(rng: RandomSource): number {
  if (rng.nextFloat) return rng.nextFloat();
  return rng.nextInt(0, 999_999) / 1_000_000;
}

function eligibleMistakePool(
  ranked: readonly AIPlacementCandidate[],
  profile: AIProfile,
): readonly AIPlacementCandidate[] {
  if (ranked.length <= 1 || profile.candidatePoolSize <= 1) return ranked.slice(0, 1);

  const bestScore = ranked[0].score;
  return ranked
    .slice(0, profile.candidatePoolSize)
    .filter((candidate) => bestScore - candidate.score <= profile.maxMistakeScoreGap);
}

/**
 * Phase-4 placement-only AI.
 * It never rolls dice, never consumes gameRng, and never chooses Tazza/HOLD.
 */
export function chooseBasicAIPlacement(
  state: GameState,
  aiRng: RandomSource,
  profile: AIProfile = getAIProfile(state.difficulty),
): AIBasicChoice {
  const ranked = rankAIPlacementCandidates(state, profile);
  if (ranked.length === 0) {
    throw new Error('타카투카 기본 AI에 합법적인 Placement 후보가 없습니다.');
  }

  const best = ranked[0];
  const pool = eligibleMistakePool(ranked, profile);

  if (pool.length <= 1 || profile.mistakeRate <= 0 || nextUnit(aiRng) >= profile.mistakeRate) {
    return {
      action: best.action,
      score: best.score,
      usedMistake: false,
      rankedCandidates: ranked,
    };
  }

  // Mistakes are deliberately bounded to near-best alternatives; never pick an arbitrary bad move.
  const alternativeIndex = aiRng.nextInt(1, pool.length - 1);
  const chosen = pool[alternativeIndex];
  return {
    action: chosen.action,
    score: chosen.score,
    usedMistake: true,
    rankedCandidates: ranked,
  };
}
