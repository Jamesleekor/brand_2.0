import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RpcResult } from './student_rpc';

export type DepositProductStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
export type StudentDepositStatus = 'ACTIVE' | 'MATURED' | 'EARLY_WITHDRAWN';

export interface SavingsTerm {
  id: number;
  term_weeks: number;
  base_interest_rate: number;
  collection_bonus_pp: number;
  effective_interest_rate: number;
  sort_order: number;
}

export interface SavingsProduct {
  id: number;
  product_uid: string;
  product_name: string;
  description: string | null;
  min_amount: number;
  max_amount: number;
  early_withdrawal_penalty_rate: number;
  status: DepositProductStatus;
  terms: SavingsTerm[];
}

export interface StudentDeposit {
  id: number;
  deposit_uid: string;
  product_id: number;
  product_name_snapshot: string;
  principal: number;
  deposit_weeks: number;
  base_interest_rate_snapshot: number;
  collection_bonus_pp_snapshot: number;
  effective_interest_rate_snapshot: number;
  early_withdrawal_penalty_rate_snapshot: number;
  start_date: string;
  maturity_date: string;
  status: StudentDepositStatus;
  interest_paid: number;
  processed_at: string | null;
  expected_gross_interest: number;
  can_early_withdraw: boolean;
}

export interface StudentSavingsBank {
  student_id: number;
  classroom_id: number;
  gold: number;
  savings_bonus_pp: number;
  asset_freeze_active: boolean;
  products: SavingsProduct[];
  deposits: StudentDeposit[];
}

export interface DepositQuote {
  student_id: number;
  product_id: number;
  product_name: string;
  term_weeks: number;
  principal: number;
  base_interest_rate: number;
  collection_bonus_pp: number;
  effective_interest_rate: number;
  gross_interest_at_maturity: number;
  estimated_tax: number;
  estimated_net_interest: number;
  estimated_maturity_payout: number;
  maturity_date: string;
  early_withdrawal_penalty_rate: number;
  estimated_early_withdrawal_penalty: number;
  estimated_early_withdrawal_payout: number;
  wallet_gold: number;
  can_afford: boolean;
  tax_is_estimate: boolean;
  rate_snapshot_timing: 'AT_SUBSCRIPTION';
}

export interface TeacherSavingsTerm {
  id: number;
  term_weeks: number;
  base_interest_rate: number;
  sort_order: number;
  is_active: boolean;
}

export interface TeacherSavingsProduct {
  id: number;
  product_uid: string;
  product_name: string;
  description: string | null;
  min_amount: number;
  max_amount: number;
  early_withdrawal_penalty_rate: number;
  status: DepositProductStatus;
  launched_at: string;
  created_at: string;
  active_deposit_count: number;
  total_deposit_count: number;
  terms: TeacherSavingsTerm[];
}

export interface TeacherSavingsBoard {
  classroom_id: number;
  products: TeacherSavingsProduct[];
  policy: {
    term_min_weeks: number;
    term_max_weeks: number;
    base_rate_min_percent: number;
    base_rate_max_percent: number;
    delete_model: string;
    legacy_interest_rates_json: string;
  };
}


export interface TeacherDepositHistoryStudent {
  id: number;
  name: string;
  brand_name: string | null;
}

export interface TeacherDepositHistoryProduct {
  id: number;
  product_name: string;
}

export interface TeacherDepositHistoryRow {
  id: number;
  deposit_uid: string;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  product_id: number;
  product_name_snapshot: string;
  principal: number;
  deposit_weeks: number;
  base_interest_rate_snapshot: number;
  collection_bonus_pp_snapshot: number;
  effective_interest_rate_snapshot: number;
  early_withdrawal_penalty_rate_snapshot: number;
  start_date: string;
  maturity_date: string;
  status: StudentDepositStatus;
  interest_paid: number;
  processed_at: string | null;
  expected_gross_interest: number;
  actual_net_interest: number | null;
  expected_gross_maturity_payout: number;
  actual_maturity_payout: number | null;
  is_overdue: boolean;
}

export interface TeacherDepositHistoryBoard {
  classroom_id: number;
  rows: TeacherDepositHistoryRow[];
  total_count: number;
  limit: number;
  offset: number;
  students: TeacherDepositHistoryStudent[];
  products: TeacherDepositHistoryProduct[];
  summary: {
    total_contracts: number;
    active_count: number;
    matured_count: number;
    early_withdrawn_count: number;
    active_principal: number;
  };
}

export interface TeacherSaveProductResult {
  success: true;
  product_id: number;
  status: DepositProductStatus;
  active_term_count: number;
  legacy_interest_rates: Record<string, number>;
}

export interface TeacherStatusResult {
  success: true;
  product_id: number;
  status: DepositProductStatus;
  active_term_count: number;
  active_deposit_count: number;
}

