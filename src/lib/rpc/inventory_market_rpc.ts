import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';
import {
  InventoryQuantityActionSchema,
  TeacherMarketAdjustStockSchema,
  TeacherMarketArchiveSchema,
  TeacherMarketSaveItemSchema,
  type InventoryQuantityActionInput,
  type MarketItemType,
  type MarketPricingMode,
  type MarketUseMode,
  type TeacherMarketAdjustStockInput,
  type TeacherMarketArchiveInput,
  type TeacherMarketSaveItemInput,
} from '@/lib/zod_schemas/inventory_market_schemas';

type RpcValidationDetails = Extract<RpcResult<never>, { success: false; type: 'VALIDATION' }>['details'];

export interface StudentMarketItem {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  item_type: MarketItemType;
  use_mode: MarketUseMode;
  pricing_mode: MarketPricingMode;
  base_price_gold: number;
  stock_price_gold: number;
  effective_price_gold: number;
  base_stock: number;
  current_stock: number;
  weekly_purchase_limit: number | null;
  weekly_purchased_quantity: number;
  max_price_multiplier: number;
  curve_exponent: number;
  is_sellable: boolean;
  is_usable: boolean;
  highest_price_gold: number;
  latest_weekly_snapshot_price_gold: number | null;
}

export interface StudentMarketStore {
  student_id: number;
  classroom_id: number;
  gold: number;
  asset_freeze_active: boolean;
  items: StudentMarketItem[];
}

export interface StudentInventoryItem {
  item_id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  item_type: MarketItemType;
  use_mode: MarketUseMode;
  is_sellable: boolean;
  is_usable: boolean;
  is_active: boolean;
  is_archived: boolean;
  owned_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  sellable_quantity: number;
  full_sellback_value_gold: number;
}

export interface StudentInventoryBoard {
  student_id: number;
  classroom_id: number;
  items: StudentInventoryItem[];
}

export interface MarketPurchaseResult {
  success: true;
  transaction_id: number;
  purchase_lot_id: number;
  item_id: number;
  quantity: number;
  unit_price_gold: number;
  total_price_gold: number;
  inventory_owned_quantity: number;
  stock_after: number;
  market_quote_after_gold: number;
}

export interface MarketSellResult {
  success: true;
  transaction_id: number;
  item_id: number;
  quantity: number;
  refund_gold: number;
  gross_sellback_gold: number;
  base_fee_rate: number;
  buff_reduction_pp: number;
  effective_fee_rate: number;
  fee_gold: number;
  net_sellback_gold: number;
  fee_welfare_movement_id: number | null;
  market_quote_after_gold: number;
}

export interface InventoryUseResult {
  success: true;
  inventory_event_id: number;
  fulfillment_id: number | null;
  fulfillment_status: 'PENDING' | null;
  item_id: number;
  quantity: number;
}

export interface TeacherMarketItem {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  item_type: MarketItemType;
  use_mode: MarketUseMode;
  pricing_mode: MarketPricingMode;
  base_price_gold: number;
  current_market_price_gold: number;
  base_stock: number;
  current_stock: number;
  weekly_purchase_limit: number | null;
  max_price_multiplier: number;
  curve_exponent: number;
  is_sellable: boolean;
  is_usable: boolean;
  is_active: boolean;
  is_archived: boolean;
  legacy_snack_id: number | null;
  highest_price_gold: number;
  inventory_holder_count: number;
  inventory_owned_total: number;
}

export interface TeacherMarketBoard {
  classroom_id: number;
  items: TeacherMarketItem[];
}

export interface TeacherInventoryGrantResult {
  success: true;
  lot_id: number;
  owned_quantity: number;
}

export interface TeacherInventoryGrantInput {
  p_classroom_id: number;
  p_student_id: number;
  p_item_id: number;
  p_quantity: number;
  p_note?: string | null;
}

export type EconomyHistoryKind = 'ALL' | 'ASSET' | 'PURCHASE' | 'SALE' | 'USE' | 'INVENTORY';
export type ItemHistoryFilter = 'ALL' | 'PURCHASE' | 'SALE' | 'USE';

export interface EconomyHistoryStudent {
  id: number;
  name: string;
  brand_name: string | null;
}

