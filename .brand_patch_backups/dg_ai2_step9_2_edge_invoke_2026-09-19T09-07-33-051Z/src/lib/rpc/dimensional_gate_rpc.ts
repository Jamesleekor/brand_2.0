import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type DimensionalGateRelationStage = 'LOCKED' | 'STRANGER' | 'INTEREST' | 'AFFECTION' | 'TRUST';
export type DimensionalGateRelationshipStatus = 'LOCKED' | 'NORMAL';
export type DimensionalGateStoryScope = 'STANDARD' | 'MAJOR';
export type DimensionalGateGateStatus = 'CONNECTED' | 'CONNECTING' | 'OUT_OF_RANGE';
export type DimensionalGateResourceKind = 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
export type DimensionalGateCutType = 'TITLE' | 'NARRATION' | 'LINE' | 'CHOICE' | 'CG';
export type DimensionalGateGalleryAssetType = 'STORY_CG' | 'SPECIAL_CG';

export interface DimensionalGateRosterRow {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  description: string | null;
  resource_kind: DimensionalGateResourceKind;
  resource_url: string | null;
  full_image_url: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
  is_owned: boolean;
  relationship_exists: boolean;
  affinity: number;
  relation_stage: DimensionalGateRelationStage;
  status: DimensionalGateRelationshipStatus;
  daily_chat_limit: number;
  chat_count: number;
  remaining_chat_count: number;
  story_scope: DimensionalGateStoryScope;
  gate_status: DimensionalGateGateStatus;
  publication_ready: boolean;
  story_enabled: boolean;
  gallery_enabled: boolean;
  rewards_enabled: boolean;
  chat_enabled: boolean;
  gate_enabled: boolean;
}

export interface DimensionalGateMemoryRow {
  memory_no: 1 | 2 | 3;
  title: string | null;
  content: string | null;
  unlock_affinity: 40 | 70 | 100;
  unlocked: boolean;
  permanently_unlocked: boolean;
}

export interface DimensionalGateCharacterDetail {
  character: Pick<
    DimensionalGateRosterRow,
    | 'character_id'
    | 'character_uid'
    | 'name'
    | 'epithet'
    | 'description'
    | 'resource_kind'
    | 'resource_url'
    | 'full_image_url'
    | 'card_image_url'
    | 'avatar_image_url'
  >;
  gate_enabled: boolean;
  relationship: {
    affinity: number;
    relation_stage: Exclude<DimensionalGateRelationStage, 'LOCKED'>;
    status: 'NORMAL' | 'LOCKED';
    warning_count: number;
    daily_chat_limit: number;
    chat_count: number;
    remaining_chat_count: number;
    last_interacted_at: string | null;
  };
  memories: DimensionalGateMemoryRow[];
}

export interface DimensionalGateStoryListItem {
  episode_id: number;
  episode_no: number;
  title: string;
  required_affinity: number;
  unlocked: boolean;
  opened: boolean;
  completed: boolean;
  is_new: boolean;
  estimated_minutes: number | null;
  headphone_recommended: boolean;
}

export interface DimensionalGateStoryListResult {
  affinity: number;
  stories: DimensionalGateStoryListItem[];
}

export interface DimensionalGateStoryChoice {
  label: string;
  to: number;
}

export interface DimensionalGateStoryCut {
  cut_order: number;
  cut_type: DimensionalGateCutType;
  speaker: string | null;
  content: string | null;
  background_url: string | null;
  sprite_url: string | null;
  bgm_url: string | null;
  sfx_url: string | null;
  effects: string[];
  choices: DimensionalGateStoryChoice[] | null;
  jump_to_order: number | null;
  gallery_asset_id: number | null;
  metadata: Record<string, unknown>;
}

export interface DimensionalGateStoryScript {
  episode_id: number;
  character_id: number;
  episode_no: number;
  title: string;
  required_affinity: number;
  default_bgm_url: string | null;
  estimated_minutes: number | null;
  headphone_recommended: boolean;
  cuts: DimensionalGateStoryCut[];
}

export interface DimensionalGateStoryCompleteResult {
  completed: boolean;
  new_gallery_unlocks: number;
}

export interface DimensionalGateGalleryAsset {
  gallery_asset_id: number;
  asset_type: DimensionalGateGalleryAssetType;
  title: string | null;
  image_url: string | null;
  unlock_affinity: number | null;
  unlocked: boolean;
  episode_id: number | null;
  home_background_allowed: boolean;
  cosmetic_item_id: number | null;
  ownership_id: number | null;
}

export interface DimensionalGateGalleryResult {
  affinity: number;
  assets: DimensionalGateGalleryAsset[];
}

export interface DimensionalGateRewardRow {
  affinity_threshold: 40 | 70 | 100;
  reward_gold: number;
  reward_crystal: number;
  reward_bv: number;
  gallery_asset_id: number | null;
  trust_visual_variant_no: 2 | 3 | null;
  reached: boolean;
  claimed: boolean;
  claimed_at: string | null;
}

export interface DimensionalGateRewardStatus {
  affinity: number;
  rewards: DimensionalGateRewardRow[];
}



export interface DimensionalGateLiminelTrustRecord {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  unlocked_at: string;
}

export interface DimensionalGateLiminelRecord {
  intro_seen: boolean;
  intro_seen_at: string | null;
  relationship_count: number;
  memory_count: number;
  completed_story_count: number;
  gallery_count: number;
  trust_count: number;
  trust_records: DimensionalGateLiminelTrustRecord[];
}

export interface DimensionalGateChatMessage {
  id: number;
  role: 'STUDENT' | 'CHARACTER';
  content: string;
  created_at: string;
  severity: 'none' | 'mild' | 'severe' | null;
  affinity_delta: number | null;
}

