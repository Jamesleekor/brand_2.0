import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/newbie_support_schemas';

async function call<TOut>(supabase: SupabaseClient, name: string, schema: z.ZodTypeAny, input: unknown): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  const { data, error } = await supabase.rpc(name, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOut };
}

export type EffectiveProgramStatus = 'DRAFT'|'ACTIVE'|'SCHEDULED'|'IN_PROGRESS'|'REVIEWING'|'READY_TO_COMPLETE'|'COMPLETION_PENDING'|'COMPLETED'|'EXPIRED'|'CANCELLED';
export type MentorHelpType = 'EXPLANATION'|'COACHING'|'CHECKING'|'TRANSACTION'|'OTHER';

export type NewbieSummary = {
  server_today_kst: string;
  my_program: null | { program_id:number; effective_status:EffectiveProgramStatus; approved_count:number; total_count:number; regular_recovered_bv:number; regular_pool_bv:number; completion_bonus_bv:number; start_on:string; end_on:string };
  mentoring: Array<{ program_id:number; target_student_id:number; target_student_name:string; target_brand_name:string|null; effective_status:EffectiveProgramStatus; approved_count:number; total_count:number; my_valid_help_count:number; base_reward_eligible:boolean; start_on:string; end_on:string }>;
};

export type EvidenceCandidate = { evidence_ref_id:number; occurred_at:string|null; primary_label:string; secondary_label:string|null; summary:string|null; meta?:Record<string,unknown> };
export type ProgramMentor = { mentor_assignment_id:number; student_id:number; student_name:string; brand_name:string|null; valid_help_count:number; base_reward_eligible:boolean; is_best:boolean|null };
export type QuestSlotClaim = { claim_id:number; status:'PENDING'|'APPROVED'|'REJECTED'|'REVOKED'|'CANCELLED'; evidence_ref_id:number; student_note:string|null; requested_at:string; review_note:string|null; reward_bv:number|null; reviewed_at:string|null };
export type NewbieQuest = {
  program_quest_id:number; quest_code:string; title:string; description:string; target_count:number; weight_per_completion:number; sort_order:number;
  approved_count:number; pending_count:number;
  slots:Array<{ slot_id:number; occurrence_no:number; reward_bv:number; claim:QuestSlotClaim|null }>;
  evidence_candidates:EvidenceCandidate[];
};
export type NewbieStudentBoard = {
  server_today_kst:string;
  program:null|{ program_id:number; status:string; effective_status:EffectiveProgramStatus; missed_opportunities:number; bv_per_opportunity:number; total_restorable_bv:number; regular_pool_bv:number; completion_bonus_bv:number; start_on:string; end_on:string; approved_count:number; total_count:number; regular_recovered_bv:number; completion_requested_at:string|null; completed_at:string|null };
  quests:NewbieQuest[];
  mentors:ProgramMentor[];
};
export type MentorBoard = { server_today_kst:string; assignments:Array<{ mentor_assignment_id:number; program_id:number; effective_status:EffectiveProgramStatus; target_student_id:number; target_student_name:string; target_brand_name:string|null; start_on:string; end_on:string; approved_count:number; total_count:number; my_valid_help_count:number; required_help_count:number; base_reward_eligible:boolean; help_history:Array<{claim_id:number;help_type:MentorHelpType;status:string;created_at:string;validated_at:string|null;quest_title:string}> }> };
export type MonthBvDelta = { month:string; delta_bv:number; server_today_kst:string };

export type TeacherNewbieBoard = {
  server_today_kst:string;
  students:Array<{student_id:number;name:string;brand_name:string|null;enrolled_at:string}>;
  public_requests:Array<{request_id:number;title:string;status:string;due_at:string}>;
  programs:Array<any>;
  claims:Array<any>;
};

export const newbieSupportRpc = {
  studentSummary: (c:SupabaseClient) => call<NewbieSummary>(c,'student_get_newbie_support_summary',S.NoArgsSchema,{}),
  studentBoard: (c:SupabaseClient) => call<NewbieStudentBoard>(c,'student_get_newbie_support_board',S.NoArgsSchema,{}),
  mentorBoard: (c:SupabaseClient) => call<MentorBoard>(c,'student_get_newbie_support_mentor_board',S.NoArgsSchema,{}),
  submitClaim: (c:SupabaseClient,i:S.ClaimInput) => call<any>(c,'student_submit_newbie_support_claim',S.ClaimSchema,i),
  requestCompletion: (c:SupabaseClient,i:S.CompletionRequestInput) => call<any>(c,'student_request_newbie_support_completion',S.CompletionRequestSchema,i),
  currentMonthBvDelta: (c:SupabaseClient) => call<MonthBvDelta>(c,'student_get_current_month_bv_delta',S.NoArgsSchema,{}),
  teacherBoard: (c:SupabaseClient) => call<TeacherNewbieBoard>(c,'teacher_get_newbie_support_board',S.NoArgsSchema,{}),
  createProgram: (c:SupabaseClient,i:S.CreateProgramInput) => call<any>(c,'teacher_create_newbie_support_program',S.CreateProgramSchema,i),
  updateProgram: (c:SupabaseClient,i:S.UpdateProgramInput) => call<any>(c,'teacher_update_newbie_support_program',S.UpdateProgramSchema,i),
  previewActivation: (c:SupabaseClient,p_program_id:number) => call<any>(c,'teacher_preview_newbie_support_activation',S.ProgramIdSchema,{p_program_id}),
  activateProgram: (c:SupabaseClient,p_program_id:number) => call<any>(c,'teacher_activate_newbie_support_program',S.ProgramIdSchema,{p_program_id}),
  reviewClaim: (c:SupabaseClient,i:S.ReviewClaimInput) => call<any>(c,'teacher_review_newbie_support_claim',S.ReviewClaimSchema,i),
  revokeClaim: (c:SupabaseClient,i:S.RevokeClaimInput) => call<any>(c,'teacher_revoke_newbie_support_claim',S.RevokeClaimSchema,i),
  extendDeadline: (c:SupabaseClient,i:S.ExtendDeadlineInput) => call<any>(c,'teacher_extend_newbie_support_deadline',S.ExtendDeadlineSchema,i),
  finalizeProgram: (c:SupabaseClient,i:S.FinalizeProgramInput) => call<any>(c,'teacher_finalize_newbie_support_program',S.FinalizeProgramSchema,i),
  cancelProgram: (c:SupabaseClient,i:S.CancelProgramInput) => call<any>(c,'teacher_cancel_newbie_support_program',S.CancelProgramSchema,i),
};
