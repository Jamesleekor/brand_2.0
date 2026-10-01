// =====================================================================
// B.R.A.N.D 2.0 — Live Auction Load Tester (AUCTION_LOAD_TEST_V1, 2026-10-01)
// ---------------------------------------------------------------------
// 실제 앱과 같은 방식으로 "선생님 운영 화면 1개 + 학생 24명"을 흉내 낸다.
//  - 학생: 2.5~3초마다 경매 상태 조회, '즉시 입찰' 버튼 연타(한 번에 1건만 진행 — 앱과 동일),
//          입찰 성공 시 즉시 상태 재조회, 낙찰 예비 처리(25~40초 후 최대 2회 — 패치 후 앱과 동일)
//  - 선생님: 1.5~2초마다 상태 조회, 타이머 종료 즉시 SUPER PASS 마감/낙찰 처리, 다음 상품 시작
// 안전장치: 'B.R.A.N.D LOADTEST' 학급(테스트 전용)이 아니면 절대 실행하지 않는다.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const TESTER_VERSION = 'AUCTION_LOAD_TEST_V1';
const PROJECT_ROOT = process.cwd();
const TOOL_DIR = path.join(PROJECT_ROOT, 'tools', 'auction-load-tester');
const RESULT_DIR = path.join(TOOL_DIR, 'results');
const ACCOUNTS_FILE = path.join(TOOL_DIR, 'AUCTION_LOAD_TEST_ACCOUNTS.json');
const LOADTEST_CLASSROOM_NAME = 'B.R.A.N.D LOADTEST';
const ROUND_NUMBER = 1;
const SCHOOL_YEAR = 2026;
const GOLD_TARGET = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------- utils
function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, idx).trim()] = value;
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const fmt = (n) => Number(n).toFixed(0);

// ---------------------------------------------------------------- metrics
class Metric {
  constructor(label) {
    this.label = label;
    this.lat = [];
    this.ok = 0;
    this.biz = 0; // 정상적인 업무 거절 (예: 이미 최고 입찰자, 가격 변동)
    this.sys = 0; // 서버/네트워크 문제 (시간 초과, 5xx, 연결 실패)
    this.bizCodes = new Map();
    this.sysSamples = new Map();
  }
  summary() {
    const total = this.ok + this.biz + this.sys;
    return {
      calls: total,
      ok: this.ok,
      business_rejects: this.biz,
      system_errors: this.sys,
      system_error_percent: total ? Number(((this.sys / total) * 100).toFixed(2)) : 0,
      avg_ms: Number(avg(this.lat).toFixed(0)),
      p50_ms: Number(percentile(this.lat, 50).toFixed(0)),
      p95_ms: Number(percentile(this.lat, 95).toFixed(0)),
      p99_ms: Number(percentile(this.lat, 99).toFixed(0)),
      max_ms: Number(Math.max(0, ...this.lat).toFixed(0)),
      top_business_rejects: [...this.bizCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} x${v}`),
      system_error_samples: [...this.sysSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} x${v}`),
    };
  }
}
const M = {
  stateStudent: new Metric('학생 경매상태 조회'),
  stateTeacher: new Metric('선생님 경매상태 조회'),
  bid: new Metric('즉시 입찰'),
  teacherFinalize: new Metric('선생님 낙찰 처리'),
  teacherResolve: new Metric('선생님 SUPER PASS 마감'),
  failoverFinalize: new Metric('학생 예비 낙찰 처리'),
  failoverResolve: new Metric('학생 예비 SUPER PASS 마감'),
  teacherOps: new Metric('선생님 운영 동작'),
};
const counters = { clicks: 0, clicksBlocked: 0, delayedPolls: 0, polls: 0 };
const visibility = []; // 다른 학생 입찰이 보이기까지 걸린 시간(ms, 서버 시계 기준)
const itemTimeline = [];

