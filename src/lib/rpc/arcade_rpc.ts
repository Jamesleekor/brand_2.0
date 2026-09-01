import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import * as ArcadeSchemas from '@/lib/zod_schemas/arcade_schemas';

async function safeArcadeRpc<TInput, TOutput>(
  client: SupabaseClient,
  functionName: string,
  schema: z.ZodType<TInput>,
  input: unknown,
): Promise<RpcResult<TOutput>> {
  const validation = validateInput(schema, input);
  if (validation.success === false) {
    return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  }

  const { data, error } = await client.rpc(functionName, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOutput };
}

export interface ArcadeRunBootstrap {
  run_id: number;
  game_code: string;
  rule_version: string;
  countdown_started_at: string;
  countdown_ends_at: string;
  schedule_seed: number;
  config: Record<string, unknown>;
  is_prerelease_test: boolean;
}

export interface ArcadeRunStarted {
  run_id: number;
  play_started_at: string;
  schedule_seed: number;
  config: Record<string, unknown>;
}

export interface ArcadeRunSubmissionResult {
  accepted: boolean;
  run_id?: number;
  official_score?: number;
  official_duration_ms?: number;
  game_over_at?: string;
  stats?: Record<string, unknown>;
  code?: string;
  message?: string;
  is_prerelease_test?: boolean;
}

export interface ArcadeGameAccess {
  game_code: string;
  available_from: string;
  public_available: boolean;
  can_start: boolean;
  mode: 'PUBLIC' | 'PRERELEASE_TEST' | 'CLOSED';
}

export interface ArcadeLeaderboardResult {
  period_id: number;
  period_kind: 'MONTHLY' | 'SEASON';
  game_code: string;
  top10: Array<{ rank: number; student_id: number; student_name: string; official_score: number; game_over_at: string }>;
  my_rank: number | null;
  my_score: number | null;
}

export interface ArcadePrereleaseTestLeaderboardResult {
  period_id: number;
  game_code: string;
  participant_count: number;
  top10: Array<{ rank: number; student_id: number; student_name: string; official_score: number; game_over_at: string }>;
}

export interface ArcadeRunResult {
  run_id: number;
  status: string;
  official_score: number | null;
  official_duration_ms: number | null;
  game_over_at: string | null;
  stats: Record<string, unknown>;
  rejection_code: string | null;
  rejection_reason: string | null;
  is_prerelease_test: boolean;
}

