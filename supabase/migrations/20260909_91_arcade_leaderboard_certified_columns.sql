-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade leaderboard: general-play vs certified record columns
-- 2026-09-09
--
-- UI contract:
--   * official_score      = the score currently used to rank the row
--   * general_score       = the student's best STANDARD-play score frozen for
--                           the month (or official_score for ACTIVE/SEASON)
--   * certified_score     = the verification result selected as the official
--                           reward record; NULL before certification
--   * certification_status = NONE | PENDING | CERTIFIED | FAILED
--
-- No ranking/finalization/Guild 2 scoring rule is changed by this migration.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)') IS NULL
     OR to_regclass('public.arcade_verification_provisional_entries') IS NULL
     OR to_regclass('public.arcade_verification_official_results') IS NULL THEN
    RAISE EXCEPTION '[ARCADE LEADERBOARD] verification baseline is missing; apply the verification migrations first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(p_game_code text,p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_result jsonb;
BEGIN
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE='P0204';
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id AND classroom_id=v_classroom_id;

  IF NOT FOUND OR v_period.status NOT IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED') THEN
    RAISE EXCEPTION '[ARCADE] ranking period was not found or is not visible.' USING ERRCODE='P0205';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206';
  END IF;

  WITH ranks AS (
    SELECT *
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id)
  ), decorated AS (
    SELECT
      r.rank,
      r.student_id,
      s.name AS student_name,
      r.official_score,
      r.achieved_at AS game_over_at,
      CASE
        WHEN v_period.period_kind='MONTHLY'
         AND v_period.status IN ('VERIFICATION','READY_TO_FINALIZE','FINALIZED')
         AND p.id IS NOT NULL
          THEN p.official_score
        ELSE r.official_score
      END AS general_score,
      CASE
        WHEN o.id IS NOT NULL AND o.ranking_eligible THEN o.official_score
        ELSE NULL
      END AS certified_score,
      CASE
        WHEN p.id IS NULL THEN 'NONE'
        WHEN o.id IS NULL THEN 'PENDING'
        WHEN o.ranking_eligible THEN 'CERTIFIED'
        ELSE 'FAILED'
      END AS certification_status
    FROM ranks r
    JOIN public.students s ON s.id=r.student_id
    LEFT JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=v_game_id
     AND p.student_id=r.student_id
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id=v_period.id
     AND o.game_id=v_game_id
     AND o.student_id=r.student_id
  )
  SELECT jsonb_build_object(
    'period_id',v_period.id,
    'period_kind',v_period.period_kind,
    'game_code',p_game_code,
    'top10',coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',d.rank,
          'student_id',d.student_id,
          'student_name',d.student_name,
          'official_score',d.official_score,
          'general_score',d.general_score,
          'certified_score',d.certified_score,
          'certification_status',d.certification_status,
          'game_over_at',d.game_over_at
        ) ORDER BY d.rank
      ) FILTER (WHERE d.rank<=10),
      '[]'::jsonb
    ),
    'my_rank',max(d.rank) FILTER (WHERE d.student_id=v_student_id),
    'my_score',max(d.official_score) FILTER (WHERE d.student_id=v_student_id)
  ) INTO v_result
  FROM decorated d;

  RETURN coalesce(
    v_result,
    jsonb_build_object(
      'period_id',v_period.id,
      'period_kind',v_period.period_kind,
      'game_code',p_game_code,
      'top10','[]'::jsonb,
      'my_rank',NULL,
      'my_score',NULL
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text,bigint) TO authenticated;

COMMIT;
