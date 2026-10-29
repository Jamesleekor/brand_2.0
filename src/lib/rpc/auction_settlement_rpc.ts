// =====================================================================
// B.R.A.N.D 2.0 — 경매 낙찰품 정리(Auction Settlement) RPC 래퍼
// 2026-10-30
// ---------------------------------------------------------------------
// 서버 함수(supabase/migrations/20261030_01_auction_settlement_v1.sql)를
// 부르는 얇은 연결선. 계산·추첨·돈 이동은 모두 서버에서 한다.
// 모든 함수는 "정리 화면 전체 상태"를 돌려준다 → 화면은 그대로 갈아끼우면 된다.
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type SettlementCategory = '자리' | '1인1역' | '급식순서';

export type SettlementDisposition =
  | 'HOLD'             // 보유 중 (원래 낙찰 또는 무료 양도로 받음)
  | 'FORCED_PENDING'   // 강제 분배 대기
  | 'UNSOLD_PENDING'   // 유찰품 분배 대기
  | 'FORCED_ASSIGNED'  // 강제 분배로 새 주인 결정
  | 'UNSOLD_ASSIGNED'  // 유찰품 랜덤 분배 완료
  | 'UNASSIGNED';      // 받을 학생이 남지 않아 주인 없음

export interface SettlementItem {
  id: number;
  auction_item_id: number;
  category: SettlementCategory;
  item_name: string;
  emoji: string | null;
  display_order: number;
  origin: 'SOLD' | 'UNSOLD';
  base_price: number;
  price_source: 'FINAL_PRICE' | 'PREVIOUS_SALE' | 'STARTING_PRICE';
  original_winner_student_id: number | null;
  holder_student_id: number | null;
  disposition: SettlementDisposition;
  transfer_count: number;
  forced_by_student_id: number | null;
  charge_amount: number;
  charge_collected: number;
  charge_outstanding: number;
  fee_student_id: number | null;
  fee_amount: number;
  assigned_at: string | null;
}

export interface SettlementStudent {
  id: number;
  name: string;
  brand_name: string | null;
  in_roster: boolean;
}

export interface SettlementCategoryState {
  category: SettlementCategory;
  status: 'OPEN' | 'FINALIZED';
  finalized_at: string | null;
}

export interface SettlementEvent {
  id: number;
  settlement_item_id: number | null;
  category: SettlementCategory;
  event_type: string;
  from_student_id: number | null;
  to_student_id: number | null;
  payload: Record<string, unknown>;
  undone_at: string | null;
  created_at: string;
}

export interface SettlementState {
  auction: {
    id: number;
    round_number: number;
    school_year: number;
    scheduled_date: string | null;
    ended_at: string | null;
  };
  categories: SettlementCategoryState[];
  items: SettlementItem[];
  students: SettlementStudent[];
  events: SettlementEvent[];
  draw_results?: unknown[];
  finalized_category?: SettlementCategory;
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { success: false, type: 'SERVER', error: error.message, code: error.code };
  }
  return { success: true, data: data as T };
}

export const auctionSettlementRpc = {
  /** 정리 화면 상태 (처음 열면 서버가 장부를 자동으로 만든다. 돈은 움직이지 않음) */
  state: (supabase: SupabaseClient, auctionId: number) =>
    callRpc<SettlementState>(supabase, 'teacher_auction_settlement_state', { p_auction_id: auctionId }),

  /** 무료 양도 */
  transfer: (supabase: SupabaseClient, settlementItemId: number, toStudentId: number) =>
    callRpc<SettlementState>(supabase, 'teacher_auction_settlement_transfer', {
      p_settlement_item_id: settlementItemId,
      p_to_student_id: toStudentId,
    }),

  /** 강제 분배로 보내기 */
  markForced: (supabase: SupabaseClient, settlementItemId: number) =>
    callRpc<SettlementState>(supabase, 'teacher_auction_settlement_mark_forced', {
      p_settlement_item_id: settlementItemId,
    }),

  /** 되돌리기 (강제 분배 지정 취소 / 마지막 무료 양도 취소) */
  undo: (supabase: SupabaseClient, settlementItemId: number) =>
    callRpc<SettlementState>(supabase, 'teacher_auction_settlement_undo', {
      p_settlement_item_id: settlementItemId,
    }),

  /** 카테고리 최종 확정: 랜덤 추첨 + 대금 징수(부족분 미납) + 수수료 50% 지급 */
  finalize: (supabase: SupabaseClient, auctionId: number, category: SettlementCategory) =>
    callRpc<SettlementState>(supabase, 'teacher_auction_settlement_finalize', {
      p_auction_id: auctionId,
      p_category: category,
    }),
};
