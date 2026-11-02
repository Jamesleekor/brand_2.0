export type StarlinkStarType = 0 | 1 | 2 | 3 | 4 | 5;
export type StarlinkBoard = readonly StarlinkStarType[];

export interface StarlinkBoardRules {
  rows: 7;
  cols: 7;
  starTypeCount: 6;
  initialMaxComponentSoft: number;
  initialGenerationAttempts: number;
  reshuffleAttempts: number;
  fallbackTargetCells: readonly [number, number, number];
}

export interface StarlinkBoardMetrics {
  componentCount: number;
  playableComponentCount: number;
  largestComponent: number;
  removableStarCount: number;
  componentCountAtLeastFour: number;
  typeDistribution: readonly number[];
  playable: boolean;
}

export interface StarlinkInitialBoardResult {
  board: StarlinkBoard;
  rngState: number;
  attempts: number;
  acceptedBy: 'SOFT' | 'FIRST_PLAYABLE' | 'HARD_FALLBACK';
  metrics: StarlinkBoardMetrics;
}

export interface StarlinkRefillResult {
  board: StarlinkBoard;
  rngState: number;
  removedCount: number;
  metrics: StarlinkBoardMetrics;
}

export interface StarlinkReshuffleResult {
  board: StarlinkBoard;
  rngState: number;
  attempts: number;
  usedHardFallback: boolean;
  metrics: StarlinkBoardMetrics;
}
