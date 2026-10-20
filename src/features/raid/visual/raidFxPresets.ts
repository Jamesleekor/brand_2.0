import type {
  RaidVisualFxConfig,
  RaidVisualFxIntensity,
  RaidVisualFxPreset,
} from './raidVisualTypes';

export const RAID_FX_PRESETS: ReadonlyArray<{
  value: RaidVisualFxPreset;
  label: string;
  description: string;
}> = [
  { value: 'NONE', label: 'NONE · 효과 없음', description: '추가 입자 효과 없이 기존 보스 미디어만 표시' },
  { value: 'WIND_FEATHER', label: 'WIND_FEATHER · 바람과 깃털', description: '드문 깃털과 가벼운 바람 먼지가 대각선으로 흐릅니다.' },
  { value: 'FIRE_EMBER', label: 'FIRE_EMBER · 잿가루와 불티', description: '작은 잿가루와 불티가 천천히 위로 떠오릅니다.' },
  { value: 'WATER_SPRAY', label: 'WATER_SPRAY · 물안개와 물방울', description: '옅은 물방울이 흐르며 간헐적인 물보라를 암시합니다.' },
  { value: 'LIGHT_PRISM', label: 'LIGHT_PRISM · 신성한 빛', description: '작고 부드러운 빛 입자가 느리게 반짝입니다.' },
  { value: 'DARK_VOID', label: 'DARK_VOID · 심연의 먼지', description: '검은 먼지와 보라 입자가 중심을 향해 미세하게 흐릅니다.' },
];

export const RAID_FX_INTENSITIES: ReadonlyArray<RaidVisualFxIntensity> = [
  'LOW', 'MEDIUM', 'HIGH',
];

export const RAID_FX_INTENSITY_MULTIPLIER: Record<RaidVisualFxIntensity, number> = {
  LOW: 0.65,
  MEDIUM: 1,
  HIGH: 1.3,
};

export function normalizeRaidFxConfig(input: unknown): RaidVisualFxConfig {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

  const preset = RAID_FX_PRESETS.some((option) => option.value === raw.preset)
    ? (raw.preset as RaidVisualFxPreset)
    : 'NONE';
  const intensity = RAID_FX_INTENSITIES.includes(raw.intensity as RaidVisualFxIntensity)
    ? (raw.intensity as RaidVisualFxIntensity)
    : 'MEDIUM';
  return { preset, intensity };
}

export function getRaidFxParticleCount(fx: RaidVisualFxConfig): number {
  if (fx.preset === 'NONE') return 0;
  const base = fx.preset === 'WATER_SPRAY' ? 23 : fx.preset === 'FIRE_EMBER' ? 25 : 21;
  return Math.min(40, Math.max(12, Math.round(base * RAID_FX_INTENSITY_MULTIPLIER[fx.intensity])));
}
