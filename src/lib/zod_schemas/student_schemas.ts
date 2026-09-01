// =====================================================================
// B.R.A.N.D 2.0 — Zod Schemas: Student RPC Functions
// Stage 5 Sub-step 5-C · 생성일 2026-05-20
// =====================================================================
// 학생이 직접 호출하는 RPC의 Zod 검증 스키마.
//
// 사용 패턴:
//   1. UI에서 사용자 입력 → Zod 검증
//   2. 검증 통과 시 supabase.rpc() 호출
//   3. 검증 실패 시 사용자 친화 에러 메시지
//
// Zod의 이점:
//   - 런타임 안전성 (잘못된 타입·범위 차단)
//   - 한국어 에러 메시지 커스터마이즈
//   - TypeScript 타입 자동 추론
// =====================================================================

import { z } from "zod";
import {
  VALUE_TOKEN_TYPES,
  ACHIEVEMENT_GRADES,
  ATTENDANCE_STATUS,
} from "../types/database_types";

// =====================================================================
// 0. 공통 검증 빌딩 블록
// =====================================================================

/**
 * 양의 정수 (학생 ID, 학급 ID 등)
 */
const PositiveInt = z
  .number()
  .int("정수여야 합니다")
  .positive("양수여야 합니다");

/**
 * 양의 BigInt 호환 정수 (금액)
 */
const PositiveAmount = z
  .number()
  .int("금액은 정수여야 합니다")
  .positive("금액은 0보다 커야 합니다")
  .max(1_000_000, "금액이 너무 큽니다 (최대 100만)");

/**
 * 비음수 정수 (수량 등)
 */
const NonNegativeInt = z
  .number()
  .int("정수여야 합니다")
  .nonnegative("0 이상이어야 합니다");

/**
 * 짧은 한국어 문자열 (이름·태그)
 */
const ShortKoreanString = z
  .string()
  .min(1, "비어있을 수 없습니다")
  .max(50, "50자 이하여야 합니다")
  .trim();

/**
 * 메모 (긴 텍스트)
 */
const MemoString = z
  .string()
  .max(500, "메모는 500자 이하여야 합니다")
  .trim()
  .optional();

const EconomicMemoString = z
  .string()
  .max(200, "메모는 200자 이하여야 합니다")
  .trim()
  .optional();

// =====================================================================
// 1. exchange_token — 화폐 교환
// =====================================================================

export const ExchangeTokenSchema = z.object({
  p_student_id: PositiveInt,
  p_from_token: z.enum(VALUE_TOKEN_TYPES).refine((v) => v !== "BV", {
    message: "BV는 교환할 수 없습니다 (명예 점수)",
  }),
  p_from_amount: PositiveAmount,
});

export type ExchangeTokenInput = z.infer<typeof ExchangeTokenSchema>;

// =====================================================================
// 2. transfer_p2p_with_log — P2P 송금
// =====================================================================

export const TransferP2PSchema = z
  .object({
    p_sender_id: PositiveInt,
    p_receiver_id: PositiveInt,
    p_amount: PositiveAmount,
    p_tag: z.string().trim().max(50, "태그는 50자 이하").optional(),
    p_description: EconomicMemoString,
    p_quantity: z
      .number()
      .int("수량은 정수여야 합니다")
      .positive("수량은 양수여야 합니다")
      .optional()
      .default(1),
    p_rating: z.number().int().min(1).max(10).optional(),
  })
  .refine((data) => data.p_sender_id !== data.p_receiver_id, {
    message: "자기 자신에게 송금할 수 없습니다",
    path: ["p_receiver_id"],
  });

export type TransferP2PInput = z.infer<typeof TransferP2PSchema>;

// =====================================================================
// 2-1. donate_to_welfare_fund — 복지기금 기부
// =====================================================================

export const DonateToWelfareSchema = z.object({
  p_student_id: PositiveInt,
  p_amount: PositiveAmount,
  p_message: EconomicMemoString,
});

export type DonateToWelfareInput = z.infer<typeof DonateToWelfareSchema>;

// =====================================================================
// 3. purchase_snack — 간식 구매
// =====================================================================

export const PurchaseSnackSchema = z.object({
  p_student_id: PositiveInt,
  p_snack_id: PositiveInt,
  p_quantity: z
    .number()
    .int()
    .positive()
    .max(10, "한 번에 최대 10개까지")
    .default(1),
});

export type PurchaseSnackInput = z.infer<typeof PurchaseSnackSchema>;

// =====================================================================
// 4. record_auction_bid — 경매 입찰
// =====================================================================

