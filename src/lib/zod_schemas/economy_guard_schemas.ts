import { z } from 'zod';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NullableDateString = DateString.nullable();
const PositiveInt = z.number().int().positive();
const NonNegativeInt = z.number().int().nonnegative();
const NonNegativeNumber = z.coerce.number().nonnegative();

export const EconomyGuardSourceKindSchema = z.enum(['P2P_TRANSFER', 'SERVICE_ORDER']);
export type EconomyGuardSourceKind = z.infer<typeof EconomyGuardSourceKindSchema>;

export const EconomyGuardEconomicStateSchema = z.enum([
  'ACTIVE',
  'ESCROW_ACTIVE',
  'SETTLED',
  'REFUNDED',
  'REVERSED',
]);
export type EconomyGuardEconomicState = z.infer<typeof EconomyGuardEconomicStateSchema>;

export const EconomyGuardDecisionSchema = z.enum(['NORMAL_CONFIRMED', 'FINAL_FLAGGED']);
export type EconomyGuardDecision = z.infer<typeof EconomyGuardDecisionSchema>;

export const EconomyGuardPenaltyReasonSchema = z.enum([
  '사유 허위 기재',
  '실물 거래 의심',
  '강압적 거래',
  '소명 거부',
  '기타',
]);
export type EconomyGuardPenaltyReason = z.infer<typeof EconomyGuardPenaltyReasonSchema>;

export const EconomyGuardPeriodKindSchema = z.enum(['week', 'month', 'all', 'custom']);
export type EconomyGuardPeriodKind = z.infer<typeof EconomyGuardPeriodKindSchema>;

export const EconomyGuardPeriodInputSchema = z
  .object({
    p_period: EconomyGuardPeriodKindSchema,
    p_start_date: NullableDateString.optional().default(null),
    p_end_date: NullableDateString.optional().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.p_period !== 'custom') return;
    if (!value.p_start_date || !value.p_end_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '사용자 지정 기간의 시작일과 종료일을 모두 입력해주세요.' });
      return;
    }
    if (value.p_start_date > value.p_end_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '시작일은 종료일보다 늦을 수 없습니다.' });
    }
  });
export type EconomyGuardPeriodInput = z.infer<typeof EconomyGuardPeriodInputSchema>;

export const EconomyGuardAccessSchema = z.object({
  can_access: z.boolean(),
  is_teacher: z.boolean(),
  student_id: z.number().int().positive().nullable(),
  classroom_id: z.number().int().positive().nullable(),
  role_type: z.enum(['CHIEF', 'MEMBER']).nullable(),
  active_term_id: z.number().int().positive().nullable(),
  start_date: NullableDateString,
  end_date: NullableDateString,
  reason: z.string(),
});
export type EconomyGuardAccess = z.infer<typeof EconomyGuardAccessSchema>;

export const EconomyGuardPenaltySchema = z.object({
  id: PositiveInt,
  penalty_uid: z.string(),
  subject_student_id: PositiveInt,
  subject_name: z.string().nullable().optional(),
  subject_brand_name: z.string().nullable().optional(),
  reason: EconomyGuardPenaltyReasonSchema,
  memo: z.string().nullable().optional(),
  created_at: z.string(),
});
export type EconomyGuardPenalty = z.infer<typeof EconomyGuardPenaltySchema>;

