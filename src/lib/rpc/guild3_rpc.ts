import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/guild3_schemas';

async function call<TIn, TOut>(supabase: SupabaseClient, name: string, schema: z.ZodType<TIn>, input: unknown): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  const { data, error } = await supabase.rpc(name, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOut };
}

export type Guild3MissionListItem = {
  mission_id:number; season_id:number; contribution_year_month:string; title:string; teaser_visible:boolean; teaser_title?:string|null;
  weight:number; submission_scope:'GUILD'|'INDIVIDUAL'|'NONE'; submission_requirement:'REQUIRED'|'OPTIONAL'|'NONE'; peer_review_required:boolean;
  lifecycle_state:'DRAFT'|'ACTIVE'|'CLOSED'|'FINALIZED'|'CANCELLED'|'VOIDED'; due_at:string; activity_record_due_at:string;
  published_at?:string|null; closed_at?:string|null; finalized_at?:string|null; cancelled_at?:string|null; voided_at?:string|null;
  instance_count:number; participant_count:number; unresolved_instance_count:number; ungraded_participant_count:number;
};

export type Guild3StudentBoardItem = {
  mission_id:number; title:string; lifecycle_state:string; teaser_only:boolean;
  description?:string|null; student_success_criteria?:string|null; due_at?:string|null; activity_record_due_at?:string|null;
  submission_scope?:'GUILD'|'INDIVIDUAL'|'NONE'; submission_requirement?:'REQUIRED'|'OPTIONAL'|'NONE'; special_rule_note?:string|null;
  guild_result?:'CLEARED'|'FAILED'|null; my_grade?:'S'|'A'|'B'|'C'|'F'|null; my_activity_record?:string|null; my_activity_record_revision?:number|null;
  current_submission?:string|null; current_submission_revision?:number|null;
};

export type Guild3ScoreSummary = { year_month:string; points:number; status:'READY'|'NOT_READY'; max_points:number };
export type Guild3MissionDetail = { mission:Record<string,any>; instances:Array<{instance:Record<string,any>;participants:Array<{participant:Record<string,any>;latest_activity_record:Record<string,any>|null;latest_grade_event:Record<string,any>|null}>;submissions:Array<Record<string,any>>}>; audit_history:Array<Record<string,any>>; guild4_openings:Array<Record<string,any>> };

