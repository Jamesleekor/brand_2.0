import { assertNonZeroUint32, deriveStarlinkRngStreams, nextModulo, xorshift32Next } from '../../arcade_rng';
import { STARLINK_V03_BOARD_RULES } from './starlinkRules';
import type {
  StarlinkBoard,
  StarlinkBoardMetrics,
  StarlinkBoardRules,
  StarlinkInitialBoardResult,
  StarlinkRefillResult,
  StarlinkReshuffleResult,
  StarlinkStarType,
} from './starlinkTypes';

const BOARD_SIZE = 49;

function boardSize(rules: StarlinkBoardRules) {
  return rules.rows * rules.cols;
}

function assertBoard(board: readonly number[], rules: StarlinkBoardRules): asserts board is StarlinkBoard {
  if (board.length !== boardSize(rules)) {
    throw new Error(`Starlink board must contain exactly ${boardSize(rules)} cells.`);
  }
  for (const value of board) {
    if (!Number.isInteger(value) || value < 0 || value >= rules.starTypeCount) {
      throw new Error('Starlink board contains an invalid star type.');
    }
  }
}

function asStarType(value: number): StarlinkStarType {
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error('Starlink star type must be an integer from 0 to 5.');
  }
  return value as StarlinkStarType;
}

export function starlinkCellRow(cell: number, rules = STARLINK_V03_BOARD_RULES): number {
  return Math.floor(cell / rules.cols);
}

export function starlinkCellCol(cell: number, rules = STARLINK_V03_BOARD_RULES): number {
  return cell % rules.cols;
}

export function areStarlinkCellsAdjacent8(a: number, b: number, rules = STARLINK_V03_BOARD_RULES): boolean {
  if (a === b || a < 0 || b < 0 || a >= boardSize(rules) || b >= boardSize(rules)) return false;
  const rowDelta = Math.abs(starlinkCellRow(a, rules) - starlinkCellRow(b, rules));
  const colDelta = Math.abs(starlinkCellCol(a, rules) - starlinkCellCol(b, rules));
  return rowDelta <= 1 && colDelta <= 1;
}

export function analyzeStarlinkBoard(
  board: readonly number[],
  rules = STARLINK_V03_BOARD_RULES,
): StarlinkBoardMetrics {
  assertBoard(board, rules);

  const size = boardSize(rules);
  const visited = new Array<boolean>(size).fill(false);
  const typeDistribution = new Array<number>(rules.starTypeCount).fill(0);
  let componentCount = 0;
  let playableComponentCount = 0;
  let largestComponent = 0;
  let removableStarCount = 0;
  let componentCountAtLeastFour = 0;

  for (const type of board) typeDistribution[type] += 1;

  for (let start = 0; start < size; start += 1) {
    if (visited[start]) continue;

    componentCount += 1;
    const starType = board[start];
    const queue = [start];
    visited[start] = true;
    let cursor = 0;
    let componentSize = 0;

    while (cursor < queue.length) {
      const cell = queue[cursor];
      cursor += 1;
      componentSize += 1;

      const row = starlinkCellRow(cell, rules);
      const col = starlinkCellCol(cell, rules);

      for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
        for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
          if (rowDelta === 0 && colDelta === 0) continue;
          const nextRow = row + rowDelta;
          const nextCol = col + colDelta;
          if (nextRow < 0 || nextRow >= rules.rows || nextCol < 0 || nextCol >= rules.cols) continue;

          const nextCell = nextRow * rules.cols + nextCol;
          if (!visited[nextCell] && board[nextCell] === starType) {
            visited[nextCell] = true;
            queue.push(nextCell);
          }
        }
      }
    }

    largestComponent = Math.max(largestComponent, componentSize);
    if (componentSize >= 3) {
      playableComponentCount += 1;
      removableStarCount += componentSize;
    }
    if (componentSize >= 4) componentCountAtLeastFour += 1;
  }

  return {
    componentCount,
    playableComponentCount,
    largestComponent,
    removableStarCount,
    componentCountAtLeastFour,
    typeDistribution,
    playable: playableComponentCount > 0,
  };
}

