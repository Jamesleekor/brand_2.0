import { z } from 'zod';

const Id = z.number().int().positive();
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '월은 YYYY-MM 형식이어야 합니다.');
const Reason = z.string().trim().min(2, '사유를 2자 이상 입력해주세요.').max(500);

export const NoArgsSchema = z.object({}).strict();
export const YearMonthSchema = z.object({ p_year_month: YearMonth });
export type YearMonthInput = z.infer<typeof YearMonthSchema>;

export const OverrideSchema = z.object({
  p_year_month: YearMonth,
  p_component: z.enum(['MISSION', 'PEER']),
  p_enabled: z.boolean(),
  p_reason: Reason,
});
export type OverrideInput = z.infer<typeof OverrideSchema>;

export const TerritoryConfigSchema = z.object({
  p_season_id: Id,
  p_slot_no: z.number().int().min(1).max(3),
  p_territory_name: z.string().trim().min(1).max(100),
  p_description: z.string().trim().max(500).optional().nullable(),
  p_tax_rate_percent: z.number().min(0).max(100),
});
export type TerritoryConfigInput = z.infer<typeof TerritoryConfigSchema>;

export const ReopenSchema = z.object({ p_year_month: YearMonth, p_reason: Reason });
export type ReopenInput = z.infer<typeof ReopenSchema>;

export const VersionIdSchema = z.object({ p_version_id: Id });
export type VersionIdInput = z.infer<typeof VersionIdSchema>;

export const TurnChoiceSchema = z.object({ p_turn_id: Id, p_territory_id: Id });
export type TurnChoiceInput = z.infer<typeof TurnChoiceSchema>;

export const ReconquestSchema = z.object({ p_version_id: Id, p_reason: Reason });
export type ReconquestInput = z.infer<typeof ReconquestSchema>;

export const SeasonLockSchema = z.object({ p_season_id: Id, p_reason: Reason });
export type SeasonLockInput = z.infer<typeof SeasonLockSchema>;

export const TurnIdSchema = z.object({ p_turn_id: Id });
export type TurnIdInput = z.infer<typeof TurnIdSchema>;
