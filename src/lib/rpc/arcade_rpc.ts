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
  /** Pure Reaction #02 일반 플레이의 KST 일일 도전 제한. 다른 게임/QA 계정은 null 또는 생략. */
  daily_attempt_limit?: number | null;
  daily_attempt_used?: number | null;
  daily_attempt_remaining?: number | null;
  daily_attempt_resets_at?: string | null;
  run_context?: 'STANDARD' | 'VERIFICATION';
  verification_session_id?: number;
  verification_opportunity_number?: number;
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
  run_context?: 'STANDARD' | 'VERIFICATION';
  verification_capture?: Record<string, unknown> | null;
}

export interface ArcadeGameAccess {
  game_code: string;
  available_from: string;
  public_available: boolean;
  can_start: boolean;
  mode: 'PUBLIC' | 'PRERELEASE_TEST' | 'CLOSED';
  /** Pure Reaction #02 STANDARD run 생성 횟수. Asia/Seoul 자정에 초기화. */
  daily_attempt_limit?: number | null;
  daily_attempt_used?: number | null;
  daily_attempt_remaining?: number | null;
  daily_attempt_resets_at?: string | null;
}

export type ArcadeLeaderboardCertificationStatus = 'NONE' | 'PENDING' | 'CERTIFIED' | 'FAILED';

export interface ArcadeLeaderboardRow {
  rank: number;
  student_id: number;
  student_name: string;
  /** 현재 순위를 계산할 때 실제로 사용되는 점수 */
  official_score: number;
  /** 월간 동결 전 일반 플레이 최고 기록. ACTIVE/SEASON에서는 official_score와 동일 */
  general_score: number;
  /** 인증 완료 후 공인된 점수. 인증 전/미대상은 null */
  certified_score: number | null;
  certification_status: ArcadeLeaderboardCertificationStatus;
  game_over_at: string;
  /** Game #02 only: average reaction time ×10, e.g. 2108 = 210.8ms */
  average_reaction_ms_x10?: number | null;
}

export interface ArcadeGuildTotalRow {
  rank: number;
  guild_id: number;
  guild_name: string;
  guild_logo_url: string | null;
  member_count: number;
  participant_count: number;
  certified_count: number;
  general_total: number;
  certified_total: number;
}

export interface ArcadeLeaderboardResult {
  period_id: number;
  period_kind: 'MONTHLY' | 'SEASON';
  game_code: string;
  top10: ArcadeLeaderboardRow[];
  guild_totals: ArcadeGuildTotalRow[];
  my_rank: number | null;
  my_score: number | null;
}

export interface ArcadePrereleaseTestLeaderboardResult {
  period_id: number;
  game_code: string;
  participant_count: number;
  top10: Array<{ rank: number; student_id: number; student_name: string; official_score: number; game_over_at: string }>;
}


export interface ArcadeVerificationAttempt {
  attempt_id: number;
  issue_number: number;
  opportunity_number: number;
  run_id: number;
  status: string;
  consumed: boolean;
  valid_run: boolean;
  terminal_outcome: string | null;
  official_score: number | null;
  issued_at: string;
  terminal_at: string | null;
  restored_at?: string | null;
  restore_reason?: string | null;
}

export interface ArcadeVerificationState {
  available: boolean;
  game_code: string;
  period_id?: number;
  period_name?: string;
  period_status?: 'VERIFICATION' | 'READY_TO_FINALIZE';
  session_id?: number;
  session_status?: 'ACTIVE' | 'COMPLETED' | 'RESET' | 'OVERRIDDEN';
  provisional_score?: number;
  verification_threshold?: number;
  threshold_percent?: number;
  max_attempts?: number;
  used_attempts?: number;
  remaining_attempts?: number;
  success_achieved?: boolean;
  result_status?: 'SUCCESS' | 'FAILURE_VALID' | 'FAILURE_NO_VALID' | null;
  current_rank?: number | null;
  active_run_id?: number | null;
  can_attempt?: boolean;
  attempts?: ArcadeVerificationAttempt[];
}

