// =====================================================================
// B.R.A.N.D 2.0 — Type-Safe RPC Wrappers
// Stage 5 Sub-step 5-C · 생성일 2026-05-20
// =====================================================================
// Zod 검증 + Supabase RPC 호출을 결합한 타입 안전 래퍼.
//
// 패턴:
//   1. 입력을 Zod로 검증
//   2. 검증 통과 시 supabase.rpc() 호출
//   3. 일관된 결과 타입 반환 (성공·검증실패·서버에러)
// =====================================================================

import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { validateInput } from "../zod_schemas/student_schemas";
import * as StudentSchemas from "../zod_schemas/student_schemas";
import * as TeacherSchemas from "../zod_schemas/teacher_schemas";

// =====================================================================
// 1. 통합 결과 타입
// =====================================================================

export type RpcResult<T> =
  | { success: true; data: T }
  | { success: false; type: "VALIDATION"; error: string; details: z.ZodIssue[] }
  | { success: false; type: "SERVER"; error: string; code?: string };

export interface TeacherAssetAdjustmentResult {
  student_id: number;
  transaction_id: number;
  new_balance: number;
}


export interface TeacherCombinedAssetGrantResult {
  student_id: number;
  bv_transaction_id: number | null;
  gold_transaction_id: number | null;
  new_bv: number;
  new_gold: number;
}

export interface WelfareDonationResult {
  transaction_id: number;
  movement_id: number;
  new_gold_balance: number;
  welfare_balance: number;
}

export interface LiveAuctionBidResult {
  bid_id: number;
  amount: number;
  server_now: string;
  ends_at: string;
  student_id: number;
}

export interface LiveAuctionFinalizeResult {
  status: string;
  item_id?: number;
  result_id?: number;
  winner_student_id?: number;
  final_price?: number;
  next_attempt?: number;
  next_price?: number;
  server_now?: string;
  ends_at?: string;
}

export interface TeacherEconomicReversalResult {
  event_type:
    "TEACHER_ADJUSTMENT" | "P2P_TRANSFER" | "TOKEN_EXCHANGE" | "DONATION";
  original_transaction_ids: number[];
  reversal_transaction_ids: number[];
}

/**
 * 타입 안전 RPC 호출 헬퍼 (모든 함수의 기반)
 */
async function safeRpc<TInput, TOutput>(
  supabase: SupabaseClient,
  functionName: string,
  schema: z.ZodType<TInput>,
  input: unknown,
): Promise<RpcResult<TOutput>> {
  // 1. Zod 검증
  const validation = validateInput(schema, input);

  if (validation.success === false) {
    return {
      success: false,
      type: "VALIDATION",
      error: validation.error,
      details: validation.details,
    };
  }

  // 2. Supabase RPC 호출
  const { data, error } = await supabase.rpc(
    functionName,
    validation.data as Record<string, unknown>,
  );

  if (error) {
    return {
      success: false,
      type: "SERVER",
      error: error.message,
      code: error.code,
    };
  }

  return { success: true, data: data as TOutput };
}

// =====================================================================
// 2. 학생 RPC 래퍼 (18개)
// =====================================================================

