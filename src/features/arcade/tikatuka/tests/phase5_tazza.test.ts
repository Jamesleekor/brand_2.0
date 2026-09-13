import { evaluateAITazza } from '../ai';
import {
  SeededRandomSource,
  SequenceRandomSource,
  createInitialTikatukaState,
  dispatchTikatukaAction,
} from '../engine';
import type { Die, DieValue, EngineDependencies, GameState, Side } from '../engine';
import { assert, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function aiTurn(gameId: string, difficulty: GameState['difficulty'], value: DieValue): GameState {
  const state = createInitialTikatukaState(gameId, difficulty);
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 1;
  state.turn = {
    currentDie: normal('current', value, 'ai'),
    source: 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  return state;
}

test('advanced AI Tazza: low neutral roll has positive uniform reroll EV', () => {
  const state = aiTurn('tazza-low', 8, 1);
  const evaluation = evaluateAITazza(state);
  assertEqual(evaluation.outcomes.length, 6);
  assert(evaluation.rerollExpectedScore > evaluation.currentBestScore);
  assertEqual(evaluation.shouldUseTazza, true);
});

test('advanced AI Tazza: high neutral roll is not rerolled just because skill exists', () => {
  const state = aiTurn('tazza-high', 8, 6);
  const evaluation = evaluateAITazza(state);
  assert(evaluation.rerollExpectedScore < evaluation.currentBestScore);
  assertEqual(evaluation.shouldUseTazza, false);
});

test('advanced AI Tazza: low die with strong knock value can be kept', () => {
  const state = aiTurn('tazza-knock', 10, 1);
  state.sides.ai.skills.tazzaRemaining = 1;
  state.sides.player.board.rows.top.dice = [
    normal('p1', 1, 'player'),
    normal('p2', 1, 'player'),
  ];

  const evaluation = evaluateAITazza(state);
  assert(evaluation.currentBestScore > evaluation.rerollExpectedScore);
  assertEqual(evaluation.shouldUseTazza, false);
});

test('advanced AI Tazza: hypothetical rerolls consume no real RNG and mark Tazza used in state only', () => {
  const state = aiTurn('tazza-state', 8, 2);
  const beforeRemaining = state.sides.ai.skills.tazzaRemaining;
  const evaluation = evaluateAITazza(state);

  assertEqual(state.sides.ai.skills.tazzaRemaining, beforeRemaining);
  assertEqual(state.turn.tazzaUsedThisTurn, false);
  assertEqual(evaluation.outcomes.map((item) => item.value).join(','), '1,2,3,4,5,6');
});

test('Tazza regression: impossible replacement auto-passes before AI/UI can receive a dead root', () => {
  const state = aiTurn('tazza-auto-pass', 8, 5);
  state.sides.ai.board.rows.top.dice = [
    normal('at1', 1, 'ai'), normal('at2', 2, 'ai'), normal('at3', 3, 'ai'),
  ];
  state.sides.ai.board.rows.middle.dice = [
    normal('am1', 1, 'ai'), normal('am2', 2, 'ai'), normal('am3', 3, 'ai'),
  ];
  state.sides.ai.board.rows.bottom.dice = [
    normal('ab1', 1, 'ai'), normal('ab2', 2, 'ai'), normal('ab3', 3, 'ai'),
  ];
  state.sides.player.board.rows.top.dice = [normal('p5', 5, 'player')];

  const gameRng = new SequenceRandomSource([6, 2]);
  const deps: EngineDependencies = {
    gameRng,
    aiRng: new SeededRandomSource(987654321),
    createId: (() => {
      let id = 0;
      return () => `tazza-auto-${++id}`;
    })(),
  };

  const transition = dispatchTikatukaAction(state, { type: 'USE_TAZZA' }, deps, 'ai');
  assert(transition.events.some((event) => event.type === 'TAZZA_USED'));
  assert(transition.events.some((event) => event.type === 'FORCED_PASS'));
  assertEqual(transition.nextState.currentSide, 'player');
  assertEqual(transition.nextState.turn.currentDie?.value, 2);
  assertEqual(transition.nextState.sides.ai.heldDie?.value, 6);
  assertEqual(transition.nextState.sides.ai.skills.tazzaRemaining, state.sides.ai.skills.tazzaRemaining - 1);
});
