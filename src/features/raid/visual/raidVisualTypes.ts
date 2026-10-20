import type { RaidCinematicConfig } from './raidCinematicPresets';

export type RaidVisualStateVideoTrigger = 'GROGGY' | 'ENRAGE' | 'BOTH';
export type RaidVisualPlaybackState = 'IDLE' | 'ACTION' | 'STATE';

export type RaidVisualFxPreset = 'NONE' | 'WIND_FEATHER' | 'FIRE_EMBER' | 'WATER_SPRAY' | 'LIGHT_PRISM' | 'DARK_VOID';
export type RaidVisualFxIntensity = 'LOW' | 'MEDIUM' | 'HIGH';
export type RaidVisualCameraPreset = 'LOCKED' | 'MAJESTIC_PUSH' | 'HEAVY_BREATH' | 'TIDAL_FLOAT' | 'VOID_UNSTABLE';

export interface RaidVisualCameraConfig {
  preset: RaidVisualCameraPreset;
  event_reactions: boolean;
}

export interface RaidVisualFxConfig {
  preset: RaidVisualFxPreset;
  intensity: RaidVisualFxIntensity;
}

export interface RaidVisualMediaConfig {
  action_video_url: string | null;
  state_video_url: string | null;
  state_video_trigger: RaidVisualStateVideoTrigger;
  crossfade_ms: number;
}

export interface RaidVisualConfigV1 {
  version: 1;
  media: RaidVisualMediaConfig;
  fx?: RaidVisualFxConfig;
  camera?: RaidVisualCameraConfig;
  cinematic_v2?: RaidCinematicConfig;
  preset_key?: string | null;
  [key: string]: unknown;
}
