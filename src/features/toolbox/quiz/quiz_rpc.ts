// =====================================================================
// 퀴즈 로얄 — 서버 호출
// ---------------------------------------------------------------------
// 모든 쓰기는 서버 함수가 검증한다. 화면은 점수·마감을 계산하지 않고 서버가 준 상태를 그린다.
// 오류는 도구함과 같은 방식(toToolboxError)으로 학생도 읽을 수 있는 문장이 된다.
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { ToolboxError, toToolboxError } from '../toolbox_rpc';
import type {
  QuizAuditRow, QuizConfig, QuizListItem, QuizPulseRow, QuizQuestionInput, ScreenState,
  StudentQuizFeedItem, StudentQuizState, TeacherQuizState, Verdict,
} from './quiz_types';

async function call<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw toToolboxError(error);
  return data as T;
}

/** 서버가 '꺼진 태블릿이 있어요'로 거절했는지 (메시지가 OFFLINE: 으로 시작) */
export function offlineGuilds(error: unknown): string[] | null {
  const e = error as ToolboxError | undefined;
  const msg = e?.message ?? '';
  const m = /OFFLINE:(.*)$/.exec(msg);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : null;
}

/** 같은 버튼을 두 번 눌렀거나 화면이 한발 늦었던 경우(이미 처리됨) — 화면만 새로 읽으면 된다 */
export function isAlreadyDone(error: unknown): boolean {
  return (error as ToolboxError | undefined)?.code === 'P7T05';
}

export type QAction = 'SHOW' | 'START' | 'PAUSE' | 'RESUME' | 'LOCK' | 'REVEAL' | 'AUTO_GRADE' | 'FINALIZE' | 'VOID' | 'REISSUE' | 'NEXT' | 'MEDIA';

export const quizRpc = {
  // ---------- teacher: 준비 ----------
  list: (c: SupabaseClient) => call<{ events: QuizListItem[]; server_now: string }>(c, 'teacher_quiz_list'),
  create: (c: SupabaseClient, title: string, rehearsal: boolean) =>
    call<{ id: number }>(c, 'teacher_quiz_create', { p_title: title, p_is_rehearsal: rehearsal }),
  saveSetup: (c: SupabaseClient, id: number, title: string, config: QuizConfig,
    guilds: { guild_id: number; device_student_id: number | null }[], rehearsal: boolean) =>
    call(c, 'teacher_quiz_save_setup', { p_id: id, p_title: title, p_config: config, p_guilds: guilds, p_is_rehearsal: rehearsal }),
  saveQuestions: (c: SupabaseClient, id: number, questions: QuizQuestionInput[], mode: 'REPLACE' | 'APPEND') =>
    call<{ count: number }>(c, 'teacher_quiz_save_questions', { p_id: id, p_questions: questions, p_mode: mode }),
  upsertQuestion: (c: SupabaseClient, id: number, question: QuizQuestionInput) =>
    call<{ id: number }>(c, 'teacher_quiz_upsert_question', { p_id: id, p_question: question }),
  deleteQuestion: (c: SupabaseClient, id: number, questionId: number) =>
    call<{ id: number; media_path: string | null }>(c, 'teacher_quiz_delete_question', { p_id: id, p_question_id: questionId }),
  setRoster: (c: SupabaseClient, id: number, rows: { guild_id: number; position_index: number; student_id: number | null }[], reason?: string) =>
    call<{ check: { errors: string[]; warnings: string[] } }>(c, 'teacher_quiz_set_roster', { p_id: id, p_rows: rows, p_reason: reason ?? null }),
  openLobby: (c: SupabaseClient, id: number, open: boolean) => call(c, 'teacher_quiz_open_lobby', { p_id: id, p_open: open }),
  start: (c: SupabaseClient, id: number, forceReason?: string) =>
    call(c, 'teacher_quiz_start', { p_id: id, p_force_reason: forceReason ?? null }),

  // ---------- teacher: 진행 ----------
  q: (c: SupabaseClient, id: number, questionId: number, attempt: number, action: QAction, args: Record<string, unknown> = {}) =>
    call(c, 'teacher_quiz_q', { p_id: id, p_question_id: questionId, p_attempt: attempt, p_action: action, p_args: args }),
  grade: (c: SupabaseClient, id: number, questionId: number, attempt: number, guildId: number, verdict: Verdict | null) =>
    call(c, 'teacher_quiz_grade', { p_id: id, p_question_id: questionId, p_attempt: attempt, p_guild_id: guildId, p_verdict: verdict }),
  correct: (c: SupabaseClient, id: number, questionId: number, guildId: number, verdict: Verdict, reason: string) =>
    call(c, 'teacher_quiz_correct', { p_id: id, p_question_id: questionId, p_guild_id: guildId, p_verdict: verdict, p_reason: reason }),
  publishBoard: (c: SupabaseClient, id: number, label?: string) => call(c, 'teacher_quiz_publish_board', { p_id: id, p_label: label ?? null }),
  ceremony: (c: SupabaseClient, id: number, action: 'STEP' | 'BACK' | 'RESNAP' | 'ADVANCE') =>
    call(c, 'teacher_quiz_ceremony', { p_id: id, p_action: action }),
  screen: (c: SupabaseClient, id: number, settings: { board: 'SHOW' | 'HIDE' }) => call(c, 'teacher_quiz_screen', { p_id: id, p_settings: settings }),
  end: (c: SupabaseClient, id: number, reason: string) => call(c, 'teacher_quiz_end', { p_id: id, p_reason: reason }),
  remove: (c: SupabaseClient, id: number) => call<{ id: number; media_paths: string[] }>(c, 'teacher_quiz_delete', { p_id: id }),

  // ---------- teacher: 읽기 ----------
  state: (c: SupabaseClient, id: number) => call<TeacherQuizState>(c, 'teacher_quiz_state', { p_id: id }),
  presence: (c: SupabaseClient, id: number) =>
    call<{ server_now: string; version: number; devices: Record<string, string | null> }>(c, 'teacher_quiz_presence', { p_id: id }),
  screenState: (c: SupabaseClient, id: number) => call<ScreenState>(c, 'teacher_quiz_screen_state', { p_id: id }),
  audit: (c: SupabaseClient, id: number) => call<QuizAuditRow[]>(c, 'teacher_quiz_audit', { p_id: id }),

  // ---------- student (길드 대표 계정) ----------
  feed: (c: SupabaseClient) => call<{ events: StudentQuizFeedItem[]; server_now: string }>(c, 'student_quiz_feed'),
  studentState: (c: SupabaseClient, id: number) => call<StudentQuizState>(c, 'student_quiz_state', { p_id: id }),
  submit: (c: SupabaseClient, id: number, questionId: number, attempt: number, answer: string) =>
    call<{ ok: boolean; already: boolean; answer: string; submitted_at: string }>(c, 'student_quiz_submit',
      { p_id: id, p_question_id: questionId, p_attempt: attempt, p_answer: answer }),

  // ---------- signal ----------
  async pulse(c: SupabaseClient, key: string): Promise<QuizPulseRow | null> {
    const { data, error } = await c.from('quiz_pulse').select('pulse_key,rev,payload,updated_at').eq('pulse_key', key).maybeSingle();
    if (error) throw toToolboxError(error);
    return (data as QuizPulseRow | null) ?? null;
  },
};
