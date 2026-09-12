import type { GameState, RandomSource } from '../engine';
import { getAIProfile } from './profiles';
import { rankAIPlacementCandidates } from './evaluatePlacement';
import { rankAdvancedAIActions, type AdvancedSearchOptions } from './search';
import type {
  AIAdvancedActionCandidate,
  AIAdvancedChoice,
  AIBasicChoice,
  AIPlacementCandidate,
  AIProfile,
} from './types';

function nextUnit(rng: RandomSource): number {
  if (rng.nextFloat) return rng.nextFloat();
  return rng.nextInt(0, 999_999) / 1_000_000;
}

function eligibleMistakePool<T extends { score: number }>(
  ranked: readonly T[],
  profile: AIProfile,
): readonly T[] {
  if (ranked.length <= 1 || profile.candidatePoolSize <= 1) return ranked.slice(0, 1);
  const bestScore = ranked[0].score;
  return ranked
    .slice(0, profile.candidatePoolSize)
    .filter((candidate) => bestScore - candidate.score <= profile.maxMistakeScoreGap);
}

/** Phase-4 placement-only compatibility API. */
export function chooseBasicAIPlacement(
  state: GameState,
  aiRng: RandomSource,
  profile: AIProfile = getAIProfile(state.difficulty),
): AIBasicChoice {
  const ranked: readonly AIPlacementCandidate[] = rankAIPlacementCandidates(state, profile);
  if (ranked.length === 0) throw new Error('타카투카 기본 AI에 합법적인 Placement 후보가 없습니다.');

  const best = ranked[0];
  const pool = eligibleMistakePool(ranked, profile);
  if (pool.length <= 1 || profile.mistakeRate <= 0 || nextUnit(aiRng) >= profile.mistakeRate) {
    return { action: best.action, score: best.score, usedMistake: false, rankedCandidates: ranked };
  }

  const alternativeIndex = aiRng.nextInt(1, pool.length - 1);
  const chosen = pool[alternativeIndex];
  return { action: chosen.action, score: chosen.score, usedMistake: true, rankedCandidates: ranked };
}

/**
 * Final Phase-5 AI chooser. Placement, Tazza and HOLD are ranked by the same search value.
 * aiRng is used only for bounded near-best mistakes; search itself is deterministic.
 */
export function chooseAdvancedAIAction(
  state: GameState,
  aiRng: RandomSource,
  profile: AIProfile = getAIProfile(state.difficulty),
  options?: AdvancedSearchOptions,
): AIAdvancedChoice {
  const ranking = rankAdvancedAIActions(state, profile, options);
  const ranked: readonly AIAdvancedActionCandidate[] = ranking.rankedCandidates;
  const best = ranked[0];
  const pool = eligibleMistakePool(ranked, profile);

  let chosen = best;
  let usedMistake = false;
  if (pool.length > 1 && profile.mistakeRate > 0 && nextUnit(aiRng) < profile.mistakeRate) {
    chosen = pool[aiRng.nextInt(1, pool.length - 1)];
    usedMistake = true;
  }

  return {
    action: chosen.action,
    score: chosen.score,
    usedMistake,
    rankedCandidates: ranked,
    searchDepth: profile.searchDepth,
    nodesVisited: ranking.nodesVisited,
    searchAbortReason: ranking.searchAbortReason,
  };
}
