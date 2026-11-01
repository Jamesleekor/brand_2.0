import type { SupabaseClient } from '@supabase/supabase-js';

export type HomeworkResult = 'UNKNOWN' | 'DONE' | 'LATE' | 'MISSING' | 'EXEMPT';
export type HomeworkTaskStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED';
export type HomeworkKind = 'MATH' | 'KOREAN' | 'HANDWRITING' | 'FORM' | 'OTHER';
export interface HomeworkTask {
  id: number; classroom_id: number; due_on: string; check_at: string;
  title: string; task_kind: HomeworkKind; instructions: string;
  status: HomeworkTaskStatus; created_at: string; submitted_at: string | null; returned_reason: string | null;
}
export interface HomeworkStudent { id: number; name: string }
export interface HomeworkMark {
  task_id: number; student_id: number; student_name: string; result: HomeworkResult; marked_at: string | null;
}
export interface HomeworkBoard {
  month: string; tasks: HomeworkTask[]; students: HomeworkStudent[]; results: HomeworkMark[];
}
export interface HomeworkAccess { can_operate: boolean; is_teacher: boolean; classroom_id?: number }
export interface GuildOutcomeRow {
  instance_id: number; mission_id: number; title: string; guild_name: string;
  current_guild_result: string | null; outcome: 'ON_TIME' | 'LATE' | 'FAILED' | 'EXEMPT' | null; note: string | null;
}
export interface HomeworkTrustRow {
  student_id: number; student_name: string; homework_count: number; homework_pct: number | null;
  mission_count: number; pending_missions: number; mission_penalty_pct: number; trust_pct: number | null; ready: boolean;
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const homeworkRpc = {
  access: (c: SupabaseClient) => rpc<HomeworkAccess>(c, 'homework_check_access'),
  board: (c: SupabaseClient, month: string) => rpc<HomeworkBoard>(c, 'homework_check_board', { p_month: `${month}-01` }),
  createTask: (c: SupabaseClient, input: { dueOn: string; title: string; kind: HomeworkKind; instructions: string; checkAt: string }) =>
    rpc<number>(c, 'homework_check_create_task', {
      p_due_on: input.dueOn, p_title: input.title, p_kind: input.kind, p_instructions: input.instructions, p_check_at: input.checkAt,
    }),
  mark: (c: SupabaseClient, taskId: number, studentId: number, result: HomeworkResult, reason: string | null = null) =>
    rpc<void>(c, 'homework_check_set_result', { p_task_id: taskId, p_student_id: studentId, p_result: result, p_reason: reason }),
  markUncheckedDone: (c: SupabaseClient, taskId: number) => rpc<number>(c, 'homework_check_mark_unchecked_done', { p_task_id: taskId }),
  submit: (c: SupabaseClient, taskId: number) => rpc<void>(c, 'homework_check_submit', { p_task_id: taskId }),
  returnTask: (c: SupabaseClient, taskId: number, reason: string) => rpc<void>(c, 'homework_teacher_return_task', { p_task_id: taskId, p_reason: reason }),
  guildBoard: (c: SupabaseClient, month: string) => rpc<GuildOutcomeRow[]>(c, 'homework_teacher_guild_dashboard', { p_month: `${month}-01` }),
  setGuildOutcome: (c: SupabaseClient, instanceId: number, outcome: GuildOutcomeRow['outcome'], note = '') =>
    rpc<void>(c, 'homework_teacher_guild_outcome', { p_instance_id: instanceId, p_outcome: outcome, p_note: note }),
  trustPreview: (c: SupabaseClient, sessionId: number) =>
    rpc<HomeworkTrustRow[]>(c, 'homework_teacher_trust_preview', { p_session_id: sessionId }),
  applyTrust: (c: SupabaseClient, sessionId: number) =>
    rpc<{ applied: number }>(c, 'homework_teacher_apply_trust', { p_session_id: sessionId }),
};
