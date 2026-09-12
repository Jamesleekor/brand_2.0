import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TikatukaCompetitionSchema } from '../../../../lib/zod_schemas/tikatuka_competition_schemas';
import { assert, assertEqual, test } from './testHarness';

test('phase8 competition: frontend schema accepts Arcade-period scoped single-attempt contract', () => {
  const sample = {
    period_id: 12,
    period_key: '2026-09',
    period_display_name: '2026년 9월 Arcade',
    period_kind: 'MONTHLY',
    period_status: 'ACTIVE',
    period_starts_at: '2026-09-01T00:00:00+09:00',
    period_ends_at_exclusive: '2026-09-30T23:59:00+09:00',
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
    official_window_open: true,
    official_window_opened_at: '2026-09-12T11:50:00+09:00',
    official_window_closed_at: null,
    official_attempt_used: true,
    official_can_start: false,
    rules: { matches_per_challenge: 5, win_points: 3, draw_points: 1, loss_points: 0, minimum_qualifying_points: 3 },
  };

  const parsed = TikatukaCompetitionSchema.safeParse(sample);
  assert(parsed.success, 'competition payload should satisfy period-scoped schema');
  if (!parsed.success) return;
  assertEqual(parsed.data.period_id, 12);
  assertEqual(parsed.data.official_leaderboard[0].ranking_score > parsed.data.official_leaderboard[1].ranking_score, true);
  assertEqual(parsed.data.official_attempt_used, true);
  assertEqual(parsed.data.official_can_start, false);
});

test('phase8 competition migration: official challenge is exactly five verified games with 3/1/0 scoring and three-point qualification', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260912_03_tikatuka_official_ranking.sql'), 'utf8');
  assert(sql.includes("status = 'COMPLETED' AND games_played = 5"));
  assert(sql.includes('points = wins * 3 + draws'));
  assert(sql.includes('AND os.points >= 3'));
  assert(sql.includes('dense_rank() OVER (ORDER BY difficulty DESC, points DESC)'));
  assert(sql.includes('difficulty * 16 + points'));
  assert(sql.includes("OLD.status = 'READY' AND NEW.status = 'COMPLETED'"));
  assert(sql.includes("WHEN 'player' THEN 3"));
  assert(sql.includes("WHEN 'draw' THEN 1"));
  assert(sql.includes('coalesce(s.is_test_account, false) = false'));
});

test('phase8 competition migration: active challenge locks all newly issued games to its chosen difficulty', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260912_04_tikatuka_official_difficulty_lock.sql'), 'utf8');
  assert(sql.includes("status = 'ACTIVE'"));
  assert(sql.includes('NEW.difficulty <> v_difficulty'));
  assert(sql.includes("ERRCODE = 'PTK43'"));
  assert(sql.includes('BEFORE INSERT ON public.tikatuka_games'));
});

test('phase8 official day: teacher gate and one-attempt rule are server-enforced', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260913_01_tikatuka_official_day_single_attempt.sql'), 'utf8');
  assert(sql.includes('CREATE TABLE public.tikatuka_official_windows'));
  assert(sql.includes("ERRCODE = 'PTK44'"));
  assert(sql.includes("ERRCODE = 'PTK45'"));
  assert(sql.includes('teacher_set_tikatuka_official_window_v1'));
  assert(sql.includes("'official_attempt_used', v_attempt_used"));
  assert(sql.includes('Closing Official Day blocks NEW sessions only'));
});

test('phase8 period alignment: Rakaruka uses Arcade ranking period ids and exact period boundaries', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260913_02_tikatuka_align_arcade_periods.sql'), 'utf8');
  assert(sql.includes('arcade_period_id bigint REFERENCES public.arcade_ranking_periods(id)'));
  assert(sql.includes('student_get_tikatuka_competition_v2'));
  assert(sql.includes('student_start_tikatuka_official_challenge_v2'));
  assert(sql.includes('g.completed_at >= v_period.starts_at'));
  assert(sql.includes('g.completed_at < v_period.ends_at_exclusive'));
  assert(sql.includes('ux_tikatuka_official_one_attempt_student_arcade_period'));
  assert(sql.includes("v_period.status<>'ACTIVE'"));
});

