import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export interface PrimaryJobBoardStudent {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  display_name: string;
  role: string;
  job_id: number | null;
  job_name: string | null;
  daily_wage: number | null;
  assigned_area: string | null;
  assigned_at: string | null;
  is_active: boolean;
}

export interface PrimaryJobBoardSummary {
  student_count: number;
  assigned_count: number;
  unassigned_count: number;
  total_daily_wage: number;
  average_daily_wage: number;
}

export interface PrimaryJobAdminBoard {
  classroom_id: number;
  students: PrimaryJobBoardStudent[];
  summary: PrimaryJobBoardSummary;
  server_now: string;
}

export interface PrimaryJobSaveRow {
  student_id: number;
  job_name: string;
  daily_wage: number | null;
  assigned_area: string | null;
}

export interface PrimaryJobSaveResult {
  success: true;
  classroom_id: number;
  changed_count: number;
  assigned_or_updated_count: number;
  released_count: number;
  saved_at: string;
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

export const primaryJobAdminRpc = {
  getBoard: (supabase: SupabaseClient) =>
    callRpc<PrimaryJobAdminBoard>(supabase, 'get_primary_job_admin_board'),

  saveBoard: (supabase: SupabaseClient, assignments: PrimaryJobSaveRow[]) =>
    callRpc<PrimaryJobSaveResult>(supabase, 'teacher_save_primary_job_board', {
      p_assignments: assignments,
    }),
};
