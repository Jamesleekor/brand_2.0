// =====================================================================
// B.R.A.N.D 2.0 — 외부 이미지 호스팅 URL 헬퍼
// Stage 6-A · 생성일 2026-05-20
// =====================================================================
// Master Lee가 호스팅하는 외부 이미지 URL 생성 헬퍼.
// 
// 두 가지 URL 패턴:
//   1. 상점 아이템 (배경 스킨 등):
//      https://jamesleekor.github.io/brand-assets/background/013_FrenchBedroom.jpeg
//   
//   2. 티어 아이콘:
//      https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/tier_icon/rankicon_gold4.png
// =====================================================================

import type { Tier } from '@/types/database_types';

// =====================================================================
// 1. 호스팅 URL 베이스
// =====================================================================

const ASSET_BASE_SHOP = 'https://jamesleekor.github.io/brand-assets';
const ASSET_BASE_TIER = 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/tier_icon';

// =====================================================================
// 2. 티어 → 아이콘 URL 매핑
// =====================================================================
// 22개 티어 각각의 아이콘 파일명.
// 실제 파일명에 맞게 조정 필요 (Master Lee 호스팅 파일 기준).
// =====================================================================

const TIER_ICON_FILENAMES: Record<Tier, string> = {
  '새싹':       'rankicon_seedling.png',
  '브론즈':     'rankicon_bronze1.png',
  '빛나는 브론즈': 'rankicon_bronze2.png',
  '거친 실버':   'rankicon_silver1.png',
  '성장한 실버': 'rankicon_silver2.png',
  '진화한 실버': 'rankicon_silver3.png',
  '은빛 극점':   'rankicon_silver4.png',
  '금 광석':    'rankicon_gold1.png',
  '제련된 골드': 'rankicon_gold2.png',
  '정련된 골드': 'rankicon_gold3.png',
  '태양의 황금': 'rankicon_gold4.png',
  '루비 원석':   'rankicon_ruby1.png',
  '연마된 루비': 'rankicon_ruby2.png',
  '각성한 루비': 'rankicon_ruby3.png',
  '홍염의 정점': 'rankicon_ruby4.png',
  '다이아 원석': 'rankicon_diamond1.png',
  '세공된 다이아': 'rankicon_diamond2.png',
  '무결 다이아': 'rankicon_diamond3.png',
  '영원의 결정': 'rankicon_diamond4.png',
  '마스터':      'rankicon_master1.png',
  '천상의 마스터': 'rankicon_master2.png',
  '그랜드마스터': 'rankicon_grandmaster.png',
};

/**
 * 티어 이름 → 아이콘 URL
 * 
 * @example
 *   getTierIconUrl('제련된 골드')
 *   // → 'https://raw.githubusercontent.com/Jamesleekor/brand-assets/main/tier_icon/rankicon_gold2.png'
 */
export function getTierIconUrl(tier: Tier): string {
  const filename = TIER_ICON_FILENAMES[tier];
  return `${ASSET_BASE_TIER}/${filename}`;
}

// =====================================================================
// 3. 상점 아이템 카테고리별 URL
// =====================================================================
// 카테고리:
//   - background: 배경 스킨 (계절·판타지·자연·인테리어·캐릭터 일러스트)
//   - character: 학생 장착 캐릭터
//   - title: 칭호 아이콘
//   - frame: 프로필 프레임
//   - effect: 시각 효과 (이름표 빛남 등)
// =====================================================================

export type AssetCategory = 
  | 'background'    // 배경 스킨
  | 'character'     // 캐릭터
  | 'title'         // 칭호
  | 'frame'         // 프레임
  | 'effect'        // 효과
  | 'sticker'       // 수집 스티커 (추후)
  | 'icon';         // 일반 아이콘

/**
 * 상점 아이템 URL 생성
 * 
 * @param category - 아이템 카테고리
 * @param filename - 파일명 (확장자 포함)
 * 
 * @example
 *   getShopAssetUrl('background', '013_FrenchBedroom.jpeg')
 *   // → 'https://jamesleekor.github.io/brand-assets/background/013_FrenchBedroom.jpeg'
 */
export function getShopAssetUrl(
  category: AssetCategory,
  filename: string
): string {
  return `${ASSET_BASE_SHOP}/${category}/${filename}`;
}

// =====================================================================
// 4. 상점 아이템 URL — DB 데이터 기반 (실제 운영 시)
// =====================================================================

/**
 * cosmetic_items 테이블의 image_url 필드가 다음 형식일 때 사용:
 *   - 절대 URL: "https://..." 또는 "http://..."
 *   - 상대 경로: "background/013_FrenchBedroom.jpeg"
 *   - 파일명만: "013_FrenchBedroom.jpeg" + category
 * 
 * 자동으로 절대 URL 변환.
 */
export function resolveAssetUrl(
  imageUrl: string | null | undefined,
  fallbackCategory: AssetCategory = 'icon',
  fallbackImage?: string
): string {
  // 1. null/empty → fallback
  if (!imageUrl) {
    return fallbackImage 
      ? getShopAssetUrl(fallbackCategory, fallbackImage)
      : `${ASSET_BASE_SHOP}/${fallbackCategory}/placeholder.png`;
  }
  
  // 2. 이미 절대 URL → 그대로
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  
  // 3. 상대 경로 (category/filename)
  if (imageUrl.includes('/')) {
    return `${ASSET_BASE_SHOP}/${imageUrl}`;
  }
  
  // 4. 파일명만 → 카테고리 결합
  return `${ASSET_BASE_SHOP}/${fallbackCategory}/${imageUrl}`;
}

// =====================================================================
// 5. 프리로딩 헬퍼 (큰 이미지 미리 로드)
// =====================================================================

/**
 * 이미지 프리로드 (배경 스킨 등 큰 이미지)
 * 페이지 진입 시 미리 로드해서 깜빡임 방지.
 * 
 * @example
 *   useEffect(() => {
 *     preloadImages([
 *       getShopAssetUrl('background', '013_FrenchBedroom.jpeg'),
 *       getTierIconUrl('제련된 골드'),
 *     ]);
 *   }, []);
 */
export function preloadImages(urls: string[]): void {
  urls.forEach(url => {
    const img = new Image();
    img.src = url;
  });
}

// =====================================================================
// 6. 검증 헬퍼 (개발 시 URL 점검)
// =====================================================================

/**
 * 이미지 URL이 실제 로드 가능한지 검증
 * 개발 환경에서만 사용 (운영 시 비활성).
 */
export async function verifyAssetUrl(url: string): Promise<boolean> {
  if (!import.meta.env.DEV) return true;
  
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

// =====================================================================
// 사용 예시
// =====================================================================
//
// import { getTierIconUrl, getShopAssetUrl, resolveAssetUrl } from '@/lib/assets';
//
// // 1. 티어 아이콘
// <img src={getTierIconUrl(student.tier)} alt={student.tier} />
//
// // 2. 상점 배경
// <img src={getShopAssetUrl('background', '013_FrenchBedroom.jpeg')} />
//
// // 3. DB 데이터 기반 (cosmetic_items.image_url)
// <img src={resolveAssetUrl(item.image_url, 'background')} alt={item.name} />
//
// // 4. 프리로드
// useEffect(() => {
//   preloadImages([
//     getTierIconUrl(currentTier),
//     getTierIconUrl(nextTier),
//   ]);
// }, [currentTier]);
