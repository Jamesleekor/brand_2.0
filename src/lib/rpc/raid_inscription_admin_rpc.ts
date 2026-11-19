// RAID_INSCRIPTION_V1_20261118 — 「주문 각인」 교사용 RPC (설정 · 선발 · 발동 · 취소 · 기록)
// 선발 방식과 자동 발동 지점, 타락 회복량은 교사 화면에서만 보인다(학생·중계 화면에는 나가지 않음).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import type { RaidInscriptionDifficulty, RaidInscriptionPhase, RaidInscriptionPublicState } from './raid_student_rpc';

async function callRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export type RaidInscriptionSelectionMode = 'RANDOM' | 'TEACHER';

export interface RaidInscriptionPresetProfile {
  difficulty: 'EASY' | 'NORMAL' | 'HARD';
  letter_count: number;
  use_gh: boolean;
  time_limit_ms: number;
  boss_damage_ratio: number;
  barrier_heal_ratio: number;
  corruption_count: number;
  corruption_seconds: number;
  [key: string]: unknown;
}

export interface RaidInscriptionTeacherConfig {
  raid_id: number;
  raid_status: string;
  editable: boolean;
  configured: boolean;
  enabled: boolean;
  difficulty: RaidInscriptionDifficulty;
  letter_count: number;
  use_gh: boolean;
  time_limit_seconds: number;
  player_count: number;
  auto_trigger_percents: number[];
  boss_damage_percent: number;
  barrier_heal_percent: number;
  corruption_count: number;
  corruption_seconds: number;
  corruption_label: string;
  selection_mode: RaidInscriptionSelectionMode;
  presets: Record<'EASY' | 'NORMAL' | 'HARD', RaidInscriptionPresetProfile>;
}

export interface RaidInscriptionConfigPayload {
  enabled: boolean;
  difficulty: RaidInscriptionDifficulty;
  letter_count?: number;
  use_gh?: boolean;
  time_limit_seconds?: number;
  player_count: number;
  auto_trigger_percents: number[];
  boss_damage_percent: number;
  barrier_heal_percent: number;
  corruption_count: number;
  corruption_seconds: number;
  corruption_label: string;
  selection_mode: RaidInscriptionSelectionMode;
}

export interface RaidInscriptionPickVolunteer {
  participant_id: number;
  student_id: number;
  student_name: string;
  guild_name: string | null;
  attack_blocked: boolean;
  volunteered_at: string;
  /** 지난 각인에서 각인자로 뽑힌 횟수(이 학생 전체 레이드 기준) */
  inscription_count_total: number;
  /** 지난 각인 평균 완성 시간(ms). 기록이 없으면 null */
  avg_completed_ms: number | null;
}

export interface RaidInscriptionPickPlayer {
  participant_id: number;
  slot: number;
  student_name: string;
  guild_name: string | null;
  typed_count: number;
  attempt_index: number;
  mistakes: number;
  completed: boolean;
  completed_ms: number | null;
  corrupted: boolean;
}

export interface RaidInscriptionPickSession {
  id: number;
  seq_no: number;
  phase: RaidInscriptionPhase;
  open: boolean;
  trigger_source: 'AUTO' | 'TEACHER';
  trigger_percent: number | null;
  letter_count: number;
  time_limit_ms: number;
  volunteer_closes_at: string | null;
  volunteer_accept_until: string | null;
  pick_deadline_at: string | null;
  play_starts_at: string | null;
  play_deadline_at: string | null;
  resolved_at: string | null;
  resume_at: string | null;
  teacher_pick: number[] | null;
  picked: boolean;
  volunteers: RaidInscriptionPickVolunteer[];
  players: RaidInscriptionPickPlayer[];
  outcome: 'SUCCESS' | 'FAILED' | null;
  outcome_reason: string | null;
  boss_damage: number | null;
  boss_damage_capped: boolean | null;
  barrier_heal: number | null;
}

export interface RaidInscriptionPickState {
  raid_id: number;
  raid_status: string;
  server_now: string;
  configured: boolean;
  enabled: boolean;
  selection_mode: RaidInscriptionSelectionMode;
  planned_player_count: number;
  config: {
    difficulty: RaidInscriptionDifficulty;
    letter_count: number;
    use_gh: boolean;
    time_limit_ms: number;
    player_count: number;
    corruption_count: number;
    corruption_seconds: number;
    auto_trigger_percents: number[];
  };
  can_trigger: boolean;
  clash_busy: boolean;
  session: RaidInscriptionPickSession | null;
}

export interface RaidInscriptionHistorySession {
  id: number;
  seq_no: number;
  phase: RaidInscriptionPhase;
  trigger_source: 'AUTO' | 'TEACHER';
  trigger_percent: number | null;
  outcome: 'SUCCESS' | 'FAILED' | null;
  outcome_reason: string | null;
  triggered_at: string | null;
  resolved_at: string | null;
  difficulty: RaidInscriptionDifficulty;
  letter_count: number;
  time_limit_ms: number;
  boss_damage: number | null;
  boss_damage_capped: boolean | null;
  barrier_heal: number | null;
  players: Array<{ participant_id: number; student_name: string; guild_name: string | null; completed: boolean; completed_ms: number | null; mistakes: number; corrupted: boolean }>;
  /** 타락한 학생과 그 학생의 공격으로 보스가 회복한 양(교사만 봄) */
  corruptions: Array<{ participant_id: number; student_name: string; healed_amount: number }>;
}

export const raidInscriptionAdminRpc = {
  config: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidInscriptionTeacherConfig>(supabase, 'teacher_get_raid_inscription_config', { p_raid_id: raidId }),

  saveConfig: (supabase: SupabaseClient, raidId: number, payload: RaidInscriptionConfigPayload) =>
    callRpc<RaidInscriptionTeacherConfig>(supabase, 'teacher_save_raid_inscription_config', { p_raid_id: raidId, p_payload: payload }),

  setSelectionMode: (supabase: SupabaseClient, raidId: number, mode: RaidInscriptionSelectionMode) =>
    callRpc<{ raid_id: number; selection_mode: RaidInscriptionSelectionMode }>(supabase, 'teacher_set_raid_inscription_selection_mode', { p_raid_id: raidId, p_mode: mode }),

  pickState: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidInscriptionPickState>(supabase, 'teacher_get_raid_inscription_pick_state', { p_raid_id: raidId }),

  pickPlayers: (supabase: SupabaseClient, raidId: number, participantIds: number[]) =>
    callRpc<RaidInscriptionPickState>(supabase, 'teacher_pick_raid_inscription_players', { p_raid_id: raidId, p_participant_ids: participantIds }),

  trigger: (supabase: SupabaseClient, raidId: number) =>
    callRpc<{ triggered: boolean; inscription: RaidInscriptionPublicState | null }>(supabase, 'teacher_trigger_raid_inscription', { p_raid_id: raidId }),

  cancel: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidInscriptionPickState>(supabase, 'teacher_cancel_raid_inscription', { p_raid_id: raidId }),

  history: (supabase: SupabaseClient, raidId: number) =>
    callRpc<{ raid_id: number; sessions: RaidInscriptionHistorySession[] }>(supabase, 'teacher_get_raid_inscription_history', { p_raid_id: raidId }),
};
