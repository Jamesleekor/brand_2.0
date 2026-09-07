import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import type { OwnedFont } from './fontTypes';

export async function purchaseMyCosmetic(
  supabase: SupabaseClient,
  itemId: number,
  pricingId: number,
): Promise<RpcResult<number>> {
  const { data, error } = await supabase.rpc('student_purchase_cosmetic', {
    p_item_id: itemId,
    p_pricing_id: pricingId,
  });

  if (error) {
    return {
      success: false,
      type: 'SERVER',
      error: error.message,
      code: error.code,
    };
  }

  return { success: true, data: Number(data) };
}

export async function selectMyCosmetic(
  supabase: SupabaseClient,
  category: string,
  ownershipId: number | null,
): Promise<RpcResult<void>> {
  const { error } = await supabase.rpc('student_set_cosmetic_selection', {
    p_category: category,
    p_ownership_id: ownershipId,
  });

  if (error) {
    return {
      success: false,
      type: 'SERVER',
      error: error.message,
      code: error.code,
    };
  }

  return { success: true, data: undefined };
}

/**
 * Self-scoped font ownership lookup.
 * The authenticated student's id is resolved inside Postgres via current_student_id();
 * the browser never supplies a student_id for this query.
 */
export async function fetchOwnedFonts(supabase: SupabaseClient): Promise<OwnedFont[]> {
  const { data, error } = await supabase.rpc('student_get_my_fonts');
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    ownershipId: Number(row.ownership_id),
    itemId: Number(row.item_id),
    itemUid: String(row.item_uid),
    name: String(row.name),
    isEquipped: Boolean(row.is_equipped),
  }));
}
