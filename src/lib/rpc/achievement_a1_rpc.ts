import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type AchievementGrade = '희귀' | '유니크' | '에픽' | '초월' | '유일' | '히든';
export type AchievementEvaluationType = 'QUANTITATIVE' | 'QUALITATIVE';

export interface AchievementFirstAchiever {
  student_id: number;
  name: string;
  brand_name: string | null;
  achieved_at: string;
}

export interface AchievementCatalogRow {
  id: number;
  achievement_uid: string | null;
  name: string;
  condition_text: string;
  hint: string | null;
  grade: AchievementGrade;
  is_secret: boolean;
  reward_bv: number;
  reward_gold: number;
  reward_crystal: number;
  evaluation_type: AchievementEvaluationType | null;
  auto_eval_enabled: boolean;
  is_earned: boolean;
  achieved_at: string | null;
  student_achievement_id: number | null;
  is_equipped: boolean;
  is_pending: boolean;
  application_status: string | null;
  first_achieved_at: string | null;
  first_achievers: AchievementFirstAchiever[];
}


export interface EquippedAchievementTitle {
  student_id: number;
  title: string | null;
  grade: AchievementGrade | null;
}

export interface AchievementMasterRow {
  id: number;
  achievement_uid: string;
  classroom_id: number | null;
  is_global: boolean;
  name: string;
  condition_text: string;
  grade: AchievementGrade;
  is_secret: boolean;
  hint: string | null;
  evaluation_type: AchievementEvaluationType;
  evaluation_query: Record<string, unknown> | null;
  auto_eval_enabled: boolean;
  helper_review_enabled: boolean;
  achievement_score: number;
  reward_bv: number;
  reward_gold: number;
  reward_crystal: number;
  sort_order: number;
  is_active: boolean;
  revealed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AchievementMasterEvent {
  id: number;
  classroom_id: number | null;
  achievement_id: number | null;
  event_type: 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' | 'VISIBILITY_CHANGE' | 'SECRET_REVEALED' | 'AUTO_RULE_CHANGED';
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface AchievementMasterInput {
  p_classroom_id?: number;
  p_achievement_id?: number;
  p_achievement_uid?: string;
  p_name: string;
  p_condition_text: string;
  p_grade: AchievementGrade;
  p_evaluation_type: AchievementEvaluationType;
  p_is_secret: boolean;
  p_hint?: string | null;
  p_achievement_score: number;
  p_reward_bv: number;
  p_reward_gold: number;
  p_reward_crystal: number;
  p_auto_eval_enabled: boolean;
  p_evaluation_query?: Record<string, unknown> | null;
  p_sort_order: number;
  p_reason?: string | null;
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

export const achievementA1Rpc = {
  studentCatalog: (supabase: SupabaseClient) =>
    callRpc<AchievementCatalogRow[]>(supabase, 'student_get_achievement_catalog'),

  classroomTitles: (supabase: SupabaseClient) =>
    callRpc<EquippedAchievementTitle[]>(supabase, 'student_get_classroom_achievement_titles'),

  teacherMaster: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<AchievementMasterRow[]>(supabase, 'teacher_get_achievement_master', {
      p_classroom_id: classroomId,
    }),

  teacherSuggestUid: (supabase: SupabaseClient, classroomId: number, prefix: string) =>
    callRpc<string>(supabase, 'teacher_suggest_achievement_uid', {
      p_classroom_id: classroomId,
      p_prefix: prefix,
    }),

  teacherCreate: (supabase: SupabaseClient, input: AchievementMasterInput & { p_classroom_id: number; p_achievement_uid: string }) => {
    const { p_reason: _reason, p_achievement_id: _id, ...args } = input;
    return callRpc<number>(supabase, 'teacher_create_achievement', args as Record<string, unknown>);
  },

  teacherUpdate: (supabase: SupabaseClient, input: AchievementMasterInput & { p_achievement_id: number }) => {
    const { p_classroom_id: _classroom, p_achievement_uid: _uid, ...args } = input;
    return callRpc<void>(supabase, 'teacher_update_achievement', args as Record<string, unknown>);
  },

  teacherSetActive: (
    supabase: SupabaseClient,
    input: { p_achievement_id: number; p_active: boolean; p_reason?: string | null },
  ) => callRpc<void>(supabase, 'teacher_set_achievement_active', input),

  teacherEvents: (supabase: SupabaseClient, classroomId: number, limit = 50) =>
    callRpc<AchievementMasterEvent[]>(supabase, 'teacher_get_achievement_master_events', {
      p_classroom_id: classroomId,
      p_limit: limit,
    }),
};
