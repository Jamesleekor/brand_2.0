import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/secondary_job_schemas';

async function call<TIn, TOut>(
  supabase: SupabaseClient,
  name: string,
  schema: z.ZodType<TIn>,
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

export type SecondaryJobStatus = {
  student_id: number;
  classroom_id: number;
  current_tier: string | null;
  unlock_tier: string;
  eligible: boolean;
  slot_limit: number;
  active_count: number;
  pending_count: number;
  remaining_slots: number;
  employment_freeze: boolean;
};

export const secondaryJobStudentRpc = {
  status: (c: SupabaseClient) => call<{}, SecondaryJobStatus>(c, 'student_get_secondary_job_status', S.NoArgsSchema, {}),
  apply: (c: SupabaseClient, input: S.ApplySecondaryJobInput) => call<S.ApplySecondaryJobInput, number>(c, 'apply_secondary_job', S.ApplySecondaryJobSchema, input),
};

export const secondaryJobTeacherRpc = {
  approve: (c: SupabaseClient, input: S.ApproveSecondaryJobInput) => call<S.ApproveSecondaryJobInput, number | null>(c, 'approve_secondary_job', S.ApproveSecondaryJobSchema, input),
  upsertCatalog: (c: SupabaseClient, input: S.UpsertSecondaryJobCatalogInput) => call<S.UpsertSecondaryJobCatalogInput, number>(c, 'teacher_upsert_secondary_job_catalog', S.UpsertSecondaryJobCatalogSchema, input),
  release: (c: SupabaseClient, input: S.ReleaseSecondaryJobInput) => call<S.ReleaseSecondaryJobInput, null>(c, 'teacher_release_secondary_job', S.ReleaseSecondaryJobSchema, input),
  deleteCatalog: (c: SupabaseClient, input: S.DeleteSecondaryJobCatalogInput) => call<S.DeleteSecondaryJobCatalogInput, null>(c, 'teacher_delete_secondary_job_catalog', S.DeleteSecondaryJobCatalogSchema, input),
};
