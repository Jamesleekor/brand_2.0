import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type AchievementA5Grade = '희귀' | '유니크' | '에픽' | '히든' | '유일' | '초월';

export type AchievementA5GradeBreakdown = Record<AchievementA5Grade, number>;

export interface AchievementA5Period {
  start_date: string;
  end_date: string;
  start_at: string;
  end_exclusive_at: string;
}

export interface AchievementA5Summary {
  achievement_count: number;
  achievement_score: number;
  students_with_achievement: number;
  grade_breakdown: AchievementA5GradeBreakdown;
}

export interface AchievementA5StudentStatistics {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  display_name: string;
  period_count: number;
  period_score: number;
  total_count: number;
  total_score: number;
  period_score_rank: number;
  period_count_rank: number;
  total_score_rank: number;
  total_count_rank: number;
  period_grade_breakdown: AchievementA5GradeBreakdown;
  total_grade_breakdown: AchievementA5GradeBreakdown;
}

export interface AchievementA5Statistics {
  classroom_id: number;
  timezone: 'Asia/Seoul' | string;
  generated_at: string;
  period: AchievementA5Period;
  active_student_count: number;
  period_summary: AchievementA5Summary;
  total_summary: AchievementA5Summary;
  students: AchievementA5StudentStatistics[];
}

export interface AchievementA5StudentGrant {
  student_achievement_id: number;
  achievement_id: number;
  achievement_uid: string;
  achievement_name: string;
  grade: AchievementA5Grade;
  achievement_score: number;
  achieved_at: string;
  is_revoked: boolean;
  revoked_at: string | null;
  revoke_reason: string | null;
  application_id: number | null;
  is_equipped: boolean;
}

export interface AchievementA5AuditEvent {
  event_id: number;
  student_achievement_id: number | null;
  achievement_id: number;
  achievement_uid: string;
  achievement_name: string;
  grade: AchievementA5Grade;
  event_type: string;
  evaluation_method: string | null;
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface AchievementA5StudentHistory {
  classroom_id: number;
  student: {
    student_id: number;
    student_name: string;
    brand_name: string | null;
    display_name: string;
    role: string;
    transferred_at: string | null;
  };
  timezone: 'Asia/Seoul' | string;
  period: AchievementA5Period;
  period_active_summary: {
    achievement_count: number;
    achievement_score: number;
  };
  grants: AchievementA5StudentGrant[];
  audit_events: AchievementA5AuditEvent[];
  limit: number;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const achievementA5Rpc = {
  teacherStatistics: (
    supabase: SupabaseClient,
    input: { p_classroom_id: number; p_start_date?: string | null; p_end_date?: string | null },
  ) => callRpc<AchievementA5Statistics>(supabase, 'teacher_get_achievement_statistics', input),

  teacherStudentHistory: (
    supabase: SupabaseClient,
    input: {
      p_classroom_id: number;
      p_student_id: number;
      p_start_date?: string | null;
      p_end_date?: string | null;
      p_limit?: number;
    },
  ) => callRpc<AchievementA5StudentHistory>(supabase, 'teacher_get_achievement_student_history', input),
};
