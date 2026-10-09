import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type ExpeditionAdminWeekStatus = 'DRAFT' | 'PUBLISHED' | 'SETTLED' | 'CANCELLED';
export type ExpeditionAdminRewardMode = 'DRY_RUN' | 'LIVE';
export type ExpeditionAdminPhase = 'NONE' | 'HIDDEN' | 'PREVIEW' | 'SAT' | 'SUN' | 'CLOSED';
export type ExpeditionSpecialtyCode = 'RUINS' | 'NATURE' | 'SANCTUARY';
export type ExpeditionCoreRewardCode = 'EXPEDITION_BOX' | 'GOLD' | 'FRAGMENT';
export type ExpeditionWorldEffectCode = 'RESTORE' | 'SHOP' | 'SUPPLY' | 'RECORD' | 'COSMETIC';

export interface ExpeditionAdminSettings {
  schema_version: string;
  core_enabled: boolean;
  student_ui_enabled: boolean;
  scheduler_enabled: boolean;
  reward_grant_enabled: boolean;
  publish_weekday: number;
  publish_time_kst: string;
  sat_open_time_kst: string;
  sun_open_time_kst: string;
  settle_time_kst: string;
  world_effect_start_time_kst: string;
  world_effect_duration_hours: number;
}

export interface ExpeditionAdminSeason {
  id: number;
  season_code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
}

export interface ExpeditionAdminSite {
  id: number;
  slot: number;
  site_id: number;
  site_code: string;
  site_name: string;
  specialty_code: ExpeditionSpecialtyCode;
  core_reward_code: ExpeditionCoreRewardCode;
  world_effect_code: ExpeditionWorldEffectCode;
  environment_label: string;
  saturday_major_element: string;
  saturday_minor_element: string;
  sunday_major_element: string;
  sunday_minor_element: string;
  sunday_event_applied: boolean;
  sunday_event_title: string | null;
  saturday_trace: number;
  saturday_participants: number;
  sunday_trace: number;
  sunday_participants: number;
  total_trace: number;
  total_participants: number;
  final_level: number | null;
  mastery_advanced: boolean;
  cumulative_trace: number;
  story_stage: number;
  mastery_level: number;
  is_dominant: boolean;
}

export interface ExpeditionAdminRewardSummary {
  tier: string;
  kind: string;
  quantity: number;
  claim_status: string;
}

export interface ExpeditionAdminRunSummary {
  run_id: number;
  week_site_id: number;
  site_name: string;
  fit_percent: number;
  fit_grade: string;
  trace: number;
  submitted_at: string;
  members: string[];
  reward: ExpeditionAdminRewardSummary | null;
}

export interface ExpeditionAdminStudent {
  student_id: number;
  name: string;
  brand_name: string | null;
  is_test_account: boolean;
  sat: ExpeditionAdminRunSummary | null;
  sun: ExpeditionAdminRunSummary | null;
}

export interface ExpeditionAdminOperation {
  code: string;
  completed_at: string;
  result: Record<string, unknown>;
}

export interface ExpeditionAdminWorldEffect {
  id: number;
  effect_code: ExpeditionWorldEffectCode;
  effect_level: number;
  starts_at: string;
  ends_at: string;
}

export interface ExpeditionAdminWeek {
  id: number;
  week_index: number;
  week_start_date: string;
  status: ExpeditionAdminWeekStatus;
  reward_mode: ExpeditionAdminRewardMode;
  phase: ExpeditionAdminPhase;
  publish_at: string;
  sat_open_at: string;
  sun_open_at: string;
  sun_close_at: string;
  settle_at: string;
  published_at: string | null;
  resolved_at: string | null;
  world_effect_level: number | null;
  dominant_week_site_id: number | null;
  sites: ExpeditionAdminSite[];
  students: ExpeditionAdminStudent[];
  operations: ExpeditionAdminOperation[];
  world_effect: ExpeditionAdminWorldEffect | null;
}

export interface ExpeditionReleaseValidation {
  ok: boolean;
  flags?: Record<string, boolean> | null;
  catalog?: {
    active_characters?: number;
    active_element_profiles?: number;
    active_character_profiles?: number;
    invalid_specialty_profiles?: number;
    orphan_active_profiles?: number;
    restorable_characters?: number;
    active_sites?: number;
    story_sites?: number;
    luxury_items?: number;
    luxury_assets_pending?: boolean;
  };
  integrity?: {
    bad_box_weight_tiers?: number;
    bad_world_effect_windows?: number;
    candidate_or_reroll_objects?: number;
    direct_browser_table_grants?: number;
    active_lifecycle_cron_jobs?: number;
    runs_without_reward_snapshot?: number;
    runs_without_record_snapshot?: number;
  };
  runtime_counts?: Record<string, number>;
}

export interface ExpeditionAdminBoard {
  server_now: string;
  classroom_id: number;
  season: ExpeditionAdminSeason | null;
  settings: ExpeditionAdminSettings;
  suggested_week_start: string | null;
  release_validation: ExpeditionReleaseValidation;
  active_world_effect: ExpeditionAdminWorldEffect | Record<string, unknown> | null;
  week: ExpeditionAdminWeek | null;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const expeditionAdminRpc = {
  board: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<ExpeditionAdminBoard>(supabase, 'teacher_get_expedition_admin_board', {
      p_classroom_id: classroomId,
    }),

  generateWeek: (supabase: SupabaseClient, classroomId: number, weekStartDate: string | null) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_generate_expedition_week', {
      p_classroom_id: classroomId,
      p_week_start_date: weekStartDate,
    }),

  setWeekMode: (supabase: SupabaseClient, weekId: number, rewardMode: ExpeditionAdminRewardMode) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_set_expedition_week_mode', {
      p_week_id: weekId,
      p_reward_mode: rewardMode,
    }),

  publishWeek: (supabase: SupabaseClient, weekId: number) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_publish_expedition_week', {
      p_week_id: weekId,
    }),

  reconcileSaturday: (supabase: SupabaseClient, weekId: number) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_reconcile_expedition_saturday', {
      p_week_id: weekId,
    }),

  settleWeek: (supabase: SupabaseClient, weekId: number) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_settle_expedition_week', {
      p_week_id: weekId,
    }),

  setFlags: (
    supabase: SupabaseClient,
    classroomId: number,
    flags: Pick<
      ExpeditionAdminSettings,
      'core_enabled' | 'student_ui_enabled' | 'scheduler_enabled' | 'reward_grant_enabled'
    >,
  ) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_set_expedition_flags', {
      p_classroom_id: classroomId,
      p_core_enabled: flags.core_enabled,
      p_student_ui_enabled: flags.student_ui_enabled,
      p_scheduler_enabled: flags.scheduler_enabled,
      p_reward_grant_enabled: flags.reward_grant_enabled,
    }),
};