export const EconomyGuardEventSchema = z.object({
  source_kind: EconomyGuardSourceKindSchema,
  source_id: PositiveInt,
  event_key: z.string(),
  occurred_at: z.string(),
  date: DateString,
  sender_id: PositiveInt,
  sender_name: z.string(),
  sender_brand_name: z.string().nullable(),
  receiver_id: PositiveInt,
  receiver_name: z.string(),
  receiver_brand_name: z.string().nullable(),
  amount: NonNegativeNumber,
  quantity: PositiveInt,
  unit_price: NonNegativeNumber,
  tag: z.string().nullable(),
  description: z.string().nullable(),
  raw_status: z.string().nullable(),
  economic_state: EconomyGuardEconomicStateSchema,
  source_meta: z.record(z.unknown()),
  anomaly_reasons: z.array(z.string()),
  anomaly_fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  is_suspicious: z.boolean(),
  is_actionable: z.boolean(),
  is_open_alert: z.boolean(),
  review_status: EconomyGuardDecisionSchema.nullable(),
  review_is_stale: z.boolean(),
  review_memo: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  penalty: EconomyGuardPenaltySchema.nullable(),
});
export type EconomyGuardEvent = z.infer<typeof EconomyGuardEventSchema>;

const StudentActivitySchema = z.object({
  student_id: PositiveInt,
  name: z.string(),
  brand_name: z.string().nullable(),
  count: NonNegativeInt,
  total: NonNegativeNumber,
});

const TagStatSchema = z.object({
  tag: z.string(),
  count: NonNegativeInt,
  amount: NonNegativeNumber,
  quantity: NonNegativeInt,
  unit_price: NonNegativeNumber,
});

const DateStatSchema = z.object({
  date: DateString,
  count: NonNegativeInt,
  amount: NonNegativeNumber,
});

const SourceStatSchema = z.object({
  source_kind: EconomyGuardSourceKindSchema,
  visible_count: NonNegativeInt,
  effective_count: NonNegativeInt,
  effective_amount: NonNegativeNumber,
  open_alert_count: NonNegativeInt,
});

const StudentTradeStatSchema = z.object({
  student_id: PositiveInt,
  name: z.string(),
  brand_name: z.string().nullable(),
  buy_count: NonNegativeInt,
  buy_amount: NonNegativeNumber,
  sell_count: NonNegativeInt,
  sell_amount: NonNegativeNumber,
  service_buy_count: NonNegativeInt,
  service_buy_amount: NonNegativeNumber,
  service_sell_count: NonNegativeInt,
  service_sell_amount: NonNegativeNumber,
});

const ServiceCategoryStatSchema = z.object({
  category: z.enum(['청소', '학습', '제작', '1인1역', '생활도움', '기타']),
  available: z.boolean(),
  order_count: NonNegativeInt,
  amount: NonNegativeNumber,
  buyer_count: NonNegativeInt,
  seller_count: NonNegativeInt,
});

const NetworkNodeSchema = z.object({
  student_id: PositiveInt,
  name: z.string(),
  brand_name: z.string().nullable(),
  sell_count: NonNegativeInt,
  buy_count: NonNegativeInt,
  total_activity: NonNegativeInt,
  final_flagged: z.boolean(),
});

const NetworkEdgeSchema = z.object({
  from_student_id: PositiveInt,
  to_student_id: PositiveInt,
  from_name: z.string(),
  to_name: z.string(),
  count: NonNegativeInt,
  total: NonNegativeNumber,
  p2p_count: NonNegativeInt,
  service_count: NonNegativeInt,
});

const LorenzPointSchema = z.object({
  population_share: z.coerce.number().min(0).max(1),
  asset_share: z.coerce.number().min(0).max(1),
});

const InequalityRankSchema = z.object({
  rank: PositiveInt,
  student_id: PositiveInt,
  name: z.string(),
  brand_name: z.string().nullable(),
  gold: NonNegativeNumber,
  bv: NonNegativeNumber,
});

const InequalityHistorySchema = z.object({
  snapshot_date: DateString,
  gini_gold: z.coerce.number().min(0).max(1),
  gini_bv: z.coerce.number().min(0).max(1),
  top20_gold_share: z.coerce.number().min(0).max(1),
});

