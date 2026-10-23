import type {
  ExpeditionCharacterBoardRow,
  ExpeditionElementCode,
  ExpeditionFitGrade,
  ExpeditionSiteBoardRow,
} from '@/lib/rpc/expedition_rpc';

export interface ClientExpeditionFit {
  fitPercent: number;
  fitGrade: ExpeditionFitGrade;
  fitGradeKo: '취약' | '보통' | '안정' | '강인';
  traceContribution: 1 | 2 | 3;
  specialtyMatchCount: number;
  baseFitPercent: number;
  captainBonusPercent: number;
  viceBonusPercent: number;
  roleBonusEnabled: boolean;
}

function elementPoints(character: ExpeditionCharacterBoardRow, element: ExpeditionElementCode) {
  return (character.primary_element === element ? character.primary_points : 0)
    + (character.secondary_element === element ? character.secondary_points : 0);
}

// 탐사지의 속성을 제압하는 편린 속성입니다: 지 > 수 > 화 > 풍 > 지, 광 ↔ 암.
const COUNTER_ELEMENT: Record<ExpeditionElementCode, ExpeditionElementCode> = {
  WATER: 'EARTH',
  FIRE: 'WATER',
  WIND: 'FIRE',
  EARTH: 'WIND',
  LIGHT: 'DARK',
  DARK: 'LIGHT',
};

export function getExpeditionCounterElement(element: ExpeditionElementCode): ExpeditionElementCode {
  return COUNTER_ELEMENT[element];
}

export function calculateExpeditionFitClient(
  site: ExpeditionSiteBoardRow,
  party: ExpeditionCharacterBoardRow[],
  formulaVersion = 'ELEM_70_30_COUNTER_V2',
): ClientExpeditionFit | null {
  if (party.length !== 3 || new Set(party.map((x) => x.character_id)).size !== 3) return null;

  const rolesEnabled = formulaVersion === 'ELEM_70_30_ROLES_V3';
  const legacy = formulaVersion === 'ELEM_70_30_V1';
  const majorCounter = legacy ? site.major_element : getExpeditionCounterElement(site.major_element);
  const minorCounter = legacy ? site.minor_element : getExpeditionCounterElement(site.minor_element);
  const majorSum = party.reduce((sum, x) => sum + elementPoints(x, majorCounter), 0);
  const minorSum = party.reduce((sum, x) => sum + elementPoints(x, minorCounter), 0);
  const specialtyMatchCount = party.filter((x) => x.specialty_code === site.specialty_code).length;
  const baseFitPercent = Math.round(
    70 * Math.min(majorSum / 14, 1.2)
    + 30 * Math.min(minorSum / 8, 1.2)
    + Math.min(specialtyMatchCount * 5, 10),
  );
  const effectiveMajor = majorSum + (rolesEnabled ? elementPoints(party[0], majorCounter) * 0.2 : 0);
  const effectiveMinor = minorSum + (rolesEnabled ? elementPoints(party[0], minorCounter) * 0.2 : 0);
  const captainFit = Math.round(
    70 * Math.min(effectiveMajor / 14, 1.2)
    + 30 * Math.min(effectiveMinor / 8, 1.2)
    + Math.min(specialtyMatchCount * 5, 10),
  );
  const viceEligible = rolesEnabled && party[1].specialty_code === site.specialty_code ? 5 : 0;
  const fitPercent = Math.min(130, captainFit + viceEligible);
  const breakdown = {
    baseFitPercent,
    captainBonusPercent: captainFit - baseFitPercent,
    viceBonusPercent: fitPercent - captainFit,
    roleBonusEnabled: rolesEnabled,
  };

  if (fitPercent <= 30) {
    return { ...breakdown, fitPercent, fitGrade: 'VULNERABLE', fitGradeKo: '취약', traceContribution: 1, specialtyMatchCount };
  }
  if (fitPercent <= 59) {
    return { ...breakdown, fitPercent, fitGrade: 'NORMAL', fitGradeKo: '보통', traceContribution: 1, specialtyMatchCount };
  }
  if (fitPercent <= 89) {
    return { ...breakdown, fitPercent, fitGrade: 'STABLE', fitGradeKo: '안정', traceContribution: 2, specialtyMatchCount };
  }
  return { ...breakdown, fitPercent, fitGrade: 'STRONG', fitGradeKo: '강인', traceContribution: 3, specialtyMatchCount };
}
