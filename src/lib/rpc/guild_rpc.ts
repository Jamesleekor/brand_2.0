import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { validateInput } from '@/lib/zod_schemas/student_schemas';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import * as GuildSchemas from '@/lib/zod_schemas/guild_schemas';

export type GuildRpcResult<T> = RpcResult<T>;

async function safeGuildRpc<TInput, TOutput>(
  supabase: SupabaseClient,
  functionName: string,
  schema: z.ZodType<TInput>,
  input: unknown,
): Promise<RpcResult<TOutput>> {
  const validation = validateInput(schema, input);
  if (validation.success === false) {
    return { success: false, type: 'VALIDATION', error: validation.error, details: validation.details };
  }
  const { data, error } = await supabase.rpc(functionName, validation.data as Record<string, unknown>);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as TOutput };
}

export const guildTeacherRpc = {
  createGuild: (supabase: SupabaseClient, input: GuildSchemas.CreateGuildInput) =>
    safeGuildRpc<GuildSchemas.CreateGuildInput, number>(supabase, 'teacher_create_guild', GuildSchemas.CreateGuildSchema, input),

  updateGuildProfile: (supabase: SupabaseClient, input: GuildSchemas.UpdateGuildProfileInput) =>
    safeGuildRpc<GuildSchemas.UpdateGuildProfileInput, number>(supabase, 'teacher_update_guild_profile', GuildSchemas.UpdateGuildProfileSchema, input),

  assignGuildMember: (supabase: SupabaseClient, input: GuildSchemas.AssignGuildMemberInput) =>
    safeGuildRpc<GuildSchemas.AssignGuildMemberInput, { status: string; membership_id: number; guild_id: number; element?: string | null }>(supabase, 'teacher_assign_guild_member', GuildSchemas.AssignGuildMemberSchema, input),

  removeGuildMember: (supabase: SupabaseClient, input: GuildSchemas.RemoveGuildMemberInput) =>
    safeGuildRpc<GuildSchemas.RemoveGuildMemberInput, { status: string; membership_id: number; from_guild_id: number }>(supabase, 'teacher_remove_guild_member', GuildSchemas.RemoveGuildMemberSchema, input),

  createSeason: (supabase: SupabaseClient, input: GuildSchemas.CreateGuildSeasonInput) =>
    safeGuildRpc<GuildSchemas.CreateGuildSeasonInput, number>(supabase, 'teacher_create_guild_season', GuildSchemas.CreateGuildSeasonSchema, input),

  setSeasonStatus: (supabase: SupabaseClient, input: GuildSchemas.SetGuildSeasonStatusInput) =>
    safeGuildRpc<GuildSchemas.SetGuildSeasonStatusInput, number>(supabase, 'teacher_set_guild_season_status', GuildSchemas.SetGuildSeasonStatusSchema, input),

  createSession: (supabase: SupabaseClient, input: GuildSchemas.CreateGuildSessionInput) =>
    safeGuildRpc<GuildSchemas.CreateGuildSessionInput, number>(supabase, 'teacher_create_guild_session', GuildSchemas.CreateGuildSessionSchema, input),

  recordSessionAttendance: (supabase: SupabaseClient, input: GuildSchemas.RecordGuildSessionAttendanceInput) =>
    safeGuildRpc<GuildSchemas.RecordGuildSessionAttendanceInput, { session_id: number; updated: number }>(supabase, 'teacher_record_guild_session_attendance', GuildSchemas.RecordGuildSessionAttendanceSchema, input),

  setSessionStatus: (supabase: SupabaseClient, input: GuildSchemas.SetGuildSessionStatusInput) =>
    safeGuildRpc<GuildSchemas.SetGuildSessionStatusInput, number>(supabase, 'teacher_set_guild_session_status', GuildSchemas.SetGuildSessionStatusSchema, input),

  healthCheck: (supabase: SupabaseClient, input: GuildSchemas.Guild1HealthCheckInput) =>
    safeGuildRpc<GuildSchemas.Guild1HealthCheckInput, Record<string, unknown>>(supabase, 'teacher_guild1_health_check', GuildSchemas.Guild1HealthCheckSchema, input),
};

export function guildRpcError(result: unknown, fallback = '길드 작업을 완료하지 못했습니다.') {
  if (result && typeof result === 'object' && 'error' in result) {
    const value = (result as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}
