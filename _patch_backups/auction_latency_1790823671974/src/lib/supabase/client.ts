import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ENV_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
const LEGACY_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

// Emergency production fallback for B.R.A.N.D 2.0.
// Supabase publishable keys are designed to be embedded in public browser clients.
// Prefer an explicit VITE_SUPABASE_PUBLISHABLE_KEY when deployment settings are updated.
const BRAND_PRODUCTION_PUBLISHABLE_KEY = 'sb_publishable_fUWCCuMGv3JJY5YmRlenwQ_nJiZ3AEA'
const SUPABASE_PUBLIC_KEY = ENV_PUBLISHABLE_KEY || BRAND_PRODUCTION_PUBLISHABLE_KEY || LEGACY_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
  throw new Error('.env.local에 VITE_SUPABASE_URL과 Supabase publishable/anon key를 설정하세요.')
}

// Prevent one browser from flooding PostgREST with dozens of simultaneous
// background reads. Game submissions / run creation and live auction bids stay
// on the fast path; ordinary REST work is locally back-pressured.
const MAX_BACKGROUND_REST_IN_FLIGHT = 2
let backgroundRestInFlight = 0
const backgroundRestWaiters: Array<() => void> = []

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function isCriticalRestRequest(url: string): boolean {
  return [
    '/rest/v1/rpc/student_submit_focus_reaction_01_run',
    '/rest/v1/rpc/student_submit_pure_reaction_02_run',
    '/rest/v1/rpc/student_create_arcade_verification_run',
    '/rest/v1/rpc/student_begin_arcade_run',
    '/rest/v1/rpc/place_live_auction_bid',
    '/rest/v1/rpc/teacher_start_live_auction',
    '/rest/v1/rpc/teacher_start_live_auction_item',
    '/rest/v1/rpc/teacher_pause_live_auction_item',
    '/rest/v1/rpc/teacher_resume_live_auction_item',
  ].some((path) => url.includes(path))
}

function acquireBackgroundRestSlot(): Promise<void> {
  if (backgroundRestInFlight < MAX_BACKGROUND_REST_IN_FLIGHT) {
    backgroundRestInFlight += 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => backgroundRestWaiters.push(resolve))
}

function releaseBackgroundRestSlot() {
  const next = backgroundRestWaiters.shift()
  if (next) {
    // Transfer the released slot directly to the next waiter.
    next()
    return
  }
  backgroundRestInFlight = Math.max(0, backgroundRestInFlight - 1)
}

const guardedFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input)
  if (!url.includes('/rest/v1/') || isCriticalRestRequest(url)) {
    return fetch(input, init)
  }

  await acquireBackgroundRestSlot()
  try {
    return await fetch(input, init)
  } finally {
    releaseBackgroundRestSlot()
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  global: { fetch: guardedFetch },
  realtime: {
    // Explicitly use the current publishable key for the WebSocket handshake.
    params: { apikey: SUPABASE_PUBLIC_KEY },
    // A broken Realtime handshake must never reconnect several times per second.
    reconnectAfterMs: (tries: number) => {
      const delays = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000]
      return delays[Math.min(Math.max(tries - 1, 0), delays.length - 1)]
    },
    timeout: 10_000,
  },
})

export default supabase
