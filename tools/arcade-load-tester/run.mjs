// =====================================================================
// B.R.A.N.D 2.0 — Arcade 공인 도전(Verification) Load Tester (ARCADE_VERIFY_LOAD_TEST_V1, 2026-10-01)
// ---------------------------------------------------------------------
// 실제 수업처럼 "선생님 1 + 학생 24"가 순수 반응속도(pure_reaction_02) 공인 도전을 진행한다.
//  - 선생님: 테스트용 월간 기간 생성→인증 단계 전환, 학생별 공인 도전 시작(1.5~3초 간격),
//            시작할 때마다 인증 현황 새로고침
//  - 학생: 앱 접속(로그인 확인·접속 기록·상호평가 확인·아케이드 화면 데이터 전부) →
//          선생님이 시작해 줄 때까지 대기(새로고침 F5 / 조용히 대기 중 선택) →
//          공인 도전 시작 → 카운트다운 → 실제 시간대로 5회 반응 → 기록 제출 → 랭킹·상태 갱신
//          실패하면 남은 기회로 재도전 (최대 3회)
//  - 앱의 브라우저 요청 제한(일반 요청 동시 2개, 대기 8초, 시간 초과 12/15초)까지 그대로 따라 한다.
// 안전장치: 'B.R.A.N.D LOADTEST' 학급(테스트 전용)이 아니면 절대 실행하지 않는다.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const TESTER_VERSION = 'ARCADE_VERIFY_LOAD_TEST_V1';
const PROJECT_ROOT = process.cwd();
const TOOL_DIR = path.join(PROJECT_ROOT, 'tools', 'arcade-load-tester');
const RESULT_DIR = path.join(TOOL_DIR, 'results');
const ACCOUNTS_FILE = path.join(PROJECT_ROOT, 'tools', 'auction-load-tester', 'AUCTION_LOAD_TEST_ACCOUNTS.json');
const LOADTEST_CLASSROOM_NAME = 'B.R.A.N.D LOADTEST';
const GAME_CODE = 'pure_reaction_02';

// 앱(lib/supabase/client.ts)의 요청 제한과 동일
const BACKGROUND_MAX_IN_FLIGHT = 2;
const BACKGROUND_QUEUE_WAIT_MS = 8_000;
const BACKGROUND_TIMEOUT_MS = 12_000;
const CRITICAL_TIMEOUT_MS = 15_000;

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
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

// ---------------------------------------------------------------- metrics
class Metric {
  constructor(label) {
    this.label = label;
    this.lat = [];
    this.ok = 0;
    this.biz = 0;
    this.sys = 0;
    this.bizCodes = new Map();
    this.sysSamples = new Map();
  }
  bump(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }
  summary() {
    const total = this.ok + this.biz + this.sys;
    return {
      calls: total, ok: this.ok, business_rejects: this.biz, system_errors: this.sys,
      avg_ms: Number(avg(this.lat).toFixed(0)), p50_ms: Number(percentile(this.lat, 50).toFixed(0)),
      p95_ms: Number(percentile(this.lat, 95).toFixed(0)), max_ms: Number(Math.max(0, ...this.lat).toFixed(0)),
      top_business_rejects: [...this.bizCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} x${v}`),
      system_error_samples: [...this.sysSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} x${v}`),
    };
  }
}
const M = {
  bootContext: new Metric('접속: 로그인 확인'),
  bootAccess: new Metric('접속: 접속 기록'),
  bootPeer: new Metric('접속: 상호평가 확인'),
  bootPresence: new Metric('접속: 실시간확인 상태'),
  pageGames: new Metric('화면: 게임 목록'),
  pagePeriods: new Metric('화면: 랭킹 기간'),
  pageGuilds: new Metric('화면: 길드 정보'),
  gameAccess: new Metric('화면: 게임 권한'),
  verifyState: new Metric('화면: 공인 도전 상태'),
  leaderboard: new Metric('화면: 랭킹'),
  createRun: new Metric('공인 도전 시작'),
  beginRun: new Metric('게임 시작(카운트다운 후)'),
  submitRun: new Metric('기록 제출'),
  teacherStart: new Metric('선생님: 학생 공인 도전 열기'),
  teacherOverview: new Metric('선생님: 인증 현황 조회'),
  teacherSetup: new Metric('선생님: 준비/정리'),
};
const counters = { boots: 0, bootTotalMs: [], noticeLagMs: [], runs: 0, accepted: 0, rejectCodes: new Map(), stuck: 0, finishedStudents: 0 };