export const guild3TeacherRpc = {
  list: (c:SupabaseClient)=>call<{},Guild3MissionListItem[]>(c,'teacher_list_guild3_missions',S.NoArgsSchema,{}),
  detail: (c:SupabaseClient,input:S.MissionDetailInput)=>call<S.MissionDetailInput,Guild3MissionDetail>(c,'teacher_get_guild3_mission_detail',S.MissionDetailSchema,input),
  create: (c:SupabaseClient,input:S.CreateMissionInput)=>call<S.CreateMissionInput,Record<string,any>>(c,'teacher_create_guild3_mission',S.CreateMissionSchema,input),
  updateDraft: (c:SupabaseClient,input:S.UpdateMissionDraftInput)=>call<S.UpdateMissionDraftInput,Record<string,any>>(c,'teacher_update_guild3_mission_draft',S.UpdateMissionDraftSchema,input),
  updatePresentation: (c:SupabaseClient,input:S.UpdateMissionPresentationInput)=>call<S.UpdateMissionPresentationInput,Record<string,any>>(c,'teacher_update_guild3_mission_presentation',S.UpdateMissionPresentationSchema,input),
  publish: (c:SupabaseClient,input:S.MissionIdInput)=>call<S.MissionIdInput,Record<string,any>>(c,'teacher_publish_guild3_mission',S.MissionIdSchema,input),
  close: (c:SupabaseClient,input:S.MissionReasonInput)=>call<S.MissionReasonInput,Record<string,any>>(c,'teacher_close_guild3_mission',S.MissionReasonSchema,input),
  reopen: (c:SupabaseClient,input:S.MissionReasonInput)=>call<S.MissionReasonInput,Record<string,any>>(c,'teacher_reopen_guild3_mission',S.MissionReasonSchema,input),
  cancel: (c:SupabaseClient,input:S.MissionReasonInput)=>call<S.MissionReasonInput,Record<string,any>>(c,'teacher_cancel_guild3_mission',S.MissionReasonSchema,input),
  setNote: (c:SupabaseClient,input:S.InstanceNoteInput)=>call<S.InstanceNoteInput,Record<string,any>>(c,'teacher_set_guild3_instance_special_rule_note',S.InstanceNoteSchema,input),
  setResult: (c:SupabaseClient,input:S.InstanceResultInput)=>call<S.InstanceResultInput,Record<string,any>>(c,'teacher_set_guild3_instance_result',S.InstanceResultSchema,input),
  setGrade: (c:SupabaseClient,input:S.ParticipantGradeInput)=>call<S.ParticipantGradeInput,Record<string,any>>(c,'teacher_set_guild3_participant_grade',S.ParticipantGradeSchema,input),
  autoF: (c:SupabaseClient,input:S.MissionIdInput)=>call<S.MissionIdInput,Record<string,any>>(c,'teacher_apply_guild3_missing_activity_f',S.MissionIdSchema,input),
  finalize: (c:SupabaseClient,input:S.MissionFinalizeInput)=>call<S.MissionFinalizeInput,Record<string,any>>(c,'teacher_finalize_guild3_mission',S.MissionFinalizeSchema,input),
  correctResult: (c:SupabaseClient,input:S.CorrectInstanceResultInput)=>call<S.CorrectInstanceResultInput,Record<string,any>>(c,'teacher_correct_guild3_instance_result',S.CorrectInstanceResultSchema,input),
  correctGrade: (c:SupabaseClient,input:S.CorrectParticipantGradeInput)=>call<S.CorrectParticipantGradeInput,Record<string,any>>(c,'teacher_correct_guild3_participant_grade',S.CorrectParticipantGradeSchema,input),
  unfinalize: (c:SupabaseClient,input:S.MissionReasonInput)=>call<S.MissionReasonInput,Record<string,any>>(c,'teacher_unfinalize_guild3_mission',S.MissionReasonSchema,input),
  voidMission: (c:SupabaseClient,input:S.MissionReasonInput)=>call<S.MissionReasonInput,Record<string,any>>(c,'teacher_void_guild3_mission',S.MissionReasonSchema,input),
  restoreVoided: (c:SupabaseClient,input:S.MissionReasonInput)=>call<S.MissionReasonInput,Record<string,any>>(c,'teacher_restore_voided_guild3_mission',S.MissionReasonSchema,input),
};

export const guild3StudentRpc = {
  board:(c:SupabaseClient)=>call<{},Guild3StudentBoardItem[]>(c,'student_get_guild3_mission_board',S.NoArgsSchema,{}),
  scoreSummary:(c:SupabaseClient)=>call<{},Guild3ScoreSummary[]>(c,'student_get_guild3_mission_score_summary',S.NoArgsSchema,{}),
  submit:(c:SupabaseClient,input:S.StudentSubmitInput)=>call<S.StudentSubmitInput,Record<string,any>>(c,'student_submit_guild3_mission_result',S.StudentSubmitSchema,input),
  activity:(c:SupabaseClient,input:S.StudentActivityInput)=>call<S.StudentActivityInput,Record<string,any>>(c,'student_record_guild3_mission_activity',S.StudentActivitySchema,input),
};

export function guild3RpcError(result: unknown, fallback='미션 작업을 완료하지 못했습니다.') {
  if(result && typeof result==='object' && 'error' in result){ const x=(result as {error?:unknown}).error; if(typeof x==='string'&&x.trim()) return x; }
  return fallback;
}