export const studentRpc = {
  /**
   * 화폐 교환 (골드 ↔ 크리스탈)
   */
  exchangeToken: (
    supabase: SupabaseClient,
    input: StudentSchemas.ExchangeTokenInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "exchange_token",
      StudentSchemas.ExchangeTokenSchema,
      input,
    );
  },

  /**
   * P2P 송금
   */
  transferP2P: (
    supabase: SupabaseClient,
    input: StudentSchemas.TransferP2PInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "transfer_p2p_with_log",
      StudentSchemas.TransferP2PSchema,
      input,
    );
  },

  /**
   * 복지기금 기부
   */
  donateToWelfare: (
    supabase: SupabaseClient,
    input: StudentSchemas.DonateToWelfareInput,
  ): Promise<RpcResult<WelfareDonationResult[]>> => {
    return safeRpc(
      supabase,
      "donate_to_welfare_fund",
      StudentSchemas.DonateToWelfareSchema,
      input,
    );
  },

  /**
   * 실시간 경매 입찰
   */
  placeLiveAuctionBid: (
    supabase: SupabaseClient,
    input: StudentSchemas.PlaceLiveAuctionBidInput,
  ): Promise<RpcResult<LiveAuctionBidResult>> => {
    return safeRpc(
      supabase,
      "place_live_auction_bid",
      StudentSchemas.PlaceLiveAuctionBidSchema,
      input,
    );
  },

  /**
   * 서버 시간이 끝난 상품의 멱등 정산
   */
  finalizeLiveAuctionItemIfExpired: (
    supabase: SupabaseClient,
    input: StudentSchemas.FinalizeLiveAuctionItemInput,
  ): Promise<RpcResult<LiveAuctionFinalizeResult>> => {
    return safeRpc(
      supabase,
      "finalize_live_auction_item_if_expired",
      StudentSchemas.FinalizeLiveAuctionItemSchema,
      input,
    );
  },

  /**
   * 간식 구매
   */
  purchaseSnack: (
    supabase: SupabaseClient,
    input: StudentSchemas.PurchaseSnackInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "purchase_snack",
      StudentSchemas.PurchaseSnackSchema,
      input,
    );
  },

  /**
   * 경매 입찰
   */
  recordAuctionBid: (
    supabase: SupabaseClient,
    input: StudentSchemas.RecordAuctionBidInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "record_auction_bid",
      StudentSchemas.RecordAuctionBidSchema,
      input,
    );
  },

  /**
   * 업적 신청 (자동 평가 포함)
   */
  submitAchievementApplication: (
    supabase: SupabaseClient,
    input: StudentSchemas.SubmitAchievementApplicationInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "submit_achievement_application",
      StudentSchemas.SubmitAchievementApplicationSchema,
      input,
    );
  },

  /**
   * 업적 장착
   */
  equipAchievement: (
    supabase: SupabaseClient,
    input: StudentSchemas.EquipAchievementInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "equip_achievement",
      StudentSchemas.EquipAchievementSchema,
      input,
    );
  },

  /**
   * 꾸미기 구매
   */
  purchaseCosmeticItem: (
    supabase: SupabaseClient,
    input: StudentSchemas.PurchaseCosmeticItemInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "purchase_cosmetic_item",
      StudentSchemas.PurchaseCosmeticItemSchema,
      input,
    );
  },

  /**
   * 꾸미기 장착
   */
  equipCosmeticItem: (
    supabase: SupabaseClient,
    input: StudentSchemas.EquipCosmeticItemInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "equip_cosmetic_item",
      StudentSchemas.EquipCosmeticItemSchema,
      input,
    );
  },

  /**
   * 2차직업 신청
   */
  applySecondaryJob: (
    supabase: SupabaseClient,
    input: StudentSchemas.ApplySecondaryJobInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "apply_secondary_job",
      StudentSchemas.ApplySecondaryJobSchema,
      input,
    );
  },

  /**
   * 예금 가입
   */
  subscribeToDeposit: (
    supabase: SupabaseClient,
    input: StudentSchemas.SubscribeToDepositInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "subscribe_to_deposit",
      StudentSchemas.SubscribeToDepositSchema,
      input,
    );
  },

  /**
   * 예금 중도해지
   */
  earlyWithdrawDeposit: (
    supabase: SupabaseClient,
    input: StudentSchemas.EarlyWithdrawDepositInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "early_withdraw_deposit",
      StudentSchemas.EarlyWithdrawDepositSchema,
      input,
    );
  },

  /**
   * 일일퀘스트 완료
   */
  completeDailyQuest: (
    supabase: SupabaseClient,
    input: StudentSchemas.CompleteDailyQuestInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "complete_daily_quest",
      StudentSchemas.CompleteDailyQuestSchema,
      input,
    );
  },

  /**
   * 메일 읽음 처리
   */
  markMailRead: (
    supabase: SupabaseClient,
    input: StudentSchemas.MarkMailReadInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "mark_mail_read",
      StudentSchemas.MarkMailReadSchema,
      input,
    );
  },

  /**
   * 과제 제출
   */
  submitAssignment: (
    supabase: SupabaseClient,
    input: StudentSchemas.SubmitAssignmentInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "submit_assignment",
      StudentSchemas.SubmitAssignmentSchema,
      input,
    );
  },

  /**
   * 시장 매칭 완료
   */
  completeMarketRequest: (
    supabase: SupabaseClient,
    input: StudentSchemas.CompleteMarketRequestInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "complete_market_request",
      StudentSchemas.CompleteMarketRequestSchema,
      input,
    );
  },

  /**
   * 출석 자율 체크인
   */
  recordAttendance: (
    supabase: SupabaseClient,
    input: StudentSchemas.RecordAttendanceInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "record_attendance",
      StudentSchemas.RecordAttendanceSchema,
      input,
    );
  },
};

