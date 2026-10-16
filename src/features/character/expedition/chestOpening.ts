export type ChestOpeningPhase = 'CHARGING' | 'BURST' | 'REVEALED';

export function getChestOpeningConfig(tier: string) {
  if (tier === 'RARE') {
    return { label: '희귀', accent: '#D9B6FF', glow: '183, 115, 255', chargeMs: 1450, burstMs: 650 };
  }
  if (tier === 'INTERMEDIATE') {
    return { label: '중급', accent: '#8DEBFF', glow: '73, 208, 242', chargeMs: 1200, burstMs: 520 };
  }
  return { label: '일반', accent: '#FFD58A', glow: '255, 190, 82', chargeMs: 900, burstMs: 420 };
}

export function nextChestOpeningPhase(
  phase: ChestOpeningPhase,
  chargeComplete: boolean,
  resultReady: boolean,
  reducedMotion: boolean,
): ChestOpeningPhase {
  if (!resultReady) return phase;
  if (reducedMotion) return 'REVEALED';
  if (phase === 'CHARGING' && chargeComplete) return 'BURST';
  return phase;
}
