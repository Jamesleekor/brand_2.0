import type { SupabaseClient } from '@supabase/supabase-js';

export type RankingV2AssetStyle = 'CASH' | 'DEPOSIT' | 'INSTALLMENT' | 'BALANCED' | 'NONE';

export interface RankingV2BattleMember {
  student_id: number;
  name: string;
  rank: number;
}

export interface RankingV2BattleGroup {
  group_id: number;
  start_rank: number;
  end_rank: number;
  member_count: number;
  members: RankingV2BattleMember[];
}

export interface RankingV2BaseRow {
  rank: number;
  student_id: number;
  name: string;
  brand_name: string | null;
  tier: string | null;
  is_me: boolean;
}

export interface RankingV2BvRow extends RankingV2BaseRow {
  weekly_delta: number;
  battle_group_id: number | null;
  exact_bv: number | null;
}

export interface RankingV2AssetRow extends RankingV2BaseRow {
  rank_delta: number | null;
  asset_style: RankingV2AssetStyle;
  exact_total_asset: number | null;
  exact_cash_gold: number | null;
  exact_deposit_principal: number | null;
  exact_installment_principal: number | null;
}

export interface RankingV2AchievementRow extends RankingV2BaseRow {
  achievement_count: number;
}

export interface RankingV2ShardRow extends RankingV2BaseRow {
  owned_count: number;
  limited_count: number;
  collection_value: number;
}

export interface RankingV2CollectionRow extends RankingV2BaseRow {
  completed_count: number;
  recent_collection_name: string | null;
  recent_completed_at: string | null;
}

export interface RankingV2AssetDistributionBucket {
  key: string;
  min: number;
  max: number | null;
  count: number;
}

export interface RankingV2Board {
  classroom_id: number;
  self_student_id: number | null;
  comparison_cutoff: string;
  limited_character_total: number;
  bv_battle_groups: RankingV2BattleGroup[];
  bv_ranks: RankingV2BvRow[];
  asset_distribution: RankingV2AssetDistributionBucket[];
  asset_ranks: RankingV2AssetRow[];
  achievement_ranks: RankingV2AchievementRow[];
  shard_ranks: RankingV2ShardRow[];
  collection_ranks: RankingV2CollectionRow[];
}

export interface RankingV2CharacterDetail {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  resource_kind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
  resource_url: string | null;
  emoji: string | null;
  full_image_url: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
  is_limited: boolean;
  collection_value: number;
  acquired_at: string | null;
}

export interface RankingV2CollectionDetailRow {
  collection_id: number;
  collection_uid: string;
  name: string;
  description: string | null;
  collection_class: string;
  required_count: number;
  completed_at: string | null;
}

export interface RankingV2CollectionDetail {
  student: {
    student_id: number;
    name: string;
    brand_name: string | null;
  };
  summary: {
    owned_count: number;
    limited_count: number;
    limited_total: number;
    collection_value: number;
    completed_collection_count: number;
  };
  characters: RankingV2CharacterDetail[];
  collections: RankingV2CollectionDetailRow[];
}

export async function getClassroomRankingV2(client: SupabaseClient): Promise<RankingV2Board> {
  const { data, error } = await client.rpc('get_classroom_ranking_v2');
  if (error) throw new Error(error.message);
  return data as RankingV2Board;
}

export async function getClassroomRankingV2CollectionDetail(
  client: SupabaseClient,
  studentId: number,
): Promise<RankingV2CollectionDetail> {
  const { data, error } = await client.rpc('get_classroom_ranking_v2_collection_detail', {
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);
  return data as RankingV2CollectionDetail;
}
