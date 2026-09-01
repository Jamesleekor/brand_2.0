import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export interface AchievementHelperStatus {
  can_access: boolean;
  student_id: number;
  classroom_id: number;
  role_source: string;
}

export interface AchievementHelperEvidenceDetail {
  label?: string;
  value?: unknown;
}

export interface AchievementHelperSystemEvidence {
  available?: boolean;
  source?: string;
  metric_code?: string;
  measured_value?: unknown;
  target_value?: unknown;
  op?: string;
  result?: string;
  snapshot_at?: string;
  details?: AchievementHelperEvidenceDetail[];
  note?: string;
  snapshot?: Record<string, unknown>;
  error?: string;
}

export interface AchievementHelperQueueItem {
  application_id: number;
  student_id: number;
  student_name: string;
  achievement_id: number;
  achievement_uid: string;
  achievement_name: string;
  condition_text: string;
  grade: string;
  evaluation_type: 'QUANTITATIVE' | 'QUALITATIVE';
  auto_eval_enabled: boolean;
  evidence_text: string | null;
  system_evidence: AchievementHelperSystemEvidence | null;
  status: string;
  created_at: string;
  my_recommendation: 'APPROVE' | 'REJECT' | null;
  my_memo: string | null;
  my_recommended_at: string | null;
}

export interface AchievementSpecialReport {
  id: number;
  evidence_text: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  evaluated_at: string | null;
  revealed_achievement_name: string | null;
}

export interface AchievementHelperRecommendation {
  helper_student_id: number;
  helper_name: string;
  recommendation: 'APPROVE' | 'REJECT';
  memo: string | null;
  updated_at: string;
}

export interface TeacherAchievementReviewItem {
  id: number;
  application_kind: 'NORMAL' | 'SPECIAL_REPORT';
  student_id: number;
  student_name: string;
  achievement_id: number | null;
  achievement_uid: string | null;
  achievement_name: string | null;
  achievement_grade: string | null;
  condition_text: string | null;
  evaluation_type: 'QUANTITATIVE' | 'QUALITATIVE' | null;
  helper_review_enabled: boolean;
  reward_bv: number;
  reward_gold: number;
  reward_crystal: number;
  active_holder_count: number;
  evidence_text: string | null;
  evidence_data: Record<string, unknown> | null;
  status: string;
  created_at: string;
  helper_recommendations: AchievementHelperRecommendation[];
}

export interface SecretAchievementCandidate {
  id: number;
  achievement_uid: string;
  name: string;
  condition_text: string;
  grade: string;
}

export interface TeacherAchievementReviewBoard {
  applications: TeacherAchievementReviewItem[];
  secret_candidates: SecretAchievementCandidate[];
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

export const achievementA3Rpc = {
  helperStatus: (supabase: SupabaseClient) =>
    callRpc<AchievementHelperStatus>(supabase, 'student_get_achievement_helper_status'),

  helperQueue: (supabase: SupabaseClient) =>
    callRpc<AchievementHelperQueueItem[]>(supabase, 'student_get_achievement_helper_queue'),

  helperRecommend: (
    supabase: SupabaseClient,
    input: { p_application_id: number; p_recommendation: 'APPROVE' | 'REJECT' | ''; p_memo?: string | null },
  ) => callRpc<void>(supabase, 'helper_recommend_achievement', input),

  submitSpecialReport: (
    supabase: SupabaseClient,
    input: { p_student_id: number; p_evidence_text: string },
  ) => callRpc<number>(supabase, 'submit_achievement_special_report', input),

  mySpecialReports: (supabase: SupabaseClient) =>
    callRpc<AchievementSpecialReport[]>(supabase, 'student_get_achievement_special_reports'),

  teacherReviewBoard: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<TeacherAchievementReviewBoard>(supabase, 'teacher_get_achievement_review_queue', {
      p_classroom_id: classroomId,
    }),

  teacherMatchSpecialReport: (
    supabase: SupabaseClient,
    input: { p_application_id: number; p_achievement_id: number | null },
  ) => callRpc<void>(supabase, 'teacher_match_achievement_special_report', input),

  teacherRejectSpecialReport: (
    supabase: SupabaseClient,
    input: { p_application_id: number; p_reason: string },
  ) => callRpc<void>(supabase, 'teacher_reject_achievement_special_report', input),

  teacherSetHelperReviewEnabled: (
    supabase: SupabaseClient,
    input: { p_achievement_id: number; p_enabled: boolean },
  ) => callRpc<void>(supabase, 'teacher_set_achievement_helper_review_enabled', input),
};
