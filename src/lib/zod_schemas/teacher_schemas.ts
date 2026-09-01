// =====================================================================
// B.R.A.N.D 2.0 — Zod Schemas: Teacher RPC Functions
// Stage 5 Sub-step 5-C · 생성일 2026-05-20
// =====================================================================
// 교사·관리자가 호출하는 RPC의 Zod 검증 스키마.
// 학생 스키마(student_schemas.ts)와 별도 분리:
//   - 교사 UI(GuardDashboard 등)에서만 import
//   - 학생 UI에 노출 X
// =====================================================================

import { z } from "zod";
import { EMERGENCY_TYPES, ACHIEVEMENT_GRADES } from "../types/database_types";

const PositiveInt = z.number().int().positive();
const PositiveAmount = z.number().int().positive().max(10_000_000);
const NonNegativeInt = z.number().int().nonnegative();
const KoreanText = z.string().min(1).max(50).trim();
const LongText = z.string().max(2000).trim();

const AssetAdjustmentReason = z.string().trim().min(2).max(200);

// =====================================================================
// 0. teacher_adjust_student_assets — 교사 BV/GOLD/CRYSTAL 단일·다중 지급·차감
// =====================================================================

export const TeacherAdjustStudentAssetsSchema = z.object({
  p_student_ids: z
    .array(PositiveInt)
    .min(1)
    .max(100)
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "같은 학생이 중복 선택되어 있습니다.",
        });
      }
    }),
  p_value_token: z.enum(["BV", "GOLD", "CRYSTAL"]),
  p_amount: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((amount) => amount !== 0, { message: "금액은 0일 수 없습니다." }),
  p_reason: AssetAdjustmentReason,
});

export type TeacherAdjustStudentAssetsInput = z.infer<
  typeof TeacherAdjustStudentAssetsSchema
>;

export const TeacherGrantStudentAssetsCombinedSchema = z.object({
  p_student_ids: z
    .array(PositiveInt)
    .min(1)
    .max(100)
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "같은 학생이 중복 선택되어 있습니다." });
      }
    }),
  p_bv_amount: z.number().int().min(0).max(10_000_000),
  p_gold_amount: z.number().int().min(0).max(10_000_000),
  p_reason: AssetAdjustmentReason,
}).superRefine((value, ctx) => {
  if (value.p_bv_amount === 0 && value.p_gold_amount === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "BV와 골드 중 하나 이상은 1 이상이어야 합니다." });
  }
});

export type TeacherGrantStudentAssetsCombinedInput = z.infer<
  typeof TeacherGrantStudentAssetsCombinedSchema
>;

// =====================================================================
// 1. confirm_auction_sale — 경매 낙찰 ⭐ (Master Lee 페인 ②)
// =====================================================================

export const ConfirmAuctionSaleSchema = z.object({
  p_auction_item_id: PositiveInt,
  p_winner_student_id: PositiveInt,
  p_final_price: PositiveAmount,
  p_attempt_number: z.number().int().min(1).max(3),
});

export type ConfirmAuctionSaleInput = z.infer<typeof ConfirmAuctionSaleSchema>;

// =====================================================================
// 2. report_auction_failure — 경매 유찰
// =====================================================================

export const ReportAuctionFailureSchema = z.object({
  p_auction_item_id: PositiveInt,
  p_failure_type: z.enum(["ATTEMPT_1", "ATTEMPT_2", "FINAL"]),
  p_attempt_number: z.number().int().min(1).max(3),
  p_reason: LongText.optional(),
});

export type ReportAuctionFailureInput = z.infer<
  typeof ReportAuctionFailureSchema
>;

// =====================================================================
// 3. grant_achievement — 업적 직접 부여
// =====================================================================

export const GrantAchievementSchema = z.object({
  p_student_id: PositiveInt,
  p_achievement_id: PositiveInt,
  p_application_id: z.number().int().positive().optional(),
  p_method: z
    .enum(["AUTOMATIC", "MANUAL", "MANUAL_FALLBACK"])
    .default("MANUAL"),
  p_evidence_data: z.record(z.unknown()).optional(),
});

export type GrantAchievementInput = z.infer<typeof GrantAchievementSchema>;

// =====================================================================
// 4. manual_review_achievement — 업적 수동 검토 ⭐ (안전장치 ③)
// =====================================================================

