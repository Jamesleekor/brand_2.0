// =====================================================================
// B.R.A.N.D 2.0 — shared character element model (E1-A)
// Generic master data used by Fragment Expedition and future Boss Raid.
// =====================================================================

export const CHARACTER_ELEMENTS = ['WATER', 'FIRE', 'WIND', 'EARTH', 'LIGHT', 'DARK'] as const;
export type CharacterElement = (typeof CHARACTER_ELEMENTS)[number];

export const CHARACTER_ELEMENT_BUDGETS = [8, 9, 10] as const;
export type CharacterElementBudget = (typeof CHARACTER_ELEMENT_BUDGETS)[number];

export const CHARACTER_ELEMENT_TRAITS = ['PURE', 'EXTREME', 'SPECIALIZED', 'BALANCED'] as const;
export type CharacterElementTrait = (typeof CHARACTER_ELEMENT_TRAITS)[number];

export type CharacterElementFilter = 'ALL' | CharacterElement;
export type CharacterElementTraitFilter = 'ALL' | CharacterElementTrait;
export type CharacterElementTierFilter = 'ALL' | CharacterElementBudget;

export type CharacterElementProfile = {
  character_id: number;
  element_budget: CharacterElementBudget;
  primary_element: CharacterElement;
  primary_points: number;
  secondary_element: CharacterElement | null;
  secondary_points: number;
};

export const CHARACTER_ELEMENT_META: Record<
  CharacterElement,
  { label: string; icon: string; color: string }
> = {
  WATER: { label: '수', icon: '💧', color: '#38BDF8' },
  FIRE: { label: '화', icon: '🔥', color: '#FB7185' },
  WIND: { label: '풍', icon: '🌪', color: '#5EEAD4' },
  EARTH: { label: '토', icon: '🪨', color: '#D6A35C' },
  LIGHT: { label: '빛', icon: '✦', color: '#FDE68A' },
  DARK: { label: '암', icon: '◈', color: '#C084FC' },
};

export const CHARACTER_ELEMENT_TIER_LABELS: Record<CharacterElementBudget, string> = {
  8: '일반형',
  9: '상급형',
  10: '최고급형',
};

export const CHARACTER_ELEMENT_TRAIT_LABELS: Record<CharacterElementTrait, string> = {
  PURE: '순수형',
  EXTREME: '극특화',
  SPECIALIZED: '특화',
  BALANCED: '균형',
};

export function getCharacterElementTrait(profile: CharacterElementProfile): CharacterElementTrait {
  if (profile.secondary_element === null || profile.secondary_points === 0) return 'PURE';

  const dominantRatio = Math.max(profile.primary_points, profile.secondary_points) / profile.element_budget;
  if (dominantRatio >= 0.8) return 'EXTREME';
  if (dominantRatio >= 0.6) return 'SPECIALIZED';
  return 'BALANCED';
}

export function characterHasElement(profile: CharacterElementProfile, element: CharacterElement): boolean {
  return profile.primary_element === element || profile.secondary_element === element;
}

export function parseCharacterElementProfile(row: Record<string, unknown>): CharacterElementProfile {
  const characterId = Number(row.character_id);
  const budget = Number(row.element_budget);
  const primaryElement = String(row.primary_element ?? '') as CharacterElement;
  const primaryPoints = Number(row.primary_points);
  const secondaryRaw = row.secondary_element;
  const secondaryElement = secondaryRaw === null || secondaryRaw === undefined
    ? null
    : String(secondaryRaw) as CharacterElement;
  const secondaryPoints = Number(row.secondary_points ?? 0);

  if (!Number.isInteger(characterId) || characterId <= 0) {
    throw new Error('편린 속성 데이터의 character_id가 올바르지 않습니다.');
  }
  if (!CHARACTER_ELEMENT_BUDGETS.includes(budget as CharacterElementBudget)) {
    throw new Error(`편린 ${characterId}의 속성 총합이 올바르지 않습니다.`);
  }
  if (!CHARACTER_ELEMENTS.includes(primaryElement)) {
    throw new Error(`편린 ${characterId}의 주속성이 올바르지 않습니다.`);
  }
  if (secondaryElement !== null && !CHARACTER_ELEMENTS.includes(secondaryElement)) {
    throw new Error(`편린 ${characterId}의 부속성이 올바르지 않습니다.`);
  }
  if (!Number.isInteger(primaryPoints) || !Number.isInteger(secondaryPoints)) {
    throw new Error(`편린 ${characterId}의 속성 포인트가 올바르지 않습니다.`);
  }
  if (primaryPoints + secondaryPoints !== budget) {
    throw new Error(`편린 ${characterId}의 속성 포인트 합계가 총합과 일치하지 않습니다.`);
  }
  if ((secondaryElement === null) !== (secondaryPoints === 0)) {
    throw new Error(`편린 ${characterId}의 부속성/부속성 포인트 조합이 올바르지 않습니다.`);
  }
  if (secondaryElement !== null && secondaryElement === primaryElement) {
    throw new Error(`편린 ${characterId}의 주속성과 부속성이 같습니다.`);
  }

  return {
    character_id: characterId,
    element_budget: budget as CharacterElementBudget,
    primary_element: primaryElement,
    primary_points: primaryPoints,
    secondary_element: secondaryElement,
    secondary_points: secondaryPoints,
  };
}
