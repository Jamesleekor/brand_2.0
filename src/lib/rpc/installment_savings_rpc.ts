import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from './student_rpc';

export type InstallmentProductStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
export type InstallmentContractStatus = 'ACTIVE' | 'MATURED' | 'EARLY_WITHDRAWN';
export type InstallmentRoundStatus = 'PENDING' | 'PAID' | 'MISSED' | 'CANCELLED';

export interface InstallmentTerm {
  id: number;
  total_rounds: number;
  interval_weeks: number;
  contract_weeks: number;
  base_weekly_interest_rate: number;
  effective_weekly_interest_rate: number;
  collection_bonus_pp: number;
}

export interface InstallmentProduct {
  id: number;
  product_uid: string;
  product_name: string;
  description: string | null;
  min_installment_amount: number;
  max_installment_amount: number;
  early_withdrawal_penalty_rate: number;
  terms: InstallmentTerm[];
}

export interface InstallmentRound {
  id: number;
  round_no: number;
  due_date: string;
  status: InstallmentRoundStatus;
  paid_amount: number;
  transaction_id?: number | null;
  processed_at: string | null;
  miss_reason: string | null;
}

export interface StudentInstallmentContract {
  id: number;
  installment_uid: string;
  product_name_snapshot: string;
  installment_amount: number;
  total_rounds: number;
  interval_weeks: number;
  base_weekly_interest_rate: number;
  collection_bonus_pp: number;
  effective_weekly_interest_rate: number;
  early_withdrawal_penalty_rate: number;
  start_date: string;
  maturity_date: string;
  status: InstallmentContractStatus;
  paid_rounds: number;
  missed_rounds: number;
  actual_principal: number;
  gross_interest: number;
  tax_paid: number;
  interest_paid: number;
  processed_at: string | null;
  rounds: InstallmentRound[];
}

export interface StudentInstallmentBank {
  student_id: number;
  classroom_id: number;
  wallet_gold: number;
  collection_bonus_pp: number;
  products: InstallmentProduct[];
  contracts: StudentInstallmentContract[];
  policy: {
    first_round: 'IMMEDIATE';
    insufficient_gold: 'MISSED_NO_CATCHUP';
    interest_model: 'SIMPLE_INTEREST_PER_PAID_ROUND';
    schedule_timezone: 'Asia/Seoul';
  };
}

export interface InstallmentQuote {
  student_id: number;
  product_id: number;
  term_id: number;
  product_name: string;
  installment_amount: number;
  total_rounds: number;
  interval_weeks: number;
  planned_total_principal: number;
  base_weekly_interest_rate: number;
  collection_bonus_pp: number;
  effective_weekly_interest_rate: number;
  estimated_full_schedule_gross_interest: number;
  estimated_tax: number;
  estimated_full_schedule_net_interest: number;
  estimated_full_schedule_maturity_payout: number;
  start_date: string;
  maturity_date: string;
  first_round_due_date: string;
  early_withdrawal_penalty_rate: number;
  estimated_penalty_if_fully_paid: number;
  wallet_gold: number;
  can_afford_first_round: boolean;
  insufficient_gold_policy: 'MISSED_NO_CATCHUP';
  rate_snapshot_timing: 'AT_SUBSCRIPTION';
  interest_model: 'SIMPLE_INTEREST_PER_PAID_ROUND';
}

export interface TeacherInstallmentTerm {
  id: number;
  total_rounds: number;
  interval_weeks: number;
  contract_weeks: number;
  base_weekly_interest_rate: number;
  sort_order: number;
  is_active: boolean;
}

export interface TeacherInstallmentProduct {
  id: number;
  product_uid: string;
  product_name: string;
  description: string | null;
  min_installment_amount: number;
  max_installment_amount: number;
  early_withdrawal_penalty_rate: number;
  status: InstallmentProductStatus;
  launched_at: string;
  active_contract_count: number;
  total_contract_count: number;
  terms: TeacherInstallmentTerm[];
}

export interface TeacherInstallmentBoard {
  classroom_id: number;
  summary: {
    total_products: number;
    active_products: number;
    active_contracts: number;
    total_contracts: number;
    pending_rounds: number;
  };
  products: TeacherInstallmentProduct[];
}

export interface TeacherInstallmentHistoryRow {
  id: number;
  installment_uid: string;
  student_id: number;
  student_name: string;
  student_brand_name: string | null;
  product_id: number;
  product_name_snapshot: string;
  installment_amount: number;
  total_rounds: number;
  interval_weeks: number;
  base_weekly_interest_rate: number;
  collection_bonus_pp: number;
  effective_weekly_interest_rate: number;
  early_withdrawal_penalty_rate: number;
  start_date: string;
  maturity_date: string;
  status: InstallmentContractStatus;
  paid_rounds: number;
  missed_rounds: number;
  actual_principal: number;
  gross_interest: number;
  tax_paid: number;
  interest_paid: number;
  processed_at: string | null;
  projected_gross_interest_from_current_paid_rounds: number;
  rounds: InstallmentRound[];
}

