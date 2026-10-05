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
}

function elementPoints(character: ExpeditionCharacterBoardRow, element: ExpeditionElementCode) {
  return (character.primary_element === element ? character.primary_points : 0)
    + (character.secondary_element === element ? character.secondary_points : 0);
}

export function calculateExpeditionFitClient(
  site: ExpeditionSiteBoardRow,
  party: ExpeditionCharacterBoardRow[],
): ClientExpeditionFit | null {
  if (party.length !== 3 || new Set(party.map((x) => x.character_id)).size !== 3) return null;

  const majorSum = party.reduce((sum, x) => sum + elementPoints(x, site.major_element), 0);
  const minorSum = party.reduce((sum, x) => sum + elementPoints(x, site.minor_element), 0);
  const specialtyMatchCount = party.filter((x) => x.specialty_code === site.specialty_code).length;
  const fitPercent = Math.round(
    70 * Math.min(majorSum / 14, 1.2)
    + 30 * Math.min(minorSum / 8, 1.2)
    + Math.min(specialtyMatchCount * 5, 10),
  );

  if (fitPercent <= 30) {
    return { fitPercent, fitGrade: 'VULNERABLE', fitGradeKo: '취약', traceContribution: 1, specialtyMatchCount };
  }
  if (fitPercent <= 59) {
    return { fitPercent, fitGrade: 'NORMAL', fitGradeKo: '보통', traceContribution: 1, specialtyMatchCount };
  }
  if (fitPercent <= 89) {
    return { fitPercent, fitGrade: 'STABLE', fitGradeKo: '안정', traceContribution: 2, specialtyMatchCount };
  }
  return { fitPercent, fitGrade: 'STRONG', fitGradeKo: '강인', traceContribution: 3, specialtyMatchCount };
}
