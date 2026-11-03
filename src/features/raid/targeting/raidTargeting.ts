// RAID_TARGETING_V1_20261103
export type RaidTargetingMode = 'BODY' | 'DOMAIN' | 'ANCHOR';

export interface RaidTargetingZone {
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: 'RECT' | 'CIRCLE' | string;
  name?: string | null;
}

export interface RaidTargetingPublicConfig {
  version: number;
  mode: RaidTargetingMode;
  hint_text: string;
  miss_text: string;
  show_initial_guide_ms: number;
  show_miss_guide_ms: number;
  miss_repeat_threshold: number;
  primary_zone: RaidTargetingZone | null;
  valid: boolean;
}

export interface RaidTargetingSavePayload {
  mode: RaidTargetingMode;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  hint_text?: string;
  miss_text?: string;
  show_initial_guide_ms?: number;
  show_miss_guide_ms?: number;
  miss_repeat_threshold?: number;
}

export interface RaidTargetingPatternLike {
  pattern_type?: string | null;
  state?: Record<string, unknown> | null;
}

const BODY_DEFAULT: RaidTargetingPublicConfig = {
  version: 1,
  mode: 'BODY',
  hint_text: '',
  miss_text: '',
  show_initial_guide_ms: 1500,
  show_miss_guide_ms: 900,
  miss_repeat_threshold: 3,
  primary_zone: null,
  valid: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function modeFromUnknown(value: unknown): RaidTargetingMode {
  const mode = String(value ?? '').toUpperCase();
  return mode === 'DOMAIN' || mode === 'ANCHOR' ? mode : 'BODY';
}

function normalizeZone(value: unknown): RaidTargetingZone | null {
  const row = asRecord(value);
  const x = finiteNumber(row.x, Number.NaN);
  const y = finiteNumber(row.y, Number.NaN);
  const width = finiteNumber(row.width, Number.NaN);
  const height = finiteNumber(row.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  return {
    x,
    y,
    width,
    height,
    shape: typeof row.shape === 'string' ? row.shape : 'RECT',
    name: typeof row.name === 'string' ? row.name : null,
  };
}

export function normalizeRaidTargeting(value: unknown): RaidTargetingPublicConfig {
  const row = asRecord(value);
  const mode = modeFromUnknown(row.mode);
  if (mode === 'BODY') return { ...BODY_DEFAULT };

  const primaryZone = normalizeZone(row.primary_zone);
  return {
    version: 1,
    mode,
    hint_text:
      typeof row.hint_text === 'string' && row.hint_text.trim()
        ? row.hint_text
        : mode === 'DOMAIN'
          ? '보스가 지배하는 영역을 공격하세요!'
          : '보스의 핵심 표적을 공격하세요!',
    miss_text:
      typeof row.miss_text === 'string' && row.miss_text.trim()
        ? row.miss_text
        : mode === 'DOMAIN'
          ? '빛나는 공격 영역을 노리세요!'
          : '빛나는 핵심 부위를 노리세요!',
    show_initial_guide_ms: Math.max(0, Math.min(5000, finiteNumber(row.show_initial_guide_ms, 1500))),
    show_miss_guide_ms: Math.max(0, Math.min(3000, finiteNumber(row.show_miss_guide_ms, 900))),
    miss_repeat_threshold: Math.max(2, Math.min(8, Math.round(finiteNumber(row.miss_repeat_threshold, 3)))),
    primary_zone: primaryZone,
    valid: typeof row.valid === 'boolean' ? row.valid : primaryZone !== null,
  };
}

export function pointInRaidTargetZone(zone: RaidTargetingZone | null | undefined, x: number, y: number): boolean {
  if (!zone) return false;
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

function runtimeTargetContains(value: unknown, x: number, y: number): boolean {
  const row = asRecord(value);
  const currentHp = row.current_hp == null ? 1 : finiteNumber(row.current_hp, 0);
  if (currentHp <= 0) return false;
  return pointInRaidTargetZone(normalizeZone(row), x, y);
}

function anyRuntimeTargetContains(value: unknown, x: number, y: number): boolean {
  return Array.isArray(value) && value.some((target) => runtimeTargetContains(target, x, y));
}

export function pointInActivePatternTarget(
  pattern: RaidTargetingPatternLike | null | undefined,
  x: number,
  y: number,
): boolean {
  const type = String(pattern?.pattern_type ?? '').toUpperCase();
  const state = asRecord(pattern?.state);

  if (type === 'WEAK_POINT') {
    const weakZone: RaidTargetingZone = {
      x: finiteNumber(state.x, 0.42),
      y: finiteNumber(state.y, 0.30),
      width: finiteNumber(state.width, 0.16),
      height: finiteNumber(state.height, 0.22),
    };
    return pointInRaidTargetZone(weakZone, x, y);
  }
  if (type === 'DOT') return runtimeTargetContains(state.interrupt_target, x, y);
  if (type === 'MULTI_CORE') return anyRuntimeTargetContains(state.cores, x, y);
  if (type === 'SPLIT_TARGET') return anyRuntimeTargetContains(state.targets, x, y);
  if (type === 'REGEN') return runtimeTargetContains(state.core, x, y);
  if (type === 'SEAL') return anyRuntimeTargetContains(state.seals, x, y);
  return false;
}

export function isRaidTapAllowedLocally(
  targetingValue: unknown,
  pattern: RaidTargetingPatternLike | null | undefined,
  x: number,
  y: number,
): boolean {
  const targeting = normalizeRaidTargeting(targetingValue);
  if (targeting.mode === 'BODY') return true;
  if (pointInActivePatternTarget(pattern, x, y)) return true;
  // Live-class fail-safe mirrors the server: corrupt/missing C/D zone does not brick combat.
  if (!targeting.valid || !targeting.primary_zone) return true;
  return pointInRaidTargetZone(targeting.primary_zone, x, y);
}

export function raidTargetingModeLabel(mode: RaidTargetingMode): string {
  if (mode === 'DOMAIN') return '지배 영역 공격';
  if (mode === 'ANCHOR') return '핵심 표적 공격';
  return '직접 공격';
}

export function raidTargetingInstruction(value: unknown): string {
  const targeting = normalizeRaidTargeting(value);
  if (targeting.mode === 'DOMAIN') return '빛나는 지배 영역을 터치하여 공격';
  if (targeting.mode === 'ANCHOR') return '빛나는 핵심 표적을 터치하여 공격';
  return '보스를 직접 터치하여 공격';
}
