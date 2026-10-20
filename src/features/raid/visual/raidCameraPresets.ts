import type { RaidVisualCameraConfig, RaidVisualCameraPreset } from './raidVisualTypes';

export const RAID_CAMERA_PRESETS: ReadonlyArray<{
  value: RaidVisualCameraPreset; label: string; description: string;
}> = [
  { value: 'LOCKED', label: 'LOCKED · 고정', description: '기본 카메라 고정. 이벤트 반응만 켤 수 있습니다.' },
  { value: 'MAJESTIC_PUSH', label: 'MAJESTIC_PUSH · 위엄', description: '아주 느리고 미세한 확대' },
  { value: 'HEAVY_BREATH', label: 'HEAVY_BREATH · 중량감', description: '느린 호흡처럼 확대·축소와 작은 상하 움직임' },
  { value: 'TIDAL_FLOAT', label: 'TIDAL_FLOAT · 해류', description: '물 위를 떠다니듯 느린 상하 부유와 미세 기울임' },
  { value: 'VOID_UNSTABLE', label: 'VOID_UNSTABLE · 공간 왜곡', description: '작은 드리프트, 기울임, 미세 확대' },
];

export function normalizeRaidCameraConfig(value: unknown): RaidVisualCameraConfig {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const preset = RAID_CAMERA_PRESETS.some((entry) => entry.value === input.preset)
    ? input.preset as RaidVisualCameraPreset : 'LOCKED';
  return { preset, event_reactions: typeof input.event_reactions === 'boolean' ? input.event_reactions : true };
}
