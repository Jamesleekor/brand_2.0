// RAID_V15_E5_ADMIN_RPC
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type RaidV15PatternType =
  | 'WEAK_POINT' | 'BREAK' | 'ENRAGE'
  | 'ABSORB' | 'REFLECT' | 'ULTIMATE' | 'BOSS_STRIKE'
  | 'DOT' | 'SHIELD' | 'MULTI_CORE' | 'SPLIT_TARGET'
  | 'REGEN' | 'SEAL' | 'DAMAGE_CHECK';

export type RaidV15TriggerKind =
  | 'TIME_SECONDS' | 'HP_RATIO' | 'BARRIER_RATIO'
  | 'TIME_REMAINING' | 'AFTER_PATTERN' | 'RANDOM_WINDOW' | 'MANUAL';

export interface RaidV15CombatConfig {
  enabled: boolean;
  barrier_base_per_adventurer: number;
  barrier_resonance_factor: number;
  presence_window_seconds: number;
  default_groggy_seconds: number;
  default_groggy_multiplier: number;
  enrage_boss_damage_multiplier: number;
  enrage_player_damage_multiplier: number;
  boss_attack_interval_seconds: number;
  boss_attack_telegraph_seconds: number;
  boss_attack_fixed_damage: number;
  boss_attack_barrier_ratio: number;
  boss_attack_name: string;
  metadata?: Record<string, unknown>;
}

export interface RaidV15Pattern {
  id?: number;
  client_key?: string;
  seq: number;
  name: string;
  pattern_type: RaidV15PatternType;
  trigger_kind: RaidV15TriggerKind;
  trigger_value: number;
  duration_seconds: number;
  config: Record<string, unknown>;
  is_enabled: boolean;
}

export interface RaidV15CombatResponse {
  config: RaidV15CombatConfig | null;
  patterns: RaidV15Pattern[];
}

export interface RaidV15AudioProfile {
  raid_id: number;
  lobby_bgm_url: string | null;
  battle_bgm_url: string | null;
  enrage_bgm_url: string | null;
  raid_start_sfx_url: string | null;
  raid_success_bgm_url: string | null;
  raid_failure_bgm_url: string | null;
  normal_hit_sfx_url: string | null;
  crit_hit_sfx_url: string | null;
  powerful_hit_sfx_url: string | null;
  devastating_hit_sfx_url: string | null;
  break_start_sfx_url: string | null;
  break_success_sfx_url: string | null;
  break_fail_sfx_url: string | null;
  barrier_hit_sfx_url: string | null;
  barrier_critical_sfx_url: string | null;
  master_volume: number;
  bgm_volume: number;
  sfx_volume: number;
  configured: boolean;
}

async function callRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const raidV15AdminRpc = {
  combat: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidV15CombatResponse>(supabase, 'teacher_get_raid_combat_config', { p_raid_id: raidId }),

  saveCombat: (supabase: SupabaseClient, raidId: number, payload: { config?: RaidV15CombatConfig; patterns?: RaidV15Pattern[] }) =>
    callRpc<RaidV15CombatResponse>(supabase, 'teacher_save_raid_combat_config', { p_raid_id: raidId, p_payload: payload }),

  audio: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidV15AudioProfile>(supabase, 'teacher_get_raid_audio_profile', { p_raid_id: raidId }),

  saveAudio: (supabase: SupabaseClient, raidId: number, payload: Omit<RaidV15AudioProfile, 'raid_id' | 'configured'>) =>
    callRpc<RaidV15AudioProfile>(supabase, 'teacher_save_raid_audio_profile', { p_raid_id: raidId, p_payload: payload }),

  triggerPattern: (supabase: SupabaseClient, raidId: number, patternId: number) =>
    callRpc<{ event?: string; pattern_run_id?: number; pattern_type?: string; pattern_name?: string }>(
      supabase,
      'teacher_trigger_raid_pattern',
      { p_raid_id: raidId, p_pattern_id: patternId },
    ),
};
