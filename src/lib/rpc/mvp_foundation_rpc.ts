import type { SupabaseClient } from '@supabase/supabase-js';

export type MvpFoundationGrade = 'S+' | 'S' | 'A+' | 'A' | 'B';
export type MvpFoundationStatus = 'DRAFT' | 'FINALIZED';

export interface MvpFoundationSessionSummary {
  id: number;
  title: string;
  status: MvpFoundationStatus;
  evaluation_start_date: string;
  evaluation_end_date: string;
  comparison_start_date: string;
  comparison_end_date: string;
  last_calculated_at: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
  candidate_count: number;
}

export interface MvpFoundationSession extends Omit<MvpFoundationSessionSummary, 'candidate_count'> {}

export interface MvpFoundationStudentRow {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  guild_id: number | null;
  guild_name: string | null;
  evaluation_bv_earned: number;
  evaluation_bv_deducted: number;
  evaluation_bv_net: number;
  comparison_bv_earned: number;
  bv_growth_rate: number | null;
  bv_growth_status: 'RATE' | 'NEW';
  daily_quest_target_days: number;
  daily_quest_completed_days: number;
  daily_quest_completion_rate: number | null;
  achievement_count: number;
  achievement_score: number;
  guild_score: number;
  personal_contribution_score: number;
  personal_contribution_coverage: string;
  donation_gold: number;
  secondary_job_sales_completed: number;
  is_preliminary_candidate: boolean;
  preparation_responsibility_grade: MvpFoundationGrade | null;
  participation_listening_grade: MvpFoundationGrade | null;
  assignment_performance_grade: MvpFoundationGrade | null;
  improvement_growth_grade: MvpFoundationGrade | null;
  notes: string | null;
  input_updated_at?: string | null;
}

export interface MvpFoundationSummary {
  student_count?: number;
  daily_quest_source?: string;
  guild_score_source?: string;
  personal_contribution_source?: string;
  personal_contribution_warning?: string;
  bv_source?: string;
  bv_legacy_first_date?: string | null;
  bv_legacy_last_date?: string | null;
  [key: string]: unknown;
}

export interface MvpFoundationBoard {
  session: MvpFoundationSession;
  summary: MvpFoundationSummary;
  students: MvpFoundationStudentRow[];
  candidate_count: number;
  calculated: boolean;
}

export interface MvpFoundationInputState {
  is_preliminary_candidate: boolean;
  preparation_responsibility_grade: MvpFoundationGrade | null;
  participation_listening_grade: MvpFoundationGrade | null;
  assignment_performance_grade: MvpFoundationGrade | null;
  improvement_growth_grade: MvpFoundationGrade | null;
  notes: string | null;
}

