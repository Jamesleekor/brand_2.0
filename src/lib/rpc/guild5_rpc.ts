import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/guild5_schemas';

async function call<TIn, TOut>(supabase: SupabaseClient, name: string, schema: z.ZodType<TIn>, input: unknown): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  const { data, error } = await supabase.rpc(name, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOut };
}

export type Guild5ReadinessItem = { status: 'READY' | 'NOT_READY' | 'OVERRIDDEN'; [key: string]: unknown };
export type Guild5ClosePreview = {
  classroom_id: number;
  season_id: number;
  year_month: string;
  closure_id?: number | null;
  closure_state: 'OPEN' | 'FINALIZED' | 'REOPENED';
  current_version_id?: number | null;
  can_finalize: boolean;
  season_locked: boolean;
  readiness: Record<string, Guild5ReadinessItem>;
  overrides: Record<string, { active: boolean; reason?: string | null }>;
  guilds: Array<Record<string, any>>;
  students: Array<Record<string, any>>;
};

export type Guild5TerritoryEconomy = {
  slot_no: number;
  territory_id?: number | null;
  territory_name?: string | null;
  territory_description?: string | null;
  tax_rate_percent?: number | null;
  auction_category: '자리' | '1인1역' | '급식순서';
  auction_id?: number | null;
  auction_round_number?: number | null;
  auction_school_year?: number | null;
  auction_ended_at?: string | null;
  settled_item_count: number;
  gross_spend: number;
  projected_revenue: number;
  snapshot?: boolean;
};

export type Guild5TerritoryTaxSummary = {
  slot_no: number;
  territory_id?: number | null;
  territory_name?: string | null;
  auction_category: '자리' | '1인1역' | '급식순서';
  auction_id?: number | null;
  auction_round_number?: number | null;
  tax_rate_percent?: number | null;
  owner_guild_id?: number | null;
  turn_id?: number | null;
  turn_status?: string | null;
  assessment_count: number;
  taxpayer_count: number;
  assessed_amount: number;
  collected_amount: number;
  outstanding_amount: number;
};

export type Guild5TeacherDashboard = {
  preview: Guild5ClosePreview;
  season: Record<string, any> | null;
  season_lock: Record<string, any> | null;
  is_test_fixture?: boolean;
  territories: Array<Record<string, any>>;
  territory_economy: Guild5TerritoryEconomy[];
  territory_tax_summary: Guild5TerritoryTaxSummary[];
  closure: Record<string, any> | null;
  versions: Array<Record<string, any>>;
  guild_snapshots: Array<Record<string, any>>;
  student_snapshots: Array<Record<string, any>>;
  conquest_turns: Array<Record<string, any>>;
  audit: Array<Record<string, any>>;
};

export type Guild5StudentHistory = Array<{
  year_month: string;
  version_no: number;
  finalized_at: string;
  conquest_status?: string;
  my_contribution: Record<string, any> | null;
  my_guild: Record<string, any> | null;
  territory?: Record<string, any> | null;
  territory_economy: Guild5TerritoryEconomy[];
  territory_tax_summary: Guild5TerritoryTaxSummary[];
  rankings: Array<Record<string, any>>;
}>;

