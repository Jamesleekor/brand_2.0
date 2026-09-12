import { chooseBasicAIPlacement, getAIProfile, rankAIPlacementCandidates } from '../ai';
import { SeededRandomSource, SequenceRandomSource, createInitialTikatukaState } from '../engine';
import type { Die, DieValue, GameState, Side } from '../engine';
import { assert, assertDeepEqual, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function shield(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'shield', owner };
}

function aiTurn(gameId: string, difficulty: GameState['difficulty'], die: Die): GameState {
  const state = createInitialTikatukaState(gameId, difficulty);
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 1;
  state.turn = {
    currentDie: die,
    source: die.kind === 'shield' ? 'shield' : 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  return state;
}

test('basic AI: obvious two-die knock is ranked above non-knocking rows', () => {
  const state = aiTurn('ai-knock', 10, normal('current', 5, 'ai'));
  state.sides.player.board.rows.top.dice = [
    normal('p1', 5, 'player'),
    normal('p2', 5, 'player'),
  ];

  const ranked = rankAIPlacementCandidates(state, getAIProfile(10));
  assertEqual(ranked[0]?.action.targetSide, 'ai');
  assertEqual(ranked[0]?.action.row, 'top');
  assertEqual(ranked[0]?.resultingState.sides.player.board.rows.top.dice.length, 0);
  assertEqual(ranked[0]?.resultingState.sides.ai.pendingShieldValue, 5);
});

test('basic AI: high-level shield evaluation avoids gifting an opponent 5-triple', () => {
  const state = aiTurn('ai-shield-trap', 10, shield('shield-current', 5, 'ai'));
  state.sides.player.board.rows.top.dice = [
    normal('p1', 5, 'player'),
    normal('p2', 5, 'player'),
  ];

  const ranked = rankAIPlacementCandidates(state, getAIProfile(10));
  const best = ranked[0]?.action;
  assert(best !== undefined);
  assert(!(best.targetSide === 'player' && best.row === 'top'), 'AI가 상대 5-트리플을 직접 완성하면 안 됩니다.');

  const trap = ranked.find((candidate) => candidate.action.targetSide === 'player' && candidate.action.row === 'top');
  assert(trap !== undefined);
  assert(best && trap && ranked[0].score > trap.score);
});

test('basic AI: difficulty mistakes stay inside near-best pool and Lv10 remains top-1', () => {
  const easyState = aiTurn('ai-easy-mistake', 1, normal('easy-current', 3, 'ai'));
  const easyRng = new SequenceRandomSource([0, 2]);
  const easyChoice = chooseBasicAIPlacement(easyState, easyRng, getAIProfile(1));
  assertEqual(easyChoice.usedMistake, true);
  assertEqual(easyChoice.action.row, 'bottom');
  assertEqual(easyChoice.action.targetSide, 'ai');

  const hardState = aiTurn('ai-hard-top1', 10, normal('hard-current', 3, 'ai'));
  const hardRng = new SequenceRandomSource([0]);
  const hardChoice = chooseBasicAIPlacement(hardState, hardRng, getAIProfile(10));
  assertEqual(hardChoice.usedMistake, false);
  assertEqual(hardChoice.action.row, 'top');
  assertEqual(hardChoice.action.targetSide, 'ai');
  assertEqual(hardRng.consumedCount(), 0);
});

test('basic AI: AI decision RNG cannot perturb actual game RNG sequence', () => {
  const state = aiTurn('ai-rng-isolation', 1, normal('current', 2, 'ai'));
  const gameA = new SeededRandomSource(123456789);
  const gameB = new SeededRandomSource(123456789);
  const aiRng = new SequenceRandomSource([0, 1]);

  chooseBasicAIPlacement(state, aiRng, getAIProfile(1));

  const afterAI = Array.from({ length: 12 }, () => gameA.nextInt(1, 6));
  const untouched = Array.from({ length: 12 }, () => gameB.nextInt(1, 6));
  assertDeepEqual(afterAI, untouched);
});

test('basic AI: v1.2 difficulty profile keeps future search depth reserved without using it in Phase 4', () => {
  assertEqual(getAIProfile(1).searchDepth, 0);
  assertEqual(getAIProfile(5).searchDepth, 1);
  assertEqual(getAIProfile(8).searchDepth, 2);
  assertEqual(getAIProfile(10).candidatePoolSize, 1);
  assertEqual(getAIProfile(10).mistakeRate, 0.01);
});
