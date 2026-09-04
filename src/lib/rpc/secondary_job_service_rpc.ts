import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import * as S from '@/lib/zod_schemas/secondary_job_service_schemas';

async function call<TIn, TOut>(
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

export type ServiceActiveJob = {
  id: number;
  job_name: string;
  category: string | null;
};

export type ServiceOption = {
  id: number;
  name: string;
  price_gold: number;
  is_active: boolean;
  sort_order: number;
};

export type ServiceMarketItem = {
  id: number;
  seller_student_id: number;
  seller_name: string;
  secondary_job_id: number;
  job_name: string;
  job_category: string | null;
  title: string;
  subtitle: string | null;
  description: string;
  service_category: S.ServiceCategory | null;
  pricing_mode: S.ServicePricingMode;
  quantity_unit: string;
  price_gold: number | null;
  price_min_gold: number | null;
  price_max_gold: number | null;
  options: ServiceOption[];
  delivery_note: string | null;
  allow_concurrent_orders: boolean;
  created_at: string;
  can_buy: boolean;
  blocked_reason: string | null;
};

export type MyServiceItem = {
  id: number;
  secondary_job_id: number;
  job_name: string;
  job_category: string | null;
  title: string;
  subtitle: string | null;
  description: string;
  service_category: S.ServiceCategory | null;
  pricing_mode: S.ServicePricingMode;
  quantity_unit: string;
  price_gold: number | null;
  price_min_gold: number | null;
  price_max_gold: number | null;
  options: ServiceOption[];
  delivery_note: string | null;
  allow_concurrent_orders: boolean;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  active_orders: number;
  open_quote_requests: number;
};

export type ServiceOrderPricingFields = {
  price_gold: number | null;
  total_price_gold: number | null;
  pricing_mode: S.ServicePricingMode;
  option_id?: number | null;
  option_name: string | null;
  unit_price_gold: number | null;
  quantity: number | null;
  requested_quantity: number | null;
  quantity_unit: string;
  buyer_note: string | null;
  seller_quote_note: string | null;
  quote_offered_at: string | null;
  quote_accepted_at: string | null;
};

export type ServicePurchaseOrder = ServiceOrderPricingFields & {
  id: number;
  service_id: number;
  seller_student_id: number;
  seller_name: string;
  service_title: string;
  job_name: string;
  delivery_note: string | null;
  buyer_request: string;
  status: S.ServiceOrderStatus;
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  disputed_at: string | null;
  revision_requested_at: string | null;
  status_reason: string | null;
  created_at: string;
  current_revision: number;
  latest_delivery: string | null;
  latest_delivery_at: string | null;
};

export type ServiceSaleOrder = ServiceOrderPricingFields & {
  id: number;
  service_id: number;
  buyer_student_id: number;
  buyer_name: string;
  service_title: string;
  job_name: string;
  delivery_note: string | null;
  buyer_request: string;
  status: S.ServiceOrderStatus;
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  disputed_at: string | null;
  revision_requested_at: string | null;
  status_reason: string | null;
  created_at: string;
  current_revision: number;
  latest_delivery: string | null;
  latest_delivery_at: string | null;
};

export type ServiceMarketBoard = {
  server_now: string;
  gold: number;
  asset_freeze: boolean;
  active_jobs: ServiceActiveJob[];
  services: ServiceMarketItem[];
  my_services: MyServiceItem[];
  my_orders: ServicePurchaseOrder[];
  my_sales: ServiceSaleOrder[];
};

export type TeacherServiceOrder = ServiceOrderPricingFields & {
  id: number;
  service_id: number;
  service_title: string;
  buyer_student_id: number;
  buyer_name: string;
  seller_student_id: number;
  seller_name: string;
  job_name: string;
  buyer_request: string;
  status: S.ServiceOrderStatus;
  status_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  disputed_at: string | null;
  current_revision: number;
  escrow_transaction_id: number | null;
  payout_transaction_id: number | null;
  refund_transaction_id: number | null;
  latest_delivery: string | null;
  latest_delivery_at: string | null;
};

export type TeacherServiceBoard = { orders: TeacherServiceOrder[] };

export const secondaryJobServiceStudentRpc = {
  board: (c: SupabaseClient) =>
    call<{}, ServiceMarketBoard>(c, 'student_get_secondary_job_service_market', S.NoArgsSchema, {}),

  upsertService: (c: SupabaseClient, i: S.UpsertSecondaryJobServiceInput) =>
    call<S.UpsertSecondaryJobServiceInput, number>(
      c, 'student_upsert_secondary_job_service_v2', S.UpsertSecondaryJobServiceSchema, i,
    ),

  toggleService: (c: SupabaseClient, i: S.ToggleSecondaryJobServiceInput) =>
    call<S.ToggleSecondaryJobServiceInput, null>(
      c, 'student_toggle_secondary_job_service', S.ToggleSecondaryJobServiceSchema, i,
    ),

  deleteService: (c: SupabaseClient, i: S.ServiceIdInput) =>
    call<S.ServiceIdInput, null>(
      c, 'student_delete_secondary_job_service', S.ServiceIdSchema, i,
    ),

  buy: (c: SupabaseClient, i: S.BuySecondaryJobServiceInput) =>
    call<S.BuySecondaryJobServiceInput, number>(
      c, 'student_buy_secondary_job_service', S.BuySecondaryJobServiceSchema, i,
    ),

  order: (c: SupabaseClient, i: S.OrderSecondaryJobServiceV2Input) =>
    call<S.OrderSecondaryJobServiceV2Input, number>(
      c, 'student_order_secondary_job_service_v2', S.OrderSecondaryJobServiceV2Schema, i,
    ),

  offerQuote: (c: SupabaseClient, i: S.OfferSecondaryJobServiceQuoteInput) =>
    call<S.OfferSecondaryJobServiceQuoteInput, number>(
      c, 'student_offer_secondary_job_service_quote', S.OfferSecondaryJobServiceQuoteSchema, i,
    ),

  acceptQuote: (c: SupabaseClient, i: S.AcceptSecondaryJobServiceQuoteInput) =>
    call<S.AcceptSecondaryJobServiceQuoteInput, number>(
      c, 'student_accept_secondary_job_service_quote', S.AcceptSecondaryJobServiceQuoteSchema, i,
    ),

  buyerAction: (c: SupabaseClient, i: S.ServiceOrderActionInput) =>
    call<S.ServiceOrderActionInput, number | null>(
      c, 'student_act_secondary_job_service_purchase', S.ServiceOrderActionSchema, i,
    ),

  sellerAction: (c: SupabaseClient, i: S.ServiceOrderActionInput) =>
    call<S.ServiceOrderActionInput, number | null>(
      c, 'student_act_secondary_job_service_sale', S.ServiceOrderActionSchema, i,
    ),

  deliver: (c: SupabaseClient, i: S.DeliverSecondaryJobServiceInput) =>
    call<S.DeliverSecondaryJobServiceInput, number>(
      c, 'student_deliver_secondary_job_service_order', S.DeliverSecondaryJobServiceSchema, i,
    ),
};

export const secondaryJobServiceTeacherRpc = {
  board: (c: SupabaseClient, classroomId: number) =>
    call<S.TeacherServiceBoardInput, TeacherServiceBoard>(
      c, 'teacher_get_secondary_job_service_orders', S.TeacherServiceBoardSchema, { p_classroom_id: classroomId },
    ),

  resolve: (c: SupabaseClient, i: S.TeacherResolveServiceOrderInput) =>
    call<S.TeacherResolveServiceOrderInput, number | null>(
      c, 'teacher_resolve_secondary_job_service_order', S.TeacherResolveServiceOrderSchema, i,
    ),
};
