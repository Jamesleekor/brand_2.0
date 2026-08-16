import type { SupabaseClient } from '@supabase/supabase-js';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import {
  TestFixturePasswordResetInputSchema,
  TestFixtureReconcileInputSchema,
  type TestFixturePasswordResetInput,
  type TestFixtureReconcileInput,
} from '@/lib/zod_schemas/test_fixture_schemas';

export interface TestFixtureStatus {
  fixture_exists: boolean;
  fixture_code: string;
  classroom_id?: number;
  classroom_name: string;
  season_id?: number;
  guild_id?: number;
  guild_name: string;
  test_student_count: number;
  linked_student_count: number;
  last_reset_at?: string | null;
}

export interface TestFixtureAccountResult {
  subject: 'TEST_TEACHER' | 'TEST01' | 'TEST02' | 'TEST03' | 'TEST04' | 'TEST05';
  email: string;
  created?: boolean;
}

export interface TestFixtureReconcileResult {
  status: 'RECONCILED';
  fixture: Record<string, unknown>;
  accounts: TestFixtureAccountResult[];
}

export interface TestFixturePasswordResetResult {
  status: 'PASSWORDS_RESET';
  fixture_code: string;
  emails: TestFixtureAccountResult[];
}

async function serverFailure(error: { message: string; context?: unknown }): Promise<RpcResult<never>> {
  let detail = error.message || 'TEST fixture 요청을 완료하지 못했어요.';
  if (error.context instanceof Response) {
    try {
      const responseBody = await error.context.clone().json() as { error?: string; detail?: string };
      detail = responseBody.detail || responseBody.error || detail;
    } catch {
      // HTTP response body is optional; preserve the generic SDK message.
    }
  }
  return {
    success: false,
    type: 'SERVER',
    error: detail,
  };
}

export const testFixtureRpc = {
  async getStatus(client: SupabaseClient): Promise<RpcResult<TestFixtureStatus>> {
    const { data, error } = await client.rpc('teacher_get_test_classroom_fixture_status');
    if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
    return { success: true, data: data as TestFixtureStatus };
  },

  async reset(client: SupabaseClient): Promise<RpcResult<Record<string, unknown>>> {
    const { data, error } = await client.rpc('teacher_reset_test_classroom_fixture');
    if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
    return { success: true, data: data as Record<string, unknown> };
  },

  async reconcile(client: SupabaseClient, input: unknown): Promise<RpcResult<TestFixtureReconcileResult>> {
    const validation = validateInput(TestFixtureReconcileInputSchema, input);
    if (validation.success === false) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };

    const { data, error } = await client.functions.invoke<TestFixtureReconcileResult>('test-classroom-fixture', {
      body: { action: 'reconcile', initialPassword: (validation.data as TestFixtureReconcileInput).initialPassword },
    });
    if (error) return await serverFailure(error);
    if (!data || data.status !== 'RECONCILED') return { success: false, type: 'SERVER', error: 'TEST fixture 서버가 올바른 결과를 반환하지 않았어요.' };
    return { success: true, data };
  },

  async resetPasswords(client: SupabaseClient, input: unknown): Promise<RpcResult<TestFixturePasswordResetResult>> {
    const validation = validateInput(TestFixturePasswordResetInputSchema, input);
    if (validation.success === false) return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };

    const { data, error } = await client.functions.invoke<TestFixturePasswordResetResult>('test-classroom-fixture', {
      body: { action: 'reset_passwords', newPassword: (validation.data as TestFixturePasswordResetInput).newPassword },
    });
    if (error) return await serverFailure(error);
    if (!data || data.status !== 'PASSWORDS_RESET') return { success: false, type: 'SERVER', error: 'TEST fixture 서버가 올바른 결과를 반환하지 않았어요.' };
    return { success: true, data };
  },
};

export function testFixtureErrorMessage(error: { type: string; code?: string; error: string }): string {
  const messages: Record<string, string> = {
    P0600: 'TEST fixture에 필요한 Guild 또는 Arcade 구조가 아직 적용되지 않았어요.',
    P0601: '교사 권한 확인 기능을 찾지 못했어요.',
    P0603: 'TEST 학생의 길드 소속이 바뀌어 있어요. 먼저 TEST 초기화를 실행해주세요.',
    P0611: '현재 교사 계정의 기준 학급을 하나로 판단할 수 없어요.',
    P0613: 'TEST fixture 표식과 기본 데이터가 맞지 않아요. 자동 수정은 중단했어요.',
    P0614: '표식 없는 B.R.A.N.D TEST 학급이 이미 있어요. 안전을 위해 자동 사용하지 않아요.',
    P0615: '실제 학급의 활성 Guild 시즌을 먼저 확인해주세요.',
    P0619: '등록된 TEST fixture를 찾지 못해 초기화를 중단했어요.',
    P0620: 'TEST fixture 기본 데이터가 맞지 않아 초기화를 중단했어요.',
    P0621: '일부 TEST 기록을 지우지 못해 전체 초기화를 취소했어요.',
  };
  if (messages[error.code ?? '']) return messages[error.code ?? ''];
  return error.type === 'VALIDATION'
    ? error.error
    : `요청을 완료하지 못했어요. ${error.error}`;
}
