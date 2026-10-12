import { assertNonZeroUint32, deriveStarlinkRngStreams } from '../../arcade_rng';
import { generateStarlinkInitialBoard } from './starlinkBoard';
import { resolveStarlinkClearBoard } from './starlinkClear';
import {
  EMPTY_STARLINK_PATH,
  cancelStarlinkPath,
  enterStarlinkCell,
  releaseStarlinkPath,
  startStarlinkPath,
  type StarlinkPathState,
} from './starlinkPath';
import { STARLINK_V03_RULES, type StarlinkGameplayRules } from './starlinkRules';
import {
  nextStarlinkComboCount,
  scoreStarlinkLoopClear,
  scoreStarlinkNormalClear,
  type StarlinkScoreBreakdown,
} from './starlinkScoring';
import type { StarlinkBoard } from './starlinkTypes';

export type StarlinkRunPhase = 'PLAYING' | 'SETTLING' | 'RESHUFFLING' | 'GAME_OVER';
export type StarlinkInputEvent =
  | { type: 'PATH_START'; elapsed_ms: number; cell: number }
  | { type: 'CELL_ENTER'; elapsed_ms: number; cell: number }
  | { type: 'PATH_RELEASE'; elapsed_ms: number }
  // Browser pointercancel/lostpointercapture must NOT be converted into a release.
  | { type: 'PATH_CANCEL'; elapsed_ms: number };

export interface StarlinkOfficialStats {
  totalRemovedStars: number;
  normalClearCount: number;
  loopCount: number;
  maxLinkLength: number;
  maxCombo: number;
  largestLoopRemovedCount: number;
  reshuffleCount: number;
}

export interface StarlinkClearLog {
  activeCommitMs: number;
  wallCommitMs: number;
  pathLength: number;
  removedCount: number;
  kind: 'NORMAL' | 'LOOP';
  combo: number;
  awardedScore: number;
}

export interface StarlinkRuntimeState {
  board: StarlinkBoard;
  refillRngState: number;
  reshuffleRngState: number;
  phase: StarlinkRunPhase;
  path: StarlinkPathState;
  wallMs: number;
  pausedTotalMs: number;
  settleUntilWallMs: number | null;
  reshuffleUntilWallMs: number | null;
  pendingRemovedCells: readonly number[] | null;
  finalEndWallMs: number | null;
  score: number;
  combo: number;
  lastCommitActiveMs: number | null;
  stats: StarlinkOfficialStats;
  clears: readonly StarlinkClearLog[];
}

export interface StarlinkReplayResult {
  official_score: number;
  official_duration_ms: number;
  game_end_wall_ms: number;
  paused_total_ms: number;
  board: StarlinkBoard;
  refill_rng_state: number;
  reshuffle_rng_state: number;
  stats: StarlinkOfficialStats;
  clear_log: readonly StarlinkClearLog[];
  phase: 'GAME_OVER';
}

const ZERO_STATS: StarlinkOfficialStats = Object.freeze({
  totalRemovedStars: 0,
  normalClearCount: 0,
  loopCount: 0,
  maxLinkLength: 0,
  maxCombo: 0,
  largestLoopRemovedCount: 0,
  reshuffleCount: 0,
});

function validMs(ms: number): number {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 180_000) {
    throw new Error('Starlink event wall elapsed must be an integer between 0 and 180000ms.');
  }
  return ms;
}

