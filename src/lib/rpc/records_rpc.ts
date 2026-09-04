import type { SupabaseClient } from '@supabase/supabase-js';

export interface LegacyAssetHistoryRow {
  source_row: number;
  event_date: string;
  source_timestamp_local: string | null;
  occurred_at: string | null;
  brand_name_snapshot: string | null;
  raw_bv_delta: number;
  bv_delta: number;
  gold_delta: number;
  balance_after_bv: number;
  balance_after_gold: number;
  memo: string | null;
  normalization_note: string | null;
}

export interface LegacyAssetHistoryBoard {
  total: number;
  rows: LegacyAssetHistoryRow[];
}

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

export interface AttendanceRewardTotal {
  gold: number;
  bv: number;
  crystal: number;
}

export interface AttendanceDashboard {
  kst_today: string;
  current_streak: number;
  total_attendance: number;
  today_status: AttendanceStatus | null;
  can_check_in: boolean;
  attended_dates: number[];
  achieved_milestones: number[];
  milestone_rewards: Record<string, AttendanceRewardTotal>;
  monthly_daily_quest_reward: AttendanceRewardTotal;
  monthly_milestone_reward: AttendanceRewardTotal;
}

export interface AttendanceHistoryRow {
  id: number;
  attendance_date: string;
  status: AttendanceStatus;
  streak_days: number;
  total_attendance: number;
  recorded_at: string;
}

export interface AttendanceHistoryBoard {
  total_count: number;
  limit: number;
  offset: number;
  rows: AttendanceHistoryRow[];
}

export interface GuildMissionHistoryRow {
  mission_id: number;
  title: string;
  lifecycle_state: string;
  teaser_only: boolean;
  description?: string | null;
  student_success_criteria?: string | null;
  due_at?: string | null;
  activity_record_due_at?: string | null;
  submission_scope?: string | null;
  submission_requirement?: string | null;
  special_rule_note?: string | null;
  guild_result?: string | null;
  my_grade?: string | null;
  my_activity_record?: string | null;
  my_activity_record_revision?: number | null;
  current_submission?: string | null;
  current_submission_revision?: number | null;
}

export interface GuildMissionScoreSummaryRow {
  year_month: string;
  points: number;
  status: string;
  max_points: number;
}

export interface GuildMonthlyStudentSnapshot {
  student_id: number;
  student_name_at_close: string;
  brand_name_at_close: string | null;
  guild_id: number;
  guild_name_at_close: string;
  role_at_close: string;
  bv_at_close: number;
  peer_points: number;
  mission_points: number;
  session_points: number;
  observation_points: number;
  basic_total: number;
  arcade_raw_total: number;
  arcade_applied: number;
  final_contribution: number;
  peer_status: string;
  mission_status: string;
  session_status: string;
  observation_status: string;
  arcade_status: string;
  source_flags: Record<string, unknown>;
}

export interface GuildMonthlyGuildSnapshot {
  guild_id: number;
  guild_name_at_close: string;
  guild_logo_url_at_close: string | null;
  roster_count: number;
  roster_bv_sum: number;
  individual_subtotal: number;
  official_mission_gs: number;
  compensation_amount: number;
  manual_adjustment_total: number;
  total_gs: number;
  rank_position: number;
  cumulative_final_gs: number;
}

export interface GuildMonthlyTerritorySnapshot extends Record<string, unknown> {
  territory_slot_no: number | null;
  tax_rate_percent: number | null;
  territory_description: string | null;
}

export interface GuildMonthlyRankingRow {
  guild_id: number;
  guild_name_at_close: string;
  guild_logo_url_at_close: string | null;
  rank_position: number;
  total_gs: number;
  territory: string | null;
  territory_id: number | null;
  territory_slot_no: number | null;
  tax_rate_percent: number | null;
  territory_description: string | null;
}

export interface GuildMonthlyHistoryRow {
  year_month: string;
  version_no: number;
  finalized_at: string;
  my_contribution: GuildMonthlyStudentSnapshot;
  my_guild: GuildMonthlyGuildSnapshot;
  territory: GuildMonthlyTerritorySnapshot | null;
  rankings: GuildMonthlyRankingRow[];
}

export const recordsRpc = {
  myLegacyAssetHistory: async (
    supabase: SupabaseClient,
    input: { p_limit?: number; p_offset?: number } = {},
  ): Promise<LegacyAssetHistoryBoard> => {
    const { data, error } = await supabase.rpc('student_get_my_legacy_asset_history', input);
    if (error) throw error;
    return (data ?? { total: 0, rows: [] }) as LegacyAssetHistoryBoard;
  },

  myAttendanceDashboard: async (supabase: SupabaseClient): Promise<AttendanceDashboard> => {
    const { data, error } = await supabase.rpc('student_get_attendance_dashboard');
    if (error) throw error;
    return (data ?? {
      kst_today: '',
      current_streak: 0,
      total_attendance: 0,
      today_status: null,
      can_check_in: true,
      attended_dates: [],
      achieved_milestones: [],
      milestone_rewards: {},
      monthly_daily_quest_reward: { gold: 0, bv: 0, crystal: 0 },
      monthly_milestone_reward: { gold: 0, bv: 0, crystal: 0 },
    }) as AttendanceDashboard;
  },

  myAttendanceHistory: async (
    supabase: SupabaseClient,
    input: { p_limit?: number; p_offset?: number } = {},
  ): Promise<AttendanceHistoryBoard> => {
    const { data, error } = await supabase.rpc('student_get_my_attendance_history', input);
    if (error) throw error;
    return (data ?? { total_count: 0, limit: input.p_limit ?? 100, offset: input.p_offset ?? 0, rows: [] }) as AttendanceHistoryBoard;
  },

  myGuildMissionHistory: async (supabase: SupabaseClient): Promise<GuildMissionHistoryRow[]> => {
    const { data, error } = await supabase.rpc('student_get_guild3_mission_board');
    if (error) throw error;
    return (data ?? []) as GuildMissionHistoryRow[];
  },

  myGuildMissionScoreSummary: async (supabase: SupabaseClient): Promise<GuildMissionScoreSummaryRow[]> => {
    const { data, error } = await supabase.rpc('student_get_guild3_mission_score_summary');
    if (error) throw error;
    return (data ?? []) as GuildMissionScoreSummaryRow[];
  },

  myGuildMonthlyHistory: async (supabase: SupabaseClient): Promise<GuildMonthlyHistoryRow[]> => {
    const { data, error } = await supabase.rpc('student_get_guild5_monthly_history');
    if (error) throw error;
    return (data ?? []) as GuildMonthlyHistoryRow[];
  },
};
