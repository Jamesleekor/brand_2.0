import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/secondary_job_public_request_schemas';

async function call<TIn, TOut>(supabase: SupabaseClient, name: string, schema: z.ZodTypeAny, input: unknown): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  const { data, error } = await supabase.rpc(name, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOut };
}

export type PublicEligibleJob = { id: number; job_name: string; category: string };
export type StudentPublicRequest = {
  id: number; title: string; description: string; reward_gold: number;
  eligibility_type: S.PublicRequestEligibility; required_category: string | null; required_job_name: string | null;
  max_assignees: number; due_at: string; status: S.PublicRequestStatus; published_at: string | null;
  active_assignees: number; completed_count: number; eligible_jobs: PublicEligibleJob[];
  blocked_reason: string | null; can_accept: boolean;
};
export type StudentPublicAssignment = {
  id: number; request_id: number; request_title: string; reward_gold: number; due_at: string; request_status: S.PublicRequestStatus;
  job_name: string; job_category: string; status: S.PublicAssignmentStatus; accepted_at: string; submitted_at: string | null;
  reviewed_at: string | null; teacher_feedback: string | null; reward_transaction_id: number | null; completed_at: string | null;
  cancelled_at: string | null; cancel_reason: string | null; latest_submission: string | null; revision_count: number;
};
export type StudentPublicBoard = { server_now: string; employment_freeze: boolean; requests: StudentPublicRequest[]; my_assignments: StudentPublicAssignment[] };

export type TeacherPublicRequest = Omit<StudentPublicRequest, 'eligible_jobs' | 'blocked_reason' | 'can_accept'> & {
  created_at: string; updated_at: string; cancel_reason: string | null; submitted_count: number;
};
export type TeacherPublicAssignment = {
  id: number; request_id: number; request_title: string; reward_gold: number; due_at: string; student_id: number; student_name: string;
  job_name: string; job_category: string; status: S.PublicAssignmentStatus; accepted_at: string; submitted_at: string | null; reviewed_at: string | null;
  teacher_feedback: string | null; reward_transaction_id: number | null; completed_at: string | null; cancelled_at: string | null;
  cancel_reason: string | null; latest_submission: string | null; revision_count: number;
};
export type TeacherJobOption = { job_name: string; category: string; holders: number };
export type TeacherPublicBoard = { server_now: string; requests: TeacherPublicRequest[]; assignments: TeacherPublicAssignment[]; job_options: TeacherJobOption[] };

export const secondaryJobPublicStudentRpc = {
  board: (c: SupabaseClient) => call<{}, StudentPublicBoard>(c, 'student_get_secondary_job_public_board', S.NoArgsSchema, {}),
  accept: (c: SupabaseClient, i: S.AcceptRequestInput) => call<S.AcceptRequestInput, number>(c, 'student_accept_secondary_job_public_request', S.AcceptRequestSchema, i),
  submit: (c: SupabaseClient, i: S.SubmitRequestInput) => call<S.SubmitRequestInput, number>(c, 'student_submit_secondary_job_public_request', S.SubmitRequestSchema, i),
  cancelAssignment: (c: SupabaseClient, i: S.CancelAssignmentInput) => call<S.CancelAssignmentInput, null>(c, 'student_cancel_secondary_job_public_assignment', S.CancelAssignmentSchema, i),
};

export const secondaryJobPublicTeacherRpc = {
  board: (c: SupabaseClient, classroomId: number) => call<{ p_classroom_id: number }, TeacherPublicBoard>(c, 'teacher_get_secondary_job_public_requests', S.TeacherBoardSchema, { p_classroom_id: classroomId }),
  create: (c: SupabaseClient, i: S.CreatePublicRequestInput) => call<S.CreatePublicRequestInput, number>(c, 'teacher_create_secondary_job_public_request', S.CreatePublicRequestSchema, i),
  update: (c: SupabaseClient, i: S.UpdatePublicRequestInput) => call<S.UpdatePublicRequestInput, null>(c, 'teacher_update_secondary_job_public_request', S.UpdatePublicRequestSchema, i),
  publish: (c: SupabaseClient, i: S.IdInput) => call<S.IdInput, null>(c, 'teacher_publish_secondary_job_public_request', S.IdSchema, i),
  remove: (c: SupabaseClient, i: S.IdInput) => call<S.IdInput, null>(c, 'teacher_delete_secondary_job_public_request', S.IdSchema, i),
  close: (c: SupabaseClient, i: S.IdInput) => call<S.IdInput, null>(c, 'teacher_close_secondary_job_public_request', S.IdSchema, i),
  reopen: (c: SupabaseClient, i: S.IdInput) => call<S.IdInput, null>(c, 'teacher_reopen_secondary_job_public_request', S.IdSchema, i),
  extend: (c: SupabaseClient, i: S.ExtendDeadlineInput) => call<S.ExtendDeadlineInput, null>(c, 'teacher_extend_secondary_job_public_request', S.ExtendDeadlineSchema, i),
  cancelRequest: (c: SupabaseClient, i: S.CancelRequestInput) => call<S.CancelRequestInput, null>(c, 'teacher_cancel_secondary_job_public_request', S.CancelRequestSchema, i),
  cancelAssignment: (c: SupabaseClient, i: S.TeacherCancelAssignmentInput) => call<S.TeacherCancelAssignmentInput, null>(c, 'teacher_cancel_secondary_job_public_assignment', S.TeacherCancelAssignmentSchema, i),
  review: (c: SupabaseClient, i: S.ReviewAssignmentInput) => call<S.ReviewAssignmentInput, number | null>(c, 'teacher_review_secondary_job_public_assignment', S.ReviewAssignmentSchema, i),
};
