import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export interface WelfareManualSpendRow {
  movement_id: number;
  amount: number;
  reason: string;
  created_at: string;
}

export interface WelfareFundBoard {
  classroom_id: number;
  fund_id: number | null;
  current_balance: number;
  total_collected: number;
  total_distributed: number;
  official_student_count: number;
  recent_spends: WelfareManualSpendRow[];
  server_now: string;
}

export interface WelfareSpendResult {
  success: true;
  movement_id: number;
  amount: number;
  reason: string;
  balance_before: number;
  balance_after: number;
  spent_at: string;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const welfareAdminRpc = {
  getBoard: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<WelfareFundBoard>(supabase, 'teacher_get_welfare_fund_board', {
      p_classroom_id: classroomId,
    }),

  spend: (
    supabase: SupabaseClient,
    classroomId: number,
    amount: number,
    reason: string,
  ) => callRpc<WelfareSpendResult>(supabase, 'teacher_spend_welfare_fund', {
    p_classroom_id: classroomId,
    p_amount: amount,
    p_reason: reason.trim(),
  }),
};
