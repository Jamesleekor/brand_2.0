import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

// CHARACTER_RAID_STATS_ADMIN_V1

export type CharacterRaidElement = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';

export interface TeacherCharacterRaidStatRow {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  is_active: boolean;
  sort_order: number;
  raid_power: number;
  raid_crit_bonus_bp: number;
  element_budget: number | null;
  primary_element: CharacterRaidElement | null;
  primary_points: number | null;
  secondary_element: CharacterRaidElement | null;
  secondary_points: number | null;
}

export interface TeacherCharacterRaidUpdateRow {
  character_id: number;
  raid_power: number;
  raid_crit_bonus_bp: number;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const characterRaidAdminRpc = {
  list: (supabase: SupabaseClient) =>
    callRpc<TeacherCharacterRaidStatRow[]>(supabase, 'teacher_get_character_raid_stats'),

  update: (
    supabase: SupabaseClient,
    characterId: number,
    raidPower: number,
    raidCritBonusBp: number,
    reason: string | null = null,
  ) =>
    callRpc<TeacherCharacterRaidUpdateRow[]>(supabase, 'teacher_update_character_raid_stats', {
      p_character_id: characterId,
      p_raid_power: raidPower,
      p_raid_crit_bonus_bp: raidCritBonusBp,
      p_reason: reason,
    }),
};