export interface DimensionalGateChatRelationshipResult {
  duplicate?: boolean;
  expired?: boolean;
  stale?: boolean;
  aborted?: boolean;
  reply?: string | null;
  severity?: 'none' | 'mild' | 'severe';
  affinity_delta?: number;
  affinity?: number;
  relation_stage?: Exclude<DimensionalGateRelationStage, 'LOCKED'>;
  warning_count?: number;
  status?: DimensionalGateRelationshipStatus;
  remaining_chat_count?: number;
}

export interface DimensionalGateChatResponse {
  duplicate?: boolean;
  completed?: boolean;
  request_id?: string;
  reply: string;
  moderation_severity?: 'none' | 'mild' | 'severe';
  safety_action?: 'none' | 'supportive_redirect' | 'trusted_adult' | 'emergency_help';
  boundary?: 'normal' | 'knowledge_boundary' | 'relationship_boundary' | 'safety_boundary';
  refs?: {
    fact_refs: string[];
    history_refs: string[];
    lore_refs: string[];
    memory_refs: string[];
    activity_refs: string[];
  };
  relationship?: DimensionalGateChatRelationshipResult;
  model?: string;

  // Legacy compatibility fields used by older Edge Function responses.
  severity?: 'none' | 'mild' | 'severe';
  affinity_delta?: number;
  affinity?: number;
  relation_stage?: Exclude<DimensionalGateRelationStage, 'LOCKED'>;
  warning_count?: number;
  status?: DimensionalGateRelationshipStatus;
  remaining_chat_count?: number;
  provider?: string;
}

export interface DimensionalGateRewardClaimResult {
  claimed: boolean;
  affinity_threshold: 40 | 70 | 100;
  reward_gold: number;
  reward_crystal: number;
  reward_bv: number;
  trust_visual_variant_no: 2 | 3 | null;
  wallet: { gold: number; crystal: number; bv: number } | null;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const dimensionalGateRpc = {
  roster: (supabase: SupabaseClient) =>
    callRpc<DimensionalGateRosterRow[]>(supabase, 'student_get_dimensional_gate_roster'),

  character: (supabase: SupabaseClient, characterId: number) =>
    callRpc<DimensionalGateCharacterDetail>(supabase, 'student_get_dimensional_gate_character', {
      p_character_id: characterId,
    }),

  stories: (supabase: SupabaseClient, characterId: number) =>
    callRpc<DimensionalGateStoryListResult>(supabase, 'student_get_dimensional_gate_stories', {
      p_character_id: characterId,
    }),

  story: (supabase: SupabaseClient, episodeId: number) =>
    callRpc<DimensionalGateStoryScript>(supabase, 'student_get_dimensional_gate_story', {
      p_episode_id: episodeId,
    }),

  startStory: (supabase: SupabaseClient, episodeId: number) =>
    callRpc<void>(supabase, 'student_start_dimensional_gate_story', {
      p_episode_id: episodeId,
    }),

  completeStory: (supabase: SupabaseClient, episodeId: number, galleryAssetIds: number[]) =>
    callRpc<DimensionalGateStoryCompleteResult>(supabase, 'student_complete_dimensional_gate_story', {
      p_episode_id: episodeId,
      p_gallery_asset_ids: galleryAssetIds,
    }),

  gallery: (supabase: SupabaseClient, characterId: number) =>
    callRpc<DimensionalGateGalleryResult>(supabase, 'student_get_dimensional_gate_gallery', {
      p_character_id: characterId,
    }),

  rewards: (supabase: SupabaseClient, characterId: number) =>
    callRpc<DimensionalGateRewardStatus>(supabase, 'student_get_dimensional_gate_rewards', {
      p_character_id: characterId,
    }),





  liminelRecord: (supabase: SupabaseClient) =>
    callRpc<DimensionalGateLiminelRecord>(supabase, 'student_get_dimensional_gate_liminel_record'),

  markLiminelIntroSeen: (supabase: SupabaseClient) =>
    callRpc<string>(supabase, 'student_mark_dimensional_gate_intro_seen'),

  chatHistory: (supabase: SupabaseClient, characterId: number, limit = 40) =>
    callRpc<DimensionalGateChatMessage[]>(supabase, 'student_get_dimensional_gate_chat_history', {
      p_character_id: characterId,
      p_limit: limit,
    }),

  async sendChat(supabase: SupabaseClient, characterId: number, message: string, requestId: string): Promise<RpcResult<DimensionalGateChatResponse>> {
    const { data, error } = await supabase.functions.invoke<DimensionalGateChatResponse>('dimensional-gate-chat', {
      body: { character_id: characterId, message, request_id: requestId },
    });
    if (error) {
      let detail = error.message || '차원관문 대화를 완료하지 못했어요.';
      let code: string | undefined;
      if (error.context instanceof Response) {
        try {
          const body = await error.context.clone().json() as { error?: string; code?: string };
          detail = body.error || detail;
          code = body.code;
        } catch {
          // Keep SDK error message when response body is unavailable.
        }
      }
      return { success: false, type: 'SERVER', error: detail, code };
    }
    if (!data || typeof data.reply !== 'string') {
      return { success: false, type: 'SERVER', error: '차원관문 서버가 올바른 응답을 반환하지 않았어요.' };
    }
    return { success: true, data };
  },

  claimReward: (supabase: SupabaseClient, characterId: number, affinityThreshold: 40 | 70 | 100) =>
    callRpc<DimensionalGateRewardClaimResult>(supabase, 'student_claim_dimensional_gate_reward', {
      p_character_id: characterId,
      p_affinity_threshold: affinityThreshold,
    }),
};
