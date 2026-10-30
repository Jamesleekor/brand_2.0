/**
 * Test-only CLI: `node bot-cli.js <seed> [seed...]` → JSON array on stdout.
 * Used by the replica E2E harness to (a) compare TS vs SQL replay and
 * (b) produce realistic event logs for server submissions.
 */
import { playStarlinkBot } from './starlinkBot';
import { replayStarlinkRun } from '../starlinkRuntime';

const seeds = process.argv.slice(2).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1);
const out = seeds.map((seed) => {
  const bot = playStarlinkBot(seed);
  const replay = replayStarlinkRun(seed, bot.events, bot.submissionWallMs);
  return {
    seed,
    events: bot.events,
    submissionWallMs: bot.submissionWallMs,
    score: replay.official_score,
    gameEndWallMs: replay.game_end_wall_ms,
    stats: replay.stats,
  };
});
process.stdout.write(JSON.stringify(out));
