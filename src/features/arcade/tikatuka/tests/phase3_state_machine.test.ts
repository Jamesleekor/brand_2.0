import {
  SeededRandomSource,
  SequenceRandomSource,
  assertGameStateInvariant,
  createInitialTikatukaState,
  dispatchTikatukaAction,
  validateAction,
} from '../engine';
import type { Die, DieValue, EngineDependencies, GameState, Side } from '../engine';
import { assert, assertEqual, assertThrows, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function shield(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'shield', owner };
}

function deterministicDeps(sequence: readonly number[]): {
  deps: EngineDependencies;
  gameRng: SequenceRandomSource;
} {
  const gameRng = new SequenceRandomSource(sequence);
  const aiRng = new SeededRandomSource(246813579);
  let nextId = 0;
  return {
    gameRng,
    deps: {
      gameRng,
      aiRng,
      createId: () => `generated-${++nextId}`,
    },
  };
}

function startGame(state: GameState, deps: EngineDependencies): GameState {
  return dispatchTikatukaAction(state, { type: 'START_GAME', difficulty: state.difficulty }, deps, 'player').nextState;
}

test('state machine: Player always starts and receives the deterministic first roll', () => {
  const { deps } = deterministicDeps([4]);
  const initial = createInitialTikatukaState('start-player', 1);
  const transition = dispatchTikatukaAction(initial, { type: 'START_GAME', difficulty: 1 }, deps, 'player');

  assertEqual(transition.nextState.currentSide, 'player');
  assertEqual(transition.nextState.phase, 'awaiting_action');
  assertEqual(transition.nextState.turn.currentDie?.value, 4);
  assertEqual(transition.nextState.turn.currentDie?.kind, 'normal');
  assertEqual(transition.nextState.turnNumber, 1);
  assertEqual(transition.events[0]?.type, 'DIE_ROLLED');
});

