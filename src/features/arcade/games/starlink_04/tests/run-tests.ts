import assert from 'node:assert/strict';
import {
  deriveStarlinkRngStreams,
  xorshift32Next,
} from '../../../arcade_rng';
import {
  analyzeStarlinkBoard,
  forceStarlinkPlayableFallback,
  generateStarlinkInitialBoard,
  refillStarlinkBoard,
  reshuffleStarlinkDeadBoard,
  starlinkBoardSignature,
} from '../starlinkBoard';
import { resolveStarlinkClearBoard } from '../starlinkClear';
import {
  createStarlinkRun,
  advanceStarlinkRun,
  starlinkActiveGameMs,
  applyStarlinkEvent,
  replayStarlinkRun,
  type StarlinkInputEvent,
} from '../starlinkRuntime';
import { STARLINK_BOARD_GOLDEN_V03 } from '../starlinkGoldenFixture';
import {
  canCloseStarlinkLoop,
  enterStarlinkCell,
  isSimpleStarlinkLoop,
  releaseStarlinkPath,
  startStarlinkPath,
  starlinkLoopTwiceArea,
} from '../starlinkPath';
import {
  nextStarlinkComboCount,
  scoreStarlinkLoopClear,
  scoreStarlinkNormalClear,
  starlinkComboMultiplierPercent,
} from '../starlinkScoring';

function assertMetrics(actual: ReturnType<typeof analyzeStarlinkBoard>, expected: typeof actual) {
  assert.deepEqual(actual, expected);
}

function testDerivedRngStreams() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  const streams = deriveStarlinkRngStreams(fixture.gameplaySeed);
  assert.deepEqual(streams, fixture.derivedStates);

  for (const key of ['initial','refill','reshuffle'] as const) {
    let state = streams[key];
    const actual: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      state = xorshift32Next(state);
      actual.push(state);
    }
    assert.deepEqual(actual, fixture.derivedFirst10[key]);
  }

  assert.notEqual(streams.initial, streams.refill);
  assert.notEqual(streams.initial, streams.reshuffle);
  assert.notEqual(streams.refill, streams.reshuffle);
}

function testInitialBoardGolden() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  const expected = fixture.initial;
  const actual = generateStarlinkInitialBoard(fixture.gameplaySeed);

  assert.equal(actual.attempts, expected.attempts);
  assert.equal(actual.acceptedBy, 'SOFT');
  assert.equal(actual.rngState, expected.rngState);
  assert.deepEqual(actual.board, expected.board);
  assertMetrics(actual.metrics, expected.metrics);
  assert.equal(starlinkBoardSignature(actual.board), expected.board.join(''));
}

function testRefillGolden() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  const actual = refillStarlinkBoard(
    fixture.initial.board,
    fixture.refill.removedCells,
    fixture.derivedStates.refill,
  );

  assert.equal(actual.removedCount, fixture.refill.removedCells.length);
  assert.equal(actual.rngState, fixture.refill.rngState);
  assert.deepEqual(actual.board, fixture.refill.board);
  assertMetrics(actual.metrics, fixture.refill.metrics);

  const resolution = resolveStarlinkClearBoard(
    fixture.initial.board,
    fixture.refill.removedCells,
    fixture.derivedStates.refill,
    fixture.derivedStates.reshuffle,
  );
  assert.equal(resolution.reshuffled, false);
  assert.equal(resolution.refillRngState, fixture.refill.rngState);
  assert.equal(resolution.reshuffleRngState, fixture.derivedStates.reshuffle);
  assert.deepEqual(resolution.board, fixture.refill.board);
}

function testDeadBoardAndFallbackGolden() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  const deadMetrics = analyzeStarlinkBoard(fixture.deadBoard);
  assert.equal(deadMetrics.playable, false);
  assert.equal(deadMetrics.largestComponent, 1);

  const fallback = forceStarlinkPlayableFallback(fixture.deadBoard);
  assert.deepEqual(fallback, fixture.hardFallbackBoard);

  const fallbackMetrics = analyzeStarlinkBoard(fallback);
  assert.equal(fallbackMetrics.playable, true);
  assert.deepEqual(fallbackMetrics.typeDistribution, deadMetrics.typeDistribution);
}

function testReshuffleGolden() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  const actual = reshuffleStarlinkDeadBoard(
    fixture.deadBoard,
    fixture.derivedStates.reshuffle,
  );

  assert.equal(actual.attempts, fixture.reshuffle.attempts);
  assert.equal(actual.usedHardFallback, false);
  assert.equal(actual.rngState, fixture.reshuffle.rngState);
  assert.deepEqual(actual.board, fixture.reshuffle.board);
  assertMetrics(actual.metrics, fixture.reshuffle.metrics);
  assert.deepEqual(
    actual.metrics.typeDistribution,
    analyzeStarlinkBoard(fixture.deadBoard).typeDistribution,
  );
}

