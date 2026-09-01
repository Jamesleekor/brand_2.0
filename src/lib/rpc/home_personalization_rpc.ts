import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export interface HomeBackgroundSelection {
  item_id: number;
  ownership_id: number;
  name: string;
  resource_url: string;
}

export interface HomeShowcaseSlot {
  slot_no: 1 | 2 | 3;
  character_id: number | null;
  character_uid: string | null;
  name: string | null;
  epithet: string | null;
  resource_kind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE' | null;
  resource_url: string | null;
  emoji: string | null;
  full_image_url: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
}

export interface HomePersonalization {
  background: HomeBackgroundSelection | null;
  showcase_slots: HomeShowcaseSlot[];
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

export const homePersonalizationRpc = {
  get: (supabase: SupabaseClient) =>
    callRpc<HomePersonalization>(supabase, 'student_get_home_personalization'),

  setShowcaseSlot: (
    supabase: SupabaseClient,
    input: { p_slot_no: 1 | 2 | 3; p_character_id: number | null },
  ) =>
    callRpc<HomePersonalization>(supabase, 'student_set_home_showcase_slot', input),
};
