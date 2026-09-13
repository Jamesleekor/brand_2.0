import {
  enumerateNextTurnStates,
  getAIProfile,
  rankAdvancedAIActions,
} from '../ai';
import { canUseTazza, createInitialTikatukaState } from '../engine';
import type { Die, DieValue, GameState, Side } from '../engine';
import { assertEqual, test } from './testHarness';

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
  state.turnNumber = 4;
  state.turn = {
    currentDie: die,
    source: die.kind === 'shield' ? 'shield' : 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  return state;
}

const deterministicSearch = {
  limits: { maxNodes: 5_000, hardTimeBudgetMs: 10_000 },
  now: () => 0,
} as const;

test('advanced AI regression: shield current die never exposes Tazza candidate', () => {
  const state = aiTurn('shield-no-tazza', 10, shield('shield-current', 5, 'ai'));
  const ranking = rankAdvancedAIActions(state, getAIProfile(10), deterministicSearch);
  assertEqual(ranking.rankedCandidates.some((candidate) => candidate.action.type === 'USE_TAZZA'), false);
});

test('advanced AI regression: held normal returns next own turn with Tazza reset and usable', () => {
  const state = createInitialTikatukaState('held-next-tazza', 8);
  state.currentSide = 'player';
  state.phase = 'turn_end';
  state.turnNumber = 8;
  state.turn = {
    currentDie: null,
    source: null,
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  state.sides.ai.heldDie = normal('ai-held-normal', 2, 'ai');
  state.sides.ai.skills.tazzaRemaining = 1;

  const branches = enumerateNextTurnStates(state);
  assertEqual(branches.length, 1);
  const next = branches[0].state;
  assertEqual(next.currentSide, 'ai');
  assertEqual(next.turn.source, 'held');
  assertEqual(next.turn.currentDie?.id, 'ai-held-normal');
  assertEqual(next.turn.tazzaUsedThisTurn, false);
  assertEqual(canUseTazza(next, 'ai'), true);
});
