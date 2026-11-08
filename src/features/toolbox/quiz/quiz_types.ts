// =====================================================================
// 퀴즈 로얄 — 공통 타입 (서버 함수 teacher_quiz_* / student_quiz_* 의 응답 모양)
// =====================================================================

export type QuizPhase = 'SETUP' | 'LOBBY' | 'INDIVIDUAL' | 'IND_CEREMONY' | 'TEAM' | 'FINAL_CEREMONY' | 'COMPLETED';
export type QPhase = 'IDLE' | 'SHOWN' | 'LIVE' | 'PAUSED' | 'LOCKED' | 'REVEALED' | 'GRADED';
export type QuizStage = 'INDIVIDUAL' | 'TEAM';
export type QuizKind = 'KNOWLEDGE' | 'REASONING';
export type QuizTheme = 'BRAND_WORLD' | 'BRAND_ECONOMY' | 'GENERAL' | 'CURRICULUM';
export type MediaType = 'IMAGE' | 'VIDEO' | 'YOUTUBE';
export type Verdict = 'CORRECT' | 'WRONG';

export interface QuizConfig {
  positions: string[];
  use_individual: boolean;
  use_team: boolean;
  checkpoint_ind: number;
  checkpoint_team: number;
  auto_checkpoint: boolean;
  max_len: number;
  grace_ms: number;
  time_knowledge: number;
  time_reasoning: number;
  points_ind: number;
  points_team: number;
}

export interface QuizListItem {
  id: number;
  title: string;
  phase: QuizPhase;
  is_rehearsal: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  guild_count: number;
  question_count: number;
}

export interface QuizGuild {
  guild_id: number;
  name: string;
  sort_order: number;
  device_student_id: number | null;
  device_name: string | null;
  device_seen_at: string | null;
  logo_url: string | null;
}

export interface QuizRosterRow {
  guild_id: number;
  position_index: number;
  student_id: number;
  name: string;
}

export interface QuizQuestion {
  id: number;
  stage: QuizStage;
  position_index: number | null;
  order_index: number;
  seq: number;
  prompt: string;
  answer_key: string;
  accepted: string[];
  explanation: string | null;
  note: string | null;
  kind: QuizKind | null;
  theme: QuizTheme | null;
  points: number;
  time_limit_sec: number;
  media_type: MediaType | null;
  media_path: string | null;
  media_url: string | null;
  media_on_device: boolean;
  status: 'ACTIVE' | 'VOID';
  void_reason: string | null;
  attempt: number;
  started_at: string | null;
  locked_at: string | null;
  revealed_at: string | null;
  graded_at: string | null;
  pause_ms: number;
  pause_count: number;
}

/** 서버에 보내는 문제(붙여넣기·편집 공통) */
export interface QuizQuestionInput {
  id?: number;
  stage: QuizStage;
  position_index: number | null;
  prompt: string;
  answer_key: string;
  accepted: string[];
  explanation?: string | null;
  note?: string | null;
  kind?: QuizKind | null;
  theme?: QuizTheme | null;
  points?: number | null;
  time_limit_sec?: number | null;
  media_type?: MediaType | null;
  media_path?: string | null;
  media_url?: string | null;
  media_on_device?: boolean;
}

export interface QuizAnswer {
  question_id: number;
  attempt: number;
  guild_id: number;
  player_student_id: number | null;
  player_name: string | null;
  answer: string | null;
  submitted_at: string | null;
  auto_match: boolean | null;
  verdict: Verdict | null;
  points: number | null;
  graded_at: string | null;
}

export interface BoardSnapshot {
  label: string;
  at: string;
  graded: number;
  scores: Record<string, number>;
}

export interface ResultGuild {
  guild_id: number;
  name: string;
  ind: number;
  team: number;
  total: number;
  score: number;
  /** 공동 순위(같은 점수는 같은 순위) */
  rank: number;
}

export interface ResultSnapshot {
  kind: 'IND' | 'FINAL';
  at?: string;
  max_ind: number;
  max_team: number;
  guilds: ResultGuild[];
  /** 중계 화면에서만: 전체 길드 수와 지금 단계 */
  total?: number;
  step?: number;
}

