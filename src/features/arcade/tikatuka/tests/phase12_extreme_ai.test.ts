import {
  chooseAdvancedAIAction,
  getAIProfile,
  rankWinProbabilityAIActions,
} from '../ai';
import {
  AI_SKILL_PROFILE,
  PLAYER_HOLD_CHARGES,
  PLAYER_TAZZA_CHARGES,
  SeededRandomSource,
  createInitialTikatukaState,
} from '../engine';
import type { Die, DieValue, GameState, RandomSource, Side } from '../engine';
import { assert, assertDeepEqual, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function aiTurn(gameId: string, value: DieValue): GameState {
  const state = createInitialTikatukaState(gameId, 11);
  state.currentSide = 'ai';
  state.phase = 'awaiting_action';
  state.turnNumber = 1;
  state.turn = {
    currentDie: normal(`${gameId}-current`, value, 'ai'),
    source: 'rolled',
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
  return state;
}

class CountingSeedSource implements RandomSource {
  calls = 0;

  nextInt(minInclusive: number, maxInclusive: number): number {
    this.calls += 1;
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + ((this.calls * 104_729) % span);
  }
}

test('Lv11 Extreme profile: depth-3, zero intentional mistakes, no hidden extra skills', () => {
  const profile = getAIProfile(11);

  assertEqual(profile.searchDepth, 3);
  assertEqual(profile.mistakeRate, 0);
  assertEqual(profile.candidatePoolSize, 1);
  assertEqual(PLAYER_TAZZA_CHARGES[11], PLAYER_TAZZA_CHARGES[10]);
  assertEqual(PLAYER_HOLD_CHARGES[11], PLAYER_HOLD_CHARGES[10]);
  assertDeepEqual(AI_SKILL_PROFILE[11], AI_SKILL_PROFILE[10]);
});

test('Lv11 Extreme rollout: early game compares a wider shortlist with more independent futures', () => {
  const state = aiTurn('lv11-prob-plan', 4);
  const candidates = [
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' } as const, score: 10 },
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'middle' } as const, score: 9 },
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'bottom' } as const, score: 8 },
  ];
  const profile = getAIProfile(11);

  const first = rankWinProbabilityAIActions(state, new SeededRandomSource(1234567), candidates, profile);
  const second = rankWinProbabilityAIActions(state, new SeededRandomSource(1234567), candidates, profile);

  assertDeepEqual(first, second);
  assertEqual(first.shortlistSize, 3);
  assert(
    first.samplesPerCandidate === 24 || first.samplesPerCandidate === 48,
    'Early-game Lv11 should use 24 samples first and only extend a close decision to 48.',
  );
  assert(first.rankedCandidates.every((candidate) => candidate.samples === first.samplesPerCandidate));
  assert(first.rankedCandidates.every((candidate) =>
    candidate.estimatedWinProbability >= 0 && candidate.estimatedWinProbability <= 1));
});

test('Lv11 Extreme chooser: uses independent Monte Carlo seeds and never injects a mistake', () => {
  const state = aiTurn('lv11-extreme-route', 5);
  const profile = getAIProfile(11);
  const aiSeeds = new CountingSeedSource();

  const choice = chooseAdvancedAIAction(
    state,
    aiSeeds,
    profile,
    {
      limits: { maxNodes: 600, hardTimeBudgetMs: 10_000 },
      now: () => 0,
    },
  );

  assert(aiSeeds.calls >= 24, 'Lv11 chooser should consume only independent aiRng rollout seeds.');
  assertEqual(choice.searchDepth, 3);
  assertEqual(choice.usedMistake, false);
  assert(choice.rankedCandidates.length >= 1);
});
