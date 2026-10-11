import type { StarlinkBoardMetrics, StarlinkStarType } from './starlinkTypes';

export interface StarlinkBoardGoldenFixture {
  name: string;
  gameplaySeed: number;
  derivedStates: {
    initial: number;
    refill: number;
    reshuffle: number;
  };
  derivedFirst10: {
    initial: readonly number[];
    refill: readonly number[];
    reshuffle: readonly number[];
  };
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
    attempts: number;
    rngState: number;
    board: readonly StarlinkStarType[];
    metrics: StarlinkBoardMetrics;
  };
  loopBoard: readonly StarlinkStarType[];
  simpleLoopPath: readonly number[];
  selfIntersectingLoopPath: readonly number[];
}

// Canonical cross-language fixture for the FINAL starlink_04_v0.3 RNG contract.
export const STARLINK_BOARD_GOLDEN_V03: StarlinkBoardGoldenFixture = {
  name: 'STARLINK_V03_BOARD_ENGINE_GOLDEN_002',
  gameplaySeed: 6059,
  derivedStates: {
    initial: 2717272021,
    refill: 150626425,
    reshuffle: 3968834942,
  },
  derivedFirst10: {
    initial: [
      1217837363,1772243851,984893346,4199255746,4192397931,
      827645884,4274149197,828245592,3275402450,1119115202,
    ],
    refill: [
      3663274595,1018335305,3117114772,2051566120,2527552622,
      1064941083,1054902790,3685476118,1315431154,4110845486,
    ],
    reshuffle: [
      4213837614,3812481897,1380597601,2707727346,2521159327,
      3193059924,3657440728,4006957477,3638274421,324972143,
    ],
  },
  initial: {
    attempts: 2,
    rngState: 3695321621,
    board: [
      2,4,2,2,3,1,0,
      1,2,1,2,5,0,1,
      5,5,2,4,5,5,1,
      1,4,1,0,4,0,4,
      0,4,4,1,1,2,3,
      5,4,0,4,5,4,2,
      0,0,2,3,1,5,5,
    ],
    metrics: {
      componentCount: 26,
      playableComponentCount: 7,
      largestComponent: 6,
      removableStarCount: 26,
      componentCountAtLeastFour: 2,
      typeDistribution: [8,10,9,3,10,9],
      playable: true,
    },
  },
  refill: {
    removedCells: [0,8,2],
    rngState: 3117114772,
    board: [
      5,5,4,2,3,1,0,
      1,4,1,2,5,0,1,
      5,5,2,4,5,5,1,
      1,4,1,0,4,0,4,
      0,4,4,1,1,2,3,
      5,4,0,4,5,4,2,
      0,0,2,3,1,5,5,
    ],
    metrics: {
      componentCount: 27,
      playableComponentCount: 7,
      largestComponent: 5,
      removableStarCount: 23,
      componentCountAtLeastFour: 1,
      typeDistribution: [8,10,6,3,11,11],
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
    attempts: 2,
    rngState: 2063970340,
    board: [
      4,3,4,4,2,2,4,
      1,1,5,3,4,0,1,
      2,2,3,5,4,2,4,
      5,4,0,1,0,3,1,
      3,0,0,1,4,2,2,
      0,3,1,2,0,5,3,
      0,5,2,0,5,0,5,
    ],
    metrics: {
      componentCount: 28,
      playableComponentCount: 5,
      largestComponent: 5,
      removableStarCount: 18,
      componentCountAtLeastFour: 2,
      typeDistribution: [10,7,9,7,9,7],
      playable: true,
    },
  },
  loopBoard: [
    5,1,2,3,0,1,5,
    3,5,5,2,3,0,1,
    2,5,0,5,2,3,0,
    1,2,5,5,1,2,3,
    5,1,2,3,0,1,5,
    3,0,1,2,3,0,1,
    5,3,0,1,2,3,5,
  ],
  simpleLoopPath: [8,9,17,23,15],
  selfIntersectingLoopPath: [8,16,15,9,1],
};
