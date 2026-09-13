import type { GameState, RandomSource } from '../engine';
import { getAIProfile } from './profiles';
import { rankAIPlacementCandidates } from './evaluatePlacement';
import { rankAdvancedAIActions, type AdvancedSearchOptions } from './search';
import { rerankStrategicAIActions } from './strategic';
import { rankWinProbabilityAIActions } from './winProbability';
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
  if (ranked.length === 0) throw new Error('라카루카 기본 AI에 합법적인 Placement 후보가 없습니다.');

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
 * Final AI chooser.
 * - Lv.1~8: established tactical search path.
 * - Lv.9: depth-2 search + two-row strategic rerank.
 * - Lv.10: the same strategic shortlist is re-evaluated by independent
 *   Monte Carlo futures and the highest estimated win probability is chosen.
 */
export function chooseAdvancedAIAction(
  state: GameState,
  aiRng: RandomSource,
  profile: AIProfile = getAIProfile(state.difficulty),
  options?: AdvancedSearchOptions,
): AIAdvancedChoice {
  const ranking = rankAdvancedAIActions(state, profile, options);

  if (profile.difficulty === 10) {
    const strategic = rerankStrategicAIActions(state, ranking.rankedCandidates, profile).rankedCandidates;
    const probability = rankWinProbabilityAIActions(state, aiRng, strategic, profile);
    const ranked = probability.rankedCandidates.map((candidate) => ({
      action: candidate.action,
      score: candidate.estimatedWinProbability * 1_000_000 + candidate.baseScore,
    } satisfies AIAdvancedActionCandidate));
    const best = ranked[0];

    return {
      action: best.action,
      score: best.score,
      usedMistake: false,
      rankedCandidates: ranked,
      searchDepth: profile.searchDepth,
      nodesVisited: ranking.nodesVisited,
      searchAbortReason: ranking.searchAbortReason,
    };
  }

  const ranked: readonly AIAdvancedActionCandidate[] = profile.difficulty === 9
    ? rerankStrategicAIActions(state, ranking.rankedCandidates, profile).rankedCandidates
    : ranking.rankedCandidates;
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
