-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade pgcrypto schema-safe helpers
-- 2026-08-14
--
-- Production symptom fixed: PostgreSQL 42883 during student_create_arcade_run.
-- Supabase may install pgcrypto outside public, while Arcade SECURITY DEFINER
-- functions intentionally use search_path = public, pg_temp. Resolve the
-- extension's actual schema from pg_extension instead of weakening search_path.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION '[ARCADE] pgcrypto extension is required for Arcade run seeds and payload hashes.' USING ERRCODE = 'P0225';
  END IF;
  IF to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_run_submissions') IS NULL
     OR to_regprocedure('public.student_create_arcade_run(text)') IS NULL
     OR to_regprocedure('public.student_submit_focus_reaction_01_run(bigint,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~06 migrations must be applied first.';
  END IF;
END $$;

-- These helpers retain the fixed application search_path. Only the extension
-- namespace recorded by PostgreSQL itself is dynamically quoted and called.
CREATE OR REPLACE FUNCTION public.arcade_pgcrypto_schema()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT namespace.nspname
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto';
$$;

CREATE OR REPLACE FUNCTION public.arcade_generate_run_seed()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pgcrypto_schema text;
  v_seed_bytes bytea;
  v_seed bigint;
BEGIN
  v_pgcrypto_schema := public.arcade_pgcrypto_schema();
  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION '[ARCADE] pgcrypto extension schema is missing.' USING ERRCODE = 'P0225';
  END IF;

  EXECUTE format('SELECT %I.gen_random_bytes($1)', v_pgcrypto_schema)
    INTO v_seed_bytes
    USING 4;
  v_seed := get_byte(v_seed_bytes, 0)::bigint * 16777216
    + get_byte(v_seed_bytes, 1)::bigint * 65536
    + get_byte(v_seed_bytes, 2)::bigint * 256
    + get_byte(v_seed_bytes, 3)::bigint;

  RETURN greatest(v_seed, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_sha256_hex(p_payload text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pgcrypto_schema text;
  v_hash text;
BEGIN
  v_pgcrypto_schema := public.arcade_pgcrypto_schema();
  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION '[ARCADE] pgcrypto extension schema is missing.' USING ERRCODE = 'P0225';
  END IF;

  EXECUTE format('SELECT encode(%I.digest($1, $2), ''hex'')', v_pgcrypto_schema)
    INTO v_hash
    USING p_payload, 'sha256';
  RETURN v_hash;
END;
$$;

-- -----------------------------------------------------------------------------
-- Existing public run creation: only the seed source changes. Availability,
-- pre-release access, and server-assigned is_prerelease_test remain unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code AND is_active;
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
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_is_prerelease_test;

    IF NOT v_is_prerelease_test THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;
  END IF;

  SELECT * INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id = v_game.id AND is_active
  ORDER BY id DESC
  LIMIT 1;
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
  )
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'game_code', v_game.code,
    'rule_version', v_rule.version_code,
    'countdown_started_at', v_run.countdown_started_at,
    'countdown_ends_at', v_run.countdown_started_at + ((v_rule.config ->> 'countdown_ms')::integer * interval '1 millisecond'),
    'schedule_seed', v_run.schedule_seed,
    'config', v_rule.config,
    'is_prerelease_test', v_run.is_prerelease_test
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Existing Game #01 submission: only the payload-hash call changes. This avoids
-- a second 42883 error after the player reaches game over.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_submit_focus_reaction_01_run(
  p_run_id bigint,
  p_input_events jsonb,
  p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_validation jsonb;
  v_submitted_at timestamptz := clock_timestamp();
  v_server_elapsed_ms integer;
  v_server_tolerance_ms integer;
  v_payload_hash text;
  v_input_event_count integer;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  SELECT run.* INTO v_run
  FROM public.arcade_runs run
  WHERE run.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  IF v_run.status <> 'PLAYING' OR v_run.play_started_at IS NULL THEN
    RAISE EXCEPTION '[ARCADE] this run is not ready for submission.' USING ERRCODE = 'P0202';
  END IF;
  IF p_client_game_over_elapsed_ms IS NULL
     OR p_client_game_over_elapsed_ms NOT BETWEEN 0 AND 3600000 THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED', submitted_at = v_submitted_at,
        rejection_code = 'ELAPSED_OUT_OF_RANGE', rejection_reason = '게임 시간 기록이 허용 범위를 벗어났습니다.'
    WHERE id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'ELAPSED_OUT_OF_RANGE', 'message', '게임 시간 기록이 올바르지 않습니다.');
  END IF;
  IF p_input_events IS NULL OR jsonb_typeof(p_input_events) <> 'array' THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED', submitted_at = v_submitted_at,
        rejection_code = 'INPUT_EVENTS_NOT_ARRAY', rejection_reason = '입력 기록 형식이 올바르지 않습니다.'
    WHERE id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'INPUT_EVENTS_NOT_ARRAY', 'message', '입력 기록 형식이 올바르지 않습니다.');
  END IF;
  v_input_event_count := jsonb_array_length(p_input_events);
  IF v_input_event_count IS NULL OR v_input_event_count > 20000 THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED', submitted_at = v_submitted_at,
        rejection_code = 'INPUT_EVENT_COUNT_EXCEEDED', rejection_reason = '입력 기록이 허용된 개수를 초과했습니다.'
    WHERE id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'INPUT_EVENT_COUNT_EXCEEDED', 'message', '입력 기록이 너무 많아 공식 기록으로 인정되지 않았습니다.');
  END IF;

  SELECT config INTO v_config
  FROM public.arcade_game_rule_versions
  WHERE id = v_run.rule_version_id;
  IF v_config ->> 'game_code' <> 'focus_reaction_01' THEN
    RAISE EXCEPTION '[ARCADE] this run does not use Game #01 rules.' USING ERRCODE = 'P0203';
  END IF;

  UPDATE public.arcade_runs SET status = 'SUBMITTING', submitted_at = v_submitted_at WHERE id = v_run.id;
  v_validation := public.arcade_validate_focus_reaction_01_submission(
    v_run.schedule_seed, v_config, p_input_events, p_client_game_over_elapsed_ms
  );
  v_payload_hash := public.arcade_sha256_hex(p_input_events::text || '|' || p_client_game_over_elapsed_ms::text);

  INSERT INTO public.arcade_run_submissions (
    run_id, input_events, input_event_count, client_game_over_elapsed_ms,
    payload_hash, validation_metadata, submitted_at
  ) VALUES (
    v_run.id, p_input_events, v_input_event_count, p_client_game_over_elapsed_ms,
    v_payload_hash, v_validation, v_submitted_at
  );

  IF coalesce((v_validation ->> 'valid')::boolean, false) IS NOT TRUE THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED',
        rejection_code = v_validation ->> 'code',
        rejection_reason = v_validation ->> 'message'
    WHERE id = v_run.id;
    RETURN jsonb_build_object(
      'accepted', false,
      'code', coalesce(v_validation ->> 'code', 'VALIDATION_FAILED'),
      'message', coalesce(v_validation ->> 'message', '게임 기록을 검증하지 못했습니다.')
    );
  END IF;

  v_server_elapsed_ms := floor(extract(epoch FROM (v_submitted_at - v_run.play_started_at)) * 1000)::integer;
  v_server_tolerance_ms := coalesce((v_config ->> 'server_elapsed_tolerance_ms')::integer, 10000);
  IF v_server_elapsed_ms < (v_validation ->> 'official_duration_ms')::integer - 2000
     OR v_server_elapsed_ms > (v_validation ->> 'official_duration_ms')::integer + v_server_tolerance_ms THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED',
        rejection_code = 'SERVER_TIME_MISMATCH',
        rejection_reason = '서버 시간과 게임 진행 시간이 크게 달라 공식 기록으로 인정되지 않았습니다.'
    WHERE id = v_run.id;
    UPDATE public.arcade_run_submissions
    SET validation_metadata = validation_metadata || jsonb_build_object(
      'server_elapsed_ms', v_server_elapsed_ms,
      'server_time_valid', false
    )
    WHERE run_id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'SERVER_TIME_MISMATCH', 'message', '게임 시간 검증에 실패했습니다. 다시 시도해 주세요.');
  END IF;

  UPDATE public.arcade_runs
  SET status = 'VERIFIED',
      game_over_at = v_run.play_started_at + ((v_validation ->> 'official_duration_ms')::integer * interval '1 millisecond'),
      verified_at = v_submitted_at,
      official_score = (v_validation ->> 'official_score')::bigint,
      official_duration_ms = (v_validation ->> 'official_duration_ms')::integer,
      stats = v_validation -> 'stats',
      rejection_code = NULL,
      rejection_reason = NULL
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  UPDATE public.arcade_run_submissions
  SET validation_metadata = validation_metadata || jsonb_build_object(
    'server_elapsed_ms', v_server_elapsed_ms,
    'server_time_valid', true
  )
  WHERE run_id = v_run.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'run_id', v_run.id,
    'official_score', v_run.official_score,
    'official_duration_ms', v_run.official_duration_ms,
    'game_over_at', v_run.game_over_at,
    'stats', v_run.stats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_pgcrypto_schema() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_generate_run_seed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_sha256_hex(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_create_arcade_run(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_submit_focus_reaction_01_run(bigint, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_create_arcade_run(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_focus_reaction_01_run(bigint, jsonb, integer) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT extension.extname AS extension_name,
       namespace.nspname AS installed_schema,
       extension.extversion AS extension_version
FROM pg_extension extension
JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
WHERE extension.extname = 'pgcrypto';

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'arcade_pgcrypto_schema',
    'arcade_generate_run_seed',
    'arcade_sha256_hex',
    'student_create_arcade_run',
    'student_submit_focus_reaction_01_run'
  )
ORDER BY function_name, identity_arguments;

SELECT pg_get_functiondef('public.student_create_arcade_run(text)'::regprocedure)
         ILIKE '%arcade_generate_run_seed%' AS create_run_uses_schema_safe_seed_helper,
       pg_get_functiondef('public.student_submit_focus_reaction_01_run(bigint,jsonb,integer)'::regprocedure)
         ILIKE '%arcade_sha256_hex%' AS submit_run_uses_schema_safe_hash_helper;