function testPathPrecedenceAndLoopGeometry() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  const board = fixture.loopBoard;

  assert.equal(isSimpleStarlinkLoop(fixture.simpleLoopPath), true);
  assert.equal(starlinkLoopTwiceArea(fixture.simpleLoopPath), 5);
  assert.equal(isSimpleStarlinkLoop(fixture.selfIntersectingLoopPath), false);

  let state = startStarlinkPath(board, 8);

  let result = enterStarlinkCell(board, state, 8);
  assert.equal(result.action, 'IGNORE');

  result = enterStarlinkCell(board, state, 10); // wrong type
  assert.equal(result.action, 'IGNORE');

  result = enterStarlinkCell(board, state, 9);
  assert.equal(result.action, 'APPEND');
  state = result.state;

  result = enterStarlinkCell(board, state, 17);
  assert.equal(result.action, 'APPEND');
  state = result.state;

  result = enterStarlinkCell(board, state, 9); // immediate backtrack
  assert.equal(result.action, 'BACKTRACK');
  state = result.state;
  assert.deepEqual(state.path, [8,9]);

  result = enterStarlinkCell(board, state, 17);
  assert.equal(result.action, 'APPEND');
  state = result.state;

  result = enterStarlinkCell(board, state, 48); // same type, non-adjacent
  assert.equal(result.action, 'IGNORE');

  result = enterStarlinkCell(board, state, 23);
  assert.equal(result.action, 'APPEND');
  state = result.state;

  result = enterStarlinkCell(board, state, 9); // earlier duplicate, not predecessor
  assert.equal(result.action, 'IGNORE');

  result = enterStarlinkCell(board, state, 15);
  assert.equal(result.action, 'APPEND');
  state = result.state;

  assert.deepEqual(state.path, fixture.simpleLoopPath);
  assert.equal(canCloseStarlinkLoop(state), true);

  result = enterStarlinkCell(board, state, 8);
  assert.equal(result.action, 'LOOP_CLOSE');
  state = result.state;
  assert.equal(state.loopClosed, true);

  result = enterStarlinkCell(board, state, 9);
  assert.equal(result.action, 'IGNORE');

  const release = releaseStarlinkPath(board, state);
  assert.equal(release.kind, 'LOOP');
  assert.equal(release.pathLength, 5);
  assert.equal(release.removedCount, 12);
  assert.equal(release.loopTwiceArea, 5);
  assert.deepEqual(release.removedCells.filter((cell) => board[cell] === 5).length, 12);
}

function testReleaseAndScoring() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;

  const short = releaseStarlinkPath(
    fixture.loopBoard,
    enterStarlinkCell(
      fixture.loopBoard,
      startStarlinkPath(fixture.loopBoard, 8),
      9,
    ).state,
  );
  assert.equal(short.kind, 'CANCEL');
  assert.equal(short.removedCount, 0);

  const normal = scoreStarlinkNormalClear(6, 4);
  assert.equal(normal.baseScore, 750);
  assert.equal(normal.comboMultiplierPercent, 115);
  assert.equal(normal.awardedScore, 862);

  const loop = scoreStarlinkLoopClear(12, 4);
  assert.equal(loop.baseScore, 3300);
  assert.equal(loop.scoreBeforeCombo, 4125);
  assert.equal(loop.comboMultiplierPercent, 115);
  assert.equal(loop.awardedScore, 4743);

  assert.equal(starlinkComboMultiplierPercent(11), 150);
  assert.equal(starlinkComboMultiplierPercent(50), 150);

  assert.equal(nextStarlinkComboCount(3, 10_000, 12_000), 4);
  assert.equal(nextStarlinkComboCount(3, 10_000, 12_001), 1);
  assert.equal(nextStarlinkComboCount(0, null, 500), 1);
}

function testGuards() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  assert.throws(
    () => refillStarlinkBoard(fixture.initial.board, [0,0], fixture.derivedStates.refill),
    /duplicates/,
  );
  assert.throws(
    () => reshuffleStarlinkDeadBoard(fixture.initial.board, fixture.derivedStates.reshuffle),
    /dead board/,
  );
  assert.throws(() => xorshift32Next(0), /non-zero unsigned 32-bit/);
}


const STARLINK_REPLAY_GOLDEN_EVENTS: StarlinkInputEvent[] = [
  { type: 'PATH_START', elapsed_ms: 100, cell: 22 },
  { type: 'CELL_ENTER', elapsed_ms: 150, cell: 29 },
  { type: 'CELL_ENTER', elapsed_ms: 200, cell: 30 },
  { type: 'CELL_ENTER', elapsed_ms: 220, cell: 36 },
  { type: 'PATH_RELEASE', elapsed_ms: 250 },
  { type: 'PATH_START', elapsed_ms: 450, cell: 3 },
  { type: 'CELL_ENTER', elapsed_ms: 470, cell: 9 },
  { type: 'CELL_ENTER', elapsed_ms: 490, cell: 10 },
  { type: 'PATH_RELEASE', elapsed_ms: 500 },
];

