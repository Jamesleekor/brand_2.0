-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade teacher immediate ranking-period end
-- 2026-08-16
--
-- Adds a teacher-only server-clock action that ends an ACTIVE ranking period
-- immediately without finalizing it. Monthly finalization remains a separate,
-- explicit action and still creates the immutable snapshot + Guild2 adapter.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE-END-NOW] Arcade foundation/finalization dependencies are missing.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_end_arcade_ranking_period_now(
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE = 'P0188';
  END IF;

  IF v_period.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE] finalized period is immutable.' USING ERRCODE = 'P0216';
  END IF;

  IF v_period.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE] activate the ranking period before ending it.' USING ERRCODE = 'P0217';
  END IF;

  IF v_period.starts_at >= v_now THEN
    RAISE EXCEPTION '[ARCADE] ranking period has not started yet.' USING ERRCODE = 'P0225';
  END IF;

  -- Idempotent: an already-ended ACTIVE period stays untouched.
  IF v_period.ends_at_exclusive <= v_now THEN
    RETURN jsonb_build_object(
      'period_id', v_period.id,
      'classroom_id', v_period.classroom_id,
      'status', v_period.status,
      'ended_at', v_period.ends_at_exclusive,
      'already_ended', true
    );
  END IF;

  UPDATE public.arcade_ranking_periods
  SET ends_at_exclusive = v_now
  WHERE id = v_period.id
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'classroom_id', v_period.classroom_id,
    'status', v_period.status,
    'ended_at', v_period.ends_at_exclusive,
    'already_ended', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_end_arcade_ranking_period_now(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_end_arcade_ranking_period_now(bigint) TO authenticated;

COMMIT;
