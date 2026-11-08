// =====================================================================
// B.R.A.N.D 퀴즈 로얄 — 다중 클라이언트 통합 시험 (교사 1 + 길드 태블릿 N)
// ---------------------------------------------------------------------
// 반드시 부하 테스트 전용 학급(B.R.A.N.D LOADTEST)에서만 실행한다.
// 운영 학급(5학년 4반) 데이터에는 접근하지 않는다. 리허설 대회를 만들고 끝나면 지운다.
//  1) LOADTEST 교사 + 길드 대표 학생 계정(CSV) 로그인
//  2) 대기실 → 태블릿 접속 표시 → 경기 시작
//  3) 문제 시작 신호가 태블릿 전원에 도착하는 시간(2초 이하)
//  4) 동시 제출(대표마다 3번 연타) → 길드당 정확히 1건, 모두 내면 자동 마감
//  5) 일시정지 중 제출 거절 · 재개 뒤 남은 시간 유지
//  6) 시간 종료(+유예) 뒤 제출 거절
//  7) 중계 화면 응답에 정답·미공개 답안이 섞이지 않는지 단계마다 확인
//  8) 학생 계정으로 문제·답안 표 직접 읽기 거절
//  9) 채점 확정 연타 → 점수 1번만, 발표 → 종료 → 리허설 삭제
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = process.cwd();
const TOOL_DIR = path.join(PROJECT_ROOT, 'tools', 'quiz-royal-load-tester');
const RESULT_DIR = path.join(TOOL_DIR, 'results');
const CREDS_FILE = path.join(TOOL_DIR, 'QUIZ_LOAD_TEST_CREDENTIALS.csv');
const FALLBACK_CREDS = path.join(PROJECT_ROOT, 'tools', 'toolbox-load-tester', 'TOOLBOX_LOAD_TEST_CREDENTIALS.csv');
const LOADTEST_CLASSROOM_NAME = 'B.R.A.N.D LOADTEST';
const LIMITS = { fanoutMs: 2000, submitP95Ms: 1000, teacherActionP95Ms: 1200 };

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
  const file = fs.existsSync(CREDS_FILE) ? CREDS_FILE : FALLBACK_CREDS;
  if (!fs.existsSync(file)) throw new Error(`자격 증명 파일이 없습니다: ${CREDS_FILE}\n(같은 폴더의 .sample.csv를 복사해 채우거나, 도구함 부하 테스트 CSV를 그대로 써도 돼요)`);
  const raw = fs.readFileSync(file);
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
    global: { headers: { 'x-application-name': `brand-quiz-load-tester:${label}` } },
    realtime: { params: { apikey: key } },
  });
}

const timings = { submit: [], teacher: [] };
async function rpc(client, fn, args, bucket) {
  const t0 = performance.now();
  const { data, error } = await client.rpc(fn, args ?? {});
  const ms = performance.now() - t0;
  if (bucket) timings[bucket].push(ms);
  if (error) throw Object.assign(new Error(`${fn}: ${error.message}`), { code: error.code, ms });
  return data;
}
async function rpcErr(client, fn, args) {
  const { error } = await client.rpc(fn, args ?? {});
  return error ? error.code : null;
}

