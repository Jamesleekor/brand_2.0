-- =============================================================================
-- B.R.A.N.D 2.0 — Rakaruka general + official ranking
-- 2026-09-12
--
-- General ranking
--   * Ranked only by highest actually CLEARED difficulty (server-verified wins).
--   * Equal cleared difficulty => equal rank.
--
-- Official ranking
--   * One challenge session fixes one chosen difficulty for five completed games.
--   * Win +3 / Draw +1 / Loss +0.
--   * A completed five-game session is ranking-eligible only at 3+ points.
--   * Ranking priority: challenge difficulty DESC, then points DESC.
--   * Equal difficulty + points => equal rank.
--   * ranking_score = difficulty * 16 + points is stored only as a convenient
--     monotonic comparison value; UI should show difficulty + W/D/L + points.
--   * Multiple completed challenge sessions may be attempted in the same KST month;
--     only the student's best eligible session is used for that month's leaderboard.
--
-- Security
--   * Student/classroom identity comes only from server auth helpers.
--   * Session counters are advanced only by server-verified COMPLETED tikatuka_games.
--   * Direct table access remains revoked; clients use narrow RPCs only.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tikatuka_games') IS NULL
     OR to_regclass('public.tikatuka_progress') IS NULL
     OR to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] ranking prerequisites are missing.' USING ERRCODE = 'PTK40';
  END IF;

  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] identity helpers are missing.' USING ERRCODE = 'PTK40';
  END IF;
END;
$$;

