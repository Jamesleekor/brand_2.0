import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import {
  TeacherCreateCharacterSchema,
  TeacherGrantCharacterSchema,
  TeacherSetCharacterPolicySchema,
  TeacherUpdateCharacterSchema,
  type TeacherCreateCharacterInput,
  type TeacherSetCharacterPolicyInput,
  type TeacherUpdateCharacterInput,
} from '@/lib/zod_schemas/character_c3_schemas';

export type CharacterPolicyStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';
export type CharacterRequirementMode = 'NONE' | 'GROUPS';
export type CharacterRequirementType = 'ACHIEVEMENT_COUNT' | 'ACHIEVEMENT_GRADE_COUNT' | 'TIER_AT_LEAST';
export type CharacterResourceKind = 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';

export interface TeacherCharacterRequirement {
  id: number;
  requirement_type: CharacterRequirementType;
  achievement_grade: string | null;
  required_numeric: number;
  sort_order: number;
}

export interface TeacherCharacterRequirementGroup {
  id: number;
  group_no: number;
  label: string | null;
  requirements: TeacherCharacterRequirement[];
}

export interface TeacherCharacterPolicy {
  id: number;
  status: CharacterPolicyStatus;
  is_recruitable: boolean;
  requirement_mode: CharacterRequirementMode;
  source_condition_text: string | null;
  is_source_baseline: boolean;
  notes: string | null;
  groups: TeacherCharacterRequirementGroup[];
}

export interface TeacherCharacterRow {
  id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  description: string | null;
  resource_kind: CharacterResourceKind;
  resource_url: string | null;
  emoji: string | null;
  full_image_url: string | null;
  card_image_url: string | null;
  avatar_image_url: string | null;
  is_active: boolean;
  sort_order: number;
  policy: TeacherCharacterPolicy | null;
  eligible_students: number;
  total_students: number;
  owned_students: number;
  equipped_students: number;
}

export interface TeacherCharacterStudentRow {
  id: number;
  name: string;
  brand_name: string | null;
  equipped_character_id: number | null;
  owned_character_ids: number[];
  owned_count: number;
}

export interface TeacherCharacterEventRow {
  id: number;
  event_type: 'RECRUIT' | 'TEACHER_GRANT' | 'RESTORE' | 'REVOKE' | 'MIGRATION';
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  character_id: number;
  character_uid: string;
  character_name: string;
  epithet: string | null;
}

export interface TeacherCharacterAdminBoard {
  characters: TeacherCharacterRow[];
  students: TeacherCharacterStudentRow[];
  events: TeacherCharacterEventRow[];
}

function validationError<T>(message: string, details: any[] = []): RpcResult<T> {
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

export const characterC3Rpc = {
  board: (supabase: SupabaseClient, classroomId: number, eventLimit = 100) =>
    callRpc<TeacherCharacterAdminBoard>(supabase, 'teacher_get_character_admin_board', {
      p_classroom_id: classroomId,
      p_event_limit: eventLimit,
    }),

  suggestUid: (supabase: SupabaseClient) =>
    callRpc<string>(supabase, 'teacher_suggest_character_uid'),

  createCharacter: (supabase: SupabaseClient, input: TeacherCreateCharacterInput) => {
    const parsed = TeacherCreateCharacterSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<number>(parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.', parsed.error.issues));
    return callRpc<number>(supabase, 'teacher_create_character', parsed.data);
  },

  updateCharacter: (supabase: SupabaseClient, input: TeacherUpdateCharacterInput) => {
    const parsed = TeacherUpdateCharacterSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<void>(parsed.error.issues[0]?.message ?? '입력값을 확인해주세요.', parsed.error.issues));
    return callRpc<void>(supabase, 'teacher_update_character', parsed.data);
  },

  setPolicy: (supabase: SupabaseClient, input: TeacherSetCharacterPolicyInput) => {
    const parsed = TeacherSetCharacterPolicySchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<number>(parsed.error.issues[0]?.message ?? '영입 조건을 확인해주세요.', parsed.error.issues));
    return callRpc<number>(supabase, 'teacher_set_character_recruitment_policy', parsed.data);
  },

  grant: (supabase: SupabaseClient, studentId: number, characterId: number, reason: string | null) => {
    const parsed = TeacherGrantCharacterSchema.safeParse({
      p_student_id: studentId,
      p_character_id: characterId,
      p_reason: reason,
    });
    if (!parsed.success) return Promise.resolve(validationError<number>(parsed.error.issues[0]?.message ?? '지급 정보를 확인해주세요.', parsed.error.issues));
    return callRpc<number>(supabase, 'teacher_grant_character', parsed.data);
  },

  revoke: (supabase: SupabaseClient, studentId: number, characterId: number, reason: string | null) => {
    const parsed = TeacherGrantCharacterSchema.safeParse({
      p_student_id: studentId,
      p_character_id: characterId,
      p_reason: reason,
    });
    if (!parsed.success) return Promise.resolve(validationError<void>(parsed.error.issues[0]?.message ?? '회수 정보를 확인해주세요.', parsed.error.issues));
    return callRpc<void>(supabase, 'teacher_revoke_character', parsed.data);
  },
};
