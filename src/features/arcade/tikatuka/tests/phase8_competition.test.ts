import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TikatukaCompetitionSchema } from '@/lib/zod_schemas/tikatuka_competition_schemas';
import { assert, assertEqual, test } from './testHarness';

test('phase8 competition: frontend schema accepts the confirmed five-match ranking contract', () => {
  const sample = {
    period_key: '2026-09',
    general_leaderboard: [
      { rank: 1, student_id: 1, student_name: 'A', brand_name: null, cleared_level: 10 },
      { rank: 1, student_id: 2, student_name: 'B', brand_name: 'B-01', cleared_level: 10 },
    ],
    official_leaderboard: [
      { rank: 1, student_id: 1, student_name: 'A', brand_name: null, difficulty: 10, wins: 1, draws: 0, losses: 4, points: 3, ranking_score: 163, completed_at: '2026-09-12T13:00:00+09:00' },
      { rank: 2, student_id: 2, student_name: 'B', brand_name: 'B-01', difficulty: 9, wins: 5, draws: 0, losses: 0, points: 15, ranking_score: 159, completed_at: '2026-09-12T13:05:00+09:00' },
    ],
    my_general: { rank: 1, cleared_level: 10 },
    my_official: { rank: 1, difficulty: 10, wins: 1, draws: 0, losses: 4, points: 3, ranking_score: 163, completed_at: '2026-09-12T13:00:00+09:00' },
    active_challenge: { session_id: 7, difficulty: 8, games_played: 2, remaining_games: 3, wins: 1, draws: 0, losses: 1, points: 3, started_at: '2026-09-12T12:00:00+09:00' },
    recent_challenges: [],
    rules: { matches_per_challenge: 5, win_points: 3, draw_points: 1, loss_points: 0, minimum_qualifying_points: 3 },
  };

  const parsed = TikatukaCompetitionSchema.safeParse(sample);
  assert(parsed.success, 'competition payload should satisfy the confirmed schema');
  if (!parsed.success) return;
  assertEqual(parsed.data.official_leaderboard[0].ranking_score > parsed.data.official_leaderboard[1].ranking_score, true);
});

test('phase8 competition migration: official challenge is exactly five verified games with 3/1/0 scoring and three-point qualification', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260912_03_tikatuka_official_ranking.sql'),
    'utf8',
  );

  assert(sql.includes("status = 'COMPLETED' AND games_played = 5"), 'official session must finish only at five games');
  assert(sql.includes('points = wins * 3 + draws'), 'score must be win3/draw1/loss0');
  assert(sql.includes('AND os.points >= 3'), 'public official ranking requires at least three points');
  assert(sql.includes('dense_rank() OVER (ORDER BY difficulty DESC, points DESC)'), 'difficulty must outrank points and exact ties must share rank');
  assert(sql.includes('difficulty * 16 + points'), 'monotonic internal ranking score must preserve level priority');
  assert(sql.includes("OLD.status = 'READY' AND NEW.status = 'COMPLETED'"), 'only server-completed games may advance official sessions');
  assert(sql.includes("WHEN 'player' THEN 3"));
  assert(sql.includes("WHEN 'draw' THEN 1"));
  assert(sql.includes('coalesce(s.is_test_account, false) = false'), 'test accounts must not pollute public leaderboards');
});

test('phase8 competition migration: active challenge locks all newly issued games to its chosen difficulty', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260912_04_tikatuka_official_difficulty_lock.sql'),
    'utf8',
  );

  assert(sql.includes("status = 'ACTIVE'"));
  assert(sql.includes('NEW.difficulty <> v_difficulty'));
  assert(sql.includes("ERRCODE = 'PTK43'"));
  assert(sql.includes('BEFORE INSERT ON public.tikatuka_games'));
});
