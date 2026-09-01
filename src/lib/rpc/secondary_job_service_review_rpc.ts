import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/secondary_job_service_review_schemas';

// z.ZodTypeAny is intentional. This repository builds with non-strict TS settings,
// where Zod object inference can appear optional at the type level. Runtime validation
// still uses the exact schemas below.
async function call<TOut>(
  supabase: SupabaseClient,
  name: string,
  schema: z.ZodTypeAny,
  input: unknown,
): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) {
    return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  }
  const { data, error } = await supabase.rpc(name, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOut };
}

export type SellerPublicReview = {
  rating: number | null;
  review_text: string;
};

export type SellerReputation = {
  seller_student_id: number;
  seller_name: string;
  rating_count: number;
  average_rating: number | null;
  visible_review_count: number;
  can_view_individual_ratings: boolean;
  reviews: SellerPublicReview[];
};

export type MyServiceReview = {
  id: number;
  order_id: number;
  rating: number;
  review_text: string;
  is_review_visible: boolean;
  is_rating_valid: boolean;
  created_at: string;
};

export type ServiceReputationBoard = {
  seller_reputations: SellerReputation[];
  my_seller_reputation: SellerReputation | null;
  my_reviews: MyServiceReview[];
};

export type TeacherServiceReview = {
  id: number;
  order_id: number;
  service_id: number;
  service_title: string;
  buyer_student_id: number;
  buyer_name: string;
  seller_student_id: number;
  seller_name: string;
  rating: number;
  review_text: string;
  is_review_visible: boolean;
  is_rating_valid: boolean;
  created_at: string;
  moderated_at: string | null;
  moderation_reason: string | null;
};

export type TeacherServiceReviewBoard = { reviews: TeacherServiceReview[] };

export const secondaryJobServiceReviewStudentRpc = {
  board: (c: SupabaseClient) =>
    call<ServiceReputationBoard>(c, 'student_get_secondary_job_service_reputation_board', S.NoArgsSchema, {}),

  submit: (c: SupabaseClient, i: S.SubmitServiceReviewInput) =>
    call<number>(c, 'student_submit_secondary_job_service_review', S.SubmitServiceReviewSchema, i),
};

export const secondaryJobServiceReviewTeacherRpc = {
  board: (c: SupabaseClient, classroomId: number) =>
    call<TeacherServiceReviewBoard>(
      c,
      'teacher_get_secondary_job_service_reviews',
      S.TeacherServiceReviewBoardSchema,
      { p_classroom_id: classroomId },
    ),

  moderate: (c: SupabaseClient, i: S.TeacherModerateServiceReviewInput) =>
    call<null>(c, 'teacher_moderate_secondary_job_service_review', S.TeacherModerateServiceReviewSchema, i),
};
