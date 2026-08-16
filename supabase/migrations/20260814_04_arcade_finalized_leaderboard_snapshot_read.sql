-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade finalized leaderboard snapshot read
-- 2026-08-14
--
-- Production basis
--   * 20260814_01 ~ 20260814_03 are applied before this migration.
--   * This migration reads the existing immutable monthly Top 10 snapshot.
--   * It does not alter Guild 2 bonus calculation or snapshot history.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_monthly_snapshots') IS NULL
     OR to_regclass('public.arcade_monthly_snapshot_entries') IS NULL
     OR to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~03 migrations must be applied first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- FINALIZED monthly leaderboard reads the immutable Top 10 snapshot. ACTIVE
-- monthly and SEASON leaderboards continue to calculate from verified runs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(
  p_game_code text,
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_snapshot_id bigint;
  v_result jsonb;
BEGIN
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE = 'P0204';
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND OR v_period.status NOT IN ('ACTIVE', 'FINALIZED') THEN
    RAISE EXCEPTION '[ARCADE] active or finalized ranking period was not found.' USING ERRCODE = 'P0205';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status = 'FINALIZED' THEN
    SELECT snapshot.id INTO v_snapshot_id
    FROM public.arcade_monthly_snapshots snapshot
    WHERE snapshot.period_id = v_period.id
      AND snapshot.game_id = v_game_id;

    SELECT jsonb_build_object(
      'period_id', v_period.id,
      'period_kind', v_period.period_kind,
      'game_code', p_game_code,
      'top10', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank', entry.rank,
            'student_id', entry.student_id,
            'student_name', student.name,
            'official_score', entry.official_score,
            'game_over_at', entry.achieved_at
          ) ORDER BY entry.rank
        )
        FROM public.arcade_monthly_snapshot_entries entry
        JOIN public.students student ON student.id = entry.student_id
        WHERE entry.snapshot_id = v_snapshot_id
      ), '[]'::jsonb),
      'my_rank', (
        SELECT entry.rank
        FROM public.arcade_monthly_snapshot_entries entry
        WHERE entry.snapshot_id = v_snapshot_id
          AND entry.student_id = v_student_id
      ),
      'my_score', (
        SELECT entry.official_score
        FROM public.arcade_monthly_snapshot_entries entry
        WHERE entry.snapshot_id = v_snapshot_id
          AND entry.student_id = v_student_id
      )
    ) INTO v_result;

    RETURN v_result;
  END IF;

  WITH candidate_runs AS (
    SELECT run.id AS run_id, run.student_id, run.official_score, run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS best_row
    FROM public.arcade_runs run
    WHERE run.classroom_id = v_classroom_id
      AND run.game_id = v_game_id
      AND run.status = 'VERIFIED'
      AND run.game_over_at >= v_period.starts_at
      AND run.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.run_id, candidate.student_id, candidate.official_score, candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.best_row = 1
  )
  SELECT jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank', ranked.rank,
          'student_id', ranked.student_id,
          'student_name', student.name,
          'official_score', ranked.official_score,
          'game_over_at', ranked.game_over_at
        ) ORDER BY ranked.rank
      ) FILTER (WHERE ranked.rank <= 10),
      '[]'::jsonb
    ),
    'my_rank', max(ranked.rank) FILTER (WHERE ranked.student_id = v_student_id),
    'my_score', max(ranked.official_score) FILTER (WHERE ranked.student_id = v_student_id)
  ) INTO v_result
  FROM ranked
  JOIN public.students student ON student.id = ranked.student_id;

  RETURN coalesce(v_result, jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', '[]'::jsonb,
    'my_rank', NULL,
    'my_score', NULL
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text, bigint) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_arcade_leaderboard'
ORDER BY identity_arguments;

SELECT pg_get_functiondef('public.get_arcade_leaderboard(text,bigint)'::regprocedure)
         ILIKE '%arcade_monthly_snapshot_entries%' AS finalized_leaderboard_reads_top10_snapshot;
