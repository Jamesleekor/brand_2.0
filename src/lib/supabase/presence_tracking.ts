// =====================================================================
// PRESENCE_MANUAL_TOGGLE_V1 (2026-10-01)
// 실시간 접속 표시(presence)는 기본 OFF.
// 선생님이 켰을 때만(기본 10분, 자동 만료) 학생 앱이 접속을 알린다.
// =====================================================================
import type { SupabaseClient } from '@supabase/supabase-js';

export type PresenceTrackingState = {
  enabled: boolean;
  enabledUntil: string | null;
};

const OFF: PresenceTrackingState = { enabled: false, enabledUntil: null };

function parseState(raw: unknown): PresenceTrackingState {
  const data = (raw ?? {}) as { enabled?: unknown; enabled_until?: unknown };
  const enabledUntil = typeof data.enabled_until === 'string' ? data.enabled_until : null;
  return { enabled: data.enabled === true && enabledUntil !== null, enabledUntil };
}

/** 켜져 있는지 확인. 실패하면 항상 OFF로 취급한다(안전한 쪽). */
export async function fetchPresenceTrackingState(supabase: SupabaseClient): Promise<PresenceTrackingState> {
  try {
    const { data, error } = await supabase.rpc('get_presence_tracking_state');
    if (error) return OFF;
    return parseState(data);
  } catch {
    return OFF;
  }
}

/** 선생님 전용: 켜기(분) / 끄기 */
export async function setPresenceTracking(
  supabase: SupabaseClient,
  classroomId: number,
  enabled: boolean,
  minutes = 10,
): Promise<PresenceTrackingState> {
  const { data, error } = await supabase.rpc('teacher_set_presence_tracking', {
    p_classroom_id: classroomId,
    p_enabled: enabled,
    p_minutes: minutes,
  });
  if (error) throw new Error(error.message || '실시간 접속 확인 설정을 바꾸지 못했습니다.');
  return parseState(data);
}
