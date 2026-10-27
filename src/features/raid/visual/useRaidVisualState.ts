import { useMemo } from 'react';

import type { RaidVisualConfigV1, RaidVisualPlaybackState } from './raidVisualTypes';
import { resolveRaidVisualMedia } from './raidVisualConfig';

// Only Pattern Editor entries classified as special patterns use the SPECIAL_PATTERN video.
// Common mechanics (WEAK_POINT / BREAK / ENRAGE) keep their own gameplay/state visuals.
const SPECIAL_PATTERN_TYPES = new Set([
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
    const media = resolveRaidVisualMedia(visual?.media);

    // Priority 1: GROGGY. When its own video is missing, preserve an enraged appearance if possible.
    if (groggyActive) {
      if (media.groggy_video_url) return 'GROGGY';
      if (enrageActive && media.enrage_video_url) return 'ENRAGE';
      return 'IDLE';
    }

    // Priority 2: special patterns. Never fall back to the pre-enrage pattern video while transformed.
    if (activePatternType && SPECIAL_PATTERN_TYPES.has(activePatternType)) {
      if (enrageActive) {
        if (media.enrage_special_pattern_video_url) return 'ENRAGE_SPECIAL_PATTERN';
        if (media.enrage_video_url) return 'ENRAGE';
        return 'IDLE';
      }
      return media.special_pattern_video_url ? 'SPECIAL_PATTERN' : 'IDLE';
    }

    // Priority 3: configured boss basic attack.
    if (bossAttackTelegraph) {
      if (enrageActive) {
        if (media.enrage_basic_attack_video_url) return 'ENRAGE_BASIC_ATTACK';
        if (media.enrage_video_url) return 'ENRAGE';
        return 'IDLE';
      }
      return media.basic_attack_video_url ? 'BASIC_ATTACK' : 'IDLE';
    }

    // Priority 4: persistent enrage state.
    if (enrageActive && media.enrage_video_url) return 'ENRAGE';

    // Priority 5: IDLE is the universal fallback.
    return 'IDLE';
  }, [activePatternType, bossAttackTelegraph, enrageActive, groggyActive, visual]);
}
