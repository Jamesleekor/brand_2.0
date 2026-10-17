// =====================================================================
// 모험가 도구함 — 공통 타입
// =====================================================================

export type ClassActivityKind = 'BUZZER' | 'SCOREBOARD' | 'TOURNAMENT' | 'VOTE' | 'CARDS';
export type ActivityStatus = 'READY' | 'OPEN' | 'CLOSED' | 'ENDED';
export type PersonalToolId = 'lottery' | 'ladder' | 'roulette' | 'order' | 'timer' | 'teams';

/** 참가 단위. 학생 한 명, 길드 하나, 팀 하나, 직접 입력 항목 하나. */
export type UnitType = 'STUDENT' | 'GUILD' | 'TEAM' | 'MANUAL';

export interface UnitMember {
  student_id: number;
  label: string;
}

export interface Unit {
  key: string;
  type: UnitType;
  label: string;
  color?: string;
  student_id?: number;
  guild_id?: number;
  members?: UnitMember[];
}

export interface ActivitySummary {
  id: number;
  kind: ClassActivityKind;
  title: string;
  status: ActivityStatus;
  share_to_students: boolean;
  created_at: string;
  updated_at: string;
  opened_at: string | null;
  closed_at: string | null;
  ended_at: string | null;
  unit_count: number;
  eligible_count: number;
}

export interface TeacherHub {
  classroom_id: number;
  live: ActivitySummary[];
  records: ActivitySummary[];
  cleaned: number;
  server_now: string;
}

export interface BuzzerConfig {
  mode: 'INDIVIDUAL' | 'TEAM';
  team_press: 'ANY' | 'REP';
  close_on_first: boolean;
  show_false_starts: boolean;
  reps?: Record<string, number>;
  scoreboard_id?: number;
}

export interface BuzzerJudgment {
  unit_key: string;
  verdict: 'CORRECT' | 'WRONG';
  points?: number;
  score_event_id?: number;
  at: string;
}

export interface BuzzerState {
  round_no: number;
  round_status: 'IDLE' | 'OPEN' | 'CLOSED';
  opened_at?: string;
  closed_at?: string;
  points: number;
  judgments: BuzzerJudgment[];
}

export interface BuzzerPress {
  unit_key: string;
  student_id?: number;
  rank: number;
  pressed_at?: string;
  student_name: string;
  brand_name?: string | null;
  ms?: number;
}

export interface ScoreEvent {
  id: number;
  batch_id: number;
  unit_key: string;
  delta: number;
  source: 'MANUAL' | 'SET' | 'BUZZER' | 'RESET';
  detail: Record<string, any>;
  undone_at: string | null;
  created_at: string;
}

export interface MatchResult {
  winner: string;
  score_a?: number;
  score_b?: number;
  note?: string;
  note_public?: boolean;
}

export interface BracketState {
  slots: (string | null)[];
  third_place: boolean;
  results: Record<string, MatchResult>;
  revealed_at: string | null;
}

export interface VoteOption {
  key: string;
  label: string;
  desc?: string;
  student_id?: number;
}

export interface VoteConfig {
  mode: 'YESNO' | 'MULTI' | 'CANDIDATE';
  options: VoteOption[];
  description?: string;
  position?: string;
  allow_abstain: boolean;
  max_choices: number;
  seats: number;
  anonymous: boolean;
  reveal: 'AFTER_CLOSE' | 'LIVE';
  close_at?: string;
  shuffle: boolean;
  judge?: { rule: 'ABSOLUTE' | 'MAJORITY'; threshold: number };
  runoff_of?: number;
  confirmed?: string[];
}

export interface VoteTally {
  counts?: Record<string, number>;
  submitted: number;
  abstain?: number;
  invalidated?: number;
  choosers?: number;
  eligible: number;
  not_voted?: number;
}

export interface StudentRef {
  student_id: number;
  name: string;
  brand_name?: string | null;
}

