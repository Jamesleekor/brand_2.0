// =====================================================================
// B.R.A.N.D 모험가 도구함 — 24명 동시 참여 부하 테스트
// ---------------------------------------------------------------------
// 반드시 부하 테스트 전용 학급(B.R.A.N.D LOADTEST)에서만 실행한다.
//  1) LOADTEST 교사 계정 + 학생 계정(CSV)으로 각각 로그인
//  2) 버저: 학생 전원이 실시간 신호를 받는 시간 / 동시 입력 누락·중복 / 부정출발 잠금
//  3) 투표: 동시 제출 누락·중복
//  4) 카드 구름: 동시 제출 누락·중복
//  5) 만든 활동을 모두 지우고 결과를 results/ 에 저장
// 운영 학급(5학년 4반) 데이터에는 접근하지 않는다.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = process.cwd();
const TOOL_DIR = path.join(PROJECT_ROOT, 'tools', 'toolbox-load-tester');
const RESULT_DIR = path.join(TOOL_DIR, 'results');
const CREDS_FILE = path.join(TOOL_DIR, 'TOOLBOX_LOAD_TEST_CREDENTIALS.csv');
const LOADTEST_CLASSROOM_NAME = 'B.R.A.N.D LOADTEST';

const LIMITS = {
  buzzerShowMs: 1000,   // 마지막 입력 → 교사 화면 신호까지
  roundOpenFanoutMs: 2000, // 라운드 열기 → 학생 전원 신호 수신
  voteMs: 2000,
  cardMs: 3000,
};

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

function csvSplit(line) {
  const cells = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function loadCredentials() {
  if (!fs.existsSync(CREDS_FILE)) throw new Error(`자격 증명 파일이 없습니다: ${CREDS_FILE}\n(같은 폴더의 .sample.csv를 복사해 채워 주세요)`);
  let raw = fs.readFileSync(CREDS_FILE);
  let text = raw.toString('utf8');
  if ((text.match(/�/g) ?? []).length > 0) text = new TextDecoder('euc-kr').decode(raw);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((x) => x.trim());
  const header = csvSplit(lines[0]).map((x) => x.toLowerCase());
  const n = header.indexOf('student_name'); const p = header.indexOf('password'); const c = header.indexOf('classroom_id');
  if (n < 0 || p < 0) throw new Error('CSV 헤더에 student_name,password가 필요합니다.');
  return lines.slice(1).map((l) => csvSplit(l)).filter((r) => r[n] && r[p])
    .map((r) => ({ studentName: r[n], password: r[p], classroomId: c >= 0 && r[c] ? Number(r[c]) : null }));
}

const syntheticEmail = (name, classroomId) =>
  `${Array.from(name.trim()).map((ch) => ch.codePointAt(0).toString(16).padStart(4, '0')).join('')}@cls${classroomId}.brand.local`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (v, p) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };

function makeClient(url, key, label) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': `brand-toolbox-load-tester:${label}` } },
    realtime: { params: { apikey: key } },
  });
}

async function rpc(client, fn, args) {
  const t0 = performance.now();
  const { data, error } = await client.rpc(fn, args ?? {});
  const ms = performance.now() - t0;
  if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code, ms });
  return { data, ms };
}