export const EconomyGuardDashboardSchema = z.object({
  access: EconomyGuardAccessSchema,
  server_now: z.string(),
  period: z.object({
    kind: EconomyGuardPeriodKindSchema,
    start_date: NullableDateString,
    end_date: NullableDateString,
    label: z.string(),
  }),
  events: z.array(EconomyGuardEventSchema),
  stats: z.object({
    visible_count: NonNegativeInt,
    total_count: NonNegativeInt,
    total_amount: NonNegativeNumber,
    settled_amount: NonNegativeNumber,
    escrow_held_amount: NonNegativeNumber,
    suspect_count: NonNegativeInt,
    final_count: NonNegativeInt,
    refunded_count: NonNegativeInt,
    reversed_count: NonNegativeInt,
    top_sellers: z.array(StudentActivitySchema),
    top_buyers: z.array(StudentActivitySchema),
    tag_stats: z.array(TagStatSchema),
    date_stats: z.array(DateStatSchema),
    source_stats: z.array(SourceStatSchema),
    student_trade_stats: z.array(StudentTradeStatSchema),
    service_top_earners: z.array(StudentActivitySchema),
    service_top_spenders: z.array(StudentActivitySchema),
    service_category_stats: z.array(ServiceCategoryStatSchema),
    briefing_report: z.string(),
  }),
  network: z.object({
    nodes: z.array(NetworkNodeSchema),
    edges: z.array(NetworkEdgeSchema),
  }),
  inequality: z.object({
    gini_gold: z.coerce.number().min(0).max(1),
    gini_bv: z.coerce.number().min(0).max(1),
    top20_gold_share: z.coerce.number().min(0).max(1),
    lorenz: z.array(LorenzPointSchema),
    ranked: z.array(InequalityRankSchema),
    history: z.array(InequalityHistorySchema),
    total_gold: NonNegativeNumber,
    total_bv: NonNegativeNumber,
    student_count: NonNegativeInt,
  }),
});
export type EconomyGuardDashboard = z.infer<typeof EconomyGuardDashboardSchema>;

export const EconomyGuardMarkNormalSchema = z.object({
  p_source_kind: EconomyGuardSourceKindSchema,
  p_source_id: PositiveInt,
  p_memo: z.string().trim().max(500).nullable().default(null),
});
export type EconomyGuardMarkNormalInput = z.infer<typeof EconomyGuardMarkNormalSchema>;

export const EconomyGuardFlagEventSchema = z
  .object({
    p_source_kind: EconomyGuardSourceKindSchema,
    p_source_id: PositiveInt,
    p_subject_student_id: PositiveInt,
    p_reason: EconomyGuardPenaltyReasonSchema,
    p_memo: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.p_reason === '기타' && (value.p_memo ?? '').trim().length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_memo'], message: '기타 사유는 2자 이상의 메모가 필요합니다.' });
    }
  });
export type EconomyGuardFlagEventInput = z.infer<typeof EconomyGuardFlagEventSchema>;

export const EconomyGuardWriteResultSchema = z.object({
  success: z.literal(true),
  source_kind: EconomyGuardSourceKindSchema,
  source_id: PositiveInt,
  event_key: z.string(),
  review_status: EconomyGuardDecisionSchema,
  review_id: PositiveInt,
  basis_hash: z.string().regex(/^[0-9a-f]{32}$/),
  penalty_id: PositiveInt.optional(),
  subject_student_id: PositiveInt.optional(),
  subject_name: z.string().nullable().optional(),
});
export type EconomyGuardWriteResult = z.infer<typeof EconomyGuardWriteResultSchema>;

export const EconomyGuardSnapshotResultSchema = z.object({
  success: z.literal(true),
  snapshot_date: DateString,
});
export type EconomyGuardSnapshotResult = z.infer<typeof EconomyGuardSnapshotResultSchema>;

export const EconomyGuardAiContextSchema = z.object({
  period: EconomyGuardDashboardSchema.shape.period,
  stats: EconomyGuardDashboardSchema.shape.stats,
  inequality: EconomyGuardDashboardSchema.shape.inequality,
  events: z.array(EconomyGuardEventSchema).max(150),
});
export type EconomyGuardAiContext = z.infer<typeof EconomyGuardAiContextSchema>;