export function createStarlinkRun(
  gameplaySeed: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkRuntimeState {
  assertNonZeroUint32(gameplaySeed, 'Gameplay seed');
  const initial = generateStarlinkInitialBoard(gameplaySeed, rules);
  const streams = deriveStarlinkRngStreams(gameplaySeed);
  return {
    board: initial.board,
    refillRngState: streams.refill,
    reshuffleRngState: streams.reshuffle,
    phase: 'PLAYING',
    path: EMPTY_STARLINK_PATH,
    wallMs: 0,
    pausedTotalMs: 0,
    settleUntilWallMs: null,
    reshuffleUntilWallMs: null,
    pendingRemovedCells: null,
    finalEndWallMs: null,
    score: 0,
    combo: 0,
    lastCommitActiveMs: null,
    stats: { ...ZERO_STATS },
    clears: [],
  };
}

export function starlinkActiveGameMs(state: StarlinkRuntimeState, wallMs = state.wallMs): number {
  const elapsed = Math.max(0, wallMs - state.pausedTotalMs);
  if (state.phase === 'RESHUFFLING' && state.reshuffleUntilWallMs !== null) {
    const pauseStart = state.reshuffleUntilWallMs - STARLINK_V03_RULES.reshufflePauseMs;
    return Math.max(0, Math.min(wallMs, pauseStart) - state.pausedTotalMs);
  }
  return elapsed;
}

function terminate(state: StarlinkRuntimeState, deadline: number): StarlinkRuntimeState {
  return {
    ...state,
    phase: 'GAME_OVER',
    path: EMPTY_STARLINK_PATH,
    pendingRemovedCells: null,
    settleUntilWallMs: null,
    reshuffleUntilWallMs: null,
    finalEndWallMs: deadline,
    wallMs: deadline,
  };
}

/**
 * Advance deterministic wall clock without accepting an input.
 * Terminal 60000 active ms outranks settle/refill/dead-check/reshuffle.
 */
export function advanceStarlinkRun(
  previous: StarlinkRuntimeState,
  wallMs: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkRuntimeState {
  validMs(wallMs);
  if (wallMs < previous.wallMs) throw new Error('Starlink event time moved backwards.');
  if (previous.phase === 'GAME_OVER') return previous;

  let state = previous;
  for (let transitions = 0; transitions < 8; transitions += 1) {
    const deadline = rules.activeDurationMs + state.pausedTotalMs;

    if (state.phase === 'SETTLING') {
      const settleEnd = state.settleUntilWallMs;
      if (settleEnd === null || state.pendingRemovedCells === null) {
        throw new Error('Starlink settle state is incomplete.');
      }
      // No refill if timer reaches 60 seconds during (or at end of) settling.
      if (deadline <= wallMs && deadline <= settleEnd) return terminate(state, deadline);
      if (wallMs < settleEnd) return { ...state, wallMs };

      const nextBoard = resolveStarlinkClearBoard(
        state.board,
        state.pendingRemovedCells,
        state.refillRngState,
        state.reshuffleRngState,
        rules,
      );
      state = {
        ...state,
        board: nextBoard.board,
        refillRngState: nextBoard.refillRngState,
        reshuffleRngState: nextBoard.reshuffleRngState,
        pendingRemovedCells: null,
        settleUntilWallMs: null,
        phase: nextBoard.reshuffled ? 'RESHUFFLING' : 'PLAYING',
        reshuffleUntilWallMs: nextBoard.reshuffled ? settleEnd + rules.reshufflePauseMs : null,
        stats: nextBoard.reshuffled
          ? { ...state.stats, reshuffleCount: state.stats.reshuffleCount + 1 }
          : state.stats,
      };
      continue;
    }

    if (state.phase === 'RESHUFFLING') {
      const pauseEnd = state.reshuffleUntilWallMs;
      if (pauseEnd === null) throw new Error('Starlink reshuffle pause is incomplete.');
      if (wallMs < pauseEnd) return { ...state, wallMs };
      state = {
        ...state,
        phase: 'PLAYING',
        pausedTotalMs: state.pausedTotalMs + rules.reshufflePauseMs,
        reshuffleUntilWallMs: null,
      };
      continue;
    }

    if (wallMs >= deadline) return terminate(state, deadline);
    return { ...state, wallMs };
  }
  throw new Error('Starlink clock transition did not converge.');
}

/**
 * Events during SETTLING or RESHUFFLING are structurally invalid.
 * Events at/after the terminal deadline are harmlessly ignored (never scored).
 */
export function applyStarlinkEvent(
  previous: StarlinkRuntimeState,
  event: StarlinkInputEvent,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkRuntimeState {
  if (event === null || typeof event !== 'object' || typeof event.type !== 'string') {
    throw new Error('Starlink event structure is invalid.');
  }
  const wallMs = validMs(event.elapsed_ms);
  if (wallMs < previous.wallMs) throw new Error('Starlink event time moved backwards.');
  const state = advanceStarlinkRun(previous, wallMs, rules);
  if (state.phase === 'GAME_OVER') return state;
  if (state.phase !== 'PLAYING') {
    throw new Error('Starlink input occurred during settle/reshuffle lock.');
  }

  const activeMs = wallMs - state.pausedTotalMs;
  if (event.type === 'PATH_START') {
    if (state.path.path.length !== 0) throw new Error('Starlink PATH_START while path is active.');
    return { ...state, path: startStarlinkPath(state.board, event.cell) };
  }
  if (event.type === 'CELL_ENTER') {
    if (state.path.path.length === 0) throw new Error('Starlink CELL_ENTER without PATH_START.');
    return { ...state, path: enterStarlinkCell(state.board, state.path, event.cell, rules).state };
  }
  if (event.type === 'PATH_CANCEL') {
    if (state.path.path.length === 0) throw new Error('Starlink PATH_CANCEL without active path.');
    return { ...state, path: cancelStarlinkPath() };
  }
  if (event.type !== 'PATH_RELEASE') throw new Error('Unknown Starlink input event.');
  if (state.path.path.length === 0) throw new Error('Starlink PATH_RELEASE without PATH_START.');

  const release = releaseStarlinkPath(state.board, state.path, rules);
  if (release.kind === 'CANCEL') return { ...state, path: EMPTY_STARLINK_PATH };

  const combo = nextStarlinkComboCount(state.combo, state.lastCommitActiveMs, activeMs, rules);
  const breakdown: StarlinkScoreBreakdown = release.kind === 'LOOP'
    ? scoreStarlinkLoopClear(release.removedCount, combo, rules)
    : scoreStarlinkNormalClear(release.pathLength, combo, rules);

  return {
    ...state,
    phase: 'SETTLING',
    path: EMPTY_STARLINK_PATH,
    score: state.score + breakdown.awardedScore,
    combo,
    lastCommitActiveMs: activeMs,
    settleUntilWallMs: wallMs + rules.settleMs,
    pendingRemovedCells: release.removedCells,
    stats: {
      totalRemovedStars: state.stats.totalRemovedStars + release.removedCount,
      normalClearCount: state.stats.normalClearCount + Number(release.kind === 'NORMAL'),
      loopCount: state.stats.loopCount + Number(release.kind === 'LOOP'),
      maxLinkLength: Math.max(state.stats.maxLinkLength, release.pathLength),
      maxCombo: Math.max(state.stats.maxCombo, combo),
      largestLoopRemovedCount: release.kind === 'LOOP'
        ? Math.max(state.stats.largestLoopRemovedCount, release.removedCount)
        : state.stats.largestLoopRemovedCount,
      reshuffleCount: state.stats.reshuffleCount,
    },
    clears: [
      ...state.clears,
      {
        activeCommitMs: activeMs,
        wallCommitMs: wallMs,
        pathLength: release.pathLength,
        removedCount: release.removedCount,
        kind: release.kind,
        combo,
        awardedScore: breakdown.awardedScore,
      },
    ],
  };
}

export function replayStarlinkRun(
  gameplaySeed: number,
  events: readonly StarlinkInputEvent[],
  submissionWallMs: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkReplayResult {
  validMs(submissionWallMs);
  if (!Array.isArray(events) || events.length > 5_000) throw new Error('Starlink event count exceeds maximum.');
  let state = createStarlinkRun(gameplaySeed, rules);
  for (const event of events) {
    state = applyStarlinkEvent(state, event, rules);
  }
  if (submissionWallMs < (events.length ? events[events.length - 1].elapsed_ms : 0)) {
    throw new Error('Starlink submission is earlier than the last event.');
  }
  state = advanceStarlinkRun(state, submissionWallMs, rules);
  if (state.phase !== 'GAME_OVER' || state.finalEndWallMs === null) {
    throw new Error('Starlink normal-complete submission is earlier than game end.');
  }
  return {
    official_score: state.score,
    official_duration_ms: rules.activeDurationMs,
    game_end_wall_ms: state.finalEndWallMs,
    paused_total_ms: state.pausedTotalMs,
    board: state.board,
    refill_rng_state: state.refillRngState,
    reshuffle_rng_state: state.reshuffleRngState,
    stats: state.stats,
    clear_log: state.clears,
    phase: 'GAME_OVER',
  };
}
