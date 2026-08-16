import { z } from 'zod';

const PositiveId = z.number().int('정수여야 합니다.').positive('양수여야 합니다.');
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '월 형식은 YYYY-MM이어야 합니다.');
const IsoDateTime = z.string().datetime({ offset: true, message: '시간 형식이 올바르지 않습니다.' });

export const ArcadeGameCodeSchema = z.string()
  .regex(/^[a-z][a-z0-9_]{2,63}$/, '게임 코드 형식이 올바르지 않습니다.');

export const StudentCreateArcadeRunSchema = z.object({
  p_game_code: ArcadeGameCodeSchema,
});
export type StudentCreateArcadeRunInput = z.infer<typeof StudentCreateArcadeRunSchema>;

export const StudentArcadeGameAccessSchema = z.object({
  p_game_code: ArcadeGameCodeSchema,
});
export type StudentArcadeGameAccessInput = z.infer<typeof StudentArcadeGameAccessSchema>;

export const StudentBeginArcadeRunSchema = z.object({
  p_run_id: PositiveId,
});
export type StudentBeginArcadeRunInput = z.infer<typeof StudentBeginArcadeRunSchema>;

export const ArcadeInputEventSchema = z.object({
  elapsed_ms: z.number().int().min(0).max(3_600_000),
  lane: z.number().int().min(0).max(3),
}).strict();
export type ArcadeInputEvent = z.infer<typeof ArcadeInputEventSchema>;

export const StudentSubmitFocusReactionRunSchema = z.object({
  p_run_id: PositiveId,
  p_input_events: z.array(ArcadeInputEventSchema).max(20_000, '입력 기록이 너무 많습니다.'),
  p_client_game_over_elapsed_ms: z.number().int().min(0).max(3_600_000),
});
export type StudentSubmitFocusReactionRunInput = z.infer<typeof StudentSubmitFocusReactionRunSchema>;

export const ArcadeLeaderboardSchema = z.object({
  p_game_code: ArcadeGameCodeSchema,
  p_period_id: PositiveId,
});
export type ArcadeLeaderboardInput = z.infer<typeof ArcadeLeaderboardSchema>;

export const StudentArcadeRunResultSchema = z.object({
  p_run_id: PositiveId,
});
export type StudentArcadeRunResultInput = z.infer<typeof StudentArcadeRunResultSchema>;

const RankingPeriodFieldsSchema = z.object({
  p_period_kind: z.enum(['MONTHLY', 'SEASON']),
  p_display_name: z.string().trim().min(1, '기간 이름을 입력해주세요.').max(120),
  p_guild_season_id: PositiveId.nullable(),
  p_contribution_year_month: YearMonth.nullable(),
  p_starts_at: IsoDateTime,
  p_ends_at_exclusive: IsoDateTime,
});

function validateRankingPeriodFields(value: z.infer<typeof RankingPeriodFieldsSchema>, ctx: z.RefinementCtx) {
  if (value.p_period_kind === 'MONTHLY' && !value.p_contribution_year_month) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_contribution_year_month'], message: '월간 기간에는 기여월이 필요합니다.' });
  }
  if (value.p_period_kind === 'SEASON' && value.p_contribution_year_month) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_contribution_year_month'], message: '시즌 기간에는 기여월을 입력하지 않습니다.' });
  }
  if (new Date(value.p_ends_at_exclusive).getTime() <= new Date(value.p_starts_at).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_ends_at_exclusive'], message: '종료 시각은 시작 시각 뒤여야 합니다.' });
  }
}

export const TeacherCreateArcadeRankingPeriodSchema = RankingPeriodFieldsSchema.superRefine(validateRankingPeriodFields);
export type TeacherCreateArcadeRankingPeriodInput = z.infer<typeof TeacherCreateArcadeRankingPeriodSchema>;

export const TeacherUpdateArcadeRankingPeriodSchema = z.object({
  p_period_id: PositiveId,
  p_display_name: z.string().trim().min(1, '기간 이름을 입력해주세요.').max(120),
  p_guild_season_id: PositiveId.nullable(),
  p_contribution_year_month: YearMonth.nullable(),
  p_starts_at: IsoDateTime,
  p_ends_at_exclusive: IsoDateTime,
  p_status: z.enum(['DRAFT', 'ACTIVE']),
}).superRefine((value, ctx) => {
  if (new Date(value.p_ends_at_exclusive).getTime() <= new Date(value.p_starts_at).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_ends_at_exclusive'], message: '종료 시각은 시작 시각 뒤여야 합니다.' });
  }
});
export type TeacherUpdateArcadeRankingPeriodInput = z.infer<typeof TeacherUpdateArcadeRankingPeriodSchema>;

export const TeacherFinalizeArcadeMonthlySnapshotSchema = z.object({
  p_period_id: PositiveId,
});
export type TeacherFinalizeArcadeMonthlySnapshotInput = z.infer<typeof TeacherFinalizeArcadeMonthlySnapshotSchema>;

export const TeacherArcadeRunAuditSchema = z.object({
  p_period_id: PositiveId,
  p_game_code: ArcadeGameCodeSchema,
});
export type TeacherArcadeRunAuditInput = z.infer<typeof TeacherArcadeRunAuditSchema>;

export const TeacherInvalidateArcadeRunSchema = z.object({
  p_run_id: PositiveId,
  p_reason: z.string().trim().min(2, '무효화 사유는 2자 이상이어야 합니다.').max(300),
  p_idempotency_key: z.string().uuid('요청 식별값 형식이 올바르지 않습니다.'),
});
export type TeacherInvalidateArcadeRunInput = z.infer<typeof TeacherInvalidateArcadeRunSchema>;

export const TeacherSetArcadePrereleaseTestAccessSchema = z.object({
  p_student_id: PositiveId,
  p_game_code: ArcadeGameCodeSchema,
  p_enabled: z.boolean(),
});
export type TeacherSetArcadePrereleaseTestAccessInput = z.infer<typeof TeacherSetArcadePrereleaseTestAccessSchema>;

export const TeacherListArcadePrereleaseTestAccessSchema = z.object({
  p_game_code: ArcadeGameCodeSchema,
});
export type TeacherListArcadePrereleaseTestAccessInput = z.infer<typeof TeacherListArcadePrereleaseTestAccessSchema>;

export const TeacherArcadePrereleaseTestLeaderboardSchema = z.object({
  p_period_id: PositiveId,
  p_game_code: ArcadeGameCodeSchema,
});
export type TeacherArcadePrereleaseTestLeaderboardInput = z.infer<typeof TeacherArcadePrereleaseTestLeaderboardSchema>;