export interface QuizEventState {
  id: number;
  title: string;
  is_rehearsal: boolean;
  config: QuizConfig;
  phase: QuizPhase;
  current_question_id: number | null;
  q_phase: QPhase;
  eff_q_phase: QPhase;
  deadline_at: string | null;
  remaining_ms: number | null;
  paused_at: string | null;
  public_board: BoardSnapshot | null;
  ind_result: ResultSnapshot | null;
  final_result: ResultSnapshot | null;
  ceremony_step: number;
  checkpoint_ready: boolean;
  screen: { board?: 'SHOW' | 'HIDE' };
  version: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ScoreRow { ind: number; team: number; total: number }

export interface TeacherQuizState {
  server_now: string;
  event: QuizEventState;
  guilds: QuizGuild[];
  roster: QuizRosterRow[];
  questions: QuizQuestion[];
  answers: QuizAnswer[];
  scores: Record<string, ScoreRow>;
  board_stale: boolean;
  offline: string[];
  roster_check: { errors: string[]; warnings: string[] };
  ready_errors: string[];
}

export interface QuizAuditRow {
  id: number;
  at: string;
  action: string;
  question_id: number | null;
  guild_id: number | null;
  detail: Record<string, any>;
}

export interface ScreenQuestion {
  id: number;
  attempt: number;
  stage: QuizStage;
  position_index: number | null;
  position_label: string | null;
  points: number;
  time_limit_sec: number;
  status: 'ACTIVE' | 'VOID';
  stage_index: number;
  stage_total: number;
  pos_index: number;
  pos_total: number;
  prompt: string | null;
  media_type: MediaType | null;
  media_path: string | null;
  media_url: string | null;
  answer_key: string | null;
  explanation: string | null;
}

export interface ScreenGuild {
  guild_id: number;
  name: string;
  logo_url: string | null;
  player: string | null;
  online: boolean;
  submitted: boolean;
  answer: string | null;
  verdict: Verdict | null;
  points: number | null;
}

export interface ScreenState {
  server_now: string;
  version: number;
  title: string;
  phase: QuizPhase;
  q_phase: QPhase;
  deadline_at: string | null;
  remaining_ms: number | null;
  positions: string[];
  handoff: boolean;
  question: ScreenQuestion | null;
  guilds: ScreenGuild[];
  board: { visible: boolean; snapshot: BoardSnapshot | null };
  result: ResultSnapshot | null;
}

export interface StudentQuestion {
  id: number;
  attempt: number;
  stage: QuizStage;
  position_index: number | null;
  position_label: string | null;
  points: number;
  time_limit_sec: number;
  status: 'ACTIVE' | 'VOID';
  prompt: string | null;
  media_type: MediaType | null;
  media_path: string | null;
  media_url: string | null;
  answer_key: string | null;
  mine: { answer: string | null; submitted_at: string | null; verdict: Verdict | null; points: number | null } | null;
}

export interface StudentQuizState {
  server_now: string;
  version: number;
  title: string;
  phase: QuizPhase;
  q_phase: QPhase;
  deadline_at: string | null;
  remaining_ms: number | null;
  max_len: number;
  guild: { guild_id: number; name: string };
  handoff: boolean;
  player: string | null;
  next_player: string | null;
  first_position: string | null;
  question: StudentQuestion | null;
}

export interface StudentQuizFeedItem {
  id: number;
  title: string;
  phase: QuizPhase;
  guild_name: string;
}

export interface QuizPulseRow {
  pulse_key: string;
  rev: number;
  payload: Record<string, any>;
  updated_at: string;
}

export const PHASE_LABEL: Record<QuizPhase, string> = {
  SETUP: '준비 중', LOBBY: '대기실', INDIVIDUAL: '개인전', IND_CEREMONY: '개인전 결과 발표',
  TEAM: '단체전', FINAL_CEREMONY: '최종 결과 발표', COMPLETED: '종료',
};
export const QPHASE_LABEL: Record<QPhase, string> = {
  IDLE: '시작 전', SHOWN: '문제 보는 중', LIVE: '답 받는 중', PAUSED: '일시정지', LOCKED: '마감',
  REVEALED: '답안 공개', GRADED: '채점 확정',
};
export const KIND_LABEL: Record<QuizKind, string> = { KNOWLEDGE: '지식', REASONING: '추론' };
export const THEME_LABEL: Record<QuizTheme, string> = {
  BRAND_WORLD: 'B.R.A.N.D 세계관', BRAND_ECONOMY: 'B.R.A.N.D 경제', GENERAL: '일반 상식', CURRICULUM: '수업 내용',
};
