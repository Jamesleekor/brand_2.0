import { STARLINK_V03_RULES, type StarlinkGameplayRules } from './starlinkRules';

export interface StarlinkScoreBreakdown {
  clearKind: 'NORMAL' | 'LOOP';
  comboCount: number;
  comboMultiplierPercent: number;
  baseScore: number;
  scoreBeforeCombo: number;
  awardedScore: number;
}

export function starlinkComboMultiplierPercent(
  comboCount: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): number {
  if (!Number.isInteger(comboCount) || comboCount < 1) {
    throw new Error('Starlink combo count must be a positive integer.');
  }

  return Math.min(
    100 + (comboCount - 1) * rules.comboStepPercent,
    rules.comboMaxPercent,
  );
}

export function nextStarlinkComboCount(
  currentComboCount: number,
  lastCommitActiveMs: number | null,
  nextCommitActiveMs: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): number {
  if (!Number.isInteger(nextCommitActiveMs) || nextCommitActiveMs < 0) {
    throw new Error('Starlink commit time must be a non-negative integer.');
  }
  if (lastCommitActiveMs === null) return 1;
  if (!Number.isInteger(lastCommitActiveMs) || lastCommitActiveMs < 0 || nextCommitActiveMs < lastCommitActiveMs) {
    throw new Error('Starlink commit time must be monotonic.');
  }

  return nextCommitActiveMs - lastCommitActiveMs <= rules.comboWindowMs
    ? currentComboCount + 1
    : 1;
}

export function scoreStarlinkNormalClear(
  pathLength: number,
  comboCount: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkScoreBreakdown {
  if (!Number.isInteger(pathLength) || pathLength < rules.minLinkCount) {
    throw new Error('Starlink normal clear path is too short.');
  }

  const baseScore = rules.baseScoreFactor * pathLength * (pathLength - 1);
  const multiplier = starlinkComboMultiplierPercent(comboCount, rules);
  return {
    clearKind: 'NORMAL',
    comboCount,
    comboMultiplierPercent: multiplier,
    baseScore,
    scoreBeforeCombo: baseScore,
    awardedScore: Math.floor((baseScore * multiplier) / 100),
  };
}

export function scoreStarlinkLoopClear(
  removedCount: number,
  comboCount: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkScoreBreakdown {
  if (!Number.isInteger(removedCount) || removedCount < rules.loopMinUniqueCount) {
    throw new Error('Starlink loop clear removed count is invalid.');
  }

  const baseScore = rules.baseScoreFactor * removedCount * (removedCount - 1);
  const scoreBeforeCombo = Math.floor((baseScore * rules.loopBonusPercent) / 100);
  const multiplier = starlinkComboMultiplierPercent(comboCount, rules);

  return {
    clearKind: 'LOOP',
    comboCount,
    comboMultiplierPercent: multiplier,
    baseScore,
    scoreBeforeCombo,
    awardedScore: Math.floor((scoreBeforeCombo * multiplier) / 100),
  };
}
