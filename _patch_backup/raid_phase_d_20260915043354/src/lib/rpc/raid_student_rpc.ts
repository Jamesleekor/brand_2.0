import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type RaidElement = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';
export type RaidStatus =
  | 'DRAFT'
  | 'LOBBY_OPEN'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ARCHIVED';

export interface ActiveRaidSummary {
  id: number;
  title: string;
  boss_name: string;
  boss_description: string | null;
  boss_element: RaidElement;
  status: RaidStatus;
  max_hp: number;
  current_hp: number;
  hp_ratio: number;
  lobby_open_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  chat_enabled: boolean;
  phase_preview: {
    phase_no: number;
    image_url: string | null;
    loop_video_url: string | null;
  } | null;
}

export interface RaidLobbyMe {
  student_id: number;
  name: string;
  brand_name: string | null;
  equipped_character_id: number | null;
  equipped_character_name: string | null;
  equipped_character_image_url: string | null;
  guild_id: number | null;
  guild_name: string | null;
  guild_logo_url: string | null;
}

export interface RaidLobbyMessage {
  id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  message: string;
  created_at: string;
}

export interface RaidLobbySnapshot {
  raid: {
    id: number;
    title: string;
    boss_name: string;
    boss_description: string | null;
    boss_element: RaidElement;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    chat_enabled: boolean;
    chat_slow_mode_seconds: number;
    lobby_open_at: string | null;
    starts_at: string | null;
    ends_at: string | null;
  };
  me: RaidLobbyMe;
  roster: RaidLobbyMe[];
  recent_messages: RaidLobbyMessage[];
}

export interface RaidBattleState {
  raid: {
    id: number;
    title: string;
    boss_name: string;
    boss_element: RaidElement;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    hp_ratio: number;
    phase: {
      id: number;
      phase_no: number;
      image_url: string | null;
      loop_video_url: string | null;
    } | null;
  };
  me: {
    participant_id: number;
    raid_power: number;
    base_crit_bp: number;
    shard_crit_bp: number;
    collection_crit_bp: number;
    final_crit_bp: number;
    total_damage: number;
    accepted_tap_count: number;
    crit_count: number;
    attack_blocked: boolean;
  };
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return {
      success: false,
      type: 'SERVER',
      error: error.message,
      code: error.code,
    };
  }
  return { success: true, data: data as T };
}

export const raidStudentRpc = {
  active: (supabase: SupabaseClient) =>
    callRpc<ActiveRaidSummary | null>(supabase, 'get_active_raid'),

  lobby: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidLobbySnapshot>(supabase, 'get_raid_lobby_snapshot', {
      p_raid_id: raidId,
    }),

  sendLobbyMessage: (
    supabase: SupabaseClient,
    raidId: number,
    message: string,
  ) =>
    callRpc<RaidLobbyMessage>(supabase, 'send_raid_lobby_message', {
      p_raid_id: raidId,
      p_message: message,
    }),

  battleState: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidBattleState>(supabase, 'get_raid_battle_state', {
      p_raid_id: raidId,
    }),
};
