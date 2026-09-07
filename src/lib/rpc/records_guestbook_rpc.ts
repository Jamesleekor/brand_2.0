import type { SupabaseClient } from '@supabase/supabase-js';

export type RecordsGuestbookEntry = {
  id: number;
  school_year: number;
  student_name: string;
  brand_name: string | null;
  message: string;
  created_at: string;
  updated_at: string;
  is_mine?: boolean;
};

export type RecordsGuestbookBoard = {
  current_school_year: number;
  can_write: boolean;
  total_count: number;
  limit: number;
  offset: number;
  my_entry: RecordsGuestbookEntry | null;
  rows: RecordsGuestbookEntry[];
};

export type RecordsGuestbookAdminEntry = RecordsGuestbookEntry & {
  classroom_id: number;
  student_id: number;
};

export type RecordsGuestbookAdminBoard = {
  total_count: number;
  limit: number;
  offset: number;
  rows: RecordsGuestbookAdminEntry[];
};

async function rpc<T>(
  client: SupabaseClient,
  functionName: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(functionName, args ?? {});
  if (error) throw error;
  return data as T;
}

export const recordsGuestbookRpc = {
  studentBoard(
    client: SupabaseClient,
    params: { p_limit?: number; p_offset?: number } = {},
  ) {
    return rpc<RecordsGuestbookBoard>(client, 'student_get_records_guestbook', {
      p_limit: params.p_limit ?? 200,
      p_offset: params.p_offset ?? 0,
    });
  },

  upsertStudentEntry(client: SupabaseClient, message: string) {
    return rpc<RecordsGuestbookEntry>(client, 'student_upsert_records_guestbook', {
      p_message: message,
    });
  },

  teacherBoard(
    client: SupabaseClient,
    params: { p_limit?: number; p_offset?: number } = {},
  ) {
    return rpc<RecordsGuestbookAdminBoard>(client, 'teacher_get_records_guestbook', {
      p_limit: params.p_limit ?? 200,
      p_offset: params.p_offset ?? 0,
    });
  },

  deleteTeacherEntry(client: SupabaseClient, entryId: number) {
    return rpc<boolean>(client, 'teacher_delete_records_guestbook', {
      p_entry_id: entryId,
    });
  },
};
