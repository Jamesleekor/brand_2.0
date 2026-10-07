import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';

export type QuickService = { id: number; seller_student_id: number; seller_name: string; title: string; job_name: string; suggested_amount: number | null };
export type QuickServiceOrder = { id: number; service_title: string; amount: number; buyer_student_id: number; buyer_name: string; seller_student_id: number; seller_name: string; status: string; note: string | null; status_reason: string | null; created_at: string };
export type QuickServiceBoard = { gold: number; asset_freeze: boolean; services: QuickService[]; orders: QuickServiceOrder[] };
export type QuickServiceAction = 'PAY' | 'REFUND' | 'DISPUTE';
export const QuickHoldSchema = z.object({ p_service_id: z.number().int().positive(), p_amount: z.number().int().min(1).max(1_000_000), p_note: z.string().trim().max(500).nullable(), p_request_id: z.string().uuid() });
export const QuickActionSchema = z.object({ p_order_id: z.number().int().positive(), p_action: z.enum(['PAY','REFUND','DISPUTE']), p_reason: z.string().trim().max(500).nullable() }).superRefine((v, ctx) => {
  if (v.p_action === 'DISPUTE' && (v.p_reason?.length ?? 0) < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_reason'], message: '사유를 2자 이상 적어주세요.' });
});
async function rpc<T>(c: SupabaseClient, name: string, schema: z.ZodTypeAny, input: unknown): Promise<RpcResult<T>> {
  const parsed = schema.safeParse(input);
  if (parsed.success === false) return { success: false, type: 'VALIDATION', error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요.', details: parsed.error.issues };
  const { data, error } = await c.rpc(name, parsed.data);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}
export const quickServiceRpc = {
  board: (c: SupabaseClient) => rpc<QuickServiceBoard>(c, 'student_get_quick_service_board', z.object({}).strict(), {}),
  hold: (c: SupabaseClient, input: z.infer<typeof QuickHoldSchema>) => rpc<number>(c, 'student_hold_quick_service_gold', QuickHoldSchema, input),
  act: (c: SupabaseClient, input: z.infer<typeof QuickActionSchema>) => rpc<number | null>(c, 'student_act_quick_service_order', QuickActionSchema, input),
};
