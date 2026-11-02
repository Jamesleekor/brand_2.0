// Playwright scenarios against the real StarlinkGame component (mock server).
// usage: NODE_PATH=/opt/npm-tools/node_modules node run.mjs <outdir>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, 'out'));
fs.mkdirSync(out, { recursive: true });
const url = (seed) => `file://${path.join(here, 'index.html')}?seed=${seed}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

// ---- board helpers (pure) ------------------------------------------------
const adj = (a, b) => a !== b && Math.abs(Math.floor(a / 7) - Math.floor(b / 7)) <= 1 && Math.abs((a % 7) - (b % 7)) <= 1;
function findPath(board, minLen, maxLen) {
  let best = null;
  for (let s = 0; s < 49; s++) {
    const stack = [[s]];
    while (stack.length) {
      const p = stack.pop();
      if (p.length >= minLen && (!best || p.length > best.length)) best = p;
      if (p.length >= maxLen) continue;
      for (let c = 0; c < 49; c++) if (board[c] === board[s] && !p.includes(c) && adj(p[p.length - 1], c)) stack.push([...p, c]);
    }
    if (best && best.length >= maxLen) break;
  }
  return best;
}
function findCollinearTriple(board) {
  for (let a = 0; a < 49; a++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const r = Math.floor(a / 7), c = a % 7;
    const b = (r + dr) * 7 + (c + dc), d = (r + 2 * dr) * 7 + (c + 2 * dc);
    if (r + 2 * dr > 6 || c + 2 * dc > 6 || c + 2 * dc < 0) continue;
    if (board[a] === board[b] && board[b] === board[d]) return [a, b, d];
  }
  return null;
}
const score = (n, combo = 1) => Math.floor(25 * n * (n - 1) * Math.min(100 + (combo - 1) * 5, 150) / 100);

async function boardAfter(page, events) {
  return page.evaluate((events) => {
    const E = window.__engine; let st = E.createStarlinkRun(window.__SEED);
    for (const e of events) st = E.applyStarlinkEvent(st, e);
    st = E.advanceStarlinkRun(st, (events.at(-1)?.elapsed_ms ?? 0) + 400);
    return [...st.board];
  }, events);
}
async function hudScore(page) { return page.evaluate(() => Number((document.querySelector('.tabular-nums')?.textContent || '0').replace(/,/g, ''))); }
async function centers(page) {
  const box = await page.locator('canvas').boundingBox();
  return (cell) => ({ x: box.x + ((cell % 7) + 0.5) * box.width / 7, y: box.y + (Math.floor(cell / 7) + 0.5) * box.height / 7 });
}
async function waitPlaying(page) { await page.waitForFunction(() => window.__BEGINS === 1, null, { timeout: 15000 }); await page.waitForTimeout(250); }

// ---- A. desktop mouse ----------------------------------------------------
async function desktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url(6059));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'A1_countdown_board_hidden.png') });
  check('A1 countdown shows READY and no board (seed not yet known)', await page.evaluate(() => window.__BEGINS === 0 && document.body.innerText.includes('READY')));
  await waitPlaying(page);
  const C = await centers(page);
  const events = [];
  // long drag with per-cell moves
  let board = await page.evaluate(() => [...window.__engine.createStarlinkRun(window.__SEED).board]);
  const p1 = findPath(board, 4, 6);
  await page.mouse.move(C(p1[0]).x, C(p1[0]).y); await page.mouse.down();
  for (const cell of p1.slice(1)) await page.mouse.move(C(cell).x, C(cell).y, { steps: 5 });
  await page.screenshot({ path: path.join(out, 'A2_dragging_path_glow.png') });
  await page.mouse.up();
  events.push({ type: 'PATH_START', elapsed_ms: 100, cell: p1[0] }, ...p1.slice(1).map((c, i) => ({ type: 'CELL_ENTER', elapsed_ms: 110 + i * 10, cell: c })), { type: 'PATH_RELEASE', elapsed_ms: 200 });
  await page.waitForTimeout(400);
  check(`A2 mouse drag ${p1.length}-link scores ${score(p1.length)}`, (await hudScore(page)) === score(p1.length), `hud=${await hudScore(page)}`);
  // too-short release cancels (no score change)
  board = await boardAfter(page, events);
  const short = findPath(board, 2, 2);
  const before = await hudScore(page);
  await page.mouse.move(C(short[0]).x, C(short[0]).y); await page.mouse.down(); await page.mouse.move(C(short[1]).x, C(short[1]).y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
  check('A3 2-star release cancels without score', (await hudScore(page)) === before);
  events.push({ type: 'PATH_START', elapsed_ms: 2600, cell: short[0] }, { type: 'CELL_ENTER', elapsed_ms: 2610, cell: short[1] }, { type: 'PATH_RELEASE', elapsed_ms: 2620 });
  // release outside the board still commits (pointer capture)
  board = await boardAfter(page, events);
  const p2 = findPath(board, 3, 3);
  const b2 = await hudScore(page);
  await page.mouse.move(C(p2[0]).x, C(p2[0]).y); await page.mouse.down();
  for (const cell of p2.slice(1)) await page.mouse.move(C(cell).x, C(cell).y, { steps: 5 });
  await page.mouse.move(5, 5, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  check('A4 pointerup outside the board still commits the path', (await hudScore(page)) > b2, `+${(await hudScore(page)) - b2}`);
  events.push({ type: 'PATH_START', elapsed_ms: 5000, cell: p2[0] }, ...p2.slice(1).map((c, i) => ({ type: 'CELL_ENTER', elapsed_ms: 5010 + i * 10, cell: c })), { type: 'PATH_RELEASE', elapsed_ms: 5100 });
  // fast swipe: one pointermove jumps over the middle cell
  board = await boardAfter(page, events);
  const tri = findCollinearTriple(board);
  if (tri) {
    const b3 = await hudScore(page);
    await page.mouse.move(C(tri[0]).x, C(tri[0]).y); await page.mouse.down(); await page.mouse.move(C(tri[2]).x, C(tri[2]).y, { steps: 1 }); await page.mouse.up();
    await page.waitForTimeout(400);
    check('A5 fast swipe across a skipped middle star is recovered (interpolation)', (await hudScore(page)) > b3, `cells=${tri} +${(await hudScore(page)) - b3}`);
  } else check('A5 fast swipe (no collinear triple on this board — skipped)', true, 'skipped');
  // simulate a dropped network on submit → retry with the identical payload
  await page.evaluate(() => { window.__FAIL_NEXT_SUBMIT = true; });
  await page.waitForFunction(() => window.__SUBMISSIONS.length >= 1, null, { timeout: 75000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'A6_submit_failed_retry.png') });
  const retry = page.getByText('같은 기록으로 다시 제출');
  check('A6 lost submit shows "같은 기록으로 다시 제출"', await retry.isVisible());
  await retry.click();
  await page.waitForFunction(() => window.__recorded.length === 1, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'A7_result.png') });
  const subs = await page.evaluate(() => window.__SUBMISSIONS);
  check('A7 retry re-sent the byte-identical payload (idempotent on server)', subs.length === 2 && JSON.stringify(subs[0]) === JSON.stringify(subs[1]));
  const rec = await page.evaluate(() => window.__recorded[0]);
  check('A8 server replay score == score shown during play', rec.r.official_score === rec.s.previewScore, `official=${rec.r.official_score} preview=${rec.s.previewScore}`);
  check('A9 result screen: 시간 종료! + stats', await page.evaluate(() => document.body.innerText.includes('시간 종료!') && document.body.innerText.includes('MAX COMBO') && document.body.innerText.includes('최장 연결')));
  check('A10 submitted events stay within 0..48 cells, monotonic, ≤5,000', subs[0].p_input_events.length <= 5000 && subs[0].p_input_events.every((e, i, a) => (e.cell === undefined || (e.cell >= 0 && e.cell <= 48)) && (i === 0 || e.elapsed_ms >= a[i - 1].elapsed_ms)));
  check('A11 no uncaught page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---- B. Android-like touch ------------------------------------------------
async function mobile(browser) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url(8));
  await waitPlaying(page);
  const cdp = await ctx.newCDPSession(page);
  const C = await centers(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })) });
  const scroll0 = await page.evaluate(() => window.scrollY);
  let board = await page.evaluate(() => [...window.__engine.createStarlinkRun(window.__SEED).board]);
  const p1 = findPath(board, 3, 5);
  await touch('touchStart', [[1, C(p1[0])]]);
  for (const cell of p1.slice(1)) { const a = C(cell); for (let k = 1; k <= 4; k++) await touch('touchMove', [[1, { x: a.x, y: a.y }]]); }
  await page.screenshot({ path: path.join(out, 'B1_mobile_touch_drag.png') });
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  check(`B1 touch drag ${p1.length}-link scores ${score(p1.length)}`, (await hudScore(page)) === score(p1.length), `hud=${await hudScore(page)}`);
  const events = [{ type: 'PATH_START', elapsed_ms: 100, cell: p1[0] }, ...p1.slice(1).map((c, i) => ({ type: 'CELL_ENTER', elapsed_ms: 110 + i * 10, cell: c })), { type: 'PATH_RELEASE', elapsed_ms: 200 }];
  // second finger must not start a second path
  board = await boardAfter(page, events);
  const pa = findPath(board, 3, 3);
  const other = [...Array(49).keys()].find((c) => !pa.includes(c) && board[c] !== board[pa[0]]);
  const s0 = await hudScore(page);
  await touch('touchStart', [[1, C(pa[0])]]);
  await touch('touchStart', [[1, C(pa[0])], [2, C(other)]]);
  await touch('touchMove', [[1, C(pa[1])], [2, C(other)]]);
  await touch('touchMove', [[1, C(pa[2])], [2, C(other)]]);
  await touch('touchEnd', [[2, C(other)]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  check('B2 multi-touch: only the first finger\'s path counts', (await hudScore(page)) - s0 === score(3, 2) || (await hudScore(page)) - s0 === score(3, 1), `+${(await hudScore(page)) - s0}`);
  events.push({ type: 'PATH_START', elapsed_ms: 1000, cell: pa[0] }, { type: 'CELL_ENTER', elapsed_ms: 1010, cell: pa[1] }, { type: 'CELL_ENTER', elapsed_ms: 1020, cell: pa[2] }, { type: 'PATH_RELEASE', elapsed_ms: 1030 });
  // touchcancel mid-path → cancelled, never a release
  board = await boardAfter(page, events);
  const pc = findPath(board, 3, 3);
  const s1 = await hudScore(page);
  await touch('touchStart', [[1, C(pc[0])]]); await touch('touchMove', [[1, C(pc[1])]]); await touch('touchMove', [[1, C(pc[2])]]);
  await touch('touchCancel', []);
  await page.waitForTimeout(400);
  check('B3 touchcancel / lost capture cancels the path (no score)', (await hudScore(page)) === s1);
  check('B4 dragging never scrolls the page (touch-action:none)', (await page.evaluate(() => window.scrollY)) === scroll0);
  const box = await page.locator('canvas').boundingBox();
  check('B5 board fits a 412px phone without overflow', box.width <= 412 && box.width >= 260, `board=${Math.round(box.width)}px`);
  await page.screenshot({ path: path.join(out, 'B5_mobile_layout.png') });
  check('B6 no uncaught page errors (mobile)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

const browser = await chromium.launch();
try { await Promise.all([desktop(browser), mobile(browser)]); }
catch (e) { check('harness crashed', false, String(e && e.stack || e)); }
finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