export const ManualReviewAchievementSchema = z.object({
  p_application_id: PositiveInt,
  p_approve: z.boolean(),
  p_reason: LongText.optional(),
  p_teacher_user_id: z.string().uuid().optional(),
});

export type ManualReviewAchievementInput = z.infer<
  typeof ManualReviewAchievementSchema
>;

// =====================================================================
// 5. revoke_achievement_grant — 업적 회수
// =====================================================================

export const RevokeAchievementGrantSchema = z.object({
  p_student_achievement_id: PositiveInt,
  p_reason: LongText,
});

export type RevokeAchievementGrantInput = z.infer<
  typeof RevokeAchievementGrantSchema
>;

// =====================================================================
// 6. evaluate_guild_mission_log — 길드 미션 평가
// =====================================================================

export const EvaluateGuildMissionLogSchema = z.object({
  p_mission_log_id: PositiveInt,
  p_qualitative_score: NonNegativeInt.max(100),
  p_synergy_score: NonNegativeInt.max(50).default(0),
  p_reward_bv_per_member: NonNegativeInt.max(10000).default(0),
  p_evaluator_id: z.string().uuid().optional(),
  p_note: LongText.optional(),
});

export type EvaluateGuildMissionLogInput = z.infer<
  typeof EvaluateGuildMissionLogSchema
>;

// =====================================================================
// 7. approve_secondary_job — 2차직업 승인
// =====================================================================

export const ApproveSecondaryJobSchema = z.object({
  p_application_id: PositiveInt,
  p_teacher_user_id: z.string().uuid(),
  p_approved: z.boolean(),
  p_rejection_reason: LongText.optional(),
});

export type ApproveSecondaryJobInput = z.infer<
  typeof ApproveSecondaryJobSchema
>;

// =====================================================================
// 8. grade_assignment — 과제 평가 ⭐ (시사점 D)
// =====================================================================

export const GradeAssignmentSchema = z.object({
  p_submission_id: PositiveInt,
  p_score: NonNegativeInt.max(100),
  p_feedback: LongText.optional(),
  p_teacher_user_id: z.string().uuid().optional(),
});

export type GradeAssignmentInput = z.infer<typeof GradeAssignmentSchema>;

// =====================================================================
// 9. activate_emergency — 비상사태 발동
// =====================================================================

export const ActivateEmergencySchema = z.object({
  p_classroom_id: PositiveInt,
  p_emergency_type: z.enum(EMERGENCY_TYPES),
  p_reason: LongText,
  p_scheduled_end_at: z.string().datetime().optional(),
  p_auto_termination: z.record(z.unknown()).optional(),
  p_teacher_user_id: z.string().uuid().optional(),
});

export type ActivateEmergencyInput = z.infer<typeof ActivateEmergencySchema>;

// =====================================================================
// 10. terminate_emergency — 비상사태 종료
// =====================================================================

export const TerminateEmergencySchema = z.object({
  p_emergency_id: PositiveInt,
  p_is_auto: z.boolean().default(false),
  p_teacher_user_id: z.string().uuid().optional(),
});

export type TerminateEmergencyInput = z.infer<typeof TerminateEmergencySchema>;

// =====================================================================
// 11. broadcast_global_alert — 전역 알림
// =====================================================================

export const BroadcastGlobalAlertSchema = z.object({
  p_classroom_id: PositiveInt,
  p_category: z.enum([
    "HIDDEN",
    "MILESTONE",
    "TIER",
    "SET_COMPLETION",
    "EMERGENCY",
    "AUCTION",
    "GENERAL",
  ]),
  p_message: z.string().min(1).max(500).trim(),
  p_emoji: z.string().max(10).optional(),
  p_triggered_by_student_id: z.number().int().positive().optional(),
  p_related_source_type: z.string().max(50).optional(),
  p_related_source_id: z.number().int().positive().optional(),
  p_expires_in_hours: z.number().int().min(1).max(168).default(48),
});

export type BroadcastGlobalAlertInput = z.infer<
  typeof BroadcastGlobalAlertSchema
>;

// =====================================================================
// 12. grant_cosmetic_item — 꾸미기 직접 지급
// =====================================================================

