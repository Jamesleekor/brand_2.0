import {
  createAISearchContext,
  createAIStateHash,
  enterAISearchState,
  leaveAISearchState,
} from '../ai';
import { createInitialTikatukaState } from '../engine';
import type { Die, GameState } from '../engine';
import { assert, assertEqual, test } from './testHarness';

function aiState(): GameState {
  const state = createInitialTikatukaState('phase5-hash', 10);
  const die: Die = { id: 'current-a', value: 4, kind: 'normal', owner: 'ai' };
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 7;
  state.turn = {
    currentDie: die,
    source: 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  state.sides.ai.board.rows.top.dice = [
    { id: 'board-a', value: 5, kind: 'normal', owner: 'ai' },
  ];
  return state;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('advanced AI safety: state hash ignores ids, game id, runtime stats and turn number', () => {
  const a = aiState();
  const b = clone(a);
  b.gameId = 'another-game';
  b.turnNumber = 999;
  b.turn.currentDie = { ...b.turn.currentDie!, id: 'different-current-id' };
  b.sides.ai.board.rows.top.dice[0] = { ...b.sides.ai.board.rows.top.dice[0], id: 'different-board-id' };
  b.stats.ai.knockCount = 88;

  assertEqual(createAIStateHash(a), createAIStateHash(b));
});

test('advanced AI safety: state hash changes for rule-relevant pending/current-die state', () => {
  const base = aiState();
  const pending = clone(base);
  pending.sides.ai.pendingShieldValue = 6;
  const differentDie = clone(base);
  differentDie.turn.currentDie = { ...differentDie.turn.currentDie!, value: 2 };

  assert(createAIStateHash(base) !== createAIStateHash(pending));
  assert(createAIStateHash(base) !== createAIStateHash(differentDie));
});

test('advanced AI safety: active-path cycle guard rejects re-entry but allows sibling revisit', () => {
  const state = aiState();
  const context = createAISearchContext({ limits: { maxNodes: 10, hardTimeBudgetMs: 10_000 }, now: () => 0 });
  const first = enterAISearchState(context, state);
  assertEqual(first.ok, true);
  const cycle = enterAISearchState(context, state);
  assertEqual(cycle.ok, false);
  assertEqual(cycle.reason, 'cycle');

  leaveAISearchState(context, first.hash);
  const sibling = enterAISearchState(context, state);
  assertEqual(sibling.ok, true);
  assertEqual(context.nodesVisited, 2);
});

test('advanced AI safety: node and time budgets abort before search explosion', () => {
  const state = aiState();
  const nodeContext = createAISearchContext({ limits: { maxNodes: 1, hardTimeBudgetMs: 10_000 }, now: () => 0 });
  assertEqual(enterAISearchState(nodeContext, state).ok, true);
  const secondState = clone(state);
  secondState.turn.currentDie = { ...secondState.turn.currentDie!, value: 3 };
  const nodeAbort = enterAISearchState(nodeContext, secondState);
  assertEqual(nodeAbort.ok, false);
  assertEqual(nodeAbort.reason, 'node_limit');

  let now = 0;
  const timeContext = createAISearchContext({ limits: { maxNodes: 10, hardTimeBudgetMs: 100 }, now: () => now });
  now = 100;
  const timeAbort = enterAISearchState(timeContext, state);
  assertEqual(timeAbort.ok, false);
  assertEqual(timeAbort.reason, 'time_limit');
});
