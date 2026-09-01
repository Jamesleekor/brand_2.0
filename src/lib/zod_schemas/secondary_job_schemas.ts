import { z } from 'zod';

export const SecondaryJobCategorySchema = z.enum([
  'STUDY', 'CREATIVITY', 'SPORT', 'TECH', 'COMFORT', 'CUSTOM',
]);
export type SecondaryJobCategory = z.infer<typeof SecondaryJobCategorySchema>;

export const ApplySecondaryJobSchema = z.object({
  p_student_id: z.number().int().positive(),
  p_job_name: z.string().trim().min(1).max(50),
  p_description: z.string().trim().min(10, '활동 설명은 10자 이상 입력해주세요.').max(500),
});
export type ApplySecondaryJobInput = z.infer<typeof ApplySecondaryJobSchema>;

export const ApproveSecondaryJobSchema = z.object({
  p_application_id: z.number().int().positive(),
  p_teacher_user_id: z.string().uuid(),
  p_approved: z.boolean(),
  p_rejection_reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (!value.p_approved && (!value.p_rejection_reason || value.p_rejection_reason.length < 2)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_rejection_reason'], message: '거절 사유는 2자 이상 입력해주세요.' });
  }
});
export type ApproveSecondaryJobInput = z.infer<typeof ApproveSecondaryJobSchema>;

export const UpsertSecondaryJobCatalogSchema = z.object({
  p_catalog_id: z.number().int().positive().nullable(),
  p_category: SecondaryJobCategorySchema,
  p_template_name: z.string().trim().min(1).max(50),
  p_template_description: z.string().trim().max(500),
  p_suggested_price_range: z.string().trim().max(50),
  p_unlock_tier: z.string().trim().min(1).max(30),
  p_sort_order: z.number().int().min(0).max(9999),
  p_is_active: z.boolean(),
});
export type UpsertSecondaryJobCatalogInput = z.infer<typeof UpsertSecondaryJobCatalogSchema>;

export const ReleaseSecondaryJobSchema = z.object({
  p_job_id: z.number().int().positive(),
  p_reason: z.string().trim().min(2, '해제 사유는 2자 이상 입력해주세요.').max(500),
});
export type ReleaseSecondaryJobInput = z.infer<typeof ReleaseSecondaryJobSchema>;


export const DeleteSecondaryJobCatalogSchema = z.object({
  p_catalog_id: z.number().int().positive(),
});
export type DeleteSecondaryJobCatalogInput = z.infer<typeof DeleteSecondaryJobCatalogSchema>;

export const NoArgsSchema = z.object({});
