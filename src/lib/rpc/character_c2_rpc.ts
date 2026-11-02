import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type CharacterResourceKind = 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';

export interface StudentCharacterCollectionRow {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  description: string | null;
  resource_kind: CharacterResourceKind;
  resource_url: string | null;
  emoji: string | null;
  full_image_url: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
  sort_order: number;
  is_owned: boolean;
  is_equipped: boolean;
  policy_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | null;
  is_recruitable: boolean;
  is_eligible: boolean;
  source_condition_text: string | null;
  /** 레이드 공명력. UI 표시는 “공명력”. */
  raid_power?: number;
  /** 편린 자체 치명타율 보너스(bp). 100bp = +1.00%p */
  raid_crit_bonus_bp?: number;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const characterC2Rpc = {
  myCollection: (supabase: SupabaseClient) =>
    callRpc<StudentCharacterCollectionRow[]>(supabase, 'get_my_character_collection_status'),

  equip: (
    supabase: SupabaseClient,
    characterId: number | null,
    visualVariantNo: 1 | 2 | 3 = 1,
  ) => callRpc<void>(supabase, 'student_equip_character_visual', {
    p_character_id: characterId,
    p_visual_variant_no: visualVariantNo,
  }),
};