async function timedRpc(metric, client, fn, args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const { data, error } = await client.rpc(fn, args).abortSignal(controller.signal);
    const ms = performance.now() - t0;
    metric.lat.push(ms);
    if (error) {
      const code = String(error.code ?? '');
      if (/^P0/.test(code)) {
        metric.biz++;
        const key = `${code} ${String(error.message ?? '').slice(0, 40)}`;
        metric.bizCodes.set(key, (metric.bizCodes.get(key) ?? 0) + 1);
      } else {
        metric.sys++;
        const key = `${code || 'NO_CODE'} ${String(error.message ?? error.details ?? '').slice(0, 60)}`;
        metric.sysSamples.set(key, (metric.sysSamples.get(key) ?? 0) + 1);
      }
      return { error, ms };
    }
    metric.ok++;
    return { data, ms };
  } catch (e) {
    const ms = performance.now() - t0;
    metric.lat.push(ms);
    metric.sys++;
    const key = controller.signal.aborted ? `TIMEOUT_${REQUEST_TIMEOUT_MS / 1000}s` : `EXCEPTION ${String(e?.message ?? e).slice(0, 60)}`;
    metric.sysSamples.set(key, (metric.sysSamples.get(key) ?? 0) + 1);
    return { error: { message: key }, ms };
  } finally {
    clearTimeout(timer);
  }
}

function makeClient(url, anonKey, label) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': `brand-auction-load-tester:${label}` } },
  });
}

// ---------------------------------------------------------------- shared state helpers (앱 로직과 동일)
function currentItemOf(state) {
  return (state?.items ?? []).find((i) => i.is_current) ?? null;
}
function estServerNow(sim) {
  return Date.now() + sim.offsetMs;
}
function updateClock(sim, serverNowIso, localStart, localEnd) {
  const server = new Date(serverNowIso).getTime();
  if (Number.isFinite(server)) sim.offsetMs = server - (localStart + localEnd) / 2;
}

// ---------------------------------------------------------------- student
class StudentSim {
  constructor(index, name, client, ctx, opts) {
    this.index = index;
    this.name = name;
    this.client = client;
    this.studentId = ctx.student_id;
    this.classroomId = ctx.classroom_id;
    this.opts = opts;
    this.pollMs = 2_500 + rand(0, 500); // useLiveAuctionState(false)과 동일
    this.failoverDelayMs = 25_000 + rand(0, 15_000); // AUCTION_EXPIRY_HERD_GUARD_V1과 동일
    this.state = null;
    this.lastOkAt = 0;
    this.lastDurationMs = Infinity;
    this.lastPollError = false;
    this.offsetMs = 0;
    this.pollInFlight = null;
    this.bidInFlight = false;
    this.gold = 0;
    this.seenTopBids = new Set();
    this.bidsAccepted = 0;
    this.failover = { key: null, timer: null, attempts: 0 };
    this.lastItemKey = null;
  }

  async fetchWallet() {
    const { data } = await this.client.from('wallets').select('gold').eq('student_id', this.studentId).single();
    if (data) this.gold = Number(data.gold);
  }

  fetchState() {
    if (this.pollInFlight) return this.pollInFlight; // React Query처럼 진행 중이면 합침
    this.pollInFlight = (async () => {
      const localStart = Date.now();
      const r = await timedRpc(M.stateStudent, this.client, 'get_live_auction_state', {
        p_classroom_id: this.classroomId,
        p_include_scheduled: false,
      });
      counters.polls++;
      if (r.error) {
        this.lastPollError = true;
      } else {
        this.lastPollError = false;
        this.lastOkAt = Date.now();
        this.lastDurationMs = r.ms;
        updateClock(this, r.data?.server_now, localStart, Date.now());
        this.observe(r.data);
        this.state = r.data;
      }
      if (this.isStateDelayed()) counters.delayedPolls++;
    })().finally(() => {
      this.pollInFlight = null;
    });
    return this.pollInFlight;
  }

  observe(state) {
    const item = currentItemOf(state);
    const top = item?.top_bid;
    if (top?.bid_id && !this.seenTopBids.has(top.bid_id)) {
      this.seenTopBids.add(top.bid_id);
      if (top.student_id !== this.studentId && state?.server_now && top.created_at) {
        const lag = new Date(state.server_now).getTime() - new Date(top.created_at).getTime();
        if (Number.isFinite(lag) && lag >= 0) visibility.push(lag);
      }
    }
    const key = item ? `${item.id}:${item.current_attempt}` : null;
    if (key !== this.lastItemKey) {
      this.lastItemKey = key;
      void this.fetchWallet(); // 상품이 바뀌면 지갑 갱신 (앱은 실시간 구독으로 갱신)
    }
  }

  isStateDelayed() {
    return this.lastPollError || !this.lastOkAt || Date.now() - this.lastOkAt > 6_000 || this.lastDurationMs > 2_000;
  }

