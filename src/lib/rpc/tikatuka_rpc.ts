import type { SupabaseClient } from '@supabase/supabase-js';
import { z, type ZodType } from 'zod';
import {
  StudentCreateTikatukaGameSchema,
  StudentSubmitTikatukaResultSchema,
  TeacherSetTikatukaProgressSchema,
  TeacherTikatukaProgressItemSchema,
  TeacherTikatukaProgressListSchema,
  TikatukaIssuedGameSchema,
  TikatukaProgressSchema,
  TikatukaSubmissionResponseSchema,
  type StudentCreateTikatukaGameInput,
  type StudentSubmitTikatukaResultInput,
  type TeacherSetTikatukaProgressInput,
  type TeacherTikatukaProgressItem,
  type TeacherTikatukaProgressList,
  type TikatukaIssuedGame,
  type TikatukaProgress,
  type TikatukaSubmissionResponse,
} from '@/lib/zod_schemas/tikatuka_schemas';
import {
  StudentStartTikatukaOfficialChallengeSchema,
  TikatukaCompetitionSchema,
  type StudentStartTikatukaOfficialChallengeInput,
  type TikatukaCompetition,
} from '@/lib/zod_schemas/tikatuka_competition_schemas';

export interface TikatukaRpcError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

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

  async getCompetition(client: SupabaseClient): Promise<TikatukaRpcResult<TikatukaCompetition>> {
    return callTikatukaRpc(client, 'student_get_tikatuka_competition_v1', TikatukaCompetitionSchema);
  },

  async startOfficialChallenge(
    client: SupabaseClient,
    input: StudentStartTikatukaOfficialChallengeInput,
  ): Promise<TikatukaRpcResult<TikatukaCompetition>> {
    const parsed = StudentStartTikatukaOfficialChallengeSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error, 'TIKATUKA_INVALID_OFFICIAL_INPUT');
    return callTikatukaRpc(client, 'student_start_tikatuka_official_challenge_v1', TikatukaCompetitionSchema, parsed.data);
  },
};

export const tikatukaTeacherRpc = {
  async listProgress(client: SupabaseClient): Promise<TikatukaRpcResult<TeacherTikatukaProgressList>> {
    return callTikatukaRpc(client, 'teacher_get_tikatuka_progress_v1', TeacherTikatukaProgressListSchema);
  },

  async setProgress(
    client: SupabaseClient,
    input: TeacherSetTikatukaProgressInput,
  ): Promise<TikatukaRpcResult<TeacherTikatukaProgressItem>> {
    const parsed = TeacherSetTikatukaProgressSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error, 'TIKATUKA_INVALID_TEACHER_INPUT');
    return callTikatukaRpc(client, 'teacher_set_tikatuka_progress_v1', TeacherTikatukaProgressItemSchema, parsed.data);
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
    case 'PTK30': return '라카루카 교사 관리 기능에 필요한 서버 구성이 아직 적용되지 않았습니다.';
    case 'PTK31': return '교사 로그인 또는 담당 학급 정보를 확인할 수 없습니다.';
    case 'PTK32': return '현재 학급에서 관리할 수 있는 학생을 찾을 수 없습니다.';
    case 'PTK33': return '해금 난이도는 Lv.1부터 Lv.10 사이여야 합니다.';
    case 'PTK40': return '라카루카 랭킹 기능에 필요한 서버 구성이 아직 적용되지 않았습니다.';
    case 'PTK41': return '공인 기록 도전 난이도가 올바르지 않습니다.';
    case 'PTK42': return '이미 진행 중인 공인 기록 도전이 있습니다. 현재 5판을 먼저 완료해주세요.';
    case 'PTK43': return '공인 기록 도전이 진행 중입니다. 공인 도전에서 선택한 난이도로만 플레이할 수 있습니다.';
    case 'TIKATUKA_INVALID_TEACHER_INPUT': return '학생 또는 해금 난이도 값이 올바르지 않습니다.';
    case 'TIKATUKA_INVALID_OFFICIAL_INPUT': return '공인 기록 도전 난이도 값이 올바르지 않습니다.';
    case 'TIKATUKA_INVALID_SERVER_RESPONSE':
      return '라카루카 서버 응답 형식이 올바르지 않습니다. 새 게임을 시작하지 말고 다시 시도해주세요.';
    default:
      return error.message || '라카루카 서버 요청을 처리하지 못했습니다.';
  }
}
