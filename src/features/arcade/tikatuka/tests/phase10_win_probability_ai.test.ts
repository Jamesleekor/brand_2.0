import {
  getAIProfile,
  rankWinProbabilityAIActions,
} from '../ai';
import {
  SeededRandomSource,
  createInitialTikatukaState,
} from '../engine';
import type { Die, DieValue, GameState, RandomSource, Side } from '../engine';
import { assert, assertDeepEqual, assertEqual, test } from './testHarness';

function normal(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'normal', owner };
}

function shield(id: string, value: DieValue, owner: Side): Die {
  return { id, value, kind: 'shield', owner };
}

function aiTurn(gameId: string, value: DieValue): GameState {
  const state = createInitialTikatukaState(gameId, 10);
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

test('Lv10 rollout: common Monte Carlo seed set is deterministic for the same AI seed', () => {
  const state = aiTurn('prob-deterministic', 4);
  const candidates = [
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' } as const, score: 10 },
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'middle' } as const, score: 9 },
  ];
  const profile = { ...getAIProfile(10), mistakeRate: 0 };

  const first = rankWinProbabilityAIActions(state, new SeededRandomSource(1234567), candidates, profile);
  const second = rankWinProbabilityAIActions(state, new SeededRandomSource(1234567), candidates, profile);

  assertDeepEqual(first, second);
  assertEqual(first.shortlistSize, 2);
  assert(
    first.samplesPerCandidate === 16 || first.samplesPerCandidate === 32,
    'Early-game Lv10 should use the 16-sample first pass and only extend a close decision to 32.',
  );
  assert(first.rankedCandidates.every((candidate) => candidate.samples === first.samplesPerCandidate));
  assert(first.rankedCandidates.every((candidate) => candidate.estimatedWinProbability >= 0 && candidate.estimatedWinProbability <= 1));
});

test('Lv10 rollout: only aiRng supplies future seeds; live game RNG remains untouched', () => {
  const state = aiTurn('prob-rng-isolation', 3);
  const candidates = [
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'top' } as const, score: 5 },
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'bottom' } as const, score: 4 },
  ];
  const profile = { ...getAIProfile(10), mistakeRate: 0 };
  const aiSeeds = new CountingSeedSource();
  const liveA = new SeededRandomSource(99887766);
  const liveB = new SeededRandomSource(99887766);

  const ranking = rankWinProbabilityAIActions(state, aiSeeds, candidates, profile);
  assertEqual(aiSeeds.calls, ranking.samplesPerCandidate);

  const afterRollout = Array.from({ length: 12 }, () => liveA.nextInt(1, 6));
  const untouched = Array.from({ length: 12 }, () => liveB.nextInt(1, 6));
  assertDeepEqual(afterRollout, untouched);
});

test('Lv10 rollout: two shield-secured rows produce a 100% simulated win', () => {
  const state = aiTurn('prob-secured-win', 4);
  state.sides.ai.board.rows.top.dice = [
    shield('ai-top-1', 6, 'ai'), shield('ai-top-2', 6, 'ai'), shield('ai-top-3', 6, 'ai'),
  ];
  state.sides.ai.board.rows.middle.dice = [
    shield('ai-mid-1', 5, 'ai'), shield('ai-mid-2', 5, 'ai'), shield('ai-mid-3', 5, 'ai'),
  ];
  state.sides.player.board.rows.top.dice = [
    normal('p-top-1', 1, 'player'), normal('p-top-2', 2, 'player'), normal('p-top-3', 3, 'player'),
  ];
  state.sides.player.board.rows.middle.dice = [
    normal('p-mid-1', 1, 'player'), normal('p-mid-2', 2, 'player'), normal('p-mid-3', 3, 'player'),
  ];
  state.sides.ai.skills.tazzaRemaining = 0;
  state.sides.ai.skills.holdRemaining = 0;
  state.sides.player.skills.tazzaRemaining = 0;
  state.sides.player.skills.holdRemaining = 0;

  const candidates = [
    { action: { type: 'PLACE_DIE', targetSide: 'ai', row: 'bottom' } as const, score: 1 },
  ];
  const profile = { ...getAIProfile(10), mistakeRate: 0 };
  const ranking = rankWinProbabilityAIActions(state, new SeededRandomSource(31415926), candidates, profile);
  const result = ranking.rankedCandidates[0];

  assertEqual(result.rawWins, result.samples);
  assertEqual(result.rawLosses, 0);
  assertEqual(result.rawDraws, 0);
  assertEqual(result.unresolved, 0);
  assertEqual(result.estimatedWinProbability, 1);
});