export interface CardRow {
  student_id: number;
  name: string;
  brand_name: string | null;
  title: string;
  body: string;
  revision: number;
  hidden: boolean;
  presented: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeacherActivityState extends ActivitySummary {
  config: any;
  participants: Unit[];
  state: any;
  rev: number;
  eligible_student_ids: number[];
  server_now: string;
  // kind-specific
  presses?: BuzzerPress[];
  false_starts?: { student_id: number; student_name: string; locked_until: string; pressed_at: string; round_no: number }[];
  scoreboard?: { id: number; title: string; status: ActivityStatus; scores: Record<string, number> } | null;
  events?: ScoreEvent[];
  tally?: VoteTally;
  not_voted?: StudentRef[];
  eligible_names?: Record<string, { name: string; brand_name: string | null }>;
  cards?: CardRow[];
  not_submitted?: StudentRef[];
}

export interface BroadcastState {
  id: number;
  kind: ClassActivityKind;
  title: string;
  status: ActivityStatus;
  rev: number;
  participants: (Pick<Unit, 'key' | 'type' | 'label' | 'color'> & { member_count: number })[];
  config: any;
  state: any;
  server_now: string;
  presses?: BuzzerPress[];
  false_starts?: { student_name: string; locked_until: string }[];
  scoreboard?: { id: number; scores: Record<string, number> };
  tally?: VoteTally;
  voters?: Record<string, string[]>;
  cards?: { card_id: number; title: string; presented: boolean; author?: string }[];
  spotlight_card?: { card_id: number; title: string; body: string; author?: string } | null;
  submitted?: number;
  eligible?: number;
}

export interface StudentFeedItem {
  id: number;
  kind: ClassActivityKind;
  title: string;
  status: ActivityStatus;
  opened_at: string | null;
  mine: { submitted?: boolean; submission_open?: boolean; round_status?: string };
}

export interface StudentActivityState {
  id: number;
  available: boolean;
  kind?: ClassActivityKind;
  title?: string;
  status?: ActivityStatus;
  rev?: number;
  server_now: string;
  // buzzer
  mode?: 'INDIVIDUAL' | 'TEAM';
  team_press?: 'ANY' | 'REP';
  can_press?: boolean;
  my_unit?: { key: string; label: string; color?: string } | null;
  round_no?: number;
  round_status?: 'IDLE' | 'OPEN' | 'CLOSED';
  opened_at?: string | null;
  points?: number;
  my_press?: { rank: number; by_me: boolean; student_name: string } | null;
  my_verdict?: 'CORRECT' | 'WRONG' | null;
  locked_until?: string | null;
  // scoreboard
  sort?: 'FIXED' | 'SCORE';
  scores?: Record<string, number>;
  units?: (Pick<Unit, 'key' | 'label' | 'color'> & { mine?: boolean })[];
  // tournament
  revealed_at?: string | null;
  state?: any;
  // vote
  config?: VoteConfig;
  my_ballot?: { choices: string[]; revision: number; submitted_at: string; updated_at: string; invalidated: boolean } | null;
  revealed?: boolean;
  decision_note?: string | null;
  tally?: VoteTally;
  // cards
  prompt?: string | null;
  show_author?: boolean;
  submission_open?: boolean;
  my_card?: { title: string; body: string; revision: number; updated_at: string } | null;
}

export type BuzzResult =
  | { result: 'ACCEPTED'; rank: number; round_no: number; server_now: string }
  | { result: 'ALREADY'; rank: number; by_me: boolean; server_now: string }
  | { result: 'FALSE_START' | 'LOCKED'; locked_until: string; server_now: string }
  | { result: 'CLOSED' | 'NOT_PARTICIPANT' | 'ROUND_FULL'; server_now: string };

export interface PulseRow {
  pulse_key: string;
  rev: number;
  payload: Record<string, any>;
  updated_at: string;
}

export interface RosterRow {
  id: number;
  name: string;
  items: RosterItem[];
  is_recent: boolean;
  updated_at: string;
}

/** 참가자 선택 패널이 다루는 원본 항목 */
export type RosterItem =
  | { type: 'STUDENT'; student_id: number; label: string }
  | { type: 'GUILD'; guild_id: number; label: string; as: 'UNIT' | 'MEMBERS'; member_ids: number[]; color?: string }
  | { type: 'TEAM'; key: string; label: string; color?: string; member_ids: number[] }
  | { type: 'MANUAL'; id: string; label: string };