  canBid() {
    const state = this.state;
    const item = currentItemOf(state);
    if (!item || this.isStateDelayed() || !item.bidding_ends_at) return false;
    const sp = state?.super_pass;
    if (sp?.status === 'APPLYING') return false;
    if (sp?.status === 'PRIORITY_BIDDING' && !sp.current_student_priority_eligible) return false;
    if (state?.auction?.paused_at) return false;
    if (new Date(item.bidding_ends_at).getTime() - estServerNow(this) <= 0) return false;
    const amTop = item.top_bid && item.top_bid.student_id === this.studentId;
    if (amTop) return false;
    const quickAmount = Math.max(item.current_price + 1, Math.ceil(item.current_price * 1.1));
    if (quickAmount > this.gold) return false;
    return true;
  }

  async clickQuickBid() {
    counters.clicks++;
    if (this.bidInFlight || !this.canBid()) {
      counters.clicksBlocked++;
      return;
    }
    const item = currentItemOf(this.state);
    this.bidInFlight = true;
    try {
      const r = await timedRpc(M.bid, this.client, 'place_live_auction_bid', {
        p_auction_item_id: item.id,
        p_student_id: this.studentId,
        p_bid_amount: null,
        p_quick_bid: true,
      });
      if (!r.error) {
        this.bidsAccepted++;
        void this.fetchState(); // onSuccess: refetch()
      }
    } finally {
      this.bidInFlight = false;
    }
  }

  // AUCTION_EXPIRY_HERD_GUARD_V1과 같은 예비 처리 (선생님 화면이 늦을 때만 실제로 호출됨)
  tickFailover() {
    const state = this.state;
    const item = currentItemOf(state);
    const sp = state?.super_pass;
    const paused = Boolean(state?.auction?.paused_at);
    let key = null;
    let kind = null;
    if (item && !paused) {
      const now = estServerNow(this);
      if (sp?.status === 'APPLYING' && sp.application_ends_at && new Date(sp.application_ends_at).getTime() <= now) {
        key = `A:${item.id}:${sp.round_id}:${sp.application_ends_at}`;
        kind = 'resolve';
      } else if (sp?.status !== 'APPLYING' && item.bidding_ends_at && new Date(item.bidding_ends_at).getTime() <= now) {
        key = `B:${item.id}:${item.bidding_ends_at}`;
        kind = 'finalize';
      }
    }
    if (key === this.failover.key) return;
    clearTimeout(this.failover.timer);
    this.failover = { key, timer: null, attempts: 0 };
    if (!key) return;
    const itemId = item.id;
    const run = async () => {
      if (this.failover.key !== key || !this.opts.running()) return;
      this.failover.attempts++;
      const r = kind === 'resolve'
        ? await timedRpc(M.failoverResolve, this.client, 'resolve_auction_super_pass_phase_if_expired', { p_item_id: itemId })
        : await timedRpc(M.failoverFinalize, this.client, 'finalize_live_auction_item_if_expired', { p_item_id: itemId });
      void this.fetchState();
      const status = r.data?.status;
      const retry = Boolean(r.error) || status === 'BUSY' || status === 'NOT_EXPIRED';
      if (retry && this.failover.attempts < 2 && this.failover.key === key) {
        this.failover.timer = setTimeout(() => void run(), 20_000 + rand(0, 10_000));
      }
    };
    this.failover.timer = setTimeout(() => void run(), this.failoverDelayMs);
  }

  async run() {
    const running = this.opts.running;
    void this.fetchState();
    const pollTimer = setInterval(() => void this.fetchState(), this.pollMs);
    const clockTimer = setInterval(() => this.tickFailover(), 200);
    try {
      while (running()) {
        await sleep(rand(this.opts.mashMinMs, this.opts.mashMaxMs));
        if (!running()) break;
        await this.clickQuickBid();
      }
    } finally {
      clearInterval(pollTimer);
      clearInterval(clockTimer);
      clearTimeout(this.failover.timer);
    }
  }
}

// ---------------------------------------------------------------- teacher (운영 화면)
class TeacherSim {
  constructor(client, ctx) {
    this.client = client;
    this.classroomId = ctx.classroom_id;
    this.offsetMs = 0;
    this.state = null;
    this.pollMs = 1_500 + rand(0, 500); // useLiveAuctionState(true)과 동일
    this.pollInFlight = null;
  }

  fetchState() {
    if (this.pollInFlight) return this.pollInFlight;
    this.pollInFlight = (async () => {
      const localStart = Date.now();
      const r = await timedRpc(M.stateTeacher, this.client, 'get_live_auction_state', {
        p_classroom_id: this.classroomId,
        p_include_scheduled: true,
      });
      if (!r.error) {
        updateClock(this, r.data?.server_now, localStart, Date.now());
        this.state = r.data;
      }
      return r;
    })().finally(() => {
      this.pollInFlight = null;
    });
    return this.pollInFlight;
  }

