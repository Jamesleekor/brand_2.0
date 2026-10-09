import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type ExpeditionPhase = 'FRI' | 'SAT' | 'SUN' | 'CLOSED' | string;
export type ExpeditionSpecialtyCode = 'RUINS' | 'NATURE' | 'SANCTUARY';
export type ExpeditionElementCode = 'WATER' | 'FIRE' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';
export type ExpeditionRewardKind = 'EXPEDITION_BOX' | 'GOLD' | 'FRAGMENT';

export interface ExpeditionWeekInfo {
  week_id: number;
  week_index: number;
  week_start_date: string;
  status: string;
  reward_mode: 'DRY_RUN' | 'LIVE';
  phase: ExpeditionPhase;
  publish_at: string;
  sat_open_at: string;
  sun_open_at: string;
  sun_close_at: string;
  settle_at: string;
  fit_formula_version: string;
}

export interface ExpeditionSiteRow {
  week_site_id: number;
  slot: number;
  site_code: string;
  site_name: string;
  specialty_code: ExpeditionSpecialtyCode;
  specialty_label: string;
  core_reward_code: ExpeditionRewardKind;
  core_reward_label: string;
  world_effect_code: string;
  world_effect_label: string;
  environment_label: string;
  major_element: ExpeditionElementCode;
  minor_element: ExpeditionElementCode;
  sunday_environment_changed: boolean;
  weekly_trace: number;
  weekly_participants: number;
  saturday_trace: number;
  saturday_participants: number;
  cumulative_trace: number;
  story_stage: number;
  story_stage_label: string;
  mastery_level: number;
  mastery_label: string;
}

