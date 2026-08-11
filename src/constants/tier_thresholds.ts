// =====================================================================
// B.R.A.N.D 2.0 — 22 티어 BV 임계값 상수 (정정판)
// Stage 6-C · 수정일 2026-05-20
// =====================================================================
// Master Lee 확인: 기존 _calcTier() 함수 기준으로 정정.
// PostgreSQL의 calculate_tier_from_bv 함수도 이 값과 일치해야 함.
// =====================================================================

import type { Tier } from '@/types/database_types';

// =====================================================================
// 티어별 BV 임계값
// =====================================================================

export interface TierThreshold {
  tier: Tier;
  bvFrom: number;       // 이 티어 시작 BV (포함)
  bvTo: number;         // 다음 티어 시작 BV (= 이 티어의 상한, 미포함)
  index: number;        // 0~21
  icon: string;         // 이모지 (fallback용)
}

export const TIER_THRESHOLDS: TierThreshold[] = [
  // 새싹부터 시작 (0~5000)
  { tier: '새싹',         bvFrom: 0,       bvTo: 5000,    index: 0,  icon: '🌱' },
  
  // 브론즈 (3티어): 5000 ~ 10000
  { tier: '브론즈',       bvFrom: 5000,    bvTo: 7500,    index: 1,  icon: '🥉' },
  { tier: '빛나는 브론즈', bvFrom: 7500,    bvTo: 10000,   index: 2,  icon: '🥉' },
  
  // 실버 (4티어): 10000 ~ 20000
  { tier: '거친 실버',     bvFrom: 10000,   bvTo: 12500,   index: 3,  icon: '🥈' },
  { tier: '성장한 실버',   bvFrom: 12500,   bvTo: 15000,   index: 4,  icon: '🥈' },
  { tier: '진화한 실버',   bvFrom: 15000,   bvTo: 17500,   index: 5,  icon: '🥈' },
  { tier: '은빛 극점',     bvFrom: 17500,   bvTo: 20000,   index: 6,  icon: '🥈' },
  
  // 골드 (4티어): 20000 ~ 30000
  { tier: '금 광석',       bvFrom: 20000,   bvTo: 22500,   index: 7,  icon: '🥇' },
  { tier: '제련된 골드',   bvFrom: 22500,   bvTo: 25000,   index: 8,  icon: '🥇' },
  { tier: '정련된 골드',   bvFrom: 25000,   bvTo: 27500,   index: 9,  icon: '🥇' },
  { tier: '태양의 황금',   bvFrom: 27500,   bvTo: 30000,   index: 10, icon: '🥇' },
  
  // 루비 (4티어): 30000 ~ 50000
  { tier: '루비 원석',     bvFrom: 30000,   bvTo: 35000,   index: 11, icon: '💎' },
  { tier: '연마된 루비',   bvFrom: 35000,   bvTo: 40000,   index: 12, icon: '💎' },
  { tier: '각성한 루비',   bvFrom: 40000,   bvTo: 45000,   index: 13, icon: '💎' },
  { tier: '홍염의 정점',   bvFrom: 45000,   bvTo: 50000,   index: 14, icon: '💎' },
  
  // 다이아 (4티어): 50000 ~ 75000
  { tier: '다이아 원석',   bvFrom: 50000,   bvTo: 55000,   index: 15, icon: '💠' },
  { tier: '세공된 다이아', bvFrom: 55000,   bvTo: 60000,   index: 16, icon: '💠' },
  { tier: '무결 다이아',   bvFrom: 60000,   bvTo: 65000,   index: 17, icon: '💠' },
  { tier: '영원의 결정',   bvFrom: 65000,   bvTo: 75000,   index: 18, icon: '💠' },
  
  // 마스터 (2티어): 75000 ~ 100000
  { tier: '마스터',         bvFrom: 75000,   bvTo: 85000,   index: 19, icon: '👑' },
  { tier: '천상의 마스터',  bvFrom: 85000,   bvTo: 100000,  index: 20, icon: '👑' },
  
  // 그랜드마스터 (최종): 100000+
  { tier: '그랜드마스터',   bvFrom: 100000,  bvTo: Infinity, index: 21, icon: '🏆' },
];

// =====================================================================
// 헬퍼 함수
// =====================================================================

/**
 * 티어 → 임계값 정보
 */
export function getTierThreshold(tier: Tier): TierThreshold {
  const found = TIER_THRESHOLDS.find((t) => t.tier === tier);
  if (!found) {
    return TIER_THRESHOLDS[0]!;  // fallback: 새싹
  }
  return found;
}

/**
 * BV 값 → 현재 티어 계산
 * (Stage 0의 _calcTier 로직과 동일)
 */
export function calculateTierFromBv(bv: number): Tier {
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = TIER_THRESHOLDS[i]!;
    if (bv >= threshold.bvFrom) {
      return threshold.tier;
    }
  }
  return '새싹';
}

/**
 * 다음 티어 정보 (그랜드마스터면 null)
 */
export function getNextTier(currentTier: Tier): TierThreshold | null {
  const current = getTierThreshold(currentTier);
  if (current.index >= TIER_THRESHOLDS.length - 1) return null;
  return TIER_THRESHOLDS[current.index + 1] ?? null;
}

/**
 * 티어 내 진행률 계산 (0~1)
 * 
 * @example
 *   getTierProgress('제련된 골드', 23500)
 *   // → 0.4 (22500→25000 사이의 40% = 1000/2500)
 */
export function getTierProgress(tier: Tier, currentBv: number): number {
  const threshold = getTierThreshold(tier);
  if (threshold.bvTo === Infinity) return 1;  // 그랜드마스터
  
  const range = threshold.bvTo - threshold.bvFrom;
  if (range <= 0) return 1;
  
  const progress = (currentBv - threshold.bvFrom) / range;
  return Math.min(Math.max(progress, 0), 1);
}

/**
 * 다음 티어까지 필요한 BV
 * 
 * @example
 *   getBvUntilNextTier('제련된 골드', 23500)  // 1500 (25000 - 23500)
 */
export function getBvUntilNextTier(tier: Tier, currentBv: number): number {
  const threshold = getTierThreshold(tier);
  if (threshold.bvTo === Infinity) return 0;
  return Math.max(0, threshold.bvTo - currentBv);
}

/**
 * 티어 아이콘 (이모지 fallback)
 * 실제 운영에서는 getTierIconUrl()로 외부 이미지 사용 권장.
 */
export function getTierIconEmoji(tier: Tier): string {
  return getTierThreshold(tier).icon;
}