  async op(fn, args) {
    const r = await timedRpc(M.teacherOps, this.client, fn, args);
    if (r.error) throw new Error(`${fn}: ${r.error.message ?? r.error.code}`);
    return r.data;
  }

  // 남아 있는 진행 중 경매를 안전하게 끝낸다 (중단된 이전 테스트 복구용)
  async drainAndComplete(log) {
    for (let guard = 0; guard < 60; guard++) {
      await this.fetchState();
      const auction = this.state?.auction;
      if (!auction) return;
      if (auction.status === 'SCHEDULED') {
        await this.op('teacher_delete_scheduled_auction', { p_auction_id: auction.id });
        log('  [복구] 준비 상태 테스트 경매를 삭제했습니다.');
        return;
      }
      const item = currentItemOf(this.state);
      const sp = this.state?.super_pass;
      if (item) {
        if (sp?.status === 'APPLYING') {
          const r = await timedRpc(M.teacherOps, this.client, 'resolve_auction_super_pass_phase_if_expired', { p_item_id: item.id });
          if (r.data?.status === 'NOT_EXPIRED' || r.data?.status === 'BUSY' || r.error) await sleep(2_000);
          continue;
        }
        await timedRpc(M.teacherOps, this.client, 'teacher_close_live_auction_item_now', { p_item_id: item.id });
        continue;
      }
      if (auction.paused_at) {
        await sleep(1_000);
        continue;
      }
      const open = (this.state?.items ?? []).filter((i) => i.final_status === null).sort((a, b) => a.display_order - b.display_order);
      if (!open.length) {
        await this.op('teacher_complete_live_auction', { p_auction_id: auction.id });
        log(`  [정리] 테스트 경매 #${auction.id}를 완료 처리했습니다.`);
        return;
      }
      const del = await timedRpc(M.teacherOps, this.client, 'teacher_delete_live_auction_item', { p_item_id: open[0].id });
      if (del.error) await timedRpc(M.teacherOps, this.client, 'teacher_start_live_auction_item', { p_item_id: open[0].id });
    }
    throw new Error('이전 테스트 경매를 정리하지 못했습니다. 잠시 후 다시 실행해 주세요.');
  }

  async prepare(cfg, log) {
    await this.drainAndComplete(log);
    const created = await this.op('teacher_create_or_reset_live_auction', {
      p_classroom_id: this.classroomId,
      p_round_number: ROUND_NUMBER,
      p_school_year: SCHOOL_YEAR,
      p_scheduled_date: new Date().toISOString().slice(0, 10),
      p_initial_duration_seconds: cfg.durationSec,
      p_extension_seconds: cfg.extensionSec,
      p_reset_existing: true,
    });
    const auctionId = Number(created?.auction_id ?? created?.existing_auction_id);
    if (!Number.isInteger(auctionId)) throw new Error(`테스트 경매 생성 결과를 해석하지 못했습니다: ${JSON.stringify(created)}`);
    const items = Array.from({ length: cfg.itemCount }, (_, i) => ({
      item_name: `부하테스트 상품 ${i + 1}`,
      category: '기타',
      starting_price: cfg.startPrice,
      emoji: '🧪',
    }));
    await this.op('teacher_bulk_add_live_auction_items', { p_auction_id: auctionId, p_items: items });
    return auctionId;
  }

  async startAuction(auctionId) {
    await this.op('teacher_start_live_auction', { p_auction_id: auctionId });
  }

