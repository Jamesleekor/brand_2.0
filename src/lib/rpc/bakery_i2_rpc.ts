import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type BakeryStatus = 'OPEN' | 'CLOSED';

export interface BakeryAccess {
  classroom_id: number;
  student_id: number | null;
  is_teacher: boolean;
  is_operator: boolean;
  can_operate: boolean;
  primary_job_name: string | null;
  status: BakeryStatus;
  open_session_id: number | null;
  opened_at: string | null;
  week_start: string;
}

export interface BakerySession {
  id: number;
  week_start: string;
  opened_at: string;
  opened_by_user_id: string;
  opened_by_student_id: number | null;
}

export interface BakerySummary {
  sold_today: number;
  used_today: number;
  pending_quantity: number;
  delivered_today: number;
}

export interface BakeryPendingFulfillment {
  id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  display_name: string;
  item_id: number;
  item_name: string;
  image_url: string | null;
  quantity: number;
  status: 'PENDING';
  created_at: string;
  wait_seconds: number;
}

export interface BakeryDeliveredFulfillment {
  id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  display_name: string;
  item_id: number;
  item_name: string;
  image_url: string | null;
  quantity: number;
  status: 'DELIVERED';
  created_at: string;
  delivered_at: string;
  note: string | null;
}

export interface BakeryItemBoardRow {
  item_id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price_gold: number;
  current_price_gold: number;
  base_stock: number;
  current_stock: number;
  is_active: boolean;
  is_archived: boolean;
  sold_today: number;
  used_today: number;
  pending_quantity: number;
  delivered_today: number;
  holder_count: number;
  owned_total: number;
  week_snapshot_price_gold: number | null;
  week_snapshot_stock: number | null;
  previous_week_price_gold: number | null;
  previous_week_stock: number | null;
  week_over_week_delta_gold: number | null;
  week_over_week_pct: number | null;
}

export interface BakeryHoldingRow {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  display_name: string;
  item_id: number;
  item_name: string;
  owned_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

export interface BakeryDashboard {
  classroom_id: number;
  server_now: string;
  seoul_today: string;
  week_start: string;
  status: BakeryStatus;
  session: BakerySession | null;
  summary: BakerySummary;
  pending: BakeryPendingFulfillment[];
  recent_delivered: BakeryDeliveredFulfillment[];
  items: BakeryItemBoardRow[];
  holdings: BakeryHoldingRow[];
}

export interface BakeryOpenResult {
  success: true;
  status: 'OPEN';
  session_id: number;
  week_start: string;
  already_open: boolean;
  snapshot_count: number;
}

export interface BakeryCloseResult {
  success: true;
  status: 'CLOSED';
  session_id?: number;
  already_closed: boolean;
}

export interface BakeryDeliverResult {
  success: true;
  fulfillment_id: number;
  status: 'DELIVERED';
  already_delivered: boolean;
  delivered_at: string;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const bakeryI2Rpc = {
  getAccess: (supabase: SupabaseClient) =>
    callRpc<BakeryAccess>(supabase, 'get_my_bakery_access'),

  getDashboard: (supabase: SupabaseClient) =>
    callRpc<BakeryDashboard>(supabase, 'get_bakery_dashboard'),

  open: (supabase: SupabaseClient, note?: string | null) =>
    callRpc<BakeryOpenResult>(supabase, 'bakery_open', { p_note: note?.trim() || null }),

  close: (supabase: SupabaseClient, note?: string | null) =>
    callRpc<BakeryCloseResult>(supabase, 'bakery_close', { p_note: note?.trim() || null }),

  deliver: (supabase: SupabaseClient, fulfillmentId: number, note?: string | null) =>
    callRpc<BakeryDeliverResult>(supabase, 'bakery_deliver_fulfillment', {
      p_fulfillment_id: fulfillmentId,
      p_note: note?.trim() || null,
    }),
};