export const guild5TeacherRpc = {
  dashboard: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Guild5TeacherDashboard>(c, 'teacher_get_guild5_dashboard', S.YearMonthSchema, input),
  preview: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Guild5ClosePreview>(c, 'teacher_get_guild5_close_preview', S.YearMonthSchema, input),
  setOverride: (c: SupabaseClient, input: S.OverrideInput) => call<S.OverrideInput, Guild5ClosePreview>(c, 'teacher_set_guild5_override', S.OverrideSchema, input),
  forceArcadeReady: (c: SupabaseClient, input: S.ArcadeForceReadyInput) => call<S.ArcadeForceReadyInput, Record<string, any>>(c, 'teacher_force_finalize_arcade_month_for_guild5', S.ArcadeForceReadySchema, input),
  setTerritory: (c: SupabaseClient, input: S.TerritoryConfigInput) => call<S.TerritoryConfigInput, Array<Record<string, any>>>(c, 'teacher_set_guild5_territory_v2', S.TerritoryConfigSchema, input),
  finalize: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Record<string, any>>(c, 'teacher_finalize_guild5_month', S.YearMonthSchema, input),
  reopen: (c: SupabaseClient, input: S.ReopenInput) => call<S.ReopenInput, Record<string, any>>(c, 'teacher_reopen_guild5_month', S.ReopenSchema, input),
  processDue: (c: SupabaseClient, input: S.VersionIdInput) => call<S.VersionIdInput, Record<string, any>>(c, 'teacher_process_guild5_due_conquest', S.VersionIdSchema, input),
  chooseTerritory: (c: SupabaseClient, input: S.TurnChoiceInput) => call<S.TurnChoiceInput, Record<string, any>>(c, 'teacher_choose_guild5_territory', S.TurnChoiceSchema, input),
  reconquest: (c: SupabaseClient, input: S.ReconquestInput) => call<S.ReconquestInput, Record<string, any>>(c, 'teacher_start_guild5_reconquest', S.ReconquestSchema, input),
  lockSeason: (c: SupabaseClient, input: S.SeasonLockInput) => call<S.SeasonLockInput, Record<string, any>>(c, 'teacher_lock_guild5_season', S.SeasonLockSchema, input),
  prepareTestGuilds: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Record<string, any>>(c, 'teacher_prepare_guild5_test_guilds_for_month', S.YearMonthSchema, input),
  forceTestTurnDue: (c: SupabaseClient, input: S.TurnIdInput) => call<S.TurnIdInput, Record<string, any>>(c, 'teacher_force_guild5_test_turn_due', S.TurnIdSchema, input),
};

// ── 2026-11-02 점령 운영 (세율 선언 · 이의 제기 · 확정 징수 · 분배 · 이력) ──
export type Guild5TerritoryCategory = '자리' | '1인1역' | '급식순서';

export type Guild5RateSettlement = {
  id: number;
  version_id: number;
  conquest_turn_id: number;
  owner_guild_id: number;
  owner_guild_name_snapshot: string;
  territory_slot_no: number;
  territory_name_snapshot: string;
  auction_category: Guild5TerritoryCategory;
  status: 'RATE_DECLARED' | 'FINALIZED';
  declared_rate_percent: number;
  declared_at: string;
  final_rate_percent?: number | null;
  finalized_at?: string | null;
  settlement_summary?: Record<string, any> | null;
};

export type Guild5Objection = {
  id: number;
  settlement_id: number;
  objector_guild_id: number;
  objector_rank_position: number;
  objector_guild_name_snapshot: string;
  declared_rate_snapshot: number;
  proposed_rate_percent: number;
  status: 'FILED' | 'PASSED' | 'REJECTED' | 'WITHDRAWN';
  vote_threshold: number;
  yes_votes?: number | null;
  no_votes?: number | null;
  note?: string | null;
  filed_at: string;
  decided_at?: string | null;
  withdrawn_at?: string | null;
  withdraw_reason?: string | null;
};

export type Guild5TaxDistribution = {
  id: number;
  basis_amount: number;
  roster_count: number;
  divisor: number;
  per_member_amount: number;
  paid_member_count: number;
  distributed_amount: number;
  retained_amount: number;
  note?: string | null;
  created_at: string;
  lines: Array<{ student_id: number; student_name?: string | null; amount: number; line_status: 'PAID' | 'SKIPPED_TRANSFERRED' }>;
};

export type Guild5TurnTaxStats = {
  assessment_count: number;
  taxpayer_count: number;
  assessed_amount: number;
  collected_amount: number;
  outstanding_amount: number;
  surcharge_count: number;
  surcharge_assessed_amount: number;
  voided_count: number;
  voided_assessed_amount: number;
  refunded_amount: number;
  auction_rounds: number[];
};

export type Guild5ConquestTurnOps = {
  turn_id: number;
  version_id: number;
  rank_position: number;
  guild_id: number;
  guild_name?: string | null;
  roster_count: number;
  distribution_divisor: number;
  turn_status: 'WAITING' | 'ACTIVE' | 'ASSIGNED' | 'AUTO_ASSIGNED';
  assignment_method?: 'MANUAL' | 'AUTO' | null;
  chosen_at?: string | null;
  territory_id?: number | null;
  territory_name?: string | null;
  slot_no?: number | null;
  auction_category?: Guild5TerritoryCategory | null;
  rate_snapshot?: number | null;
  settlement: Guild5RateSettlement | null;
  objections: Guild5Objection[];
  tax: Guild5TurnTaxStats;
  distributions: Guild5TaxDistribution[];
  distributed_basis: number;
  distributable_amount: number;
};

