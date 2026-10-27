import type { RaidCinematicConfig } from './raidCinematicPresets';

// Legacy 3-slot metadata compatibility only. New saves use the 7-slot model below.
export type RaidVisualStateVideoTrigger = 'GROGGY' | 'ENRAGE' | 'BOTH';
export type RaidVisualPlaybackState =
  | 'IDLE'
  | 'BASIC_ATTACK'
  | 'ENRAGE_BASIC_ATTACK'
  | 'SPECIAL_PATTERN'
  | 'ENRAGE_SPECIAL_PATTERN'
  | 'GROGGY'
  | 'ENRAGE';

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
  // 7-slot media model. IDLE continues to live in raid_phases.loop_video_url.
  video_slot_version?: number;
  basic_attack_video_url: string | null;
  enrage_basic_attack_video_url: string | null;
  special_pattern_video_url: string | null;
  enrage_special_pattern_video_url: string | null;
  groggy_video_url: string | null;
  enrage_video_url: string | null;
  crossfade_ms: number;

  // Legacy 3-slot keys are retained so old Raid metadata remains readable.
  action_video_url?: string | null;
  state_video_url?: string | null;
  state_video_trigger?: RaidVisualStateVideoTrigger;
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
