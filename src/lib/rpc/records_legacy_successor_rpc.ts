import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordsLegacyPathCode } from '@/lib/records_legacy_paths';

export type RecordsLegacyEventStatus = 'OPEN' | 'UNSEALED' | 'LOCKED' | 'INHERITED';

export type RecordsLegacyStudentState = {
  can_participate: boolean;
  event_status: RecordsLegacyEventStatus;
  minimum_successors: number;
  registered_count: number;
  seal_discovered_at: string | null;
  seal_confirmed_at: string | null;
  legacy_path_code: RecordsLegacyPathCode | null;
  legacy_statement: string | null;
  registered_at: string | null;
  unsealed_at: string | null;
  locked_at: string | null;
  inherited_at: string | null;
};

export type RecordsLegacyRegistrationResult = RecordsLegacyStudentState & {
  just_unsealed: boolean;
};

export type RecordsLegacyAdminRow = {
  student_id: number;
  student_name: string;
  brand_name: string | null;
  seal_discovered_at: string | null;
  seal_confirmed_at: string | null;
  legacy_path_code: RecordsLegacyPathCode | null;
  legacy_statement: string | null;
  registered_at: string | null;
};

export type RecordsLegacyAdminBoard = {
  event_status: RecordsLegacyEventStatus;
  minimum_successors: number;
  discovered_count: number;
  confirmed_count: number;
  registered_count: number;
  unsealed_at: string | null;
  locked_at: string | null;
  locked_successor_count: number | null;
  inherited_at: string | null;
  path_counts: Record<string, number>;
  rows: RecordsLegacyAdminRow[];
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

export const recordsLegacySuccessorRpc = {
  studentState(client: SupabaseClient) {
    return rpc<RecordsLegacyStudentState>(client, 'student_get_records_legacy_successor_state');
  },

  discoverSeal(client: SupabaseClient) {
    return rpc<RecordsLegacyStudentState>(client, 'student_discover_records_legacy_seal');
  },

  confirmSeal(client: SupabaseClient) {
    return rpc<RecordsLegacyStudentState>(client, 'student_confirm_records_legacy_seal');
  },

  register(
    client: SupabaseClient,
    pathCode: RecordsLegacyPathCode,
    statement: string,
  ) {
    return rpc<RecordsLegacyRegistrationResult>(client, 'student_register_records_legacy_successor', {
      p_path_code: pathCode,
      p_statement: statement,
    });
  },

  teacherBoard(client: SupabaseClient) {
    return rpc<RecordsLegacyAdminBoard>(client, 'teacher_get_records_legacy_successors');
  },

  teacherReset(client: SupabaseClient, studentId: number) {
    return rpc<RecordsLegacyAdminBoard>(client, 'teacher_reset_records_legacy_successor', {
      p_student_id: studentId,
    });
  },

  teacherLock(client: SupabaseClient) {
    return rpc<RecordsLegacyAdminBoard>(client, 'teacher_lock_records_legacy_successors');
  },

  teacherUnlock(client: SupabaseClient) {
    return rpc<RecordsLegacyAdminBoard>(client, 'teacher_unlock_records_legacy_successors');
  },
};

export const recordsLegacyStudentQueryKey = (studentId: number | null) =>
  ['records', 'legacy-successor', 'student', studentId] as const;