/** 신호 행을 구독하고, 다음 신호가 조건을 만족할 때 도착 시각을 알려준다. */
function subscribePulse(client, key) {
  const waiters = [];
  const channel = client.channel(`lt-pulse:${key}:${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'toolbox_pulse', filter: `pulse_key=eq.${key}` }, (msg) => {
      const now = performance.now();
      for (const w of [...waiters]) if (w.match(msg.new?.payload ?? {})) { waiters.splice(waiters.indexOf(w), 1); w.resolve(now); }
    });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('실시간 구독 시간 초과')), 15_000);
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); } if (status === 'CHANNEL_ERROR') { clearTimeout(t); reject(new Error('실시간 구독 실패')); } });
  });
  return {
    ready,
    next: (match, timeoutMs = 10_000) => new Promise((resolve) => {
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, timeoutMs);
    }),
    close: () => client.removeChannel(channel),
  };
}

async function main() {
  console.log('============================================================');
  console.log(' B.R.A.N.D 모험가 도구함 — 24명 동시 참여 부하 테스트');
  console.log('============================================================');
  const env = { ...parseEnvFile(path.join(PROJECT_ROOT, '.env')), ...parseEnvFile(path.join(PROJECT_ROOT, '.env.local')) };
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('.env.local에서 VITE_SUPABASE_URL / 공개 키를 찾지 못했습니다.');

  const rl = readline.createInterface({ input, output });
  const teacherEmail = process.env.TOOLBOX_LT_TEACHER_EMAIL || (await rl.question('LOADTEST 교사 이메일: ')).trim();
  const teacherPassword = process.env.TOOLBOX_LT_TEACHER_PASSWORD || (await rl.question('LOADTEST 교사 비밀번호: ')).trim();
  rl.close();

  // ---------- 교사 로그인 + 학급 확인 ----------
  const teacher = makeClient(url, key, 'teacher');
  const { error: tErr } = await teacher.auth.signInWithPassword({ email: teacherEmail, password: teacherPassword });
  if (tErr) throw new Error(`교사 로그인 실패: ${tErr.message}`);
  const hub = (await rpc(teacher, 'teacher_toolbox_hub')).data;
  let { data: cls } = await teacher.from('classrooms').select('id,name').eq('id', hub.classroom_id).maybeSingle();
  if (!cls) {
    const { data: ctx } = await teacher.rpc('get_current_user_context');
    const row = Array.isArray(ctx) ? ctx[0] : ctx;
    if (row?.classroom_id === hub.classroom_id) cls = { id: row.classroom_id, name: row.classroom_name };
  }
  if (!cls || cls.name !== LOADTEST_CLASSROOM_NAME) {
    throw new Error(`이 교사 계정의 학급은 「${cls?.name ?? hub.classroom_id}」예요. 「${LOADTEST_CLASSROOM_NAME}」 교사 계정으로만 실행할 수 있어요.`);
  }
  const classroomId = cls.id;
  console.log(`[OK] 교사 로그인 — 학급 ${cls.name} (#${classroomId})`);

  // ---------- 학생 로그인 ----------
  const creds = loadCredentials();
  const students = [];
  await Promise.all(creds.map(async (cr) => {
    const client = makeClient(url, key, cr.studentName);
    const { error } = await client.auth.signInWithPassword({ email: syntheticEmail(cr.studentName, cr.classroomId ?? classroomId), password: cr.password });
    if (error) { console.log(`  [실패] ${cr.studentName}: ${error.message}`); return; }
    const { data: me } = await client.rpc('get_current_user_context');
    const row = Array.isArray(me) ? me[0] : me;
    if (!row || row.classroom_id !== classroomId) { console.log(`  [건너뜀] ${cr.studentName}: LOADTEST 학급 학생이 아니에요`); return; }
    students.push({ name: cr.studentName, id: row.student_id, client });
  }));
  if (students.length < 2) throw new Error('로그인한 LOADTEST 학생이 2명보다 적어요.');
  console.log(`[OK] 학생 ${students.length}명 로그인`);

  const report = { started_at: new Date().toISOString(), classroom: cls.name, students: students.length, checks: [] };
  const check = (name, pass, detail) => { report.checks.push({ name, pass, detail }); console.log(`${pass ? '  ✅' : '  ❌'} ${name} — ${detail}`); };
  const created = [];

  try {
    // ================= 버저 =================
    console.log('\n[버저] 개인전 · 점수판 연결');
    const units = students.map((s) => ({ key: `s${s.id}`, type: 'STUDENT', label: s.name, student_id: s.id }));
    const board = (await rpc(teacher, 'teacher_toolbox_create', { p_kind: 'SCOREBOARD', p_title: '부하 점수판', p_config: {}, p_participants: units, p_open: true })).data.id;
    created.push(board);
    const bz = (await rpc(teacher, 'teacher_toolbox_create', { p_kind: 'BUZZER', p_title: '부하 버저', p_config: { scoreboard_id: board, points: 5 }, p_participants: units, p_open: true })).data.id;
    created.push(bz);

    const studentPulses = students.map((s) => subscribePulse(s.client, `${classroomId}-S`));
    const teacherPulse = subscribePulse(teacher, `${classroomId}-T`);
    await Promise.all([...studentPulses.map((p) => p.ready), teacherPulse.ready]);

    // 부정출발: 앞의 3명이 라운드 전에 누른다
    const early = students.slice(0, 3);
    const fs1 = await Promise.all(early.map((s) => rpc(s.client, 'student_toolbox_buzz', { p_id: bz })));
    check('부정출발 잠금', fs1.every((r) => r.data.result === 'FALSE_START'), fs1.map((r) => r.data.result).join(','));

    // 라운드 열기 → 학생 전원 신호 도착 시간
    const waits = studentPulses.map((p) => p.next((pl) => Number(pl.activity_id) === bz && pl.round_status === 'OPEN'));
    const t0 = performance.now();
    await rpc(teacher, 'teacher_toolbox_buzzer', { p_id: bz, p_action: 'OPEN_ROUND', p_args: { points: 100 } });
    const arrivals = (await Promise.all(waits)).map((t) => (t === null ? null : t - t0));
    const missing = arrivals.filter((x) => x === null).length;
    const got = arrivals.filter((x) => x !== null);
    check('라운드 열림 신호 전원 수신', missing === 0 && pct(got, 100) <= LIMITS.roundOpenFanoutMs,
      `미수신 ${missing}명, p50 ${pct(got, 50).toFixed(0)}ms, 최대 ${pct(got, 100).toFixed(0)}ms (기준 ${LIMITS.roundOpenFanoutMs}ms)`);

    // 동시 입력: 각자 0~500ms 사이에 2번씩 누른다
    const lastPressTeacherSignal = teacherPulse.next((pl) => Number(pl.activity_id) === bz && pl.event === 'PRESS', 15_000);
    const pressLat = []; const results = [];
    await Promise.all(students.map(async (s) => {
      await sleep(Math.random() * 500);
      for (let k = 0; k < 2; k++) {
        try { const r = await rpc(s.client, 'student_toolbox_buzz', { p_id: bz }); pressLat.push(r.ms); results.push(r.data.result); }
        catch (e) { results.push(`ERR:${e.message}`); }
      }
    }));
    const lastPressAt = performance.now();
    await lastPressTeacherSignal;
    const state = (await rpc(teacher, 'teacher_toolbox_state', { p_id: bz })).data;
    const ranks = (state.presses ?? []).map((p) => p.rank).sort((a, b) => a - b);
    const expected = students.length - early.length; // 잠긴 3명은 5초 동안 못 누름 (테스트는 그 안에 끝남)
    const uniqueOk = ranks.length === new Set(ranks).size && ranks.every((r, i) => r === i + 1);
    check('버저 동시 입력 누락·중복 없음', uniqueOk && ranks.length >= expected - 0,
      `접수 ${ranks.length}건 (잠금 제외 기대 ${expected}건 이상), 순위 연속 ${uniqueOk}, 결과 ${summarize(results)}`);
    check('버저 입력 응답 시간', pct(pressLat, 95) <= LIMITS.buzzerShowMs, `p50 ${pct(pressLat, 50).toFixed(0)}ms, p95 ${pct(pressLat, 95).toFixed(0)}ms`);
    const t1 = performance.now();
    await rpc(teacher, 'teacher_toolbox_state', { p_id: bz });
    check('교사 화면 순서 표시', performance.now() - lastPressAt <= LIMITS.buzzerShowMs + 500, `마지막 입력 후 ${(performance.now() - lastPressAt).toFixed(0)}ms (상태 조회 ${(performance.now() - t1).toFixed(0)}ms)`);

    // 정답 → 점수판
    const first = state.presses[0];
    await rpc(teacher, 'teacher_toolbox_buzzer', { p_id: bz, p_action: 'JUDGE', p_args: { unit_key: first.unit_key, verdict: 'CORRECT' } });
    const bstate = (await rpc(teacher, 'teacher_toolbox_state', { p_id: board })).data;
    check('정답 배점 점수판 반영', Number(bstate.state.scores[first.unit_key]) === 100, `${first.student_name} → ${bstate.state.scores[first.unit_key]}점`);
    await rpc(teacher, 'teacher_toolbox_buzzer', { p_id: bz, p_action: 'CLOSE_ROUND' });
    studentPulses.forEach((p) => p.close());

    // ================= 투표 =================
    console.log('\n[투표] 다지선다 동시 제출');
    const vt = (await rpc(teacher, 'teacher_toolbox_create', { p_kind: 'VOTE', p_title: '부하 투표', p_participants: [], p_open: true,
      p_config: { mode: 'MULTI', eligible: students.map((s) => s.id), options: [{ label: '가' }, { label: '나' }, { label: '다' }], allow_abstain: true } })).data.id;
    created.push(vt);
    const voteLat = []; const voteErr = [];
    await Promise.all(students.map(async (s, i) => {
      await sleep(Math.random() * 300);
      try { const r = await rpc(s.client, 'student_toolbox_vote_submit', { p_id: vt, p_choices: [['O1', 'O2', 'O3', 'ABSTAIN'][i % 4]] }); voteLat.push(r.ms); }
      catch (e) { voteErr.push(e.message); }
      // 같은 학생이 한 번 더 제출(수정) — 표가 늘어나면 안 된다
      try { await rpc(s.client, 'student_toolbox_vote_submit', { p_id: vt, p_choices: ['O1'] }); } catch (e) { voteErr.push(e.message); }
    }));
    const vstate = (await rpc(teacher, 'teacher_toolbox_state', { p_id: vt })).data;
    check('투표 누락·중복 없음', vstate.tally.submitted === students.length && voteErr.length === 0, `제출 ${vstate.tally.submitted}/${students.length}, 오류 ${voteErr.length}`);
    check('투표 응답 시간', pct(voteLat, 95) <= LIMITS.voteMs, `p50 ${pct(voteLat, 50).toFixed(0)}ms, p95 ${pct(voteLat, 95).toFixed(0)}ms`);

    // ================= 카드 =================
    console.log('\n[카드 구름] 동시 제출');
    const cd = (await rpc(teacher, 'teacher_toolbox_create', { p_kind: 'CARDS', p_title: '부하 카드', p_participants: [], p_open: true,
      p_config: { eligible: students.map((s) => s.id), prompt: '부하 테스트' } })).data.id;
    created.push(cd);
    const cardLat = []; const cardErr = [];
    await Promise.all(students.map(async (s, i) => {
      await sleep(Math.random() * 300);
      try { const r = await rpc(s.client, 'student_toolbox_card_submit', { p_id: cd, p_title: `카드 ${i + 1}`, p_body: '부하 테스트 내용 '.repeat(20) }); cardLat.push(r.ms); }
      catch (e) { cardErr.push(e.message); }
      try { await rpc(s.client, 'student_toolbox_card_submit', { p_id: cd, p_title: `카드 ${i + 1} 수정`, p_body: '고친 내용' }); } catch (e) { cardErr.push(e.message); }
    }));
    const cstate = (await rpc(teacher, 'teacher_toolbox_state', { p_id: cd })).data;
    check('카드 누락·중복 없음', cstate.cards.length === students.length && cardErr.length === 0, `카드 ${cstate.cards.length}/${students.length}, 오류 ${cardErr.length}`);
    check('카드 응답 시간', pct(cardLat, 95) <= LIMITS.cardMs, `p50 ${pct(cardLat, 50).toFixed(0)}ms, p95 ${pct(cardLat, 95).toFixed(0)}ms`);
    teacherPulse.close();
  } finally {
    for (const id of created.reverse()) { try { await rpc(teacher, 'teacher_toolbox_delete', { p_id: id }); } catch { /* 이미 지워짐 */ } }
    console.log(`\n[정리] 테스트로 만든 활동 ${created.length}개를 지웠어요.`);
  }

  report.finished_at = new Date().toISOString();
  report.pass = report.checks.every((c) => c.pass);
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(RESULT_DIR, `TOOLBOX_LOAD_${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(RESULT_DIR, `TOOLBOX_LOAD_${stamp}_REPORT.txt`),
    [`모험가 도구함 부하 테스트 — ${report.pass ? '통과' : '확인 필요'}`, `학급 ${report.classroom}, 학생 ${report.students}명`, '',
      ...report.checks.map((c) => `${c.pass ? '[통과]' : '[실패]'} ${c.name}: ${c.detail}`)].join('\r\n'));
  console.log(`\n결과: ${report.pass ? '모두 통과' : '실패 항목이 있어요'} — tools/toolbox-load-tester/results/`);
  process.exit(report.pass ? 0 : 2);
}

function summarize(list) {
  const m = new Map(); for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join(' ');
}

main().catch((e) => { console.error(`\n[오류] ${e.message}`); process.exit(1); });
