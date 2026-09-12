import type { SupabaseClient } from '@supabase/supabase-js';
import { z, type ZodType } from 'zod';
import {
  StudentCreateTikatukaGameSchema,
  StudentSubmitTikatukaResultSchema,
  TikatukaIssuedGameSchema,
  TikatukaProgressSchema,
  TikatukaSubmissionResponseSchema,
  type StudentCreateTikatukaGameInput,
  type StudentSubmitTikatukaResultInput,
  type TikatukaIssuedGame,
  type TikatukaProgress,
  type TikatukaSubmissionResponse,
} from '@/lib/zod_schemas/tikatuka_schemas';

export interface TikatukaRpcError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

// The app tsconfig currently has strict=false. Keeping both union keys present as optional
// makes the result ergonomic under those control-flow rules while `success` remains the
// authoritative runtime discriminator. No success response carries an actual error value.
export type TikatukaRpcResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: TikatukaRpcError; data?: undefined };

function validationError(error: z.ZodError, code: string): TikatukaRpcResult<never> {
  return {
    success: false,
    error: {
      code,
      message: error.issues.map((issue) => issue.message).join(' · '),
      details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
    },
  };
}

function databaseError(error: { code?: string; message: string; details?: string | null; hint?: string | null }): TikatukaRpcResult<never> {
  return {
    success: false,
    error: {
      code: error.code ?? 'TIKATUKA_RPC_ERROR',
      message: error.message,
      details: error.details ?? null,
      hint: error.hint ?? null,
    },
  };
}

async function callTikatukaRpc<TOutput>(
  client: SupabaseClient,
  functionName: string,
  outputSchema: ZodType<TOutput>,
  input?: Record<string, unknown>,
): Promise<TikatukaRpcResult<TOutput>> {
  const { data, error } = input
    ? await client.rpc(functionName, input)
    : await client.rpc(functionName);

  if (error) return databaseError(error);

  const parsed = outputSchema.safeParse(data);
  if (!parsed.success) return validationError(parsed.error, 'TIKATUKA_INVALID_SERVER_RESPONSE');
  return { success: true, data: parsed.data };
}

export const tikatukaStudentRpc = {
  async getProgress(client: SupabaseClient): Promise<TikatukaRpcResult<TikatukaProgress>> {
    return callTikatukaRpc(client, 'student_get_tikatuka_progress', TikatukaProgressSchema);
  },

  async createGame(
    client: SupabaseClient,
    input: StudentCreateTikatukaGameInput,
  ): Promise<TikatukaRpcResult<TikatukaIssuedGame>> {
    const parsed = StudentCreateTikatukaGameSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error, 'TIKATUKA_INVALID_CREATE_INPUT');
    return callTikatukaRpc(client, 'student_create_tikatuka_game', TikatukaIssuedGameSchema, parsed.data);
  },

  async submitResult(
    client: SupabaseClient,
    input: StudentSubmitTikatukaResultInput,
  ): Promise<TikatukaRpcResult<TikatukaSubmissionResponse>> {
    const parsed = StudentSubmitTikatukaResultSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error, 'TIKATUKA_INVALID_RESULT_INPUT');
    return callTikatukaRpc(client, 'student_submit_tikatuka_result', TikatukaSubmissionResponseSchema, parsed.data);
  },
};

export function tikatukaRpcErrorMessage(result: TikatukaRpcResult<unknown>): string {
  const error = result.error;
  if (!error) return '라카루카 서버 요청을 처리하지 못했습니다.';

  switch (error.code) {
    case 'PTK01': return '학생 로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.';
    case 'PTK02': return '선택한 난이도가 올바르지 않습니다.';
    case 'PTK03': return '아직 해금되지 않은 난이도입니다.';
    case 'PTK04': return '이 라카루카 게임 기록을 서버에서 찾을 수 없습니다.';
    case 'PTK05': return '같은 게임 식별값으로 서로 다른 결과가 제출되었습니다. 기록을 저장하지 않았습니다.';
    case 'PTK06': return '게임 엔진 버전이 서버와 일치하지 않습니다.';
    case 'PTK07': return '시작한 난이도와 제출한 난이도가 일치하지 않습니다.';
    case 'PTK08':
    case 'PTK09':
    case 'PTK10':
    case 'PTK11':
    case 'PTK12':
    case 'PTK13':
    case 'PTK14':
    case 'PTK15':
      return '게임 결과 검증에 실패했습니다. 이 결과로 난이도를 해금하지 않았습니다.';
    case 'TIKATUKA_INVALID_SERVER_RESPONSE':
      return '라카루카 서버 응답 형식이 올바르지 않습니다. 새 게임을 시작하지 말고 다시 시도해주세요.';
    default:
      return error.message || '라카루카 서버 요청을 처리하지 못했습니다.';
  }
}
