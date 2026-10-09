import type {
  ExpeditionElementCode,
  ExpeditionSpecialtyCode,
} from '@/lib/rpc/expedition_rpc';

export type ExpeditionFitGradeCode = 'VULNERABLE' | 'NORMAL' | 'STABLE' | 'STRONG';
export type ExpeditionRewardTierCode = 'COMMON' | 'INTERMEDIATE' | 'RARE';
export type ExpeditionWorldEffectCode = 'RESTORE' | 'SHOP' | 'SUPPLY' | 'RECORD' | 'COSMETIC';

const ROOT = 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/expedition';

// Expedition visuals live in the dedicated public asset repository.
// Keep every UI consumer behind this central map so filenames/hosting can change in one place.

export const EXPEDITION_ASSETS = {
  common: {
    emblem: `${ROOT}/common/expedition_emblem.webp`,
    completed: `${ROOT}/common/expedition_completed.webp`,
    trace: `${ROOT}/common/expedition_trace.webp`,
    universalFragment: `${ROOT}/common/universal_fragment.webp`,
    discoverySuccess: `${ROOT}/common/discovery_success.webp`,
  },
  specialty: {
    RUINS: `${ROOT}/specialty/specialty_ruins.webp`,
    NATURE: `${ROOT}/specialty/specialty_nature.webp`,
    SANCTUARY: `${ROOT}/specialty/specialty_sanctuary.webp`,
  } satisfies Record<ExpeditionSpecialtyCode, string>,
  element: {
    WATER: `${ROOT}/elements/element_water.webp`,
    FIRE: `${ROOT}/elements/element_fire.webp`,
    WIND: `${ROOT}/elements/element_wind.webp`,
    EARTH: `${ROOT}/elements/element_earth.webp`,
    LIGHT: `${ROOT}/elements/element_light.webp`,
    DARK: `${ROOT}/elements/element_dark.webp`,
  } satisfies Record<ExpeditionElementCode, string>,
  rewardChest: {
    COMMON: `${ROOT}/rewards/expedition_chest_common.webp`,
    INTERMEDIATE: `${ROOT}/rewards/expedition_chest_intermediate.webp`,
    RARE: `${ROOT}/rewards/expedition_chest_rare.webp`,
  } satisfies Record<ExpeditionRewardTierCode, string>,
  rewardGrade: {
    COMMON: `${ROOT}/rewards/reward_grade_common.webp`,
    INTERMEDIATE: `${ROOT}/rewards/reward_grade_intermediate.webp`,
    RARE: `${ROOT}/rewards/reward_grade_rare.webp`,
  } satisfies Record<ExpeditionRewardTierCode, string>,
  worldEffect: {
    RESTORE: `${ROOT}/effects/world_effect_restore.webp`,
    SHOP: `${ROOT}/effects/world_effect_shop.webp`,
    SUPPLY: `${ROOT}/effects/world_effect_supply.webp`,
    RECORD: `${ROOT}/effects/world_effect_record.webp`,
    COSMETIC: `${ROOT}/effects/world_effect_cosmetic.webp`,
  } satisfies Record<ExpeditionWorldEffectCode, string>,
  worldEffectActivation: `${ROOT}/effects/world_effect_activation.webp`,
  sundayEnvironmentShift: `${ROOT}/effects/sunday_environment_shift.webp`,
  recoveryRequired: `${ROOT}/states/shard_recovery_required.webp`,
  chronicleRecordLocked: `${ROOT}/states/chronicle_record_locked.webp`,
  fitGrade: {
    VULNERABLE: `${ROOT}/states/fit_grade_weak.webp`,
    NORMAL: `${ROOT}/states/fit_grade_normal.webp`,
    STABLE: `${ROOT}/states/fit_grade_stable.webp`,
    STRONG: `${ROOT}/states/fit_grade_strong.webp`,
  } satisfies Record<ExpeditionFitGradeCode, string>,
  storyStage: [
    `${ROOT}/story/story_stage_00_undiscovered.webp`,
    `${ROOT}/story/story_stage_01_signal.webp`,
    `${ROOT}/story/story_stage_02_discovered.webp`,
    `${ROOT}/story/story_stage_03_activated.webp`,
    `${ROOT}/story/story_stage_04_breakthrough.webp`,
  ] as const,
  mastery: [
    `${ROOT}/mastery/mastery_0_unexplored.webp`,
    `${ROOT}/mastery/mastery_1_surveyed.webp`,
    `${ROOT}/mastery/mastery_2_opened.webp`,
    `${ROOT}/mastery/mastery_3_mastered.webp`,
  ] as const,
  site: {
    'SITE-001': `${ROOT}/sites/ruins/site_ruins_carcosa.webp`,
    'SITE-002': `${ROOT}/sites/ruins/site_ruins_naxmar.webp`,
    'SITE-003': `${ROOT}/sites/ruins/site_ruins_necropolia.webp`,
    'SITE-004': `${ROOT}/sites/ruins/site_ruins_chrono_tower.webp`,
    'SITE-005': `${ROOT}/sites/ruins/site_ruins_leviathan_nest.webp`,
    'SITE-006': `${ROOT}/sites/nature/site_nature_zephyros_mountain.webp`,
    'SITE-007': `${ROOT}/sites/nature/site_nature_shaia_desert.webp`,
    'SITE-008': `${ROOT}/sites/nature/site_nature_mascarum_jungle.webp`,
    'SITE-009': `${ROOT}/sites/nature/site_nature_witchwood_swamp.webp`,
    'SITE-010': `${ROOT}/sites/nature/site_nature_ignis_lava_zone.webp`,
    'SITE-011': `${ROOT}/sites/sanctuary/site_sanctuary_sun_temple.webp`,
    'SITE-012': `${ROOT}/sites/sanctuary/site_sanctuary_milkyway_observatory.webp`,
    'SITE-013': `${ROOT}/sites/sanctuary/site_sanctuary_ancient_god_seal.webp`,
    'SITE-014': `${ROOT}/sites/sanctuary/site_sanctuary_hell_gate.webp`,
    'SITE-015': `${ROOT}/sites/sanctuary/site_sanctuary_world_tree_root.webp`,
  } satisfies Record<string, string>,
  weeklySummary: `${ROOT}/weekly/weekly_expedition_summary.webp`,
} as const;

