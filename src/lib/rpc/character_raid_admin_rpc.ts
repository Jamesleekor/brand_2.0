import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

// CHARACTER_COMBAT_PROFILE_ADMIN_V2

export type CharacterRaidElement = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';

export type CharacterExpeditionSpecialty = 'RUINS' | 'NATURE' | 'SANCTUARY';

export interface CharacterElementProfileInput {
  element_budget: number;
  primary_element: CharacterRaidElement;
  primary_points: number;
  secondary_element: CharacterRaidElement | null;
  secondary_points: number;
}

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
  specialty_code: CharacterExpeditionSpecialty | null;
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
    callRpc<TeacherCharacterRaidStatRow[]>(supabase, 'teacher_get_character_combat_profiles'),

  update: (
    supabase: SupabaseClient,
    characterId: number,
    raidPower: number,
    raidCritBonusBp: number,
    elementProfile: CharacterElementProfileInput | null,
    specialtyCode: CharacterExpeditionSpecialty | null,
  ) =>
    callRpc<{ character_id: number }>(supabase, 'teacher_update_character_combat_profile', {
      p_character_id: characterId,
      p_raid_power: raidPower,
      p_raid_crit_bonus_bp: raidCritBonusBp,
      p_element_profile: elementProfile,
      p_specialty_code: specialtyCode,
    }),
};
