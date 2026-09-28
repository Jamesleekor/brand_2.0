export type RaidVisualStateVideoTrigger = 'GROGGY' | 'ENRAGE' | 'BOTH';

export interface RaidVisualMediaConfig {
  action_video_url: string | null;
  state_video_url: string | null;
  state_video_trigger: RaidVisualStateVideoTrigger;
  crossfade_ms: number;
}

export interface RaidVisualConfigV1 {
  version: 1;
  media: RaidVisualMediaConfig;
  fx?: Record<string, unknown>;
  camera?: Record<string, unknown>;
  preset_key?: string | null;
  [key: string]: unknown;
}
