import type { Tier } from '@/types/database_types';

/**
 * H5 BRAND WORLD canonical map assets.
 * Both images share the same 1672x941 aspect ratio.
 *
 * WORLD:
 *   새싹 ~ 영원의 결정
 * CELESTIAL_SANCTUARY:
 *   마스터 / 천상의 마스터 / 그랜드마스터
 */
export const BRAND_WORLD_MAP_URL = 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/brand2.0-page/BRAND-WORLD.png';
export const CELESTIAL_SANCTUARY_MAP_URL = 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/brand2.0-page/Celestial-Sanctuary.png';
export const BRAND_WORLD_MAP_IS_PLACEHOLDER = false;

export type BrandWorldMapId = 'WORLD' | 'CELESTIAL_SANCTUARY';

export interface BrandWorldMapConfig {
  id: BrandWorldMapId;
  url: string;
  alt: string;
  eyebrow: string;
}

export interface BrandWorldTierNode {
  tier: Tier;
  mapId: BrandWorldMapId;
  xPct: number;
  yPct: number;
  regionLabel: string;
  locationLabel: string;
  regionIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export const BRAND_WORLD_MAPS: Record<BrandWorldMapId, BrandWorldMapConfig> = {
  WORLD: {
    id: 'WORLD',
    url: BRAND_WORLD_MAP_URL,
    alt: 'B.R.A.N.D 세계 지도',
    eyebrow: 'WORLD MAP',
  },
  CELESTIAL_SANCTUARY: {
    id: 'CELESTIAL_SANCTUARY',
    url: CELESTIAL_SANCTUARY_MAP_URL,
    alt: '천상 성역 내부 지도',
    eyebrow: 'CELESTIAL SANCTUARY',
  },
};

/**
 * Canonical coordinate calibration against the final 1672x941 map artwork.
 *
 * The WORLD map contains the 19 pre-Master tiers.
 * Master and above do NOT place a marker on Region 7 of the WORLD map.
 * Entering Master switches the entire map to CELESTIAL_SANCTUARY.
 */
export const WORLD_TIER_NODES: Record<Tier, BrandWorldTierNode> = {
  // Region 1 · 씨앗 평원
  '새싹': {
    tier: '새싹', mapId: 'WORLD', xPct: 18.0, yPct: 78.0,
    regionLabel: '씨앗 평원', locationLabel: '씨앗 평원', regionIndex: 1,
  },

  // Region 2 · 동쪽 언덕
  '브론즈': {
    tier: '브론즈', mapId: 'WORLD', xPct: 44.0, yPct: 78.0,
    regionLabel: '동쪽 언덕', locationLabel: '동쪽 언덕', regionIndex: 2,
  },
  '빛나는 브론즈': {
    tier: '빛나는 브론즈', mapId: 'WORLD', xPct: 51.0, yPct: 74.0,
    regionLabel: '동쪽 언덕', locationLabel: '동쪽 언덕', regionIndex: 2,
  },

  // Region 3 · 은빛 산맥
  '거친 실버': {
    tier: '거친 실버', mapId: 'WORLD', xPct: 78.5, yPct: 81.0,
    regionLabel: '은빛 산맥', locationLabel: '은빛 산맥', regionIndex: 3,
  },
  '성장한 실버': {
    tier: '성장한 실버', mapId: 'WORLD', xPct: 83.0, yPct: 77.0,
    regionLabel: '은빛 산맥', locationLabel: '은빛 산맥', regionIndex: 3,
  },
  '진화한 실버': {
    tier: '진화한 실버', mapId: 'WORLD', xPct: 88.0, yPct: 78.5,
    regionLabel: '은빛 산맥', locationLabel: '은빛 산맥', regionIndex: 3,
  },
  '은빛 극점': {
    tier: '은빛 극점', mapId: 'WORLD', xPct: 84.5, yPct: 72.0,
    regionLabel: '은빛 산맥', locationLabel: '은빛 산맥', regionIndex: 3,
  },

  // Region 4 · 황금 고원
  '금 광석': {
    tier: '금 광석', mapId: 'WORLD', xPct: 57.0, yPct: 57.0,
    regionLabel: '황금 고원', locationLabel: '황금 고원', regionIndex: 4,
  },
  '제련된 골드': {
    tier: '제련된 골드', mapId: 'WORLD', xPct: 62.5, yPct: 52.0,
    regionLabel: '황금 고원', locationLabel: '황금 고원', regionIndex: 4,
  },
  '정련된 골드': {
    tier: '정련된 골드', mapId: 'WORLD', xPct: 68.0, yPct: 51.0,
    regionLabel: '황금 고원', locationLabel: '황금 고원', regionIndex: 4,
  },
  '태양의 황금': {
    tier: '태양의 황금', mapId: 'WORLD', xPct: 72.5, yPct: 56.0,
    regionLabel: '황금 고원', locationLabel: '황금 고원', regionIndex: 4,
  },

  // Region 5 · 홍염 화산
  '루비 원석': {
    tier: '루비 원석', mapId: 'WORLD', xPct: 12.5, yPct: 57.0,
    regionLabel: '홍염 화산', locationLabel: '홍염 화산', regionIndex: 5,
  },
  '연마된 루비': {
    tier: '연마된 루비', mapId: 'WORLD', xPct: 17.5, yPct: 53.0,
    regionLabel: '홍염 화산', locationLabel: '홍염 화산', regionIndex: 5,
  },
  '각성한 루비': {
    tier: '각성한 루비', mapId: 'WORLD', xPct: 23.0, yPct: 55.0,
    regionLabel: '홍염 화산', locationLabel: '홍염 화산', regionIndex: 5,
  },
  '홍염의 정점': {
    tier: '홍염의 정점', mapId: 'WORLD', xPct: 19.0, yPct: 61.5,
    regionLabel: '홍염 화산', locationLabel: '홍염 화산', regionIndex: 5,
  },

  // Region 6 · 수정 빙하
  '다이아 원석': {
    tier: '다이아 원석', mapId: 'WORLD', xPct: 30.0, yPct: 35.0,
    regionLabel: '수정 빙하', locationLabel: '수정 빙하', regionIndex: 6,
  },
  '세공된 다이아': {
    tier: '세공된 다이아', mapId: 'WORLD', xPct: 35.5, yPct: 32.0,
    regionLabel: '수정 빙하', locationLabel: '수정 빙하', regionIndex: 6,
  },
  '무결 다이아': {
    tier: '무결 다이아', mapId: 'WORLD', xPct: 41.0, yPct: 34.0,
    regionLabel: '수정 빙하', locationLabel: '수정 빙하', regionIndex: 6,
  },
  '영원의 결정': {
    tier: '영원의 결정', mapId: 'WORLD', xPct: 36.5, yPct: 39.0,
    regionLabel: '수정 빙하', locationLabel: '수정 빙하', regionIndex: 6,
  },

  // Region 7 · 천상 성역 — dedicated internal map
  '마스터': {
    tier: '마스터', mapId: 'CELESTIAL_SANCTUARY', xPct: 54.0, yPct: 80.0,
    regionLabel: '천상 성역', locationLabel: '입성의 전당', regionIndex: 7,
  },
  '천상의 마스터': {
    tier: '천상의 마스터', mapId: 'CELESTIAL_SANCTUARY', xPct: 58.0, yPct: 54.0,
    regionLabel: '천상 성역', locationLabel: '성좌의 회랑', regionIndex: 7,
  },
  '그랜드마스터': {
    tier: '그랜드마스터', mapId: 'CELESTIAL_SANCTUARY', xPct: 60.0, yPct: 30.0,
    regionLabel: '천상 성역', locationLabel: '천상의 왕좌', regionIndex: 7,
  },
};

export function getBrandWorldNode(tier: Tier): BrandWorldTierNode {
  return WORLD_TIER_NODES[tier] ?? WORLD_TIER_NODES['새싹'];
}

export function getBrandWorldMap(tier: Tier): BrandWorldMapConfig {
  return BRAND_WORLD_MAPS[getBrandWorldNode(tier).mapId];
}

export function isCelestialSanctuaryTier(tier: Tier): boolean {
  return getBrandWorldNode(tier).mapId === 'CELESTIAL_SANCTUARY';
}
