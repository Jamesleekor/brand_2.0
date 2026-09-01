import { z } from 'zod';

export const CharacterRecruitmentModeSchema = z.enum([
  'CRYSTAL',
  'FREE',
  'TEACHER_ONLY',
  'EVENT_ONLY',
  'UNAVAILABLE',
]);

export const TeacherSetCharacterRecruitmentOfferSchema = z.object({
  p_classroom_id: z.number().int().positive(),
  p_character_id: z.number().int().positive(),
  p_acquisition_mode: CharacterRecruitmentModeSchema,
  p_base_price_crystal: z.number().int().min(0).max(10_000_000),
  p_is_active: z.boolean(),
  p_notes: z.string().trim().max(1000).nullable(),
}).superRefine((value, ctx) => {
  if (value.p_acquisition_mode === 'CRYSTAL' && value.p_base_price_crystal < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['p_base_price_crystal'],
      message: '크리스탈 영입 가격은 1 이상이어야 합니다.',
    });
  }
  if (value.p_acquisition_mode !== 'CRYSTAL' && value.p_base_price_crystal !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['p_base_price_crystal'],
      message: '크리스탈 영입이 아닌 방식의 가격은 0이어야 합니다.',
    });
  }
  if (value.p_acquisition_mode === 'UNAVAILABLE' && value.p_is_active) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['p_is_active'],
      message: '미설정/중지 상태는 활성화할 수 없습니다.',
    });
  }
});

export const RecruitCharacterSchema = z.object({
  p_character_id: z.number().int().positive(),
});

export type CharacterRecruitmentMode = z.infer<typeof CharacterRecruitmentModeSchema>;
export type TeacherSetCharacterRecruitmentOfferInput = z.infer<typeof TeacherSetCharacterRecruitmentOfferSchema>;
