import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = process.cwd();
const TOOL_DIR = path.join(PROJECT_ROOT, 'tools', 'raid-load-tester');
const RESULT_DIR = path.join(TOOL_DIR, 'results');
const CREDS_FILE = path.join(TOOL_DIR, 'RAID_LOAD_TEST_CREDENTIALS.csv');
const SAMPLE_FILE = path.join(TOOL_DIR, 'RAID_LOAD_TEST_CREDENTIALS.sample.csv');

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function csvSplit(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function decodeCredentialCsv(file) {
  const raw = fs.readFileSync(file);

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return { text: raw.subarray(3).toString('utf8'), encoding: 'UTF-8 BOM' };
  }

  const utf8 = raw.toString('utf8');
  const utf8ReplacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
  if (utf8ReplacementCount === 0) {
    return { text: utf8, encoding: 'UTF-8' };
  }

  const cp949 = new TextDecoder('euc-kr').decode(raw);
  const cp949ReplacementCount = (cp949.match(/\uFFFD/g) ?? []).length;
  if (cp949ReplacementCount < utf8ReplacementCount) {
    return { text: cp949, encoding: 'CP949/EUC-KR' };
  }

  return { text: utf8, encoding: `UTF-8 (replacement chars=${utf8ReplacementCount})` };
}

function loadCredentials() {
  if (!fs.existsSync(CREDS_FILE)) throw new Error(`자격 증명 파일이 없습니다: ${CREDS_FILE}`);
  const decoded = decodeCredentialCsv(CREDS_FILE);
  console.log(`[CSV] encoding=${decoded.encoding}`);
  const lines = decoded.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) throw new Error('자격 증명 CSV에 학생 행이 없습니다.');
  const header = csvSplit(lines[0]).map(x => x.toLowerCase());
  const nameIdx = header.indexOf('student_name');
  const pwIdx = header.indexOf('password');
  const classIdx = header.indexOf('classroom_id');
  if (nameIdx < 0 || pwIdx < 0) throw new Error('CSV 헤더에 student_name,password가 필요합니다.');

  const credentials = [];
  const skippedRows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = csvSplit(lines[i]);
    const studentName = c[nameIdx]?.trim() ?? '';
    const password = c[pwIdx] ?? '';
    const classroomId = classIdx >= 0 && c[classIdx] ? Number(c[classIdx]) : null;
    const lineNumber = i + 1;

    if (!studentName) {
      skippedRows.push({ lineNumber, studentName: '(blank)', reason: 'student_name is blank' });
      continue;
    }
    if (!password) {
      skippedRows.push({ lineNumber, studentName, reason: 'password is blank' });
      continue;
    }
    if (classroomId != null && (!Number.isInteger(classroomId) || classroomId <= 0)) {
      skippedRows.push({ lineNumber, studentName, reason: 'invalid classroom_id' });
      continue;
    }
    credentials.push({ studentName, password, classroomId, lineNumber });
  }

  return { credentials, skippedRows };
}

function syntheticEmail(studentName, classroomId) {
  const hex = Array.from(studentName.trim()).map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join('');
  return `${hex}@cls${classroomId}.brand.local`;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a,b)=>a-b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}