// =====================================================================
// 3. 교사 RPC 래퍼 (19개)
// =====================================================================

export const teacherRpc = {
  createLiveAuction: (supabase: SupabaseClient, input: TeacherSchemas.TeacherCreateLiveAuctionInput): Promise<RpcResult<number>> =>
    safeRpc(supabase, "teacher_create_live_auction", TeacherSchemas.TeacherCreateLiveAuctionSchema, input),


  createOrResetLiveAuction: (supabase: SupabaseClient, input: TeacherSchemas.TeacherCreateOrResetLiveAuctionInput): Promise<RpcResult<any>> =>
    safeRpc(supabase, "teacher_create_or_reset_live_auction", TeacherSchemas.TeacherCreateOrResetLiveAuctionSchema, input),

  getAuctionHistory: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionHistoryClassroomInput): Promise<RpcResult<any[]>> =>
    safeRpc(supabase, "teacher_get_auction_history", TeacherSchemas.TeacherAuctionHistoryClassroomSchema, input),

  getAuctionHistoryDetail: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionIdInput): Promise<RpcResult<any>> =>
    safeRpc(supabase, "teacher_get_auction_history_detail", TeacherSchemas.TeacherAuctionIdSchema, input),

  getAuctionItemPresets: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionHistoryClassroomInput): Promise<RpcResult<any[]>> =>
    safeRpc(supabase, "teacher_get_auction_item_presets", TeacherSchemas.TeacherAuctionHistoryClassroomSchema, input),

  saveAuctionItemPreset: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionPresetSaveInput): Promise<RpcResult<number>> =>
    safeRpc(supabase, "teacher_save_auction_item_preset", TeacherSchemas.TeacherAuctionPresetSaveSchema, input),

  deleteAuctionItemPreset: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionPresetIdInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_delete_auction_item_preset", TeacherSchemas.TeacherAuctionPresetIdSchema, input),

  bulkAddLiveAuctionItems: (supabase: SupabaseClient, input: TeacherSchemas.TeacherBulkAuctionItemsInput): Promise<RpcResult<{added:number; skipped:number}>> =>
    safeRpc(supabase, "teacher_bulk_add_live_auction_items", TeacherSchemas.TeacherBulkAuctionItemsSchema, input),

  addLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAddLiveAuctionItemInput): Promise<RpcResult<number>> =>
    safeRpc(supabase, "teacher_add_live_auction_item", TeacherSchemas.TeacherAddLiveAuctionItemSchema, input),

  updateLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherUpdateLiveAuctionItemInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_update_live_auction_item", TeacherSchemas.TeacherUpdateLiveAuctionItemSchema, input),

  deleteLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionItemIdInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_delete_live_auction_item", TeacherSchemas.TeacherAuctionItemIdSchema, input),

  moveLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherMoveLiveAuctionItemInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_move_live_auction_item", TeacherSchemas.TeacherMoveLiveAuctionItemSchema, input),

  startLiveAuction: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionIdInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_start_live_auction", TeacherSchemas.TeacherAuctionIdSchema, input),

  startLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionItemIdInput): Promise<RpcResult<{ item_id: number; server_now: string; ends_at: string }>> =>
    safeRpc(supabase, "teacher_start_live_auction_item", TeacherSchemas.TeacherAuctionItemIdSchema, input),

  pauseLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionItemIdInput): Promise<RpcResult<number>> =>
    safeRpc(supabase, "teacher_pause_live_auction_item", TeacherSchemas.TeacherAuctionItemIdSchema, input),

  resumeLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionItemIdInput): Promise<RpcResult<string>> =>
    safeRpc(supabase, "teacher_resume_live_auction_item", TeacherSchemas.TeacherAuctionItemIdSchema, input),

  closeLiveAuctionItemNow: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionItemIdInput): Promise<RpcResult<LiveAuctionFinalizeResult>> =>
    safeRpc(supabase, "teacher_close_live_auction_item_now", TeacherSchemas.TeacherAuctionItemIdSchema, input),

  failLiveAuctionItem: (supabase: SupabaseClient, input: TeacherSchemas.TeacherFailLiveAuctionItemInput): Promise<RpcResult<LiveAuctionFinalizeResult>> =>
    safeRpc(supabase, "teacher_fail_live_auction_item", TeacherSchemas.TeacherFailLiveAuctionItemSchema, input),

  completeLiveAuction: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionIdInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_complete_live_auction", TeacherSchemas.TeacherAuctionIdSchema, input),

  deleteScheduledAuction: (supabase: SupabaseClient, input: TeacherSchemas.TeacherAuctionIdInput): Promise<RpcResult<void>> =>
    safeRpc(supabase, "teacher_delete_scheduled_auction", TeacherSchemas.TeacherAuctionIdSchema, input),

  /**
   * 교사 BV/GOLD 단일·다중 지급·차감
   * - 외부 공개 RPC에서 교사 권한·동일 학급 검증
   * - 내부 create_transaction 호출로 거래 기록과 지갑을 원자적으로 갱신
   */
  adjustStudentAssets: (
    supabase: SupabaseClient,
    input: TeacherSchemas.TeacherAdjustStudentAssetsInput,
  ): Promise<RpcResult<TeacherAssetAdjustmentResult[]>> => {
    return safeRpc(
      supabase,
      "teacher_adjust_student_assets",
      TeacherSchemas.TeacherAdjustStudentAssetsSchema,
      input,
    );
  },


  /**
   * 교사 BV + GOLD 동시 지급
   * - 한 DB 함수 안에서 두 자산을 처리해 선택 학생 전체에 대해 원자성을 보장
   */
  grantStudentAssetsCombined: (
    supabase: SupabaseClient,
    input: TeacherSchemas.TeacherGrantStudentAssetsCombinedInput,
  ): Promise<RpcResult<TeacherCombinedAssetGrantResult[]>> => {
    return safeRpc(
      supabase,
      "teacher_grant_student_assets_combined",
      TeacherSchemas.TeacherGrantStudentAssetsCombinedSchema,
      input,
    );
  },

  /**
   * 경매 낙찰 (Master Lee 페인 ② — 단일 트랜잭션)
   */
  confirmAuctionSale: (
    supabase: SupabaseClient,
    input: TeacherSchemas.ConfirmAuctionSaleInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "confirm_auction_sale",
      TeacherSchemas.ConfirmAuctionSaleSchema,
      input,
    );
  },

  /**
   * 경매 유찰
   */
  reportAuctionFailure: (
    supabase: SupabaseClient,
    input: TeacherSchemas.ReportAuctionFailureInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "report_auction_failure",
      TeacherSchemas.ReportAuctionFailureSchema,
      input,
    );
  },

  /**
   * 업적 직접 부여
   */
  grantAchievement: (
    supabase: SupabaseClient,
    input: TeacherSchemas.GrantAchievementInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "grant_achievement",
      TeacherSchemas.GrantAchievementSchema,
      input,
    );
  },

  /**
   * 업적 수동 검토 (안전장치 ③)
   */
  manualReviewAchievement: (
    supabase: SupabaseClient,
    input: TeacherSchemas.ManualReviewAchievementInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "manual_review_achievement",
      TeacherSchemas.ManualReviewAchievementSchema,
      input,
    );
  },

  /**
   * 업적 회수
   */
  revokeAchievementGrant: (
    supabase: SupabaseClient,
    input: TeacherSchemas.RevokeAchievementGrantInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "revoke_achievement_grant",
      TeacherSchemas.RevokeAchievementGrantSchema,
      input,
    );
  },

  /**
   * 길드 미션 평가
   */
  evaluateGuildMissionLog: (
    supabase: SupabaseClient,
    input: TeacherSchemas.EvaluateGuildMissionLogInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "evaluate_guild_mission_log",
      TeacherSchemas.EvaluateGuildMissionLogSchema,
      input,
    );
  },

  /**
   * 2차직업 승인/반려
   */
  approveSecondaryJob: (
    supabase: SupabaseClient,
    input: TeacherSchemas.ApproveSecondaryJobInput,
  ): Promise<RpcResult<number | null>> => {
    return safeRpc(
      supabase,
      "approve_secondary_job",
      TeacherSchemas.ApproveSecondaryJobSchema,
      input,
    );
  },

  /**
   * 과제 평가 (만점 시 BV 보너스)
   */
  gradeAssignment: (
    supabase: SupabaseClient,
    input: TeacherSchemas.GradeAssignmentInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "grade_assignment",
      TeacherSchemas.GradeAssignmentSchema,
      input,
    );
  },

  /**
   * 비상사태 발동
   */
  activateEmergency: (
    supabase: SupabaseClient,
    input: TeacherSchemas.ActivateEmergencyInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "activate_emergency",
      TeacherSchemas.ActivateEmergencySchema,
      input,
    );
  },

  /**
   * 비상사태 종료
   */
  terminateEmergency: (
    supabase: SupabaseClient,
    input: TeacherSchemas.TerminateEmergencyInput,
  ): Promise<RpcResult<void>> => {
    return safeRpc(
      supabase,
      "terminate_emergency",
      TeacherSchemas.TerminateEmergencySchema,
      input,
    );
  },

  /**
   * 전역 알림 발송
   */
  broadcastGlobalAlert: (
    supabase: SupabaseClient,
    input: TeacherSchemas.BroadcastGlobalAlertInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "broadcast_global_alert",
      TeacherSchemas.BroadcastGlobalAlertSchema,
      input,
    );
  },

  /**
   * 꾸미기 직접 지급
   */
  grantCosmeticItem: (
    supabase: SupabaseClient,
    input: TeacherSchemas.GrantCosmeticItemInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "grant_cosmetic_item",
      TeacherSchemas.GrantCosmeticItemSchema,
      input,
    );
  },

  /**
   * Wallet 무결성 점검
   */
  verifyWalletIntegrity: (
    supabase: SupabaseClient,
    input: TeacherSchemas.VerifyWalletIntegrityInput,
  ): Promise<
    RpcResult<
      Array<{
        student_id: number;
        value_token: string;
        expected: number;
        actual: number;
        mismatch: number;
      }>
    >
  > => {
    return safeRpc(
      supabase,
      "verify_wallet_integrity",
      TeacherSchemas.VerifyWalletIntegritySchema,
      input,
    );
  },

  /**
   * 교사 경제 사건 취소·정정
   * - 교사 지급/차감, P2P 양쪽, 화폐 교환 양쪽, 기부 원장을 안전하게 되돌린다.
   */
  reverseEconomicEvent: (
    supabase: SupabaseClient,
    input: TeacherSchemas.TeacherReverseEconomicEventInput,
  ): Promise<RpcResult<TeacherEconomicReversalResult[]>> => {
    return safeRpc(
      supabase,
      "teacher_reverse_economic_event",
      TeacherSchemas.TeacherReverseEconomicEventSchema,
      input,
    );
  },

  /**
   * 복지기금 분배
   */
  distributeWelfare: (
    supabase: SupabaseClient,
    input: TeacherSchemas.DistributeWelfareInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "distribute_welfare",
      TeacherSchemas.DistributeWelfareSchema,
      input,
    );
  },

  /**
   * 만기 예금 일괄 처리 (수동)
   */
  processMaturedDeposits: (
    supabase: SupabaseClient,
    input: TeacherSchemas.ProcessMaturedDepositsInput,
  ): Promise<RpcResult<number>> => {
    return safeRpc(
      supabase,
      "process_matured_deposits",
      TeacherSchemas.ProcessMaturedDepositsSchema,
      input,
    );
  },
};

