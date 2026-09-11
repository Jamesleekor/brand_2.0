import type { SupabaseClient } from '@supabase/supabase-js';

export type AppAccessSource = 'APP_OPEN' | 'SESSION_RESTORE' | 'EXPLICIT_LOGIN' | 'APP_RESUME';

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

let requestInFlight = false;
let lastSignalAt = 0;

/** Best-effort analytics only. Access logging must never block authentication/navigation. */
export async function recordAppAccessEvent(
  supabase: SupabaseClient,
  source: AppAccessSource,
): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  // Suppress only overlapping StrictMode/auth callbacks in the same runtime.
  // A full reload resets this guard, and the server decides canonical visits.
  const now = Date.now();
  if (requestInFlight || now - lastSignalAt < 5_000) return;
  requestInFlight = true;
  lastSignalAt = now;

  try {
    const { error } = await supabase.rpc('record_app_access_event', {
      p_source: source,
      p_device_type: detectDeviceType(),
      p_browser: detectBrowser(),
    });
    if (error) console.warn(`[app-access-v2] ${source} 기록 실패`, error);
  } catch (error) {
    console.warn(`[app-access-v2] ${source} 기록 중 예외`, error);
  } finally {
    requestInFlight = false;
  }
}