export type Guild5ConquestOps = {
  year_month: string;
  finalized: boolean;
  closure_id?: number | null;
  version_id?: number | null;
  vote_threshold: number;
  economy: Array<{
    slot_no: number;
    auction_category: Guild5TerritoryCategory;
    auction_id?: number | null;
    auction_round_number?: number | null;
    auction_ended_at?: string | null;
    settled_item_count?: number;
    auction_gold_spend?: number;
    super_pass_consumed_count?: number;
    super_pass_equivalent_value?: number;
    gross_spend?: number;
    territory_name?: string | null;
  }>;
  auction_id?: number | null;
  guilds: Array<{ guild_id: number; guild_name: string; rank_position?: number | null; roster_count: number }>;
  guild_spend: Array<{
    guild_id: number;
    auction_category: Guild5TerritoryCategory;
    gold_spend: number;
    item_count: number;
    super_pass_count: number;
    super_pass_unit_value: number;
  }>;
  turns: Guild5ConquestTurnOps[];
  prior_tax_conflicts: Array<{
    prior_version_id: number;
    prior_year_month: string;
    slot_no: number;
    territory_name: string;
    auction_category: Guild5TerritoryCategory;
    auction_round_number: number;
    owner_guild_name?: string | null;
    assessment_count: number;
    assessed_amount: number;
    collected_amount: number;
  }>;
  student_count: number;
};

export type Guild5ConquestHistory = Array<{
  year_month: string;
  closure_id: number;
  version_id: number;
  version_no: number;
  finalized_at: string;
  conquest_status: string;
  rankings: Array<{ guild_id: number; guild_name: string; rank_position: number; total_gs: number; roster_count: number }>;
  economy: Array<{ slot_no: number; auction_category: Guild5TerritoryCategory; auction_round_number?: number | null; auction_gold_spend?: number; gross_spend?: number }>;
  territories: Guild5ConquestTurnOps[];
}>;

export const guild5ConquestRpc = {
  ops: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Guild5ConquestOps>(c, 'teacher_get_guild5_conquest_ops', S.YearMonthSchema, input),
  history: (c: SupabaseClient) => call<{}, Guild5ConquestHistory>(c, 'teacher_get_guild5_conquest_history', S.NoArgsSchema, {}),
  declareRate: (c: SupabaseClient, input: S.DeclareTerritoryRateInput) => call<S.DeclareTerritoryRateInput, Guild5RateSettlement>(c, 'teacher_declare_guild5_territory_rate', S.DeclareTerritoryRateSchema, input),
  fileObjection: (c: SupabaseClient, input: S.FileObjectionInput) => call<S.FileObjectionInput, Guild5Objection>(c, 'teacher_file_guild5_territory_objection', S.FileObjectionSchema, input),
  withdrawObjection: (c: SupabaseClient, input: S.WithdrawObjectionInput) => call<S.WithdrawObjectionInput, Guild5Objection>(c, 'teacher_withdraw_guild5_territory_objection', S.WithdrawObjectionSchema, input),
  recordVote: (c: SupabaseClient, input: S.ObjectionVoteInput) => call<S.ObjectionVoteInput, Guild5Objection>(c, 'teacher_record_guild5_objection_vote', S.ObjectionVoteSchema, input),
  finalizeRate: (c: SupabaseClient, input: S.SettlementIdInput) => call<S.SettlementIdInput, Record<string, any>>(c, 'teacher_finalize_guild5_territory_rate', S.SettlementIdSchema, input),
  distribute: (c: SupabaseClient, input: S.DistributeTaxInput) => call<S.DistributeTaxInput, Record<string, any>>(c, 'teacher_distribute_guild5_territory_tax', S.DistributeTaxSchema, input),
  refundPriorTax: (c: SupabaseClient, input: S.PriorTaxRefundInput) => call<S.PriorTaxRefundInput, Record<string, any>>(c, 'teacher_refund_guild5_prior_territory_tax', S.PriorTaxRefundSchema, input),
};

export const guild5StudentRpc = {
  history: (c: SupabaseClient) => call<{}, Guild5StudentHistory>(c, 'student_get_guild5_monthly_history', S.NoArgsSchema, {}),
};

export function guild5RpcError(result: unknown, fallback = 'Guild5 작업을 완료하지 못했습니다.') {
  if (result && typeof result === 'object' && 'error' in result) {
    const value = (result as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}