export function starlinkBoardSignature(board: readonly number[], rules = STARLINK_V03_BOARD_RULES): string {
  assertBoard(board, rules);
  return board.join('');
}

function generateCandidateBoard(
  rngState: number,
  rules: StarlinkBoardRules,
): { board: StarlinkBoard; rngState: number } {
  let state = assertNonZeroUint32(rngState);
  const board: StarlinkStarType[] = [];

  // Locked RNG consumption order: cell_id 0 -> 48 (row-major).
  for (let cell = 0; cell < boardSize(rules); cell += 1) {
    const next = nextModulo(state, rules.starTypeCount);
    state = next.state;
    board.push(asStarType(next.value));
  }

  return { board, rngState: state };
}

export function forceStarlinkPlayableFallback(
  board: readonly number[],
  rules = STARLINK_V03_BOARD_RULES,
): StarlinkBoard {
  assertBoard(board, rules);

  const next = [...board] as StarlinkStarType[];
  const counts = new Array<number>(rules.starTypeCount).fill(0);
  for (const type of next) counts[type] += 1;

  let targetType = 0;
  for (let type = 1; type < counts.length; type += 1) {
    if (counts[type] > counts[targetType]) targetType = type;
  }

  const targetCells = new Set<number>(rules.fallbackTargetCells);
  for (const targetCell of rules.fallbackTargetCells) {
    if (next[targetCell] === targetType) continue;

    let sourceCell = -1;
    for (let cell = 0; cell < next.length; cell += 1) {
      if (targetCells.has(cell)) continue;
      if (next[cell] === targetType) {
        sourceCell = cell;
        break;
      }
    }

    if (sourceCell < 0) {
      throw new Error('Starlink hard fallback could not find a count-preserving source star.');
    }

    const previous = next[targetCell];
    next[targetCell] = asStarType(targetType);
    next[sourceCell] = previous;
  }

  if (!analyzeStarlinkBoard(next, rules).playable) {
    throw new Error('Starlink hard fallback failed to create a playable board.');
  }

  return next;
}

export function generateStarlinkInitialBoard(
  seed: number,
  rules = STARLINK_V03_BOARD_RULES,
): StarlinkInitialBoardResult {
  const streams = deriveStarlinkRngStreams(seed);
  let state = streams.initial;
  let firstPlayable: StarlinkBoard | null = null;
  let firstPlayableMetrics: StarlinkBoardMetrics | null = null;
  let lastCandidate: StarlinkBoard | null = null;

  for (let attempt = 1; attempt <= rules.initialGenerationAttempts; attempt += 1) {
    const candidate = generateCandidateBoard(state, rules);
    state = candidate.rngState;
    lastCandidate = candidate.board;

    const metrics = analyzeStarlinkBoard(candidate.board, rules);
    if (metrics.playable && firstPlayable === null) {
      firstPlayable = [...candidate.board] as StarlinkBoard;
      firstPlayableMetrics = metrics;
    }

    if (metrics.playable && metrics.largestComponent <= rules.initialMaxComponentSoft) {
      return {
        board: candidate.board,
        rngState: state,
        attempts: attempt,
        acceptedBy: 'SOFT',
        metrics,
      };
    }
  }

  // All attempted candidates were actually consumed from the stream. If SOFT never
  // passed, future RNG continues from the final attempted state even when we choose
  // an earlier firstPlayable board.
  if (firstPlayable && firstPlayableMetrics) {
    return {
      board: firstPlayable,
      rngState: state,
      attempts: rules.initialGenerationAttempts,
      acceptedBy: 'FIRST_PLAYABLE',
      metrics: firstPlayableMetrics,
    };
  }

  if (!lastCandidate) throw new Error('Starlink initial board generation produced no candidate.');

  const fallbackBoard = forceStarlinkPlayableFallback(lastCandidate, rules);
  return {
    board: fallbackBoard,
    rngState: state,
    attempts: rules.initialGenerationAttempts,
    acceptedBy: 'HARD_FALLBACK',
    metrics: analyzeStarlinkBoard(fallbackBoard, rules),
  };
}

