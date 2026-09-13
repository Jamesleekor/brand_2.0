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
import type { Difficulty, EngineDependencies, GameAction, GameEvent, GameState } from '../engine';
import { assert, assertEqual, test } from './testHarness';

type AIMode = 'current' | 'legacy';
type LuckBand = 'player_favored' | 'roughly_even' | 'player_unfavored';

interface BenchmarkGame {
  seed: number;
  winner: 'player' | 'ai' | 'draw';
  totalTurns: number;
  playerRowWins: number;
  aiRowWins: number;
  playerScore: number;
  aiScore: number;
  playerRandomPipAvg: number;
  aiRandomPipAvg: number;
  luckBand: LuckBand;
}

const DEFAULT_BENCHMARK_SEEDS = [104729, 209759, 314159, 524287] as const;
const MAX_DECISIONS = 1_000;
const SEARCH_OPTIONS = {
  limits: { maxNodes: 5_000, hardTimeBudgetMs: 10_000 },
  now: () => 0,
} as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function benchmarkSeeds(): readonly number[] {
  const gamesPerLevel = envInt('RAKARUKA_MC_GAMES_PER_LEVEL', 0);
  if (gamesPerLevel <= 0) return DEFAULT_BENCHMARK_SEEDS;
  const shard = envInt('RAKARUKA_MC_SHARD', 1) - 1;
  const shardCount = envInt('RAKARUKA_MC_SHARDS', 1);
  const base = 1_000_003 + shard * 104_729;
  return Array.from({ length: gamesPerLevel }, (_, index) => base + index * shardCount * 7_919);
}

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
  const profile = { ...getAIProfile(8), mistakeRate: 0 };
  const ranking = rankAdvancedAIActions(state, profile, SEARCH_OPTIONS);
  return ranking.rankedCandidates[0].action;
}

function strongPlayerAction(state: GameState): Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }> {
  const strongPlayerProfile = { ...getAIProfile(10), mistakeRate: 0 };
  const ranking = rankAdvancedTurnActions(state, strongPlayerProfile, SEARCH_OPTIONS);
  return ranking.rankedCandidates[0].action;
}

function recordRandomEvents(
  events: readonly GameEvent[],
  sums: Record<'player' | 'ai', number>,
  counts: Record<'player' | 'ai', number>,
): void {
  for (const event of events) {
    if (event.type === 'DIE_ROLLED') {
      sums[event.side] += event.die.value;
      counts[event.side] += 1;
    } else if (event.type === 'TAZZA_USED') {
      sums[event.side] += event.next.value;
      counts[event.side] += 1;
    }
  }
}

function classifyLuck(playerAvg: number, aiAvg: number): LuckBand {
  const diff = playerAvg - aiAvg;
  if (diff > 0.35) return 'player_favored';
  if (diff < -0.35) return 'player_unfavored';
  return 'roughly_even';
}

function runBenchmarkGame(difficulty: Difficulty, seed: number, mode: AIMode): BenchmarkGame {
  const label = `benchmark-${difficulty}-${mode}-${seed}`;
  const deps = createDependencies(seed, label);
  let state = createInitialTikatukaState(label, difficulty);
  const sums = { player: 0, ai: 0 };
  const counts = { player: 0, ai: 0 };

  const started = dispatchTikatukaAction(state, { type: 'START_GAME', difficulty }, deps, 'player');
  state = started.nextState;
  recordRandomEvents(started.events, sums, counts);

  let decisions = 0;
  while (state.phase !== 'game_over' && decisions < MAX_DECISIONS) {
    assertEqual(state.phase, 'awaiting_action');
    assert(state.turn.currentDie !== null);

    const action = state.currentSide === 'player'
      ? strongPlayerAction(state)
      : mode === 'current'
        ? chooseAdvancedAIAction(state, deps.aiRng, getAIProfile(difficulty), SEARCH_OPTIONS).action
        : legacyAIAction(state);

    const transition = dispatchTikatukaAction(state, action, deps, state.currentSide);
    state = transition.nextState;
    recordRandomEvents(transition.events, sums, counts);
    decisions += 1;
  }

  assert(state.phase === 'game_over', `Benchmark Lv.${difficulty} ${mode} seed ${seed} did not finish.`);
  assert(state.result !== null);
  const playerRandomPipAvg = counts.player > 0 ? sums.player / counts.player : 0;
  const aiRandomPipAvg = counts.ai > 0 ? sums.ai / counts.ai : 0;
  return {
    seed,
    winner: state.result.winner,
    totalTurns: state.result.totalTurns,
    playerRowWins: state.result.playerRowWins,
    aiRowWins: state.result.aiRowWins,
    playerScore: state.result.playerScore,
    aiScore: state.result.aiScore,
    playerRandomPipAvg,
    aiRandomPipAvg,
    luckBand: classifyLuck(playerRandomPipAvg, aiRandomPipAvg),
  };
}

