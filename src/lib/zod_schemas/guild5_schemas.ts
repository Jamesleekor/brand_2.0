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

export const ArcadeForceReadySchema = z.object({
  p_year_month: YearMonth,
  p_reason: Reason,
});
export type ArcadeForceReadyInput = z.infer<typeof ArcadeForceReadySchema>;

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

// ── 2026-11-02 점령 운영: 세율 선언 · 이의 제기 · 확정 징수 · 분배 ──
const TerritoryRate = z.number().min(10, '세율은 10% 이상이어야 합니다.').max(50, '세율은 50% 이하여야 합니다.');

export const DeclareTerritoryRateSchema = z.object({ p_turn_id: Id, p_rate_percent: TerritoryRate });
export type DeclareTerritoryRateInput = z.infer<typeof DeclareTerritoryRateSchema>;

export const FileObjectionSchema = z.object({
  p_settlement_id: Id,
  p_objector_guild_id: Id,
  p_proposed_rate_percent: TerritoryRate,
  p_note: z.string().trim().max(300).optional().nullable(),
});
export type FileObjectionInput = z.infer<typeof FileObjectionSchema>;

export const WithdrawObjectionSchema = z.object({ p_objection_id: Id, p_reason: Reason });
export type WithdrawObjectionInput = z.infer<typeof WithdrawObjectionSchema>;

export const ObjectionVoteSchema = z.object({
  p_objection_id: Id,
  p_yes_votes: z.number().int().min(0).max(100),
  p_no_votes: z.number().int().min(0).max(100),
});
export type ObjectionVoteInput = z.infer<typeof ObjectionVoteSchema>;

export const SettlementIdSchema = z.object({ p_settlement_id: Id });
export type SettlementIdInput = z.infer<typeof SettlementIdSchema>;

export const DistributeTaxSchema = z.object({ p_settlement_id: Id, p_note: z.string().trim().max(300).optional().nullable() });
export type DistributeTaxInput = z.infer<typeof DistributeTaxSchema>;

export const PriorTaxRefundSchema = z.object({ p_version_id: Id, p_reason: z.string().trim().min(2, '사유를 2자 이상 입력해주세요.').max(150) });
export type PriorTaxRefundInput = z.infer<typeof PriorTaxRefundSchema>;
