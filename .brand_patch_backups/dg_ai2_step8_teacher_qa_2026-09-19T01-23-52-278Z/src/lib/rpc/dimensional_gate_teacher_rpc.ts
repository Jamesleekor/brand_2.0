import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export interface DimensionalGateTeacherSettings {
  classroom_id: number;
  normal_gain: number;
  mild_penalty: number;
  severe_penalty: number;
  lock_warning_count: number;
  max_student_message_chars: number;
  recent_history_limit: number;
  activity_lookback_days: number;
  activity_event_limit: number;
}

export interface DimensionalGateTeacherStudent {
  id: number;
  name: string;
  brand_name: string | null;
}

export interface DimensionalGateTeacherRelationship {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  character_id: number;
  character_uid: string;
  character_name: string;
  affinity: number;
  relation_stage: 'STRANGER' | 'INTEREST' | 'AFFECTION' | 'TRUST';
  status: 'NORMAL' | 'LOCKED';
  warning_count: number;
  daily_chat_limit: number;
  chat_count: number;
  remaining_chat_count: number;
  last_interacted_at: string | null;
}

export interface DimensionalGateTeacherBoard {
  settings: DimensionalGateTeacherSettings;
  students: DimensionalGateTeacherStudent[];
  relationships: DimensionalGateTeacherRelationship[];
}

export type DimensionalGateTeacherAction = 'SET_AFFINITY' | 'UNLOCK' | 'LOCK' | 'CLEAR_WARNINGS' | 'RESET_DAILY';

async function callRpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const dimensionalGateTeacherRpc = {
  board: (client: SupabaseClient, classroomId: number) =>
    callRpc<DimensionalGateTeacherBoard>(client, 'teacher_get_dimensional_gate_admin_board', { p_classroom_id: classroomId }),

  manage: (
    client: SupabaseClient,
    studentId: number,
    characterId: number,
    action: DimensionalGateTeacherAction,
    value: number | null = null,
    reason: string | null = null,
  ) => callRpc<DimensionalGateTeacherRelationship>(client, 'teacher_manage_dimensional_gate_relationship', {
    p_student_id: studentId,
    p_character_id: characterId,
    p_action: action,
    p_value: value,
    p_reason: reason,
  }),
};

export interface DimensionalGateContentProfile {
  character_id: number;
  daily_chat_limit: number;
  start_affinity: number;
  ai_enabled: boolean;
  system_prompt: string | null;
  speaking_style: string | null;
  expertise: string[] | Record<string, unknown>;
  deflect_rules: string | null;
  imagery_rules: string | null;
  warning_line_1: string | null;
  warning_line_2: string | null;
  lock_line: string | null;
  story_scope: 'STANDARD' | 'MAJOR';
  gate_status: 'CONNECTED' | 'CONNECTING' | 'OUT_OF_RANGE';
  is_active: boolean;
}

export interface DimensionalGateContentMemory {
  memory_no: 1 | 2 | 3;
  unlock_affinity: 40 | 70 | 100;
  title: string;
  content: string;
  is_active: boolean;
}

export interface DimensionalGateContentReward {
  affinity_threshold: 40 | 70 | 100;
  reward_gold: number;
  reward_crystal: number;
  reward_bv: number;
  gallery_asset_id: number | null;
  trust_visual_variant_no: 2 | 3 | null;
  is_active: boolean;
}

export interface DimensionalGateContentEpisodeSummary {
  episode_id: number;
  episode_no: number;
  title: string;
  required_affinity: number;
  estimated_minutes: number | null;
  headphone_recommended: boolean;
  is_active: boolean;
  cut_count: number;
}

export interface DimensionalGateContentDetail {
  character: {
    id: number;
    character_uid: string;
    name: string;
    showcase_image_url_2: string | null;
    showcase_image_url_3: string | null;
  };
  profile: DimensionalGateContentProfile | null;
  memories: DimensionalGateContentMemory[];
  rewards: DimensionalGateContentReward[];
  episodes: DimensionalGateContentEpisodeSummary[];
  gallery_count: number;
}

export interface SaveDimensionalGateProfileInput {
  characterId: number;
  isActive: boolean;
  gateStatus: 'CONNECTED' | 'CONNECTING' | 'OUT_OF_RANGE';
  storyScope: 'STANDARD' | 'MAJOR';
  dailyChatLimit: number;
  startAffinity: number;
  aiEnabled: boolean;
  systemPrompt: string;
  speakingStyle: string;
  expertise: string[];
  deflectRules: string;
  imageryRules: string;
  warningLine1: string;
  warningLine2: string;
  lockLine: string;
}

