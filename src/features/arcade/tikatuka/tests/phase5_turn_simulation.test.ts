import {
  createHypotheticalForcedPassState,
  createHypotheticalHoldState,
  enumerateNextTurnStates,
} from '../ai';
import { createInitialTikatukaState } from '../engine';
import type { Die, DieValue, GameState, Side } from '../engine';
import { assert, assertDeepEqual, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function aiTurn(gameId: string, difficulty: GameState['difficulty'], value: DieValue): GameState {
  const state = createInitialTikatukaState(gameId, difficulty);
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 3;
  state.turn = {
    currentDie: normal('held-source', value, 'ai'),
    source: 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  return state;
}

test('advanced AI HOLD simulation: exact die is preserved and HOLD charge/stat are updated only in hypothetical state', () => {
  const state = aiTurn('hold-sim', 8, 4);
  const beforeCharge = state.sides.ai.skills.holdRemaining;
  const held = createHypotheticalHoldState(state, 'ai');

  assertEqual(held.phase, 'turn_end');
  assertEqual(held.sides.ai.heldDie?.id, 'held-source');
  assertEqual(held.sides.ai.heldDie?.value, 4);
  assertEqual(held.sides.ai.skills.holdRemaining, beforeCharge - 1);
  assertEqual(held.stats.ai.holdUsed, 1);
  assertEqual(state.sides.ai.skills.holdRemaining, beforeCharge);
  assertEqual(state.stats.ai.holdUsed, 0);
});

test('advanced AI turn simulation: fresh next turn branches uniformly across 1..6 without RNG', () => {
  const state = aiTurn('next-turn-random', 8, 4);
  state.phase = 'turn_end';
  state.turn = { currentDie: null, source: null, tazzaUsedThisTurn: false, forcedPass: false };

  const branches = enumerateNextTurnStates(state);
  assertEqual(branches.length, 6);
  assert(Math.abs(branches.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-9);
  assertDeepEqual(branches.map((item) => item.state.turn.currentDie?.value), [1, 2, 3, 4, 5, 6]);
  assertEqual(branches.every((item) => item.state.currentSide === 'player'), true);
});

test('advanced AI turn simulation: held die has priority over random and returns deterministically', () => {
  const state = aiTurn('next-turn-held', 8, 4);
  state.phase = 'turn_end';
  state.turn = { currentDie: null, source: null, tazzaUsedThisTurn: false, forcedPass: false };
  state.sides.player.heldDie = normal('player-held', 6, 'player');

  const branches = enumerateNextTurnStates(state);
  assertEqual(branches.length, 1);
  assertEqual(branches[0].probability, 1);
  assertEqual(branches[0].state.turn.source, 'held');
  assertEqual(branches[0].state.turn.currentDie?.id, 'player-held');
  assertEqual(branches[0].state.sides.player.heldDie, null);
});

test('advanced AI turn simulation: pending shield is deterministic when there is no held die', () => {
  const state = aiTurn('next-turn-shield', 8, 4);
  state.phase = 'turn_end';
  state.turn = { currentDie: null, source: null, tazzaUsedThisTurn: false, forcedPass: false };
  state.sides.player.pendingShieldValue = 5;

  const branches = enumerateNextTurnStates(state);
  assertEqual(branches.length, 1);
  assertEqual(branches[0].state.turn.source, 'shield');
  assertEqual(branches[0].state.turn.currentDie?.kind, 'shield');
  assertEqual(branches[0].state.turn.currentDie?.value, 5);
  assertEqual(branches[0].state.sides.player.pendingShieldValue, null);
});

test('advanced AI Forced Pass simulation: preserves exact die without spending HOLD', () => {
  const state = aiTurn('forced-pass-sim', 8, 3);
  const full = [1, 2, 3].map((value, index) => normal(`f-${index}`, value as DieValue, 'ai'));
  state.sides.ai.board.rows.top.dice = full.map((die) => ({ ...die, id: `${die.id}-t` }));
  state.sides.ai.board.rows.middle.dice = full.map((die) => ({ ...die, id: `${die.id}-m` }));
  state.sides.ai.board.rows.bottom.dice = full.map((die) => ({ ...die, id: `${die.id}-b` }));
  const beforeCharge = state.sides.ai.skills.holdRemaining;

  const passed = createHypotheticalForcedPassState(state);
  assertEqual(passed.sides.ai.heldDie?.id, 'held-source');
  assertEqual(passed.sides.ai.skills.holdRemaining, beforeCharge);
  assertEqual(passed.stats.ai.holdUsed, 0);
  assertEqual(passed.turn.forcedPass, true);
});
