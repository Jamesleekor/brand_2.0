/**
 * Starlink pointer → logical cell mapping (spec v0.3 §7, §7-A, §10).
 * Pure math only: no DOM hit-testing. The server never sees pixels; it only
 * replays the logical cell sequence produced here.
 */

export interface StarlinkBoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StarlinkHitOptions {
  /** Fraction of each cell edge that is NOT hittable (0.10 → central 90% hit area). */
  insetRatio: number;
  /** Start cell of a loop that may be closed right now: hit area is the full 100% cell. */
  loopCloseCell: number | null;
}

export const STARLINK_GRID = 7;
export const STARLINK_DEFAULT_HIT: StarlinkHitOptions = Object.freeze({ insetRatio: 0.10, loopCloseCell: null });

export interface StarlinkLocalPoint { x: number; y: number }

export function toBoardLocal(clientX: number, clientY: number, rect: StarlinkBoardRect): StarlinkLocalPoint {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * Half-open [x0,x1) × [y0,y1) cell mapping. Points exactly on the right/bottom
 * outer edge (floating error) are clamped inside. Points outside the board → null.
 */
export function cellIndexAt(point: StarlinkLocalPoint, rect: StarlinkBoardRect): { row: number; col: number; fx: number; fy: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const { x, y } = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const cw = rect.width / STARLINK_GRID;
  const ch = rect.height / STARLINK_GRID;
  const col = Math.min(STARLINK_GRID - 1, Math.max(0, Math.floor(x / cw)));
  const row = Math.min(STARLINK_GRID - 1, Math.max(0, Math.floor(y / ch)));
  const fx = Math.min(1, Math.max(0, x / cw - col));
  const fy = Math.min(1, Math.max(0, y / ch - row));
  return { row, col, fx, fy };
}

/** Cell under the point respecting the 90% normal hit area and 100% loop-close area. */
export function hitCellAt(point: StarlinkLocalPoint, rect: StarlinkBoardRect, options: StarlinkHitOptions = STARLINK_DEFAULT_HIT): number | null {
  const index = cellIndexAt(point, rect);
  if (!index) return null;
  const cell = index.row * STARLINK_GRID + index.col;
  if (options.loopCloseCell !== null && cell === options.loopCloseCell) return cell;
  const half = Math.min(0.45, Math.max(0, options.insetRatio / 2));
  if (index.fx < half || index.fx >= 1 - half || index.fy < half || index.fy >= 1 - half) return null;
  return cell;
}

/**
 * Cells whose hit area the straight pointer segment p0→p1 actually crosses,
 * in crossing order (consecutive duplicates removed, p0's own cell excluded
 * when it equals the first hit). Used to recover cells skipped by a fast
 * swipe between two pointermove samples. The caller still feeds each cell
 * through the locked CELL_ENTER rules, so nothing illegal can be invented:
 * only cells really crossed by the finger are offered, in the real order.
 */
export function cellsAlongSegment(
  p0: StarlinkLocalPoint,
  p1: StarlinkLocalPoint,
  rect: StarlinkBoardRect,
  options: StarlinkHitOptions = STARLINK_DEFAULT_HIT,
): number[] {
  const cw = rect.width / STARLINK_GRID;
  const ch = rect.height / STARLINK_GRID;
  const distance = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const step = Math.max(1, Math.min(cw, ch) / 10);
  const samples = Math.min(400, Math.max(1, Math.ceil(distance / step)));
  const cells: number[] = [];
  const startCell = hitCellAt(p0, rect, options);
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const cell = hitCellAt({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }, rect, options);
    if (cell === null) continue;
    if (cells.length === 0 ? cell === startCell : cells[cells.length - 1] === cell) continue;
    cells.push(cell);
  }
  return cells;
}

/** Center of a cell in board-local pixels (for drawing). */
export function cellCenter(cell: number, rect: { width: number; height: number }): StarlinkLocalPoint {
  const cw = rect.width / STARLINK_GRID;
  const ch = rect.height / STARLINK_GRID;
  return { x: (cell % STARLINK_GRID + 0.5) * cw, y: (Math.floor(cell / STARLINK_GRID) + 0.5) * ch };
}
