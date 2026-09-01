import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import type { BuffDirection, BuffValueUnit, CollectionClass } from './character_c4b_rpc';

export interface StudentCollectionMemberRow {
  member_id: number;
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  resource_kind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
  resource_url: string | null;
  emoji: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
  is_owned: boolean;
  sort_order: number;
}

export interface StudentCollectionRewardRow {
  reward_id: number;
  effect_code: string;
  display_name: string;
  domain_code: string;
  value_unit: BuffValueUnit;
  direction: BuffDirection;
  effect_value: number;
  cap_value: number;
}

export interface StudentCharacterSetProgressRow {
  collection_id: number;
  collection_uid: string;
  collection_name: string;
  description: string | null;
  collection_class: CollectionClass;
  is_visible: boolean;
  sort_order: number;
  required_count: number;
  owned_count: number;
  is_complete: boolean;
  member_status: StudentCollectionMemberRow[];
  reward_preview: StudentCollectionRewardRow[];
}

export interface StudentBuffSourceCollection {
  collection_id: number;
  collection_uid: string;
  collection_name: string;
  collection_class: CollectionClass;
  effect_value: number;
}

export interface StudentActiveBuffRow {
  effect_code: string;
  display_name: string;
  domain_code: string;
  value_unit: BuffValueUnit;
  direction: BuffDirection;
  raw_value: number;
  cap_value: number;
  applied_value: number;
  source_count: number;
  source_collections: StudentBuffSourceCollection[];
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

export const characterC4CRpc = {
  myCollectionProgress: (supabase: SupabaseClient) =>
    callRpc<StudentCharacterSetProgressRow[]>(supabase, 'get_my_character_collection_progress'),

  myActiveBuffs: (supabase: SupabaseClient) =>
    callRpc<StudentActiveBuffRow[]>(supabase, 'get_my_active_buffs'),
};