  // 운영 화면: 타이머가 끝나면 즉시 처리, BUSY/NOT_EXPIRED면 3~4초 뒤 재시도 (무제한) — 앱과 동일
  async runOperatingPanel(cfg, running, log) {
    const pollTimer = setInterval(() => void this.fetchState(), this.pollMs);
    let actionKey = null;
    let nextActionAt = 0;
    let startPendingSince = null;
    let curTimeline = null;
    try {
      await this.fetchState();
      while (running()) {
        await sleep(200);
        const state = this.state;
        if (!state?.auction) continue;
        const item = currentItemOf(state);
        const sp = state.super_pass;
        const now = Date.now() + this.offsetMs;

        if (!item) {
          if (curTimeline) {
            itemTimeline.push(curTimeline);
            curTimeline = null;
          }
          const open = (state.items ?? []).filter((i) => i.final_status === null).sort((a, b) => a.display_order - b.display_order);
          if (!open.length) return 'ALL_DONE';
          startPendingSince ??= Date.now();
          if (Date.now() - startPendingSince < cfg.teacherGapMs) continue; // 선생님이 다음 상품을 누르기까지의 간격
          startPendingSince = null;
          const next = open[0];
          const r = await timedRpc(M.teacherOps, this.client, 'teacher_start_live_auction_item', { p_item_id: next.id });
          if (!r.error) {
            curTimeline = { item: next.item_name, attempt: next.current_attempt, started_server: r.data?.server_now ?? null };
            log(`\n  [상품 시작] ${next.item_name} (시도 ${next.current_attempt})`);
          }
          await this.fetchState();
          continue;
        }

        if (curTimeline) {
          curTimeline.bid_count = item.bid_count;
          curTimeline.price = item.current_price;
          curTimeline.ends_at = item.bidding_ends_at;
        }
        if (state.auction.paused_at) continue;

        let key = null;
        let kind = null;
        if (sp?.status === 'APPLYING' && sp.application_ends_at && new Date(sp.application_ends_at).getTime() <= now) {
          key = `A:${item.id}:${sp.round_id}`;
          kind = 'resolve';
        } else if (sp?.status !== 'APPLYING' && item.bidding_ends_at && new Date(item.bidding_ends_at).getTime() <= now) {
          key = `B:${item.id}:${item.bidding_ends_at}`;
          kind = 'finalize';
        }
        if (!key) {
          actionKey = null;
          continue;
        }
        if (key !== actionKey) {
          actionKey = key;
          nextActionAt = 0;
        }
        if (Date.now() < nextActionAt) continue;

        const r = kind === 'resolve'
          ? await timedRpc(M.teacherResolve, this.client, 'resolve_auction_super_pass_phase_if_expired', { p_item_id: item.id })
          : await timedRpc(M.teacherFinalize, this.client, 'finalize_live_auction_item_if_expired', { p_item_id: item.id });
        const status = r.data?.status;
        if (kind === 'finalize' && curTimeline && !r.error && status && status !== 'BUSY' && status !== 'NOT_EXPIRED') {
          curTimeline.result = status;
          curTimeline.final_price = r.data?.final_price ?? null;
          curTimeline.winner_student_id = r.data?.winner_student_id ?? null;
          const endMs = new Date(item.bidding_ends_at).getTime();
          const doneMs = new Date(r.data?.server_now ?? Date.now()).getTime();
          curTimeline.expiry_to_settle_ms = Number.isFinite(endMs) && Number.isFinite(doneMs) ? Math.max(0, doneMs - endMs) : null;
          log(`  [낙찰 처리] ${curTimeline.item} → ${status}${r.data?.final_price ? ` ${r.data.final_price} GOLD` : ''} (마감 후 ${fmt(curTimeline.expiry_to_settle_ms ?? 0)}ms)`);
        }
        const retry = Boolean(r.error) || status === 'BUSY' || status === 'NOT_EXPIRED';
        nextActionAt = retry ? Date.now() + 3_000 + rand(0, 1_000) : Date.now() + 500;
        void this.fetchState();
      }
      return 'STOPPED';
    } finally {
      clearInterval(pollTimer);
      if (curTimeline) itemTimeline.push(curTimeline);
    }
  }
}

// ---------------------------------------------------------------- verdict
function grade(value, good, caution) {
  if (value <= good) return '좋음';
  if (value <= caution) return '주의';
  return '나쁨';
}

