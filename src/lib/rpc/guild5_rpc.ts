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

export type Guild5TeacherDashboard = {
  preview: Guild5ClosePreview;
  season: Record<string, any> | null;
  season_lock: Record<string, any> | null;
  is_test_fixture?: boolean;
  territories: Array<Record<string, any>>;
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
  my_contribution: Record<string, any>;
  my_guild: Record<string, any>;
  territory?: Record<string, any> | null;
  rankings: Array<Record<string, any>>;
}>;

export const guild5TeacherRpc = {
  dashboard: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Guild5TeacherDashboard>(c, 'teacher_get_guild5_dashboard', S.YearMonthSchema, input),
  preview: (c: SupabaseClient, input: S.YearMonthInput) => call<S.YearMonthInput, Guild5ClosePreview>(c, 'teacher_get_guild5_close_preview', S.YearMonthSchema, input),
  setOverride: (c: SupabaseClient, input: S.OverrideInput) => call<S.OverrideInput, Guild5ClosePreview>(c, 'teacher_set_guild5_override', S.OverrideSchema, input),
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
