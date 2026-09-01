import { z } from 'zod';

export const CharacterCollectionClassSchema = z.enum(['SMALL', 'STANDARD', 'LARGE']);

export const CharacterCollectionRewardInputSchema = z.object({
  effect_id: z.number().int().positive(),
  effect_value: z.number().positive('버프 효과값은 0보다 커야 합니다.'),
});

export const TeacherSaveCharacterCollectionSchema = z.object({
  p_classroom_id: z.number().int().positive(),
  p_collection_id: z.number().int().positive().nullable(),
  p_collection_uid: z.string().trim().regex(/^COLL-\d{3,}$/, 'UID는 COLL-### 형식이어야 합니다.'),
  p_name: z.string().trim().min(1, '콜렉션 이름을 입력해주세요.').max(140),
  p_description: z.string().trim().max(3000).nullable(),
  p_collection_class: CharacterCollectionClassSchema,
  p_is_active: z.boolean(),
  p_is_visible: z.boolean(),
  p_sort_order: z.number().int().min(0).max(99999),
  p_character_ids: z.array(z.number().int().positive()),
  p_rewards: z.array(CharacterCollectionRewardInputSchema),
}).superRefine((value, ctx) => {
  if (new Set(value.p_character_ids).size !== value.p_character_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_character_ids'], message: '같은 편린을 한 콜렉션에 중복으로 넣을 수 없습니다.' });
  }
  const effectIds = value.p_rewards.map((reward) => reward.effect_id);
  if (new Set(effectIds).size !== effectIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_rewards'], message: '같은 버프 종류를 한 콜렉션에 두 번 넣을 수 없습니다.' });
  }
  if (value.p_is_active && value.p_character_ids.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_character_ids'], message: '활성 콜렉션에는 하나 이상의 편린이 필요합니다.' });
  }
  if (value.p_is_active && value.p_rewards.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['p_rewards'], message: '활성 콜렉션에는 하나 이상의 버프가 필요합니다.' });
  }
});

export const TeacherPreviewCharacterCollectionSchema = z.object({
  p_classroom_id: z.number().int().positive(),
  p_character_ids: z.array(z.number().int().positive()),
});

export type CharacterCollectionClass = z.infer<typeof CharacterCollectionClassSchema>;
export type CharacterCollectionRewardInput = z.infer<typeof CharacterCollectionRewardInputSchema>;
export type TeacherSaveCharacterCollectionInput = z.infer<typeof TeacherSaveCharacterCollectionSchema>;