function runGroup(difficulty: Difficulty, mode: AIMode, seeds: readonly number[]): BenchmarkGame[] {
  return seeds.map((seed) => runBenchmarkGame(difficulty, seed, mode));
}

function summaryObject(difficulty: Difficulty, mode: AIMode, games: readonly BenchmarkGame[]) {
  const player = games.filter((game) => game.winner === 'player').length;
  const ai = games.filter((game) => game.winner === 'ai').length;
  const draw = games.length - player - ai;
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const luck = (band: LuckBand) => {
    const subset = games.filter((game) => game.luckBand === band);
    return {
      n: subset.length,
      playerWins: subset.filter((game) => game.winner === 'player').length,
      aiWins: subset.filter((game) => game.winner === 'ai').length,
      draws: subset.filter((game) => game.winner === 'draw').length,
    };
  };
  return {
    difficulty,
    mode,
    games: games.length,
    playerWins: player,
    aiWins: ai,
    draws: draw,
    playerWinRate: player / games.length,
    avgTurns: mean(games.map((game) => game.totalTurns)),
    avgScoreDiff: mean(games.map((game) => game.playerScore - game.aiScore)),
    avgRowDiff: mean(games.map((game) => game.playerRowWins - game.aiRowWins)),
    avgRandomPipDiff: mean(games.map((game) => game.playerRandomPipAvg - game.aiRandomPipAvg)),
    luck: {
      playerFavored: luck('player_favored'),
      roughlyEven: luck('roughly_even'),
      playerUnfavored: luck('player_unfavored'),
    },
  };
}

function printSummary(difficulty: Difficulty, mode: AIMode, games: readonly BenchmarkGame[]): void {
  const s = summaryObject(difficulty, mode, games);
  console.log(`Lv.${difficulty} ${mode}: player ${s.playerWins}/${s.games}, AI ${s.aiWins}/${s.games}, draw ${s.draws}/${s.games}, avgTurns ${s.avgTurns.toFixed(1)}, avgScoreDiff ${s.avgScoreDiff.toFixed(2)}`);
  console.log(`[MC_JSON] ${JSON.stringify(s)}`);
}

if (process.env.RAKARUKA_MC_RUN === '1') {
  test('balance benchmark: strong depth-2 proxy A/B baseline for Lv8~10', () => {
    const seeds = benchmarkSeeds();
    const currentOnly = process.env.RAKARUKA_MC_CURRENT_ONLY === '1';

    console.log(`\n[Rakaruka strong depth-2 proxy A/B] seeds=${seeds.length} shard=${process.env.RAKARUKA_MC_SHARD ?? 'default'}`);

    const lv8 = runGroup(8, 'current', seeds);
    const lv9Current = runGroup(9, 'current', seeds);
    const lv10Current = runGroup(10, 'current', seeds);
    printSummary(8, 'current', lv8);
    printSummary(9, 'current', lv9Current);
    printSummary(10, 'current', lv10Current);

    assertEqual(lv8.length, seeds.length);
    assertEqual(lv9Current.length, seeds.length);
    assertEqual(lv10Current.length, seeds.length);

    if (!currentOnly) {
      const lv9Legacy = runGroup(9, 'legacy', seeds);
      const lv10Legacy = runGroup(10, 'legacy', seeds);
      printSummary(9, 'legacy', lv9Legacy);
      printSummary(10, 'legacy', lv10Legacy);
      assertEqual(lv9Legacy.length, seeds.length);
      assertEqual(lv10Legacy.length, seeds.length);
    }
  });
}
