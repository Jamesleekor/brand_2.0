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
    '/rest/v1/rpc/get_current_user_context',
    '/rest/v1/rpc/student_submit_focus_reaction_01_run',
    '/rest/v1/rpc/student_submit_pure_reaction_02_run',
    '/rest/v1/rpc/student_create_arcade_verification_run',
    '/rest/v1/rpc/student_begin_arcade_run',
    // RAID_V15_FAST_PATH_V1: combat submissions/ticks already have client + server backpressure.
    // They must not wait behind ordinary background REST reads.
    '/rest/v1/rpc/submit_raid_tap_batch',
    '/rest/v1/rpc/raid_combat_tick',
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
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = backgroundRestWaiters.indexOf(waiter)
      if (index !== -1) {
        backgroundRestWaiters.splice(index, 1)
        reject(new Error('배경 요청이 지연되었습니다. 잠시 후 다시 확인해주세요.'))
      }
    }, 8_000)
    const waiter = () => { clearTimeout(timer); resolve() }
    backgroundRestWaiters.push(waiter)
  })
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

async function boundedRestFetch(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const sourceSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const forwardAbort = () => controller.abort(sourceSignal?.reason)
  if (sourceSignal?.aborted) forwardAbort()
  else sourceSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && !sourceSignal?.aborted) {
      throw new Error('서버 응답이 지연되었습니다. 처리 결과를 먼저 확인한 뒤 다시 시도해주세요.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    sourceSignal?.removeEventListener('abort', forwardAbort)
  }
}

const guardedFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input)
  if (url.includes('/auth/v1/')) return boundedRestFetch(input, init, 20_000)
  if (!url.includes('/rest/v1/')) return fetch(input, init)
  // AUCTION_EMERGENCY_PRIORITY_V1: control/login calls bypass background queue.
  if (/\/rest\/v1\/rpc\/[^/?]*auction[^/?]*(?:[?]|$)/.test(url) || isCriticalRestRequest(url)) {
    return boundedRestFetch(input, init, 15_000)
  }
  await acquireBackgroundRestSlot()
  try {
    return await boundedRestFetch(input, init, 12_000)
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
