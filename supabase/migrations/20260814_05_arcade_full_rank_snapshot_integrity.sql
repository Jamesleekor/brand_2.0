-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade FINALIZED full-rank snapshot + integrity guard
-- 2026-08-14
--
-- Incremental production migration
--   * 20260814_01 ~ 20260814_04 are already applied.
--   * Existing Top 10 entries remain the only source of Arcade rank bonuses.
--   * Adds a separate immutable per-student rank snapshot for FINALIZED months.
--   * Does not backfill or rewrite history. It intentionally stops if a monthly
--     finalization already exists, because historical reconstruction is not
--     authorized in this migration.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_monthly_finalizations') IS NULL
     OR to_regclass('public.arcade_monthly_snapshots') IS NULL
     OR to_regclass('public.arcade_monthly_snapshot_entries') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_top10(integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)') IS NULL
     OR to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL
     OR to_regprocedure('public.arcade_block_immutable_history_mutation()') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~04 migrations must be applied first.';
  END IF;
END $$;

-- Prevent a concurrent finalization from slipping between the no-history check
-- and this migration's replacement of the finalization function.
LOCK TABLE public.arcade_monthly_finalizations IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.arcade_monthly_snapshot_student_ranks') IS NOT NULL THEN
    RAISE EXCEPTION '[ARCADE] full-rank snapshot table already exists; do not rerun this incremental migration.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.arcade_monthly_finalizations) THEN
    RAISE EXCEPTION '[ARCADE] existing monthly finalizations require an explicit historical correction plan; this migration does not backfill or rewrite them.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Immutable full-rank evidence for every participant in each game snapshot.
