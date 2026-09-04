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
};