export const RecordAuctionBidSchema = z.object({
  p_auction_item_id: PositiveInt,
  p_student_id: PositiveInt,
  p_bid_price: PositiveAmount,
  p_attempt_number: z.number().int().min(1).max(3, "경매는 1~3차까지"),
});

export type RecordAuctionBidInput = z.infer<typeof RecordAuctionBidSchema>;

// =====================================================================
// 5. submit_achievement_application — 업적 신청
// =====================================================================

export const SubmitAchievementApplicationSchema = z.object({
  p_student_id: PositiveInt,
  p_achievement_id: PositiveInt,
  p_evidence_text: z
    .string()
    .trim()
    .min(2, "달성 증빙·설명을 2자 이상 입력해주세요")
    .max(1000, "근거 설명은 1000자 이하"),
});

export type SubmitAchievementApplicationInput = z.infer<
  typeof SubmitAchievementApplicationSchema
>;

// =====================================================================
// 6. equip_achievement — 업적 장착
// =====================================================================

export const EquipAchievementSchema = z.object({
  p_student_id: PositiveInt,
  p_student_achievement_id: PositiveInt.nullable(), // NULL이면 해제
});

export type EquipAchievementInput = z.infer<typeof EquipAchievementSchema>;

// =====================================================================
// 7. purchase_cosmetic_item — 꾸미기 구매
// =====================================================================

export const PurchaseCosmeticItemSchema = z.object({
  p_student_id: PositiveInt,
  p_item_id: PositiveInt,
  p_pricing_id: PositiveInt,
});

export type PurchaseCosmeticItemInput = z.infer<
  typeof PurchaseCosmeticItemSchema
>;

// =====================================================================
// 8. equip_cosmetic_item — 꾸미기 장착
// =====================================================================

export const EquipCosmeticItemSchema = z.object({
  p_student_id: PositiveInt,
  p_ownership_id: z.number().int().positive().nullable(),
});

export type EquipCosmeticItemInput = z.infer<typeof EquipCosmeticItemSchema>;

// =====================================================================
// 9. apply_secondary_job — 2차직업 신청
// =====================================================================

export const ApplySecondaryJobSchema = z.object({
  p_student_id: PositiveInt,
  p_job_name: ShortKoreanString,
  p_description: z
    .string()
    .min(10, "설명은 최소 10자 이상")
    .max(500, "설명은 500자 이하")
    .trim(),
});

export type ApplySecondaryJobInput = z.infer<typeof ApplySecondaryJobSchema>;

// =====================================================================
// 10. subscribe_to_deposit — 예금 가입
// =====================================================================

export const SubscribeToDepositSchema = z.object({
  p_student_id: PositiveInt,
  p_product_id: PositiveInt,
  p_principal: PositiveAmount,
  p_weeks: z.number().int().min(1).max(52, "예금 기간은 1~52주"),
});

export type SubscribeToDepositInput = z.infer<typeof SubscribeToDepositSchema>;

// =====================================================================
// 11. early_withdraw_deposit — 예금 중도해지
// =====================================================================

export const EarlyWithdrawDepositSchema = z.object({
  p_deposit_id: PositiveInt,
});

export type EarlyWithdrawDepositInput = z.infer<
  typeof EarlyWithdrawDepositSchema
>;

// =====================================================================
// 12. legacy Daily Quest self-completion removed by S3
// =====================================================================
// Daily Quest completion is now manager-check + teacher-settlement only.

// =====================================================================
// 13. mark_mail_read — 메일 읽음
// =====================================================================

export const MarkMailReadSchema = z.object({
  p_message_id: PositiveInt,
});

export type MarkMailReadInput = z.infer<typeof MarkMailReadSchema>;

// =====================================================================
// 14. submit_assignment — 과제 제출
// =====================================================================

export const SubmitAssignmentSchema = z.object({
  p_student_id: PositiveInt,
  p_assignment_id: PositiveInt,
  p_content_text: z
    .string()
    .max(5000, "제출 내용은 5000자 이하")
    .trim()
    .optional(),
  p_attachment_urls: z
    .array(z.string().url("올바른 URL이 아닙니다"))
    .max(5, "첨부는 최대 5개")
    .optional(),
});

export type SubmitAssignmentInput = z.infer<typeof SubmitAssignmentSchema>;

// =====================================================================
// 15. complete_market_request — 시장 매칭 완료
// =====================================================================

export const CompleteMarketRequestSchema = z.object({
  p_request_id: PositiveInt,
  p_rating: z.number().int().min(1).max(5).optional(),
  p_review_comment: z.string().max(500, "리뷰는 500자 이하").trim().optional(),
});