export interface TeacherEconomyHistoryRow {
  event_key: string;
  occurred_at: string;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  kind: Exclude<EconomyHistoryKind, 'ALL'>;
  raw_event_type: string;
  value_token: 'GOLD' | 'BV' | 'CRYSTAL' | null;
  asset_delta: number;
  balance_after: number | null;
  tax_amount: number;
  source_type: string;
  memo: string | null;
  is_reversed: boolean;
  transaction_id: number | null;
  inventory_event_id: number | null;
  item_id: number | null;
  item_name: string | null;
  quantity: number;
  quantity_delta: number;
  metadata: Record<string, unknown> | null;
}

export interface TeacherEconomyHistoryBoard {
  classroom_id: number;
  rows: TeacherEconomyHistoryRow[];
  total_count: number;
  limit: number;
  offset: number;
  students: EconomyHistoryStudent[];
}

export interface TeacherHistoryVisibilityRow {
  event_key: string;
  hidden: boolean;
  reason: string;
  changed_at: string;
}

export interface TeacherHistoryVisibilityBoard {
  classroom_id: number;
  rows: TeacherHistoryVisibilityRow[];
}

export interface TeacherHistoryVisibilityMutationResult {
  classroom_id: number;
  updated_count: number;
  hidden: boolean;
  reason: string;
}

export interface StudentItemHistoryRow {
  inventory_event_id: number;
  created_at: string;
  event_type: 'PURCHASE' | 'SALE' | 'USE';
  raw_event_type: string;
  item_id: number;
  item_name: string;
  item_description: string | null;
  image_url: string | null;
  item_type: MarketItemType;
  use_mode: MarketUseMode;
  quantity: number;
  quantity_delta: number;
  gold_delta: number;
  total_gold: number | null;
  transaction_id: number | null;
  metadata: Record<string, unknown> | null;
  fulfillment_status: 'PENDING' | 'DELIVERED' | 'CANCELLED' | null;
  delivered_at: string | null;
}

export interface StudentItemHistoryBoard {
  student_id: number;
  classroom_id: number;
  rows: StudentItemHistoryRow[];
  total_count: number;
  limit: number;
  offset: number;
}

function validationError<T>(message: string, details: RpcValidationDetails = []): RpcResult<T> {
  return { success: false, type: 'VALIDATION', error: message, details };
}

async function callRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

function quantityCall<T>(supabase: SupabaseClient, fn: string, input: InventoryQuantityActionInput) {
  const parsed = InventoryQuantityActionSchema.safeParse(input);
  if (!parsed.success) {
    return Promise.resolve(validationError<T>(parsed.error.issues[0]?.message ?? '수량을 확인해주세요.', parsed.error.issues));
  }
  return callRpc<T>(supabase, fn, parsed.data);
}

