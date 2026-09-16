import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type RaidElement = 'FIRE' | 'WATER' | 'WIND' | 'EARTH' | 'LIGHT' | 'DARK';
export type RaidStatus =
  | 'DRAFT'
  | 'LOBBY_OPEN'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ARCHIVED';

export interface TeacherRaidSummary {
  id: number;
  title: string;
  boss_name: string;
  boss_element: RaidElement;
  status: RaidStatus;
  max_hp: number;
  current_hp: number;
  lobby_open_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  created_at: string;
  phase_count: number;
  participant_count: number;
}

export interface TeacherRaidControlBoard {
  raids: TeacherRaidSummary[];
}

export interface TeacherRaidHitZone {
  id: number;
  zone_key: string;
  name: string;
  shape: 'RECT' | 'CIRCLE';
  x: number;
  y: number;
  width: number;
  height: number;
  damage_multiplier: number;
  weak_element: RaidElement | null;
  element_multiplier: number;
  is_active: boolean;
  is_visible_to_student: boolean;
  priority: number;
}

export interface TeacherRaidPhase {
  id: number;
  phase_no: number;
  hp_from_ratio: number;
  hp_to_ratio: number;
  boss_element: RaidElement | null;
  image_url: string | null;
  loop_video_url: string | null;
  damage_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  hit_zones: TeacherRaidHitZone[];
}

