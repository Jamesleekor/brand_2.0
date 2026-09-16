import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type RaidDifficultyLabel = 'LOW' | 'BALANCED' | 'HIGH' | 'NO_DATA';

export interface RaidDifficultyAxis {
  score: number | null;
  label: RaidDifficultyLabel;
}

export interface RaidBalanceLabRowV15 {
  id: number;
  title: string;
  boss_name: string;
  boss_element: string;
  status: string;
  max_hp: number;
  current_hp: number;
  starts_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  snapshot_count: number;
  participant_count: number;
  total_damage: number;
  report_available: boolean;
  difficulty: {
    attack?: RaidDifficultyAxis;
    survival?: RaidDifficultyAxis;
    pattern?: RaidDifficultyAxis;
  } | null;
}

export interface RaidPatternMetricV15 {
  pattern_type: string;
  activation_count: number;
  success_count: number;
  failure_count: number;
  success_rate_percent: number | null;
  attack_batches: number;
  absorbed_damage: number;
  boss_healed: number;
  reflected_damage: number;
  objective_progress: number;
  attack_stop_success_count: number | null;
  weak_hits: number | null;
  total_hits: number | null;
  weak_hit_rate_percent: number | null;
  barrier_damage: number;
}

export interface RaidBalanceAnalysisV15 {
  raid: {
    id: number;
    title: string;
    boss_name: string;
    boss_element: string;
    status: string;
    max_hp: number;
    current_hp: number;
    starts_at: string | null;
    ends_at: string | null;
    completed_at: string | null;
    end_reason: string | null;
  };
  report: {
    algorithm_version: string;
    generated_at: string;
    summary: Record<string, unknown> & {
      snapshot_count?: number;
      participant_count?: number;
      participation_rate?: number;
      total_damage?: number;
      boss_damage_taken?: number;
      boss_damage_percent?: number;
      remaining_hp?: number;
      accepted_taps?: number;
      rejected_taps?: number;
      crit_count?: number;
      battle_duration_seconds?: number;
      active_combat_seconds?: number;
      observed_dps?: number;
      sample_quality?: string;
    };
    distribution: Record<string, unknown>;
    crit: Record<string, unknown> & {
      expected_rate_percent?: number;
      actual_rate_percent?: number;
      delta_percent_point?: number;
    };
    element: Record<string, unknown>;
    concentration: Record<string, unknown> & {
      top1_damage_share_percent?: number;
      top3_damage_share_percent?: number;
      top5_damage_share_percent?: number;
      bottom_half_damage_share_percent?: number;
    };
    hp_recommendation: Record<string, unknown> & {
      sample_quality?: string;
      observed_dps?: number;
      recommended_hp_3m?: number;
      recommended_hp_5m?: number;
      recommended_survival_damage_scale?: number | null;
      current_boss_attack_barrier_ratio?: number | null;
      suggested_boss_attack_barrier_ratio?: number | null;
      warning?: string | null;
    };
    barrier: {
      max_barrier: number;
      total_damage_received: number;
      remaining_barrier: number;
      consumption_percent: number;
      lowest_barrier_percent: number;
      collapsed: boolean;
    };
    boss_attacks: {
      attack_count: number;
      barrier_damage: number;
      average_attack_damage: number;
      max_attack_damage: number;
      pattern_success_count: number;
      pattern_failure_count: number;
    };
    patterns: {
      items: RaidPatternMetricV15[];
      resolved_count: number;
      success_count: number;
      failure_count: number;
      failure_rate_percent: number;
    };
    difficulty: {
      attack: RaidDifficultyAxis;
      survival: RaidDifficultyAxis;
      pattern: RaidDifficultyAxis;
      rule_version: string;
      note: string;
    };
  };
  participants: Array<{
    student_id: number;
    name: string;
    brand_name: string | null;
    guild_name: string | null;
    raid_power: number;
    expected_crit_rate: number;
    actual_crit_rate: number;
    total_damage: number;
    accepted_taps: number;
    rejected_taps: number;
    crit_count: number;
    average_damage: number;
    damage_share_percent: number;
    final_rank: number | null;
  }>;
  hp_timeline: Array<{ at: string; hp_before: number; hp_after: number; damage: number }>;
  barrier_timeline: Array<{ at: string; before: number; after: number; max: number; damage: number; source: string }>;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const raidBalanceV15Rpc = {
  lab: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<{ raids: RaidBalanceLabRowV15[] }>(supabase, 'teacher_get_raid_balance_lab_v15', {
      p_classroom_id: classroomId,
    }),
  analysis: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidBalanceAnalysisV15>(supabase, 'teacher_get_raid_balance_analysis_v15', {
      p_raid_id: raidId,
    }),
};
