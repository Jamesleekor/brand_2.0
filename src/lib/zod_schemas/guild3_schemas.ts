import { z } from 'zod';

const Id = z.number().int().positive();
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식이어야 합니다.');
const Timestamp = z.string().min(1);
const OptionalText = z.string().max(4000).optional().nullable();
const Reason = z.string().trim().min(2, '사유를 2자 이상 입력해주세요.').max(500);

export const SubmissionScopeSchema = z.enum(['GUILD', 'INDIVIDUAL', 'NONE']);
export const SubmissionRequirementSchema = z.enum(['REQUIRED', 'OPTIONAL', 'NONE']);
export const GuildResultSchema = z.enum(['CLEARED', 'FAILED']);
export const GradeSchema = z.enum(['S', 'A', 'B', 'C', 'F']);

const MissionCoreSchema = z.object({
  p_contribution_year_month: Month,
  p_title: z.string().trim().min(1).max(200),
  p_teaser_visible: z.boolean(),
  p_teaser_title: z.string().max(200).optional().nullable(),
  p_description: OptionalText,
  p_student_success_criteria: OptionalText,
  p_teacher_guidance: OptionalText,
  p_weight: z.number().positive().max(1000),
  p_submission_scope: SubmissionScopeSchema,
  p_submission_requirement: SubmissionRequirementSchema,
  p_due_at: Timestamp,
  p_activity_record_due_at: Timestamp.optional().nullable(),
  p_peer_review_required: z.boolean(),
});

type MissionCoreInput = z.infer<typeof MissionCoreSchema>;

const validateSubmissionCombo = (value: MissionCoreInput, ctx: z.RefinementCtx) => {
  const valid =
    (value.p_submission_scope === 'NONE' && value.p_submission_requirement === 'NONE') ||
    (value.p_submission_scope !== 'NONE' && value.p_submission_requirement !== 'NONE');
  if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_submission_requirement'], message: '제출 없음은 NONE+NONE 조합만 가능합니다.' });
};

export const CreateMissionSchema = MissionCoreSchema.superRefine(validateSubmissionCombo);
export type CreateMissionInput = z.infer<typeof CreateMissionSchema>;

export const UpdateMissionDraftSchema = MissionCoreSchema.extend({ p_mission_id: Id }).superRefine(validateSubmissionCombo);
export type UpdateMissionDraftInput = z.infer<typeof UpdateMissionDraftSchema>;

export const UpdateMissionPresentationSchema = z.object({
  p_mission_id: Id,
  p_title: z.string().trim().min(1).max(200),
  p_teaser_visible: z.boolean(),
  p_teaser_title: z.string().max(200).optional().nullable(),
  p_description: OptionalText,
  p_student_success_criteria: OptionalText,
  p_teacher_guidance: OptionalText,
  p_due_at: Timestamp,
  p_activity_record_due_at: Timestamp,
  p_reason: Reason,
});
export type UpdateMissionPresentationInput = z.infer<typeof UpdateMissionPresentationSchema>;

export const MissionIdSchema = z.object({ p_mission_id: Id });
export type MissionIdInput = z.infer<typeof MissionIdSchema>;
export const MissionReasonSchema = z.object({ p_mission_id: Id, p_reason: Reason });
export type MissionReasonInput = z.infer<typeof MissionReasonSchema>;
export const MissionFinalizeSchema = z.object({ p_mission_id: Id, p_missing_required_submission_override_reason: z.string().max(500).optional().nullable() });
export type MissionFinalizeInput = z.infer<typeof MissionFinalizeSchema>;
export const MissionDetailSchema = z.object({ p_mission_id: Id });
export type MissionDetailInput = z.infer<typeof MissionDetailSchema>;

export const InstanceResultSchema = z.object({ p_mission_instance_id: Id, p_guild_result: GuildResultSchema, p_reason: z.string().max(500).optional().nullable() });
export type InstanceResultInput = z.infer<typeof InstanceResultSchema>;
export const CorrectInstanceResultSchema = z.object({ p_mission_instance_id: Id, p_guild_result: GuildResultSchema, p_reason: Reason });
export type CorrectInstanceResultInput = z.infer<typeof CorrectInstanceResultSchema>;
export const InstanceNoteSchema = z.object({ p_mission_instance_id: Id, p_special_rule_note: z.string().max(1000).optional().nullable() });
export type InstanceNoteInput = z.infer<typeof InstanceNoteSchema>;

export const ParticipantGradeSchema = z.object({ p_participant_id: Id, p_grade: GradeSchema, p_override_reason: z.string().max(500).optional().nullable() });
export type ParticipantGradeInput = z.infer<typeof ParticipantGradeSchema>;
export const CorrectParticipantGradeSchema = z.object({ p_participant_id: Id, p_grade: GradeSchema, p_override_reason: z.string().max(500).optional().nullable(), p_correction_reason: Reason });
export type CorrectParticipantGradeInput = z.infer<typeof CorrectParticipantGradeSchema>;

export const StudentSubmitSchema = z.object({ p_mission_id: Id, p_content: z.string().trim().min(1).max(5000), p_reference_url: z.string().trim().max(1000).optional().nullable() });
export type StudentSubmitInput = z.infer<typeof StudentSubmitSchema>;
export const StudentActivitySchema = z.object({ p_mission_id: Id, p_content: z.string().trim().min(20, '20자 이상 구체적으로 적어주세요.').max(500, '500자 이하로 적어주세요.') });
export type StudentActivityInput = z.infer<typeof StudentActivitySchema>;

export const NoArgsSchema = z.object({}).strict();