export interface TeacherRaidDetailRow {
  id: number;
  classroom_id: number;
  title: string;
  boss_name: string;
  boss_description: string | null;
  boss_element: RaidElement;
  status: RaidStatus;
  max_hp: number;
  current_hp: number;
  lobby_open_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  damage_coefficient: number;
  variance_min: number;
  variance_max: number;
  crit_multiplier: number;
  tap_rate_limit_per_second: number;
  chat_enabled: boolean;
  chat_slow_mode_seconds: number;
  include_test_accounts: boolean;
  reward_config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TeacherRaidDetail {
  raid: TeacherRaidDetailRow;
  phases: TeacherRaidPhase[];
}

export interface TeacherRaidLiveStudent {
  student_id: number;
  name: string;
  brand_name: string | null;
  guild_name: string | null;
  raid_power: number;
  final_crit_bp: number;
  total_damage: number;
  accepted_taps: number;
  crit_count: number;
  attack_blocked: boolean;
  last_attack_at: string | null;
}

export interface TeacherRaidLiveDashboard {
  raid: {
    id: number;
    title: string;
    boss_name: string;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    hp_ratio: number;
    starts_at: string | null;
    ends_at: string | null;
    completed_at: string | null;
  };
  summary: {
    participant_count: number;
    attack_participant_count: number;
    total_damage: number;
    accepted_taps: number;
    rejected_taps: number;
    crit_count: number;
  };
  students: TeacherRaidLiveStudent[];
}

export interface TeacherRaidE3TestPresetResult {
  raid_id: number;
  status: RaidStatus;
  pattern_count: number;
  first_trigger_seconds: number;
  last_trigger_seconds: number;
  preset_version: number;
}

// RAID_V15_E4A_BROADCAST_RPC
// RAID_V15_E4B_BROADCAST_PARTICIPANTS
export interface TeacherRaidBroadcastParticipant {
  participant_id: number;
  student_id: number;
  name: string;
  brand_name: string | null;
  guild_id: number | null;
  guild_name: string | null;
  guild_logo_url: string | null;
  character_id: number | null;
  character_name: string | null;
  character_image_url: string | null;
  raid_power: number;
  final_crit_bp: number;
  total_damage: number;
  accepted_taps: number;
  crit_count: number;
  last_attack_at: string | null;
  attack_blocked: boolean;
  barrier_contributor: boolean;
  latest_batch: { id: number; created_at: string; accepted_taps: number; total_damage: number; crit_count: number } | null;
}

export interface TeacherRaidBroadcastState {
  server_now: string;
  raid: {
    id: number; title: string; boss_name: string; boss_element: RaidElement; status: RaidStatus;
    max_hp: number; current_hp: number; hp_ratio: number; damage_coefficient: number;
    lobby_open_at: string | null; starts_at: string | null; ends_at: string | null; completed_at: string | null; end_reason: string | null;
    phase: { id: number; phase_no: number; image_url: string | null; loop_video_url: string | null } | null;
  };
  combat: {
    barrier_enabled: boolean; barrier_max_hp: number; barrier_current_hp: number; barrier_ratio: number;
    barrier_state: 'DISABLED' | 'STABLE' | 'CRACKED' | 'DANGER' | 'CRITICAL' | 'COLLAPSED';
    barrier_contributor_count: number; barrier_resonance_sum: number; enrage_active: boolean;
    groggy_until: string | null; groggy_active: boolean; groggy_damage_multiplier: number; active_pattern_run_id: number | null;
    active_pattern: { run_id: number; pattern_id: number; seq: number; name: string; pattern_type: string; started_at: string; ends_at: string; seconds_remaining: number; config: Record<string, unknown>; state: Record<string, unknown> } | null;
    boss_attack: { name: string; seq: number; telegraph_seconds: number; next_attack_at: string | null; seconds_until_next_attack: number | null; last_attack_at: string | null; last_damage: number } | null;
    updated_at: string | null;
  };
  summary: { participant_count: number; active_attacker_count: number; total_damage: number; accepted_taps: number; crit_count: number };
  participants: TeacherRaidBroadcastParticipant[];
}

export interface RaidEditorPayload {
  title: string;
  boss_name: string;
  boss_description: string | null;
  boss_element: RaidElement;
  max_hp: number;
  ends_at: string | null;
  damage_coefficient: number;
  variance_min: number;
  variance_max: number;
  crit_multiplier: number;
  tap_rate_limit_per_second: number;
  chat_enabled: boolean;
  chat_slow_mode_seconds: number;
  include_test_accounts: boolean;
  image_url?: string | null;
  loop_video_url?: string | null;
  reward_config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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

export const raidAdminRpc = {
  board: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<TeacherRaidControlBoard>(supabase, 'teacher_get_raid_control_board', {
      p_classroom_id: classroomId,
    }),

  detail: (supabase: SupabaseClient, raidId: number) =>
    callRpc<TeacherRaidDetail>(supabase, 'teacher_get_raid_detail', {
      p_raid_id: raidId,
    }),

  create: (
    supabase: SupabaseClient,
    classroomId: number,
    payload: RaidEditorPayload,
  ) =>
    callRpc<number>(supabase, 'teacher_create_raid', {
      p_classroom_id: classroomId,
      p_payload: payload,
    }),

  update: (
    supabase: SupabaseClient,
    raidId: number,
    payload: RaidEditorPayload,
  ) =>
    callRpc<void>(supabase, 'teacher_update_raid', {
      p_raid_id: raidId,
      p_payload: payload,
    }),

  clone: (
    supabase: SupabaseClient,
    sourceRaidId: number,
    newTitle: string | null,
  ) =>
    callRpc<number>(supabase, 'teacher_clone_raid', {
      p_source_raid_id: sourceRaidId,
      p_new_title: newTitle,
    }),

  savePhase: (
    supabase: SupabaseClient,
    raidId: number,
    phaseNo: number,
    payload: Record<string, unknown>,
  ) =>
    callRpc<number>(supabase, 'teacher_save_raid_phase', {
      p_raid_id: raidId,
      p_phase_no: phaseNo,
      p_payload: payload,
    }),

  broadcastState: (supabase: SupabaseClient, raidId: number) =>
    callRpc<TeacherRaidBroadcastState>(supabase, 'teacher_get_raid_broadcast_state', {
      p_raid_id: raidId,
    }),

  applyE3TestPreset: (supabase: SupabaseClient, raidId: number) =>
    callRpc<TeacherRaidE3TestPresetResult>(supabase, 'teacher_apply_raid_e3_test_preset', {
      p_raid_id: raidId,
    }),

  openLobby: (supabase: SupabaseClient, raidId: number) =>
    callRpc<void>(supabase, 'teacher_open_raid_lobby', { p_raid_id: raidId }),

  start: (supabase: SupabaseClient, raidId: number) =>
    callRpc<{
      raid_id: number;
      status: RaidStatus;
      participant_count: number;
      max_hp: number;
    }>(supabase, 'teacher_start_raid', { p_raid_id: raidId }),

  pause: (supabase: SupabaseClient, raidId: number) =>
    callRpc<void>(supabase, 'teacher_pause_raid', { p_raid_id: raidId }),

  resume: (supabase: SupabaseClient, raidId: number) =>
    callRpc<void>(supabase, 'teacher_resume_raid', { p_raid_id: raidId }),

  end: (supabase: SupabaseClient, raidId: number, reason: string | null) =>
    callRpc<RaidStatus>(supabase, 'teacher_end_raid', {
      p_raid_id: raidId,
      p_reason: reason,
    }),

  live: (supabase: SupabaseClient, raidId: number) =>
    callRpc<TeacherRaidLiveDashboard>(supabase, 'teacher_get_raid_live_dashboard', {
      p_raid_id: raidId,
    }),

  setChatEnabled: (
    supabase: SupabaseClient,
    raidId: number,
    enabled: boolean,
  ) =>
    callRpc<void>(supabase, 'teacher_set_raid_chat_enabled', {
      p_raid_id: raidId,
      p_enabled: enabled,
    }),
};
