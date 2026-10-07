// BRAND_ASSET_ARREARS_RPC_V1
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AssetArrearsDetail {
  arrear_id: number;
  reason: string;
  assessed_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  status: 'UNPAID' | 'PARTIAL';
  created_at: string;
}

export interface AssetArrearsStudent {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  current_gold: number;
  arrear_count: number;
  outstanding_total: number;
  details: AssetArrearsDetail[];
}

export interface AssetArrearsBoard {
  classroom_id: number;
  student_count: number;
  total_outstanding: number;
  students: AssetArrearsStudent[];
}

export interface AssetArrearsCollectResult {
  student_id: number;
  collection_type: 'MANUAL';
  collected_total: number;
  collection_count: number;
  wallet_gold_after: number;
  remaining_outstanding: number;
  current_gold_before: number;
  auction_reserved_gold: number;
  equalization_reserved_gold: number;
  available_gold_before: number;
}

export const assetArrearsRpc = {
  async getState(supabase: SupabaseClient, classroomId: number): Promise<AssetArrearsBoard> {
    const { data, error } = await supabase.rpc('teacher_get_asset_arrears_state', {
      p_classroom_id: classroomId,
    });
    if (error) throw new Error(error.message);

    const fallback: AssetArrearsBoard = {
      classroom_id: classroomId,
      student_count: 0,
      total_outstanding: 0,
      students: [],
    };
    return (data ?? fallback) as unknown as AssetArrearsBoard;
  },

  async collectStudent(
    supabase: SupabaseClient,
    classroomId: number,
    studentId: number,
  ): Promise<AssetArrearsCollectResult> {
    const { data, error } = await supabase.rpc('teacher_collect_student_asset_arrears', {
      p_classroom_id: classroomId,
      p_student_id: studentId,
    });
    if (error) throw new Error(error.message);
    return data as unknown as AssetArrearsCollectResult;
  },
};
