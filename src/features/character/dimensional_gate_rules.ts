import type { DimensionalGateRelationStage } from '@/lib/rpc/dimensional_gate_rpc';

export const DIMENSIONAL_GATE_RELATION_LABEL: Record<DimensionalGateRelationStage, string> = {
  LOCKED: '미영입',
  STRANGER: '낯섦',
  INTEREST: '관심',
  AFFECTION: '호감',
  TRUST: '신뢰',
};

export const DIMENSIONAL_GATE_RELATION_THRESHOLD = {
  INTEREST: 40,
  AFFECTION: 70,
  TRUST: 100,
} as const;

export function relationStageFromAffinity(affinity: number): Exclude<DimensionalGateRelationStage, 'LOCKED'> {
  if (affinity >= 100) return 'TRUST';
  if (affinity >= 70) return 'AFFECTION';
  if (affinity >= 40) return 'INTEREST';
  return 'STRANGER';
}