test('phase8 layout: ranking lives on Arcade selector and not inside live Rakaruka game', () => {
  const arcadePage = readFileSync(resolve(process.cwd(), 'src/features/arcade/ArcadePage.tsx'), 'utf8');
  const gamePage = readFileSync(resolve(process.cwd(), 'src/features/arcade/tikatuka/ui/TikatukaGame.tsx'), 'utf8');
  const layoutCss = readFileSync(resolve(process.cwd(), 'src/features/arcade/tikatuka/ui/tikatuka-layout.css'), 'utf8');

  assert(arcadePage.includes('<RakarukaCompetitionPanel periodId={selectedPeriod.id} />'));
  assert(arcadePage.includes('랭킹 기간 선택'));
  assert(arcadePage.includes('월간 Top 10 보너스 기준'));
  assert(!arcadePage.includes('월간 Top 10과는 별도의 전략 게임입니다.'));
  assert(!gamePage.includes('RakarukaCompetitionPanel'));
  assert(gamePage.indexOf('<RakarukaActionHistory') < gamePage.indexOf('<TikatukaGameCore'));
  assert(layoutCss.includes('min-height: 108px'));
  assert(layoutCss.includes('> div:last-child'));
});

test('phase8 opponent UX: every difficulty maps to the intended shard character', () => {
  const opponents = readFileSync(resolve(process.cwd(), 'src/features/arcade/tikatuka/ui/opponents.ts'), 'utf8');
  const expected = [
    "1: {\n    difficulty: 1,\n    characterUid: 'CHAR-001'",
    "2: {\n    difficulty: 2,\n    characterUid: 'CHAR-004'",
    "3: {\n    difficulty: 3,\n    characterUid: 'CHAR-015'",
    "4: {\n    difficulty: 4,\n    characterUid: 'CHAR-043'",
    "5: {\n    difficulty: 5,\n    characterUid: 'CHAR-047'",
    "6: {\n    difficulty: 6,\n    characterUid: 'CHAR-076'",
    "7: {\n    difficulty: 7,\n    characterUid: 'CHAR-064'",
    "8: {\n    difficulty: 8,\n    characterUid: 'CHAR-052'",
    "9: {\n    difficulty: 9,\n    characterUid: 'CHAR-055'",
    "10: {\n    difficulty: 10,\n    characterUid: 'CHAR-022'",
  ];
  for (const marker of expected) assert(opponents.includes(marker), `missing opponent mapping: ${marker}`);
  assert(opponents.includes("name: '레티시아'"));
  assert(opponents.includes("name: '아스텔'"));
});

test('phase8 opponent UX: AI roll result is shown before thinking can begin', () => {
  const gamePage = readFileSync(resolve(process.cwd(), 'src/features/arcade/tikatuka/ui/TikatukaGame.tsx'), 'utf8');
  const presentation = readFileSync(resolve(process.cwd(), 'src/features/arcade/tikatuka/ui/presentation.ts'), 'utf8');

  assert(gamePage.includes("setAiRollPresentation({event,stage:'rolling'})"));
  assert(gamePage.includes("setAiRollPresentation({event,stage:'result'})"));
  assert(gamePage.includes('1.5초 동안 결과를 확인합니다.'));
  assert(gamePage.includes('<OpponentEncounterCard'));
  assert(gamePage.includes('characterC2Rpc.myCollection(supabase)'));
  assert(presentation.includes('export const RAKARUKA_AI_RESULT_HOLD_MS = 1_500'));
  assert(presentation.includes("RAKARUKA_DICE_REVEAL_MS + (event.side === 'ai' ? RAKARUKA_AI_RESULT_HOLD_MS : 0)"));
  assert(presentation.includes("RAKARUKA_TAZZA_REVEAL_MS + (event.side === 'ai' ? RAKARUKA_AI_RESULT_HOLD_MS : 0)"));
});