export const dimensionalGateContentRpc = {
  get: (client: SupabaseClient, characterId: number) =>
    callRpc<DimensionalGateContentDetail>(client, 'teacher_get_dimensional_gate_content', { p_character_id: characterId }),

  saveProfile: (client: SupabaseClient, input: SaveDimensionalGateProfileInput) =>
    callRpc<void>(client, 'teacher_save_dimensional_gate_profile', {
      p_character_id: input.characterId,
      p_gate_status: input.gateStatus,
      p_is_active: input.isActive,
      p_story_scope: input.storyScope,
      p_daily_chat_limit: input.dailyChatLimit,
      p_start_affinity: input.startAffinity,
      p_ai_enabled: input.aiEnabled,
      p_system_prompt: input.systemPrompt,
      p_speaking_style: input.speakingStyle,
      p_expertise: input.expertise,
      p_deflect_rules: input.deflectRules,
      p_imagery_rules: input.imageryRules,
      p_warning_line_1: input.warningLine1,
      p_warning_line_2: input.warningLine2,
      p_lock_line: input.lockLine,
    }),

  saveMemories: (client: SupabaseClient, characterId: number, memories: DimensionalGateContentMemory[]) =>
    callRpc<void>(client, 'teacher_save_dimensional_gate_memories', {
      p_character_id: characterId,
      p_memories: memories,
    }),

  saveRewards: (client: SupabaseClient, characterId: number, rewards: DimensionalGateContentReward[]) =>
    callRpc<void>(client, 'teacher_save_dimensional_gate_rewards', {
      p_character_id: characterId,
      p_rewards: rewards,
    }),
};


export interface DimensionalGateStoryGalleryPackage {
  title?: string | null;
  image_url: string;
  home_background_allowed?: boolean;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DimensionalGateStoryChoicePackage {
  label: string;
  to: number;
}

export interface DimensionalGateStoryCutPackage {
  cut_order: number;
  cut_type: 'TITLE' | 'NARRATION' | 'LINE' | 'CHOICE' | 'CG';
  speaker?: string | null;
  content?: string | null;
  background_url?: string | null;
  sprite_url?: string | null;
  bgm_url?: string | null;
  sfx_url?: string | null;
  effects?: string[];
  choices?: DimensionalGateStoryChoicePackage[] | null;
  jump_to_order?: number | null;
  metadata?: Record<string, unknown>;
  gallery?: DimensionalGateStoryGalleryPackage | null;
}

export interface DimensionalGateStoryPackage {
  episode: {
    episode_no: number;
    title: string;
    required_affinity: number;
    default_bgm_url?: string | null;
    estimated_minutes?: number | null;
    headphone_recommended?: boolean;
    sort_order?: number;
    is_active?: boolean;
    metadata?: Record<string, unknown>;
  };
  cuts: DimensionalGateStoryCutPackage[];
}

export const dimensionalGateStoryAdminRpc = {
  getPackage: (client: SupabaseClient, episodeId: number) =>
    callRpc<DimensionalGateStoryPackage>(client, 'teacher_get_dimensional_gate_story_package', { p_episode_id: episodeId }),

  savePackage: (client: SupabaseClient, characterId: number, storyPackage: DimensionalGateStoryPackage) =>
    callRpc<{ episode_id: number; episode_no: number; cut_count: number; active_gallery_count: number }>(
      client,
      'teacher_save_dimensional_gate_story_package',
      { p_character_id: characterId, p_package: storyPackage },
    ),
};


export interface DimensionalGateSpecialCgAdminRow {
  gallery_asset_id?: number | null;
  unlock_affinity: 40 | 70 | 100;
  title: string;
  image_url: string;
  home_background_allowed: boolean;
  cosmetic_item_id?: number | null;
  is_active: boolean;
}

export interface DimensionalGateContentHealth {
  story_scope: 'STANDARD' | 'MAJOR';
  profile_ready: boolean;
  active_memory_count: number;
  active_reward_count: number;
  active_episode_count: number;
  recommended_episode_min: number;
  recommended_episode_max: number;
  total_cut_count: number;
  active_story_cg_count: number;
  active_special_cg_count: number;
  ready_for_release: boolean;
  gate_status?: 'CONNECTED' | 'CONNECTING' | 'OUT_OF_RANGE';
  published?: boolean;
}

export interface DimensionalGateContentExtras {
  special_cgs: DimensionalGateSpecialCgAdminRow[];
  health: DimensionalGateContentHealth;
}

export const dimensionalGateContentExtrasRpc = {
  get: (client: SupabaseClient, characterId: number) =>
    callRpc<DimensionalGateContentExtras>(client, 'teacher_get_dimensional_gate_content_extras', { p_character_id: characterId }),

  saveSpecialCgs: (client: SupabaseClient, characterId: number, assets: DimensionalGateSpecialCgAdminRow[]) =>
    callRpc<{ saved: number }>(client, 'teacher_save_dimensional_gate_special_cgs', {
      p_character_id: characterId,
      p_assets: assets,
    }),
};