// 앱의 guardedFetch와 같은 "브라우저당 일반 요청 2개" 제한
class BrowserGate {
  constructor() { this.inFlight = 0; this.waiters = []; }
  acquire() {
    if (this.inFlight < BACKGROUND_MAX_IN_FLIGHT) { this.inFlight++; return Promise.resolve(true); }
    return new Promise((resolve) => {
      const waiter = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i !== -1) { this.waiters.splice(i, 1); resolve(false); }
      }, BACKGROUND_QUEUE_WAIT_MS);
      this.waiters.push(waiter);
    });
  }
  release() {
    const next = this.waiters.shift();
    if (next) { next(); return; }
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

async function timed(metric, makeQuery, { critical = false, gate = null } = {}) {
  const t0 = performance.now();
  let acquired = false;
  if (!critical && gate) {
    acquired = await gate.acquire();
    if (!acquired) {
      const ms = performance.now() - t0;
      metric.lat.push(ms);
      metric.sys++;
      metric.bump(metric.sysSamples, 'CLIENT_QUEUE_8s (앱: "배경 요청이 지연되었습니다")');
      return { error: { message: 'CLIENT_QUEUE_8s' }, ms };
    }
  }
  const controller = new AbortController();
  const limit = critical ? CRITICAL_TIMEOUT_MS : BACKGROUND_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const { data, error } = await makeQuery().abortSignal(controller.signal);
    const ms = performance.now() - t0;
    metric.lat.push(ms);
    if (error) {
      const code = String(error.code ?? '');
      if (/^P0/.test(code)) { metric.biz++; metric.bump(metric.bizCodes, `${code} ${String(error.message ?? '').slice(0, 50)}`); }
      else { metric.sys++; metric.bump(metric.sysSamples, `${code || 'NO_CODE'} ${String(error.message ?? '').slice(0, 60)}`); }
      return { error, ms };
    }
    metric.ok++;
    return { data, ms };
  } catch (e) {
    const ms = performance.now() - t0;
    metric.lat.push(ms);
    metric.sys++;
    metric.bump(metric.sysSamples, controller.signal.aborted ? `TIMEOUT_${limit / 1000}s` : `EXCEPTION ${String(e?.message ?? e).slice(0, 60)}`);
    return { error: { message: 'TIMEOUT' }, ms };
  } finally {
    clearTimeout(timer);
    if (acquired) gate.release();
  }
}

// LOGIN_RATE_LIMIT_RETRY_V1: Supabase 로그인 요청 한도(같은 인터넷 주소 기준)에 걸리면 30초씩 기다렸다가 다시 시도
async function signInWithRetry(client, email, password, log) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return null;
    if (!/rate limit/i.test(String(error.message ?? ''))) return error;
    log(`  [대기] 로그인 요청 한도에 걸려 30초 후 다시 시도합니다 (${attempt}/12) — 자동으로 계속됩니다.`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return { message: '로그인 요청 한도가 6분 넘게 풀리지 않았습니다. 10분쯤 뒤 다시 실행해 주세요.' };
}

function makeClient(url, anonKey, label) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': `brand-arcade-load-tester:${label}` } },
  });
}

// ---------------------------------------------------------------- pure_reaction_02 시뮬레이션 (앱 엔진과 같은 규칙)
function xorshift32Next(state) {
  let v = state >>> 0;
  v = (v ^ ((v << 13) >>> 0)) >>> 0;
  v = (v ^ (v >>> 17)) >>> 0;
  v = (v ^ ((v << 5) >>> 0)) >>> 0;
  return v >>> 0;
}
function planPureReactionPlay(seed, config, falseStartChance) {
  const trialCount = Number(config.trialCount ?? 5);
  const waitMin = Number(config.waitMinMs ?? 1500);
  const waitMax = Number(config.waitMaxMs ?? 4500);
  const feedback = Number(config.interTrialFeedbackMs ?? 700);
  const waits = [];
  let state = Number(seed) >>> 0;
  for (let i = 0; i < trialCount; i++) { state = xorshift32Next(state); waits.push(waitMin + (state % (waitMax - waitMin + 1))); }
  const events = [];
  let cursor = 0;
  for (let t = 0; t < trialCount; t++) {
    const signal = cursor + waits[t];
    if (Math.random() < falseStartChance) {
      const early = Math.max(cursor + 50, signal - rand(150, 900));
      events.push({ elapsed_ms: early, source: 'POINTER' });
      return { events, gameOverElapsedMs: early, expectedOutcome: 'FALSE_START' };
    }
    const at = signal + rand(210, 390);
    events.push({ elapsed_ms: at, source: Math.random() < 0.5 ? 'SPACE' : 'POINTER' });
    if (t === trialCount - 1) return { events, gameOverElapsedMs: at, expectedOutcome: 'COMPLETE' };
    cursor = at + feedback;
  }
  return { events, gameOverElapsedMs: cursor, expectedOutcome: 'COMPLETE' };
}

