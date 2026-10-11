import assert from 'node:assert/strict';
import { xorshift32Next } from '../../../arcade_rng';
import {
  analyzeStarlinkBoard,
  forceStarlinkPlayableFallback,
  generateStarlinkInitialBoard,
  refillStarlinkBoard,
  reshuffleStarlinkDeadBoard,
  starlinkBoardSignature,
} from '../starlinkBoard';
import { STARLINK_BOARD_GOLDEN_V03 } from '../starlinkGoldenFixture';

function assertMetrics(actual: ReturnType<typeof analyzeStarlinkBoard>, expected: typeof actual) {
  assert.deepEqual(actual, expected);
}

function testRngGolden() {
  let state = STARLINK_BOARD_GOLDEN_V03.rngSeed;
  const actual: number[] = [];
  for (let index = 0; index < STARLINK_BOARD_GOLDEN_V03.rngFirst10.length; index += 1) {
    state = xorshift32Next(state);
    actual.push(state);
  }
  assert.deepEqual(actual, STARLINK_BOARD_GOLDEN_V03.rngFirst10);
}

function testInitialBoardGolden() {
  const expected = STARLINK_BOARD_GOLDEN_V03.initial;
  const actual = generateStarlinkInitialBoard(STARLINK_BOARD_GOLDEN_V03.rngSeed);

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
    fixture.initial.rngState,
  );

  assert.equal(actual.removedCount, fixture.refill.removedCells.length);
  assert.equal(actual.rngState, fixture.refill.rngState);
  assert.deepEqual(actual.board, fixture.refill.board);
  assertMetrics(actual.metrics, fixture.refill.metrics);
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
    fixture.reshuffle.rngSeed,
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

function testGuards() {
  const fixture = STARLINK_BOARD_GOLDEN_V03;
  assert.throws(
    () => refillStarlinkBoard(fixture.initial.board, [23, 23], fixture.initial.rngState),
    /duplicates/,
  );
  assert.throws(
    () => reshuffleStarlinkDeadBoard(fixture.initial.board, 123),
    /dead board/,
  );
  assert.throws(() => xorshift32Next(0), /non-zero unsigned 32-bit/);
}

const tests: Array<[string, () => void]> = [
  ['RNG golden sequence', testRngGolden],
  ['initial board golden', testInitialBoardGolden],
  ['gravity/refill golden', testRefillGolden],
  ['dead-board hard fallback golden', testDeadBoardAndFallbackGolden],
  ['dead-board reshuffle golden', testReshuffleGolden],
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
process.stdout.write(`Starlink deterministic board tests passed: ${tests.length}/${tests.length}\n`);
