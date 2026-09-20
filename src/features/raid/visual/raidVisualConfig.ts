import type { RaidVisualConfigV1, RaidVisualStateVideoTrigger } from './raidVisualTypes';

const STATE_TRIGGERS: RaidVisualStateVideoTrigger[] = ['GROGGY', 'ENRAGE', 'BOTH'];

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

export function readRaidVisualV2(
  metadata: Record<string, unknown> | null | undefined,
): RaidVisualConfigV1 {
  const root = isRecord(metadata) ? metadata : {};
  const rawVisual = isRecord(root.visual_v2) ? root.visual_v2 : {};
  const rawMedia = isRecord(rawVisual.media) ? rawVisual.media : {};

  return {
    ...rawVisual,
    version: 1,
    media: {
      ...rawMedia,
      action_video_url: nullableString(rawMedia.action_video_url),
      state_video_url: nullableString(rawMedia.state_video_url),
      state_video_trigger: normalizeStateTrigger(rawMedia.state_video_trigger),
      crossfade_ms: normalizeCrossfadeMs(rawMedia.crossfade_ms),
    },
  } as RaidVisualConfigV1;
}

export function mergeRaidVisualV2Metadata(
  metadata: Record<string, unknown> | null | undefined,
  media: {
    actionVideoUrl: string;
    stateVideoUrl: string;
    stateVideoTrigger: RaidVisualStateVideoTrigger;
  },
): Record<string, unknown> {
  const baseMetadata = isRecord(metadata) ? metadata : {};
  const currentVisual = readRaidVisualV2(baseMetadata);

  return {
    ...baseMetadata,
    visual_v2: {
      ...currentVisual,
      version: 1,
      media: {
        ...currentVisual.media,
        action_video_url: nullableString(media.actionVideoUrl),
        state_video_url: nullableString(media.stateVideoUrl),
        state_video_trigger: normalizeStateTrigger(media.stateVideoTrigger),
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