// ---------------------------------------------------------------- student
class StudentSim {
  constructor(index, client, ctx, shared, opts) {
    this.index = index;
    this.client = client;
    this.studentId = ctx.student_id;
    this.classroomId = ctx.classroom_id;
    this.shared = shared;
    this.opts = opts;
    this.gate = new BrowserGate();
    this.state = null;
    this.done = false;
    this.result = 'NOT_STARTED';
  }

  // 새로고침(F5) 한 번 = 앱 전체 다시 열기 + 아케이드 화면 데이터 전부
  async boot() {
    counters.boots++;
    const t0 = performance.now();
    const c = this.client;
    const g = { gate: this.gate };
    await timed(M.bootContext, () => c.rpc('get_current_user_context'), { critical: true });
    const sideCalls = [
      timed(M.bootAccess, () => c.rpc('record_app_access_event', { p_source: 'SESSION_RESTORE', p_device_type: 'Chromebook', p_browser: 'Chrome' }), g),
      timed(M.bootPeer, () => c.rpc('student_get_peer_review_enforcement_status'), g),
    ];
    // 아케이드 화면 첫 데이터 (게임 목록·기간은 동시에, 길드 정보는 별도 query)
    const [games, periods] = await Promise.all([
      timed(M.pageGames, () => c.from('arcade_games').select('id,code,internal_name,is_active,available_from,available_until').order('id'), g),
      timed(M.pagePeriods, () => c.from('arcade_ranking_periods').select('id,period_kind,display_name,contribution_year_month,starts_at,ends_at_exclusive,status').eq('classroom_id', this.classroomId).order('starts_at', { ascending: false }), g),
      timed(M.pageGuilds, () => c.from('guilds').select('id,name,logo_url').eq('classroom_id', this.classroomId).eq('is_active', true), g),
    ]);
    void games; void periods;
    await Promise.all([
      timed(M.gameAccess, () => c.rpc('student_get_arcade_game_access', { p_game_code: GAME_CODE }), g),
      this.fetchVerificationState(),
      this.fetchLeaderboard(),
      ...sideCalls,
    ]);
    counters.bootTotalMs.push(performance.now() - t0);
    // StudentPresenceTracker: 3~15초 뒤 실시간확인 상태 1회 확인 (PRESENCE_MANUAL_TOGGLE_V1)
    setTimeout(() => void timed(M.bootPresence, () => c.rpc('get_presence_tracking_state'), g), rand(3_000, 15_000));
  }

  async fetchVerificationState() {
    const r = await timed(M.verifyState, () => this.client.rpc('student_get_arcade_verification_state', { p_game_code: GAME_CODE }), { gate: this.gate });
    if (!r.error) {
      const st = r.data;
      // 이번 테스트 기간의 세션만 인정 (이전 테스트 기록은 무시)
      this.state = st?.available && Number(st.period_id) === this.shared.periodId ? st : null;
      if (this.state && !this.noticedAt && this.shared.sessionOpenedAt.has(this.studentId)) {
        this.noticedAt = Date.now();
        counters.noticeLagMs.push(this.noticedAt - this.shared.sessionOpenedAt.get(this.studentId));
      }
    }
    return r;
  }

  fetchLeaderboard() {
    if (!this.shared.periodId) return Promise.resolve();
    return timed(M.leaderboard, () => this.client.rpc('get_arcade_leaderboard', { p_game_code: GAME_CODE, p_period_id: this.shared.periodId }), { gate: this.gate });
  }

