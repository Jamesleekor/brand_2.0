import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import * as S from '@/lib/zod_schemas/economy_guard_schemas';

function validationFailure(error: z.ZodError): RpcResult<never> {
  return {
    success: false,
    type: 'VALIDATION',
    error: error.issues.map((issue) => issue.message).join(' · '),
    details: error.issues,
  };
}

async function call<T>(
  supabase: SupabaseClient,
  name: string,
  inputSchema: z.ZodTypeAny,
  input: unknown,
  outputSchema: z.ZodType<T>,
): Promise<RpcResult<T>> {
  const parsedInput = inputSchema.safeParse(input);
  if (!parsedInput.success) return validationFailure(parsedInput.error);

  const { data, error } = await supabase.rpc(name, parsedInput.data as Record<string, unknown>);
  if (error) {
    console.error(`[B.R.A.N.D Economy Guard] RPC failed: ${name}`, {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      input: parsedInput.data,
    });
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }

  const parsedOutput = outputSchema.safeParse(data);
  if (!parsedOutput.success) {
    console.error(`[B.R.A.N.D Economy Guard] response contract failed: ${name}`, parsedOutput.error.issues);
    return {
      success: false,
      type: 'SERVER',
      error: `경제수호대 응답 형식이 예상과 다릅니다. (${name})`,
      code: 'EG_RESPONSE_CONTRACT',
    };
  }

  return { success: true, data: parsedOutput.data };
}

const NoArgsSchema = z.object({}).strict();

export const economyGuardRpc = {
  getAccess: (supabase: SupabaseClient): Promise<RpcResult<S.EconomyGuardAccess>> =>
    call(supabase, 'economy_guard_get_access', NoArgsSchema, {}, S.EconomyGuardAccessSchema),

  getDashboard: (
    supabase: SupabaseClient,
    input: S.EconomyGuardPeriodInput,
  ): Promise<RpcResult<S.EconomyGuardDashboard>> =>
    call(
      supabase,
      'economy_guard_get_dashboard_v2',
      S.EconomyGuardPeriodInputSchema,
      input,
      S.EconomyGuardDashboardSchema,
    ),

  getAiContext: (
    supabase: SupabaseClient,
    input: S.EconomyGuardPeriodInput,
  ): Promise<RpcResult<S.EconomyGuardAiContext>> =>
    call(
      supabase,
      'economy_guard_get_ai_context_v2',
      S.EconomyGuardPeriodInputSchema,
      input,
      S.EconomyGuardAiContextSchema,
    ),

  captureInequalitySnapshot: (
    supabase: SupabaseClient,
  ): Promise<RpcResult<S.EconomyGuardSnapshotResult>> =>
    call(
      supabase,
      'economy_guard_capture_inequality_snapshot',
      NoArgsSchema,
      {},
      S.EconomyGuardSnapshotResultSchema,
    ),

  markNormal: (
    supabase: SupabaseClient,
    input: S.EconomyGuardMarkNormalInput,
  ): Promise<RpcResult<S.EconomyGuardWriteResult>> =>
    call(
      supabase,
      'economy_guard_mark_event_normal',
      S.EconomyGuardMarkNormalSchema,
      input,
      S.EconomyGuardWriteResultSchema,
    ),

  flagEvent: (
    supabase: SupabaseClient,
    input: S.EconomyGuardFlagEventInput,
  ): Promise<RpcResult<S.EconomyGuardWriteResult>> =>
    call(
      supabase,
      'economy_guard_flag_event',
      S.EconomyGuardFlagEventSchema,
      input,
      S.EconomyGuardWriteResultSchema,
    ),
};
