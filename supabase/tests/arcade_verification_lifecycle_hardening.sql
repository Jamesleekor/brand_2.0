-- B.R.A.N.D 2.0 — Arcade STEP 2-B lifecycle postcheck
-- Run after 20261011_01 and 20261011_02.

DO $test$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.arcade_resolve_or_pin_rule_version(integer,bigint)') IS NULL
     OR to_regprocedure('public.arcade_prepare_verification_seed_pack(bigint)') IS NULL
     OR to_regprocedure('public.arcade_expire_stale_verification_runs(integer,integer,bigint)') IS NULL
     OR to_regprocedure('public.student_abandon_arcade_run(bigint)') IS NULL
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] lifecycle helper/RPC is missing.';
  END IF;

  SELECT pg_get_functiondef('public.student_begin_arcade_run(bigint)'::regprocedure)
  INTO v_def;

  IF position('VERIFICATION_ATTEMPT_CONSUMED_ON_PLAY' in v_def)=0
     OR position('consumed=true' in replace(v_def,' ',''))=0
     OR position('seed_pack_status=''LOCKED''' in replace(v_def,' ',''))=0
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] begin-run hardening is not installed.';
  END IF;

  SELECT pg_get_functiondef('public.student_create_arcade_verification_run(bigint,uuid)'::regprocedure)
  INTO v_def;

  IF position('PERIOD_PACK_PERMUTED' in v_def)=0
     OR position('schedule_seed' in v_def)=0
     OR position('v_seed_visible' in v_def)=0
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] verification seed-hiding logic is missing.';
  END IF;

  SELECT pg_get_functiondef('public.student_abandon_arcade_run(bigint)'::regprocedure)
  INTO v_def;

  IF position('VERIFICATION_ABANDONED_AFTER_START' in v_def)=0
     OR position('PREPLAY_CANCELLED' in v_def)=0
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] abandon boundary logic is missing.';
  END IF;

  SELECT pg_get_functiondef('public.teacher_freeze_arcade_monthly_period(bigint)'::regprocedure)
  INTO v_def;

  IF position('arcade_prepare_verification_seed_pack' in v_def)=0
     OR position('rule_version_id=pg.rule_version_id' in replace(v_def,' ',''))=0
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] freeze pin/seed-pack integration is missing.';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.arcade_resolve_or_pin_rule_version(integer,bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.arcade_prepare_verification_seed_pack(bigint)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.arcade_expire_stale_verification_runs(integer,integer,bigint)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] internal lifecycle helper is browser-executable.';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.student_abandon_arcade_run(bigint)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] student abandon RPC is not executable.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_game_configs c
    JOIN public.arcade_games g ON g.id=c.game_id
    WHERE g.code IN ('focus_reaction_01','pure_reaction_02')
      AND c.seed_strategy<>'RANDOM_PER_ATTEMPT'
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2B] existing GAME 1/2 seed strategy changed unexpectedly.';
  END IF;

  RAISE NOTICE '[TEST ARCADE STARLINK 2B] lifecycle assertions passed.';
END;
$test$;