function avg(v) { return v.length ? v.reduce((a,b)=>a+b,0)/v.length : 0; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(min,max) { return Math.floor(min + Math.random() * (max-min+1)); }
function uid(prefix='lt') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`; }

function makeClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: 'public' },
    global: { headers: { 'x-application-name': 'brand-2.0-raid-load-tester' } },
  });
}

async function loginCredential(url, anonKey, cred, defaultClassroomId) {
  const classroomId = cred.classroomId ?? defaultClassroomId;
  const normalized = cred.studentName.trim().toUpperCase();
  const candidates = /^TEST0[1-5]$/.test(normalized)
    ? [`brand${normalized.toLowerCase()}@example.com`, syntheticEmail(cred.studentName, classroomId)]
    : [syntheticEmail(cred.studentName, classroomId)];
  let lastError = null;
  for (const email of candidates) {
    const client = makeClient(url, anonKey);
    const { data, error } = await client.auth.signInWithPassword({ email, password: cred.password });
    if (!error && data.session) return { client, classroomId, email };
    lastError = error;
  }
  throw new Error(`${cred.studentName}: 로그인 실패 (${lastError?.message ?? 'unknown'})`);
}

async function getBattleState(client, raidId) {
  const t0 = performance.now();
  const { data, error } = await client.rpc('get_raid_battle_state', { p_raid_id: raidId });
  const latency = performance.now() - t0;
  if (error) throw new Error(error.message);
  return { data, latency };
}

async function getActiveRaid(client) {
  const t0 = performance.now();
  const { data, error } = await client.rpc('get_active_raid');
  const latency = performance.now() - t0;
  if (error) throw new Error(`ACTIVE Raid 자동 탐색 실패 (${error.message})`);
  return { data, latency };
}

function isBusy(data) { return Boolean(data && typeof data === 'object' && data.busy === true); }

async function submitWithBackpressure(player, raidId, batchId, taps, globalStats, stopAt) {
  let busyStreak = 0;
  let networkRetries = 0;
  while (Date.now() < stopAt) {
    const started = performance.now();
    const { data, error } = await player.client.rpc('submit_raid_tap_batch', {
      p_raid_id: raidId,
      p_batch_id: batchId,
      p_taps: taps,
    });
    const latency = performance.now() - started;
    player.stats.rpcCalls++;
    player.stats.latencies.push(latency);
    globalStats.latencies.push(latency);

    if (error) {
      player.stats.rpcErrors++;
      globalStats.rpcErrors++;
      networkRetries++;
      if (networkRetries > 3) return;
      await sleep(Math.min(1500, 250 * (2 ** (networkRetries - 1))) + jitter(80, 250));
      continue;
    }
    if (isBusy(data)) {
      player.stats.busy++;
      globalStats.busy++;
      busyStreak++;
      const serverDelay = Math.max(0, Number(data.retry_after_ms) || 150);
      const delay = Math.min(1500, Math.round((serverDelay + jitter(80, 250)) * Math.pow(1.55, Math.max(0, busyStreak - 1))));
      await sleep(delay);
      continue;
    }

    player.stats.successBatches++;
    player.stats.requested += Number(data?.requested ?? taps.length);
    player.stats.accepted += Number(data?.accepted ?? 0);
    player.stats.rejected += Number(data?.rejected ?? 0);
    globalStats.successBatches++;
    globalStats.requested += Number(data?.requested ?? taps.length);
    globalStats.accepted += Number(data?.accepted ?? 0);
    globalStats.rejected += Number(data?.rejected ?? 0);
    return;
  }
}

async function runPlayer(player, raidId, durationMs, mode, globalStats) {
  const startedAt = Date.now();
  const stopAt = startedAt + durationMs;
  const rate = Math.max(1, Number(player.tapRate || 7));
  const rawRate = mode === 'MAXIMUM' ? Math.max(rate * 1.25, 8) : Math.max(2, rate * 0.65);
  let localTokens = rate * 3;
  let lastRefill = performance.now();

  while (Date.now() < stopAt) {
    const intervalMs = jitter(1550, 2000);
    await sleep(Math.min(intervalMs, Math.max(0, stopAt - Date.now())));
    if (Date.now() >= stopAt) break;

    const nowPerf = performance.now();
    const elapsed = Math.max(0, nowPerf - lastRefill) / 1000;
    localTokens = Math.min(rate * 3, localTokens + elapsed * rate);
    lastRefill = nowPerf;

    const rawTouches = Math.max(1, Math.round(rawRate * (intervalMs / 1000) * (0.90 + Math.random() * 0.20)));
    player.stats.rawTouches += rawTouches;
    globalStats.rawTouches += rawTouches;

    const allowed = Math.min(Math.floor(localTokens), Math.max(1, Math.round(rate * 2)), rawTouches);
    const rateLimited = Math.max(0, rawTouches - allowed);
    localTokens -= allowed;
    player.stats.localRateLimited += rateLimited;
    globalStats.localRateLimited += rateLimited;
    if (allowed <= 0) continue;

    const taps = Array.from({ length: allowed }, (_, i) => ({
      x: Math.round(25 + Math.random() * 50),
      y: Math.round(20 + Math.random() * 60),
      client_t: Date.now() + i,
    }));
    await submitWithBackpressure(player, raidId, uid(`lt${player.index}`), taps, globalStats, stopAt);
  }
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

async function main() {
  const env = { ...parseEnvFile(path.join(PROJECT_ROOT, '.env')), ...parseEnvFile(path.join(PROJECT_ROOT, '.env.local')) };
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('.env.local에서 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 찾지 못했습니다.');

  if (!fs.existsSync(SAMPLE_FILE)) {
    fs.writeFileSync(SAMPLE_FILE, 'student_name,password,classroom_id\n김나연,여기에비밀번호,1\n김서영,여기에비밀번호,1\n', 'utf8');
  }
  if (!fs.existsSync(CREDS_FILE)) {
    fs.copyFileSync(SAMPLE_FILE, CREDS_FILE);
    console.log(`\n[준비 필요] ${CREDS_FILE}`);
    console.log('파일이 생성되었습니다. 실제 학생 이름/비밀번호/학급 ID를 입력한 뒤 다시 실행하세요.');
    console.log('비밀번호가 들어 있으므로 테스트 후 이 파일을 삭제하거나 안전하게 보관하세요.\n');
    process.exit(2);
  }

  const { credentials: creds, skippedRows } = loadCredentials();
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\n==============================================================');
    console.log(' B.R.A.N.D Raid V1.5 — 8/12/24 Player Load Tester');
    console.log(' 실제 학생 Auth 세션 + submit_raid_tap_batch 사용');
    console.log('==============================================================\n');

    const defaultClassroomId = Number(await rl.question('기본 학급 ID (CSV에 classroom_id가 있으면 해당 값 우선): '));
    if (!Number.isInteger(defaultClassroomId) || defaultClassroomId <= 0) throw new Error('학급 ID가 올바르지 않습니다.');
    const raidIdText = (await rl.question('ACTIVE Raid ID [Enter=현재 학급 ACTIVE Raid 자동탐색]: ')).trim();
    const requestedRaidId = raidIdText ? Number(raidIdText) : null;
    if (requestedRaidId !== null && (!Number.isInteger(requestedRaidId) || requestedRaidId <= 0)) {
      throw new Error('Raid ID가 올바르지 않습니다. 숫자를 입력하거나 Enter로 자동탐색하세요.');
    }
    let raidId = null;
    const count = Number(await rl.question('가상 인원 [8 / 12 / 24]: '));
    if (![8,12,24].includes(count)) throw new Error('인원은 8, 12, 24 중 하나여야 합니다.');
    const modeIn = (await rl.question('모드 [1=Normal / 2=Maximum Spam] (권장: 2): ')).trim();
    const mode = modeIn === '1' ? 'NORMAL' : 'MAXIMUM';
    const defaultSeconds = count === 24 ? 180 : 60;
    const secondsText = (await rl.question(`지속시간(초) [Enter=${defaultSeconds}]: `)).trim();
    const durationSec = secondsText ? Number(secondsText) : defaultSeconds;
    if (!Number.isFinite(durationSec) || durationSec < 10 || durationSec > 600) throw new Error('지속시간은 10~600초로 입력하세요.');

    console.log(`\n[PRE-FLIGHT] 정상 로그인 + Raid 참가 가능한 계정 ${count}명을 찾습니다...`);
    if (skippedRows.length) {
      for (const row of skippedRows) {
        console.log(`  [SKIP] CSV ${row.lineNumber}행 ${row.studentName} | ${row.reason}`);
      }
    }

    const players = [];
    const failedAccounts = [];
    let checked = 0;
    for (const cred of creds) {
      if (players.length >= count) break;
      checked++;
      let auth = null;
      try {
        auth = await loginCredential(url, anonKey, cred, defaultClassroomId);

        if (raidId === null) {
          const activeProbe = await getActiveRaid(auth.client);
          const activeRaid = activeProbe.data;
          if (!activeRaid) {
            throw new Error('__FATAL_NO_ACTIVE_RAID__');
          }
          if (activeRaid.status !== 'ACTIVE') {
            throw new Error(`__FATAL_RAID_STATUS__${activeRaid.status}`);
          }
          raidId = Number(activeRaid.id);
          if (!Number.isInteger(raidId) || raidId <= 0) {
            throw new Error('__FATAL_NO_ACTIVE_RAID__');
          }
          console.log(`
  [AUTO RAID] 현재 학급 ACTIVE Raid #${raidId} | ${activeRaid.title ?? activeRaid.boss_name ?? 'Raid'}`);
          if (requestedRaidId !== null && requestedRaidId !== raidId) {
            console.log(`  [NOTICE] 입력한 Raid #${requestedRaidId} 대신 실제 ACTIVE Raid #${raidId}를 사용합니다.`);
          }
        }

        let state;
        try {
          state = await getBattleState(auth.client, raidId);
        } catch (battleError) {
          const msg = battleError?.message ?? String(battleError);
          if (msg.includes('Raid battle state is not available')) {
            throw new Error(`ACTIVE Raid #${raidId}에는 이 학생의 participant snapshot이 없습니다. Raid 시작 시 참가자 스냅샷 상태를 확인하세요.`);
          }
          throw battleError;
        }
        const raid = state.data?.raid;
        const me = state.data?.me;
        if (!raid || !me) throw new Error(`ACTIVE Raid #${raidId} battle state에서 raid/me를 받지 못했습니다.`);
        if (raid.status !== 'ACTIVE') {
          await auth.client.auth.signOut().catch(()=>{});
          throw new Error(`__FATAL_RAID_STATUS__${raid.status}`);
        }
        const tapRate = Number(raid.tap_rate_limit_per_second ?? 7);
        const playerNumber = players.length + 1;
        players.push({
          index: playerNumber,
          name: cred.studentName,
          client: auth.client,
          tapRate,
          stats: { rpcCalls:0, successBatches:0, busy:0, rpcErrors:0, requested:0, accepted:0, rejected:0, rawTouches:0, localRateLimited:0, latencies:[] },
        });
        console.log(`  [OK ${String(playerNumber).padStart(2,'0')}/${count}] ${cred.studentName} | rate=${tapRate}/s | preflight=${state.latency.toFixed(0)}ms`);
      } catch (e) {
        const message = e?.message ?? String(e);
        if (message === '__FATAL_NO_ACTIVE_RAID__') {
          throw new Error('현재 로그인 학생의 학급에 ACTIVE Raid가 없습니다. 교사 운영패널에서 테스트용 Raid를 ACTIVE로 시작한 뒤 다시 실행하세요.');
        }
        if (message.startsWith('__FATAL_RAID_STATUS__')) {
          const raidStatus = message.slice('__FATAL_RAID_STATUS__'.length);
          throw new Error(`현재 학급 Raid 상태가 ACTIVE가 아닙니다 (${raidStatus}). 테스트용 Raid를 ACTIVE로 시작한 뒤 다시 실행하세요.`);
        }
        if (auth?.client) await auth.client.auth.signOut().catch(()=>{});
        failedAccounts.push({ lineNumber: cred.lineNumber, studentName: cred.studentName, reason: message });
        console.log(`  [SKIP] CSV ${cred.lineNumber}행 ${cred.studentName} | ${message}`);
      }
      await sleep(80);
    }

    if (players.length < count) {
      for (const p of players) await p.client.auth.signOut().catch(()=>{});
      const totalSkipped = skippedRows.length + failedAccounts.length;
      throw new Error(`정상 사용 가능한 계정이 ${players.length}개뿐입니다. ${count}인 테스트에는 ${count}개가 필요합니다. (검사 ${checked}개, SKIP ${totalSkipped}개)`);
    }

    console.log(`\n[PRE-FLIGHT OK] ${checked}개 계정을 검사해 정상 계정 ${players.length}명을 확보했습니다.`);

    const globalStats = { successBatches:0, busy:0, rpcErrors:0, requested:0, accepted:0, rejected:0, rawTouches:0, localRateLimited:0, latencies:[] };
    console.log(`\n[START] ${count}명 / ${mode} / ${durationSec}초`);
    console.log('중간에 Ctrl+C로 중단할 수 있습니다. Raid가 먼저 종료되면 서버 rejected가 증가할 수 있습니다.\n');
    const startedIso = new Date().toISOString();
    const wallStart = Date.now();
    let ticker = setInterval(() => {
      const elapsed = Math.max(1, (Date.now()-wallStart)/1000);
      const busyRatio = globalStats.successBatches + globalStats.busy > 0 ? globalStats.busy/(globalStats.successBatches+globalStats.busy)*100 : 0;
      output.write(`\r  ${elapsed.toFixed(0).padStart(3)}s | RPC ${(players.reduce((s,p)=>s+p.stats.rpcCalls,0)/elapsed).toFixed(1)}/s | BUSY ${busyRatio.toFixed(1)}% | accepted ${globalStats.accepted} | raw ${globalStats.rawTouches}   `);
    }, 1000);

    await Promise.all(players.map(p => runPlayer(p, raidId, durationSec*1000, mode, globalStats)));
    clearInterval(ticker); ticker = null;
    console.log('\n');
    const elapsedSec = (Date.now()-wallStart)/1000;
    const totalRpcCalls = players.reduce((s,p)=>s+p.stats.rpcCalls,0);
    const allLats = globalStats.latencies;
    const busyDenom = globalStats.successBatches + globalStats.busy;
    const summary = {
      tester_version: '1.1.0-skip-invalid',
      started_at: startedIso,
      finished_at: new Date().toISOString(),
      raid_id: raidId,
      players: count,
      mode,
      elapsed_seconds: Number(elapsedSec.toFixed(3)),
      raw_touches: globalStats.rawTouches,
      raw_touches_per_sec: Number((globalStats.rawTouches/elapsedSec).toFixed(2)),
      local_rate_limited: globalStats.localRateLimited,
      rpc_calls: totalRpcCalls,
      rpc_calls_per_sec: Number((totalRpcCalls/elapsedSec).toFixed(2)),
      success_batches: globalStats.successBatches,
      busy_responses: globalStats.busy,
      busy_ratio_percent: Number((busyDenom ? globalStats.busy/busyDenom*100 : 0).toFixed(2)),
      rpc_errors: globalStats.rpcErrors,
      requested_taps: globalStats.requested,
      accepted_taps: globalStats.accepted,
      rejected_taps: globalStats.rejected,
      accepted_per_sec: Number((globalStats.accepted/elapsedSec).toFixed(2)),
      latency_avg_ms: Number(avg(allLats).toFixed(2)),
      latency_p50_ms: Number(percentile(allLats,50).toFixed(2)),
      latency_p95_ms: Number(percentile(allLats,95).toFixed(2)),
      latency_p99_ms: Number(percentile(allLats,99).toFixed(2)),
      latency_max_ms: Number(Math.max(0,...allLats).toFixed(2)),
    };

    console.log('==================== RESULT ====================');
    console.log(`Raw touches       : ${summary.raw_touches} (${summary.raw_touches_per_sec}/s)`);
    console.log(`Attack RPC         : ${summary.rpc_calls} (${summary.rpc_calls_per_sec}/s)`);
    console.log(`BUSY               : ${summary.busy_responses} (${summary.busy_ratio_percent}%)`);
    console.log(`RPC errors         : ${summary.rpc_errors}`);
    console.log(`Accepted / Rejected: ${summary.accepted_taps} / ${summary.rejected_taps}`);
    console.log(`Accepted taps/sec  : ${summary.accepted_per_sec}`);
    console.log(`RPC latency avg    : ${summary.latency_avg_ms} ms`);
    console.log(`RPC latency p95    : ${summary.latency_p95_ms} ms`);
    console.log(`RPC latency max    : ${summary.latency_max_ms} ms`);
    console.log('================================================\n');

    fs.mkdirSync(RESULT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const base = `raid-${raidId}_${count}p_${mode}_${stamp}`;
    const jsonPath = path.join(RESULT_DIR, `${base}.json`);
    const csvPath = path.join(RESULT_DIR, `${base}_players.csv`);
    const reportPath = path.join(RESULT_DIR, `${base}_REPORT.txt`);
    const playerRows = players.map(p => ({
      name:p.name,
      tap_rate:p.tapRate,
      raw_touches:p.stats.rawTouches,
      local_rate_limited:p.stats.localRateLimited,
      rpc_calls:p.stats.rpcCalls,
      success_batches:p.stats.successBatches,
      busy:p.stats.busy,
      rpc_errors:p.stats.rpcErrors,
      requested:p.stats.requested,
      accepted:p.stats.accepted,
      rejected:p.stats.rejected,
      latency_avg_ms:Number(avg(p.stats.latencies).toFixed(2)),
      latency_p95_ms:Number(percentile(p.stats.latencies,95).toFixed(2)),
      latency_max_ms:Number(Math.max(0,...p.stats.latencies).toFixed(2)),
    }));
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, players: playerRows }, null, 2), 'utf8');
    const headers = Object.keys(playerRows[0] || {name:''});
    fs.writeFileSync(csvPath, [headers.join(','), ...playerRows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\n'), 'utf8');
    const report = [
      'B.R.A.N.D RAID LOAD TEST REPORT',
      '================================',
      ...Object.entries(summary).map(([k,v])=>`${k}: ${v}`),
      '',
      'Share this REPORT.txt (or JSON) with ChatGPT for analysis.',
    ].join('\n');
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`결과 저장:\n  ${reportPath}\n  ${jsonPath}\n  ${csvPath}\n`);

    for (const p of players) await p.client.auth.signOut().catch(()=>{});
  } finally {
    rl.close();
  }
}

main().catch(err => {
  console.error(`\n[LOAD TESTER ERROR] ${err?.message ?? err}`);
  process.exitCode = 1;
});
