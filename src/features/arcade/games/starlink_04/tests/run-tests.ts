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

const tests: Array<[string, () => void]> = [
  ['derived RNG stream golden', testDerivedRngStreams],
  ['initial board golden', testInitialBoardGolden],
  ['gravity/refill golden', testRefillGolden],
  ['dead-board hard fallback golden', testDeadBoardAndFallbackGolden],
  ['dead-board reshuffle golden', testReshuffleGolden],
  ['path precedence + loop geometry', testPathPrecedenceAndLoopGeometry],
  ['release + scoring + combo boundaries', testReleaseAndScoring],
  ['validation guards', testGuards],
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
