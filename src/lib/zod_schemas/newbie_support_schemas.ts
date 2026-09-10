import { z } from 'zod';

export const NoArgsSchema = z.object({});
export const ProgramIdSchema = z.object({ p_program_id: z.number().int().positive() });
const ProgramConfigShape = {
  p_missed_opportunities: z.number().int().min(1).max(1000),
  p_bv_per_opportunity: z.number().int().min(1).max(10_000),
  p_start_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  p_end_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  p_mentor_student_ids: z.array(z.number().int().positive()).min(2).max(3),
  p_public_request_ids: z.array(z.number().int().positive()).min(1).max(20),
} as const;

function refineProgramConfig<T extends {
  p_start_on: string;
  p_end_on: string;
  p_mentor_student_ids: number[];
  p_public_request_ids: number[];
}>(v: T, ctx: z.RefinementCtx) {
  if (new Set(v.p_mentor_student_ids).size !== v.p_mentor_student_ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_mentor_student_ids'], message: '멘토를 중복 선택할 수 없습니다.' });
  if (new Set(v.p_public_request_ids).size !== v.p_public_request_ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_public_request_ids'], message: '공공의뢰를 중복 선택할 수 없습니다.' });
  if (v.p_start_on > v.p_end_on) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_end_on'], message: '종료일은 시작일 이후여야 합니다.' });
}

export const CreateProgramSchema = z.object({
  p_student_id: z.number().int().positive(),
  p_template_code: z.string().trim().min(1).max(80),
  p_template_version: z.number().int().positive(),
  ...ProgramConfigShape,
}).superRefine(refineProgramConfig);
export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;

export const UpdateProgramSchema = z.object({
  p_program_id: z.number().int().positive(),
  ...ProgramConfigShape,
}).superRefine(refineProgramConfig);
export type UpdateProgramInput = z.infer<typeof UpdateProgramSchema>;

export const ClaimSchema = z.object({
  p_program_quest_id: z.number().int().positive(),
  p_evidence_ref_id: z.number().int().positive(),
  p_mentor_help: z.array(z.object({
    mentor_assignment_id: z.number().int().positive(),
    help_type: z.enum(['EXPLANATION','COACHING','CHECKING','TRANSACTION','OTHER']),
  })).max(3),
  p_student_note: z.string().trim().max(500).nullable(),
});
export type ClaimInput = z.infer<typeof ClaimSchema>;

export const CompletionRequestSchema = z.object({
  p_program_id: z.number().int().positive(),
  p_best_mentor_student_id: z.number().int().positive().nullable(),
});
export type CompletionRequestInput = z.infer<typeof CompletionRequestSchema>;

export const ReviewClaimSchema = z.object({
  p_claim_id: z.number().int().positive(),
  p_decision: z.enum(['APPROVE','REJECT']),
  p_valid_mentor_assignment_ids: z.array(z.number().int().positive()).max(3),
  p_review_note: z.string().trim().max(500).nullable(),
});
export type ReviewClaimInput = z.infer<typeof ReviewClaimSchema>;

export const RevokeClaimSchema = z.object({ p_claim_id: z.number().int().positive(), p_reason: z.string().trim().min(2).max(200) });
export type RevokeClaimInput = z.infer<typeof RevokeClaimSchema>;

export const ExtendDeadlineSchema = z.object({ p_program_id: z.number().int().positive(), p_new_end_on: z.string().min(10).max(10), p_reason: z.string().trim().min(2).max(200) });
export type ExtendDeadlineInput = z.infer<typeof ExtendDeadlineSchema>;

export const FinalizeProgramSchema = z.object({ p_program_id: z.number().int().positive(), p_skip_best_mentor: z.boolean(), p_override_reason: z.string().trim().max(500).nullable() });
export type FinalizeProgramInput = z.infer<typeof FinalizeProgramSchema>;

export const CancelProgramSchema = z.object({ p_program_id: z.number().int().positive(), p_reason: z.string().trim().min(2).max(200) });
export type CancelProgramInput = z.infer<typeof CancelProgramSchema>;
