/**
 * Deterministic test bot: plays a Starlink run through StarlinkInputRecorder
 * like a (messy) student would — normal links, backtracks, wrong-type and
 * non-adjacent swipes, too-short releases, cancels, inputs during locks, and
 * loop attempts. Test-only; never shipped to students.
 */
import { xorshift32Next } from '../../../arcade_rng';
import { areStarlinkCellsAdjacent8 } from '../starlinkBoard';
import { canCloseStarlinkLoop } from '../starlinkPath';
import { StarlinkInputRecorder } from '../starlinkInputRecorder';
import type { StarlinkInputEvent } from '../starlinkRuntime';
import type { StarlinkBoard } from '../starlinkTypes';

export interface StarlinkBotRun {
  seed: number;
  events: StarlinkInputEvent[];
  submissionWallMs: number;
  score: number;
  stats: Record<string, number>;
  loops: number;
  reshuffles: number;
}

class BotRng {
  constructor(private state: number) { if (this.state === 0) this.state = 0x9e3779b9; }
  next(): number { this.state = xorshift32Next(this.state); return this.state; }
  int(maxExclusive: number): number { return this.next() % maxExclusive; }
  chance(percent: number): boolean { return this.int(100) < percent; }
}

function neighbors(cell: number): number[] {
  const out: number[] = [];
  for (let other = 0; other < 49; other += 1) if (areStarlinkCellsAdjacent8(cell, other)) out.push(other);
  return out;
}
const NEIGHBORS = Array.from({ length: 49 }, (_, c) => neighbors(c));

/** Random simple same-type path from a random start (DFS, bounded). */
function findPath(board: StarlinkBoard, rng: BotRng, maxLen: number): number[] {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const start = rng.int(49);
    const path = [start];
    while (path.length < maxLen) {
      const last = path[path.length - 1];
      const options = NEIGHBORS[last].filter((c) => board[c] === board[start] && !path.includes(c));
      if (!options.length) break;
      path.push(options[rng.int(options.length)]);
    }
    if (path.length >= 3) return path;
  }
  return [];
}

/** Try to find a closable loop (ring around some cell) of the same type. */
function findLoop(board: StarlinkBoard): number[] | null {
  for (let center = 0; center < 49; center += 1) {
    const r = Math.floor(center / 7), c = center % 7;
    if (r < 1 || r > 5 || c < 1 || c > 5) continue;
    const ring = [
      (r - 1) * 7 + (c - 1), (r - 1) * 7 + c, (r - 1) * 7 + (c + 1), r * 7 + (c + 1),
      (r + 1) * 7 + (c + 1), (r + 1) * 7 + c, (r + 1) * 7 + (c - 1), r * 7 + (c - 1),
    ];
    for (let len = 8; len >= 5; len -= 1) {
      for (let off = 0; off < 8; off += 1) {
        const cand = Array.from({ length: len }, (_, k) => ring[(off + k) % 8]);
        const type = board[cand[0]];
        if (!cand.every((x) => board[x] === type)) continue;
        if (canCloseStarlinkLoop({ currentType: type, path: cand, loopClosed: false })) return cand;
      }
    }
  }
  return null;
}

export function playStarlinkBot(seed: number, botSeed = seed * 2654435761 >>> 0): StarlinkBotRun {
  const rec = new StarlinkInputRecorder(seed);
  const rng = new BotRng(botSeed || 1);
  let t = 120 + rng.int(400);
  let loops = 0;
  let guard = 0;
  while (rec.state.phase !== 'GAME_OVER' && guard < 4000) {
    guard += 1;
    const phase: string = rec.tick(t).phase;
    if (phase === 'GAME_OVER') break;
    // Occasionally poke during a lock (must be dropped, never recorded).
    if (rec.state.phase !== 'PLAYING') {
      if (rng.chance(30)) rec.pathStart(t, rng.int(49));
      t += 20 + rng.int(120);
      continue;
    }
    const board = rec.state.board;
    const loop = rng.chance(35) ? findLoop(board) : null;
    const path = loop ?? findPath(board, rng, 3 + rng.int(7));
    if (!path.length) { t += 50; continue; }
    rec.pathStart(t, path[0]);
    for (let i = 1; i < path.length; i += 1) {
      t += 25 + rng.int(110);
      if (rng.chance(8)) rec.cellEnter(t, rng.int(49));             // stray swipe (usually ignored)
      rec.cellEnter(t, path[i]);
      if (i >= 2 && rng.chance(7)) {                                // backtrack then re-enter
        t += 30; rec.cellEnter(t, path[i - 1]);
        t += 30; rec.cellEnter(t, path[i]);
      }
    }
    if (loop) { t += 40 + rng.int(80); rec.cellEnter(t, path[0]); }
    t += 30 + rng.int(90);
    if (rng.chance(4)) rec.cancel(t); else rec.release(t);
    if (loop) loops += 1;
    if (rng.chance(10)) { t += 5; rec.pathStart(t, path[0]); }   // during settle: dropped
    t += 150 + rng.int(rng.chance(25) ? 2600 : 700);               // sometimes break the combo
  }
  rec.tick(Math.max(t, rec.state.finalEndWallMs ?? 0, 60_000 + rec.state.pausedTotalMs));
  if (rec.state.phase !== 'GAME_OVER') rec.tick(180_000);
  const end = rec.submissionWallMs();
  if (end === null) throw new Error('bot run did not finish');
  const s = rec.state.stats;
  return {
    seed,
    events: [...rec.events],
    submissionWallMs: end,
    score: rec.state.score,
    stats: { ...s },
    loops,
    reshuffles: s.reshuffleCount,
  };
}
