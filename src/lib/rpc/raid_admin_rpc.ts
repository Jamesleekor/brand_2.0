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
