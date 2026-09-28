import { useMemo } from 'react';

import type { RaidVisualConfigV1, RaidVisualPlaybackState } from './raidVisualTypes';

const ACTION_PATTERN_TYPES = new Set([
  'BREAK',
  'ABSORB',
  'REFLECT',
  'BOSS_STRIKE',
  'ULTIMATE',
  'DOT',
  'SHIELD',
  'MULTI_CORE',
  'SPLIT_TARGET',
  'REGEN',
  'SEAL',
  'DAMAGE_CHECK',
]);

function allowsStateVideo(
  visual: RaidVisualConfigV1 | null | undefined,
  state: 'GROGGY' | 'ENRAGE',
): boolean {
  const trigger = visual?.media?.state_video_trigger ?? 'BOTH';
  return trigger === 'BOTH' || trigger === state;
}

export interface RaidVisualStateInput {
  visual: RaidVisualConfigV1 | null | undefined;
  groggyActive: boolean;
  enrageActive: boolean;
  activePatternType: string | null | undefined;
  bossAttackTelegraph: boolean;
}

export function useRaidVisualState({
  visual,
  groggyActive,
  enrageActive,
  activePatternType,
  bossAttackTelegraph,
}: RaidVisualStateInput): RaidVisualPlaybackState {
  return useMemo(() => {
    if (groggyActive && allowsStateVideo(visual, 'GROGGY')) return 'STATE';

    if (activePatternType && ACTION_PATTERN_TYPES.has(activePatternType)) {
      return 'ACTION';
    }

    if (bossAttackTelegraph) return 'ACTION';

    if (enrageActive && allowsStateVideo(visual, 'ENRAGE')) return 'STATE';

    return 'IDLE';
  }, [activePatternType, bossAttackTelegraph, enrageActive, groggyActive, visual]);
}
