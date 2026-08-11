import { z } from 'zod';

const PositiveInt = z.number().int().positive();
const OptionalText = z.string().trim().max(500).optional().nullable();
export const GuildElementCodeSchema = z.enum(['EARTH', 'WATER', 'LIGHT', 'WIND', 'FIRE', 'DARK']);
const Element = GuildElementCodeSchema;
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다.');

export const CreateGuildSchema = z.object({
  p_name: z.string().trim().min(1).max(50),
  p_slogan: z.string().trim().max(120).optional().nullable(),
  p_description: z.string().trim().max(1000).optional().nullable(),
  p_logo_url: z.string().trim().url().optional().nullable().or(z.literal('')),
  p_is_active: z.boolean(),
});
export type CreateGuildInput = z.infer<typeof CreateGuildSchema>;

export const UpdateGuildProfileSchema = z.object({
  p_guild_id: PositiveInt,
  p_name: z.string().trim().min(1).max(50),
  p_slogan: z.string().trim().max(120).optional().nullable(),
  p_description: z.string().trim().max(1000).optional().nullable(),
  p_logo_url: z.string().trim().url().optional().nullable().or(z.literal('')),
  p_is_active: z.boolean(),
});
export type UpdateGuildProfileInput = z.infer<typeof UpdateGuildProfileSchema>;

export const AssignGuildMemberSchema = z.object({
  p_student_id: PositiveInt,
  p_guild_id: PositiveInt,
  p_element: Element,
  p_reason: z.string().trim().min(2).max(300),
  p_effective_at: z.string().datetime({ offset: true }).optional(),
});
export type AssignGuildMemberInput = z.infer<typeof AssignGuildMemberSchema>;

export const RemoveGuildMemberSchema = z.object({
  p_student_id: PositiveInt,
  p_reason: z.string().trim().min(2).max(300),
  p_effective_at: z.string().datetime({ offset: true }).optional(),
});
export type RemoveGuildMemberInput = z.infer<typeof RemoveGuildMemberSchema>;

export const CreateGuildSeasonSchema = z.object({
  p_classroom_id: PositiveInt,
  p_display_name: z.string().trim().min(1).max(80),
  p_school_year: z.number().int().min(2020).max(2100),
  p_starts_on: IsoDate,
  p_ends_on: IsoDate,
  p_activate_now: z.boolean(),
}).refine((v) => v.p_ends_on >= v.p_starts_on, {
  message: '시즌 종료일은 시작일 이후여야 합니다.',
  path: ['p_ends_on'],
});
export type CreateGuildSeasonInput = z.infer<typeof CreateGuildSeasonSchema>;

export const SetGuildSeasonStatusSchema = z.object({
  p_season_id: PositiveInt,
  p_status: z.enum(['PLANNED', 'ACTIVE', 'CLOSED']),
});
export type SetGuildSeasonStatusInput = z.infer<typeof SetGuildSeasonStatusSchema>;

export const CreateGuildSessionSchema = z.object({
  p_classroom_id: PositiveInt,
  p_title: z.string().trim().min(1).max(100),
  p_session_date: IsoDate,
  p_note: OptionalText,
});
export type CreateGuildSessionInput = z.infer<typeof CreateGuildSessionSchema>;

export const GuildSessionAttendanceRecordSchema = z.object({
  student_id: PositiveInt,
  status: z.enum(['UNMARKED', 'PRESENT', 'ABSENT', 'EXCUSED']),
  note: z.string().trim().max(300).optional().nullable(),
});
export const RecordGuildSessionAttendanceSchema = z.object({
  p_session_id: PositiveInt,
  p_records: z.array(GuildSessionAttendanceRecordSchema).min(1).max(100),
}).superRefine((value, ctx) => {
  const seen = new Set<number>();
  value.p_records.forEach((row, index) => {
    if (seen.has(row.student_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['p_records', index, 'student_id'],
        message: '같은 학생의 길드 세션 참석 기록이 중복되었습니다.',
      });
    }
    seen.add(row.student_id);
  });
});
export type RecordGuildSessionAttendanceInput = z.infer<typeof RecordGuildSessionAttendanceSchema>;

export const SetGuildSessionStatusSchema = z.object({
  p_session_id: PositiveInt,
  p_status: z.enum(['OPEN', 'CLOSED']),
});
export type SetGuildSessionStatusInput = z.infer<typeof SetGuildSessionStatusSchema>;

export const Guild1HealthCheckSchema = z.object({
  p_classroom_id: PositiveInt,
});
export type Guild1HealthCheckInput = z.infer<typeof Guild1HealthCheckSchema>;
