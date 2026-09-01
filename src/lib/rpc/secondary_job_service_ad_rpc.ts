import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';

const NoArgsSchema = z.object({}).strict();

const SubmitAdSchema = z.object({
  p_service_id: z.number().int().positive(),
  p_duration_days: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const AdIdSchema = z.object({
  p_ad_id: z.number().int().positive(),
});

const TeacherAdBoardSchema = z.object({
  p_classroom_id: z.number().int().positive(),
});

const TeacherReviewAdSchema = z.object({
  p_ad_id: z.number().int().positive(),
  p_action: z.enum(['APPROVE', 'REJECT']),
  p_note: z.string().trim().max(500).nullable(),
});

async function call<TOut>(
  supabase: SupabaseClient,
  name: string,
  schema: z.ZodTypeAny,
  input: unknown,
): Promise<RpcResult<TOut>> {
  const validation = validateInput(schema, input);
  if ('error' in validation) {
    return {
      success: false,
      type: 'VALIDATION',
      error: validation.error,
      details: validation.details,
    };
  }

  const { data, error } = await supabase.rpc(
    name,
    validation.data as Record<string, unknown>,
  );

  if (error) {
    return {
      success: false,
      type: 'SERVER',
      error: error.message,
      code: error.code,
    };
  }

  return { success: true, data: data as TOut };
}

export type ServiceAdStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type ServiceAdFeeOption = {
  duration_days: 1 | 2 | 3;
  fee_gold: number;
};

export type MyServiceAd = {
  id: number;
  service_id: number;
  service_title: string;
  service_price_gold: number;
  job_name: string;
  duration_days: 1 | 2 | 3;
  fee_gold: number;
  status: ServiceAdStatus;
  submitted_at: string;
  reviewed_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  review_note: string | null;
};

export type StudentServiceAdBoard = {
  server_now: string;
  fee_options: ServiceAdFeeOption[];
  can_submit: boolean;
  my_ads: MyServiceAd[];
};

export type StudentServiceAdMutationResult = {
  ad_id: number;
  status: ServiceAdStatus;
  duration_days?: 1 | 2 | 3;
  fee_gold?: number;
  charged_gold: number;
  transaction_id?: number;
  starts_at?: string;
  ends_at?: string;
};

export type TeacherServiceAd = {
  id: number;
  student_id: number;
  seller_name: string;
  service_id: number;
  service_title: string;
  service_price_gold: number;
  job_name: string;
  duration_days: 1 | 2 | 3;
  fee_gold: number;
  status: ServiceAdStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  starts_at: string | null;
  ends_at: string | null;
  review_note: string | null;
  service_active: boolean;
};

export type TeacherServiceAdBoard = {
  server_now: string;
  ads: TeacherServiceAd[];
};

export type HomeServiceAd = {
  ad_id: number;
  service_id: number;
  seller_student_id: number;
  seller_name: string;
  job_name: string;
  service_title: string;
  service_price_gold: number;
  ends_at: string;
};

export type HomeServiceAdBoard = {
  server_now: string;
  ads: HomeServiceAd[];
};

export const secondaryJobServiceAdStudentRpc = {
  board: (c: SupabaseClient) =>
    call<StudentServiceAdBoard>(
      c,
      'student_get_secondary_job_service_ad_board',
      NoArgsSchema,
      {},
    ),

  submit: (
    c: SupabaseClient,
    serviceId: number,
    durationDays: 1 | 2 | 3,
  ) =>
    call<StudentServiceAdMutationResult>(
      c,
      'student_submit_secondary_job_service_ad',
      SubmitAdSchema,
      {
        p_service_id: serviceId,
        p_duration_days: durationDays,
      },
    ),

  cancel: (c: SupabaseClient, adId: number) =>
    call<StudentServiceAdMutationResult>(
      c,
      'student_cancel_secondary_job_service_ad',
      AdIdSchema,
      { p_ad_id: adId },
    ),
};

export const secondaryJobServiceAdTeacherRpc = {
  board: (c: SupabaseClient, classroomId: number) =>
    call<TeacherServiceAdBoard>(
      c,
      'teacher_get_secondary_job_service_ads',
      TeacherAdBoardSchema,
      { p_classroom_id: classroomId },
    ),

  review: (
    c: SupabaseClient,
    adId: number,
    action: 'APPROVE' | 'REJECT',
    note: string | null,
  ) =>
    call<StudentServiceAdMutationResult>(
      c,
      'teacher_review_secondary_job_service_ad',
      TeacherReviewAdSchema,
      {
        p_ad_id: adId,
        p_action: action,
        p_note: note,
      },
    ),
};

export const secondaryJobServiceAdHomeRpc = {
  board: (c: SupabaseClient) =>
    call<HomeServiceAdBoard>(
      c,
      'student_get_home_secondary_job_service_ads',
      NoArgsSchema,
      {},
    ),
};
