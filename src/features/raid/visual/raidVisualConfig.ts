import type { RaidVisualConfigV1, RaidVisualFxConfig, RaidVisualCameraConfig, RaidVisualMediaConfig, RaidVisualStateVideoTrigger } from './raidVisualTypes';
import { normalizeRaidCameraConfig } from './raidCameraPresets';
import { normalizeRaidFxConfig } from './raidFxPresets';
import { normalizeRaidCinematicConfig } from './raidCinematicPresets';
import type { RaidCinematicConfig } from './raidCinematicPresets';

const STATE_TRIGGERS: RaidVisualStateVideoTrigger[] = ['GROGGY', 'ENRAGE', 'BOTH'];
const MODERN_MEDIA_KEYS = [
  'basic_attack_video_url',
  'enrage_basic_attack_video_url',
  'special_pattern_video_url',
  'enrage_special_pattern_video_url',
  'groggy_video_url',
  'enrage_video_url',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStateTrigger(value: unknown): RaidVisualStateVideoTrigger {
  return STATE_TRIGGERS.includes(value as RaidVisualStateVideoTrigger)
    ? (value as RaidVisualStateVideoTrigger)
    : 'BOTH';
}

function normalizeCrossfadeMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 240;
  return Math.max(0, Math.min(2000, Math.round(numeric)));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function resolveRaidVisualMedia(value: unknown): RaidVisualMediaConfig {
  const rawMedia = isRecord(value) ? value : {};
  const legacyAction = nullableString(rawMedia.action_video_url);
  const legacyState = nullableString(rawMedia.state_video_url);
  const legacyStateTrigger = normalizeStateTrigger(rawMedia.state_video_trigger);
  const numericVersion = Number(rawMedia.video_slot_version);
  const modernSlots =
    (Number.isFinite(numericVersion) && numericVersion >= 2) ||
    MODERN_MEDIA_KEYS.some((key) => hasOwn(rawMedia, key));

  return {
    ...rawMedia,
    ...(modernSlots ? { video_slot_version: 2 } : {}),
    basic_attack_video_url: modernSlots
      ? nullableString(rawMedia.basic_attack_video_url)
      : legacyAction,
    enrage_basic_attack_video_url: modernSlots
      ? nullableString(rawMedia.enrage_basic_attack_video_url)
      : null,
    special_pattern_video_url: modernSlots
      ? nullableString(rawMedia.special_pattern_video_url)
      : legacyAction,
    enrage_special_pattern_video_url: modernSlots
      ? nullableString(rawMedia.enrage_special_pattern_video_url)
      : null,
    groggy_video_url: modernSlots
      ? nullableString(rawMedia.groggy_video_url)
      : legacyState && (legacyStateTrigger === 'GROGGY' || legacyStateTrigger === 'BOTH')
        ? legacyState
        : null,
    enrage_video_url: modernSlots
      ? nullableString(rawMedia.enrage_video_url)
      : legacyState && (legacyStateTrigger === 'ENRAGE' || legacyStateTrigger === 'BOTH')
        ? legacyState
        : null,
    action_video_url: legacyAction,
    state_video_url: legacyState,
    state_video_trigger: legacyStateTrigger,
    crossfade_ms: normalizeCrossfadeMs(rawMedia.crossfade_ms),
  } as RaidVisualMediaConfig;
}

export function readRaidVisualV2(
  metadata: Record<string, unknown> | null | undefined,
): RaidVisualConfigV1 {
  const root = isRecord(metadata) ? metadata : {};
  const rawVisual = isRecord(root.visual_v2) ? root.visual_v2 : {};
  const rawMedia = isRecord(rawVisual.media) ? rawVisual.media : {};

  return {
    ...rawVisual,
    version: 1,
    fx: { ...(isRecord(rawVisual.fx) ? rawVisual.fx : {}), ...normalizeRaidFxConfig(rawVisual.fx) },
    camera: { ...(isRecord(rawVisual.camera) ? rawVisual.camera : {}), ...normalizeRaidCameraConfig(rawVisual.camera) },
    cinematic_v2: normalizeRaidCinematicConfig(rawVisual.cinematic_v2),
    media: resolveRaidVisualMedia(rawMedia),
  } as RaidVisualConfigV1;
}

export function mergeRaidVisualV2Metadata(
  metadata: Record<string, unknown> | null | undefined,
  media: {
    basicAttackVideoUrl: string;
    enrageBasicAttackVideoUrl: string;
    specialPatternVideoUrl: string;
    enrageSpecialPatternVideoUrl: string;
    groggyVideoUrl: string;
    enrageVideoUrl: string;
    fx?: RaidVisualFxConfig;
    camera?: RaidVisualCameraConfig;
    cinematic?: RaidCinematicConfig;
  },
): Record<string, unknown> {
  const baseMetadata = isRecord(metadata) ? metadata : {};
  const currentVisual = readRaidVisualV2(baseMetadata);

  return {
    ...baseMetadata,
    visual_v2: {
      ...currentVisual,
      version: 1,
      fx: { ...(currentVisual.fx ?? {}), ...normalizeRaidFxConfig(media.fx ?? currentVisual.fx) },
      camera: { ...(currentVisual.camera ?? {}), ...normalizeRaidCameraConfig(media.camera ?? currentVisual.camera) },
      cinematic_v2: normalizeRaidCinematicConfig(media.cinematic ?? currentVisual.cinematic_v2),
      media: {
        ...currentVisual.media,
        video_slot_version: 2,
        basic_attack_video_url: nullableString(media.basicAttackVideoUrl),
        enrage_basic_attack_video_url: nullableString(media.enrageBasicAttackVideoUrl),
        special_pattern_video_url: nullableString(media.specialPatternVideoUrl),
        enrage_special_pattern_video_url: nullableString(media.enrageSpecialPatternVideoUrl),
        groggy_video_url: nullableString(media.groggyVideoUrl),
        enrage_video_url: nullableString(media.enrageVideoUrl),
        crossfade_ms: currentVisual.media.crossfade_ms,
      },
    },
  };
}

export function isValidOptionalHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
