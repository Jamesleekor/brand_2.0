import { z } from 'zod';

export const NoArgsSchema = z.object({}).strict();

export const SubmitServiceReviewSchema = z.object({
  p_order_id: z.number().int().positive(),
  p_rating: z.number().int().min(0).max(10),
  p_review_text: z.string().trim().min(2).max(1000),
});
export type SubmitServiceReviewInput = z.infer<typeof SubmitServiceReviewSchema>;

export const TeacherServiceReviewBoardSchema = z.object({
  p_classroom_id: z.number().int().positive(),
});
export type TeacherServiceReviewBoardInput = z.infer<typeof TeacherServiceReviewBoardSchema>;

export const TeacherModerateServiceReviewSchema = z.object({
  p_review_id: z.number().int().positive(),
  p_review_visible: z.boolean(),
  p_rating_valid: z.boolean(),
  p_reason: z.string().trim().min(2).max(500),
});
export type TeacherModerateServiceReviewInput = z.infer<typeof TeacherModerateServiceReviewSchema>;
