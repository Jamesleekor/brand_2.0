import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const archiveMonthSchema = z.object({
  month: z.number().int().min(3).max(11),
  status: z.enum(['available', 'partial', 'record_lost', 'unregistered']),
  note: z.string().nullable(),
  carried_from_month: z.number().int().nullable(),
});

const archiveEntrySchema = z.object({
  month: z.number().int().min(3).max(11),
  job_key: z.string().min(1),
  job_name: z.string().min(1),
  student_id: z.number().int().nullable(),
  student_name: z.string().nullable(),
  assignment_status: z.enum(['confirmed', 'pending']),
  daily_wage: z.number().int().nonnegative().nullable(),
  note: z.string().nullable(),
});

export const primaryJobArchiveSchema = z.object({
  classroom_id: z.number().int(),
  school_year: z.number().int(),
  current_month: z.number().int().min(1).max(12),
  my_student_id: z.number().int().nullable(),
  months: z.array(archiveMonthSchema),
  entries: z.array(archiveEntrySchema),
});

export type PrimaryJobArchive = z.infer<typeof primaryJobArchiveSchema>;
export type PrimaryJobArchiveMonth = z.infer<typeof archiveMonthSchema>;
export type PrimaryJobArchiveEntry = z.infer<typeof archiveEntrySchema>;

export async function getPrimaryJobArchive(client: SupabaseClient): Promise<PrimaryJobArchive> {
  const { data, error } = await client.rpc('get_primary_job_archive');
  if (error) throw new Error('1인1역 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const result = primaryJobArchiveSchema.safeParse(data);
  if (!result.success) throw new Error('1인1역 기록을 확인하지 못했습니다. 운영국에 알려 주세요.');
  return result.data;
}