export const GrantCosmeticItemSchema = z.object({
  p_student_id: PositiveInt,
  p_item_id: PositiveInt,
  p_obtained_via: z
    .enum([
      "PURCHASE",
      "ACHIEVEMENT_REWARD",
      "SEASONAL_GIFT",
      "TEACHER_GRANT",
      "SET_COMPLETION",
    ])
    .default("TEACHER_GRANT"),
});

export type GrantCosmeticItemInput = z.infer<typeof GrantCosmeticItemSchema>;

// =====================================================================
// 13. verify_wallet_integrity — 무결성 점검
// =====================================================================

export const VerifyWalletIntegritySchema = z.object({
  p_classroom_id: PositiveInt.optional(),
});

export type VerifyWalletIntegrityInput = z.infer<
  typeof VerifyWalletIntegritySchema
>;

// =====================================================================
// 14. teacher_reverse_economic_event — 교사 경제 사건 취소·정정
// =====================================================================
// 내부 reverse_transaction은 service_role 전용으로 유지한다.
// 브라우저는 교사 권한·담당 학급을 검증하는 이 전용 RPC만 호출한다.

export const TeacherReverseEconomicEventSchema = z.object({
  p_transaction_id: PositiveInt,
  p_reason: z
    .string()
    .trim()
    .min(2, "취소 사유는 2자 이상이어야 합니다")
    .max(200, "취소 사유는 200자 이하여야 합니다"),
});

export type TeacherReverseEconomicEventInput = z.infer<
  typeof TeacherReverseEconomicEventSchema
>;

// 과거 import와의 호환을 위한 별칭
export const ReverseTransactionSchema = TeacherReverseEconomicEventSchema;
export type ReverseTransactionInput = TeacherReverseEconomicEventInput;

// =====================================================================
// 15. distribute_welfare — 복지기금 분배
// =====================================================================

export const DistributeWelfareSchema = z.object({
  p_classroom_id: PositiveInt,
  p_amount: PositiveAmount,
});

export type DistributeWelfareInput = z.infer<typeof DistributeWelfareSchema>;

// =====================================================================
// 16. process_matured_deposits — 만기 예금 일괄 처리 (수동 호출)
// =====================================================================

export const ProcessMaturedDepositsSchema = z.object({
  p_classroom_id: PositiveInt.optional(), // NULL이면 전체 학급
});

export type ProcessMaturedDepositsInput = z.infer<
  typeof ProcessMaturedDepositsSchema
>;

// =====================================================================
// 통합 헬퍼 (student_schemas.ts와 동일)
// =====================================================================

export { validateInput } from "./student_schemas";

// =====================================================================
// 사용 예시 (교사 대시보드)
// =====================================================================
//
// ```typescript
// import { ManualReviewAchievementSchema, validateInput } from './zod_teacher_schemas';
//
// const handleReview = async (applicationId: number, approve: boolean) => {
//   const validation = validateInput(ManualReviewAchievementSchema, {
//     p_application_id: applicationId,
//     p_approve: approve,
//     p_reason: feedback,
//     p_teacher_user_id: currentTeacher.userId,
//   });
//
//   if (!validation.success) {
//     showToast({ title: '입력 오류', description: validation.error });
//     return;
//   }
//
//   const { error } = await supabase.rpc('manual_review_achievement', validation.data);
//   if (error) {
//     const userMsg = getUserFriendlyError(error);
//     showToast({ title: userMsg.title, description: userMsg.description });
//   } else {
//     showToast({ title: approve ? '✅ 승인' : '❌ 거부', color: 'green' });
//   }
// };
// ```

// =====================================================================
// 18+. 실시간 온라인 경매 교사 RPC
// =====================================================================

export const TeacherCreateLiveAuctionSchema = z.object({
  p_classroom_id: PositiveInt,
  p_round_number: z.number().int().min(1).max(99),
  p_school_year: z.number().int().min(2020).max(2100),
  p_scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  p_initial_duration_seconds: z.number().int().min(10).max(300),
  p_extension_seconds: z.number().int().min(5).max(60),
});
export type TeacherCreateLiveAuctionInput = z.infer<typeof TeacherCreateLiveAuctionSchema>;


