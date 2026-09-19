import { z } from 'zod';

export const CharacterRecruitmentModeSchema = z.enum([
  'CRYSTAL',
  'FREE',
  'TEACHER_ONLY',
  'EVENT_ONLY',
  'UNAVAILABLE',
]);

export const CharacterRecruitmentDiscountStatusSchema = z.enum([
  'NONE',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
]);

export const TeacherSetCharacterRecruitmentOfferSchema = z.object({
  p_classroom_id: z.number().int().positive(),
  p_character_id: z.number().int().positive(),
  p_acquisition_mode: CharacterRecruitmentModeSchema,
  p_base_price_crystal: z.number().int().min(0).max(10_000_000),
  p_is_active: z.boolean(),
  p_notes: z.string().trim().max(1000).nullable(),
  p_discount_rate: z.number().int().min(0).max(99),
  p_discount_start_at: z.string().datetime({ offset: true }).nullable(),
  p_discount_end_at: z.string().datetime({ offset: true }).nullable(),
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

  if (value.p_discount_rate > 0) {
    if (value.p_acquisition_mode !== 'CRYSTAL') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['p_discount_rate'],
        message: '기간 할인은 크리스탈 영입에만 설정할 수 있습니다.',
      });
    }
    if (!value.p_discount_start_at || !value.p_discount_end_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['p_discount_start_at'],
        message: '할인 시작일시와 종료일시를 모두 입력해주세요.',
      });
    } else if (new Date(value.p_discount_start_at).getTime() >= new Date(value.p_discount_end_at).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['p_discount_end_at'],
        message: '할인 종료일시는 시작일시보다 늦어야 합니다.',
      });
    }
  } else if (value.p_discount_start_at !== null || value.p_discount_end_at !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['p_discount_rate'],
      message: '할인율이 0%이면 할인 기간을 설정하지 않습니다.',
    });
  }
});

export const RecruitCharacterSchema = z.object({
  p_character_id: z.number().int().positive(),
});

export type CharacterRecruitmentMode = z.infer<typeof CharacterRecruitmentModeSchema>;
export type CharacterRecruitmentDiscountStatus = z.infer<typeof CharacterRecruitmentDiscountStatusSchema>;
export type TeacherSetCharacterRecruitmentOfferInput = z.infer<typeof TeacherSetCharacterRecruitmentOfferSchema>;