--    This table deliberately has no raw_bonus field.
-- -----------------------------------------------------------------------------
CREATE TABLE public.arcade_monthly_snapshot_student_ranks (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES public.arcade_monthly_snapshots(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  source_run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  rank integer NOT NULL,
  official_score bigint NOT NULL,
  achieved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_monthly_snapshot_student_ranks_student_unique UNIQUE (snapshot_id, student_id),
  CONSTRAINT arcade_monthly_snapshot_student_ranks_rank_unique UNIQUE (snapshot_id, rank),
  CONSTRAINT arcade_monthly_snapshot_student_ranks_source_run_unique UNIQUE (snapshot_id, source_run_id),
  CONSTRAINT arcade_monthly_snapshot_student_ranks_rank_check CHECK (rank >= 1),
  CONSTRAINT arcade_monthly_snapshot_student_ranks_score_check CHECK (official_score >= 0)
);

CREATE INDEX ix_arcade_monthly_snapshot_student_ranks_student
  ON public.arcade_monthly_snapshot_student_ranks(student_id, achieved_at DESC);

COMMENT ON TABLE public.arcade_monthly_snapshot_student_ranks IS
  'Immutable final best-run rank for every participating student in a monthly game snapshot. It provides FINALIZED my_rank/my_score outside public Top 10 and is not a Guild 2 bonus source.';

CREATE TRIGGER arcade_monthly_snapshot_student_ranks_immutable
  BEFORE UPDATE OR DELETE ON public.arcade_monthly_snapshot_student_ranks
  FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();

ALTER TABLE public.arcade_monthly_snapshot_student_ranks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.arcade_monthly_snapshot_student_ranks FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Internal deterministic all-student rank resolver. The best run and global
--    tie order exactly match arcade_resolve_period_top10(), without rank <= 10.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_student_ranks(
  p_classroom_id integer,
  p_period_id bigint,
  p_game_id bigint
)
RETURNS TABLE(
  source_run_id bigint,
  student_id integer,
  official_score bigint,
  achieved_at timestamptz,
  rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH period_scope AS (
    SELECT period.id, period.starts_at, period.ends_at_exclusive
    FROM public.arcade_ranking_periods period
    WHERE period.id = p_period_id
      AND period.classroom_id = p_classroom_id
      AND period.period_kind = 'MONTHLY'
  ), candidate_runs AS (
    SELECT run.id AS source_run_id,
           run.student_id,
           run.official_score,
           run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS student_best_row
    FROM public.arcade_runs run
    JOIN period_scope period ON run.game_over_at >= period.starts_at
                           AND run.game_over_at < period.ends_at_exclusive
    WHERE run.classroom_id = p_classroom_id
      AND run.game_id = p_game_id
      AND run.status = 'VERIFIED'
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id
          AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.source_run_id,
           candidate.student_id,
           candidate.official_score,
           candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.source_run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.student_best_row = 1
  )
  SELECT ranked.source_run_id,
         ranked.student_id,
         ranked.official_score,
         ranked.game_over_at AS achieved_at,
         ranked.rank::integer
  FROM ranked
  ORDER BY ranked.rank;
$$;

-- -----------------------------------------------------------------------------
-- 3. The existing atomic finalization now writes both immutable evidence sets:
--    (a) Top 10 with bonuses, unchanged; (b) all participant ranks, no bonus.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_finalize_arcade_monthly_snapshot(
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
  v_finalization public.arcade_monthly_finalizations%ROWTYPE;
  v_game record;
  v_snapshot public.arcade_monthly_snapshots%ROWTYPE;
  v_eligible_game_count integer := 0;
  v_snapshot_count integer := 0;
  v_full_rank_count integer := 0;
  v_refresh_result jsonb;
  v_period_start_date date;
  v_period_end_date date;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] monthly ranking period not found in this classroom.' USING ERRCODE = 'P0214';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' OR v_period.contribution_year_month IS NULL THEN
    RAISE EXCEPTION '[ARCADE] only a monthly period can update Guild 2 Arcade contribution.' USING ERRCODE = 'P0215';
  END IF;
  IF v_period.status = 'FINALIZED' OR EXISTS (
    SELECT 1 FROM public.arcade_monthly_finalizations finalization WHERE finalization.period_id = v_period.id
  ) THEN
    RAISE EXCEPTION '[ARCADE] this monthly period is already finalized and immutable.' USING ERRCODE = 'P0216';
  END IF;
  IF v_period.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE] activate the monthly period before finalization.' USING ERRCODE = 'P0217';
  END IF;
  IF v_period.ends_at_exclusive > clock_timestamp() THEN
    RAISE EXCEPTION '[ARCADE] this monthly period has not ended yet.' USING ERRCODE = 'P0218';
  END IF;

  PERFORM pg_advisory_xact_lock(v_classroom_id, replace(v_period.contribution_year_month, '-', '')::integer);
  v_period_start_date := (v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date;
  v_period_end_date := ((v_period.ends_at_exclusive AT TIME ZONE 'Asia/Seoul')::date - 1);

  SELECT count(*) INTO v_eligible_game_count
  FROM public.arcade_games game
  WHERE game.available_from <= v_period_end_date
    AND (game.available_until IS NULL OR game.available_until >= v_period_start_date);

  INSERT INTO public.arcade_monthly_finalizations (
    classroom_id, period_id, contribution_year_month, eligible_game_count
  ) VALUES (
    v_classroom_id, v_period.id, v_period.contribution_year_month, v_eligible_game_count
  )
  RETURNING * INTO v_finalization;

  FOR v_game IN
    SELECT game.id, game.code
    FROM public.arcade_games game
    WHERE game.available_from <= v_period_end_date
      AND (game.available_until IS NULL OR game.available_until >= v_period_start_date)
    ORDER BY game.id
  LOOP
    INSERT INTO public.arcade_monthly_snapshots (
      finalization_id, classroom_id, period_id, game_id, contribution_year_month
    ) VALUES (
      v_finalization.id, v_classroom_id, v_period.id, v_game.id, v_period.contribution_year_month
    )
    RETURNING * INTO v_snapshot;

    -- Existing public Top 10 proof and fixed bonus values: unchanged.
    INSERT INTO public.arcade_monthly_snapshot_entries (
      snapshot_id, student_id, source_run_id, rank, official_score, achieved_at, raw_bonus
    )
    SELECT v_snapshot.id, top10.student_id, top10.source_run_id, top10.rank,
           top10.official_score, top10.achieved_at, top10.raw_bonus
    FROM public.arcade_resolve_period_top10(v_classroom_id, v_period.id, v_game.id) top10;

    -- Separate private proof for every participant. It contains no bonus and
    -- is never read by the Guild 2 +90 adapter.
    INSERT INTO public.arcade_monthly_snapshot_student_ranks (
      snapshot_id, student_id, source_run_id, rank, official_score, achieved_at
    )
    SELECT v_snapshot.id, rank_row.student_id, rank_row.source_run_id, rank_row.rank,
           rank_row.official_score, rank_row.achieved_at
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id, v_period.id, v_game.id) rank_row;
  END LOOP;

  SELECT count(*) INTO v_snapshot_count
  FROM public.arcade_monthly_snapshots snapshot
  WHERE snapshot.finalization_id = v_finalization.id;
  IF v_snapshot_count <> v_eligible_game_count THEN
    RAISE EXCEPTION '[ARCADE] incomplete monthly snapshot set; transaction was not finalized.' USING ERRCODE = 'P0219';
  END IF;

  SELECT count(*) INTO v_full_rank_count
  FROM public.arcade_monthly_snapshot_student_ranks rank_row
  JOIN public.arcade_monthly_snapshots snapshot ON snapshot.id = rank_row.snapshot_id
  WHERE snapshot.finalization_id = v_finalization.id;

  -- Any error below rolls back the finalization parent, both snapshot sets,
  -- Guild 2 cache/ledger changes, and the FINALIZED status together.
  v_refresh_result := public.guild2_refresh_monthly_scores(
    v_classroom_id, v_period.contribution_year_month
  );

  UPDATE public.arcade_ranking_periods
  SET status = 'FINALIZED'
  WHERE id = v_period.id;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'finalization_id', v_finalization.id,
    'eligible_game_count', v_eligible_game_count,
    'snapshot_count', v_snapshot_count,
    'full_rank_count', v_full_rank_count,
    'guild2_refresh', v_refresh_result,
    'status', 'FINALIZED'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. FINALIZED monthly leaderboard: public Top 10 remains the bonus snapshot;
--    only the signed-in student's own rank and score come from the new full
--    rank snapshot. Missing a required snapshot is a data-integrity failure,
--    never an apparently valid empty leaderboard.
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

    IF v_snapshot_id IS NULL THEN
      RAISE EXCEPTION '[ARCADE] finalized monthly snapshot is missing for this period/game; data integrity error.'
        USING ERRCODE = 'P0220';
    END IF;

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
        SELECT rank_row.rank
        FROM public.arcade_monthly_snapshot_student_ranks rank_row
        WHERE rank_row.snapshot_id = v_snapshot_id
          AND rank_row.student_id = v_student_id
      ),
      'my_score', (
        SELECT rank_row.official_score
        FROM public.arcade_monthly_snapshot_student_ranks rank_row
        WHERE rank_row.snapshot_id = v_snapshot_id
          AND rank_row.student_id = v_student_id
      )
    ) INTO v_result;

    RETURN v_result;
  END IF;

  -- ACTIVE monthly periods and season periods remain live leaderboards. One
  -- student contributes only the single best verified run in the period.
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

