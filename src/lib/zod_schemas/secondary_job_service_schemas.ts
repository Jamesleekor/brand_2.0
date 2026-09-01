import { z } from 'zod';

export const NoArgsSchema = z.object({}).strict();

export const ServiceOrderStatusSchema = z.enum([
  'REQUESTED','ACCEPTED','DELIVERED','REVISION_REQUESTED','COMPLETED','REJECTED','CANCELLED','DISPUTED',
]);
export type ServiceOrderStatus = z.infer<typeof ServiceOrderStatusSchema>;

export const UpsertSecondaryJobServiceSchema = z.object({
  p_service_id: z.number().int().positive().nullable(),
  p_secondary_job_id: z.number().int().positive(),
  p_title: z.string().trim().min(2).max(80),
  p_description: z.string().trim().min(10).max(1000),
  p_price_gold: z.number().int().min(1).max(1_000_000),
  p_delivery_note: z.string().trim().max(100),
  p_is_active: z.boolean(),
  p_allow_concurrent_orders: z.boolean(),
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
