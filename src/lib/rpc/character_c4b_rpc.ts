import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import {
  TeacherPreviewCharacterCollectionSchema,
  TeacherSaveCharacterCollectionSchema,
  type TeacherSaveCharacterCollectionInput,
} from '@/lib/zod_schemas/character_c4b_schemas';

export type BuffValueUnit = 'PERCENTAGE_POINT' | 'GOLD';
export type BuffDirection = 'REDUCTION' | 'BONUS';
export type CollectionClass = 'SMALL' | 'STANDARD' | 'LARGE';

export interface TeacherBuffEffectRow {
  id: number;
  effect_code: string;
  display_name: string;
  description: string | null;
  domain_code: string;
  value_unit: BuffValueUnit;
  direction: BuffDirection;
  stack_mode: 'SUM_CAPPED';
  cap_value: number;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
}

export interface TeacherCollectionMemberRow {
  member_id: number;
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  resource_kind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
  resource_url: string | null;
  emoji: string | null;
  card_image_url: string | null;
  is_character_active: boolean;
  sort_order: number;
}

export interface TeacherCollectionRewardRow {
  reward_id: number;
  effect_id: number;
  effect_code: string;
  display_name: string;
  domain_code: string;
  value_unit: BuffValueUnit;
  direction: BuffDirection;
  effect_value: number;
  cap_value: number;
  is_effect_active: boolean;
  sort_order: number;
}

export interface TeacherCharacterCollectionRow {
  id: number;
  collection_uid: string;
  name: string;
  description: string | null;
  collection_class: CollectionClass;
  is_active: boolean;
  is_visible: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  member_count: number;
  reward_count: number;
  complete_students: number;
  total_students: number;
  members: TeacherCollectionMemberRow[];
  rewards: TeacherCollectionRewardRow[];
}

export interface TeacherCharacterCollectionAdminBoard {
  total_students: number;
  effects: TeacherBuffEffectRow[];
  collections: TeacherCharacterCollectionRow[];
}

export interface TeacherCollectionPreviewStudent {
  student_id: number;
  name: string;
  brand_name: string | null;
  owned_count: number;
  required_count: number;
  is_complete: boolean;
}

export interface TeacherCollectionPreview {
  required_count: number;
  total_students: number;
  complete_students: number;
  students: TeacherCollectionPreviewStudent[];
}

type RpcValidationDetails = Extract<RpcResult<never>, { success: false; type: 'VALIDATION' }>['details'];

function validationError<T>(message: string, details: RpcValidationDetails = []): RpcResult<T> {
  return { success: false, type: 'VALIDATION', error: message, details };
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

export const characterC4BRpc = {
  board: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<TeacherCharacterCollectionAdminBoard>(supabase, 'teacher_get_character_collection_admin_board', {
      p_classroom_id: classroomId,
    }),

  suggestUid: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<string>(supabase, 'teacher_suggest_character_collection_uid', {
      p_classroom_id: classroomId,
    }),

  preview: (supabase: SupabaseClient, classroomId: number, characterIds: number[]) => {
    const parsed = TeacherPreviewCharacterCollectionSchema.safeParse({
      p_classroom_id: classroomId,
      p_character_ids: characterIds,
    });
    if (!parsed.success) {
      return Promise.resolve(validationError<TeacherCollectionPreview>(parsed.error.issues[0]?.message ?? '미리보기 정보를 확인해주세요.', parsed.error.issues));
    }
    return callRpc<TeacherCollectionPreview>(supabase, 'teacher_preview_character_collection_completion', parsed.data);
  },

  save: (supabase: SupabaseClient, input: TeacherSaveCharacterCollectionInput) => {
    const parsed = TeacherSaveCharacterCollectionSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(validationError<number>(parsed.error.issues[0]?.message ?? '콜렉션 설정을 확인해주세요.', parsed.error.issues));
    }
    return callRpc<number>(supabase, 'teacher_save_character_collection', {
      ...parsed.data,
      p_rewards: parsed.data.p_rewards,
    });
  },
};
