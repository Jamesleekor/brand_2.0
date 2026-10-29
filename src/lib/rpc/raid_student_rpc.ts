import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import type { RaidVisualConfigV1 } from '@/features/raid/visual/raidVisualTypes';

export type RaidElement = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';
// RAID_ELEMENT_V1_20261017
export interface RaidElementEffect {
  version?: 'OFF' | 'V1';
  type?: string;
  total_multiplier_bp: number;
  grade_bonus_bp?: number;
  matchup_bonus_bp?: number;
  focus_bp?: number;
  [key: string]: unknown;
}
export interface RaidElementOption {
  character_id: number;
  name: string;
  image_url: string | null;
  is_equipped: boolean;
  primary_element: RaidElement;
  primary_points: number;
  secondary_element: RaidElement | null;
  secondary_points: number;
  element_budget: number;
  effect: RaidElementEffect;
}
export interface RaidElementOptions {
  rules_version: 'OFF' | 'V1';
  raid_status: RaidStatus;
  boss_element: RaidElement;
  equipped_character_id: number | null;
  locked_equipped_character_id?: number | null;
  locked_equipped_character_name?: string | null;
  locked_equipped_character_image_url?: string | null;
  preview: RaidElementEffect;
  options: RaidElementOption[];
}

export type RaidStatus =
  | 'DRAFT'
  | 'LOBBY_OPEN'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ARCHIVED';

export interface RaidPortalRaid {
  id: number;
  title: string;
  boss_name: string;
  boss_description: string | null;
  boss_element: RaidElement;
  status: RaidStatus;
  max_hp: number;
  current_hp: number;
  hp_ratio: number;
  lobby_open_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  chat_enabled: boolean;
  phase_preview: {
    phase_no: number;
    image_url: string | null;
    loop_video_url: string | null;
  } | null;
}

export type ActiveRaidSummary = RaidPortalRaid;

export interface RaidPortalSummary {
  active: RaidPortalRaid | null;
  recent: RaidPortalRaid | null;
}

export interface RaidLobbyMe {
  student_id: number;
  name: string;
  brand_name: string | null;
  guild_id: number | null;
  guild_name: string | null;
  guild_logo_url: string | null;
  equipped_character_id: number | null;
  equipped_character_name: string | null;
  equipped_character_image_url: string | null;
}

// RAID_BETA1_LOBBY_PRESENCE_RPC_20260918
export interface RaidLobbyPresenceSnapshot {
  student_id: number;
  joined_at: string;
  last_seen_at: string;
}

export interface RaidLobbyMessage {
  id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  message: string;
  created_at: string;
}

export interface RaidLobbySnapshot {
  raid: {
    id: number;
    title: string;
    boss_name: string;
    boss_description: string | null;
    boss_element: RaidElement;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    chat_enabled: boolean;
    chat_slow_mode_seconds: number;
    lobby_open_at: string | null;
    starts_at: string | null;
    ends_at: string | null;
  };
  me: RaidLobbyMe;
  roster: RaidLobbyMe[];
  present_players: RaidLobbyPresenceSnapshot[];
  recent_messages: RaidLobbyMessage[];
}

export type RaidBarrierState =
  | 'DISABLED'
  | 'STABLE'
  | 'CRACKED'
  | 'DANGER'
  | 'CRITICAL'
  | 'COLLAPSED';

export interface RaidBossAttackState {
  name: string;
  interval_seconds: number;
  telegraph_seconds: number;
  fixed_damage: number;
  barrier_ratio: number;
  seq: number;
  next_attack_at: string | null;
  seconds_until_next_attack: number | null;
  last_attack_at: string | null;
  last_damage: number;
  damage_multiplier: number;
}

export type RaidPatternType =
  | 'WEAK_POINT'
  | 'BREAK'
  | 'ENRAGE'
  | 'ABSORB'
  | 'REFLECT'
  | 'BOSS_STRIKE'
  | 'ULTIMATE'
  | 'DOT'
  | 'SHIELD'
  | 'MULTI_CORE'
  | 'SPLIT_TARGET'
  | 'REGEN'
  | 'SEAL'
  | 'DAMAGE_CHECK';

// Backward-compatible alias for the E2 interfaces already used by the battle screen.
export type RaidE2PatternType = RaidPatternType;