function testRuntimeTwoClearsAndComboGolden() {
  const result = replayStarlinkRun(6059, STARLINK_REPLAY_GOLDEN_EVENTS, 60_000);
  assert.equal(result.phase, 'GAME_OVER');
  assert.equal(result.official_score, 457);
  assert.equal(result.official_duration_ms, 60_000);
  assert.equal(result.game_end_wall_ms, 60_000);
  assert.equal(result.paused_total_ms, 0);
  assert.equal(result.refill_rng_state, 1054902790);
  assert.equal(result.reshuffle_rng_state, 3968834942);
  assert.deepEqual(result.stats, {
    totalRemovedStars: 7,
    normalClearCount: 2,
    loopCount: 0,
    maxLinkLength: 4,
    maxCombo: 2,
    largestLoopRemovedCount: 0,
    reshuffleCount: 0,
  });
  assert.deepEqual(result.clear_log.map(c => c.awardedScore), [300,157]);
  assert.deepEqual(result.clear_log.map(c => c.activeCommitMs), [250,500]);
  assert.deepEqual(result.board, [
    2,4,2,4,3,1,0,1,5,4,3,5,0,1,5,5,1,4,5,5,1,1,4,2,0,4,0,4,
    0,2,1,1,1,2,3,5,5,0,4,5,4,2,0,0,2,3,1,5,5,
  ]);
}

function testRuntimeTerminalDuringSettle() {
  const events: StarlinkInputEvent[] = [
    { type: 'PATH_START', elapsed_ms: 59_900, cell: 22 },
    { type: 'CELL_ENTER', elapsed_ms: 59_910, cell: 29 },
    { type: 'CELL_ENTER', elapsed_ms: 59_920, cell: 30 },
    { type: 'CELL_ENTER', elapsed_ms: 59_930, cell: 36 },
    { type: 'PATH_RELEASE', elapsed_ms: 59_999 },
  ];
  const result = replayStarlinkRun(6059,events,60_000);
  assert.equal(result.official_score,300);
  assert.equal(result.stats.normalClearCount,1);
  assert.equal(result.stats.totalRemovedStars,4);
  assert.equal(result.game_end_wall_ms,60_000);
  assert.equal(result.refill_rng_state,150626425);
  assert.deepEqual(result.board, STARLINK_BOARD_GOLDEN_V03.initial.board);

  const expired = replayStarlinkRun(6059,[
    ...events.slice(0,-1),
    {type:'PATH_RELEASE',elapsed_ms:60_000},
  ],60_000);
  assert.equal(expired.official_score,0);
  assert.equal(expired.stats.normalClearCount,0);
}

function testRuntimeLockedInputAndIncomplete() {
  const first = STARLINK_REPLAY_GOLDEN_EVENTS.slice(0,5);
  assert.throws(() => replayStarlinkRun(6059,[
    ...first,
    {type:'PATH_START',elapsed_ms:300,cell:3},
  ],60_000),/lock/);
  assert.throws(() => replayStarlinkRun(6059,first,59_999),/earlier than game end/);
  assert.throws(() => replayStarlinkRun(6059,[
    {type:'PATH_START',elapsed_ms:150,cell:22},
    {type:'CELL_ENTER',elapsed_ms:149,cell:29},
  ],60_000),/backwards/);
  assert.throws(() => replayStarlinkRun(6059,[
    {type:'CELL_ENTER',elapsed_ms:100,cell:22},
  ],60_000),/without PATH_START/);
  assert.throws(() => replayStarlinkRun(6059,[
    {type:'PATH_START',elapsed_ms:100,cell:22},
    {type:'PATH_START',elapsed_ms:120,cell:29},
  ],60_000),/while path is active/);

  const cancelResult = replayStarlinkRun(6059,[
    {type:'PATH_START',elapsed_ms:100,cell:22},
    {type:'CELL_ENTER',elapsed_ms:150,cell:29},
    {type:'PATH_CANCEL',elapsed_ms:170},
  ],60_000);
  assert.equal(cancelResult.official_score,0);
}

