import type { Difficulty, RowId, Side, SkillState } from './types';

export const TIKATUKA_ENGINE_VERSION = 1 as const;
export const TIKATUKA_ROW_IDS = ['top', 'middle', 'bottom'] as const satisfies readonly RowId[];
export const TIKATUKA_MAX_DICE_PER_ROW = 3 as const;
export const TIKATUKA_MAX_DICE_PER_BOARD = 9 as const;
export const TIKATUKA_DIE_MIN = 1 as const;
export const TIKATUKA_DIE_MAX = 6 as const;

export const PLAYER_TAZZA_CHARGES = {
  1: 5,
  2: 5,
  3: 4,
  4: 4,
  5: 3,
  6: 3,
  7: 2,
  8: 2,
  9: 1,
  10: 0,
} as const satisfies Record<Difficulty, number>;

export const PLAYER_HOLD_CHARGES = {
  1: 2,
  2: 2,
  3: 2,
  4: 2,
  5: 2,
  6: 1,
  7: 1,
  8: 1,
  9: 1,
  10: 1,
} as const satisfies Record<Difficulty, number>;

export interface AISkillProfile {
  tazzaCharges: number;
  holdCharges: number;
}

export const AI_SKILL_PROFILE = {
  1: { tazzaCharges: 0, holdCharges: 0 },
  2: { tazzaCharges: 0, holdCharges: 0 },
  3: { tazzaCharges: 0, holdCharges: 0 },
  4: { tazzaCharges: 1, holdCharges: 0 },
  5: { tazzaCharges: 1, holdCharges: 0 },
  6: { tazzaCharges: 1, holdCharges: 0 },
  7: { tazzaCharges: 1, holdCharges: 1 },
  8: { tazzaCharges: 2, holdCharges: 1 },
  9: { tazzaCharges: 2, holdCharges: 1 },
  10: { tazzaCharges: 2, holdCharges: 1 },
} as const satisfies Record<Difficulty, AISkillProfile>;

export const AI_SEARCH_LIMITS = {
  maxDepth: 2,
  maxNodes: 5_000,
  hardTimeBudgetMs: 100,
} as const;

export function isTikatukaDifficulty(value: unknown): value is Difficulty {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;
}

export function getInitialSkillState(side: Side, difficulty: Difficulty): SkillState {
  if (side === 'player') {
    return {
      tazzaRemaining: PLAYER_TAZZA_CHARGES[difficulty],
      holdRemaining: PLAYER_HOLD_CHARGES[difficulty],
    };
  }

  const profile = AI_SKILL_PROFILE[difficulty];
  return {
    tazzaRemaining: profile.tazzaCharges,
    holdRemaining: profile.holdCharges,
  };
}