  async playOnce() {
    const st = this.state;
    // "공인 도전 시작" 버튼 (같은 세션이면 같은 idempotency key 재사용 — 앱과 동일)
    this.idemKey ??= { session: st.session_id, key: randomUUID() };
    if (this.idemKey.session !== st.session_id) this.idemKey = { session: st.session_id, key: randomUUID() };
    const created = await timed(M.createRun, () => this.client.rpc('student_create_arcade_verification_run', { p_session_id: st.session_id, p_idempotency_key: this.idemKey.key }), { critical: true });
    if (created.error) { await sleep(rand(3_000, 6_000)); await this.fetchVerificationState(); return; }
    this.idemKey = null;
    counters.runs++;
    const boot = created.data;
    const countdownMs = Math.max(5_200, new Date(boot.countdown_ends_at).getTime() - Date.now() + 200);
    await sleep(countdownMs);

    const begun = await timed(M.beginRun, () => this.client.rpc('student_begin_arcade_run', { p_run_id: boot.run_id }), { critical: true });
    if (begun.error) {
      counters.stuck++;
      this.result = 'STUCK_BEGIN_FAILED';
      this.done = true; // 실제로는 선생님이 기술적 취소를 해줘야 다시 할 수 있는 상태
      return;
    }
    const plan = planPureReactionPlay(begun.data.schedule_seed, begun.data.config ?? {}, this.opts.falseStartChance);
    await sleep(plan.gameOverElapsedMs); // 실제 시간만큼 게임 진행
    const submitted = await timed(M.submitRun, () => this.client.rpc('student_submit_pure_reaction_02_run', {
      p_run_id: boot.run_id, p_input_events: plan.events, p_client_game_over_elapsed_ms: plan.gameOverElapsedMs,
    }), { critical: true });
    if (submitted.error) {
      counters.stuck++;
      this.result = 'STUCK_SUBMIT_FAILED';
      this.done = true;
      return;
    }
    if (submitted.data?.accepted) counters.accepted++;
    else counters.rejectCodes.set(submitted.data?.code ?? 'UNKNOWN', (counters.rejectCodes.get(submitted.data?.code ?? 'UNKNOWN') ?? 0) + 1);
    // handleRecorded: 랭킹 + 상태 갱신
    await Promise.all([this.fetchLeaderboard(), this.fetchVerificationState()]);
    // 결과 화면 보고 "확인" 누르기까지
    await sleep(rand(2_000, 4_000));
    await Promise.all([
      this.fetchVerificationState(),
      timed(M.gameAccess, () => this.client.rpc('student_get_arcade_game_access', { p_game_code: GAME_CODE }), { gate: this.gate }),
    ]);
  }

  async run(running) {
    await sleep(rand(0, 4_000)); // 학생마다 접속 시점이 조금씩 다름
    await this.boot();
    while (running() && !this.done) {
      const st = this.state;
      if (st && st.can_attempt) { await this.playOnce(); continue; }
      if (st && (st.success_achieved || st.remaining_attempts === 0 || st.session_status !== 'ACTIVE')) {
        this.result = st.success_achieved ? 'SUCCESS' : 'NO_ATTEMPTS_LEFT';
        this.done = true;
        break;
      }
      if (st && st.active_run_id) { counters.stuck++; this.result = 'STUCK_ACTIVE_RUN'; this.done = true; break; }
      // 아직 선생님이 열어주지 않음 → 대기 방식
      if (this.opts.waitMode === 'F5') {
        await sleep(rand(this.opts.f5MinMs, this.opts.f5MaxMs));
        if (!running()) break;
        await this.boot();
      } else {
        await sleep(15_000);
        if (!running()) break;
        await this.fetchVerificationState();
      }
    }
    if (this.done) counters.finishedStudents++;
  }
}

