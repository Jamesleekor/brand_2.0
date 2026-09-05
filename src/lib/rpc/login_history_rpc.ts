import type { SupabaseClient } from '@supabase/supabase-js';

export type LoginHistoryEventType = 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGOUT';
export type LoginHistoryActorKind = 'STUDENT' | 'TEACHER';

export interface LoginHistoryRow {
  id: number;
  classroom_id: number;
  student_id: number | null;
  student_name_snapshot: string | null;
  actor_kind: LoginHistoryActorKind;
  event_type: LoginHistoryEventType;
  occurred_at: string;
  session_id: string | null;
  device_type: string | null;
  browser: string | null;
  is_test_account: boolean;
}

export interface LoginHistoryStudentSummary {
  student_id: number;
  student_name: string;
  is_test_account: boolean;
  total_login_count: number;
  total_login_days: number;
  last_login_at: string | null;
}

export interface LoginHistorySummary {
  login_success_count: number;
  logout_count: number;
  login_failed_count: number;
  distinct_student_count: number;
  distinct_student_login_days: number;
}

export interface TeacherLoginHistoryBoard {
  tracking_start_at: string | null;
  total_count: number;
  limit: number;
  offset: number;
  summary: LoginHistorySummary;
  student_summaries: LoginHistoryStudentSummary[];
  rows: LoginHistoryRow[];
}

export interface TeacherLoginHistoryInput {
  p_classroom_id: number;
  p_limit?: number;
  p_offset?: number;
  p_student_id?: number | null;
  p_event_type?: LoginHistoryEventType | null;
  p_date_from?: string | null;
  p_date_to?: string | null;
  p_include_test?: boolean;
}

export async function getTeacherLoginHistory(
  supabase: SupabaseClient,
  input: TeacherLoginHistoryInput,
): Promise<TeacherLoginHistoryBoard> {
  const { data, error } = await supabase.rpc('teacher_get_login_history', input);
  if (error) throw error;

  return (data ?? {
    tracking_start_at: null,
    total_count: 0,
    limit: input.p_limit ?? 50,
    offset: input.p_offset ?? 0,
    summary: {
      login_success_count: 0,
      logout_count: 0,
      login_failed_count: 0,
      distinct_student_count: 0,
      distinct_student_login_days: 0,
    },
    student_summaries: [],
    rows: [],
  }) as TeacherLoginHistoryBoard;
}
