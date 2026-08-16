-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade isolated pre-release test leaderboard
-- 2026-08-14
--
-- Lets the teacher verify Game #01's student-best-score ranking rule before
-- public release. Test runs remain permanently excluded from the public Top 10,
-- monthly finalization snapshots, and Guild 2 bonuses.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_run_moderation_events') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~07 migrations must be applied first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'arcade_runs'
      AND column_name = 'is_prerelease_test'
      AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION '[ARCADE] Arcade 06 pre-release test run classification is required.';
  END IF;
END $$;

-- This is deliberately teacher-only. It uses the same one-student/one-best-run
-- and tie-break order as the public leaderboard, but reads ONLY test rows.
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(
  p_period_id bigint,
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
    AND classroom_id = v_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] ranking period was not found in this classroom.' USING ERRCODE = 'P0205';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  WITH candidate_runs AS (
    SELECT run.id AS run_id,
           run.student_id,
           run.official_score,
           run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS best_row
    FROM public.arcade_runs run
    WHERE run.classroom_id = v_classroom_id
      AND run.game_id = v_game_id
      AND run.status = 'VERIFIED'
      AND run.is_prerelease_test
      AND run.game_over_at >= v_period.starts_at
      AND run.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id
          AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.run_id,
           candidate.student_id,
           candidate.official_score,
           candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.best_row = 1
  )
  SELECT jsonb_build_object(
    'period_id', v_period.id,
    'game_code', p_game_code,
    'participant_count', count(*),
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
    )
  ) INTO v_result
  FROM ranked
  JOIN public.students student ON student.id = ranked.student_id;

  RETURN coalesce(v_result, jsonb_build_object(
    'period_id', v_period.id,
    'game_code', p_game_code,
    'participant_count', 0,
    'top10', '[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(bigint, text) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no teacher/JWT RPC call)
-- =============================================================================
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.oid = 'public.teacher_get_arcade_prerelease_test_leaderboard(bigint,text)'::regprocedure;

SELECT pg_get_functiondef('public.teacher_get_arcade_prerelease_test_leaderboard(bigint,text)'::regprocedure)
         ILIKE '%run.is_prerelease_test%' AS reads_only_prerelease_test_runs,
       pg_get_functiondef('public.teacher_get_arcade_prerelease_test_leaderboard(bigint,text)'::regprocedure)
         ILIKE '%PARTITION BY run.student_id%' AS one_best_run_per_student,
       pg_get_functiondef('public.teacher_get_arcade_prerelease_test_leaderboard(bigint,text)'::regprocedure)
         ILIKE '%ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.run_id ASC%' AS uses_official_tie_break_order;