test('validation: stale actor and opponent rows without a matching normal die are rejected', () => {
  const { deps } = deterministicDeps([3]);
  const state = startGame(createInitialTikatukaState('validate-actions', 1), deps);

  const stale = validateAction(state, { type: 'PLACE_DIE', targetSide: 'player', row: 'top' }, 'ai');
  assertEqual(stale.ok, false);
  assertEqual(stale.reason, 'NOT_CURRENT_SIDE');

  const opponent = validateAction(state, { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' }, 'player');
  assertEqual(opponent.ok, false);
  assertEqual(opponent.reason, 'ILLEGAL_PLACEMENT');
});

test('Tazza: reroll may return the same value, consumes one charge, and cannot be used twice in a turn', () => {
  const { deps } = deterministicDeps([2, 2]);
  let state = startGame(createInitialTikatukaState('tazza-same', 1), deps);
  assertEqual(state.turn.currentDie?.value, 2);

  const transition = dispatchTikatukaAction(state, { type: 'USE_TAZZA' }, deps, 'player');
  state = transition.nextState;
  assertEqual(state.turn.currentDie?.value, 2);
  assertEqual(state.turn.tazzaUsedThisTurn, true);
  assertEqual(state.sides.player.skills.tazzaRemaining, 4);
  assertEqual(state.stats.player.tazzaUsed, 1);
  assertEqual(transition.events[0]?.type, 'TAZZA_USED');

  assertThrows(
    () => dispatchTikatukaAction(state, { type: 'USE_TAZZA' }, deps, 'player'),
    'TAZZA_ALREADY_USED',
  );
});

test('HOLD: exact die returns next own turn without consuming another game RNG value', () => {
  const { deps, gameRng } = deterministicDeps([4, 2]);
  let state = startGame(createInitialTikatukaState('hold-exact', 1), deps);
  const heldId = state.turn.currentDie?.id;

  state = dispatchTikatukaAction(state, { type: 'HOLD' }, deps, 'player').nextState;
  assertEqual(state.currentSide, 'ai');
  assertEqual(state.turn.currentDie?.value, 2);
  assertEqual(state.sides.player.heldDie?.id, heldId);
  assertEqual(state.sides.player.skills.holdRemaining, 1);
  assertEqual(state.stats.player.holdUsed, 1);

  state = dispatchTikatukaAction(state, { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' }, deps, 'ai').nextState;
  assertEqual(state.currentSide, 'player');
  assertEqual(state.turn.currentDie?.id, heldId);
  assertEqual(state.turn.currentDie?.value, 4);
  assertEqual(state.sides.player.heldDie, null);
  assertEqual(state.turn.tazzaUsedThisTurn, false);
  assertEqual(gameRng.consumedCount(), 2);
});

test('explicit knock: attack die is consumed, matching normals are removed, shield survives, and next-own-turn shield is queued', () => {
  const { deps } = deterministicDeps([5, 3]);
  const initial = createInitialTikatukaState('knock-shield-flow', 1);
  initial.sides.ai.board.rows.top.dice = [
    normal('pre-ai-1', 5, 'ai'),
    shield('pre-shield', 5, 'player'),
    normal('pre-ai-2', 5, 'ai'),
  ];

  let state = startGame(initial, deps);
  const first = dispatchTikatukaAction(state, { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' }, deps, 'player');
  state = first.nextState;

  assertEqual(state.sides.ai.board.rows.top.dice.length, 1);
  assertEqual(state.sides.ai.board.rows.top.dice[0]?.kind, 'shield');
  assertEqual(state.sides.player.board.rows.top.dice.length, 0);
  assertEqual(state.sides.player.pendingShieldValue, 5);
  assertEqual(state.stats.player.knockCount, 1);
  assertEqual(state.stats.player.diceRemoved, 2);
  assertEqual(state.stats.player.shieldsEarned, 1);
  const knockEvent = first.events.find((event) => event.type === 'DICE_KNOCKED');
  assert(knockEvent?.type === 'DICE_KNOCKED');
  assertEqual(knockEvent?.attackingDie?.value, 5);
  assert(first.events.some((event) => event.type === 'SHIELD_QUEUED'));
  assertEqual(first.events.some((event) => event.type === 'DIE_PLACED'), false);

  assertEqual(state.currentSide, 'ai');
  assertEqual(state.turn.currentDie?.value, 3);
  const second = dispatchTikatukaAction(state, { type: 'PLACE_DIE', targetSide: 'ai', row: 'middle' }, deps, 'ai');
  state = second.nextState;

  assertEqual(state.currentSide, 'player');
  assertEqual(state.turn.currentDie?.kind, 'shield');
  assertEqual(state.turn.currentDie?.value, 5);
  assertEqual(state.sides.player.pendingShieldValue, null);
  assert(second.events.some((event) => event.type === 'SHIELD_GRANTED'));

  const tazzaOnShield = validateAction(state, { type: 'USE_TAZZA' }, 'player');
  assertEqual(tazzaOnShield.ok, false);
  assertEqual(tazzaOnShield.reason, 'TAZZA_FORBIDDEN_FOR_SHIELD');
});

test('own placement: putting a normal die on your board never auto-knocks the opponent', () => {
  const { deps } = deterministicDeps([6, 2]);
  const initial = createInitialTikatukaState('no-auto-knock', 1);
  initial.sides.ai.board.rows.top.dice = [normal('enemy-six', 6, 'ai')];

  let state = startGame(initial, deps);
  const placed = dispatchTikatukaAction(state, { type: 'PLACE_DIE', targetSide: 'player', row: 'top' }, deps, 'player');
  state = placed.nextState;

  assertEqual(state.sides.player.board.rows.top.dice.some((die) => die.value === 6), true);
  assertEqual(state.sides.ai.board.rows.top.dice.length, 1);
  assertEqual(placed.events.some((event) => event.type === 'DICE_KNOCKED'), false);
  assertEqual(state.stats.player.knockCount, 0);
});

test('Forced Pass: no HOLD charge is spent, but an available knock prevents forced pass', () => {
  const { deps, gameRng } = deterministicDeps([4, 1]);
  const initial = createInitialTikatukaState('forced-pass', 1);
  initial.sides.player.board.rows.top.dice = [
    normal('p-t-1', 1, 'player'), normal('p-t-2', 2, 'player'), normal('p-t-3', 3, 'player'),
  ];
  initial.sides.player.board.rows.middle.dice = [
    normal('p-m-1', 2, 'player'), normal('p-m-2', 3, 'player'), normal('p-m-3', 4, 'player'),
  ];
  initial.sides.player.board.rows.bottom.dice = [
    normal('p-b-1', 3, 'player'), normal('p-b-2', 4, 'player'), normal('p-b-3', 5, 'player'),
  ];

  const started = dispatchTikatukaAction(initial, { type: 'START_GAME', difficulty: 1 }, deps, 'player');
  let state = started.nextState;
  const forcedId = state.sides.player.heldDie?.id;

  assert(started.events.some((event) => event.type === 'FORCED_PASS'));
  assertEqual(state.currentSide, 'ai');
  assertEqual(state.sides.player.skills.holdRemaining, 2);
  assertEqual(state.stats.player.holdUsed, 0);
  assertEqual(state.sides.player.heldDie?.value, 4);
  assertEqual(state.turn.currentDie?.value, 1);

  state = dispatchTikatukaAction(state, { type: 'PLACE_DIE', targetSide: 'player', row: 'top' }, deps, 'ai').nextState;
  assertEqual(state.currentSide, 'player');
  assertEqual(state.turn.currentDie?.id, forcedId);
  assertEqual(state.turn.currentDie?.value, 4);
  assertEqual(state.sides.player.heldDie, null);
  assertEqual(state.sides.player.board.rows.top.dice.length, 2);
  assertEqual(gameRng.consumedCount(), 2);
});

test('game over: both boards at 9/9 after a normal placement finishes the game', () => {
  const { deps } = deterministicDeps([6]);
  const initial = createInitialTikatukaState('game-over', 1);
  initial.sides.player.board.rows.top.dice = [
    normal('pt1', 1, 'player'), normal('pt2', 2, 'player'), normal('pt3', 3, 'player'),
  ];
  initial.sides.player.board.rows.middle.dice = [
    normal('pm1', 1, 'player'), normal('pm2', 2, 'player'), normal('pm3', 3, 'player'),
  ];
  initial.sides.player.board.rows.bottom.dice = [normal('pb1', 1, 'player'), normal('pb2', 2, 'player')];

  initial.sides.ai.board.rows.top.dice = [normal('at1', 1, 'ai'), normal('at2', 2, 'ai'), normal('at3', 3, 'ai')];
  initial.sides.ai.board.rows.middle.dice = [normal('am1', 1, 'ai'), normal('am2', 2, 'ai'), normal('am3', 3, 'ai')];
  initial.sides.ai.board.rows.bottom.dice = [normal('ab1', 1, 'ai'), normal('ab2', 2, 'ai'), normal('ab3', 3, 'ai')];

  let state = startGame(initial, deps);
  const finished = dispatchTikatukaAction(state, { type: 'PLACE_DIE', targetSide: 'player', row: 'bottom' }, deps, 'player');
  state = finished.nextState;

  assertEqual(state.phase, 'game_over');
  assert(state.result !== null);
  assertEqual(state.result?.gameId, 'game-over');
  assert(finished.events.some((event) => event.type === 'GAME_FINISHED'));
});

test('invariant guard: duplicated die ids across board and currentDie are rejected', () => {
  const { deps } = deterministicDeps([3]);
  const state = startGame(createInitialTikatukaState('duplicate-id', 1), deps);
  const current = state.turn.currentDie;
  assert(current !== null);
  state.sides.player.board.rows.top.dice = [current];

  assertThrows(() => assertGameStateInvariant(state), '중복');
});
