import type { StarlinkBoardMetrics, StarlinkStarType } from './starlinkTypes';

export interface StarlinkBoardGoldenFixture {
  name: string;
  rngSeed: number;
  rngFirst10: readonly number[];
  initial: {
    attempts: number;
    rngState: number;
    board: readonly StarlinkStarType[];
    metrics: StarlinkBoardMetrics;
  };
  refill: {
    removedCells: readonly number[];
    rngState: number;
    board: readonly StarlinkStarType[];
    metrics: StarlinkBoardMetrics;
  };
  deadBoard: readonly StarlinkStarType[];
  hardFallbackBoard: readonly StarlinkStarType[];
  reshuffle: {
    rngSeed: number;
    attempts: number;
    rngState: number;
    board: readonly StarlinkStarType[];
    metrics: StarlinkBoardMetrics;
  };
}

// Canonical cross-language fixture for starlink_04_v0.3.
// SQL postcheck asserts the exact same arrays/states.
export const STARLINK_BOARD_GOLDEN_V03: StarlinkBoardGoldenFixture = {
  name: 'STARLINK_V03_BOARD_ENGINE_GOLDEN_001',
  rngSeed: 5,
  rngFirst10: [
    1351845, 336141829, 3472693697, 3580160835, 1234782181,
    1306475959, 3881343203, 2094324449, 379170181, 1175100977,
  ],
  initial: {
    attempts: 3,
    rngState: 3052492330,
    board: [
      5,3,5,5,0,0,0,
      1,1,2,5,4,5,0,
      4,3,4,0,1,3,0,
      0,5,2,2,4,1,3,
      2,2,3,2,2,5,4,
      4,4,1,0,2,4,1,
      2,0,2,1,5,5,4,
    ],
    metrics: {
      componentCount: 29,
      playableComponentCount: 4,
      largestComponent: 7,
      removableStarCount: 18,
      componentCountAtLeastFour: 2,
      typeDistribution: [9,7,10,5,9,9],
      playable: true,
    },
  },
  refill: {
    removedCells: [23,24,28,29,31,32,39],
    rngState: 1892184262,
    board: [
      2,0,1,3,4,0,0,
      5,3,5,5,5,5,0,
      1,1,2,5,0,3,0,
      4,3,4,5,4,1,3,
      0,5,3,0,1,5,4,
      4,4,1,0,4,4,1,
      2,0,2,1,5,5,4,
    ],
    metrics: {
      componentCount: 30,
      playableComponentCount: 3,
      largestComponent: 6,
      removableStarCount: 14,
      componentCountAtLeastFour: 3,
      typeDistribution: [10,8,4,6,10,11],
      playable: true,
    },
  },
  deadBoard: [
    0,2,4,0,2,4,0,
    1,3,5,1,3,5,1,
    2,4,0,2,4,0,2,
    3,5,1,3,5,1,3,
    4,0,2,4,0,2,4,
    5,1,3,5,1,3,5,
    0,2,4,0,2,4,0,
  ],
  hardFallbackBoard: [
    1,2,4,3,2,4,5,
    1,3,5,1,3,5,1,
    2,4,0,2,4,0,2,
    3,5,0,0,0,1,3,
    4,0,2,4,0,2,4,
    5,1,3,5,1,3,5,
    0,2,4,0,2,4,0,
  ],
  reshuffle: {
    rngSeed: 4863,
    attempts: 2,
    rngState: 359457395,
    board: [
      4,2,0,0,1,4,1,
      2,0,4,4,5,3,5,
      2,1,3,3,5,1,0,
      3,5,1,3,5,2,0,
      0,1,2,0,4,2,0,
      5,2,5,0,4,2,3,
      3,2,0,4,4,4,1,
    ],
    metrics: {
      componentCount: 26,
      playableComponentCount: 10,
      largestComponent: 5,
      removableStarCount: 32,
      componentCountAtLeastFour: 1,
      typeDistribution: [10,7,9,7,9,7],
      playable: true,
    },
  },
};
