-- Rakaruka #03 monthly Guild 2 bonus integration.
-- The bonus source is the period-scoped OFFICIAL five-match ranking, not the general clear-level ranking.
-- Rank semantics intentionally match tikatuka_competition_payload_v3: best qualified official session per student,
-- then dense_rank by difficulty DESC, points DESC. Ties therefore share rank and the same bonus.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tikatuka_monthly_official_snapshots (
  id bigserial PRIMARY KEY,
  finalization_id bigint NOT NULL REFERENCES public.arcade_monthly_finalizations(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  contribution_year_month varchar(7) NOT NULL,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tikatuka_monthly_official_snapshots_month_check
    CHECK (contribution_year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT tikatuka_monthly_official_snapshots_finalization_unique UNIQUE (finalization_id),
  CONSTRAINT tikatuka_monthly_official_snapshots_period_unique UNIQUE (period_id)
);

CREATE TABLE IF NOT EXISTS public.tikatuka_monthly_official_snapshot_entries (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES public.tikatuka_monthly_official_snapshots(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  source_session_id bigint NOT NULL REFERENCES public.tikatuka_official_sessions(id),
  rank integer NOT NULL,
  difficulty smallint NOT NULL,
  wins smallint NOT NULL,
  draws smallint NOT NULL,
  losses smallint NOT NULL,
  points smallint NOT NULL,
  ranking_score integer NOT NULL,
  completed_at timestamptz NOT NULL,
  raw_bonus numeric NOT NULL,
  student_name_at_close text,
  brand_name_at_close text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tikatuka_monthly_official_entries_rank_check CHECK (rank BETWEEN 1 AND 10),
  CONSTRAINT tikatuka_monthly_official_entries_difficulty_check CHECK (difficulty BETWEEN 1 AND 10),
  CONSTRAINT tikatuka_monthly_official_entries_points_check CHECK (points >= 3),
  CONSTRAINT tikatuka_monthly_official_entries_score_check CHECK (ranking_score = difficulty * 16 + points),
  CONSTRAINT tikatuka_monthly_official_entries_bonus_check CHECK (
    (rank = 1 AND raw_bonus = 30::numeric)
    OR (rank = 2 AND raw_bonus = 27::numeric)
    OR (rank = 3 AND raw_bonus = 24::numeric)
    OR (rank BETWEEN 4 AND 6 AND raw_bonus = 18::numeric)
    OR (rank BETWEEN 7 AND 10 AND raw_bonus = 15::numeric)
  ),
  CONSTRAINT tikatuka_monthly_official_entries_student_unique UNIQUE (snapshot_id, student_id),
  CONSTRAINT tikatuka_monthly_official_entries_session_unique UNIQUE (snapshot_id, source_session_id)
);

CREATE INDEX IF NOT EXISTS idx_tikatuka_monthly_official_entries_student
  ON public.tikatuka_monthly_official_snapshot_entries(student_id, snapshot_id);

ALTER TABLE public.tikatuka_monthly_official_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tikatuka_monthly_official_snapshots FROM anon, authenticated;
REVOKE ALL ON public.tikatuka_monthly_official_snapshot_entries FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.tikatuka_monthly_official_snapshots_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.tikatuka_monthly_official_snapshot_entries_id_seq FROM anon, authenticated;

DROP TRIGGER IF EXISTS tikatuka_monthly_official_snapshots_immutable
  ON public.tikatuka_monthly_official_snapshots;
CREATE TRIGGER tikatuka_monthly_official_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.tikatuka_monthly_official_snapshots
FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();

DROP TRIGGER IF EXISTS tikatuka_monthly_official_entries_immutable
  ON public.tikatuka_monthly_official_snapshot_entries;
CREATE TRIGGER tikatuka_monthly_official_entries_immutable
BEFORE UPDATE OR DELETE ON public.tikatuka_monthly_official_snapshot_entries
FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();

DROP TRIGGER IF EXISTS records_tikatuka_monthly_official_entry_identity_bi
  ON public.tikatuka_monthly_official_snapshot_entries;
CREATE TRIGGER records_tikatuka_monthly_official_entry_identity_bi
BEFORE INSERT ON public.tikatuka_monthly_official_snapshot_entries
FOR EACH ROW EXECUTE FUNCTION public.records_arcade_snapshot_student_identity();

CREATE OR REPLACE FUNCTION public.tikatuka_resolve_period_official_ranks(
  p_classroom_id integer,
  p_period_id bigint
)
RETURNS TABLE(
  source_session_id bigint,
  student_id integer,
  difficulty smallint,
  wins smallint,
  draws smallint,
  losses smallint,
  points smallint,
  completed_at timestamptz,
  rank integer,
  ranking_score integer,
  raw_bonus numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.arcade_period_id = p_period_id
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND s.transferred_at IS NULL
      AND coalesce(s.is_test_account, false) = false
  ), best AS (
    SELECT * FROM eligible WHERE pick = 1
  ), ranked AS (
    SELECT
      b.*,
      dense_rank() OVER (ORDER BY b.difficulty DESC, b.points DESC)::integer AS official_rank
    FROM best b
  )
  SELECT
    r.id AS source_session_id,
    r.student_id,
    r.difficulty,
    r.wins,
    r.draws,
    r.losses,
    r.points,
    r.completed_at,
    r.official_rank AS rank,
    (r.difficulty * 16 + r.points)::integer AS ranking_score,
    CASE
      WHEN r.official_rank = 1 THEN 30::numeric
      WHEN r.official_rank = 2 THEN 27::numeric
      WHEN r.official_rank = 3 THEN 24::numeric
      WHEN r.official_rank BETWEEN 4 AND 6 THEN 18::numeric
      WHEN r.official_rank BETWEEN 7 AND 10 THEN 15::numeric
      ELSE NULL::numeric
    END AS raw_bonus
  FROM ranked r
  ORDER BY r.official_rank, r.completed_at, r.id;
$function$;

-- Patch the monthly Arcade finalizer without changing the established #01/#02 verification pipeline.
-- Rakaruka is snapshotted in parallel from its own official-session ledger.
DO $patch$
DECLARE
  v_def text;
  v_normalized text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.teacher_finalize_arcade_monthly_snapshot(bigint)'::regprocedure)
  INTO v_def;
  v_normalized := replace(v_def, E'\r\n', E'\n');

  v_old := '  PERFORM pg_advisory_xact_lock(v_classroom_id,replace(v_period.contribution_year_month,''-'','''')::integer);';
  v_new := $insert$
  IF EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id = v_classroom_id
      AND os.arcade_period_id = v_period.id
      AND os.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION '[RAKARUKA] an official five-match challenge is still in progress; finish it before monthly finalization.'
      USING ERRCODE = 'PTK50';
  END IF;
  PERFORM pg_advisory_xact_lock(v_classroom_id,replace(v_period.contribution_year_month,'-','')::integer);
$insert$;
  IF position(v_old IN v_normalized) = 0 THEN
    RAISE EXCEPTION '[RAKARUKA MIGRATION] monthly finalizer lock anchor not found.';
  END IF;
  v_normalized := replace(v_normalized, v_old, trim(trailing E'\n' FROM v_new));

  v_old := '  SELECT count(*) INTO v_snapshot_count FROM public.arcade_monthly_snapshots s WHERE s.finalization_id=v_finalization.id;';
  v_new := $insert$
  WITH created_rakaruka_snapshot AS (
    INSERT INTO public.tikatuka_monthly_official_snapshots(
      finalization_id,
      classroom_id,
      period_id,
      contribution_year_month
    )
    VALUES(
      v_finalization.id,
      v_classroom_id,
      v_period.id,
      v_period.contribution_year_month
    )
    RETURNING id
  )
  INSERT INTO public.tikatuka_monthly_official_snapshot_entries(
    snapshot_id,
    student_id,
    source_session_id,
    rank,
    difficulty,
    wins,
    draws,
    losses,
    points,
    ranking_score,
    completed_at,
    raw_bonus
  )
  SELECT
    snapshot.id,
    ranking.student_id,
    ranking.source_session_id,
    ranking.rank,
    ranking.difficulty,
    ranking.wins,
    ranking.draws,
    ranking.losses,
    ranking.points,
    ranking.ranking_score,
    ranking.completed_at,
    ranking.raw_bonus
  FROM created_rakaruka_snapshot snapshot
  CROSS JOIN LATERAL public.tikatuka_resolve_period_official_ranks(v_classroom_id, v_period.id) ranking
  WHERE ranking.rank <= 10;

  SELECT count(*) INTO v_snapshot_count FROM public.arcade_monthly_snapshots s WHERE s.finalization_id=v_finalization.id;
$insert$;
  IF position(v_old IN v_normalized) = 0 THEN
    RAISE EXCEPTION '[RAKARUKA MIGRATION] monthly finalizer snapshot anchor not found.';
  END IF;
  v_normalized := replace(v_normalized, v_old, trim(trailing E'\n' FROM v_new));

  EXECUTE v_normalized;
END;
$patch$;

-- Extend Guild 2 Arcade aggregation so the existing +90 monthly cap applies across #01 + #02 + Rakaruka #03.
DO $patch$
DECLARE
  v_def text;
  v_normalized text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.guild2_refresh_monthly_scores(integer,text)'::regprocedure)
  INTO v_def;
  v_normalized := replace(v_def, E'\r\n', E'\n');

  v_old := $old$
  ), arcade_rollup AS (
    SELECT entry.student_id, sum(entry.raw_bonus)::numeric(18,8) AS arcade_raw_total
    FROM public.arcade_monthly_finalizations finalization
    JOIN public.arcade_monthly_snapshots snapshot ON snapshot.finalization_id = finalization.id
    JOIN public.arcade_monthly_snapshot_entries entry ON entry.snapshot_id = snapshot.id
    WHERE v_arcade_ready
      AND finalization.classroom_id = p_classroom_id
      AND finalization.contribution_year_month = p_year_month
    GROUP BY entry.student_id
  ), previous_scored_students AS (
$old$;

  v_new := $new$
  ), arcade_bonus_sources AS (
    SELECT entry.student_id, entry.raw_bonus
    FROM public.arcade_monthly_finalizations finalization
    JOIN public.arcade_monthly_snapshots snapshot ON snapshot.finalization_id = finalization.id
    JOIN public.arcade_monthly_snapshot_entries entry ON entry.snapshot_id = snapshot.id
    WHERE v_arcade_ready
      AND finalization.classroom_id = p_classroom_id
      AND finalization.contribution_year_month = p_year_month

    UNION ALL

    SELECT entry.student_id, entry.raw_bonus
    FROM public.tikatuka_monthly_official_snapshots snapshot
    JOIN public.tikatuka_monthly_official_snapshot_entries entry ON entry.snapshot_id = snapshot.id
    WHERE v_arcade_ready
      AND snapshot.classroom_id = p_classroom_id
      AND snapshot.contribution_year_month = p_year_month
  ), arcade_rollup AS (
    SELECT source.student_id, sum(source.raw_bonus)::numeric(18,8) AS arcade_raw_total
    FROM arcade_bonus_sources source
    GROUP BY source.student_id
  ), previous_scored_students AS (
$new$;

  IF position(v_old IN v_normalized) = 0 THEN
    RAISE EXCEPTION '[RAKARUKA MIGRATION] Guild 2 Arcade rollup anchor not found.';
  END IF;
  v_normalized := replace(v_normalized, v_old, v_new);
  EXECUTE v_normalized;
END;
$patch$;

COMMENT ON TABLE public.tikatuka_monthly_official_snapshots IS
  'Immutable monthly Rakaruka official-ranking snapshot captured with Arcade monthly finalization.';
COMMENT ON TABLE public.tikatuka_monthly_official_snapshot_entries IS
  'Guild 2 monthly Arcade bonus entries sourced only from Rakaruka official five-match ranking Top 10.';
COMMENT ON FUNCTION public.tikatuka_resolve_period_official_ranks(integer,bigint) IS
  'Resolves Rakaruka official ranking exactly by qualified official-session difficulty and points; Top 10 raw bonus uses 30/27/24/18/15.';

COMMIT;