export interface MvpFoundationStudentDetail {
  student: MvpFoundationStudentRow;
  evidence: {
    bv?: {
      evaluation_events?: Array<Record<string, unknown>>;
      evaluation_earned?: number;
      evaluation_deducted?: number;
      evaluation_net?: number;
      comparison_earned?: number;
    };
    daily_quest?: {
      target_days?: number;
      completed_days?: number;
      days?: Array<Record<string, unknown>>;
    };
    achievements?: Array<Record<string, unknown>>;
    guild_score?: { total?: number; guilds?: Array<Record<string, unknown>> };
    personal_contribution?: { coverage?: string; rows?: Array<Record<string, unknown>> };
    donations?: Array<Record<string, unknown>>;
    services?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  input: MvpFoundationInputState | null;
}

function n(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nullableN(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStudent(row: Record<string, unknown>): MvpFoundationStudentRow {
  return {
    student_id: n(row.student_id),
    student_name: String(row.student_name ?? ''),
    brand_name: row.brand_name == null ? null : String(row.brand_name),
    guild_id: row.guild_id == null ? null : n(row.guild_id),
    guild_name: row.guild_name == null ? null : String(row.guild_name),
    evaluation_bv_earned: n(row.evaluation_bv_earned),
    evaluation_bv_deducted: n(row.evaluation_bv_deducted),
    evaluation_bv_net: n(row.evaluation_bv_net),
    comparison_bv_earned: n(row.comparison_bv_earned),
    bv_growth_rate: nullableN(row.bv_growth_rate),
    bv_growth_status: row.bv_growth_status === 'NEW' ? 'NEW' : 'RATE',
    daily_quest_target_days: n(row.daily_quest_target_days),
    daily_quest_completed_days: n(row.daily_quest_completed_days),
    daily_quest_completion_rate: nullableN(row.daily_quest_completion_rate),
    achievement_count: n(row.achievement_count),
    achievement_score: n(row.achievement_score),
    guild_score: n(row.guild_score),
    personal_contribution_score: n(row.personal_contribution_score),
    personal_contribution_coverage: String(row.personal_contribution_coverage ?? 'MONTHLY_AGGREGATE'),
    donation_gold: n(row.donation_gold),
    secondary_job_sales_completed: n(row.secondary_job_sales_completed),
    is_preliminary_candidate: Boolean(row.is_preliminary_candidate),
    preparation_responsibility_grade: (row.preparation_responsibility_grade ?? null) as MvpFoundationGrade | null,
    participation_listening_grade: (row.participation_listening_grade ?? null) as MvpFoundationGrade | null,
    assignment_performance_grade: (row.assignment_performance_grade ?? null) as MvpFoundationGrade | null,
    improvement_growth_grade: (row.improvement_growth_grade ?? null) as MvpFoundationGrade | null,
    notes: row.notes == null ? null : String(row.notes),
    input_updated_at: row.input_updated_at == null ? null : String(row.input_updated_at),
  };
}

export async function listMvpFoundationSessions(supabase: SupabaseClient): Promise<MvpFoundationSessionSummary[]> {
  const { data, error } = await supabase.rpc('teacher_list_mvp_foundation_sessions');
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) => {
    const r = row as Record<string, unknown>;
    return { ...r, id: n(r.id), candidate_count: n(r.candidate_count) } as MvpFoundationSessionSummary;
  });
}

export async function createMvpFoundationSession(
  supabase: SupabaseClient,
  input: { title: string; evaluationStart: string; evaluationEnd: string; comparisonStart: string; comparisonEnd: string },
): Promise<number> {
  const { data, error } = await supabase.rpc('teacher_create_mvp_foundation_session', {
    p_title: input.title,
    p_evaluation_start: input.evaluationStart,
    p_evaluation_end: input.evaluationEnd,
    p_comparison_start: input.comparisonStart,
    p_comparison_end: input.comparisonEnd,
  });
  if (error) throw error;
  return n(data);
}

export async function updateMvpFoundationSession(
  supabase: SupabaseClient,
  input: { sessionId: number; title: string; evaluationStart: string; evaluationEnd: string; comparisonStart: string; comparisonEnd: string },
): Promise<void> {
  const { error } = await supabase.rpc('teacher_update_mvp_foundation_session', {
    p_session_id: input.sessionId,
    p_title: input.title,
    p_evaluation_start: input.evaluationStart,
    p_evaluation_end: input.evaluationEnd,
    p_comparison_start: input.comparisonStart,
    p_comparison_end: input.comparisonEnd,
  });
  if (error) throw error;
}

export async function calculateMvpFoundationData(supabase: SupabaseClient, sessionId: number): Promise<void> {
  const { error } = await supabase.rpc('teacher_calculate_mvp_foundation_data', { p_session_id: sessionId });
  if (error) throw error;
}

export async function getMvpFoundationSession(supabase: SupabaseClient, sessionId: number): Promise<MvpFoundationBoard> {
  const { data, error } = await supabase.rpc('teacher_get_mvp_foundation_session', { p_session_id: sessionId });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  const students = Array.isArray(raw.students) ? raw.students.map((row) => normalizeStudent(row as Record<string, unknown>)) : [];
  return {
    session: raw.session as MvpFoundationSession,
    summary: (raw.summary ?? {}) as MvpFoundationSummary,
    students,
    candidate_count: n(raw.candidate_count),
    calculated: Boolean(raw.calculated),
  };
}

export async function saveMvpFoundationInput(
  supabase: SupabaseClient,
  input: { sessionId: number; studentId: number } & MvpFoundationInputState,
): Promise<number> {
  const { data, error } = await supabase.rpc('teacher_save_mvp_foundation_input', {
    p_session_id: input.sessionId,
    p_student_id: input.studentId,
    p_is_preliminary_candidate: input.is_preliminary_candidate,
    p_preparation_responsibility_grade: input.preparation_responsibility_grade,
    p_participation_listening_grade: input.participation_listening_grade,
    p_assignment_performance_grade: input.assignment_performance_grade,
    p_improvement_growth_grade: input.improvement_growth_grade,
    p_notes: input.notes,
  });
  if (error) throw error;
  return n((data as Record<string, unknown> | null)?.candidate_count);
}

export async function getMvpFoundationStudentDetail(
  supabase: SupabaseClient,
  sessionId: number,
  studentId: number,
): Promise<MvpFoundationStudentDetail> {
  const { data, error } = await supabase.rpc('teacher_get_mvp_foundation_student_detail', {
    p_session_id: sessionId,
    p_student_id: studentId,
  });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    student: normalizeStudent((raw.student ?? {}) as Record<string, unknown>),
    evidence: (raw.evidence ?? {}) as MvpFoundationStudentDetail['evidence'],
    input: (raw.input ?? null) as MvpFoundationInputState | null,
  };
}

export async function finalizeMvpFoundationSession(supabase: SupabaseClient, sessionId: number): Promise<void> {
  const { error } = await supabase.rpc('teacher_finalize_mvp_foundation_session', { p_session_id: sessionId });
  if (error) throw error;
}
