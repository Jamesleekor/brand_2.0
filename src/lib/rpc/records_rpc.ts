import type { SupabaseClient } from '@supabase/supabase-js';

export interface LegacyAssetHistoryRow {
  source_row: number;
  event_date: string;
  source_timestamp_local: string | null;
  occurred_at: string | null;
  brand_name_snapshot: string | null;
  raw_bv_delta: number;
  bv_delta: number;
  gold_delta: number;
  balance_after_bv: number;
  balance_after_gold: number;
  memo: string | null;
  normalization_note: string | null;
}

export interface LegacyAssetHistoryBoard {
  total: number;
  rows: LegacyAssetHistoryRow[];
}

export const recordsRpc = {
  myLegacyAssetHistory: async (
    supabase: SupabaseClient,
    input: { p_limit?: number; p_offset?: number } = {},
  ): Promise<LegacyAssetHistoryBoard> => {
    const { data, error } = await supabase.rpc('student_get_my_legacy_asset_history', input);
    if (error) throw error;
    return (data ?? { total: 0, rows: [] }) as LegacyAssetHistoryBoard;
  },
};
