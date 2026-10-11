import type { StarlinkBoardRules } from './starlinkTypes';

export const STARLINK_V03_BOARD_RULES: StarlinkBoardRules = Object.freeze({
  rows: 7,
  cols: 7,
  starTypeCount: 6,
  initialMaxComponentSoft: 8,
  initialGenerationAttempts: 64,
  reshuffleAttempts: 64,
  // Deterministic hard fallback target: center row, three horizontal adjacent cells.
  fallbackTargetCells: [23, 24, 25] as const,
});

export function parseStarlinkBoardRules(raw: Record<string, unknown>): StarlinkBoardRules {
  const rows = Number(raw.rows);
  const cols = Number(raw.cols);
  const starTypeCount = Number(raw.starTypeCount);
  const initialMaxComponentSoft = Number(raw.initialMaxComponentSoft);
  const initialGenerationAttempts = Number(raw.initialGenerationAttempts);
  const reshuffleAttempts = Number(raw.reshuffleAttempts);
  const fallbackRaw = raw.fallbackTargetCells;
  const fallbackTargetCells = Array.isArray(fallbackRaw)
    ? fallbackRaw.map(Number)
    : [...STARLINK_V03_BOARD_RULES.fallbackTargetCells];

  if (
    rows !== 7
    || cols !== 7
    || starTypeCount !== 6
    || !Number.isInteger(initialMaxComponentSoft)
    || initialMaxComponentSoft < 3
    || !Number.isInteger(initialGenerationAttempts)
    || initialGenerationAttempts < 1
    || !Number.isInteger(reshuffleAttempts)
    || reshuffleAttempts < 1
    || fallbackTargetCells.length !== 3
    || fallbackTargetCells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= 49)
  ) {
    throw new Error('스타링크 보드 규칙 정보를 읽을 수 없습니다.');
  }

  return {
    rows: 7,
    cols: 7,
    starTypeCount: 6,
    initialMaxComponentSoft,
    initialGenerationAttempts,
    reshuffleAttempts,
    fallbackTargetCells: [
      fallbackTargetCells[0],
      fallbackTargetCells[1],
      fallbackTargetCells[2],
    ],
  };
}
