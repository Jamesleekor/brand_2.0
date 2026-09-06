import type { SupabaseClient } from '@supabase/supabase-js';

export type AnalyticsJson = Record<string, any>;

async function rpcJson(
  supabase: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<AnalyticsJson> {
  const { data, error } = await supabase.rpc(functionName, args);
  if (error) throw error;
  return (data ?? {}) as AnalyticsJson;
}

export function getAnalyticsDashboard(
  supabase: SupabaseClient,
  classroomId: number,
  yearMonth: string,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_analytics_dashboard', {
    p_classroom_id: classroomId,
    p_guild_season_id: null,
    p_year_month: yearMonth,
    p_include_test: includeTest,
  });
}

export function getEconomyStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_statistics_economy', {
    p_classroom_id: classroomId,
    p_include_test: includeTest,
  });
}

export function getAchievementStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_statistics_achievements', {
    p_classroom_id: classroomId,
    p_include_test: includeTest,
  });
}

export function getAssetsStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_statistics_assets', {
    p_classroom_id: classroomId,
    p_include_test: includeTest,
  });
}

export function getAttendanceStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_statistics_attendance', {
    p_classroom_id: classroomId,
    p_include_test: includeTest,
  });
}

export function getGuildStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  yearMonth: string,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_guild_statistics', {
    p_classroom_id: classroomId,
    p_season_id: null,
    p_year_month: yearMonth,
    p_include_test: includeTest,
  });
}

export function getArcadeStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  yearMonth: string,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_arcade_statistics', {
    p_classroom_id: classroomId,
    p_guild_season_id: null,
    p_year_month: yearMonth,
    p_include_test: includeTest,
  });
}

export function getStudentStatistics(
  supabase: SupabaseClient,
  classroomId: number,
  studentId: number,
  yearMonth: string,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_student_statistics', {
    p_classroom_id: classroomId,
    p_student_id: studentId,
    p_guild_season_id: null,
    p_year_month: yearMonth,
    p_include_test: includeTest,
  });
}

export function getDataValidationReport(
  supabase: SupabaseClient,
  classroomId: number,
  includeTest = false,
) {
  return rpcJson(supabase, 'teacher_get_data_validation_report', {
    p_classroom_id: classroomId,
    p_include_test: includeTest,
  });
}

export function getRecordCandidates(
  supabase: SupabaseClient,
  classroomId: number,
  status: string | null,
  candidateType: string | null,
  limit = 100,
  offset = 0,
) {
  return rpcJson(supabase, 'teacher_get_record_candidates', {
    p_classroom_id: classroomId,
    p_status: status,
    p_candidate_type: candidateType,
    p_limit: limit,
    p_offset: offset,
  });
}

export function refreshRecordCandidates(
  supabase: SupabaseClient,
  classroomId: number,
) {
  return rpcJson(supabase, 'teacher_refresh_record_candidates', {
    p_classroom_id: classroomId,
  });
}

export function reviewRecordCandidate(
  supabase: SupabaseClient,
  candidateId: number,
  decision: 'APPROVED' | 'IGNORED' | 'REJECTED',
  note?: string,
) {
  return rpcJson(supabase, 'teacher_review_record_candidate', {
    p_candidate_id: candidateId,
    p_decision: decision,
    p_note: note ?? null,
  });
}
