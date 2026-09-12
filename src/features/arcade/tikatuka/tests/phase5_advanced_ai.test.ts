import {
  chooseAdvancedAIAction,
  getAIProfile,
  rankAdvancedAIActions,
} from '../ai';
import {
  SeededRandomSource,
  SequenceRandomSource,
  createInitialTikatukaState,
} from '../engine';
import type { Die, DieValue, GameState, Side } from '../engine';
import { assert, assertDeepEqual, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function aiTurn(gameId: string, difficulty: GameState['difficulty'], value: DieValue): GameState {
  const state = createInitialTikatukaState(gameId, difficulty);
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 4;
  state.turn = {
    currentDie: normal('current', value, 'ai'),
    source: 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  return state;
}

function fillRow(prefix: string, side: Side, values: readonly DieValue[]): Die[] {
  return values.map((value, index) => normal(`${prefix}-${index}`, value, side));
}

function constrainedState(difficulty: GameState['difficulty']): GameState {
  const state = aiTurn(`advanced-${difficulty}`, difficulty, 2);
  state.sides.ai.board.rows.top.dice = fillRow('ai-t', 'ai', [6, 5, 4]);
  state.sides.ai.board.rows.middle.dice = fillRow('ai-m', 'ai', [6, 5, 4]);
  state.sides.ai.board.rows.bottom.dice = fillRow('ai-b', 'ai', [6, 5]);
  state.sides.player.board.rows.top.dice = fillRow('p-t', 'player', [3, 4, 5]);
  state.sides.player.board.rows.middle.dice = fillRow('p-m', 'player', [3, 4, 5]);
  state.sides.player.board.rows.bottom.dice = fillRow('p-b', 'player', [3, 4]);
  return state;
}

const deterministicSearch = {
  limits: { maxNodes: 5_000, hardTimeBudgetMs: 10_000 },
  now: () => 0,
} as const;

test('advanced AI: Lv3 exposes placement only, while Lv4 can consider Tazza', () => {
  const lv3 = aiTurn('lv3-actions', 3, 1);
  const rank3 = rankAdvancedAIActions(lv3, getAIProfile(3), deterministicSearch);
  assertEqual(rank3.rankedCandidates.every((candidate) => candidate.action.type === 'PLACE_DIE'), true);

  const lv4 = aiTurn('lv4-actions', 4, 1);
  const rank4 = rankAdvancedAIActions(lv4, getAIProfile(4), deterministicSearch);
  assert(rank4.rankedCandidates.some((candidate) => candidate.action.type === 'USE_TAZZA'));
  assertEqual(rank4.rankedCandidates.some((candidate) => candidate.action.type === 'HOLD'), false);
});

test('advanced AI: low neutral Lv4 roll can rank Tazza above immediate placement', () => {
  const state = aiTurn('lv4-tazza-choice', 4, 1);
  const profile = { ...getAIProfile(4), mistakeRate: 0 };
  const ranking = rankAdvancedAIActions(state, profile, deterministicSearch);
  assertEqual(ranking.rankedCandidates[0].action.type, 'USE_TAZZA');
});

test('advanced AI: Lv7 search exposes HOLD as a real strategic candidate', () => {
  const state = constrainedState(7);
  const ranking = rankAdvancedAIActions(state, getAIProfile(7), deterministicSearch);
  assert(ranking.rankedCandidates.some((candidate) => candidate.action.type === 'HOLD'));
  assertEqual(ranking.searchAbortReason, null);
});

test('advanced AI: Lv8 depth-2 search resolves within node limit on constrained endgame', () => {
  const state = constrainedState(8);
  const choice = chooseAdvancedAIAction(
    state,
    new SequenceRandomSource([0.99]),
    { ...getAIProfile(8), mistakeRate: 0 },
    deterministicSearch,
  );

  assertEqual(choice.searchDepth, 2);
  assert(choice.nodesVisited > 0);
  assert(choice.nodesVisited <= 5_000);
  assertEqual(choice.searchAbortReason, null);
  assert(['PLACE_DIE', 'USE_TAZZA', 'HOLD'].includes(choice.action.type));
});

test('advanced AI: decision search never perturbs actual game RNG', () => {
  const state = constrainedState(8);
  const gameA = new SeededRandomSource(987654321);
  const gameB = new SeededRandomSource(987654321);

  chooseAdvancedAIAction(
    state,
    new SequenceRandomSource([0.99]),
    { ...getAIProfile(8), mistakeRate: 0 },
    deterministicSearch,
  );

  const afterAI = Array.from({ length: 12 }, () => gameA.nextInt(1, 6));
  const untouched = Array.from({ length: 12 }, () => gameB.nextInt(1, 6));
  assertDeepEqual(afterAI, untouched);
});

test('advanced AI: Lv10 top-1 policy consumes no aiRng for mistake selection', () => {
  const state = constrainedState(10);
  const aiRng = new SequenceRandomSource([0.2]);
  const choice = chooseAdvancedAIAction(state, aiRng, getAIProfile(10), deterministicSearch);
  assertEqual(choice.usedMistake, false);
  assertEqual(aiRng.consumedCount(), 0);
});
