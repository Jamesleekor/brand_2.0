-- B.R.A.N.D 2.0 — Starlink #04 deterministic board engine postcheck
-- Run after 20261011_05_starlink_04_deterministic_board_engine.sql.

DO $test$
DECLARE
  v_initial_expected smallint[] := ARRAY[
    5,3,5,5,0,0,0,1,1,2,5,4,5,0,4,3,4,0,1,3,0,0,5,2,2,4,1,3,
    2,2,3,2,2,5,4,4,4,1,0,2,4,1,2,0,2,1,5,5,4
  ]::smallint[];
  v_refill_expected smallint[] := ARRAY[
    2,0,1,3,4,0,0,5,3,5,5,5,5,0,1,1,2,5,0,3,0,4,3,4,5,4,1,3,
    0,5,3,0,1,5,4,4,4,1,0,4,4,1,2,0,2,1,5,5,4
  ]::smallint[];
  v_dead smallint[] := ARRAY[
    0,2,4,0,2,4,0,1,3,5,1,3,5,1,2,4,0,2,4,0,2,3,5,1,3,5,1,3,
    4,0,2,4,0,2,4,5,1,3,5,1,3,5,0,2,4,0,2,4,0
  ]::smallint[];
  v_reshuffle_expected smallint[] := ARRAY[
    4,2,0,0,1,4,1,2,0,4,4,5,3,5,2,1,3,3,5,1,0,3,5,1,3,5,2,0,
    0,1,2,0,4,2,0,5,2,5,0,4,2,3,3,2,0,4,4,4,1
  ]::smallint[];
  v_result jsonb;
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_generate_initial_board(bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_refill_board(smallint[],integer[],bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_reshuffle_dead_board(smallint[],bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_board_metrics(smallint[])') IS NULL THEN
    RAISE EXCEPTION '[TEST STARLINK 04] deterministic board helper is missing.';
  END IF;

  v_result:=public.arcade_starlink_04_generate_initial_board(5);
  IF (v_result->>'attempts')::integer<>3
     OR (v_result->>'rngState')::bigint<>3052492330
     OR v_result->'board'<>to_jsonb(v_initial_expected) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] initial golden mismatch: %',v_result;
  END IF;

  v_result:=public.arcade_starlink_04_refill_board(
    v_initial_expected,
    ARRAY[23,24,28,29,31,32,39],
    3052492330
  );
  IF (v_result->>'rngState')::bigint<>1892184262
     OR v_result->'board'<>to_jsonb(v_refill_expected) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] refill golden mismatch: %',v_result;
  END IF;

  IF (public.arcade_starlink_04_board_metrics(v_dead)->>'playable')::boolean THEN
    RAISE EXCEPTION '[TEST STARLINK 04] dead fixture is unexpectedly playable.';
  END IF;

  v_result:=public.arcade_starlink_04_reshuffle_dead_board(v_dead,4863);
  IF (v_result->>'attempts')::integer<>2
     OR (v_result->>'rngState')::bigint<>359457395
     OR v_result->'board'<>to_jsonb(v_reshuffle_expected) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] reshuffle golden mismatch: %',v_result;
  END IF;

  IF has_function_privilege('authenticated','public.arcade_starlink_04_generate_initial_board(bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_starlink_04_refill_board(smallint[],integer[],bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_starlink_04_reshuffle_dead_board(smallint[],bigint)','EXECUTE') THEN
    RAISE EXCEPTION '[TEST STARLINK 04] browser role can execute internal deterministic helpers.';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_game_rule_versions rv
    JOIN public.arcade_games g ON g.id=rv.game_id
    WHERE g.code='starlink_04'
      AND rv.version_code='starlink_04_v0.3'
      AND (
        (rv.config->>'loopMinUniqueCount')::integer<>4
        OR (rv.config->>'initialGenerationAttempts')::integer<>64
        OR (rv.config->>'reshuffleAttempts')::integer<>64
        OR rv.config->'fallbackTargetCells'<>jsonb_build_array(23,24,25)
      )
  ) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] v0.3 rule config diverged from deterministic contract.';
  END IF;

  RAISE NOTICE '[TEST STARLINK 04] deterministic board golden fixture passed.';
END;
$test$;
