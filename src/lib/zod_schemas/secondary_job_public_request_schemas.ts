import { z } from 'zod';
import { SecondaryJobCategorySchema } from '@/lib/zod_schemas/secondary_job_schemas';

export const PublicRequestEligibilitySchema = z.enum(['ANY', 'CATEGORY', 'JOB_NAME']);
export type PublicRequestEligibility = z.infer<typeof PublicRequestEligibilitySchema>;

export const PublicRequestStatusSchema = z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED']);
export type PublicRequestStatus = z.infer<typeof PublicRequestStatusSchema>;

export const PublicAssignmentStatusSchema = z.enum([
  'ACCEPTED', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED',
]);
export type PublicAssignmentStatus = z.infer<typeof PublicAssignmentStatusSchema>;

const RequestFields = {
  p_title: z.string().trim().min(2, '의뢰 제목은 2자 이상 입력해주세요.').max(100),
  p_description: z.string().trim().min(10, '의뢰 설명은 10자 이상 입력해주세요.').max(2000),
  p_reward_gold: z.number().int().min(1).max(1_000_000),
  p_eligibility_type: PublicRequestEligibilitySchema,
  p_required_category: SecondaryJobCategorySchema.nullable(),
  p_required_job_name: z.string().trim().max(50).nullable(),
  p_max_assignees: z.number().int().min(1).max(24),
  p_due_at: z.string().min(1),
};

function eligibilityRefine(value: { p_eligibility_type?: PublicRequestEligibility; p_required_category?: string | null; p_required_job_name?: string | null }, ctx: z.RefinementCtx) {
  if (value.p_eligibility_type === 'CATEGORY' && !value.p_required_category) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_required_category'], message: '수행 가능한 분야를 선택해주세요.' });
  }
  if (value.p_eligibility_type === 'JOB_NAME' && !value.p_required_job_name?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_required_job_name'], message: '수행 가능한 2차직업을 선택해주세요.' });
  }
}

export const CreatePublicRequestSchema = z.object({
  p_classroom_id: z.number().int().positive(),
  ...RequestFields,
  p_publish: z.boolean(),
}).superRefine(eligibilityRefine);
export type CreatePublicRequestInput = z.infer<typeof CreatePublicRequestSchema>;

export const UpdatePublicRequestSchema = z.object({
  p_request_id: z.number().int().positive(),
  ...RequestFields,
}).superRefine(eligibilityRefine);
export type UpdatePublicRequestInput = z.infer<typeof UpdatePublicRequestSchema>;

export const IdSchema = z.object({ p_request_id: z.number().int().positive() });
export type IdInput = z.infer<typeof IdSchema>;

export const ExtendDeadlineSchema = z.object({
  p_request_id: z.number().int().positive(),
  p_due_at: z.string().min(1),
});
export type ExtendDeadlineInput = z.infer<typeof ExtendDeadlineSchema>;

export const CancelRequestSchema = z.object({
  p_request_id: z.number().int().positive(),
  p_reason: z.string().trim().min(2, '취소 사유는 2자 이상 입력해주세요.').max(500),
});
export type CancelRequestInput = z.infer<typeof CancelRequestSchema>;

export const AcceptRequestSchema = z.object({
  p_request_id: z.number().int().positive(),
  p_secondary_job_id: z.number().int().positive(),
});
export type AcceptRequestInput = z.infer<typeof AcceptRequestSchema>;

export const SubmitRequestSchema = z.object({
  p_assignment_id: z.number().int().positive(),
  p_submission_text: z.string().trim().min(10, '완료 보고는 10자 이상 입력해주세요.').max(2000),
});
export type SubmitRequestInput = z.infer<typeof SubmitRequestSchema>;

export const CancelAssignmentSchema = z.object({
  p_assignment_id: z.number().int().positive(),
  p_reason: z.string().trim().max(500).nullable(),
});
export type CancelAssignmentInput = z.infer<typeof CancelAssignmentSchema>;

export const TeacherCancelAssignmentSchema = z.object({
  p_assignment_id: z.number().int().positive(),
  p_reason: z.string().trim().min(2, '취소 사유는 2자 이상 입력해주세요.').max(500),
});
export type TeacherCancelAssignmentInput = z.infer<typeof TeacherCancelAssignmentSchema>;

export const ReviewAssignmentSchema = z.object({
  p_assignment_id: z.number().int().positive(),
  p_action: z.enum(['APPROVE', 'REVISION', 'FAIL']),
  p_feedback: z.string().trim().max(500).nullable(),
}).superRefine((value, ctx) => {
  if ((value.p_action === 'REVISION' || value.p_action === 'FAIL') && (!value.p_feedback || value.p_feedback.length < 2)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_feedback'], message: '재수행/실패 사유는 2자 이상 입력해주세요.' });
  }
});
export type ReviewAssignmentInput = z.infer<typeof ReviewAssignmentSchema>;

export const TeacherBoardSchema = z.object({ p_classroom_id: z.number().int().positive() });
export const NoArgsSchema = z.object({});
