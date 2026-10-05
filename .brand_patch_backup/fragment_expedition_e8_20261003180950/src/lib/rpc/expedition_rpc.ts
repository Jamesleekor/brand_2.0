import type { SupabaseClient } from '@supabase/supabase-js';

export type ExpeditionElementCode = 'WATER' | 'FIRE' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';
export type ExpeditionSpecialtyCode = 'RUINS' | 'NATURE' | 'SANCTUARY';
export type ExpeditionPhase = 'HIDDEN' | 'PREVIEW' | 'SAT' | 'SUN' | 'CLOSED' | 'NONE';
export type ExpeditionFitGrade = 'VULNERABLE' | 'NORMAL' | 'STABLE' | 'STRONG';

export interface ExpeditionSiteBoardRow {
  week_site_id: number;
  slot: number;
  site_code: string;
  site_name: string;
  specialty_code: ExpeditionSpecialtyCode;
  specialty_label: string;
  core_reward_code: 'EXPEDITION_BOX' | 'GOLD' | 'FRAGMENT';
  core_reward_label: string;
  world_effect_code: 'RESTORE' | 'SHOP' | 'SUPPLY' | 'RECORD' | 'COSMETIC';
  world_effect_label: string;
  environment_label: string;
  major_element: ExpeditionElementCode;
  minor_element: ExpeditionElementCode;
  sunday_environment_changed: boolean;
  weekly_trace: number;
  weekly_participants: number;
  saturday_trace: number;
  saturday_participants: number;
}

export interface ExpeditionCharacterBoardRow {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  resource_kind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
  resource_url: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
  emoji: string | null;
  element_budget: number;
  primary_element: ExpeditionElementCode;
  primary_points: number;
  secondary_element: ExpeditionElementCode | null;
  secondary_points: number;
  specialty_code: ExpeditionSpecialtyCode;
  recovery_required: boolean;
}

export interface ExpeditionRunMember {
  slot: number;
  character_id: number;
  character_uid: string;
  character_name: string;
  element_budget: number;
  primary_element: ExpeditionElementCode;
  primary_points: number;
  secondary_element: ExpeditionElementCode | null;
  secondary_points: number;
  specialty_code: ExpeditionSpecialtyCode;
  specialty_matched: boolean;
  major_points: number;
  minor_points: number;
}

export interface ExpeditionRunResult {
  run_id: number;
  classroom_id: number;
  student_id: number;
  week_id: number;
  week_site_id: number;
  phase: 'SAT' | 'SUN';
  fit_formula_version: 'ELEM_70_30_V1';
  fit_percent: number;
  fit_grade: ExpeditionFitGrade;
  fit_grade_ko: '취약' | '보통' | '안정' | '강인';
  trace_contribution: 1 | 2 | 3;
  counts_for_world: boolean;
  submitted_at: string;
  site: {
    site_name: string;
    specialty_code: ExpeditionSpecialtyCode;
    environment_label: string;
  };
  members: ExpeditionRunMember[];
}

export interface ExpeditionBoard {
  enabled: boolean;
  reason?: 'NOT_CONFIGURED' | 'FEATURE_DISABLED';
  message?: string;
  server_now: string;
  core_enabled?: boolean;
  student_ui_enabled?: boolean;
  student?: {
    student_id: number;
    classroom_id: number;
    is_test_account: boolean;
  };
  week: null | {
    week_id: number;
    week_index: number;
    week_start_date: string;
    status: 'PUBLISHED';
    reward_mode: 'DRY_RUN' | 'LIVE';
    phase: ExpeditionPhase;
    publish_at: string;
    sat_open_at: string;
    sun_open_at: string;
    sun_close_at: string;
    settle_at: string;
    fit_formula_version: 'ELEM_70_30_V1';
  };
  sites?: ExpeditionSiteBoardRow[];
  characters?: ExpeditionCharacterBoardRow[];
  my_sat_run?: ExpeditionRunResult | null;
  my_sun_run?: ExpeditionRunResult | null;
  can_submit_sat?: boolean;
  can_submit_sun?: boolean;
}

export interface ExpeditionFitPreview {
  fit_formula_version: 'ELEM_70_30_V1';
  week_id: number;
  week_site_id: number;
  phase: 'SAT' | 'SUN';
  major_element: ExpeditionElementCode;
  minor_element: ExpeditionElementCode;
  major_sum: number;
  minor_sum: number;
  specialty_match_count: number;
  major_component: number;
  minor_component: number;
  specialty_bonus: number;
  fit_percent: number;
  fit_grade: ExpeditionFitGrade;
  fit_grade_ko: '취약' | '보통' | '안정' | '강인';
  trace_contribution: 1 | 2 | 3;
  members: ExpeditionRunMember[];
  server_now: string;
  can_submit: boolean;
}

export interface ExpeditionSubmitResult {
  success: true;
  idempotent_replay: boolean;
  already_submitted: boolean;
  run: ExpeditionRunResult;
  weekly_site_trace?: number;
}

export type ExpeditionRpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<ExpeditionRpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const expeditionRpc = {
  board: (supabase: SupabaseClient) =>
    callRpc<ExpeditionBoard>(supabase, 'student_get_expedition_board'),

  preview: (
    supabase: SupabaseClient,
    weekSiteId: number,
    characterIds: number[],
  ) =>
    callRpc<ExpeditionFitPreview>(supabase, 'student_preview_expedition', {
      p_week_site_id: weekSiteId,
      p_character_ids: characterIds,
    }),

  submit: (
    supabase: SupabaseClient,
    weekSiteId: number,
    characterIds: number[],
    clientRequestId: string,
  ) =>
    callRpc<ExpeditionSubmitResult>(supabase, 'student_submit_expedition', {
      p_week_site_id: weekSiteId,
      p_character_ids: characterIds,
      p_client_request_id: clientRequestId,
    }),
};
