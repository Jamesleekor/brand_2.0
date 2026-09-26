import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type DailyQuestCode = 'ATTENDANCE' | 'PRIMARY_JOB' | 'LEARNING_MATERIALS' | 'CLEANING';
export type DailyQuestResult = 'UNCHECKED' | 'PASS' | 'FAIL';
export type DailyQuestReportStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'SETTLED';

export interface DailyQuestReportSummaryRef {
  id: number;
  status: DailyQuestReportStatus;
  quest_date: string;
  manager_student_id: number | null;
}

export interface DailyQuestManagerAccess {
  can_operate: boolean;
  is_teacher_emergency: boolean;
  is_manager: boolean;
  student_id: number | null;
  classroom_id: number | null;
  job_name: string | null;
  daily_wage: number | null;
  today: string;
  report: DailyQuestReportSummaryRef | null;
}

export interface DailyQuestCheck {
  check_id: number;
  quest_code: DailyQuestCode;
  result: DailyQuestResult;
  reward_bv: number;
  reward_gold_gross: number;
  job_name: string | null;
  job_wage: number | null;
  checked_at?: string | null;
  manager_note?: string | null;
  teacher_override: boolean;
  teacher_override_reason?: string | null;
}

export interface DailyQuestManagerStudent {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  checks: DailyQuestCheck[];
}

export interface DailyQuestManagerSummary {
  total_checks: number;
  pass_count: number;
  fail_count: number;
  unchecked_count: number;
  attendance_pass: number;
  primary_job_pass: number;
  learning_materials_pass: number;
  cleaning_pass: number;
}

export interface DailyQuestManagerBoard {
  report: {
    id: number;
    classroom_id: number;
    quest_date: string;
    manager_student_id: number | null;
    status: DailyQuestReportStatus;
    submitted_at: string | null;
    return_reason: string | null;
  };
  summary: DailyQuestManagerSummary;
  students: DailyQuestManagerStudent[];
  server_now: string;
}

export interface DailyQuestTeacherStudent extends DailyQuestManagerStudent {
  pass_count: number;
  fail_count: number;
  unchecked_count: number;
  expected_bv: number;
  attendance_bonus_gold: number;
  all_clear_bonus_gold: number;
  expected_gold_gross: number;
  expected_tax: number;
  expected_gold_net: number;
}

export interface DailyQuestTeacherBoard {
  report: {
    id: number;
    quest_date: string;
    status: DailyQuestReportStatus;
    manager_student_id: number | null;
    submitted_at: string | null;
    returned_at: string | null;
    return_reason: string | null;
    settled_at: string | null;
  } | null;
  quest_date?: string;
  summary: {
    pending?: boolean;
    student_count?: number;
    all_clear_student_count?: number;
    unchecked_student_count?: number;
    expected_total_bv?: number;
    expected_total_gold_gross?: number;
    expected_total_tax?: number;
    expected_total_gold_net?: number;
  };
  students: DailyQuestTeacherStudent[];
  server_now?: string;
}

export interface DailyQuestTeacherDayState {
  quest_date: string;
  today: string;
  cutover_date: string;
  report_exists: boolean;
  report_id: number | null;
  report_status: DailyQuestReportStatus | null;
  manager_student_id: number | null;
  can_create: boolean;
  is_legacy_archive: boolean;
  has_legacy_archive: boolean;
  legacy_entry_count: number;
  create_block_reason: string | null;
  read_only_legacy: boolean;
  legacy_rewards_already_applied: boolean;
}

export interface DailyQuestLegacyEntry {
  legacy_id: number;
  source_row: number | null;
  source_timestamp_local: string | null;
  occurred_at: string | null;
  bv_delta: number;
  gold_delta: number;
  parsed_tax: number;
  memo: string | null;
}

export interface DailyQuestLegacyStudent {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  entry_count: number;
  total_bv: number;
  total_gold: number;
  parsed_tax_total: number;
  entries: DailyQuestLegacyEntry[];
}

export interface DailyQuestLegacyArchive {
  mode: 'LEGACY_ARCHIVE' | 'NOT_LEGACY';
  quest_date: string;
  cutover_date: string;
  read_only: boolean;
  rewards_already_applied: boolean;
  source?: string;
  detail_level?: string;
  summary: {
    entry_count: number;
    student_count: number;
    total_bv: number;
    total_gold: number;
    parsed_tax_total: number;
  };
  students: DailyQuestLegacyStudent[];
}

export interface DailyQuestMutationResult {
  success: true;
  report_id?: number;
  check_id?: number;
  status?: DailyQuestReportStatus;
  result?: DailyQuestResult;
  submitted_at?: string;
  settled_at?: string;
  reason?: string;
  already_settled?: boolean;
  already_exists?: boolean;
  teacher_created?: boolean;
  manager_missing?: boolean;
  manager_student_id?: number | null;
  pass_check_count?: number;
  all_clear_student_count?: number;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const dailyQuestS3Rpc = {
  getManagerAccess: (supabase: SupabaseClient) =>
    callRpc<DailyQuestManagerAccess>(supabase, 'get_my_daily_quest_manager_access'),

  getManagerBoard: (supabase: SupabaseClient, date?: string | null) =>
    callRpc<DailyQuestManagerBoard>(supabase, 'get_daily_quest_manager_board', { p_date: date || null }),

  setManagerCheck: (
    supabase: SupabaseClient,
    checkId: number,
    result: DailyQuestResult,
    reason?: string | null,
  ) => callRpc<DailyQuestMutationResult>(supabase, 'daily_quest_manager_set_check', {
    p_check_id: checkId,
    p_result: result,
    p_reason: reason?.trim() || null,
  }),

  submitManagerReport: (supabase: SupabaseClient, reportId: number) =>
    callRpc<DailyQuestMutationResult>(supabase, 'daily_quest_manager_submit', { p_report_id: reportId }),

  getTeacherDayState: (supabase: SupabaseClient, date?: string | null) =>
    callRpc<DailyQuestTeacherDayState>(supabase, 'teacher_get_daily_quest_day_state', { p_date: date || null }),

  createTeacherReport: (supabase: SupabaseClient, date?: string | null) =>
    callRpc<DailyQuestMutationResult>(supabase, 'teacher_create_daily_quest_report', { p_date: date || null }),

  getLegacyArchive: (supabase: SupabaseClient, date?: string | null) =>
    callRpc<DailyQuestLegacyArchive>(supabase, 'teacher_get_legacy_daily_quest_archive', { p_date: date || null }),

  getTeacherBoard: (supabase: SupabaseClient, date?: string | null) =>
    callRpc<DailyQuestTeacherBoard>(supabase, 'teacher_get_daily_quest_settlement_board', { p_date: date || null }),

  overrideCheck: (
    supabase: SupabaseClient,
    checkId: number,
    result: 'PASS' | 'FAIL',
    reason?: string | null,
  ) => callRpc<DailyQuestMutationResult>(supabase, 'teacher_override_daily_quest_check', {
    p_check_id: checkId,
    p_result: result,
    p_reason: reason?.trim() || null,
  }),

  returnReport: (supabase: SupabaseClient, reportId: number, reason: string) =>
    callRpc<DailyQuestMutationResult>(supabase, 'teacher_return_daily_quest_report', {
      p_report_id: reportId,
      p_reason: reason.trim(),
    }),

  settleReport: (supabase: SupabaseClient, reportId: number) =>
    callRpc<DailyQuestMutationResult>(supabase, 'teacher_settle_daily_quest_report', { p_report_id: reportId }),
};