export interface RaidActivePatternState {
  run_id: number;
  pattern_id: number;
  seq: number;
  name: string;
  pattern_type: RaidE2PatternType;
  started_at: string;
  ends_at: string;
  seconds_remaining: number;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

export interface RaidCombatState {
  barrier_enabled: boolean;
  barrier_max_hp: number;
  barrier_current_hp: number;
  barrier_ratio: number;
  barrier_state: RaidBarrierState;
  barrier_contributor_count: number;
  barrier_resonance_sum: number;
  enrage_active: boolean;
  enrage_boss_damage_multiplier: number;
  enrage_player_damage_multiplier: number;
  groggy_until: string | null;
  groggy_active: boolean;
  groggy_damage_multiplier: number;
  groggy_seconds_remaining: number;
  active_pattern_run_id: number | null;
  active_pattern: RaidActivePatternState | null;
  server_now: string;
  boss_attack: RaidBossAttackState | null;
  updated_at: string | null;
}

// RAID_CLASH_V1_20261028 — 격돌(CLASH) 공개 상태. 서버 raid_clash_public_state 응답과 같은 모양.
export type RaidClashDifficulty = 'EASY' | 'NORMAL' | 'HARD';
export type RaidClashPhase = 'VOLUNTEERING' | 'SELECTED' | 'PLAYING' | 'RESOLVED' | 'CANCELLED';
export type RaidClashJudgment = 'PERFECT' | 'GOOD' | 'BAD' | 'MISS';
export type RaidClashOutcome = 'GREAT_SUCCESS' | 'SUCCESS' | 'FAILED';
export type RaidClashKeyCode = 'KeyQ' | 'KeyW' | 'KeyE' | 'KeyR';

export interface RaidClashProfile {
  version: number;
  difficulty: RaidClashDifficulty;
  note_count: number;
  keys: RaidClashKeyCode[];
  volunteer_ms: number;
  volunteer_grace_ms: number;
  volunteer_button_delay_ms: number;
  reveal_ms: number;
  ready_timeout_ms: number;
  countdown_ms: number;
  latency_slack_ms: number;
  early_slack_ms: number;
  approach_ms: number;
  spacing_ms: number;
  perfect_ms: number;
  good_ms: number;
  bad_ms: number;
  points: Record<RaidClashJudgment, number>;
  success_score: number;
  great_score: number;
  weak_zone: RaidClashWeakZone;
}

export interface RaidClashWeakZone {
  x: number;
  y: number;
  width: number;
  height: number;
  multiplier: number;
}

export interface RaidClashEffects {
  GREAT_SUCCESS: { buff_seconds: number; block_seconds: number; clash_component: number };
  SUCCESS: { buff_seconds: number; block_seconds: number; clash_component: number };
  FAILED: { barrier_penalty_ratio_of_current: number };
}

export interface RaidClashSelected {
  participant_id: number;
  student_name: string | null;
  guild_name: string | null;
  guild_logo_url: string | null;
  character_name: string | null;
  character_image_url: string | null;
}

export interface RaidClashNote {
  index: number;
  key: RaidClashKeyCode;
  ideal_at: string;
}

export interface RaidClashSession {
  id: number;
  version: number;
  phase: RaidClashPhase;
  frozen: boolean;
  triggered_at: string;
  volunteer_closes_at: string;
  volunteer_accept_until: string;
  volunteer_count: number;
  i_volunteered: boolean;
  i_am_selected: boolean;
  selected: RaidClashSelected | null;
  selected_at: string | null;
  ready_deadline_at: string | null;
  play_starts_at: string | null;
  play_deadline_at: string | null;
  profile: RaidClashProfile;
  effects: RaidClashEffects;
  notes: RaidClashNote[] | null;
  inputs: Array<{ index: number; judgment: RaidClashJudgment; points: number }>;
  score: number;
  outcome: RaidClashOutcome | null;
  outcome_reason: string | null;
  resolved_at: string | null;
  frozen_seconds: number | null;
  buff_until: string | null;
  buff_active: boolean;
  boss_attack_block_until: string | null;
  clash_component: number;
  weak_zone: RaidClashWeakZone | null;
  barrier_penalty_amount: number | null;
}

export interface RaidClashPublicState {
  enabled: boolean;
  difficulty: RaidClashDifficulty;
  server_now: string;
  session: RaidClashSession | null;
}

export interface RaidClashActionResult {
  accepted: boolean;
  reason?: string | null;
  duplicate?: boolean;
  note_index?: number;
  judgment?: RaidClashJudgment;
  points?: number;
  flag?: string | null;
  clash: RaidClashPublicState;
}

export interface RaidBattleState {
  // RAID_CLASH_V1_20261028: 격돌 마이그레이션 전 서버에는 없을 수 있으므로 선택 필드로 둔다.
  clash?: RaidClashPublicState | null;
  raid: {
    id: number;
    title: string;
    boss_name: string;
    boss_element: RaidElement;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    hp_ratio: number;
    damage_coefficient: number;
    variance_min: number;
    variance_max: number;
    tap_rate_limit_per_second: number;
    crit_multiplier: number;
    end_reason: string | null;
    phase: {
      id: number;
      phase_no: number;
      image_url: string | null;
      loop_video_url: string | null;
      visual: RaidVisualConfigV1 | null;
    } | null;
  };
  combat: RaidCombatState;
  me: {
    participant_id: number;
    raid_power: number;
    element_multiplier_bp: number;
    element_effect: RaidElementEffect | null;
    base_crit_bp: number;
    shard_crit_bp: number;
    collection_crit_bp: number;
    final_crit_bp: number;
    total_damage: number;
    accepted_tap_count: number;
    crit_count: number;
    attack_blocked: boolean;
    barrier_contributor: boolean;
    barrier_contribution: number;
  };
}

export interface RaidCombatTickPatternResult {
  changed?: boolean;
  event?: string;
  pattern_type?: RaidE2PatternType;
  pattern_run_id?: number;
  pattern_name?: string;
  collapsed?: boolean;
  reason?: string;
}

export interface RaidCombatTickResult {
  raid_id: number;
  attack_applied: boolean;
  reason?: string;
  attack_seq?: number;
  attack_name?: string;
  damage?: number;
  barrier_hp_after?: number;
  barrier_ratio_after?: number;
  collapsed?: boolean;
  raid_status?: RaidStatus;
  next_boss_attack_at?: string | null;
  boss_attack_seq?: number;
  pattern?: RaidCombatTickPatternResult | null;
  pattern_event?: string;
  server_now: string;
}

export interface RaidTapInput {
  x: number;
  y: number;
  client_t?: number;
}

export interface RaidTapResultItem {
  accepted: boolean;
  reason?: string;
  damage?: number;
  raw_damage?: number;
  crit?: boolean;
  x?: number;
  y?: number;
  zone_key?: string;
  pattern_type?: RaidPatternType | null;
  pattern_effect?: string | null;
  pattern_multiplier?: number;
  groggy_multiplier?: number;
  enrage_multiplier?: number;
  efficiency_multiplier?: number;
  objective_damage?: number;
  reflected_damage?: number;
  boss_heal?: number;
  target_key?: string | null;
  target_label?: string | null;
  target_destroyed?: boolean;
}

export interface RaidTapBatchPatternResult {
  pattern_type: RaidPatternType;
  pattern_run_id: number;
  break_damage?: number;
  break_current_hp?: number | null;
  break_max_hp?: number | null;
  break_success?: boolean;
  pattern_success?: boolean;
  objective_damage?: number;
  objective_current_hp?: number | null;
  objective_max_hp?: number | null;
  reflected_damage?: number;
  boss_healed?: number;
}

export interface RaidTapBatchResult {
  raid_id: number;
  batch_id: string;
  requested: number;
  accepted: number;
  rejected: number;
  results: RaidTapResultItem[];
  raid_hp: number;
  raid_hp_ratio: number;
  my_total_damage: number;
  raid_status: RaidStatus;
  barrier_collapsed?: boolean;
  // RAID_CLASH_V1_20261028: 이번 묶음에서 격돌이 시작됐는지 / 격돌 중이라 모두 거절됐는지
  clash_triggered?: boolean;
  clash_active?: boolean;
  pattern?: RaidTapBatchPatternResult | null;
}

// RAID_V15_ATTACK_BACKPRESSURE_V2
export interface RaidTapBatchBusyResult {
  busy: true;
  retry_after_ms: number;
  raid_id: number;
  batch_id: string;
}

export type RaidTapBatchResponse = RaidTapBatchResult | RaidTapBatchBusyResult;

export function isRaidTapBatchBusyResult(
  value: RaidTapBatchResponse,
): value is RaidTapBatchBusyResult {
  return 'busy' in value && value.busy === true;
}

export interface RaidRankingRow {
  final_rank: number;
  student_id: number;
  name: string;
  brand_name: string | null;
  guild_id: number | null;
  guild_name: string | null;
  guild_logo_url: string | null;
  equipped_character_id: number | null;
  equipped_character_name: string | null;
  equipped_character_image_url: string | null;
  total_damage: number;
  owned_shard_count: number;
  raid_power: number;
  crit_rate: number;
  damage_share_percent: number;
  reward_snapshot: Record<string, unknown>;
}

export interface RaidMyResult {
  total_damage: number;
  average_damage: number;
  crit_count: number;
  actual_crit_rate: number;
  damage_share_percent: number;
  final_rank: number | null;
  reward_snapshot: Record<string, unknown>;
}

export interface RaidResult {
  raid: {
    id: number;
    title: string;
    boss_name: string;
    boss_element: RaidElement;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    starts_at: string | null;
    completed_at: string | null;
  };
  ranking: RaidRankingRow[];
  me: RaidMyResult | null;
}


async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return {
      success: false,
      type: 'SERVER',
      error: error.message,
      code: error.code,
    };
  }
  return { success: true, data: data as T };
}