function testRuntimeReshuffleClockFreeze() {
  const initial = createStarlinkRun(6059);
  const artificialPause = {
    ...initial,
    phase: 'RESHUFFLING' as const,
    wallMs: 650,
    reshuffleUntilWallMs: 1000,
    stats: {...initial.stats,reshuffleCount:1},
  };
  const middle = advanceStarlinkRun(artificialPause,900);
  assert.equal(middle.phase,'RESHUFFLING');
  assert.equal(starlinkActiveGameMs(middle),650);
  const completed = advanceStarlinkRun(middle,1000);
  assert.equal(completed.phase,'PLAYING');
  assert.equal(completed.pausedTotalMs,350);
  assert.equal(starlinkActiveGameMs(completed),650);
  const later = advanceStarlinkRun(completed,1030);
  assert.equal(starlinkActiveGameMs(later),680);
  assert.equal(nextStarlinkComboCount(1,500,650),2);
  assert.equal(advanceStarlinkRun(completed,60_350).phase,'GAME_OVER');
  assert.equal(advanceStarlinkRun(completed,60_350).finalEndWallMs,60_350);

  const start = applyStarlinkEvent(initial,{type:'PATH_START',elapsed_ms:100,cell:22});
  const dropped = applyStarlinkEvent(start,{type:'PATH_CANCEL',elapsed_ms:150});
  assert.deepEqual(dropped.path.path,[]);
}


function testRuntimeRealReshuffleGolden() {
  // Seed 8 triggers its first dead-board immediately after clear #8.
  // The next start at 2290ms is exactly on the 350ms pause-resume boundary.
  const actions: ReadonlyArray<readonly [number,number,number,number]> = [
    [100,0,1,9],[330,2,9,16],[560,4,10,11],
    [790,8,16,10],[1020,24,30,36],[1250,1,8,16],
    [1480,0,1,7],[1710,2,9,16],[2290,2,8,7],
  ];
  const events: StarlinkInputEvent[] = actions.flatMap(([t,a,b,c]) => [
    {type:'PATH_START' as const,elapsed_ms:t,cell:a},
    {type:'CELL_ENTER' as const,elapsed_ms:t+10,cell:b},
    {type:'CELL_ENTER' as const,elapsed_ms:t+20,cell:c},
    {type:'PATH_RELEASE' as const,elapsed_ms:t+30},
  ]);
  const result = replayStarlinkRun(8,events,60350);
  assert.equal(result.official_score,1618);
  assert.equal(result.game_end_wall_ms,60350);
  assert.equal(result.paused_total_ms,350);
  assert.equal(result.refill_rng_state,627960630);
  assert.equal(result.reshuffle_rng_state,3318130477);
  assert.deepEqual(result.stats,{
    totalRemovedStars:27,
    normalClearCount:9,
    loopCount:0,
    maxLinkLength:3,
    maxCombo:9,
    largestLoopRemovedCount:0,
    reshuffleCount:1,
  });
  assert.deepEqual(result.clear_log.map(x=>x.awardedScore),[150,157,165,172,180,187,195,202,210]);
  assert.deepEqual(result.clear_log.map(x=>x.activeCommitMs),[130,360,590,820,1050,1280,1510,1740,1970]);
  assert.deepEqual(result.board,[
    3,5,0,2,3,4,3,0,4,1,0,4,2,0,1,0,5,1,2,1,0,5,0,4,3,5,3,0,
    1,2,1,1,4,4,1,1,1,2,4,5,5,0,2,0,1,1,5,0,4,
  ]);
  assert.throws(
    ()=>replayStarlinkRun(8,[
      ...events.slice(0,32),
      {type:'PATH_START',elapsed_ms:2050,cell:2},
    ],60350),
    /lock/,
  );
  assert.throws(()=>replayStarlinkRun(8,events,60349),/earlier than game end/);
}

const tests: Array<[string, () => void]> = [
  ['derived RNG stream golden', testDerivedRngStreams],
  ['initial board golden', testInitialBoardGolden],
  ['gravity/refill golden', testRefillGolden],
  ['dead-board hard fallback golden', testDeadBoardAndFallbackGolden],
  ['dead-board reshuffle golden', testReshuffleGolden],
  ['path precedence + loop geometry', testPathPrecedenceAndLoopGeometry],
  ['release + scoring + combo boundaries', testReleaseAndScoring],
  ['validation guards', testGuards],
  ['full runtime two-clear scoring golden', testRuntimeTwoClearsAndComboGolden],
  ['GAME_END outranks settle and late release', testRuntimeTerminalDuringSettle],
  ['runtime lock/error/cancel boundaries', testRuntimeLockedInputAndIncomplete],
  ['350ms reshuffle clock freeze', testRuntimeReshuffleClockFreeze],
  ['real dead-board reshuffle full replay golden', testRuntimeRealReshuffleGolden],
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    process.stdout.write(`[PASS] ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`[FAIL] ${name}\n`);
    console.error(error);
  }
}

if (failed > 0) process.exit(1);
process.stdout.write(`Starlink deterministic/input tests passed: ${tests.length}/${tests.length}\n`);
