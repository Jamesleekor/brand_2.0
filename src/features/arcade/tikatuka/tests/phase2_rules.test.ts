import {
  SeededRandomSource,
  calculateRowScore,
  createInitialTikatukaState,
  getLegalPlacements,
  resolveKnockOff,
} from '../engine';
import type { Die, DieKind, DieValue, Side } from '../engine';
import { assertDeepEqual, assertEqual, test } from './testHarness';

function die(id: string, value: DieValue, kind: DieKind, owner: Side): Die {
  return { id, value, kind, owner };
}

test('score: single/double/triple and mixed groups follow x1/x3/x5', () => {
  assertEqual(calculateRowScore({ dice: [die('a', 5, 'normal', 'player')] }), 5);
  assertEqual(calculateRowScore({ dice: [die('a', 5, 'normal', 'player'), die('b', 5, 'normal', 'player')] }), 15);
  assertEqual(calculateRowScore({ dice: [
    die('a', 5, 'normal', 'player'),
    die('b', 5, 'normal', 'player'),
    die('c', 5, 'normal', 'player'),
  ] }), 25);
  assertEqual(calculateRowScore({ dice: [
    die('a', 5, 'normal', 'player'),
    die('b', 5, 'normal', 'player'),
    die('c', 2, 'normal', 'player'),
  ] }), 17);
});

test('score: shield is a full scoring die regardless of provenance owner', () => {
  assertEqual(calculateRowScore({ dice: [
    die('a', 5, 'normal', 'ai'),
    die('b', 5, 'shield', 'player'),
  ] }), 15);
  assertEqual(calculateRowScore({ dice: [
    die('a', 5, 'normal', 'ai'),
    die('b', 5, 'normal', 'ai'),
    die('c', 5, 'shield', 'player'),
  ] }), 25);
});

test('placement: normal may place on own free row or explicitly knock an opponent row with matching normals', () => {
  const state = createInitialTikatukaState('rules-placement', 1);
  state.sides.player.board.rows.top.dice = [
    die('p1', 1, 'normal', 'player'),
    die('p2', 2, 'normal', 'player'),
    die('p3', 3, 'normal', 'player'),
  ];
  state.sides.ai.board.rows.middle.dice = [
    die('a1', 4, 'normal', 'ai'),
    die('a2', 4, 'shield', 'ai'),
  ];

  const normalPlacements = getLegalPlacements(state, 'player', die('n', 4, 'normal', 'player'));
  assertDeepEqual(normalPlacements, [
    { targetSide: 'player', row: 'middle' },
    { targetSide: 'player', row: 'bottom' },
    { targetSide: 'ai', row: 'middle' },
  ]);

  const shieldPlacements = getLegalPlacements(state, 'player', die('s', 4, 'shield', 'player'));
  assertEqual(shieldPlacements.length, 5);
  assertEqual(shieldPlacements.filter((x) => x.targetSide === 'ai').length, 3);
});

test('knock: chosen opponent row loses matching normals, matching shields survive, attacking die is not placed here', () => {
  const state = createInitialTikatukaState('rules-knock', 1);
  state.sides.ai.board.rows.top.dice = [
    die('a1', 5, 'normal', 'ai'),
    die('a2', 5, 'shield', 'player'),
    die('a3', 5, 'normal', 'ai'),
  ];

  const result = resolveKnockOff(
    state,
    'player',
    { targetSide: 'ai', row: 'top' },
    die('attack', 5, 'normal', 'player'),
  );

  assertEqual(result.result.triggered, true);
  assertEqual(result.result.removedDice.length, 2);
  assertEqual(result.result.shieldEarned, true);
  assertDeepEqual(result.nextState.sides.ai.board.rows.top.dice.map((x) => [x.id, x.kind]), [['a2', 'shield']]);
  assertEqual(result.nextState.sides.player.board.rows.top.dice.length, 0);
});

test('rng: consuming ai RNG never changes the game RNG sequence', () => {
  const gameA = new SeededRandomSource(123456789);
  const gameB = new SeededRandomSource(123456789);
  const aiRng = new SeededRandomSource(987654321);

  for (let index = 0; index < 20; index += 1) aiRng.nextInt(1, 6);

  const sequenceA = Array.from({ length: 12 }, () => gameA.nextInt(1, 6));
  const sequenceB = Array.from({ length: 12 }, () => gameB.nextInt(1, 6));
  assertDeepEqual(sequenceA, sequenceB);
});