async function main() {
  const env = { ...parseEnvFile(path.join(PROJECT_ROOT, '.env')), ...parseEnvFile(path.join(PROJECT_ROOT, '.env.local')) };
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('.env.local에서 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 찾지 못했습니다.');
  if (!fs.existsSync(ACCOUNTS_FILE)) throw new Error(`테스트 계정 파일이 없습니다: ${ACCOUNTS_FILE}`);
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

  const rl = readline.createInterface({ input, output });
  const ask = async (q, def) => {
    const v = (await rl.question(`${q} [Enter=${def}]: `)).trim();
    return v === '' ? def : Number(v);
  };
  const log = (msg) => output.write(`${msg}\n`);

  console.log('\n==============================================================');
  console.log(' B.R.A.N.D 2.0 실시간 경매 부하 테스트 (선생님 1 + 학생 24)');
  console.log(` 테스트 전용 학급 "${LOADTEST_CLASSROOM_NAME}"에서만 실행됩니다.`);
  console.log(' 실제 5-4반 학생 데이터는 건드리지 않습니다.');
  console.log(' ※ 같은 서버를 쓰므로 수업 중에는 실행하지 마세요.');
  console.log('==============================================================\n');

  let cfg;
  let students = [];
  let teacher = null;
  try {
    const studentCount = await ask('가상 학생 수 (1~24)', 24);
    if (!Number.isInteger(studentCount) || studentCount < 1 || studentCount > accounts.students.length) throw new Error('학생 수가 올바르지 않습니다.');
    cfg = {
      studentCount,
      itemCount: await ask('상품 개수 (1~10)', 3),
      startPrice: await ask('시작가 (GOLD)', 100),
      durationSec: await ask('입찰 시간(초, 10~300)', 30),
      extensionSec: await ask('막판 입찰 연장(초, 5~60)', 10),
      mashMinMs: await ask('연타 간격 최소(ms)', 150),
      mashMaxMs: await ask('연타 간격 최대(ms)', 400),
      teacherGapMs: 3_000,
    };
    if (!(cfg.itemCount >= 1 && cfg.itemCount <= 10)) throw new Error('상품 개수는 1~10개입니다.');
    if (!(cfg.durationSec >= 10 && cfg.durationSec <= 300)) throw new Error('입찰 시간은 10~300초입니다.');
    if (!(cfg.extensionSec >= 5 && cfg.extensionSec <= 60)) throw new Error('연장 시간은 5~60초입니다.');
    if (!(cfg.mashMinMs >= 50 && cfg.mashMaxMs >= cfg.mashMinMs)) throw new Error('연타 간격이 올바르지 않습니다.');

    // ---------------- 로그인 + 안전 확인
    log('\n[1/4] 테스트 계정 로그인 및 안전 확인...');
    const tClient = makeClient(url, anonKey, 'teacher');
    {
      const { error } = await tClient.auth.signInWithPassword({ email: accounts.teacher.email, password: accounts.teacher.password });
      if (error) throw new Error(`선생님 테스트 계정 로그인 실패: ${error.message}`);
      const { data, error: ctxErr } = await tClient.rpc('get_current_user_context');
      const ctx = Array.isArray(data) ? data[0] : data;
      if (ctxErr || !ctx?.is_teacher || ctx.classroom_name !== LOADTEST_CLASSROOM_NAME) {
        throw new Error(`안전 확인 실패: 선생님 계정이 "${LOADTEST_CLASSROOM_NAME}" 학급이 아닙니다. (${ctx?.classroom_name ?? ctxErr?.message})`);
      }
      teacher = new TeacherSim(tClient, ctx);
      log(`  선생님 OK — 학급 #${ctx.classroom_id} ${ctx.classroom_name}`);
    }
    let running = false;
    const isRunning = () => running;
    for (let i = 0; i < cfg.studentCount; i++) {
      const acc = accounts.students[i];
      const c = makeClient(url, anonKey, `s${i + 1}`);
      const { error } = await c.auth.signInWithPassword({ email: acc.email, password: acc.password });
      if (error) throw new Error(`${acc.email} 로그인 실패: ${error.message}`);
      const { data, error: ctxErr } = await c.rpc('get_current_user_context');
      const ctx = Array.isArray(data) ? data[0] : data;
      if (ctxErr || !ctx?.student_id || ctx.classroom_id !== teacher.classroomId) {
        throw new Error(`안전 확인 실패: ${acc.email}이 테스트 학급 학생이 아닙니다.`);
      }
      students.push(new StudentSim(i + 1, ctx.student_name, c, ctx, { ...cfg, running: isRunning }));
      await sleep(60);
    }
    log(`  학생 ${students.length}명 OK`);

    // ---------------- 준비
    log('\n[2/4] 테스트 경매 준비 (이전 테스트 낙찰금은 자동으로 되돌려짐)...');
    const auctionId = await teacher.prepare(cfg, log);
    for (const s of students) await s.fetchWallet();
    const needTopUp = students.filter((s) => s.gold < GOLD_TARGET * 0.5);
    for (const s of needTopUp) {
      const amount = Math.ceil((GOLD_TARGET - s.gold) / 0.9); // 지급 시 세금 10% 고려
      await teacher.op('teacher_grant_student_assets_combined', {
        p_student_ids: [s.studentId], p_bv_amount: 0, p_gold_amount: amount, p_reason: 'AUCTION_LOAD_TEST 테스트 골드',
      });
      await s.fetchWallet();
    }
    if (needTopUp.length) log(`  테스트 골드 충전: ${needTopUp.length}명`);
    log(`  테스트 경매 #${auctionId} — 상품 ${cfg.itemCount}개, 시작가 ${cfg.startPrice}, 입찰 ${cfg.durationSec}초(+${cfg.extensionSec}초 연장)`);

    const go = (await rl.question('\n시작하려면 YES 입력: ')).trim();
    if (go !== 'YES') {
      log('취소했습니다. 준비된 테스트 경매는 다음 실행 때 자동 정리됩니다.');
      return;
    }
    rl.close(); // 질문은 끝. 닫아야 Ctrl+C가 아래의 안전 중단으로 전달된다.

    // ---------------- 실행
    log('\n[3/4] 실행 중... (Ctrl+C = 안전 중단)');
    for (const m of Object.values(M)) { m.lat.length = 0; m.ok = m.biz = m.sys = 0; m.bizCodes.clear(); m.sysSamples.clear(); }
    await teacher.startAuction(auctionId);
    running = true;
    const startedIso = new Date().toISOString();
    const wallStart = Date.now();
    let interrupted = false;
    const onSigint = () => {
      if (!running) return;
      interrupted = true;
      running = false;
      log('\n  [중단 요청] 안전하게 정리 중...');
    };
    process.on('SIGINT', onSigint);

    const ticker = setInterval(() => {
      const el = Math.max(1, (Date.now() - wallStart) / 1000);
      const item = currentItemOf(teacher.state);
      const ok = M.bid.ok;
      output.write(`\r  ${fmt(el).padStart(4)}s | 입찰 성공 ${ok} | 입찰 p95 ${fmt(percentile(M.bid.lat, 95))}ms | 조회 p95 ${fmt(percentile(M.stateStudent.lat, 95))}ms | 시스템오류 ${Object.values(M).reduce((a, m) => a + m.sys, 0)} | ${item ? `${item.item_name} ${item.current_price}G` : '대기'}      `);
    }, 1_000);

    const studentRuns = students.map((s) => s.run());
    const result = await teacher.runOperatingPanel(cfg, isRunning, log);
    running = false;
    await Promise.allSettled(studentRuns);
    clearInterval(ticker);
    process.off('SIGINT', onSigint);
    const elapsedSec = (Date.now() - wallStart) / 1000;

    if (interrupted || result !== 'ALL_DONE') await teacher.drainAndComplete(log);
    else await teacher.op('teacher_complete_live_auction', { p_auction_id: auctionId }).catch(() => {});

    // ---------------- 결과
    log('\n\n[4/4] 결과 정리...');
    const sysTotal = Object.values(M).reduce((a, m) => a + m.sys, 0);
    const callsTotal = Object.values(M).reduce((a, m) => a + m.ok + m.biz + m.sys, 0);
    const bid = M.bid.summary();
    const st = M.stateStudent.summary();
    const delayedPct = counters.polls ? (counters.delayedPolls / counters.polls) * 100 : 0;
    const settle = itemTimeline.map((t) => t.expiry_to_settle_ms).filter((v) => Number.isFinite(v));
    const failoverCalls = M.failoverFinalize.ok + M.failoverFinalize.biz + M.failoverFinalize.sys + M.failoverResolve.ok + M.failoverResolve.biz + M.failoverResolve.sys;

    const verdict = [
      ['입찰 응답 p95', `${bid.p95_ms}ms`, grade(bid.p95_ms, 1_000, 2_000)],
      ['경매상태 조회 p95', `${st.p95_ms}ms`, grade(st.p95_ms, 1_000, 2_000)],
      ['시스템 오류(시간초과/5xx)', `${sysTotal}건 / ${callsTotal}건`, grade(callsTotal ? (sysTotal / callsTotal) * 100 : 0, 0, 1)],
      ['"연결 지연" 표시 비율', `${delayedPct.toFixed(1)}%`, grade(delayedPct, 2, 10)],
      ['마감→낙찰 처리 (최대)', `${fmt(Math.max(0, ...settle))}ms`, grade(Math.max(0, ...settle), 3_000, 8_000)],
      ['학생 예비 낙찰 호출', `${failoverCalls}회`, grade(failoverCalls, 0, students.length)],
    ];
    const overall = verdict.some((v) => v[2] === '나쁨') ? '나쁨' : verdict.some((v) => v[2] === '주의') ? '주의' : '좋음';

    const summary = {
      tester_version: TESTER_VERSION,
      started_at: startedIso,
      finished_at: new Date().toISOString(),
      interrupted,
      elapsed_seconds: Number(elapsedSec.toFixed(1)),
      config: { ...cfg, running: undefined },
      students: students.length,
      clicks: counters.clicks,
      clicks_blocked_by_ui_rules: counters.clicksBlocked,
      bids_accepted: M.bid.ok,
      bids_accepted_per_sec: Number((M.bid.ok / elapsedSec).toFixed(2)),
      total_requests: callsTotal,
      requests_per_sec: Number((callsTotal / elapsedSec).toFixed(2)),
      delayed_poll_percent: Number(delayedPct.toFixed(2)),
      other_bid_visible_avg_ms: Number(avg(visibility).toFixed(0)),
      other_bid_visible_p95_ms: Number(percentile(visibility, 95).toFixed(0)),
      overall,
    };
    const metrics = Object.fromEntries(Object.entries(M).map(([k, m]) => [k, { label: m.label, ...m.summary() }]));

    const lines = [];
    lines.push('B.R.A.N.D 2.0 실시간 경매 부하 테스트 결과');
    lines.push('==========================================');
    lines.push(`종합 판정: ${overall}${interrupted ? ' (중간 중단됨)' : ''}`);
    lines.push('');
    for (const [k, v, g] of verdict) lines.push(`  [${g}] ${k}: ${v}`);
    lines.push('');
    lines.push(`실행 시간 ${summary.elapsed_seconds}초 | 학생 ${summary.students}명 | 클릭 ${summary.clicks}회 → 입찰 성공 ${summary.bids_accepted}건 (${summary.bids_accepted_per_sec}/초)`);
    lines.push(`전체 요청 ${summary.total_requests}건 (${summary.requests_per_sec}/초)`);
    lines.push(`다른 학생 입찰이 내 화면에 보이기까지: 평균 ${summary.other_bid_visible_avg_ms}ms, p95 ${summary.other_bid_visible_p95_ms}ms (2.5~3초 주기 조회 포함)`);
    lines.push('');
    lines.push('상품별 진행');
    for (const t of itemTimeline) {
      lines.push(`  - ${t.item} (시도 ${t.attempt}): ${t.result ?? '미완료'} | 입찰 ${t.bid_count ?? 0}건 | 최종가 ${t.final_price ?? t.price ?? '-'} | 마감→처리 ${t.expiry_to_settle_ms ?? '-'}ms`);
    }
    lines.push('');
    lines.push('요청 종류별 상세');
    for (const m of Object.values(metrics)) {
      if (!m.calls) continue;
      lines.push(`  ${m.label}: ${m.calls}건 | 성공 ${m.ok} | 업무거절 ${m.business_rejects} | 시스템오류 ${m.system_errors} | 평균 ${m.avg_ms} / p95 ${m.p95_ms} / 최대 ${m.max_ms} ms`);
      if (m.top_business_rejects.length) lines.push(`      업무거절 예: ${m.top_business_rejects.join(' ; ')}`);
      if (m.system_error_samples.length) lines.push(`      시스템오류 예: ${m.system_error_samples.join(' ; ')}`);
    }
    lines.push('');
    lines.push('※ 업무거절(이미 최고 입찰자, 마감됨 등)은 정상 동작입니다. 문제는 "시스템오류"입니다.');
    lines.push('※ 이 REPORT.txt를 Claude에게 붙여넣으면 분석해 드립니다.');
    const report = lines.join('\n');
    console.log(`\n${report}\n`);

    fs.mkdirSync(RESULT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `auction_${students.length}p_${stamp}`;
    fs.writeFileSync(path.join(RESULT_DIR, `${base}_REPORT.txt`), report, 'utf8');
    fs.writeFileSync(path.join(RESULT_DIR, `${base}.json`), JSON.stringify({ summary, verdict, metrics, itemTimeline }, null, 2), 'utf8');
    console.log(`결과 저장: ${path.join(RESULT_DIR, `${base}_REPORT.txt`)}\n`);
  } finally {
    rl.close();
    for (const s of students) await s.client.auth.signOut().catch(() => {});
    if (teacher) await teacher.client.auth.signOut().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\n[AUCTION LOAD TESTER ERROR] ${err?.message ?? err}`);
  process.exitCode = 1;
});