// ---------------------------------------------------------------- teacher
class TeacherSim {
  constructor(client, ctx) { this.client = client; this.classroomId = ctx.classroom_id; }
  async op(fn, args) {
    const r = await timed(M.teacherSetup, () => this.client.rpc(fn, args), { critical: true });
    if (r.error) throw new Error(`${fn}: ${r.error.message ?? r.error.code}`);
    return r.data;
  }
  async setupPeriod(log) {
    // ARCADE_TEST_PERIOD_SLOT_V1: 학급마다 "월간 기간은 한 달에 하나"이고 "기간끼리 시간이 겹치면 안 됨" 규칙이 있다.
    // 그래서 실행할 때마다 비어 있는 테스트용 월(2090-01부터)과 이전 테스트 기간 뒤의 시간대를 고른다.
    const readPeriods = async () => {
      const { data, error } = await this.client.from('arcade_ranking_periods')
        .select('id,period_kind,status,display_name,guild_season_id,contribution_year_month,starts_at,ends_at_exclusive')
        .eq('classroom_id', this.classroomId);
      if (error) throw new Error(`테스트 학급의 아케이드 기간 목록을 읽지 못했습니다: ${error.message}`);
      return data ?? [];
    };
    let rows = await readPeriods();
    // 중간에 끊긴 이전 실행이 남긴 "아직 안 끝난" 기간 정리
    for (const p of rows.filter((r) => r.period_kind === 'MONTHLY' && new Date(r.ends_at_exclusive).getTime() > Date.now())) {
      if (p.status === 'ACTIVE') {
        await this.op('teacher_end_arcade_ranking_period_now', { p_period_id: p.id });
      } else if (p.status === 'DRAFT' && new Date(p.starts_at).getTime() < Date.now() - 1_000) {
        await this.op('teacher_update_arcade_ranking_period', {
          p_period_id: p.id, p_display_name: p.display_name, p_guild_season_id: p.guild_season_id,
          p_contribution_year_month: p.contribution_year_month, p_starts_at: p.starts_at,
          p_ends_at_exclusive: new Date(Date.now() - 500).toISOString(), p_status: 'DRAFT',
        });
      }
    }
    rows = await readPeriods();
    const monthly = rows.filter((r) => r.period_kind === 'MONTHLY');
    const usedMonths = new Set(monthly.map((r) => r.contribution_year_month));
    let ym = null;
    for (let y = 2090; y <= 2099 && !ym; y++) {
      for (let m = 1; m <= 12 && !ym; m++) {
        const cand = `${y}-${String(m).padStart(2, '0')}`;
        if (!usedMonths.has(cand)) ym = cand;
      }
    }
    if (!ym) throw new Error('테스트용 월(2090~2099)을 모두 사용했습니다. Claude에게 정리를 요청하세요.');
    const latestEnd = Math.max(0, ...monthly.map((r) => new Date(r.ends_at_exclusive).getTime()));
    if (latestEnd > Date.now() + 5_000) throw new Error('테스트 학급에 아직 끝나지 않은 기간이 있습니다. Claude에게 정리를 요청하세요.');
    if (latestEnd > Date.now() - 1_500) await sleep(latestEnd - Date.now() + 1_500);
    const now = Date.now();
    const kst = new Date(now + 9 * 3600_000);
    const name = `LOADTEST 공인도전 ${kst.toISOString().slice(5, 16).replace('T', ' ')} (테스트월 ${ym})`;
    const starts = new Date(Math.max(latestEnd, now - 10 * 60_000)).toISOString();
    const ends = new Date(now + 60_000).toISOString();
    const created = await this.op('teacher_create_arcade_ranking_period', {
      p_period_kind: 'MONTHLY', p_display_name: name, p_guild_season_id: null,
      p_contribution_year_month: ym, p_starts_at: starts, p_ends_at_exclusive: ends,
    });
    const periodId = Number(created.period_id);
    await this.op('teacher_update_arcade_ranking_period', {
      p_period_id: periodId, p_display_name: name, p_guild_season_id: null,
      p_contribution_year_month: ym, p_starts_at: starts, p_ends_at_exclusive: ends, p_status: 'ACTIVE',
    });
    await this.op('teacher_end_arcade_ranking_period_now', { p_period_id: periodId });
    await sleep(1_200);
    const frozen = await this.op('teacher_freeze_arcade_monthly_period', { p_period_id: periodId });
    log(`  테스트 기간 #${periodId} "${name}" → ${frozen?.status}`);
    return periodId;
  }
  overview(periodId) {
    return timed(M.teacherOverview, () => this.client.rpc('teacher_get_arcade_verification_overview', { p_period_id: periodId, p_game_code: GAME_CODE }), { critical: false });
  }
  async openSessions(periodId, students, shared, opts, running, log) {
    for (const s of shuffle(students)) {
      if (!running()) return;
      const r = await timed(M.teacherStart, () => this.client.rpc('teacher_start_arcade_verification_session', { p_period_id: periodId, p_game_code: GAME_CODE, p_student_id: s.studentId }), { critical: true });
      if (!r.error) {
        shared.sessionOpenedAt.set(s.studentId, Date.now());
        shared.sessionIds.add(Number(r.data?.session_id));
      }
      void this.overview(periodId); // 버튼 누른 뒤 현황 새로고침
      await sleep(rand(opts.teacherGapMinMs, opts.teacherGapMaxMs));
    }
    log(`\n  [선생님] 학생 ${shared.sessionOpenedAt.size}명 공인 도전 열기 완료`);
  }
  async closeSessions(shared) {
    for (const id of shared.sessionIds) {
      if (!Number.isFinite(id)) continue;
      await timed(M.teacherSetup, () => this.client.rpc('teacher_end_arcade_verification_session', { p_session_id: id }), { critical: true });
    }
  }
}

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
  if (!fs.existsSync(ACCOUNTS_FILE)) throw new Error(`테스트 계정 파일이 없습니다: ${ACCOUNTS_FILE} (경매 테스트 도구 패치를 먼저 적용하세요)`);
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

  const rl = readline.createInterface({ input, output });
  const ask = async (q, def) => {
    const v = (await rl.question(`${q} [Enter=${def}]: `)).trim();
    return v === '' ? def : v;
  };
  const log = (msg) => output.write(`${msg}\n`);

  console.log('\n==============================================================');
  console.log(' B.R.A.N.D 2.0 아케이드 공인 도전 부하 테스트 (선생님 1 + 학생 24)');
  console.log(` 테스트 전용 학급 "${LOADTEST_CLASSROOM_NAME}"에서만 실행됩니다.`);
  console.log(' 실제 5-4반 학생 기록·랭킹·길드 점수는 건드리지 않습니다.');
  console.log(' ※ 같은 서버를 쓰므로 수업 중에는 실행하지 마세요.');
  console.log('==============================================================\n');

  let students = [];
  let teacher = null;
  const shared = { periodId: null, sessionOpenedAt: new Map(), sessionIds: new Set() };
  try {
    const studentCount = Number(await ask('가상 학생 수 (1~24)', 24));
    if (!Number.isInteger(studentCount) || studentCount < 1 || studentCount > accounts.students.length) throw new Error('학생 수가 올바르지 않습니다.');
    const modeIn = String(await ask('기다리는 방식 [1=새로고침(F5) 반복 / 2=조용히 대기]', 1));
    const opts = {
      waitMode: modeIn === '2' ? 'QUIET' : 'F5',
      f5MinMs: 10_000,
      f5MaxMs: 25_000,
      teacherGapMinMs: 1_500,
      teacherGapMaxMs: 3_000,
      falseStartChance: 0.05,
    };

    log('\n[1/4] 테스트 계정 로그인 및 안전 확인...');
    const tClient = makeClient(url, anonKey, 'teacher');
    {
      const error = await signInWithRetry(tClient, accounts.teacher.email, accounts.teacher.password, log);
      if (error) throw new Error(`선생님 테스트 계정 로그인 실패: ${error.message}`);
      const { data, error: ctxErr } = await tClient.rpc('get_current_user_context');
      const ctx = Array.isArray(data) ? data[0] : data;
      if (ctxErr || !ctx?.is_teacher || ctx.classroom_name !== LOADTEST_CLASSROOM_NAME) {
        throw new Error(`안전 확인 실패: 선생님 계정이 "${LOADTEST_CLASSROOM_NAME}" 학급이 아닙니다. (${ctx?.classroom_name ?? ctxErr?.message})`);
      }
      teacher = new TeacherSim(tClient, ctx);
      log(`  선생님 OK — 학급 #${ctx.classroom_id} ${ctx.classroom_name}`);
    }
    for (let i = 0; i < studentCount; i++) {
      const acc = accounts.students[i];
      const c = makeClient(url, anonKey, `s${i + 1}`);
      const error = await signInWithRetry(c, acc.email, acc.password, log);
      if (error) throw new Error(`${acc.email} 로그인 실패: ${error.message}`);
      const { data, error: ctxErr } = await c.rpc('get_current_user_context');
      const ctx = Array.isArray(data) ? data[0] : data;
      if (ctxErr || !ctx?.student_id || ctx.classroom_id !== teacher.classroomId) throw new Error(`안전 확인 실패: ${acc.email}이 테스트 학급 학생이 아닙니다.`);
      students.push(new StudentSim(i + 1, c, ctx, shared, opts));
      await sleep(60);
    }
    log(`  학생 ${students.length}명 OK`);

    log('\n[2/4] 테스트용 아케이드 기간 준비 (월간 기간 생성 → 인증 단계)...');
    shared.periodId = await teacher.setupPeriod(log);

    const go = (await rl.question(`\n대기 방식: ${opts.waitMode === 'F5' ? '새로고침(F5) 반복' : '조용히 대기'}. 시작하려면 YES 입력: `)).trim();
    if (go !== 'YES') { log('취소했습니다.'); return; }
    rl.close();

    log('\n[3/4] 실행 중... (Ctrl+C = 안전 중단)');
    for (const m of Object.values(M)) { m.lat.length = 0; m.ok = m.biz = m.sys = 0; m.bizCodes.clear(); m.sysSamples.clear(); }
    let running = true;
    const isRunning = () => running;
    let interrupted = false;
    const onSigint = () => { if (!running) return; interrupted = true; running = false; log('\n  [중단 요청] 정리 중...'); };
    process.on('SIGINT', onSigint);
    const startedIso = new Date().toISOString();
    const wallStart = Date.now();
    const ticker = setInterval(() => {
      const el = Math.max(1, (Date.now() - wallStart) / 1000);
      const sys = Object.values(M).reduce((a, m) => a + m.sys, 0);
      output.write(`\r  ${fmt(el).padStart(4)}s | 열린 도전 ${shared.sessionOpenedAt.size}/${students.length} | 플레이 ${counters.runs} | 인정 ${counters.accepted} | 완료 학생 ${counters.finishedStudents} | 새로고침 ${counters.boots} | 제출 p95 ${fmt(percentile(M.submitRun.lat, 95))}ms | 시스템오류 ${sys}     `);
    }, 1_000);

    const studentRuns = students.map((s) => s.run(isRunning));
    await sleep(6_000); // 학생들이 먼저 아케이드 화면에 들어와 있는 상황
    const teacherRun = teacher.openSessions(shared.periodId, students, shared, opts, isRunning, log);
    const overviewTimer = setInterval(() => void teacher.overview(shared.periodId), 10_000); // 선생님이 현황 확인
    const hardStop = setTimeout(() => { if (running) { running = false; log('\n  [시간 제한] 10분이 지나 종료합니다.'); } }, 10 * 60_000);
    await teacherRun;
    await Promise.allSettled(studentRuns);
    running = false;
    clearTimeout(hardStop);
    clearInterval(overviewTimer);
    clearInterval(ticker);
    process.off('SIGINT', onSigint);
    const elapsedSec = (Date.now() - wallStart) / 1000;
    await teacher.closeSessions(shared);

    // ---------------- 결과
    log('\n\n[4/4] 결과 정리...');
    const sysTotal = Object.values(M).reduce((a, m) => a + m.sys, 0);
    const callsTotal = Object.values(M).reduce((a, m) => a + m.ok + m.biz + m.sys, 0);
    const timeMismatch = counters.rejectCodes.get('SERVER_TIME_MISMATCH') ?? 0;
    const results = students.reduce((acc, s) => { acc[s.result] = (acc[s.result] ?? 0) + 1; return acc; }, {});
    const verdict = [
      ['공인 도전 시작 p95', `${fmt(percentile(M.createRun.lat, 95))}ms`, grade(percentile(M.createRun.lat, 95), 1_000, 3_000)],
      ['게임 시작 p95', `${fmt(percentile(M.beginRun.lat, 95))}ms`, grade(percentile(M.beginRun.lat, 95), 1_000, 3_000)],
      ['기록 제출 p95', `${fmt(percentile(M.submitRun.lat, 95))}ms`, grade(percentile(M.submitRun.lat, 95), 1_500, 4_000)],
      ['화면 열기(새로고침 1회) 완료 p95', `${fmt(percentile(counters.bootTotalMs, 95))}ms`, grade(percentile(counters.bootTotalMs, 95), 3_000, 8_000)],
      ['시스템 오류(시간초과/5xx/앱 대기열 초과)', `${sysTotal}건 / ${callsTotal}건`, grade(callsTotal ? (sysTotal / callsTotal) * 100 : 0, 0, 1)],
      ['서버 시간 불일치로 불인정된 기록', `${timeMismatch}건`, grade(timeMismatch, 0, 0)],
      ['멈춘 도전(선생님 취소가 필요한 상태)', `${counters.stuck}건`, grade(counters.stuck, 0, 0)],
    ];
    const overall = verdict.some((v) => v[2] === '나쁨') ? '나쁨' : verdict.some((v) => v[2] === '주의') ? '주의' : '좋음';
    const lines = [];
    lines.push('B.R.A.N.D 2.0 아케이드 공인 도전 부하 테스트 결과');
    lines.push('==================================================');
    lines.push(`종합 판정: ${overall}${interrupted ? ' (중간 중단됨)' : ''}`);
    lines.push(`대기 방식: ${opts.waitMode === 'F5' ? '새로고침(F5) 반복 (10~25초마다)' : '조용히 대기 (15초마다 상태만 확인)'}`);
    lines.push('');
    for (const [k, v, g] of verdict) lines.push(`  [${g}] ${k}: ${v}`);
    lines.push('');
    lines.push(`실행 시간 ${elapsedSec.toFixed(1)}초 | 학생 ${students.length}명 | 전체 요청 ${callsTotal}건 (${(callsTotal / elapsedSec).toFixed(2)}/초)`);
    lines.push(`새로고침(앱 다시 열기) ${counters.boots}회 | 플레이 ${counters.runs}회 → 인정 ${counters.accepted}회`);
    lines.push(`불인정 사유: ${[...counters.rejectCodes.entries()].map(([k, v]) => `${k} x${v}`).join(', ') || '없음'} (FALSE_START는 테스트가 일부러 5% 섞은 부정 출발)`);
    lines.push(`학생 결과: ${Object.entries(results).map(([k, v]) => `${k} ${v}명`).join(', ')}`);
    lines.push(`선생님이 열어준 뒤 학생 화면에 보이기까지: 평균 ${fmt(avg(counters.noticeLagMs))}ms, 최대 ${fmt(Math.max(0, ...counters.noticeLagMs))}ms`);
    lines.push('');
    lines.push('요청 종류별 상세');
    for (const m of Object.values(M)) {
      const s = m.summary();
      if (!s.calls) continue;
      lines.push(`  ${m.label}: ${s.calls}건 | 성공 ${s.ok} | 업무거절 ${s.business_rejects} | 시스템오류 ${s.system_errors} | 평균 ${s.avg_ms} / p95 ${s.p95_ms} / 최대 ${s.max_ms} ms`);
      if (s.top_business_rejects.length) lines.push(`      업무거절 예: ${s.top_business_rejects.join(' ; ')}`);
      if (s.system_error_samples.length) lines.push(`      시스템오류 예: ${s.system_error_samples.join(' ; ')}`);
    }
    lines.push('');
    lines.push('※ 이 REPORT.txt를 Claude에게 붙여넣으면 분석해 드립니다.');
    const report = lines.join('\n');
    console.log(`\n${report}\n`);
    fs.mkdirSync(RESULT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `arcade_verify_${students.length}p_${opts.waitMode}_${stamp}`;
    fs.writeFileSync(path.join(RESULT_DIR, `${base}_REPORT.txt`), report, 'utf8');
    fs.writeFileSync(path.join(RESULT_DIR, `${base}.json`), JSON.stringify({
      tester_version: TESTER_VERSION, started_at: startedIso, period_id: shared.periodId, opts, verdict,
      metrics: Object.fromEntries(Object.entries(M).map(([k, m]) => [k, { label: m.label, ...m.summary() }])),
    }, null, 2), 'utf8');
    console.log(`결과 저장: ${path.join(RESULT_DIR, `${base}_REPORT.txt`)}\n`);
  } finally {
    try { rl.close(); } catch { /* already closed */ }
    for (const s of students) await s.client.auth.signOut().catch(() => {});
    if (teacher) await teacher.client.auth.signOut().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\n[ARCADE LOAD TESTER ERROR] ${err?.message ?? err}`);
  process.exitCode = 1;
});
