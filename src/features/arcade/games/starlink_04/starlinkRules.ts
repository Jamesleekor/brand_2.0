import type { StarlinkBoardRules } from './starlinkTypes';

export interface StarlinkGameplayRules extends StarlinkBoardRules {
  minLinkCount: number;
  loopMinUniqueCount: number;
  loopMinTwiceArea: number;
  comboWindowMs: number;
  comboStepPercent: number;
  comboMaxPercent: number;
  baseScoreFactor: number;
  loopBonusPercent: number;
  settleMs: number;
  reshufflePauseMs: number;
  activeDurationMs: number;
}

export const STARLINK_V03_RULES: StarlinkGameplayRules = Object.freeze({
  rows: 7,
  cols: 7,
  starTypeCount: 6,
  minLinkCount: 3,
  loopMinUniqueCount: 5,
  loopMinTwiceArea: 2,
  comboWindowMs: 2000,
  comboStepPercent: 5,
  comboMaxPercent: 150,
  baseScoreFactor: 25,
  loopBonusPercent: 125,
  settleMs: 200,
  reshufflePauseMs: 350,
  activeDurationMs: 60_000,
  initialMaxComponentSoft: 8,
  initialGenerationAttempts: 64,
  reshuffleAttempts: 64,
  // Deterministic hard fallback target: center row, three horizontal adjacent cells.
  fallbackTargetCells: [23, 24, 25] as const,
});

export const STARLINK_V03_BOARD_RULES: StarlinkBoardRules = STARLINK_V03_RULES;

function parseInt(raw: Record<string, unknown>, key: string, fallback: number) {
  const value = raw[key] === undefined ? fallback : Number(raw[key]);
  if (!Number.isInteger(value)) throw new Error(`Invalid Starlink rule: ${key}`);
  return value;
}

export function parseStarlinkRules(raw: Record<string, unknown>): StarlinkGameplayRules {
  const rows = parseInt(raw,'rows',7);
  const cols = parseInt(raw,'cols',7);
  const starTypeCount = parseInt(raw,'starTypeCount',6);
  const minLinkCount = parseInt(raw,'minLinkCount',3);
  const loopMinUniqueCount = parseInt(raw,'loopMinUniqueCount',5);
  const loopMinTwiceArea = parseInt(raw,'loopMinTwiceArea',2);
  const comboWindowMs = parseInt(raw,'comboWindowMs',2000);
  const comboStepPercent = parseInt(raw,'comboStepPercent',5);
  const comboMaxPercent = parseInt(raw,'comboMaxPercent',150);
  const baseScoreFactor = parseInt(raw,'baseScoreFactor',25);
  const loopBonusPercent = parseInt(raw,'loopBonusPercent',125);
  const settleMs = parseInt(raw,'settleMs',200);
  const reshufflePauseMs = parseInt(raw,'reshufflePauseMs',350);
  const activeDurationMs = parseInt(raw,'activeDurationMs',60_000);
  const initialMaxComponentSoft = parseInt(raw,'initialMaxComponentSoft',8);
  const initialGenerationAttempts = parseInt(raw,'initialGenerationAttempts',64);
  const reshuffleAttempts = parseInt(raw,'reshuffleAttempts',64);
  const fallbackRaw = raw.fallbackTargetCells;
  const fallbackTargetCells = Array.isArray(fallbackRaw)
    ? fallbackRaw.map(Number)
    : [...STARLINK_V03_RULES.fallbackTargetCells];

  if (
    rows !== 7
    || cols !== 7
    || starTypeCount !== 6
    || minLinkCount !== 3
    || loopMinUniqueCount !== 5
    || loopMinTwiceArea !== 2
    || comboWindowMs !== 2000
    || comboStepPercent !== 5
    || comboMaxPercent !== 150
    || baseScoreFactor !== 25
    || loopBonusPercent !== 125
    || settleMs !== 200
    || reshufflePauseMs !== 350
    || activeDurationMs !== 60_000
    || initialMaxComponentSoft !== 8
    || initialGenerationAttempts !== 64
    || reshuffleAttempts !== 64
    || fallbackTargetCells.length !== 3
    || fallbackTargetCells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= 49)
    || fallbackTargetCells[0] !== 23
    || fallbackTargetCells[1] !== 24
    || fallbackTargetCells[2] !== 25
  ) {
    throw new Error('스타링크 v0.3 규칙 정보가 고정 규칙과 일치하지 않습니다.');
  }

  return {
    rows: 7,
    cols: 7,
    starTypeCount: 6,
    minLinkCount,
    loopMinUniqueCount,
    loopMinTwiceArea,
    comboWindowMs,
    comboStepPercent,
    comboMaxPercent,
    baseScoreFactor,
    loopBonusPercent,
    settleMs,
    reshufflePauseMs,
    activeDurationMs,
    initialMaxComponentSoft,
    initialGenerationAttempts,
    reshuffleAttempts,
    fallbackTargetCells: [23,24,25],
  };
}

export function parseStarlinkBoardRules(raw: Record<string, unknown>): StarlinkBoardRules {
  return parseStarlinkRules(raw);
}