export function refillStarlinkBoard(
  board: readonly number[],
  removedCells: readonly number[],
  rngState: number,
  rules = STARLINK_V03_BOARD_RULES,
): StarlinkRefillResult {
  assertBoard(board, rules);
  let state = assertNonZeroUint32(rngState);
  const uniqueRemoved = new Set<number>();

  for (const cell of removedCells) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= boardSize(rules)) {
      throw new Error('Starlink removed cell is outside the board.');
    }
    if (uniqueRemoved.has(cell)) {
      throw new Error('Starlink removed cell list contains duplicates.');
    }
    uniqueRemoved.add(cell);
  }

  const result = new Array<StarlinkStarType | null>(boardSize(rules)).fill(null);

  for (let col = 0; col < rules.cols; col += 1) {
    let targetRow = rules.rows - 1;

    // Compact existing stars downward while preserving their relative vertical order.
    for (let sourceRow = rules.rows - 1; sourceRow >= 0; sourceRow -= 1) {
      const sourceCell = sourceRow * rules.cols + col;
      if (uniqueRemoved.has(sourceCell)) continue;
      const targetCell = targetRow * rules.cols + col;
      result[targetCell] = asStarType(board[sourceCell]);
      targetRow -= 1;
    }

    // Locked refill RNG consumption: column 0 -> 6, lower empty row -> upper row.
    for (let refillRow = targetRow; refillRow >= 0; refillRow -= 1) {
      const next = nextModulo(state, rules.starTypeCount);
      state = next.state;
      result[refillRow * rules.cols + col] = asStarType(next.value);
    }
  }

  if (result.some((value) => value === null)) {
    throw new Error('Starlink refill left an empty cell.');
  }

  const completed = result as StarlinkStarType[];
  return {
    board: completed,
    rngState: state,
    removedCount: uniqueRemoved.size,
    metrics: analyzeStarlinkBoard(completed, rules),
  };
}

function fisherYatesCandidate(
  board: StarlinkBoard,
  rngState: number,
): { board: StarlinkBoard; rngState: number } {
  let state = assertNonZeroUint32(rngState);
  const candidate = [...board] as StarlinkStarType[];

  for (let index = candidate.length - 1; index > 0; index -= 1) {
    state = xorshift32Next(state);
    const swapIndex = state % (index + 1);
    const value = candidate[index];
    candidate[index] = candidate[swapIndex];
    candidate[swapIndex] = value;
  }

  return { board: candidate, rngState: state };
}

export function reshuffleStarlinkDeadBoard(
  board: readonly number[],
  rngState: number,
  rules = STARLINK_V03_BOARD_RULES,
): StarlinkReshuffleResult {
  assertBoard(board, rules);
  if (analyzeStarlinkBoard(board, rules).playable) {
    throw new Error('Starlink reshuffle must only be called for a dead board.');
  }

  const sourceBoard = [...board] as StarlinkBoard;
  let state = assertNonZeroUint32(rngState);
  let lastCandidate: StarlinkBoard | null = null;

  // Every attempt shuffles the same source multiset. Attempts do not chain from the
  // preceding permutation; only the RNG state advances.
  for (let attempt = 1; attempt <= rules.reshuffleAttempts; attempt += 1) {
    const shuffled = fisherYatesCandidate(sourceBoard, state);
    state = shuffled.rngState;
    lastCandidate = shuffled.board;
    const metrics = analyzeStarlinkBoard(shuffled.board, rules);

    if (metrics.playable) {
      return {
        board: shuffled.board,
        rngState: state,
        attempts: attempt,
        usedHardFallback: false,
        metrics,
      };
    }
  }

  if (!lastCandidate) throw new Error('Starlink reshuffle produced no candidate.');

  const fallbackBoard = forceStarlinkPlayableFallback(lastCandidate, rules);
  return {
    board: fallbackBoard,
    rngState: state,
    attempts: rules.reshuffleAttempts,
    usedHardFallback: true,
    metrics: analyzeStarlinkBoard(fallbackBoard, rules),
  };
}

export const STARLINK_BOARD_CELL_COUNT = BOARD_SIZE;