-- -----------------------------------------------------------------------------
-- 5. ACL. The new table and resolver are internal. Browsers receive only their
--    own rank through the existing leaderboard RPC.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.arcade_resolve_period_student_ranks(integer, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_finalize_arcade_monthly_snapshot(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_arcade_monthly_snapshot(bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text, bigint) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT count(*) AS historical_finalization_count,
       (count(*) = 0) AS no_historical_backfill_required
FROM public.arcade_monthly_finalizations;

SELECT c.relname AS relation_name,
       c.relrowsecurity AS rls_enabled,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select_directly,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'arcade_monthly_snapshot_student_ranks';

SELECT conname AS constraint_name,
       pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE conrelid = 'public.arcade_monthly_snapshot_student_ranks'::regclass
ORDER BY conname;

SELECT trigger.tgname AS trigger_name,
       pg_get_triggerdef(trigger.oid, true) AS definition
FROM pg_trigger trigger
JOIN pg_class relation ON relation.oid = trigger.tgrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname = 'arcade_monthly_snapshot_student_ranks'
  AND NOT trigger.tgisinternal;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'arcade_resolve_period_student_ranks',
    'teacher_finalize_arcade_monthly_snapshot',
    'get_arcade_leaderboard'
  )
ORDER BY function_name, identity_arguments;

SELECT pg_get_functiondef('public.teacher_finalize_arcade_monthly_snapshot(bigint)'::regprocedure)
         ILIKE '%arcade_monthly_snapshot_student_ranks%' AS finalization_writes_full_rank_snapshot,
       pg_get_functiondef('public.get_arcade_leaderboard(text,bigint)'::regprocedure)
         ILIKE '%arcade_monthly_snapshot_student_ranks%' AS finalized_leaderboard_reads_full_rank_snapshot,
       pg_get_functiondef('public.get_arcade_leaderboard(text,bigint)'::regprocedure)
         ILIKE '%IF v_snapshot_id IS NULL%' AS finalized_missing_snapshot_raises_integrity_error;