export interface TeacherInstallmentHistoryBoard {
  classroom_id: number;
  total_count: number;
  limit: number;
  offset: number;
  rows: TeacherInstallmentHistoryRow[];
  summary: {
    total_contracts: number;
    active_count: number;
    matured_count: number;
    early_withdrawn_count: number;
    active_actual_principal: number;
  };
}

const quoteSchema = z.object({
  p_product_id: z.number().int().positive(),
  p_term_id: z.number().int().positive(),
  p_installment_amount: z.number().int().positive(),
});

const subscribeSchema = quoteSchema;
const earlySchema = z.object({ p_contract_id: z.number().int().positive() });

const termSchema = z.object({
  total_rounds: z.number().int().min(1).max(52),
  interval_weeks: z.number().int().min(1).max(12),
  base_weekly_interest_rate: z.number().min(0).max(100),
  sort_order: z.number().int().optional(),
}).superRefine((value, ctx) => {
  if (value.total_rounds * value.interval_weeks > 52) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '총 적금 계약기간은 52주를 넘을 수 없습니다.' });
  }
});

const saveProductSchema = z.object({
  product_id: z.number().int().positive().nullable().optional(),
  product_name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  min_installment_amount: z.number().int().positive(),
  max_installment_amount: z.number().int().positive().max(10_000_000),
  early_withdrawal_penalty_rate: z.number().min(0).max(1),
  terms: z.array(termSchema),
}).superRefine((value, ctx) => {
  if (value.max_installment_amount < value.min_installment_amount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '최대 회차 납입액은 최소 납입액 이상이어야 합니다.' });
  }
  const schedules = value.terms.map((term) => `${term.total_rounds}x${term.interval_weeks}`);
  if (new Set(schedules).size !== schedules.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '같은 회차/간격 조합을 두 번 등록할 수 없습니다.' });
  }
});

const statusSchema = z.object({
  p_product_id: z.number().int().positive(),
  p_status: z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']),
});

const historySchema = z.object({
  p_limit: z.number().int().min(1).max(500).optional(),
  p_offset: z.number().int().min(0).optional(),
  p_student_id: z.number().int().positive().nullable().optional(),
  p_status: z.enum(['ALL', 'ACTIVE', 'MATURED', 'EARLY_WITHDRAWN']).optional(),
  p_product_id: z.number().int().positive().nullable().optional(),
  p_search: z.string().trim().max(100).nullable().optional(),
});

function validationError<T>(error: z.ZodError): RpcResult<T> {
  return {
    success: false,
    type: 'VALIDATION',
    error: error.issues[0]?.message ?? '입력값을 확인해주세요.',
    details: error.issues,
  };
}

async function callRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const installmentSavingsRpc = {
  getMyBank: (supabase: SupabaseClient) =>
    callRpc<StudentInstallmentBank>(supabase, 'get_my_installment_savings_bank'),
  getQuote: (supabase: SupabaseClient, input: z.infer<typeof quoteSchema>) => {
    const parsed = quoteSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<InstallmentQuote>(parsed.error));
    return callRpc<InstallmentQuote>(supabase, 'get_my_installment_savings_quote', parsed.data);
  },
  subscribe: (supabase: SupabaseClient, input: z.infer<typeof subscribeSchema>) => {
    const parsed = subscribeSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<number>(parsed.error));
    return callRpc<number>(supabase, 'subscribe_to_installment_savings', parsed.data);
  },
  earlyWithdraw: (supabase: SupabaseClient, input: z.infer<typeof earlySchema>) => {
    const parsed = earlySchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<Record<string, unknown>>(parsed.error));
    return callRpc<Record<string, unknown>>(supabase, 'early_withdraw_installment_savings', parsed.data);
  },
  teacherBoard: (supabase: SupabaseClient) =>
    callRpc<TeacherInstallmentBoard>(supabase, 'teacher_get_installment_savings_admin_board'),
  teacherSaveProduct: (supabase: SupabaseClient, payload: z.infer<typeof saveProductSchema>) => {
    const parsed = saveProductSchema.safeParse(payload);
    if (!parsed.success) return Promise.resolve(validationError<Record<string, unknown>>(parsed.error));
    return callRpc<Record<string, unknown>>(supabase, 'teacher_save_installment_savings_product', { p_payload: parsed.data });
  },
  teacherSetStatus: (supabase: SupabaseClient, input: z.infer<typeof statusSchema>) => {
    const parsed = statusSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<Record<string, unknown>>(parsed.error));
    return callRpc<Record<string, unknown>>(supabase, 'teacher_set_installment_savings_product_status', parsed.data);
  },
  teacherHistory: (supabase: SupabaseClient, input: z.infer<typeof historySchema> = {}) => {
    const parsed = historySchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<TeacherInstallmentHistoryBoard>(parsed.error));
    return callRpc<TeacherInstallmentHistoryBoard>(supabase, 'teacher_get_installment_savings_history', parsed.data);
  },
  teacherProcessNow: (supabase: SupabaseClient) =>
    callRpc<Record<string, unknown>>(supabase, 'teacher_process_installment_savings_now'),
};