// =====================================================================
// 사용 예시 — 학생 UI 통합
// =====================================================================
//
// ```typescript
// import { studentRpc } from '@/lib/rpc';
// import { getUserFriendlyError } from '@/lib/errors';
//
// const handlePurchase = async (snackId: number) => {
//   const result = await studentRpc.purchaseSnack(supabase, {
//     p_student_id: currentStudent.id,
//     p_snack_id: snackId,
//     p_quantity: 1
//   });
//
//   if (!result.success) {
//     if (result.type === 'VALIDATION') {
//       // 클라이언트 검증 실패
//       showToast({ title: '입력 오류', description: result.error });
//     } else {
//       // 서버 에러 (잔액 부족 등)
//       const userMsg = getUserFriendlyError({ code: result.code, message: result.error });
//       showToast({ title: userMsg.title, description: userMsg.description });
//     }
//     return;
//   }
//
//   // 성공
//   showToast({ title: '간식을 구매했어요!', color: 'green' });
// };
// ```
//
// 사용 예시 — 교사 UI 통합
//
// ```typescript
// import { teacherRpc } from '@/lib/rpc';
//
// const handleApprove = async (applicationId: number) => {
//   const result = await teacherRpc.manualReviewAchievement(supabase, {
//     p_application_id: applicationId,
//     p_approve: true,
//     p_teacher_user_id: currentTeacher.userId
//   });
//
//   if (!result.success) {
//     // 에러 처리
//     return;
//   }
//
//   showToast({ title: '✅ 업적 승인됨', color: 'green' });
// };
// ```
