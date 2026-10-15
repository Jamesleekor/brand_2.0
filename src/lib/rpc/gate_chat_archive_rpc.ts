import { z } from 'zod';
import { supabase } from '@/lib/supabase/client';

const countSchema = z.object({
  student_id: z.number(), student_name: z.string(), character_id: z.number(),
  character_name: z.string(), character_uid: z.string(), turn_count: z.number(),
  message_count: z.number(), last_at: z.string(),
});
const turnSchema = z.object({
  turn_id: z.number(), student_id: z.number(), student_name: z.string(),
  character_id: z.number(), character_name: z.string(), character_uid: z.string(),
  request_id: z.string().nullable(), created_at: z.string(), student_content: z.string(),
  reply_at: z.string().nullable(), reply_content: z.string().nullable(),
  student_message_id: z.number(), reply_message_id: z.number().nullable(),
  moderation_severity: z.string().nullable(), affinity_delta: z.number().nullable(), is_aborted: z.boolean().nullable(),
});
const pageSchema = z.object({ items: z.array(turnSchema), has_more: z.boolean(),
  next_before_id: z.number().nullable(), snapshot_id: z.number() });
export type ArchiveCount = z.infer<typeof countSchema>;
export type ArchiveTurn = z.infer<typeof turnSchema>;
export type ArchivePage = z.infer<typeof pageSchema>;
export type ArchiveFilters = { classroomId: number; from: string; to: string; search: string };

export function archiveArgs(f: ArchiveFilters) {
  return { p_classroom_id: f.classroomId,
    p_from: f.from ? new Date(`${f.from}T00:00:00+09:00`).toISOString() : null,
    p_to: f.to ? new Date(new Date(`${f.to}T00:00:00+09:00`).getTime() + 86400000).toISOString() : null,
    p_search: f.search.trim() || null };
}
async function read<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`대화 기록 조회 실패: ${error.message}`);
  const result = schema.safeParse(data);
  if (!result.success) throw new Error('대화 기록 응답 형식이 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.');
  return result.data;
}
export const gateChatArchiveRpc = {
  index: (f: ArchiveFilters) => read('teacher_gate_chat_archive_index', archiveArgs(f), z.object({ rows: z.array(countSchema) })),
  page: (f: ArchiveFilters, studentId: number | null, characterId: number | null,
    before: number | null = null, snapshot: number | null = null, limit = 20, focus: number | null = null) =>
    read('teacher_gate_chat_archive_page', { ...archiveArgs(f), p_student_id: studentId,
      p_character_id: characterId, p_before_id: before, p_limit: limit, p_snapshot_id: snapshot, p_focus_id: focus }, pageSchema),
};
