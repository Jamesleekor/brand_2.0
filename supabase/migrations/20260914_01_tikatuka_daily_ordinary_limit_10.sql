-- =============================================================================
-- B.R.A.N.D 2.0 — Rakaruka ordinary-play daily cap
-- 2026-09-14
--
-- Policy
--   * Ordinary Rakaruka games: max 10 issued games per student per KST day.
--   * Official five-match challenge games are exempt from the ordinary cap.
--   * READY rows count toward the cap so refresh/abandon cannot bypass it.
--   * A per-student progress-row lock serializes concurrent game issuance.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tikatuka_games') IS NULL
     OR to_regclass('public.tikatuka_progress') IS NULL
     OR to_regclass('public.tikatuka_official_sessions') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] daily-limit prerequisites are missing.' USING ERRCODE = 'PTK30';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_create_tikatuka_game(p_difficulty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_highest integer;
  v_game public.tikatuka_games;
  v_official_active boolean := false;
  v_daily_ordinary_count integer := 0;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_difficulty IS NULL OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] difficulty must be 1..10.' USING ERRCODE = 'PTK02';
  END IF;

  INSERT INTO public.tikatuka_progress(classroom_id, student_id, highest_unlocked_difficulty)
  VALUES (v_classroom_id, v_student_id, 1)
  ON CONFLICT (classroom_id, student_id) DO NOTHING;

  -- Serialize game creation for one student so two simultaneous requests cannot
  -- both pass the daily-count check.
  SELECT highest_unlocked_difficulty
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id
    AND student_id = v_student_id
  FOR UPDATE;

  IF p_difficulty > v_highest THEN
    RAISE EXCEPTION '[TIKATUKA] difficulty % is locked; highest unlocked is %.', p_difficulty, v_highest
      USING ERRCODE = 'PTK03';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id = v_classroom_id
      AND os.student_id = v_student_id
      AND os.status = 'ACTIVE'
  )
  INTO v_official_active;

  -- While a five-match official challenge is active, all newly issued games are
  -- governed by the existing official-difficulty trigger and are not ordinary play.
  IF NOT v_official_active THEN
    v_day_start := date_trunc('day', timezone('Asia/Seoul', now())) AT TIME ZONE 'Asia/Seoul';
    v_day_end := v_day_start + interval '1 day';

    SELECT count(*)::integer
    INTO v_daily_ordinary_count
    FROM public.tikatuka_games g
    WHERE g.classroom_id = v_classroom_id
      AND g.student_id = v_student_id
      AND g.issued_at >= v_day_start
      AND g.issued_at < v_day_end
      -- A game issued while an official session was active belongs to that
      -- challenge window even if it remained READY and therefore never received
      -- official_session_id at completion time.
      AND NOT EXISTS (
        SELECT 1
        FROM public.tikatuka_official_sessions os
        WHERE os.classroom_id = g.classroom_id
          AND os.student_id = g.student_id
          AND os.difficulty = g.difficulty
          AND g.issued_at >= os.started_at
          AND g.issued_at <= coalesce(os.completed_at, now())
      );

    IF v_daily_ordinary_count >= 10 THEN
      RAISE EXCEPTION '[TIKATUKA] ordinary daily play limit reached (10/10).'
        USING ERRCODE = 'PTK16';
    END IF;
  END IF;

  INSERT INTO public.tikatuka_games(classroom_id, student_id, engine_version, difficulty)
  VALUES (v_classroom_id, v_student_id, 1, p_difficulty)
  RETURNING * INTO v_game;

  RETURN jsonb_build_object(
    'game_id', v_game.id,
    'engine_version', v_game.engine_version,
    'difficulty', v_game.difficulty,
    'issued_at', v_game.issued_at,
    'progress', public.tikatuka_progress_payload(v_classroom_id, v_student_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_create_tikatuka_game(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_create_tikatuka_game(integer) TO authenticated, service_role;

COMMIT;