export const raidStudentRpc = {
  portal: (supabase: SupabaseClient) =>
    callRpc<RaidPortalSummary>(supabase, 'get_raid_portal_summary'),

  active: (supabase: SupabaseClient) =>
    callRpc<ActiveRaidSummary | null>(supabase, 'get_active_raid'),

  lobby: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidLobbySnapshot>(supabase, 'get_raid_lobby_snapshot', {
      p_raid_id: raidId,
    }),

  elementOptions: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidElementOptions>(supabase, 'get_my_raid_element_options', { p_raid_id: raidId }),

  equipCharacter: (supabase: SupabaseClient, characterId: number) =>
    callRpc<void>(supabase, 'equip_character', { p_character_id: characterId }),

  sendLobbyMessage: (
    supabase: SupabaseClient,
    raidId: number,
    message: string,
  ) =>
    callRpc<RaidLobbyMessage>(supabase, 'send_raid_lobby_message', {
      p_raid_id: raidId,
      p_message: message,
    }),

  battleState: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidBattleState>(supabase, 'get_raid_battle_state', {
      p_raid_id: raidId,
    }),

  combatTick: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidCombatTickResult>(supabase, 'raid_combat_tick', {
      p_raid_id: raidId,
    }),

  submitTapBatch: (
    supabase: SupabaseClient,
    raidId: number,
    batchId: string,
    taps: RaidTapInput[],
  ) =>
    callRpc<RaidTapBatchResponse>(supabase, 'submit_raid_tap_batch', {
      p_raid_id: raidId,
      p_batch_id: batchId,
      p_taps: taps,
    }),

  result: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidResult>(supabase, 'get_raid_result', {
      p_raid_id: raidId,
    }),

  // RAID_CLASH_V1_20261028 — 격돌: 지원 / 준비 완료(대표만) / 노트 입력(대표만)
  volunteerClash: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidClashActionResult>(supabase, 'student_volunteer_raid_clash', {
      p_raid_id: raidId,
    }),

  readyClash: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidClashActionResult>(supabase, 'student_ready_raid_clash', {
      p_raid_id: raidId,
    }),

  submitClashInput: (
    supabase: SupabaseClient,
    raidId: number,
    noteIndex: number,
    keyCode: RaidClashKeyCode | null,
    offsetMs: number | null,
  ) =>
    callRpc<RaidClashActionResult>(supabase, 'student_submit_raid_clash_input', {
      p_raid_id: raidId,
      p_note_index: noteIndex,
      p_key_code: keyCode,
      p_offset_ms: offsetMs,
    }),
};
