import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/guild4_schemas';

async function call<TIn, TOut>(supabase: SupabaseClient, name: string, schema: z.ZodType<TIn>, input: unknown): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  const { data, error } = await supabase.rpc(name, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOut };
}

export type Guild4ObligationStatus = 'REQUIRED' | 'EXCUSED';
export type Guild4RoundState = 'OPEN' | 'CLOSED' | 'FINALIZED';

export type Guild4StudentObligation = {
  obligation_id: number;
  target_student_id: number;
  target_name: string;
  obligation_status: Guild4ObligationStatus;
  latest_review_revision_number?: number | null;
  latest_score?: number | null;
  latest_comment?: string | null;
  latest_submitted_at?: string | null;
};

export type Guild4StudentRound = {
  round_id: number;
  mission_id: number;
  mission_title: string;
  guild_name: string;
  lifecycle_state: Guild4RoundState;
  deadline_at: string;
  source_finalized_at?: string | null;
  monthly_eligible?: boolean;
  required_count: number;
  submitted_required_count: number;
  my_peer_points?: number | null;
  peer_result_explanation?: string | null;
  obligations: Guild4StudentObligation[];
};

export type Guild4MonthlySummary = {
  year_month: string;
  status: string;
  peer_points?: number | null;
  max_points: number;
  explanation?: string | null;
};

export type Guild4TeacherRoundListItem = {
  round_id: number;
  mission_id: number;
  mission_title: string;
  guild_id: number;
  guild_name: string;
  lifecycle_state: Guild4RoundState;
  deadline_at: string;
  source_finalized_at?: string | null;
  participant_count: number;
  required_obligation_count: number;
  submitted_required_count: number;
  excused_count: number;
};

export type Guild4TeacherRoundDetail = {
  round: Record<string, any>;
  mission: Record<string, any> | null;
  participants: Array<{ participant_id: number; student_id: number; student_name: string }>;
  obligations: Array<{
    obligation_id: number;
    reviewer_student_id: number;
    reviewer_name: string;
    target_student_id: number;
    target_name: string;
    obligation_status: Guild4ObligationStatus;
    latest_revision_number?: number | null;
    latest_submitted_at?: string | null;
    current_exception_reason?: string | null;
    latest_review?: { revision_id: number; revision_number: number; score: number; comment: string; submitted_at: string } | null;
  }>;
  review_revision_history: Array<Record<string, any>>;
  score_rollups: Array<Record<string, any>>;
  penalties: Array<Record<string, any>>;
  audit_history: Array<Record<string, any>>;
};

export const guild4StudentRpc = {
  rounds: (c: SupabaseClient) => call<{}, Guild4StudentRound[]>(c, 'student_get_guild4_peer_review_rounds', S.NoArgsSchema, {}),
  monthlySummary: (c: SupabaseClient) => call<{}, Guild4MonthlySummary[]>(c, 'student_get_guild4_peer_monthly_summary', S.NoArgsSchema, {}),
  submit: (c: SupabaseClient, input: S.StudentSubmitInput) => call<S.StudentSubmitInput, Record<string, any>>(c, 'student_submit_guild4_peer_review', S.StudentSubmitSchema, input),
};

export const guild4TeacherRpc = {
  sync: (c: SupabaseClient) => call<{}, { created: number; already_existing: number }>(c, 'teacher_sync_guild4_peer_review_rounds', S.NoArgsSchema, {}),
  list: (c: SupabaseClient) => call<{}, Guild4TeacherRoundListItem[]>(c, 'teacher_list_guild4_peer_review_rounds', S.NoArgsSchema, {}),
  detail: (c: SupabaseClient, input: S.RoundIdInput) => call<S.RoundIdInput, Guild4TeacherRoundDetail>(c, 'teacher_get_guild4_peer_review_round_detail', S.RoundIdSchema, input),
  updateDeadline: (c: SupabaseClient, input: S.DeadlineInput) => call<S.DeadlineInput, Record<string, any>>(c, 'teacher_update_guild4_peer_review_deadline', S.DeadlineSchema, input),
  setExcused: (c: SupabaseClient, input: S.ExceptionInput) => call<S.ExceptionInput, Record<string, any>>(c, 'teacher_set_guild4_peer_review_excused', S.ExceptionSchema, input),
  close: (c: SupabaseClient, input: S.CloseInput) => call<S.CloseInput, Record<string, any>>(c, 'teacher_close_guild4_peer_review_round', S.CloseSchema, input),
  finalize: (c: SupabaseClient, input: S.FinalizeInput) => call<S.FinalizeInput, Record<string, any>>(c, 'teacher_finalize_guild4_peer_review_round', S.FinalizeSchema, input),
  retryPenalty: (c: SupabaseClient, input: S.PenaltyIdInput) => call<S.PenaltyIdInput, Record<string, any>>(c, 'teacher_retry_guild4_peer_review_penalty', S.PenaltyIdSchema, input),
  waivePenalty: (c: SupabaseClient, input: S.WaivePenaltyInput) => call<S.WaivePenaltyInput, Record<string, any>>(c, 'teacher_waive_guild4_peer_review_penalty', S.WaivePenaltySchema, input),
  correctReview: (c: SupabaseClient, input: S.CorrectReviewInput) => call<S.CorrectReviewInput, Record<string, any>>(c, 'teacher_correct_guild4_peer_review', S.CorrectReviewSchema, input),
  correctException: (c: SupabaseClient, input: S.CorrectExceptionInput) => call<S.CorrectExceptionInput, Record<string, any>>(c, 'teacher_correct_guild4_peer_review_exception', S.CorrectExceptionSchema, input),
};

export function guild4RpcError(result: unknown, fallback = '동료평가 작업을 완료하지 못했습니다.') {
  if (result && typeof result === 'object' && 'error' in result) {
    const value = (result as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}
