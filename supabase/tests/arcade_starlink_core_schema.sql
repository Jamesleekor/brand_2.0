-- B.R.A.N.D 2.0 — Arcade / Starlink STEP 2-A schema postcheck
-- Safe read-only assertions. Run after 20261011_01_arcade_starlink_core_schema.sql.

DO $test$
DECLARE
  v_missing integer;
  v_duplicates integer;
BEGIN
  IF to_regclass('public.arcade_period_game_rule_pins') IS NULL
     OR to_regclass('public.arcade_verification_seed_pack_slots') IS NULL
     OR to_regclass('public.arcade_verification_seed_assignments') IS NULL
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] required tables are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='arcade_runs'
      AND column_name='run_nonce' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] arcade_runs.run_nonce is missing/not NOT NULL.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='arcade_verification_attempts'
      AND column_name='consumed_at'
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] consumed_at is missing.';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.arcade_runs
  WHERE run_nonce IS NULL;
  IF v_missing <> 0 THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] % run(s) have NULL run_nonce.', v_missing;
  END IF;

  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT run_nonce
    FROM public.arcade_runs
    GROUP BY run_nonce
    HAVING count(*) > 1
  ) d;
  IF v_duplicates <> 0 THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] duplicate run_nonce values exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_game_configs
    WHERE seed_strategy NOT IN ('RANDOM_PER_ATTEMPT','PERIOD_PACK_PERMUTED')
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] invalid game seed_strategy.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_period_games
    WHERE seed_strategy='RANDOM_PER_ATTEMPT'
      AND (
        seed_pack_status <> 'NONE'
        OR seed_pack_locked_at IS NOT NULL
        OR seed_pack_locked_by_run_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] random strategy period-game has seed-pack metadata.';
  END IF;

  IF has_table_privilege('authenticated','public.arcade_period_game_rule_pins','SELECT')
     OR has_table_privilege('authenticated','public.arcade_verification_seed_pack_slots','SELECT')
     OR has_table_privilege('authenticated','public.arcade_verification_seed_assignments','SELECT')
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] authenticated role can directly read internal seed tables.';
  END IF;

  IF has_table_privilege('anon','public.arcade_period_game_rule_pins','SELECT')
     OR has_table_privilege('anon','public.arcade_verification_seed_pack_slots','SELECT')
     OR has_table_privilege('anon','public.arcade_verification_seed_assignments','SELECT')
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] anon role can directly read internal seed tables.';
  END IF;

  IF has_function_privilege('authenticated','public.arcade_validate_verification_period_game_rule()','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_validate_period_game_rule_pin()','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_guard_verification_seed_slot_write()','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_guard_locked_verification_pack_header()','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_validate_verification_seed_assignment()','EXECUTE')
  THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] authenticated role can execute internal guard helpers.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN (
        'arcade_period_game_rule_pins',
        'arcade_verification_seed_pack_slots',
        'arcade_verification_seed_assignments'
      )
      AND c.relrowsecurity
    GROUP BY n.nspname
    HAVING count(*)=3
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] RLS is not enabled on every new internal table.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='arcade_runs'
      AND indexname='ux_arcade_runs_run_nonce'
  ) THEN
    RAISE EXCEPTION '[TEST ARCADE STARLINK 2A] run_nonce unique index is missing.';
  END IF;

  RAISE NOTICE '[TEST ARCADE STARLINK 2A] schema assertions passed.';
END;
$test$;

SELECT
  (SELECT count(*) FROM public.arcade_runs) AS arcade_run_count,
  (SELECT count(*) FROM public.arcade_period_game_rule_pins) AS rule_pin_count,
  (SELECT count(*) FROM public.arcade_verification_seed_pack_slots) AS seed_slot_count,
  (SELECT count(*) FROM public.arcade_verification_seed_assignments) AS seed_assignment_count;
