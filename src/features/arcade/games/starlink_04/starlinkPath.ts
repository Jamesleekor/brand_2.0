import { areStarlinkCellsAdjacent8, starlinkCellCol, starlinkCellRow } from './starlinkBoard';
import { STARLINK_V03_RULES, type StarlinkGameplayRules } from './starlinkRules';
import type { StarlinkBoard, StarlinkStarType } from './starlinkTypes';

export interface StarlinkPathState {
  currentType: StarlinkStarType | null;
  path: readonly number[];
  loopClosed: boolean;
}

export type StarlinkCellEnterAction = 'IGNORE' | 'APPEND' | 'BACKTRACK' | 'LOOP_CLOSE';

export interface StarlinkCellEnterResult {
  state: StarlinkPathState;
  action: StarlinkCellEnterAction;
}

export type StarlinkReleaseKind = 'CANCEL' | 'NORMAL' | 'LOOP';

export interface StarlinkReleaseResult {
  kind: StarlinkReleaseKind;
  pathLength: number;
  removedCells: readonly number[];
  removedCount: number;
  starType: StarlinkStarType | null;
  loopTwiceArea: number;
}

export const EMPTY_STARLINK_PATH: StarlinkPathState = Object.freeze({
  currentType: null,
  path: [],
  loopClosed: false,
});

function assertCell(cell: number, board: StarlinkBoard) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= board.length) {
    throw new Error('Starlink cell is outside the board.');
  }
}

export function startStarlinkPath(board: StarlinkBoard, cell: number): StarlinkPathState {
  assertCell(cell, board);
  return {
    currentType: board[cell],
    path: [cell],
    loopClosed: false,
  };
}

function orientation(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  const value = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return value === 0 ? 0 : value > 0 ? 1 : -1;
}

function pointOnSegment(
  ax: number, ay: number,
  bx: number, by: number,
  px: number, py: number,
): boolean {
  return (
    orientation(ax, ay, bx, by, px, py) === 0
    && px >= Math.min(ax, bx)
    && px <= Math.max(ax, bx)
    && py >= Math.min(ay, by)
    && py <= Math.max(ay, by)
  );
}

function segmentsIntersectInclusive(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  const ax = starlinkCellCol(a0);
  const ay = starlinkCellRow(a0);
  const bx = starlinkCellCol(a1);
  const by = starlinkCellRow(a1);
  const cx = starlinkCellCol(b0);
  const cy = starlinkCellRow(b0);
  const dx = starlinkCellCol(b1);
  const dy = starlinkCellRow(b1);

  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && pointOnSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && pointOnSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && pointOnSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

export function starlinkLoopTwiceArea(path: readonly number[]): number {
  if (path.length < 3) return 0;
  let twiceArea = 0;

  for (let index = 0; index < path.length; index += 1) {
    const current = path[index];
    const next = path[(index + 1) % path.length];
    const x1 = starlinkCellCol(current);
    const y1 = starlinkCellRow(current);
    const x2 = starlinkCellCol(next);
    const y2 = starlinkCellRow(next);
    twiceArea += x1 * y2 - x2 * y1;
  }

  return Math.abs(twiceArea);
}

export function isSimpleStarlinkLoop(path: readonly number[]): boolean {
  if (path.length < 3 || new Set(path).size !== path.length) return false;

  const edgeCount = path.length;
  for (let first = 0; first < edgeCount; first += 1) {
    const firstStart = path[first];
    const firstEnd = path[(first + 1) % edgeCount];

    for (let second = first + 1; second < edgeCount; second += 1) {
      // Adjacent polygon edges share one intended endpoint.
      if (second === first + 1) continue;
      if (first === 0 && second === edgeCount - 1) continue;

      const secondStart = path[second];
      const secondEnd = path[(second + 1) % edgeCount];
      if (segmentsIntersectInclusive(firstStart, firstEnd, secondStart, secondEnd)) {
        return false;
      }
    }
  }

  return true;
}

export function canCloseStarlinkLoop(
  state: StarlinkPathState,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): boolean {
  if (
    state.loopClosed
    || state.path.length < rules.loopMinUniqueCount
    || state.path.length < 2
  ) {
    return false;
  }

  const first = state.path[0];
  const last = state.path[state.path.length - 1];

  return (
    areStarlinkCellsAdjacent8(last, first, rules)
    && isSimpleStarlinkLoop(state.path)
    && starlinkLoopTwiceArea(state.path) >= rules.loopMinTwiceArea
  );
}

// Locked v0.3 CELL_ENTER precedence.
// 1 loop closed, 2 same-last, 3 backtrack, 4 loop close, 5 duplicate,
// 6 wrong type, 7 non-adjacent, 8 append.
export function enterStarlinkCell(
  board: StarlinkBoard,
  state: StarlinkPathState,
  cell: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkCellEnterResult {
  assertCell(cell, board);
  if (state.path.length === 0 || state.currentType === null) {
    return { state, action: 'IGNORE' };
  }

  if (state.loopClosed) return { state, action: 'IGNORE' };

  const last = state.path[state.path.length - 1];
  if (cell === last) return { state, action: 'IGNORE' };

  if (state.path.length >= 2 && cell === state.path[state.path.length - 2]) {
    return {
      action: 'BACKTRACK',
      state: {
        ...state,
        path: state.path.slice(0, -1),
      },
    };
  }

  if (cell === state.path[0] && canCloseStarlinkLoop(state, rules)) {
    return {
      action: 'LOOP_CLOSE',
      state: {
        ...state,
        loopClosed: true,
      },
    };
  }

  if (state.path.includes(cell)) return { state, action: 'IGNORE' };
  if (board[cell] !== state.currentType) return { state, action: 'IGNORE' };
  if (!areStarlinkCellsAdjacent8(last, cell, rules)) return { state, action: 'IGNORE' };

  return {
    action: 'APPEND',
    state: {
      ...state,
      path: [...state.path, cell],
    },
  };
}

export function cancelStarlinkPath(): StarlinkPathState {
  return EMPTY_STARLINK_PATH;
}

export function releaseStarlinkPath(
  board: StarlinkBoard,
  state: StarlinkPathState,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkReleaseResult {
  if (
    state.currentType === null
    || state.path.length < rules.minLinkCount
  ) {
    return {
      kind: 'CANCEL',
      pathLength: state.path.length,
      removedCells: [],
      removedCount: 0,
      starType: state.currentType,
      loopTwiceArea: 0,
    };
  }

  if (state.loopClosed) {
    const removedCells: number[] = [];
    for (let cell = 0; cell < board.length; cell += 1) {
      if (board[cell] === state.currentType) removedCells.push(cell);
    }

    return {
      kind: 'LOOP',
      pathLength: state.path.length,
      removedCells,
      removedCount: removedCells.length,
      starType: state.currentType,
      loopTwiceArea: starlinkLoopTwiceArea(state.path),
    };
  }

  return {
    kind: 'NORMAL',
    pathLength: state.path.length,
    removedCells: [...state.path],
    removedCount: state.path.length,
    starType: state.currentType,
    loopTwiceArea: 0,
  };
}
