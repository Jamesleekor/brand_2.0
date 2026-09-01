import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import {
  RecruitCharacterSchema,
  TeacherSetCharacterRecruitmentOfferSchema,
  type CharacterRecruitmentMode,
  type TeacherSetCharacterRecruitmentOfferInput,
} from '@/lib/zod_schemas/character_s1_schemas';

type RpcValidationDetails =
  Extract<RpcResult<never>, { success: false; type: 'VALIDATION' }>['details'];

export type StudentRecruitmentAvailabilityCode =
  | 'READY'
  | 'ALREADY_OWNED'
  | 'REVOKED_TEACHER_RESTORE_REQUIRED'
  | 'OFFER_NOT_CONFIGURED'
  | 'OFFER_INACTIVE'
  | 'TEACHER_ONLY'
  | 'EVENT_ONLY'
  | 'UNAVAILABLE'
  | 'POLICY_UNAVAILABLE'
  | 'REQUIREMENT_NOT_MET'
  | 'INVALID_PRICE';

export interface StudentCharacterRecruitmentRow {
  character_id: number;
  acquisition_mode: CharacterRecruitmentMode | null;
  base_price_crystal: number | null;
  effective_price_crystal: number | null;
  offer_active: boolean;
  is_eligible: boolean;
  can_self_recruit: boolean;
  availability_code: StudentRecruitmentAvailabilityCode;
}

export interface RecruitCharacterResult {
  student_id: number;
  character_id: number;
  character_uid: string;
  character_name: string;
  ownership_id: number;
  transaction_id: number | null;
  acquisition_mode: 'CRYSTAL' | 'FREE';
  price_paid_crystal: number;
}

export interface TeacherCharacterRecruitmentOffer {
  id: number;
  acquisition_mode: CharacterRecruitmentMode;
  base_price_crystal: number;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
}

export interface TeacherCharacterRecruitmentRow {
  character_id: number;
  character_uid: string;
  name: string;
  epithet: string | null;
  resource_kind: 'EMOJI' | 'IMAGE' | 'ANIMATED_IMAGE';
  resource_url: string | null;
  emoji: string | null;
  full_image_url: string | null;
  card_image_url: string | null;
  is_active: boolean;
  sort_order: number;
  policy_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | null;
  policy_is_recruitable: boolean;
  source_condition_text: string | null;
  eligible_students: number;
  total_students: number;
  owned_students: number;
  self_recruitable_students: number;
  offer: TeacherCharacterRecruitmentOffer | null;
}

export interface TeacherCharacterRecruitmentBoard {
  characters: TeacherCharacterRecruitmentRow[];
  configured_offers: number;
  active_self_offers: number;
}

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

export const characterS1Rpc = {
  myStore: (supabase: SupabaseClient) =>
    callRpc<StudentCharacterRecruitmentRow[]>(supabase, 'get_my_character_recruitment_store'),

  recruit: (supabase: SupabaseClient, characterId: number) => {
    const parsed = RecruitCharacterSchema.safeParse({ p_character_id: characterId });
    if (!parsed.success) {
      return Promise.resolve(
        validationError<RecruitCharacterResult>(
          parsed.error.issues[0]?.message ?? '영입 정보를 확인해주세요.',
          parsed.error.issues,
        ),
      );
    }
    return callRpc<RecruitCharacterResult>(supabase, 'recruit_character', parsed.data);
  },

  teacherBoard: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<TeacherCharacterRecruitmentBoard>(supabase, 'teacher_get_character_recruitment_store_board', {
      p_classroom_id: classroomId,
    }),

  teacherSetOffer: (supabase: SupabaseClient, input: TeacherSetCharacterRecruitmentOfferInput) => {
    const parsed = TeacherSetCharacterRecruitmentOfferSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        validationError<number>(
          parsed.error.issues[0]?.message ?? '영입 설정을 확인해주세요.',
          parsed.error.issues,
        ),
      );
    }
    return callRpc<number>(supabase, 'teacher_set_character_recruitment_offer', parsed.data);
  },
};
