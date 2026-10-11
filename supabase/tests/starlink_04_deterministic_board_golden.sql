-- B.R.A.N.D 2.0 — Starlink #04 FINAL v0.3 deterministic board postcheck

DO $test$
DECLARE
  v_streams jsonb;
  v_initial_expected smallint[]:=ARRAY[
    2,4,2,2,3,1,0,1,2,1,2,5,0,1,5,5,2,4,5,5,1,1,4,1,0,4,0,4,
    0,4,4,1,1,2,3,5,4,0,4,5,4,2,0,0,2,3,1,5,5
  ]::smallint[];
  v_refill_expected smallint[]:=ARRAY[
    5,5,4,2,3,1,0,1,4,1,2,5,0,1,5,5,2,4,5,5,1,1,4,1,0,4,0,4,
    0,4,4,1,1,2,3,5,4,0,4,5,4,2,0,0,2,3,1,5,5
  ]::smallint[];
  v_dead smallint[]:=ARRAY[
    0,2,4,0,2,4,0,1,3,5,1,3,5,1,2,4,0,2,4,0,2,3,5,1,3,5,1,3,
    4,0,2,4,0,2,4,5,1,3,5,1,3,5,0,2,4,0,2,4,0
  ]::smallint[];
  v_reshuffle_expected smallint[]:=ARRAY[
    4,3,4,4,2,2,4,1,1,5,3,4,0,1,2,2,3,5,4,2,4,5,4,0,1,0,3,1,
    3,0,0,1,4,2,2,0,3,1,2,0,5,3,0,5,2,0,5,0,5
  ]::smallint[];
  v_result jsonb;
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_derive_seed32(bigint,bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_generate_initial_board(bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_refill_board(smallint[],integer[],bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_reshuffle_dead_board(smallint[],bigint)') IS NULL THEN
    RAISE EXCEPTION '[TEST STARLINK 04] deterministic board helper missing.';
  END IF;

  v_streams:=public.arcade_starlink_04_rng_streams(6059);
  IF v_streams<>jsonb_build_object('initial',2717272021,'refill',150626425,'reshuffle',3968834942) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] derived stream mismatch: %',v_streams;
  END IF;

  v_result:=public.arcade_starlink_04_generate_initial_board(6059);
  IF (v_result->>'attempts')::integer<>2
     OR (v_result->>'rngState')::bigint<>3695321621
     OR v_result->'board'<>to_jsonb(v_initial_expected) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] initial mismatch: %',v_result;
  END IF;

  v_result:=public.arcade_starlink_04_refill_board(v_initial_expected,ARRAY[0,8,2],150626425);
  IF (v_result->>'rngState')::bigint<>3117114772
     OR v_result->'board'<>to_jsonb(v_refill_expected) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] refill mismatch: %',v_result;
  END IF;

  v_result:=public.arcade_starlink_04_reshuffle_dead_board(v_dead,3968834942);
  IF (v_result->>'attempts')::integer<>2
     OR (v_result->>'rngState')::bigint<>2063970340
     OR v_result->'board'<>to_jsonb(v_reshuffle_expected) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] reshuffle mismatch: %',v_result;
  END IF;

  IF has_function_privilege('authenticated','public.arcade_starlink_04_generate_initial_board(bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_starlink_04_rng_streams(bigint)','EXECUTE') THEN
    RAISE EXCEPTION '[TEST STARLINK 04] internal RNG helpers exposed to browser role.';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_game_rule_versions rv
    JOIN public.arcade_games g ON g.id=rv.game_id
    WHERE g.code='starlink_04'
      AND rv.version_code='starlink_04_v0.3'
      AND (
        (rv.config->>'loopMinUniqueCount')::integer<>5
        OR (rv.config->>'loopMinTwiceArea')::integer<>2
        OR (rv.config->>'rngInitialDomain')::bigint<>2738958700
        OR (rv.config->>'rngRefillDomain')::bigint<>3355524772
        OR (rv.config->>'rngReshuffleDomain')::bigint<>2911926141
        OR (rv.config->>'rngZeroFallback')::bigint<>1831565813
      )
  ) THEN
    RAISE EXCEPTION '[TEST STARLINK 04] v0.3 rule config diverged.';
  END IF;

  RAISE NOTICE '[TEST STARLINK 04] final v0.3 board fixture passed.';
END;
$test$;
