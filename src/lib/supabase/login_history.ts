import type { SupabaseClient } from '@supabase/supabase-js';

export type TrustedLoginEventType = 'LOGIN_SUCCESS' | 'LOGOUT';

function detectDeviceType(): string | null {
  if (typeof navigator === 'undefined') return null;

  const ua = navigator.userAgent;
  const platform = navigator.platform ?? '';

  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android' : 'Android Tablet';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Unknown';
}

function detectBrowser(): string | null {
  if (typeof navigator === 'undefined') return null;

  const ua = navigator.userAgent;

  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua) || /CriOS\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && !/Chrome|CriOS|Chromium/i.test(ua)) return 'Safari';
  return 'Unknown';
}

/**
 * 로그인 히스토리는 인증 기능보다 우선할 수 없다.
 * 기록 RPC 오류는 경고만 남기고 로그인/로그아웃 흐름을 계속 진행한다.
 */
export async function recordTrustedLoginEvent(
  supabase: SupabaseClient,
  eventType: TrustedLoginEventType,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_login_event', {
      p_event_type: eventType,
      p_device_type: detectDeviceType(),
      p_browser: detectBrowser(),
    });

    if (error) {
      console.warn(`[login-history] ${eventType} 기록 실패`, error);
    }
  } catch (error) {
    console.warn(`[login-history] ${eventType} 기록 중 예외`, error);
  }
}