export interface ExpeditionCharacterRow {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  resource_kind: string | null;
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

export interface ExpeditionRewardResult {
  reward_mode: 'DRY_RUN' | 'LIVE';
  reward_tier: 'COMMON' | 'INTERMEDIATE' | 'RARE';
  reward_tier_ko: string;
  reward_kind: ExpeditionRewardKind;
  reward_code: string;
  quantity: number;
  reward_label: string;
  claim_status: 'UNCLAIMED' | 'SIMULATED' | 'GRANTED' | string;
  claimed_at: string | null;
  asset_result: {
    item_id?: number;
    quantity?: number;
    owned_quantity?: number;
    lot_id?: number;
    inventory_event_id?: number;
    transaction_id?: number;
    gold_granted?: number;
    ledger_id?: number;
    balance_after?: number;
  } | null;
}

export interface ExpeditionRunRecordResult {
  record_formula_version: string;
  field_record: {
    title: string;
    text: string;
  };
  discovery: {
    chance_percent: number;
    attempted: boolean;
    roll_bp: number | null;
    success: boolean;
    already_unlocked: boolean;
    new_permanent_unlock: boolean;
    unlocked: boolean;
    title: string | null;
    text: string | null;
  };
}

export interface ExpeditionRunResult {
  run_id: number;
  classroom_id: number;
  student_id: number;
  week_id: number;
  week_site_id: number;
  phase: 'SAT' | 'SUN';
  fit_formula_version: string;
  fit_percent: number;
  fit_grade: string;
  fit_grade_ko: string;
  trace_contribution: number;
  counts_for_world: boolean;
  submitted_at: string;
  site: {
    site_code: string;
    site_name: string;
    specialty_code: ExpeditionSpecialtyCode;
    environment_label: string;
  };
  reward: ExpeditionRewardResult | null;
  record: ExpeditionRunRecordResult | null;
  members: ExpeditionRunMember[];
}

export interface ExpeditionSundayPopup {
  week_id: number;
  week_site_id: number;
  site_code: string;
  site_name: string;
  saturday_participants: number;
  saturday_trace: number;
  cumulative_trace: number;
  highest_story_stage: number;
  highest_story_stage_label: string;
  site_message_title: string;
  site_message_text: string;
  event_title: string;
  event_text: string;
  old_major_element: ExpeditionElementCode;
  new_major_element: ExpeditionElementCode;
  minor_element: ExpeditionElementCode;
}

export interface ExpeditionBoard {
  enabled: boolean;
  reason?: string;
  message?: string;
  server_now: string;
  core_enabled?: boolean;
  student_ui_enabled?: boolean;
  student?: {
    student_id: number;
    classroom_id: number;
    is_test_account: boolean;
  };
  week: ExpeditionWeekInfo | null;
  sites?: ExpeditionSiteRow[];
  characters?: ExpeditionCharacterRow[];
  my_sat_run?: ExpeditionRunResult | null;
  my_sun_run?: ExpeditionRunResult | null;
  sunday_popup?: ExpeditionSundayPopup | null;
  can_submit_sat?: boolean;
  can_submit_sun?: boolean;
}

export interface ExpeditionPreview {
  fit_formula_version: string;
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
  fit_grade: string;
  fit_grade_ko: string;
  trace_contribution: number;
  members: ExpeditionRunMember[];
  server_now: string;
  can_submit: boolean;
}

export interface ExpeditionSubmitResult {
  success: boolean;
  idempotent_replay: boolean;
  already_submitted: boolean;
  run: ExpeditionRunResult;
  weekly_site_trace?: number;
}

export interface ExpeditionClaimResult {
  success: boolean;
  already_claimed: boolean;
  claim_status: string;
  asset_write_performed?: boolean;
  asset_result?: Record<string, unknown>;
  run: ExpeditionRunResult;
}

export interface ExpeditionFragmentWallet {
  student_id: number;
  classroom_id: number;
  balance: number;
  restore_discount_percent: number;
  restorable_characters: Array<{
    character_id: number;
    character_uid: string;
    name: string;
    epithet: string | null;
    resource_kind: string | null;
    resource_url: string | null;
    card_image_url: string | null;
    avatar_image_url: string | null;
    emoji: string | null;
    base_cost: number | null;
    effective_cost: number | null;
    restore_eligible: boolean;
    is_owned: boolean;
  }>;
}

export interface ExpeditionRestoreResult {
  success: boolean;
  idempotent_replay: boolean;
  restoration_id: number;
  character_id: number;
  character_uid: string;
  character_name: string;
  ownership_id: number;
  base_cost: number;
  discount_percent: number;
  final_cost: number;
  fragment_balance: number;
}

export interface ExpeditionChronicleSite {
  site_code: string;
  site_name: string;
  specialty_code: ExpeditionSpecialtyCode;
  core_reward_code: ExpeditionRewardKind;
  core_reward_label: string;
  world_effect_code: string;
  world_effect_label: string;
  cumulative_trace: number;
  story_stage: number;
  story_stage_label: string;
  mastery_level: number;
  mastery_label: string;
  field_record_unlocked: boolean;
  discovery_unlocked: boolean;
  discovered_at: string | null;
}

export interface ExpeditionChronicle {
  student_id: number;
  classroom_id: number;
  season: {
    season_id: number;
    season_code: string;
    name: string;
  } | null;
  active_world_effect: {
    id: number;
    week_id: number;
    week_site_id: number;
    site_id: number;
    effect_code: string;
    effect_level: number;
    starts_at: string;
    ends_at: string;
  } | null;
  sites: ExpeditionChronicleSite[];
  recent_runs: ExpeditionRunResult[];
}

export interface ExpeditionSiteStory {
  site_code: string;
  site_name: string;
  cumulative_trace: number;
  highest_story_stage: number;
  highest_story_stage_label: string;
  mastery_level: number;
  mastery_label: string;
  intro_text: string;
  stages: Array<{
    stage: number;
    threshold: number;
    label: string;
    unlocked: boolean;
    title: string | null;
    text: string | null;
    short_result: string | null;
  }>;
  field_record: {
    unlocked: boolean;
    title: string | null;
    text: string | null;
  };
  discovery_record: {
    unlocked: boolean;
    title: string | null;
    text: string | null;
    discovered_at: string | null;
  };
}

export interface ExpeditionLuxuryItem {
  item_id: number;
  item_uid: string;
  name: string;
  description: string | null;
  resource_url: string;
  category: string;
  luxury_group: 'A' | 'B' | 'C';
  required_effect_level: number;
  presentation_kind: string;
  owned: boolean;
  pricing: Array<{
    pricing_id: number;
    value_token: string;
    price: number;
    condition_description: string | null;
  }>;
}

export interface ExpeditionLuxuryShop {
  open: boolean;
  access_level: number;
  active_effect: ExpeditionChronicle['active_world_effect'];
  items: ExpeditionLuxuryItem[];
  assets_pending: boolean;
}

export interface ExpeditionBoxInventory {
  student_id: number;
  classroom_id: number;
  boxes: Array<{
    item_id: number;
    name: string;
    tier: 'COMMON' | 'INTERMEDIATE' | 'RARE';
    available_quantity: number;
  }>;
}

export interface ExpeditionBoxCatalogReward {
  reward_code: string;
  reward_kind: string;
  label: string;
  weight_bp: number;
  probability_percent: number;
}

export interface ExpeditionBoxCatalogTier {
  tier: 'COMMON' | 'INTERMEDIATE' | 'RARE';
  tier_label: string;
  rewards: ExpeditionBoxCatalogReward[];
}

export interface ExpeditionBoxCatalog {
  version: string;
  tiers: ExpeditionBoxCatalogTier[];
}

export interface ExpeditionBoxOpenResult {
  opening_id: number;
  box_item_id: number;
  box_tier: string;
  roll_value: number;
  catalog_reward_code: string;
  catalog_reward_kind: string;
  final_reward_kind: string;
  final_reward_label: string;
  final_quantity: number | null;
  status: string;
  cosmetic_fallback_crystal: boolean;
  final_inventory_item_id: number | null;
  final_cosmetic_item_id: number | null;
  opened_at: string;
  remaining_box_quantity: number;
  idempotent_replay: boolean;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const expeditionRpc = {
  board: (supabase: SupabaseClient) =>
    callRpc<ExpeditionBoard>(supabase, 'student_get_expedition_board'),

  preview: (supabase: SupabaseClient, weekSiteId: number, characterIds: number[]) =>
    callRpc<ExpeditionPreview>(supabase, 'student_preview_expedition', {
      p_week_site_id: weekSiteId,
      p_character_ids: characterIds,
    }),

  submit: (
    supabase: SupabaseClient,
    weekSiteId: number,
    characterIds: number[],
    requestId: string,
  ) =>
    callRpc<ExpeditionSubmitResult>(supabase, 'student_submit_expedition', {
      p_week_site_id: weekSiteId,
      p_character_ids: characterIds,
      p_client_request_id: requestId,
    }),

  claim: (supabase: SupabaseClient, runId: number, requestId: string) =>
    callRpc<ExpeditionClaimResult>(supabase, 'student_claim_expedition_reward', {
      p_run_id: runId,
      p_client_request_id: requestId,
    }),

  fragmentWallet: (supabase: SupabaseClient) =>
    callRpc<ExpeditionFragmentWallet>(supabase, 'student_get_expedition_fragment_wallet'),

  restore: (supabase: SupabaseClient, characterId: number, requestId: string) =>
    callRpc<ExpeditionRestoreResult>(supabase, 'student_restore_expedition_character', {
      p_character_id: characterId,
      p_client_request_id: requestId,
    }),

  acknowledgeSundayPopup: (supabase: SupabaseClient, weekId: number) =>
    callRpc<{ acknowledged: boolean; week_id?: number; reason?: string }>(
      supabase,
      'student_ack_expedition_sunday_popup',
      { p_week_id: weekId },
    ),

  chronicle: (supabase: SupabaseClient) =>
    callRpc<ExpeditionChronicle>(supabase, 'student_get_expedition_chronicle'),

  siteStory: (supabase: SupabaseClient, siteCode: string) =>
    callRpc<ExpeditionSiteStory>(supabase, 'student_get_expedition_site_story', {
      p_site_code: siteCode,
    }),

  luxuryShop: (supabase: SupabaseClient) =>
    callRpc<ExpeditionLuxuryShop>(supabase, 'student_get_expedition_luxury_shop'),

  boxInventory: (supabase: SupabaseClient) =>
    callRpc<ExpeditionBoxInventory>(supabase, 'student_get_expedition_box_inventory'),

  boxCatalog: (supabase: SupabaseClient) =>
    callRpc<ExpeditionBoxCatalog>(supabase, 'student_get_expedition_box_catalog'),

  purchaseLuxury: (supabase: SupabaseClient, itemId: number, pricingId: number) =>
    callRpc<number>(supabase, 'student_purchase_cosmetic', {
      p_item_id: itemId,
      p_pricing_id: pricingId,
    }),

  openBox: (supabase: SupabaseClient, boxItemId: number, requestId: string) =>
    callRpc<ExpeditionBoxOpenResult>(supabase, 'student_open_expedition_box', {
      p_box_item_id: boxItemId,
      p_client_request_id: requestId,
    }),
};

// E2 compatibility exports. Keep legacy local helper files type-safe while
// the E8 RPC surface uses the shorter canonical names above.
export type ExpeditionFitGrade = 'VULNERABLE' | 'NORMAL' | 'STABLE' | 'STRONG';
export type ExpeditionSiteBoardRow = ExpeditionSiteRow;
export type ExpeditionCharacterBoardRow = ExpeditionCharacterRow;
export type ExpeditionFitPreview = ExpeditionPreview;
export type ExpeditionRpcResult<T> = RpcResult<T>;
