import { z } from 'zod';

export const NoArgsSchema = z.object({}).strict();

export const ServiceOrderStatusSchema = z.enum([
  'QUOTE_REQUESTED','QUOTE_OFFERED',
  'REQUESTED','ACCEPTED','DELIVERED','REVISION_REQUESTED','COMPLETED','REJECTED','CANCELLED','DISPUTED',
]);
export type ServiceOrderStatus = z.infer<typeof ServiceOrderStatusSchema>;

export const ServiceCategorySchema = z.enum(['청소','학습','제작','1인1역','생활도움','기타']);
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

export const ServicePricingModeSchema = z.enum(['FIXED','OPTION','QUOTE']);
export type ServicePricingMode = z.infer<typeof ServicePricingModeSchema>;

export const ServiceOptionInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  price_gold: z.number().int().min(1).max(1_000_000),
  is_active: z.boolean().optional(),
});
export type ServiceOptionInput = z.infer<typeof ServiceOptionInputSchema>;

export const UpsertSecondaryJobServiceSchema = z.object({
  p_service_id: z.number().int().positive().nullable(),
  p_secondary_job_id: z.number().int().positive(),
  p_title: z.string().trim().min(2).max(24),
  p_subtitle: z.string().trim().min(2).max(40),
  p_description: z.string().trim().min(10).max(2000),
  p_service_category: ServiceCategorySchema,
  p_pricing_mode: ServicePricingModeSchema,
  p_price_gold: z.number().int().min(1).max(1_000_000).nullable(),
  p_quantity_unit: z.string().trim().min(1).max(20),
  p_options: z.array(ServiceOptionInputSchema).max(20),
  p_delivery_note: z.string().trim().max(100),
  p_is_active: z.boolean(),
  p_allow_concurrent_orders: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.p_pricing_mode === 'FIXED') {
    if (value.p_price_gold === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_price_gold'], message: '고정가격형은 단가가 필요합니다.' });
    }
    if (value.p_options.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_options'], message: '고정가격형에는 옵션을 등록할 수 없습니다.' });
    }
  } else if (value.p_pricing_mode === 'QUOTE') {
    if (value.p_price_gold !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_price_gold'], message: '견적형은 등록 단계에서 단가를 지정하지 않습니다.' });
    }
    if (value.p_options.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_options'], message: '견적형에는 가격 옵션을 등록할 수 없습니다.' });
    }
  } else {
    if (value.p_price_gold !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_price_gold'], message: '옵션가격형은 대표 단가를 지정하지 않습니다.' });
    }
    if (value.p_options.length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_options'], message: '옵션가격형은 옵션이 1개 이상 필요합니다.' });
    }
    if (!value.p_options.some((option) => option.is_active !== false)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_options'], message: '활성 옵션이 1개 이상 필요합니다.' });
    }
    const names = value.p_options.map((option) => option.name.trim());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_options'], message: '같은 옵션명을 중복 등록할 수 없습니다.' });
    }
  }
});
export type UpsertSecondaryJobServiceInput = z.infer<typeof UpsertSecondaryJobServiceSchema>;

export const ToggleSecondaryJobServiceSchema = z.object({
  p_service_id: z.number().int().positive(),
  p_is_active: z.boolean(),
});
export type ToggleSecondaryJobServiceInput = z.infer<typeof ToggleSecondaryJobServiceSchema>;

export const ServiceIdSchema = z.object({ p_service_id: z.number().int().positive() });
export type ServiceIdInput = z.infer<typeof ServiceIdSchema>;

export const BuySecondaryJobServiceSchema = z.object({
  p_service_id: z.number().int().positive(),
  p_buyer_request: z.string().trim().min(10).max(500),
});
export type BuySecondaryJobServiceInput = z.infer<typeof BuySecondaryJobServiceSchema>;

export const OrderSecondaryJobServiceV2Schema = z.object({
  p_service_id: z.number().int().positive(),
  p_option_id: z.number().int().positive().nullable(),
  p_quantity: z.number().int().min(1).max(1_000_000),
  p_buyer_request: z.string().trim().min(10).max(500),
  p_buyer_note: z.string().trim().max(500).nullable(),
});
export type OrderSecondaryJobServiceV2Input = z.infer<typeof OrderSecondaryJobServiceV2Schema>;

export const OfferSecondaryJobServiceQuoteSchema = z.object({
  p_order_id: z.number().int().positive(),
  p_unit_price_gold: z.number().int().min(1).max(1_000_000),
  p_quantity: z.number().int().min(1).max(1_000_000),
  p_seller_note: z.string().trim().max(500).nullable(),
});
export type OfferSecondaryJobServiceQuoteInput = z.infer<typeof OfferSecondaryJobServiceQuoteSchema>;

export const AcceptSecondaryJobServiceQuoteSchema = z.object({
  p_order_id: z.number().int().positive(),
});
export type AcceptSecondaryJobServiceQuoteInput = z.infer<typeof AcceptSecondaryJobServiceQuoteSchema>;

export const ServiceOrderActionSchema = z.object({
  p_order_id: z.number().int().positive(),
  p_action: z.string().trim().min(1).max(30),
  p_reason: z.string().trim().max(500).nullable(),
});
export type ServiceOrderActionInput = z.infer<typeof ServiceOrderActionSchema>;

export const DeliverSecondaryJobServiceSchema = z.object({
  p_order_id: z.number().int().positive(),
  p_delivery_text: z.string().trim().min(10).max(2000),
});
export type DeliverSecondaryJobServiceInput = z.infer<typeof DeliverSecondaryJobServiceSchema>;

export const TeacherServiceBoardSchema = z.object({
  p_classroom_id: z.number().int().positive(),
});
export type TeacherServiceBoardInput = z.infer<typeof TeacherServiceBoardSchema>;

export const TeacherResolveServiceOrderSchema = z.object({
  p_order_id: z.number().int().positive(),
  p_action: z.enum(['REFUND','PAY_SELLER']),
  p_reason: z.string().trim().min(2).max(500),
});
export type TeacherResolveServiceOrderInput = z.infer<typeof TeacherResolveServiceOrderSchema>;
