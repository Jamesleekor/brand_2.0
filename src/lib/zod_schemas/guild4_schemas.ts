import { z } from 'zod';

const Id = z.number().int().positive();
const Reason = z.string().trim().min(2, '사유를 2자 이상 입력해주세요.').max(500);

export const NoArgsSchema = z.object({}).strict();
export const RoundIdSchema = z.object({ p_round_id: Id });
export type RoundIdInput = z.infer<typeof RoundIdSchema>;

export const ObligationIdSchema = z.object({ p_obligation_id: Id });
export type ObligationIdInput = z.infer<typeof ObligationIdSchema>;

export const PenaltyIdSchema = z.object({ p_penalty_id: Id });
export type PenaltyIdInput = z.infer<typeof PenaltyIdSchema>;

export const DeadlineSchema = z.object({
  p_round_id: Id,
  p_deadline_at: z.string().min(1),
  p_reason: Reason,
});
export type DeadlineInput = z.infer<typeof DeadlineSchema>;

export const ExceptionSchema = z.object({
  p_obligation_id: Id,
  p_excused: z.boolean(),
  p_reason: Reason,
});
export type ExceptionInput = z.infer<typeof ExceptionSchema>;

export const CloseSchema = z.object({ p_round_id: Id, p_reason: Reason });
export type CloseInput = z.infer<typeof CloseSchema>;

export const FinalizeSchema = z.object({
  p_round_id: Id,
  p_reason: z.string().trim().max(500).optional().nullable(),
});
export type FinalizeInput = z.infer<typeof FinalizeSchema>;

export const StudentSubmitSchema = z.object({
  p_obligation_id: Id,
  p_score: z.number().int().min(1).max(10),
  p_comment: z.string().trim().min(20, '평가 의견을 20자 이상 입력해주세요.'),
});
export type StudentSubmitInput = z.infer<typeof StudentSubmitSchema>;

export const WaivePenaltySchema = z.object({
  p_penalty_id: Id,
  p_reason: Reason,
});
export type WaivePenaltyInput = z.infer<typeof WaivePenaltySchema>;

export const CorrectReviewSchema = z.object({
  p_obligation_id: Id,
  p_score: z.number().int().min(1).max(10),
  p_comment: z.string().trim().min(20, '평가 의견을 20자 이상 입력해주세요.'),
  p_reason: Reason,
});
export type CorrectReviewInput = z.infer<typeof CorrectReviewSchema>;

export const CorrectExceptionSchema = ExceptionSchema;
export type CorrectExceptionInput = z.infer<typeof CorrectExceptionSchema>;