export const arcadeStudentRpc = {
  getGameAccess: (client: SupabaseClient, input: ArcadeSchemas.StudentArcadeGameAccessInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentArcadeGameAccessInput, ArcadeGameAccess>(client, 'student_get_arcade_game_access', ArcadeSchemas.StudentArcadeGameAccessSchema, input),
  createRun: (client: SupabaseClient, input: ArcadeSchemas.StudentCreateArcadeRunInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentCreateArcadeRunInput, ArcadeRunBootstrap>(client, 'student_create_arcade_run', ArcadeSchemas.StudentCreateArcadeRunSchema, input),
  beginRun: (client: SupabaseClient, input: ArcadeSchemas.StudentBeginArcadeRunInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentBeginArcadeRunInput, ArcadeRunStarted>(client, 'student_begin_arcade_run', ArcadeSchemas.StudentBeginArcadeRunSchema, input),
  submitFocusReactionRun: (client: SupabaseClient, input: ArcadeSchemas.StudentSubmitFocusReactionRunInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentSubmitFocusReactionRunInput, ArcadeRunSubmissionResult>(client, 'student_submit_focus_reaction_01_run', ArcadeSchemas.StudentSubmitFocusReactionRunSchema, input),
  getLeaderboard: (client: SupabaseClient, input: ArcadeSchemas.ArcadeLeaderboardInput) =>
    safeArcadeRpc<ArcadeSchemas.ArcadeLeaderboardInput, ArcadeLeaderboardResult>(client, 'get_arcade_leaderboard', ArcadeSchemas.ArcadeLeaderboardSchema, input),
  getRunResult: (client: SupabaseClient, input: ArcadeSchemas.StudentArcadeRunResultInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentArcadeRunResultInput, ArcadeRunResult>(client, 'student_get_arcade_run_result', ArcadeSchemas.StudentArcadeRunResultSchema, input),
};

export const arcadeTeacherRpc = {
  createRankingPeriod: (client: SupabaseClient, input: ArcadeSchemas.TeacherCreateArcadeRankingPeriodInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherCreateArcadeRankingPeriodInput, { period_id: number; classroom_id: number; status: string }>(client, 'teacher_create_arcade_ranking_period', ArcadeSchemas.TeacherCreateArcadeRankingPeriodSchema, input),
  updateRankingPeriod: (client: SupabaseClient, input: ArcadeSchemas.TeacherUpdateArcadeRankingPeriodInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherUpdateArcadeRankingPeriodInput, { period_id: number; classroom_id: number; status: string }>(client, 'teacher_update_arcade_ranking_period', ArcadeSchemas.TeacherUpdateArcadeRankingPeriodSchema, input),
  endRankingPeriodNow: (client: SupabaseClient, input: ArcadeSchemas.TeacherEndArcadeRankingPeriodNowInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherEndArcadeRankingPeriodNowInput, { period_id: number; classroom_id: number; status: string; ended_at: string; already_ended: boolean }>(client, 'teacher_end_arcade_ranking_period_now', ArcadeSchemas.TeacherEndArcadeRankingPeriodNowSchema, input),
  finalizeMonthlySnapshot: (client: SupabaseClient, input: ArcadeSchemas.TeacherFinalizeArcadeMonthlySnapshotInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherFinalizeArcadeMonthlySnapshotInput, Record<string, unknown>>(client, 'teacher_finalize_arcade_monthly_snapshot', ArcadeSchemas.TeacherFinalizeArcadeMonthlySnapshotSchema, input),
  getRunAudit: (client: SupabaseClient, input: ArcadeSchemas.TeacherArcadeRunAuditInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherArcadeRunAuditInput, Array<Record<string, unknown>>>(client, 'teacher_get_arcade_run_audit', ArcadeSchemas.TeacherArcadeRunAuditSchema, input),
  invalidateRun: (client: SupabaseClient, input: ArcadeSchemas.TeacherInvalidateArcadeRunInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherInvalidateArcadeRunInput, { moderation_event_id: number; run_id: number; invalidated: boolean }>(client, 'teacher_invalidate_arcade_run', ArcadeSchemas.TeacherInvalidateArcadeRunSchema, input),
  setPrereleaseTestAccess: (client: SupabaseClient, input: ArcadeSchemas.TeacherSetArcadePrereleaseTestAccessInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherSetArcadePrereleaseTestAccessInput, { access_id: number; student_id: number; game_id: number; is_enabled: boolean }>(client, 'teacher_set_arcade_prerelease_test_access', ArcadeSchemas.TeacherSetArcadePrereleaseTestAccessSchema, input),
  listPrereleaseTestAccess: (client: SupabaseClient, input: ArcadeSchemas.TeacherListArcadePrereleaseTestAccessInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherListArcadePrereleaseTestAccessInput, Array<{ access_id: number; student_id: number; student_name: string; student_brand_name: string | null; is_enabled: boolean; updated_at: string }>>(client, 'teacher_list_arcade_prerelease_test_access', ArcadeSchemas.TeacherListArcadePrereleaseTestAccessSchema, input),
  getPrereleaseTestLeaderboard: (client: SupabaseClient, input: ArcadeSchemas.TeacherArcadePrereleaseTestLeaderboardInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherArcadePrereleaseTestLeaderboardInput, ArcadePrereleaseTestLeaderboardResult>(client, 'teacher_get_arcade_prerelease_test_leaderboard', ArcadeSchemas.TeacherArcadePrereleaseTestLeaderboardSchema, input),
};

export function arcadeErrorMessage(error: { type: string; code?: string; error: string }): string {
  const messages: Record<string, string> = {
    P0180: '이미 확정된 기간은 수정할 수 없어요.',
    P0183: '기간 종류를 확인해주세요.',
    P0184: '기간 이름을 확인해주세요.',
    P0185: '종료 시각은 시작 시각 뒤여야 해요.',
    P0186: '월간 기간의 기여월 설정을 확인해주세요.',
    P0187: '선택한 길드 시즌이 현재 학급의 시즌이 아니에요.',
    P0188: '수정할 Arcade 기간을 찾을 수 없어요.',
    P0189: '일반 수정으로는 확정 상태를 지정할 수 없어요.',
    P0195: '학생 로그인 정보를 확인하지 못했어요.',
    P0196: '게임 정보가 올바르지 않아요.',
    P0197: '아직 이 게임을 플레이할 수 있는 기간이 아니에요.',
    P0198: '게임 규칙을 준비하지 못했어요. 선생님께 알려주세요.',
    P0199: '내 게임 기록을 찾을 수 없어요.',
    P0200: '이 게임은 지금 시작할 수 없어요.',
    P0201: '5초 준비 시간이 끝난 뒤 시작할 수 있어요.',
    P0202: '이미 제출했거나 시작할 수 없는 게임이에요.',
    P0204: '학급 정보를 확인하지 못했어요.',
    P0205: '사용할 수 있는 랭킹 기간을 찾지 못했어요.',
    P0206: '게임을 찾을 수 없어요.',
    P0213: '이미 무효 처리된 기록이에요.',
    P0214: '확정할 월간 기간을 찾을 수 없어요.',
    P0215: '월간 기간만 Guild 2에 반영할 수 있어요.',
    P0216: '이미 확정되어 수정할 수 없는 기간이에요.',
    P0217: '먼저 기간을 활성화해주세요.',
    P0218: '기간이 끝난 뒤에만 월간 순위를 확정할 수 있어요.',
    P0220: '확정된 월간 순위 데이터가 완전하지 않아요. 선생님에게 알려주세요.',
    P0221: '테스트할 학생을 선택해주세요.',
    P0222: '테스트 허용 상태를 확인해주세요.',
    P0223: '현재 테스트할 수 있는 게임을 찾지 못했어요.',
    P0224: '선택한 테스트 학생이 현재 학급에 없어요.',
    P0225: '아직 시작하지 않은 랭킹 기간은 즉시 종료할 수 없어요.',
  };
  if (messages[error.code ?? '']) return messages[error.code ?? ''];
  if (error.type === 'VALIDATION') return error.error;
  return `요청을 완료하지 못했어요. 잠시 후 다시 시도해주세요.${error.code ? ` 확인 코드: ${error.code}` : ''}`;
}