export type CompleteMarketRequestInput = z.infer<
  typeof CompleteMarketRequestSchema
>;

// =====================================================================
// 16. record_attendance — 출석 기록 (학생 자율 체크인)
// =====================================================================

export const RecordAttendanceSchema = z.object({
  p_student_id: PositiveInt,
  p_attendance_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식")
    .optional(),
  p_status: z.enum(ATTENDANCE_STATUS).optional().default("PRESENT"),
});

export type RecordAttendanceInput = z.infer<typeof RecordAttendanceSchema>;

// =====================================================================
// 17. setup_school_terms — 학기 설정 (admin이지만 학생 인터페이스에서도 표시 가능)
// =====================================================================
// 실제로는 교사 전용이지만 카탈로그 구성상 여기에 둠.

export const SetupSchoolTermsSchema = z
  .object({
    p_classroom_id: PositiveInt,
    p_first_term_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    p_first_term_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    p_second_term_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    p_second_term_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine(
    (data) =>
      new Date(data.p_first_term_start) < new Date(data.p_first_term_end),
    {
      message: "1학기 시작일은 종료일보다 빨라야 합니다",
      path: ["p_first_term_end"],
    },
  )
  .refine(
    (data) =>
      new Date(data.p_first_term_end) < new Date(data.p_second_term_start),
    {
      message: "1학기 종료일이 2학기 시작일보다 빨라야 합니다",
      path: ["p_second_term_start"],
    },
  )
  .refine(
    (data) =>
      new Date(data.p_second_term_start) < new Date(data.p_second_term_end),
    {
      message: "2학기 시작일은 종료일보다 빨라야 합니다",
      path: ["p_second_term_end"],
    },
  );

export type SetupSchoolTermsInput = z.infer<typeof SetupSchoolTermsSchema>;

// =====================================================================
// 18. 통합 검증 헬퍼
// =====================================================================

/**
 * Zod 검증 + 한국어 에러 메시지 변환
 *
 * 사용 예:
 *   const result = validateInput(PurchaseSnackSchema, formData);
 *   if (!result.success) {
 *     showToast({ title: '입력 오류', description: result.error });
 *     return;
 *   }
 *   // 검증 통과 → result.data 사용
 *   await supabase.rpc('purchase_snack', result.data);
 */
export function validateInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
):
  | { success: true; data: z.infer<T> }
  | { success: false; error: string; details: z.ZodIssue[] } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // 첫 번째 에러를 사용자 친화 메시지로
  const firstError = result.error.issues[0];
  const fieldName = firstError.path.join(".");
  const message = fieldName
    ? `[${fieldName}] ${firstError.message}`
    : firstError.message;

  return {
    success: false,
    error: message,
    details: result.error.issues,
  };
}

// =====================================================================
// 사용 예시
// =====================================================================
//
// ```typescript
// import { PurchaseSnackSchema, validateInput } from './zod_student_schemas';
//
// const handlePurchase = async (snackId: number, quantity: number) => {
//   // 1. Zod 검증
//   const validation = validateInput(PurchaseSnackSchema, {
//     p_student_id: currentStudent.id,
//     p_snack_id: snackId,
//     p_quantity: quantity,
//   });
//
//   if (!validation.success) {
//     showToast({ title: '입력 오류', description: validation.error });
//     return;
//   }
//
//   // 2. Supabase RPC 호출 (검증된 데이터)
//   const { data, error } = await supabase.rpc('purchase_snack', validation.data);
//
//   if (error) {
//     const userMsg = getUserFriendlyError(error);
//     showToast({ title: userMsg.title, description: userMsg.description });
//   } else {
//     showToast({ title: '구매 완료!', color: 'green' });
//   }
// };
// ```

// =====================================================================
// 18. place_live_auction_bid — 실시간 경매 입찰
// =====================================================================

export const PlaceLiveAuctionBidSchema = z.object({
  p_auction_item_id: PositiveInt,
  p_student_id: PositiveInt,
  p_bid_amount: z.number().int().positive().max(10_000_000).nullable().optional(),
  p_quick_bid: z.boolean().default(false),
});

export type PlaceLiveAuctionBidInput = z.infer<typeof PlaceLiveAuctionBidSchema>;

export const FinalizeLiveAuctionItemSchema = z.object({
  p_item_id: PositiveInt,
});

export type FinalizeLiveAuctionItemInput = z.infer<typeof FinalizeLiveAuctionItemSchema>;

export const AuctionSuperPassItemSchema = z.object({
  p_item_id: PositiveInt,
});

export type AuctionSuperPassItemInput = z.infer<typeof AuctionSuperPassItemSchema>;
