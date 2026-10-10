-- B.R.A.N.D 2.0 — Arcade STEP 2-C force-finalize postcheck
-- Safe structural checks. Does NOT finalize a real period.

DO $test$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.teacher_get_arcade_force_finalize_preview(bigint)') IS NULL
     OR to_regprocedure('public.teacher_force_finalize_arcade_period(bigint,text)') IS NULL
  THEN
    RAISE EXCEPTION '[TEST ARCADE FORCE FINALIZE] RPC is missing.';
  END IF;

  SELECT pg_get_functiondef(
    'public.teacher_force_finalize_arcade_period(bigint,text)'::regprocedure
  )
  INTO v_def;

  IF position('teacher_force_close_arcade_game_verification' in v_def)=0
     OR position('tikatuka_official_sessions' in v_def)=0
     OR position('teacher_finalize_arcade_monthly_snapshot' in v_def)=0
     OR position('READY_TO_FINALIZE' in v_def)=0
  THEN
    RAISE EXCEPTION '[TEST ARCADE FORCE FINALIZE] atomic close/finalize path is incomplete.';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.teacher_get_arcade_force_finalize_preview(bigint)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.teacher_force_finalize_arcade_period(bigint,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION '[TEST ARCADE FORCE FINALIZE] teacher RPC grants are missing.';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.teacher_force_finalize_arcade_period(bigint,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.teacher_get_arcade_force_finalize_preview(bigint)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION '[TEST ARCADE FORCE FINALIZE] anon can execute teacher RPC.';
  END IF;

  RAISE NOTICE '[TEST ARCADE FORCE FINALIZE] structural assertions passed.';
END;
$test$;