CREATE TABLE public.tikatuka_official_sessions (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  period_key date NOT NULL,
  difficulty smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
  games_played smallint NOT NULL DEFAULT 0 CHECK (games_played BETWEEN 0 AND 5),
  wins smallint NOT NULL DEFAULT 0 CHECK (wins BETWEEN 0 AND 5),
  draws smallint NOT NULL DEFAULT 0 CHECK (draws BETWEEN 0 AND 5),
  losses smallint NOT NULL DEFAULT 0 CHECK (losses BETWEEN 0 AND 5),
  points smallint NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 15),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT tikatuka_official_session_score_check
    CHECK (games_played = wins + draws + losses AND points = wins * 3 + draws),
  CONSTRAINT tikatuka_official_session_status_check
    CHECK (
      (status = 'ACTIVE' AND games_played < 5 AND completed_at IS NULL)
      OR
      (status = 'COMPLETED' AND games_played = 5 AND completed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX ux_tikatuka_official_active_student_period
  ON public.tikatuka_official_sessions(classroom_id, student_id, period_key)
  WHERE status = 'ACTIVE';

CREATE INDEX ix_tikatuka_official_period_rank
  ON public.tikatuka_official_sessions(classroom_id, period_key, difficulty DESC, points DESC)
  WHERE status = 'COMPLETED';

ALTER TABLE public.tikatuka_games
  ADD COLUMN official_session_id bigint REFERENCES public.tikatuka_official_sessions(id),
  ADD COLUMN official_match_number smallint CHECK (official_match_number BETWEEN 1 AND 5);

CREATE INDEX ix_tikatuka_games_official_session
  ON public.tikatuka_games(official_session_id, official_match_number)
  WHERE official_session_id IS NOT NULL;

COMMENT ON TABLE public.tikatuka_official_sessions IS
  'Rakaruka five-match official challenge sessions. Best eligible completed session per KST month is ranked.';

COMMENT ON COLUMN public.tikatuka_games.official_session_id IS
  'Assigned server-side at verified completion when the game belongs to the current active official challenge.';

ALTER TABLE public.tikatuka_official_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tikatuka_official_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.tikatuka_official_sessions_id_seq FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Capture a verified completion into the current active challenge.
-- Trigger name intentionally sorts before tikatuka_games_guard_history.
-- A game issued before the session started never counts toward that session.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.a_tikatuka_capture_official_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_session public.tikatuka_official_sessions;
BEGIN
  IF OLD.status = 'READY' AND NEW.status = 'COMPLETED' THEN
    SELECT *
    INTO v_session
    FROM public.tikatuka_official_sessions s
    WHERE s.classroom_id = OLD.classroom_id
      AND s.student_id = OLD.student_id
      AND s.period_key = v_period
      AND s.status = 'ACTIVE'
      AND s.difficulty = OLD.difficulty
      AND OLD.issued_at >= s.started_at
      AND s.games_played < 5
    ORDER BY s.started_at DESC, s.id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_session.id IS NOT NULL THEN
      NEW.official_session_id := v_session.id;
      NEW.official_match_number := v_session.games_played + 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER a_tikatuka_capture_official_completion
  BEFORE UPDATE ON public.tikatuka_games
  FOR EACH ROW
  EXECUTE FUNCTION public.a_tikatuka_capture_official_completion();

CREATE OR REPLACE FUNCTION public.z_tikatuka_advance_official_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer;
BEGIN
  IF OLD.status = 'READY'
     AND NEW.status = 'COMPLETED'
     AND NEW.official_session_id IS NOT NULL THEN
    v_points := CASE NEW.server_winner
      WHEN 'player' THEN 3
      WHEN 'draw' THEN 1
      ELSE 0
    END;

    UPDATE public.tikatuka_official_sessions s
    SET
      games_played = s.games_played + 1,
      wins = s.wins + CASE WHEN NEW.server_winner = 'player' THEN 1 ELSE 0 END,
      draws = s.draws + CASE WHEN NEW.server_winner = 'draw' THEN 1 ELSE 0 END,
      losses = s.losses + CASE WHEN NEW.server_winner = 'ai' THEN 1 ELSE 0 END,
      points = s.points + v_points,
      status = CASE WHEN s.games_played + 1 >= 5 THEN 'COMPLETED' ELSE 'ACTIVE' END,
      completed_at = CASE WHEN s.games_played + 1 >= 5 THEN now() ELSE NULL END
    WHERE s.id = NEW.official_session_id
      AND s.status = 'ACTIVE'
      AND s.games_played < 5;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER z_tikatuka_advance_official_session
  AFTER UPDATE ON public.tikatuka_games
  FOR EACH ROW
  EXECUTE FUNCTION public.z_tikatuka_advance_official_session();

-- -----------------------------------------------------------------------------
-- Internal competition payload. Public clients cannot EXECUTE this helper.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tikatuka_competition_payload(
  p_classroom_id integer,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_general jsonb;
  v_official jsonb;
  v_my_general jsonb;
  v_my_official jsonb;
  v_active jsonb;
  v_recent jsonb;
BEGIN
  WITH levels AS (
    SELECT
      s.id AS student_id,
      s.name AS student_name,
      s.brand_name,
      coalesce(max(g.difficulty) FILTER (
        WHERE g.status = 'COMPLETED' AND g.server_winner = 'player'
      ), 0)::integer AS cleared_level
    FROM public.students s
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id = s.classroom_id AND g.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST')
      AND coalesce(s.is_test_account, false) = false
    GROUP BY s.id, s.name, s.brand_name
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY cleared_level DESC)::integer AS rank
    FROM levels
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'student_id', student_id,
    'student_name', student_name,
    'brand_name', brand_name,
    'cleared_level', cleared_level
  ) ORDER BY rank, student_name, student_id), '[]'::jsonb)
  INTO v_general
  FROM ranked;

  WITH eligible AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.period_key = v_period
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND s.transferred_at IS NULL
      AND coalesce(s.is_test_account, false) = false
  ), best AS (
    SELECT e.*, s.name AS student_name, s.brand_name
    FROM eligible e
    JOIN public.students s ON s.id = e.student_id
    WHERE e.pick = 1
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY difficulty DESC, points DESC)::integer AS rank
    FROM best
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'student_id', student_id,
    'student_name', student_name,
    'brand_name', brand_name,
    'difficulty', difficulty,
    'wins', wins,
    'draws', draws,
    'losses', losses,
    'points', points,
    'ranking_score', difficulty * 16 + points,
    'completed_at', completed_at
  ) ORDER BY rank, student_name, student_id), '[]'::jsonb)
  INTO v_official
  FROM ranked;

  WITH levels AS (
    SELECT
      s.id AS student_id,
      coalesce(max(g.difficulty) FILTER (
        WHERE g.status = 'COMPLETED' AND g.server_winner = 'player'
      ), 0)::integer AS cleared_level
    FROM public.students s
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id = s.classroom_id AND g.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST')
      AND coalesce(s.is_test_account, false) = false
    GROUP BY s.id
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY cleared_level DESC)::integer AS rank
    FROM levels
  )
  SELECT jsonb_build_object('rank', rank, 'cleared_level', cleared_level)
  INTO v_my_general
  FROM ranked
  WHERE student_id = p_student_id;

  WITH eligible AS (
    SELECT os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.period_key = v_period
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND s.transferred_at IS NULL
      AND coalesce(s.is_test_account, false) = false
  ), best AS (
    SELECT * FROM eligible WHERE pick = 1
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY difficulty DESC, points DESC)::integer AS rank
    FROM best
  )
  SELECT jsonb_build_object(
    'rank', rank,
    'difficulty', difficulty,
    'wins', wins,
    'draws', draws,
    'losses', losses,
    'points', points,
    'ranking_score', difficulty * 16 + points,
    'completed_at', completed_at
  )
  INTO v_my_official
  FROM ranked
  WHERE student_id = p_student_id;

  SELECT jsonb_build_object(
    'session_id', id,
    'difficulty', difficulty,
    'games_played', games_played,
    'remaining_games', 5 - games_played,
    'wins', wins,
    'draws', draws,
    'losses', losses,
    'points', points,
    'started_at', started_at
  )
  INTO v_active
  FROM public.tikatuka_official_sessions
  WHERE classroom_id = p_classroom_id
    AND student_id = p_student_id
    AND period_key = v_period
    AND status = 'ACTIVE'
  ORDER BY started_at DESC, id DESC
  LIMIT 1;

  SELECT coalesce(jsonb_agg(item ORDER BY (item ->> 'completed_at') DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'session_id', id,
      'difficulty', difficulty,
      'wins', wins,
      'draws', draws,
      'losses', losses,
      'points', points,
      'qualified', points >= 3,
      'ranking_score', CASE WHEN points >= 3 THEN difficulty * 16 + points ELSE NULL END,
      'completed_at', completed_at
    ) AS item
    FROM public.tikatuka_official_sessions
    WHERE classroom_id = p_classroom_id
      AND student_id = p_student_id
      AND period_key = v_period
      AND status = 'COMPLETED'
    ORDER BY completed_at DESC, id DESC
    LIMIT 5
  ) recent;

  RETURN jsonb_build_object(
    'period_key', to_char(v_period, 'YYYY-MM'),
    'general_leaderboard', v_general,
    'official_leaderboard', v_official,
    'my_general', v_my_general,
    'my_official', v_my_official,
    'active_challenge', v_active,
    'recent_challenges', v_recent,
    'rules', jsonb_build_object(
      'matches_per_challenge', 5,
      'win_points', 3,
      'draw_points', 1,
      'loss_points', 0,
      'minimum_qualifying_points', 3
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_tikatuka_competition_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;
  RETURN public.tikatuka_competition_payload(v_classroom_id, v_student_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.student_start_tikatuka_official_challenge_v1(
  p_difficulty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_highest integer;
  v_existing bigint;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_difficulty IS NULL OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty must be 1..10.' USING ERRCODE = 'PTK41';
  END IF;

  SELECT coalesce(highest_unlocked_difficulty, 1)
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id AND student_id = v_student_id;
  v_highest := coalesce(v_highest, 1);

  IF p_difficulty > v_highest THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty % is locked; highest unlocked is %.', p_difficulty, v_highest
      USING ERRCODE = 'PTK03';
  END IF;

  SELECT id INTO v_existing
  FROM public.tikatuka_official_sessions
  WHERE classroom_id = v_classroom_id
    AND student_id = v_student_id
    AND period_key = v_period
    AND status = 'ACTIVE'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION '[TIKATUKA] an official challenge is already active.' USING ERRCODE = 'PTK42';
  END IF;

  INSERT INTO public.tikatuka_official_sessions(
    classroom_id, student_id, period_key, difficulty
  ) VALUES (
    v_classroom_id, v_student_id, v_period, p_difficulty
  );

  RETURN public.tikatuka_competition_payload(v_classroom_id, v_student_id);
END;
$$;

REVOKE ALL ON FUNCTION public.tikatuka_competition_payload(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.a_tikatuka_capture_official_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.z_tikatuka_advance_official_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_get_tikatuka_competition_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_start_tikatuka_official_challenge_v1(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.student_get_tikatuka_competition_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_start_tikatuka_official_challenge_v1(integer) TO authenticated, service_role;

COMMIT;