export interface S4EconomyTerms {
  student_id: number;
  classroom_id: number;
  fee_rounding: 'FLOOR';
  fee_destination: 'WELFARE_FUND';
  market_sell: {
    base_fee_rate: number;
    buff_reduction_pp: number;
    effective_fee_rate: number;
    applies_to: 'SELLBACK_ONLY';
  };
  p2p_transfer: {
    base_fee_rate: number;
    buff_reduction_pp: number;
    effective_fee_rate: number;
    fee_paid_by: 'SENDER_ADDITIONAL';
  };
  savings: {
    interest_bonus_pp: number;
    snapshot_timing: 'AT_SUBSCRIPTION_EFFECTIVE_RATE';
  };
}

export interface P2PTransferQuote {
  amount: number;
  base_fee_rate: number;
  buff_reduction_pp: number;
  effective_fee_rate: number;
  fee_gold: number;
  sender_total_debit: number;
  receiver_credit: number;
  wallet_gold: number;
  can_afford: boolean;
}

const quoteSchema = z.object({
  p_product_id: z.number().int().positive(),
  p_weeks: z.number().int().min(1).max(52),
  p_principal: z.number().int().positive(),
});

const subscribeSchema = z.object({
  p_student_id: z.number().int().positive(),
  p_product_id: z.number().int().positive(),
  p_principal: z.number().int().positive(),
  p_weeks: z.number().int().min(1).max(52),
});

const earlySchema = z.object({ p_deposit_id: z.number().int().positive() });
const p2pQuoteSchema = z.object({ p_amount: z.number().int().min(1).max(1_000_000) });

const teacherTermSchema = z.object({
  term_weeks: z.number().int().min(1).max(52),
  base_interest_rate: z.number().min(0).max(100),
  sort_order: z.number().int().optional(),
});

const teacherSaveSchema = z.object({
  product_id: z.number().int().positive().nullable().optional(),
  product_name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  min_amount: z.number().int().positive(),
  max_amount: z.number().int().positive(),
  early_withdrawal_penalty_rate: z.number().min(0).max(1),
  terms: z.array(teacherTermSchema),
}).superRefine((value, ctx) => {
  if (value.max_amount < value.min_amount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '최대 가입금액은 최소 가입금액 이상이어야 합니다.' });
  }
  const weeks = value.terms.map((term) => term.term_weeks);
  if (new Set(weeks).size !== weeks.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '같은 가입 기간을 두 번 등록할 수 없습니다.' });
  }
});

const statusSchema = z.object({
  p_product_id: z.number().int().positive(),
  p_status: z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']),
});

const teacherHistorySchema = z.object({
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

export const savingsRpc = {
  getMyBank: (supabase: SupabaseClient) => callRpc<StudentSavingsBank>(supabase, 'get_my_savings_bank'),
  getQuote: (supabase: SupabaseClient, input: z.infer<typeof quoteSchema>) => {
    const parsed = quoteSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<DepositQuote>(parsed.error));
    return callRpc<DepositQuote>(supabase, 'get_my_deposit_quote', parsed.data);
  },
  subscribe: (supabase: SupabaseClient, input: z.infer<typeof subscribeSchema>) => {
    const parsed = subscribeSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<number>(parsed.error));
    return callRpc<number>(supabase, 'subscribe_to_deposit', parsed.data);
  },
  earlyWithdraw: (supabase: SupabaseClient, input: z.infer<typeof earlySchema>) => {
    const parsed = earlySchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<number>(parsed.error));
    return callRpc<number>(supabase, 'early_withdraw_deposit', parsed.data);
  },
  getEconomyTerms: (supabase: SupabaseClient) => callRpc<S4EconomyTerms>(supabase, 'get_my_s4_economy_terms'),
  getP2PQuote: (supabase: SupabaseClient, input: z.infer<typeof p2pQuoteSchema>) => {
    const parsed = p2pQuoteSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<P2PTransferQuote>(parsed.error));
    return callRpc<P2PTransferQuote>(supabase, 'get_my_p2p_transfer_quote', parsed.data);
  },
  teacherBoard: (supabase: SupabaseClient) => callRpc<TeacherSavingsBoard>(supabase, 'teacher_get_deposit_product_admin_board'),
  teacherHistory: (supabase: SupabaseClient, input: z.infer<typeof teacherHistorySchema> = {}) => {
    const parsed = teacherHistorySchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<TeacherDepositHistoryBoard>(parsed.error));
    return callRpc<TeacherDepositHistoryBoard>(supabase, 'teacher_get_deposit_history', parsed.data);
  },
  teacherSaveProduct: (supabase: SupabaseClient, payload: z.infer<typeof teacherSaveSchema>) => {
    const parsed = teacherSaveSchema.safeParse(payload);
    if (!parsed.success) return Promise.resolve(validationError<TeacherSaveProductResult>(parsed.error));
    return callRpc<TeacherSaveProductResult>(supabase, 'teacher_save_deposit_product', { p_payload: parsed.data });
  },
  teacherSetStatus: (supabase: SupabaseClient, input: z.infer<typeof statusSchema>) => {
    const parsed = statusSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationError<TeacherStatusResult>(parsed.error));
    return callRpc<TeacherStatusResult>(supabase, 'teacher_set_deposit_product_status', parsed.data);
  },
  processMatured: (supabase: SupabaseClient, classroomId?: number | null) =>
    callRpc<number>(supabase, 'process_matured_deposits', { p_classroom_id: classroomId ?? null }),
};
