import {
  evaluateStrategicWinPlan,
  getAIProfile,
  rankAdvancedAIActions,
  rerankStrategicAIActions,
} from '../ai';
import {
  createInitialTikatukaState,
  resolvePlacementOutcome,
} from '../engine';
import type { Die, DieValue, GameState, Side } from '../engine';
import { assert, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function fill(prefix: string, side: Side, values: readonly DieValue[]): Die[] {
  return values.map((value, index) => normal(`${prefix}-${index}`, value, side));
}

function twoRowDecisionState(): GameState {
  const state = createInitialTikatukaState('lv9-two-row-plan', 9);
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 12;
  state.turn = {
    currentDie: normal('current-five', 5, 'ai'),
    source: 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };

  // Top is already dominant. Middle is the realistic second winning row.
  // Bottom is deliberately far behind. The old score-maximizer likes completing
  // the 5-5-5 triple on top; the Lv9 strategy should spend the 5 on middle.
  state.sides.ai.board.rows.top.dice = fill('ai-top', 'ai', [5, 5]);
  state.sides.ai.board.rows.middle.dice = fill('ai-mid', 'ai', [4, 3]);
  state.sides.ai.board.rows.bottom.dice = fill('ai-bottom', 'ai', [1, 1]);

  state.sides.player.board.rows.top.dice = fill('p-top', 'player', [1, 2]);
  state.sides.player.board.rows.middle.dice = fill('p-mid', 'player', [4, 2]);
  state.sides.player.board.rows.bottom.dice = fill('p-bottom', 'player', [6, 6]);

  state.sides.ai.skills.tazzaRemaining = 0;
  state.sides.ai.skills.holdRemaining = 0;
  return state;
}

const deterministicSearch = {
  limits: { maxNodes: 5_000, hardTimeBudgetMs: 10_000 },
  now: () => 0,
} as const;

test('Lv9 strategy: second-row progress is worth more than inflating an already dominant row', () => {
  const state = twoRowDecisionState();
  const top = resolvePlacementOutcome(state, { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' }, 'ai').nextState;
  const middle = resolvePlacementOutcome(state, { type: 'PLACE_DIE', targetSide: 'ai', row: 'middle' }, 'ai').nextState;

  assert(
    evaluateStrategicWinPlan(middle) > evaluateStrategicWinPlan(top),
    'Lv9 strategic evaluator should prefer building the second winning row.',
  );
});

test('Lv9 strategy: rerank overturns the legacy raw-score triple when it wastes the second-row objective', () => {
  const state = twoRowDecisionState();
  const profile = { ...getAIProfile(9), mistakeRate: 0 };
  const base = rankAdvancedAIActions(state, profile, deterministicSearch);
  const strategic = rerankStrategicAIActions(state, base.rankedCandidates, profile);

  assertEqual(base.rankedCandidates[0].action.type, 'PLACE_DIE');
  if (base.rankedCandidates[0].action.type !== 'PLACE_DIE') throw new Error('Expected placement candidate.');
  assertEqual(base.rankedCandidates[0].action.row, 'top');

  assertEqual(strategic.rankedCandidates[0].action.type, 'PLACE_DIE');
  if (strategic.rankedCandidates[0].action.type !== 'PLACE_DIE') throw new Error('Expected placement candidate.');
  assertEqual(strategic.rankedCandidates[0].action.row, 'middle');
});

test('Lv8 remains on the unchanged depth-2 tactical ranking path', () => {
  const state = twoRowDecisionState();
  state.difficulty = 8;
  const profile = { ...getAIProfile(8), mistakeRate: 0 };
  const base = rankAdvancedAIActions(state, profile, deterministicSearch);

  assertEqual(profile.searchDepth, 2);
  assertEqual(base.rankedCandidates[0].action.type, 'PLACE_DIE');
  if (base.rankedCandidates[0].action.type !== 'PLACE_DIE') throw new Error('Expected placement candidate.');
  assertEqual(base.rankedCandidates[0].action.row, 'top');
});
