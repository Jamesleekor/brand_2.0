import { z } from 'zod';

export const CharacterResourceKindSchema = z.enum(['EMOJI', 'IMAGE', 'ANIMATED_IMAGE']);
export const CharacterPolicyStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']);
export const CharacterRequirementModeSchema = z.enum(['NONE', 'GROUPS']);
export const CharacterRequirementTypeSchema = z.enum([
  'ACHIEVEMENT_COUNT',
  'ACHIEVEMENT_GRADE_COUNT',
  'TIER_AT_LEAST',
]);
export const CharacterAchievementGradeSchema = z.enum(['희귀', '유니크', '에픽', '히든', '유일', '초월']);

export const TeacherCharacterMasterFieldsSchema = z.object({
  p_name: z.string().trim().min(1, '편린 이름을 입력해주세요.').max(100),
  p_epithet: z.string().trim().max(160).nullable(),
  p_description: z.string().trim().max(3000).nullable(),
  p_resource_kind: CharacterResourceKindSchema,
  p_resource_url: z.string().trim().nullable(),
  p_emoji: z.string().trim().nullable(),
  p_full_image_url: z.string().trim().nullable(),
  p_card_image_url: z.string().trim().nullable(),
  p_avatar_image_url: z.string().trim().nullable(),
  p_is_active: z.boolean(),
  p_sort_order: z.number().int().min(0).max(9999),
}).superRefine((value, ctx) => {
  if (value.p_resource_kind === 'EMOJI') {
    if (!value.p_emoji) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_emoji'], message: '이모지를 입력해주세요.' });
  } else if (!value.p_resource_url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_resource_url'], message: '이미지 URL을 입력해주세요.' });
  }
});

export const TeacherCreateCharacterSchema = TeacherCharacterMasterFieldsSchema.and(z.object({
  p_classroom_id: z.number().int().positive(),
  p_character_uid: z.string().trim().regex(/^CHAR-\d{3}$/, 'UID는 CHAR-### 형식이어야 합니다.'),
}));

export const TeacherUpdateCharacterSchema = TeacherCharacterMasterFieldsSchema.and(z.object({
  p_character_id: z.number().int().positive(),
}));

export const CharacterRequirementInputSchema = z.object({
  type: CharacterRequirementTypeSchema,
  grade: CharacterAchievementGradeSchema.nullable(),
  required_numeric: z.number().int().min(1),
}).superRefine((value, ctx) => {
  if (value.type === 'ACHIEVEMENT_GRADE_COUNT' && !value.grade) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['grade'], message: '업적 등급을 선택해주세요.' });
  }
  if (value.type === 'TIER_AT_LEAST' && value.required_numeric > 22) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['required_numeric'], message: '티어 단계는 1~22입니다.' });
  }
});

export const CharacterRequirementGroupInputSchema = z.object({
  label: z.string().trim().max(100).nullable(),
  requirements: z.array(CharacterRequirementInputSchema).min(1, '각 조건 그룹에는 하나 이상의 조건이 필요합니다.'),
});

export const TeacherSetCharacterPolicySchema = z.object({
  p_classroom_id: z.number().int().positive(),
  p_character_id: z.number().int().positive(),
  p_status: CharacterPolicyStatusSchema,
  p_is_recruitable: z.boolean(),
  p_requirement_mode: CharacterRequirementModeSchema,
  p_source_condition_text: z.string().trim().max(1000).nullable(),
  p_groups: z.array(CharacterRequirementGroupInputSchema),
  p_notes: z.string().trim().max(1000).nullable(),
}).superRefine((value, ctx) => {
  if (value.p_status === 'ACTIVE' && !value.p_is_recruitable) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_is_recruitable'], message: 'ACTIVE 정책은 영입 가능 상태여야 합니다.' });
  }
  if (value.p_requirement_mode === 'NONE' && value.p_groups.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_groups'], message: '조건 없음 모드에서는 조건 그룹을 비워주세요.' });
  }
  if (value.p_requirement_mode === 'GROUPS' && value.p_groups.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_groups'], message: '하나 이상의 조건 그룹이 필요합니다.' });
  }
});

export const TeacherGrantCharacterSchema = z.object({
  p_student_id: z.number().int().positive(),
  p_character_id: z.number().int().positive(),
  p_reason: z.string().trim().max(500).nullable(),
});

export type TeacherCreateCharacterInput = z.infer<typeof TeacherCreateCharacterSchema>;
export type TeacherUpdateCharacterInput = z.infer<typeof TeacherUpdateCharacterSchema>;
export type TeacherSetCharacterPolicyInput = z.infer<typeof TeacherSetCharacterPolicySchema>;
export type CharacterRequirementInput = z.infer<typeof CharacterRequirementInputSchema>;
export type CharacterRequirementGroupInput = z.infer<typeof CharacterRequirementGroupInputSchema>;
