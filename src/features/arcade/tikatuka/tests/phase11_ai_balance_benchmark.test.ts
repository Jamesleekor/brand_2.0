import {
  chooseAdvancedAIAction,
  getAIProfile,
  rankAdvancedAIActions,
  rankAdvancedTurnActions,
} from '../ai';
import {
  SeededRandomSource,
  createInitialTikatukaState,
  dispatchTikatukaAction,
} from '../engine';
import type { Difficulty, EngineDependencies, GameAction, GameState } from '../engine';
import { assert, assertEqual, test } from './testHarness';

type AIMode = 'current' | 'legacy';

interface BenchmarkGame {
  seed: number;
  winner: 'player' | 'ai' | 'draw';
  totalTurns: number;
  playerRowWins: number;
  aiRowWins: number;
  playerScore: number;
  aiScore: number;
}

const BENCHMARK_SEEDS = [104729, 209759, 314159, 524287] as const;
const MAX_DECISIONS = 1_000;
const SEARCH_OPTIONS = {
  limits: { maxNodes: 5_000, hardTimeBudgetMs: 10_000 },
  now: () => 0,
} as const;

function createDependencies(seed: number, label: string): EngineDependencies {
  let id = 0;
  const aiSeed = ((seed ^ 0x6a09e667) >>> 0) || 1;
  return {
    gameRng: new SeededRandomSource(seed),
    aiRng: new SeededRandomSource(aiSeed),
    createId: () => `${label}-die-${++id}`,
  };
}

function legacyAIAction(state: GameState): Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }> {
  // Lv8 is the frozen pre-redesign depth-2 evaluator, so it is our legacy high-level baseline.
  const profile = { ...getAIProfile(8), mistakeRate: 0 };
  const ranking = rankAdvancedAIActions(state, profile, SEARCH_OPTIONS);
  return ranking.rankedCandidates[0].action;
}

function strongPlayerAction(state: GameState): Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }> {
  const strongPlayerProfile = { ...getAIProfile(10), mistakeRate: 0 };
  const ranking = rankAdvancedTurnActions(state, strongPlayerProfile, SEARCH_OPTIONS);
  return ranking.rankedCandidates[0].action;
}

function runBenchmarkGame(difficulty: Difficulty, seed: number, mode: AIMode): BenchmarkGame {
  const label = `benchmark-${difficulty}-${mode}-${seed}`;
  const deps = createDependencies(seed, label);
  let state = createInitialTikatukaState(label, difficulty);
  state = dispatchTikatukaAction(state, { type: 'START_GAME', difficulty }, deps, 'player').nextState;

  let decisions = 0;

  while (state.phase !== 'game_over' && decisions < MAX_DECISIONS) {
    assertEqual(state.phase, 'awaiting_action');
    assert(state.turn.currentDie !== null);

    const action = state.currentSide === 'player'
      ? strongPlayerAction(state)
      : mode === 'current'
        ? chooseAdvancedAIAction(state, deps.aiRng, getAIProfile(difficulty), SEARCH_OPTIONS).action
        : legacyAIAction(state);

    state = dispatchTikatukaAction(state, action, deps, state.currentSide).nextState;
    decisions += 1;
  }

  assert(state.phase === 'game_over', `Benchmark Lv.${difficulty} ${mode} seed ${seed} did not finish.`);
  assert(state.result !== null);
  return {
    seed,
    winner: state.result.winner,
    totalTurns: state.result.totalTurns,
    playerRowWins: state.result.playerRowWins,
    aiRowWins: state.result.aiRowWins,
    playerScore: state.result.playerScore,
    aiScore: state.result.aiScore,
  };
}

function runGroup(difficulty: Difficulty, mode: AIMode): BenchmarkGame[] {
  return BENCHMARK_SEEDS.map((seed) => runBenchmarkGame(difficulty, seed, mode));
}

function summary(difficulty: Difficulty, mode: AIMode, games: readonly BenchmarkGame[]): string {
  const player = games.filter((game) => game.winner === 'player').length;
  const ai = games.filter((game) => game.winner === 'ai').length;
  const draw = games.length - player - ai;
  const averageTurns = games.reduce((sum, game) => sum + game.totalTurns, 0) / games.length;
  return `Lv.${difficulty} ${mode}: player ${player}/${games.length}, AI ${ai}/${games.length}, draw ${draw}/${games.length}, avgTurns ${averageTurns.toFixed(1)}`;
}

test('balance benchmark: strong depth-2 proxy A/B baseline for Lv8~10', () => {
  const lv8 = runGroup(8, 'current');
  const lv9Legacy = runGroup(9, 'legacy');
  const lv9Current = runGroup(9, 'current');
  const lv10Legacy = runGroup(10, 'legacy');
  const lv10Current = runGroup(10, 'current');

  console.log('\n[Rakaruka strong depth-2 proxy A/B]');
  console.log(summary(8, 'current', lv8));
  console.log(summary(9, 'legacy', lv9Legacy));
  console.log(summary(9, 'current', lv9Current));
  console.log(summary(10, 'legacy', lv10Legacy));
  console.log(summary(10, 'current', lv10Current));

  assertEqual(lv8.length, BENCHMARK_SEEDS.length);
  assertEqual(lv9Legacy.length, BENCHMARK_SEEDS.length);
  assertEqual(lv9Current.length, BENCHMARK_SEEDS.length);
  assertEqual(lv10Legacy.length, BENCHMARK_SEEDS.length);
  assertEqual(lv10Current.length, BENCHMARK_SEEDS.length);
});