export interface ArcadeVerificationOverviewRow {
  rank: number | null;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  provisional_score: number;
  provisional_source_run_id: number;
  current_official_score: number | null;
  current_source_run_id: number | null;
  session_id: number | null;
  session_status: string | null;
  verification_threshold: number | null;
  threshold_percent: number | null;
  max_attempts: number | null;
  used_attempts: number;
  success_achieved: boolean;
  result_status: string | null;
  best_verification_score: number | null;
  active_run_id: number | null;
  decision_kind: string | null;
  official_source_run_id: number | null;
  decided_official_score: number | null;
  ranking_eligible: boolean | null;
  is_current_reward_range: boolean;
  attempts: ArcadeVerificationAttempt[];
}

export interface ArcadeVerificationOverview {
  period_id: number;
  period_status: 'VERIFICATION' | 'READY_TO_FINALIZE' | 'FINALIZED';
  period_name: string;
  game_code: string;
  rows: ArcadeVerificationOverviewRow[];
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
  submitPureReactionRun: (client: SupabaseClient, input: ArcadeSchemas.StudentSubmitPureReactionRunInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentSubmitPureReactionRunInput, ArcadeRunSubmissionResult>(client, 'student_submit_pure_reaction_02_run', ArcadeSchemas.StudentSubmitPureReactionRunSchema, input),
  getLeaderboard: (client: SupabaseClient, input: ArcadeSchemas.ArcadeLeaderboardInput) =>
    safeArcadeRpc<ArcadeSchemas.ArcadeLeaderboardInput, ArcadeLeaderboardResult>(client, 'get_arcade_leaderboard', ArcadeSchemas.ArcadeLeaderboardSchema, input),
  getRunResult: (client: SupabaseClient, input: ArcadeSchemas.StudentArcadeRunResultInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentArcadeRunResultInput, ArcadeRunResult>(client, 'student_get_arcade_run_result', ArcadeSchemas.StudentArcadeRunResultSchema, input),
  getVerificationState: (client: SupabaseClient, input: ArcadeSchemas.StudentArcadeVerificationStateInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentArcadeVerificationStateInput, ArcadeVerificationState>(client, 'student_get_arcade_verification_state', ArcadeSchemas.StudentArcadeVerificationStateSchema, input),
  createVerificationRun: (client: SupabaseClient, input: ArcadeSchemas.StudentCreateArcadeVerificationRunInput) =>
    safeArcadeRpc<ArcadeSchemas.StudentCreateArcadeVerificationRunInput, ArcadeRunBootstrap>(client, 'student_create_arcade_verification_run', ArcadeSchemas.StudentCreateArcadeVerificationRunSchema, input),
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
  freezeMonthlyPeriod: (client: SupabaseClient, input: ArcadeSchemas.TeacherFreezeArcadeMonthlyPeriodInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherFreezeArcadeMonthlyPeriodInput, Record<string, unknown>>(client, 'teacher_freeze_arcade_monthly_period', ArcadeSchemas.TeacherFreezeArcadeMonthlyPeriodSchema, input),
  getVerificationOverview: (client: SupabaseClient, input: ArcadeSchemas.TeacherArcadeVerificationOverviewInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherArcadeVerificationOverviewInput, ArcadeVerificationOverview>(client, 'teacher_get_arcade_verification_overview', ArcadeSchemas.TeacherArcadeVerificationOverviewSchema, input),
  startVerificationSession: (client: SupabaseClient, input: ArcadeSchemas.TeacherStartArcadeVerificationSessionInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherStartArcadeVerificationSessionInput, Record<string, unknown>>(client, 'teacher_start_arcade_verification_session', ArcadeSchemas.TeacherStartArcadeVerificationSessionSchema, input),
  endVerificationSession: (client: SupabaseClient, input: ArcadeSchemas.TeacherEndArcadeVerificationSessionInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherEndArcadeVerificationSessionInput, Record<string, unknown>>(client, 'teacher_end_arcade_verification_session', ArcadeSchemas.TeacherEndArcadeVerificationSessionSchema, input),
  cancelVerificationRun: (client: SupabaseClient, input: ArcadeSchemas.TeacherCancelArcadeVerificationRunInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherCancelArcadeVerificationRunInput, Record<string, unknown>>(client, 'teacher_cancel_arcade_verification_run', ArcadeSchemas.TeacherCancelArcadeVerificationRunSchema, input),
  restoreVerificationAttempt: (client: SupabaseClient, input: ArcadeSchemas.TeacherRestoreArcadeVerificationAttemptInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherRestoreArcadeVerificationAttemptInput, Record<string, unknown>>(client, 'teacher_restore_arcade_verification_attempt', ArcadeSchemas.TeacherRestoreArcadeVerificationAttemptSchema, input),
  resetVerificationSession: (client: SupabaseClient, input: ArcadeSchemas.TeacherResetArcadeVerificationSessionInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherResetArcadeVerificationSessionInput, Record<string, unknown>>(client, 'teacher_reset_arcade_verification_session', ArcadeSchemas.TeacherResetArcadeVerificationSessionSchema, input),
  setVerificationCorrection: (client: SupabaseClient, input: ArcadeSchemas.TeacherSetArcadeVerificationCorrectionInput) =>
    safeArcadeRpc<ArcadeSchemas.TeacherSetArcadeVerificationCorrectionInput, Record<string, unknown>>(client, 'teacher_set_arcade_verification_correction', ArcadeSchemas.TeacherSetArcadeVerificationCorrectionSchema, input),
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
    P0250: '인증 대상 기간을 찾지 못했어요.',
    P0251: '기록 인증 세션을 찾지 못했어요.',
    P0252: '아직 남은 기회가 있고 인증 기준을 달성하지 않아 세션을 종료할 수 없어요.',
    P0253: '동결된 잠정 기록을 찾지 못했어요.',
    P0254: '인증 시도와 게임 기록 연결을 찾지 못했어요.',
    P0255: '활성화된 기록 인증 세션을 찾지 못했어요.',
    P0256: '인증 대상 월간 기간을 찾지 못했어요.',
    P0257: '기록 인증은 월간 기간에서만 사용할 수 있어요.',
    P0258: '현재 기간 상태에서는 기록을 동결할 수 없어요.',
    P0259: '이미 동결 데이터가 있어 안전하게 진행할 수 없어요. 선생님에게 알려주세요.',
    P0260: '이 게임의 동결된 인증 설정을 찾지 못했어요.',
    P0261: '현재 기간은 기록 인증을 진행할 수 있는 상태가 아니에요.',
    P0262: '이미 공식 인증 결과가 확정된 학생이에요.',
    P0263: '진행 중인 인증 게임 기록을 찾지 못했어요.',
    P0264: '현재 상태의 인증 run은 기술 취소할 수 없어요.',
    P0265: '복구할 인증 시도를 찾지 못했어요.',
    P0266: '이 인증 시도는 복구할 수 없어요.',
    P0267: '선택한 보정 기록은 이 학생·게임·기간의 공식 기록으로 사용할 수 없어요.',
    P0268: '진행 중인 인증 플레이를 먼저 종료하거나 기술 취소해주세요.',
    P0269: '남은 인증 기회가 없거나 다른 인증 플레이가 진행 중이에요.',
    P0270: '현재 Top 10 인증 대상이 아니에요.',
    P0271: '현재 Top 10 인증이 모두 끝나지 않아 최종 확정할 수 없어요.',
    P0272: '최근 시작된 일반 Arcade 플레이가 끝난 뒤 기록을 동결해주세요.',
    P0273: '이 기록은 이미 동결된 잠정 source라 일반 무효화할 수 없어요. 기록 인증 보정을 사용해주세요.',
    P0274: '오늘 순수 반응속도 도전 50회를 모두 사용했어요. 내일 00:00에 다시 도전할 수 있어요.',
  };
  if (messages[error.code ?? '']) return messages[error.code ?? ''];
  if (error.type === 'VALIDATION') return error.error;
  return `요청을 완료하지 못했어요. 잠시 후 다시 시도해주세요.${error.code ? ` 확인 코드: ${error.code}` : ''}`;
}
