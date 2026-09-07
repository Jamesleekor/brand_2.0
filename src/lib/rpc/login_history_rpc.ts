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

export interface AppAccessDailyRow {
  access_date: string;
  student_id: number;
  student_name: string;
  first_seen_at: string;
  last_seen_at: string;
  signal_count: number;
  evidence_sources: string[];
  has_direct_app_signal: boolean;
  has_backfill_signal: boolean;
  last_device_type: string | null;
  last_browser: string | null;
}

export interface AppAccessDailySummary {
  student_days: number;
  distinct_students: number;
  direct_student_days: number;
  backfilled_student_days: number;
}

export interface TeacherAppAccessDailyBoard {
  summary: AppAccessDailySummary;
  rows: AppAccessDailyRow[];
}

export interface TeacherAppAccessDailyInput {
  p_classroom_id: number;
  p_date_from?: string | null;
  p_date_to?: string | null;
  p_student_id?: number | null;
}

export async function getTeacherAppAccessDaily(
  supabase: SupabaseClient,
  input: TeacherAppAccessDailyInput,
): Promise<TeacherAppAccessDailyBoard> {
  const { data, error } = await supabase.rpc('teacher_get_app_access_daily', input);
  if (error) throw error;

  return (data ?? {
    summary: {
      student_days: 0,
      distinct_students: 0,
      direct_student_days: 0,
      backfilled_student_days: 0,
    },
    rows: [],
  }) as TeacherAppAccessDailyBoard;
}
