import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export interface AchievementGrantHolder {
  student_achievement_id: number;
  student_id: number;
  student_name: string;
  achieved_at: string;
  is_equipped: boolean;
}

export interface AchievementGrantStudent {
  student_id: number;
  student_name: string;
  has_achievement: boolean;
}

export interface AchievementGrantPanel {
  achievement: {
    id: number;
    achievement_uid: string;
    name: string;
    grade: string;
    is_secret: boolean;
    is_active: boolean;
  };
  holder_count: number;
  holders: AchievementGrantHolder[];
  students: AchievementGrantStudent[];
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

export const achievementA4Rpc = {
  approveSpecialReport: (
    supabase: SupabaseClient,
    input: { p_application_id: number },
  ) => callRpc<number>(supabase, 'teacher_approve_achievement_special_report', input),

  teacherGrantPanel: (
    supabase: SupabaseClient,
    classroomId: number,
    achievementId: number,
  ) => callRpc<AchievementGrantPanel>(supabase, 'teacher_get_achievement_grant_panel', {
    p_classroom_id: classroomId,
    p_achievement_id: achievementId,
  }),

  teacherGrantDirect: (
    supabase: SupabaseClient,
    input: { p_student_id: number; p_achievement_id: number; p_reason?: string | null },
  ) => callRpc<number>(supabase, 'teacher_grant_achievement_direct', input),

  teacherRevokeDirect: (
    supabase: SupabaseClient,
    input: { p_student_achievement_id: number; p_reason: string },
  ) => callRpc<void>(supabase, 'teacher_revoke_achievement_direct', input),
};
