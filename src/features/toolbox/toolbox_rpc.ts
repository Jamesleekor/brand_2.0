// =====================================================================
// 모험가 도구함 — 서버 호출
// ---------------------------------------------------------------------
// 모든 쓰기는 서버 함수(teacher_toolbox_* / student_toolbox_*)가 검증한다.
// 화면은 결과를 계산하지 않고 서버가 돌려준 상태를 그린다.
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BroadcastState, BuzzResult, ClassActivityKind, PulseRow, RosterItem, RosterRow,
  StudentActivityState, StudentFeedItem, TeacherActivityState, TeacherHub, Unit,
} from './toolbox_types';

export class ToolboxError extends Error {
  code: string;
  title: string;
  constructor(code: string, title: string, message: string) {
    super(message);
    this.code = code;
    this.title = title;
  }
}

const TITLES: Record<string, string> = {
  P7T01: '사용할 수 없어요',
  P7T02: '찾을 수 없어요',
  P7T03: '지금은 할 수 없어요',
  P7T04: '입력을 확인해 주세요',
  P7T05: '이미 처리되었어요',
};

/** 서버·네트워크 오류를 학생도 이해할 수 있는 문장으로 바꾼다. */
export function toToolboxError(error: unknown): ToolboxError {
  if (error instanceof ToolboxError) return error;
  const e = error as { code?: string; message?: string; details?: string } | undefined;
  const code = e?.code ?? '';
  const raw = e?.message ?? (error instanceof Error ? error.message : '');
  if (TITLES[code]) return new ToolboxError(code, TITLES[code], raw);
  if (/Failed to fetch|NetworkError|지연/.test(raw)) {
    return new ToolboxError('NETWORK', '연결이 불안정해요', '처리됐는지 화면이 다시 확인할 때까지 잠시 기다려 주세요.');
  }
  if (code === '42501') return new ToolboxError(code, '사용할 수 없어요', '이 기능을 쓸 권한이 없어요.');
  return new ToolboxError(code || 'UNKNOWN', '문제가 생겼어요', raw ? `잠시 후 다시 시도해 주세요. (${raw})` : '잠시 후 다시 시도해 주세요.');
}

async function call<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw toToolboxError(error);
  return data as T;
}

export const toolboxRpc = {
  // ---------- teacher ----------
  hub: (c: SupabaseClient) => call<TeacherHub>(c, 'teacher_toolbox_hub'),
  create: (c: SupabaseClient, p: { kind: ClassActivityKind; title: string; config: Record<string, unknown>; participants: Unit[]; open: boolean }) =>
    call<{ id: number }>(c, 'teacher_toolbox_create', {
      p_kind: p.kind, p_title: p.title, p_config: p.config, p_participants: p.participants, p_open: p.open,
    }),
  setStatus: (c: SupabaseClient, id: number, status: 'OPEN' | 'CLOSED' | 'ENDED') =>
    call<{ id: number; status: string }>(c, 'teacher_toolbox_set_status', { p_id: id, p_status: status }),
  remove: (c: SupabaseClient, id: number) => call<{ id: number }>(c, 'teacher_toolbox_delete', { p_id: id }),
  rename: (c: SupabaseClient, id: number, title: string) => call(c, 'teacher_toolbox_rename', { p_id: id, p_title: title }),
  teacherState: (c: SupabaseClient, id: number) => call<TeacherActivityState>(c, 'teacher_toolbox_state', { p_id: id }),
  broadcast: (c: SupabaseClient, id: number) => call<BroadcastState>(c, 'teacher_toolbox_broadcast', { p_id: id }),
  buzzer: (c: SupabaseClient, id: number, action: string, args: Record<string, unknown> = {}) =>
    call(c, 'teacher_toolbox_buzzer', { p_id: id, p_action: action, p_args: args }),
  score: (c: SupabaseClient, id: number, action: string, args: Record<string, unknown> = {}) =>
    call<{ scores: Record<string, number> }>(c, 'teacher_toolbox_score', { p_id: id, p_action: action, p_args: args }),
  tournament: (c: SupabaseClient, id: number, action: string, args: Record<string, unknown> = {}) =>
    call(c, 'teacher_toolbox_tournament', { p_id: id, p_action: action, p_args: args }),
  vote: (c: SupabaseClient, id: number, action: string, args: Record<string, unknown> = {}) =>
    call(c, 'teacher_toolbox_vote', { p_id: id, p_action: action, p_args: args }),
  voteBallots: (c: SupabaseClient, id: number) =>
    call<{ ballots: { student_id: number; name: string; brand_name: string | null; choices: string[]; revision: number;
      submitted_at: string; updated_at: string; invalidated_at: string | null; invalidated_reason: string | null }[] }>(
      c, 'teacher_toolbox_vote_ballots', { p_id: id }),
  cards: (c: SupabaseClient, id: number, action: string, args: Record<string, unknown> = {}) =>
    call(c, 'teacher_toolbox_cards', { p_id: id, p_action: action, p_args: args }),
  saveRoster: (c: SupabaseClient, name: string, items: RosterItem[], recent: boolean, id?: number) =>
    call<{ id: number }>(c, 'teacher_toolbox_save_roster', { p_name: name, p_items: items, p_recent: recent, p_id: id ?? null }),
  async listRosters(c: SupabaseClient, classroomId: number): Promise<RosterRow[]> {
    const { data, error } = await c.from('toolbox_rosters').select('id,name,items,is_recent,updated_at')
      .eq('classroom_id', classroomId).order('updated_at', { ascending: false }).limit(40);
    if (error) throw toToolboxError(error);
    return (data ?? []) as RosterRow[];
  },
  async deleteRoster(c: SupabaseClient, id: number): Promise<void> {
    const { error } = await c.from('toolbox_rosters').delete().eq('id', id);
    if (error) throw toToolboxError(error);
  },

  // ---------- student ----------
  feed: (c: SupabaseClient) => call<{ activities: StudentFeedItem[]; server_now: string }>(c, 'student_toolbox_feed'),
  studentState: (c: SupabaseClient, id: number) => call<StudentActivityState>(c, 'student_toolbox_state', { p_id: id }),
  buzz: (c: SupabaseClient, id: number) => call<BuzzResult>(c, 'student_toolbox_buzz', { p_id: id }),
  submitVote: (c: SupabaseClient, id: number, choices: string[]) =>
    call<{ revision: number }>(c, 'student_toolbox_vote_submit', { p_id: id, p_choices: choices }),
  submitCard: (c: SupabaseClient, id: number, title: string, body: string) =>
    call<{ revision: number }>(c, 'student_toolbox_card_submit', { p_id: id, p_title: title, p_body: body }),

  // ---------- signal ----------
  async pulse(c: SupabaseClient, classroomId: number, audience: 'S' | 'T'): Promise<PulseRow | null> {
    const { data, error } = await c.from('toolbox_pulse').select('pulse_key,rev,payload,updated_at')
      .eq('pulse_key', `${classroomId}-${audience}`).maybeSingle();
    if (error) throw toToolboxError(error);
    return (data as PulseRow | null) ?? null;
  },
};
