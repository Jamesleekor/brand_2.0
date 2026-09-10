-- B.R.A.N.D. 2.0 Arcade — Pure Reaction #02 daily STANDARD challenge cap
-- Production migration already applied: 20260910101944 arcade_pure_reaction_daily_limit_50
-- KST midnight reset, 50 run creations/day, verification attempts excluded, live test agent exempt.

CREATE INDEX IF NOT EXISTS ix_arcade_runs_student_game_created_standard
  ON public.arcade_runs (student_id, game_id, created_at DESC)
  WHERE run_context = 'STANDARD';

CREATE OR REPLACE FUNCTION public.student_get_arcade_game_access(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_seoul_today date;
  v_public_available boolean;
  v_prerelease_allowed boolean := false;
  v_is_live_test_agent boolean := false;
  v_can_start boolean;
  v_daily_attempt_limit integer := 50;
  v_daily_attempt_used integer := 0;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;

  SELECT * INTO v_game FROM public.arcade_games WHERE code = p_game_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_start := v_seoul_today::timestamp AT TIME ZONE 'Asia/Seoul';
  v_day_end := (v_seoul_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  v_is_live_test_agent := public.is_live_test_agent(v_student_id);

  v_public_available := v_game.is_active
    AND v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);

  IF NOT v_public_available AND v_game.is_active AND v_seoul_today < v_game.available_from THEN
    SELECT EXISTS (
      SELECT 1 FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_prerelease_allowed;
  END IF;

  v_can_start := v_public_available OR v_prerelease_allowed;

  IF v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN
    SELECT count(*)::integer INTO v_daily_attempt_used
    FROM public.arcade_runs run
    WHERE run.student_id = v_student_id
      AND run.game_id = v_game.id
      AND run.run_context = 'STANDARD'
      AND run.created_at >= v_day_start
      AND run.created_at < v_day_end;
    IF v_daily_attempt_used >= v_daily_attempt_limit THEN v_can_start := false; END IF;
  END IF;

  RETURN jsonb_build_object(
    'game_code', v_game.code,
    'available_from', v_game.available_from,
    'public_available', v_public_available,
    'can_start', v_can_start,
    'mode', CASE WHEN v_public_available THEN 'PUBLIC' WHEN v_prerelease_allowed THEN 'PRERELEASE_TEST' ELSE 'CLOSED' END,
    'daily_attempt_limit', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_limit ELSE NULL END,
    'daily_attempt_used', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_used ELSE NULL END,
    'daily_attempt_remaining', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN greatest(v_daily_attempt_limit - v_daily_attempt_used, 0) ELSE NULL END,
    'daily_attempt_resets_at', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_day_end ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_seed bigint;
  v_seoul_today date;
  v_public_available boolean;
  v_is_prerelease_test boolean := false;
  v_is_live_test_agent boolean := false;
  v_daily_attempt_limit integer := 50;
  v_daily_attempt_used integer := 0;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;
  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_start := v_seoul_today::timestamp AT TIME ZONE 'Asia/Seoul';
  v_day_end := (v_seoul_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul';

  SELECT * INTO v_game FROM public.arcade_games WHERE code = p_game_code AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
  END IF;

  v_public_available := v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);
  IF NOT v_public_available THEN
    IF v_seoul_today >= v_game.available_from THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_is_prerelease_test;
    IF NOT v_is_prerelease_test THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;
  END IF;

  v_is_live_test_agent := public.is_live_test_agent(v_student_id);
  v_is_prerelease_test := v_is_prerelease_test OR v_is_live_test_agent;

  IF v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN
    -- Same student cannot race the count from multiple browser tabs.
    PERFORM 1 FROM public.students student_row WHERE student_row.id = v_student_id FOR UPDATE;
    SELECT count(*)::integer INTO v_daily_attempt_used
    FROM public.arcade_runs run
    WHERE run.student_id = v_student_id
      AND run.game_id = v_game.id
      AND run.run_context = 'STANDARD'
      AND run.created_at >= v_day_start
      AND run.created_at < v_day_end;
    IF v_daily_attempt_used >= v_daily_attempt_limit THEN
      RAISE EXCEPTION '[ARCADE GAME02] daily challenge limit reached (50/KST day).' USING ERRCODE = 'P0274';
    END IF;
  END IF;

  SELECT * INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id = v_game.id AND is_active
  ORDER BY id DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] active game rule version is missing.' USING ERRCODE = 'P0198';
  END IF;

  v_seed := public.arcade_generate_run_seed();
  INSERT INTO public.arcade_runs (
    classroom_id, student_id, game_id, rule_version_id, status,
    schedule_seed, countdown_started_at, is_prerelease_test
  ) VALUES (
    v_classroom_id, v_student_id, v_game.id, v_rule.id, 'COUNTDOWN',
    v_seed, now(), v_is_prerelease_test
  ) RETURNING * INTO v_run;

  IF v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN
    v_daily_attempt_used := v_daily_attempt_used + 1;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'game_code', v_game.code,
    'rule_version', v_rule.version_code,
    'countdown_started_at', v_run.countdown_started_at,
    'countdown_ends_at', v_run.countdown_started_at + ((v_rule.config ->> 'countdown_ms')::integer * interval '1 millisecond'),
    'schedule_seed', v_run.schedule_seed,
    'config', v_rule.config,
    'is_prerelease_test', v_run.is_prerelease_test,
    'daily_attempt_limit', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_limit ELSE NULL END,
    'daily_attempt_used', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_used ELSE NULL END,
    'daily_attempt_remaining', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN greatest(v_daily_attempt_limit - v_daily_attempt_used, 0) ELSE NULL END,
    'daily_attempt_resets_at', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_day_end ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.student_get_arcade_game_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_get_arcade_game_access(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.student_create_arcade_run(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_create_arcade_run(text) TO authenticated, service_role;