export function getExpeditionSiteAsset(siteCode: string): string | null {
  return EXPEDITION_ASSETS.site[siteCode as keyof typeof EXPEDITION_ASSETS.site] ?? null;
}

export function getExpeditionFitGradeAsset(grade: string): string | null {
  return EXPEDITION_ASSETS.fitGrade[grade as ExpeditionFitGradeCode] ?? null;
}

export function getExpeditionRewardTierAsset(tier: string): string | null {
  return EXPEDITION_ASSETS.rewardGrade[tier as ExpeditionRewardTierCode] ?? null;
}

export function getExpeditionRewardChestAsset(tier: string): string | null {
  return EXPEDITION_ASSETS.rewardChest[tier as ExpeditionRewardTierCode] ?? null;
}

export function getExpeditionWorldEffectAsset(effectCode: string): string | null {
  return EXPEDITION_ASSETS.worldEffect[effectCode as ExpeditionWorldEffectCode] ?? null;
}

export function getExpeditionStoryStageAsset(stage: number): string {
  const normalized = Math.max(0, Math.min(4, Math.trunc(Number(stage) || 0)));
  return EXPEDITION_ASSETS.storyStage[normalized];
}

export function getExpeditionMasteryAsset(level: number): string {
  const normalized = Math.max(0, Math.min(3, Math.trunc(Number(level) || 0)));
  return EXPEDITION_ASSETS.mastery[normalized];
}