export const inventoryMarketRpc = {
  myStore: (supabase: SupabaseClient) => callRpc<StudentMarketStore>(supabase, 'get_my_market_store'),
  myInventory: (supabase: SupabaseClient) => callRpc<StudentInventoryBoard>(supabase, 'get_my_inventory'),
  myItemHistory: (supabase: SupabaseClient, input: { p_limit?: number; p_offset?: number; p_event_type?: ItemHistoryFilter } = {}) =>
    callRpc<StudentItemHistoryBoard>(supabase, 'get_my_item_history', input),
  purchase: (supabase: SupabaseClient, input: InventoryQuantityActionInput) =>
    quantityCall<MarketPurchaseResult>(supabase, 'purchase_market_item', input),
  sell: (supabase: SupabaseClient, input: InventoryQuantityActionInput) =>
    quantityCall<MarketSellResult>(supabase, 'sell_inventory_item', input),
  use: (supabase: SupabaseClient, input: InventoryQuantityActionInput) =>
    quantityCall<InventoryUseResult>(supabase, 'use_inventory_item', input),

  teacherBoard: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<TeacherMarketBoard>(supabase, 'teacher_get_market_admin_board', { p_classroom_id: classroomId }),

  teacherGrantItem: (supabase: SupabaseClient, input: TeacherInventoryGrantInput) => {
    if (!Number.isInteger(input.p_classroom_id) || input.p_classroom_id <= 0) {
      return Promise.resolve(validationError<TeacherInventoryGrantResult>('학급 정보를 확인해주세요.'));
    }
    if (!Number.isInteger(input.p_student_id) || input.p_student_id <= 0) {
      return Promise.resolve(validationError<TeacherInventoryGrantResult>('학생을 선택해주세요.'));
    }
    if (!Number.isInteger(input.p_item_id) || input.p_item_id <= 0) {
      return Promise.resolve(validationError<TeacherInventoryGrantResult>('상품 정보를 확인해주세요.'));
    }
    if (!Number.isInteger(input.p_quantity) || input.p_quantity < 1 || input.p_quantity > 1000) {
      return Promise.resolve(validationError<TeacherInventoryGrantResult>('지급 수량은 1~1000개여야 합니다.'));
    }
    if ((input.p_note ?? '').trim().length > 500) {
      return Promise.resolve(validationError<TeacherInventoryGrantResult>('지급 메모는 500자 이하로 입력해주세요.'));
    }
    return callRpc<TeacherInventoryGrantResult>(supabase, 'teacher_grant_inventory_item', {
      ...input,
      p_note: input.p_note?.trim() || null,
    });
  },

  teacherEconomyHistory: (supabase: SupabaseClient, input: {
    p_classroom_id: number;
    p_limit?: number;
    p_offset?: number;
    p_student_id?: number | null;
    p_kind?: EconomyHistoryKind;
    p_search?: string | null;
    p_date_from?: string | null;
    p_date_to?: string | null;
  }) => callRpc<TeacherEconomyHistoryBoard>(supabase, 'teacher_get_economy_history', input),

  teacherHistoryVisibility: (supabase: SupabaseClient, input: {
    p_classroom_id: number;
    p_event_keys: string[];
  }) => callRpc<TeacherHistoryVisibilityBoard>(supabase, 'teacher_get_history_visibility', input),

  teacherSetHistoryVisibility: (supabase: SupabaseClient, input: {
    p_classroom_id: number;
    p_event_keys: string[];
    p_hidden: boolean;
    p_reason?: string | null;
  }) => {
    if (!Number.isInteger(input.p_classroom_id) || input.p_classroom_id <= 0) {
      return Promise.resolve(validationError<TeacherHistoryVisibilityMutationResult>('학급 정보를 확인해주세요.'));
    }
    const keys = Array.from(new Set(input.p_event_keys.map((key) => key.trim()).filter(Boolean)));
    if (keys.length < 1 || keys.length > 500 || keys.some((key) => key.length > 240)) {
      return Promise.resolve(validationError<TeacherHistoryVisibilityMutationResult>('히스토리 선택 항목을 확인해주세요.'));
    }
    if ((input.p_reason ?? '').trim().length > 200) {
      return Promise.resolve(validationError<TeacherHistoryVisibilityMutationResult>('숨김 사유는 200자 이하로 입력해주세요.'));
    }
    return callRpc<TeacherHistoryVisibilityMutationResult>(supabase, 'teacher_set_history_visibility', {
      p_classroom_id: input.p_classroom_id,
      p_event_keys: keys,
      p_hidden: input.p_hidden,
      p_reason: input.p_reason?.trim() || null,
    });
  },

  teacherSaveItem: (supabase: SupabaseClient, input: TeacherMarketSaveItemInput) => {
    const parsed = TeacherMarketSaveItemSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(validationError<number>(parsed.error.issues[0]?.message ?? '상품 설정을 확인해주세요.', parsed.error.issues));
    }
    return callRpc<number>(supabase, 'teacher_save_market_item', parsed.data);
  },

  teacherAdjustStock: (supabase: SupabaseClient, input: TeacherMarketAdjustStockInput) => {
    const parsed = TeacherMarketAdjustStockSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(validationError<number>(parsed.error.issues[0]?.message ?? '재고 조정 값을 확인해주세요.', parsed.error.issues));
    }
    return callRpc<number>(supabase, 'teacher_adjust_market_item_stock', parsed.data);
  },

  teacherArchiveItem: (supabase: SupabaseClient, input: TeacherMarketArchiveInput) => {
    const parsed = TeacherMarketArchiveSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(validationError<void>(parsed.error.issues[0]?.message ?? '상품 정보를 확인해주세요.', parsed.error.issues));
    }
    return callRpc<void>(supabase, 'teacher_archive_market_item', parsed.data);
  },
};