export const TeacherCreateOrResetLiveAuctionSchema = TeacherCreateLiveAuctionSchema.extend({
  p_reset_existing: z.boolean().default(false),
});
export type TeacherCreateOrResetLiveAuctionInput = z.infer<typeof TeacherCreateOrResetLiveAuctionSchema>;

export const TeacherAuctionHistoryClassroomSchema = z.object({ p_classroom_id: PositiveInt });
export type TeacherAuctionHistoryClassroomInput = z.infer<typeof TeacherAuctionHistoryClassroomSchema>;

export const TeacherAuctionPresetSaveSchema = z.object({
  p_classroom_id: PositiveInt,
  p_category: z.enum(['자리','1인1역','급식순서','특별경매','기타']),
  p_item_name: z.string().trim().min(1).max(100),
  p_description: z.string().trim().max(500).nullable().optional(),
  p_emoji: z.string().trim().min(1).max(16),
  p_image_url: z.string().trim().url().nullable().optional().or(z.literal('')),
  p_default_starting_price: z.number().int().min(1).max(10_000_000),
});
export type TeacherAuctionPresetSaveInput = z.infer<typeof TeacherAuctionPresetSaveSchema>;

export const TeacherAuctionPresetIdSchema = z.object({ p_preset_id: PositiveInt });
export type TeacherAuctionPresetIdInput = z.infer<typeof TeacherAuctionPresetIdSchema>;

export const TeacherBulkAuctionItemsSchema = z.object({
  p_auction_id: PositiveInt,
  p_items: z.array(z.object({
    item_name: z.string().trim().min(1).max(100),
    category: z.enum(['자리','1인1역','급식순서','특별경매','기타']),
    description: z.string().trim().max(500).nullable().optional(),
    emoji: z.string().trim().min(1).max(16),
    image_url: z.string().trim().url().nullable().optional().or(z.literal('')),
    starting_price: z.number().int().min(1).max(10_000_000),
  })).min(1).max(100),
});
export type TeacherBulkAuctionItemsInput = z.infer<typeof TeacherBulkAuctionItemsSchema>;

export const TeacherAddLiveAuctionItemSchema = z.object({
  p_auction_id: PositiveInt,
  p_item_name: z.string().trim().min(1).max(100),
  p_description: z.string().trim().max(500).nullable().optional(),
  p_category: z.string().trim().min(1).max(50),
  p_emoji: z.string().trim().min(1).max(16),
  p_image_url: z.string().trim().url().nullable().optional().or(z.literal('')),
  p_starting_price: z.number().int().min(1).max(10_000_000),
  p_display_order: z.number().int().positive().nullable().optional(),
});
export type TeacherAddLiveAuctionItemInput = z.infer<typeof TeacherAddLiveAuctionItemSchema>;

export const TeacherUpdateLiveAuctionItemSchema = z.object({
  p_item_id: PositiveInt,
  p_item_name: z.string().trim().min(1).max(100),
  p_description: z.string().trim().max(500).nullable().optional(),
  p_category: z.string().trim().min(1).max(50),
  p_emoji: z.string().trim().min(1).max(16),
  p_image_url: z.string().trim().url().nullable().optional().or(z.literal('')),
  p_starting_price: z.number().int().min(1).max(10_000_000),
});
export type TeacherUpdateLiveAuctionItemInput = z.infer<typeof TeacherUpdateLiveAuctionItemSchema>;

export const TeacherAuctionItemIdSchema = z.object({ p_item_id: PositiveInt });
export type TeacherAuctionItemIdInput = z.infer<typeof TeacherAuctionItemIdSchema>;

export const TeacherAuctionIdSchema = z.object({ p_auction_id: PositiveInt });
export type TeacherAuctionIdInput = z.infer<typeof TeacherAuctionIdSchema>;

export const TeacherMoveLiveAuctionItemSchema = z.object({
  p_item_id: PositiveInt,
  p_direction: z.union([z.literal(-1), z.literal(1)]),
});
export type TeacherMoveLiveAuctionItemInput = z.infer<typeof TeacherMoveLiveAuctionItemSchema>;

export const TeacherFailLiveAuctionItemSchema = z.object({
  p_item_id: PositiveInt,
  p_note: z.string().trim().max(500).nullable().optional(),
});
export type TeacherFailLiveAuctionItemInput = z.infer<typeof TeacherFailLiveAuctionItemSchema>;