function subscribePulse(client, key) {
  const waiters = [];
  const channel = client.channel(`qlt:${key}:${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_pulse', filter: `pulse_key=eq.${key}` }, (msg) => {
      const now = performance.now();
      for (const w of [...waiters]) if (w.match(msg.new?.payload ?? {})) { waiters.splice(waiters.indexOf(w), 1); w.resolve(now); }
    });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('실시간 구독 시간 초과')), 15_000);
    channel.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); } if (status === 'CHANNEL_ERROR') { clearTimeout(t); reject(new Error('실시간 구독 실패(권한?)')); } });
  });
  return {
    ready,
    next: (match, timeoutMs = 8_000) => new Promise((resolve) => {
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, timeoutMs);
    }),
    close: () => client.removeChannel(channel),
  };
}

function screenLeaks(sc) {
  // 확정 전에는 정답이, 공개 전에는 답안 원문이 없어야 한다
  const issues = [];
  if (sc.question?.answer_key && sc.q_phase !== 'GRADED') issues.push(`정답 노출(${sc.q_phase})`);
  if (!['REVEALED', 'GRADED'].includes(sc.q_phase) && (sc.guilds ?? []).some((g) => g.answer)) issues.push(`답안 노출(${sc.q_phase})`);
  if (sc.q_phase === 'IDLE' && sc.question?.prompt) issues.push('시작 전 지문 노출');
  return issues;
}

async function main() {
  console.log('============================================================');
  console.log(' B.R.A.N.D 퀴즈 로얄 — 다중 클라이언트 통합 시험');
  console.log('============================================================');
  const env = { ...parseEnvFile(path.join(PROJECT_ROOT, '.env')), ...parseEnvFile(path.join(PROJECT_ROOT, '.env.local')) };
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('.env.local에서 VITE_SUPABASE_URL / 공개 키를 찾지 못했습니다.');

  const rl = readline.createInterface({ input, output });
  const teacherEmail = process.env.QUIZ_LT_TEACHER_EMAIL || (await rl.question('LOADTEST 교사 이메일: ')).trim();
  const teacherPassword = process.env.QUIZ_LT_TEACHER_PASSWORD || (await rl.question('LOADTEST 교사 비밀번호: ')).trim();
  rl.close();

  const teacher = makeClient(url, key, 'teacher');
  const { error: tErr } = await teacher.auth.signInWithPassword({ email: teacherEmail, password: teacherPassword });
  if (tErr) throw new Error(`교사 로그인 실패: ${tErr.message}`);
  const { data: ctx } = await teacher.rpc('get_current_user_context');
  const ctxRow = Array.isArray(ctx) ? ctx[0] : ctx;
  const classroomId = ctxRow?.classroom_id;
  const { data: cls } = await teacher.from('classrooms').select('id,name').eq('id', classroomId).maybeSingle();
  const clsName = cls?.name ?? ctxRow?.classroom_name;
  if (clsName !== LOADTEST_CLASSROOM_NAME) throw new Error(`이 교사 계정의 학급은 「${clsName ?? classroomId}」예요. 「${LOADTEST_CLASSROOM_NAME}」 교사 계정으로만 실행할 수 있어요.`);
  console.log(`[OK] 교사 로그인 — ${clsName} (#${classroomId})`);

  // LOADTEST 학급 길드·길드원
  const { data: guildRows } = await teacher.from('guilds').select('id,name,is_active').eq('classroom_id', classroomId).eq('is_active', true).order('id');
  const guildIds = (guildRows ?? []).map((g) => g.id);
  const { data: memberRows } = guildIds.length ? await teacher.from('guild_members').select('guild_id,student_id').in('guild_id', guildIds).is('left_at', null) : { data: [] };
  if ((guildRows ?? []).length < 2) {
    throw new Error('LOADTEST 학급에 활성 길드가 2개 이상 필요해요. 교사 패널 → 길드 관리에서 LOADTEST 학급에 길드 5개를 만들고 학생을 나눠 배정한 뒤 다시 실행해 주세요.');
  }

  // 학생 로그인 → 길드마다 대표 1명
  const creds = loadCredentials();
  const logged = [];
  await Promise.all(creds.map(async (cr) => {
    const client = makeClient(url, key, cr.studentName);
    const { error } = await client.auth.signInWithPassword({ email: syntheticEmail(cr.studentName, cr.classroomId ?? classroomId), password: cr.password });
    if (error) return;
    const { data: me } = await client.rpc('get_current_user_context');
    const row = Array.isArray(me) ? me[0] : me;
    if (!row || row.classroom_id !== classroomId) return;
    logged.push({ name: cr.studentName, id: row.student_id, client });
  }));
  const devices = [];
  for (const g of guildRows.slice(0, 8)) {
    const members = (memberRows ?? []).filter((m) => m.guild_id === g.id).map((m) => m.student_id);
    const dev = logged.find((s) => members.includes(s.id) && !devices.some((d) => d.id === s.id));
    if (dev) devices.push({ ...dev, guild_id: g.id, guild: g.name, members });
  }
  if (devices.length < 2) throw new Error('길드 대표로 쓸 수 있는 로그인 학생이 2명보다 적어요(CSV 학생이 길드에 배정되어 있는지 확인).');
  console.log(`[OK] 길드 태블릿 ${devices.length}대: ${devices.map((d) => `${d.guild}=${d.name}`).join(', ')}`);

  const report = { started_at: new Date().toISOString(), classroom: clsName, devices: devices.length, checks: [] };
  const check = (name, pass, detail = '') => { report.checks.push({ name, pass, detail }); console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`); };
  let quizId = null;
  const pulses = [];

  try {
    // ---------- 준비 ----------
    quizId = (await rpc(teacher, 'teacher_quiz_create', { p_title: '부하 시험(자동 삭제)', p_is_rehearsal: true })).id;
    await rpc(teacher, 'teacher_quiz_save_setup', {
      p_id: quizId, p_title: '부하 시험(자동 삭제)', p_is_rehearsal: true,
      p_config: { positions: ['선봉', '차봉'], use_individual: true, use_team: true, checkpoint_ind: 2, checkpoint_team: 0, grace_ms: 1000 },
      p_guilds: devices.map((d) => ({ guild_id: d.guild_id, device_student_id: d.id })),
    });
    const qs = [
      { stage: 'INDIVIDUAL', position_index: 0, prompt: '시험 1', answer_key: '답', time_limit_sec: 30 },
      { stage: 'INDIVIDUAL', position_index: 0, prompt: '시험 2(일시정지)', answer_key: '답', time_limit_sec: 30 },
      { stage: 'INDIVIDUAL', position_index: 1, prompt: '시험 3(시간 종료)', answer_key: '답', time_limit_sec: 5 },
      { stage: 'TEAM', prompt: '단체 1', answer_key: '단체답', time_limit_sec: 30 },
    ];
    await rpc(teacher, 'teacher_quiz_save_questions', { p_id: quizId, p_questions: qs, p_mode: 'REPLACE' });
    await rpc(teacher, 'teacher_quiz_set_roster', {
      p_id: quizId, p_rows: devices.flatMap((d) => [0, 1].map((i) => ({ guild_id: d.guild_id, position_index: i, student_id: d.members[i % d.members.length] }))),
    });
    await rpc(teacher, 'teacher_quiz_open_lobby', { p_id: quizId, p_open: true });

    // 학생 직접 읽기 거절
    const direct = await devices[0].client.from('quiz_questions').select('id').limit(1);
    check('학생 계정으로 문제 표 직접 읽기 거절', !!direct.error, direct.error?.code ?? '읽힘!');
    const direct2 = await devices[0].client.from('quiz_answers').select('answer').limit(1);
    check('학생 계정으로 답안 표 직접 읽기 거절', !!direct2.error, direct2.error?.code ?? '읽힘!');

    // 태블릿 접속 + 신호 구독
    const feeds = await Promise.all(devices.map((d) => rpc(d.client, 'student_quiz_feed')));
    check('대표 계정 도구함에 퀴즈 입구 표시', feeds.every((f) => f.events.some((e) => e.id === quizId)));
    for (const d of devices) { const p = subscribePulse(d.client, `Q${quizId}-D`); pulses.push(p); d.pulse = p; }
    await Promise.all(pulses.map((p) => p.ready));
    await Promise.all(devices.map((d) => rpc(d.client, 'student_quiz_state', { p_id: quizId })));
    const st0 = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    check('대기실: 태블릿 전원 접속 표시', st0.offline.length === 0, st0.offline.join(', '));
    await rpc(teacher, 'teacher_quiz_start', { p_id: quizId }, 'teacher');

    const cur = async () => { const s = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId }); const q = s.questions.find((x) => x.id === s.event.current_question_id); return { s, q }; };
    const screen = async (label) => { const sc = await rpc(teacher, 'teacher_quiz_screen_state', { p_id: quizId }); const issues = screenLeaks(sc); if (issues.length) check(`중계 화면 비공개 유지(${label})`, false, issues.join(', ')); return sc; };
    let leakChecks = 0;

    // ---------- Q1: 신호 도착 + 동시 제출 ----------
    let { q } = await cur();
    await screen('Q1 시작 전'); leakChecks++;
    const waits = devices.map((d) => d.pulse.next((p) => p.event === 'START' && p.q_phase === 'LIVE'));
    const tStart = performance.now();
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'START', p_args: {} }, 'teacher');
    const arrivals = await Promise.all(waits);
    const fan = arrivals.map((t) => (t === null ? Infinity : t - tStart));
    check('문제 시작 신호가 태블릿 전원에 도착', Math.max(...fan) <= LIMITS.fanoutMs, `최대 ${Math.round(Math.max(...fan))}ms`);
    const states = await Promise.all(devices.map((d) => rpc(d.client, 'student_quiz_state', { p_id: quizId })));
    check('태블릿: 지문 수신 · 정답 미포함', states.every((s) => s.question?.prompt === '시험 1' && !s.question?.answer_key));
    await screen('Q1 진행 중'); leakChecks++;
    await Promise.all(devices.flatMap((d) => [1, 2, 3].map((k) => rpc(d.client, 'student_quiz_submit', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_answer: k === 1 ? '답' : `연타${k}` }, 'submit').catch(() => null))));
    ({ q } = await cur());
    let s1 = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    const a1 = s1.answers.filter((a) => a.question_id === q.id && a.submitted_at);
    check('동시 제출(대표마다 3번 연타) → 길드당 1건', a1.length === devices.length, `${a1.length}/${devices.length}`);
    check('모두 제출하면 자동 마감', s1.event.q_phase === 'LOCKED', s1.event.q_phase);
    await screen('Q1 마감'); leakChecks++;
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'REVEAL', p_args: {} }, 'teacher');
    await screen('Q1 공개'); leakChecks++;
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'AUTO_GRADE', p_args: {} }, 'teacher');
    const fin = await Promise.all([1, 2, 3].map(() => rpcErr(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'FINALIZE', p_args: {} })));
    s1 = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    const totals = Object.values(s1.scores).map((v) => v.total);
    check('채점 확정 3번 동시 → 1번만 반영', fin.filter((c) => c === null).length === 1 && totals.every((t) => t === 10), `성공 ${fin.filter((c) => c === null).length}회, 점수 ${totals.join('/')}`);
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'NEXT', p_args: {} }, 'teacher');

    // ---------- Q2: 일시정지 ----------
    ({ q } = await cur());
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'START', p_args: {} }, 'teacher');
    await sleep(1500);
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'PAUSE', p_args: {} }, 'teacher');
    const sp = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    const remain = sp.event.remaining_ms;
    const pausedCode = await rpcErr(devices[0].client, 'student_quiz_submit', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_answer: '답' });
    check('일시정지 중 제출 거절', pausedCode === 'P7T03', pausedCode ?? '접수됨!');
    await sleep(3000);
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'RESUME', p_args: {} }, 'teacher');
    const sr = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    const left = Date.parse(sr.event.deadline_at) - Date.parse(sr.server_now);
    check('재개 뒤 남은 시간 유지(정지 3초 소모 안 됨)', Math.abs(left - remain) < 800, `정지 시 ${remain}ms → 재개 후 ${Math.round(left)}ms`);
    await Promise.all(devices.map((d) => rpc(d.client, 'student_quiz_submit', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_answer: '답' }, 'submit')));
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'REVEAL', p_args: {} }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'AUTO_GRADE', p_args: {} }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'FINALIZE', p_args: {} }, 'teacher');
    const sc2 = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    check('2문제 확정 → 중간 공개 준비(주기 2)', sc2.event.checkpoint_ready === true);
    const scr2 = await screen('Q2 확정'); leakChecks++;
    check('공개 버튼 전 작은 순위판 그대로', Object.values(scr2.board.snapshot?.scores ?? {}).every((v) => v === 0));
    await rpc(teacher, 'teacher_quiz_publish_board', { p_id: quizId }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'NEXT', p_args: {} }, 'teacher');

    // ---------- Q3: 시간 종료 ----------
    ({ q } = await cur());
    const ho = await rpc(devices[0].client, 'student_quiz_state', { p_id: quizId });
    check('차봉전 교체 안내(태블릿)', ho.handoff === true && !!ho.player, ho.player ?? '');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'START', p_args: {} }, 'teacher');
    await rpc(devices[0].client, 'student_quiz_submit', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_answer: '답' }, 'submit');
    await sleep(5000 + 1000 + 600);
    const lateCode = await rpcErr(devices[1].client, 'student_quiz_submit', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_answer: '늦음' });
    check('시간+유예 지난 제출 거절', lateCode === 'P7T03', lateCode ?? '접수됨!');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'REVEAL', p_args: {} }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'FINALIZE', p_args: {} }, 'teacher')
      .catch(async () => {
        await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'AUTO_GRADE', p_args: {} }, 'teacher');
        await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'FINALIZE', p_args: {} }, 'teacher');
      });
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'NEXT', p_args: {} }, 'teacher');

    // ---------- 개인전 발표 → 단체전 1문제 → 최종 발표 ----------
    let s = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    check('개인전 끝 → 개인전 발표 단계', s.event.phase === 'IND_CEREMONY', s.event.phase);
    const c0 = await rpc(teacher, 'teacher_quiz_screen_state', { p_id: quizId });
    check('발표 시작 전 순위 공개 0개', (c0.result?.guilds ?? []).length === 0);
    for (let i = 0; i <= devices.length; i++) await rpc(teacher, 'teacher_quiz_ceremony', { p_id: quizId, p_action: 'STEP' }, 'teacher');
    await rpc(teacher, 'teacher_quiz_ceremony', { p_id: quizId, p_action: 'ADVANCE' }, 'teacher');
    ({ q } = await cur());
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'START', p_args: {} }, 'teacher');
    await Promise.all(devices.map((d) => rpc(d.client, 'student_quiz_submit', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_answer: '단체답' }, 'submit')));
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'REVEAL', p_args: {} }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'AUTO_GRADE', p_args: {} }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'FINALIZE', p_args: {} }, 'teacher');
    await rpc(teacher, 'teacher_quiz_q', { p_id: quizId, p_question_id: q.id, p_attempt: q.attempt, p_action: 'NEXT', p_args: {} }, 'teacher');
    for (let i = 0; i <= devices.length; i++) await rpc(teacher, 'teacher_quiz_ceremony', { p_id: quizId, p_action: 'STEP' }, 'teacher');
    await rpc(teacher, 'teacher_quiz_ceremony', { p_id: quizId, p_action: 'ADVANCE' }, 'teacher');
    s = await rpc(teacher, 'teacher_quiz_state', { p_id: quizId });
    check('대회 종료', s.event.phase === 'COMPLETED', s.event.phase);
    const audit = await rpc(teacher, 'teacher_quiz_audit', { p_id: quizId });
    check('운영 이력 기록', audit.length >= 20, `${audit.length}건`);
    check(`중계 화면 비공개 유지(${leakChecks}개 시점)`, !report.checks.some((c) => c.name.startsWith('중계 화면 비공개') && !c.pass));
    check('제출 응답 p95', pct(timings.submit, 95) <= LIMITS.submitP95Ms, `${Math.round(pct(timings.submit, 95))}ms (n=${timings.submit.length})`);
    check('교사 버튼 응답 p95', pct(timings.teacher, 95) <= LIMITS.teacherActionP95Ms, `${Math.round(pct(timings.teacher, 95))}ms (n=${timings.teacher.length})`);
  } finally {
    for (const p of pulses) { try { await p.close(); } catch { /* 무시 */ } }
    if (quizId) {
      try { await rpc(teacher, 'teacher_quiz_delete', { p_id: quizId }); console.log(`[정리] 리허설 대회 #${quizId} 삭제`); }
      catch (e) { console.log(`[정리 실패] 대회 #${quizId}: ${e.message} — 도구함에서 직접 지워 주세요`); }
    }
  }

  report.finished_at = new Date().toISOString();
  report.passed = report.checks.every((c) => c.pass);
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(RESULT_DIR, `quiz_${stamp}.json`), JSON.stringify(report, null, 2));
  const txt = [`퀴즈 로얄 통합 시험 — ${report.passed ? '통과' : '실패 항목 있음'}`, `학급: ${report.classroom} · 태블릿 ${report.devices}대`, '',
    ...report.checks.map((c) => `${c.pass ? '[통과]' : '[실패]'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)].join('\r\n');
  fs.writeFileSync(path.join(RESULT_DIR, 'REPORT.txt'), txt);
  console.log(`\n${report.passed ? '✅ 모두 통과' : '❌ 실패 항목이 있어요'} — results/REPORT.txt`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((e) => { console.error(`\n[중단] ${e.message}`); process.exit(1); });
