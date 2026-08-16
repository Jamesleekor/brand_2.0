-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade teacher-controlled pre-release test runs
-- 2026-08-14
--
-- Purpose
--   * Lets a teacher nominate a current-classroom student for pre-release play.
--   * Keeps available_from as the public launch gate.
--   * Marks every pre-release run as non-official and excludes it from live
--     leaderboards, monthly snapshots, Guild 2 Arcade bonuses, and final ranks.
--   * Preserves those runs for teacher audit rather than deleting them.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regprocedure('public.student_create_arcade_run(text)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_top10(integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL
     OR to_regprocedure('public.teacher_get_arcade_run_audit(bigint,text)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~05 migrations must be applied first.';
  END IF;
END $$;

-- A run keeps its test/offical classification forever, even if the student is
-- later removed from the pre-release access list or the public date arrives.
ALTER TABLE public.arcade_runs
  ADD COLUMN is_prerelease_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.arcade_runs.is_prerelease_test IS
  'True only for teacher-authorized pre-release test runs. These records are auditable but never official leaderboard, monthly snapshot, or Guild 2 candidates.';

CREATE TABLE public.arcade_prerelease_test_access (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  is_enabled boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  updated_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_prerelease_test_access_student_game_unique UNIQUE (student_id, game_id)
);

CREATE INDEX ix_arcade_prerelease_test_access_classroom_game
  ON public.arcade_prerelease_test_access(classroom_id, game_id)
  WHERE is_enabled;

COMMENT ON TABLE public.arcade_prerelease_test_access IS
  'Teacher-controlled pre-release access. It never opens a game publicly and only enables non-official runs before available_from.';

CREATE TRIGGER arcade_prerelease_test_access_set_updated_at
  BEFORE UPDATE ON public.arcade_prerelease_test_access
  FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();

ALTER TABLE public.arcade_prerelease_test_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.arcade_prerelease_test_access FROM PUBLIC, anon, authenticated;

CREATE INDEX ix_arcade_runs_official_game_classroom_finished
  ON public.arcade_runs(game_id, classroom_id, game_over_at, id)
  WHERE status = 'VERIFIED' AND NOT is_prerelease_test;

-- -----------------------------------------------------------------------------
-- 1. Student/teacher access RPCs. Direct access-table reads and writes remain
--    closed; every call validates the caller's identity and classroom.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_arcade_game_access(
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_seoul_today date;
  v_public_available boolean;
  v_prerelease_allowed boolean := false;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_public_available := v_game.is_active
    AND v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);

  -- Test access is deliberately pre-release only. It cannot resurrect a game
  -- after available_until and cannot bypass is_active.
  IF NOT v_public_available
     AND v_game.is_active
     AND v_seoul_today < v_game.available_from THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_prerelease_allowed;
  END IF;

  RETURN jsonb_build_object(
    'game_code', v_game.code,
    'available_from', v_game.available_from,
    'public_available', v_public_available,
    'can_start', v_public_available OR v_prerelease_allowed,
    'mode', CASE
      WHEN v_public_available THEN 'PUBLIC'
      WHEN v_prerelease_allowed THEN 'PRERELEASE_TEST'
      ELSE 'CLOSED'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_arcade_prerelease_test_access(
  p_student_id integer,
  p_game_code text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_game_id bigint;
  v_access public.arcade_prerelease_test_access%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF p_student_id IS NULL OR p_student_id <= 0 THEN
    RAISE EXCEPTION '[ARCADE] test student is required.' USING ERRCODE = 'P0221';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION '[ARCADE] test access state is required.' USING ERRCODE = 'P0222';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code AND is_active;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active game was not found.' USING ERRCODE = 'P0223';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students student
    WHERE student.id = p_student_id
      AND student.classroom_id = v_classroom_id
      AND student.transferred_at IS NULL
      AND student.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST')
  ) THEN
    RAISE EXCEPTION '[ARCADE] test student was not found in this classroom.' USING ERRCODE = 'P0224';
  END IF;

  INSERT INTO public.arcade_prerelease_test_access (
    classroom_id, student_id, game_id, is_enabled, created_by_user_id, updated_by_user_id
  ) VALUES (
    v_classroom_id, p_student_id, v_game_id, p_enabled, auth.uid(), auth.uid()
  )
  ON CONFLICT (student_id, game_id) DO UPDATE SET
    classroom_id = EXCLUDED.classroom_id,
    is_enabled = EXCLUDED.is_enabled,
    updated_by_user_id = auth.uid(),
    updated_at = now()
  RETURNING * INTO v_access;

  RETURN jsonb_build_object(
    'access_id', v_access.id,
    'student_id', v_access.student_id,
    'game_id', v_access.game_id,
    'is_enabled', v_access.is_enabled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_list_arcade_prerelease_test_access(
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_game_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'access_id', access_row.id,
        'student_id', access_row.student_id,
        'student_name', student.name,
        'student_brand_name', student.brand_name,
        'is_enabled', access_row.is_enabled,
        'updated_at', access_row.updated_at
      ) ORDER BY student.name, access_row.id
    ), '[]'::jsonb)
    FROM public.arcade_prerelease_test_access access_row
    JOIN public.students student ON student.id = access_row.student_id
    WHERE access_row.classroom_id = v_classroom_id
      AND access_row.game_id = v_game_id
      AND access_row.is_enabled
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Server-issued runs retain the ordinary public date gate. Before that date,
--    only a teacher-approved access row can create a permanently non-official
--    run. The browser cannot choose is_prerelease_test.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_seed_bytes bytea;
  v_seed bigint;
  v_seoul_today date;
  v_public_available boolean;
  v_is_prerelease_test boolean := false;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;
  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
  END IF;

  v_public_available := v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);
  IF NOT v_public_available THEN
    IF v_seoul_today >= v_game.available_from THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_is_prerelease_test;

    IF NOT v_is_prerelease_test THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;
  END IF;

  SELECT * INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id = v_game.id AND is_active
  ORDER BY id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] active game rule version is missing.' USING ERRCODE = 'P0198';
  END IF;

  v_seed_bytes := gen_random_bytes(4);
  v_seed := get_byte(v_seed_bytes, 0)::bigint * 16777216
    + get_byte(v_seed_bytes, 1)::bigint * 65536
    + get_byte(v_seed_bytes, 2)::bigint * 256
    + get_byte(v_seed_bytes, 3)::bigint;
  IF v_seed = 0 THEN
    v_seed := 1;
  END IF;

  INSERT INTO public.arcade_runs (
    classroom_id, student_id, game_id, rule_version_id, status,
    schedule_seed, countdown_started_at, is_prerelease_test
  ) VALUES (
    v_classroom_id, v_student_id, v_game.id, v_rule.id, 'COUNTDOWN',
    v_seed, now(), v_is_prerelease_test
  )
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'game_code', v_game.code,
    'rule_version', v_rule.version_code,
    'countdown_started_at', v_run.countdown_started_at,
    'countdown_ends_at', v_run.countdown_started_at + ((v_rule.config ->> 'countdown_ms')::integer * interval '1 millisecond'),
    'schedule_seed', v_run.schedule_seed,
    'config', v_rule.config,
    'is_prerelease_test', v_run.is_prerelease_test
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Every official candidate query explicitly excludes pre-release test runs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_top10(
  p_classroom_id integer,
  p_period_id bigint,
  p_game_id bigint
)
RETURNS TABLE(
  source_run_id bigint,
  student_id integer,
  official_score bigint,
  achieved_at timestamptz,
  rank integer,
  raw_bonus numeric
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
      AND NOT run.is_prerelease_test
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id AND moderation.event_kind = 'INVALIDATE'
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
         ranked.rank::integer,
         CASE
           WHEN ranked.rank = 1 THEN 30::numeric
           WHEN ranked.rank = 2 THEN 27::numeric
           WHEN ranked.rank = 3 THEN 24::numeric
           WHEN ranked.rank BETWEEN 4 AND 6 THEN 18::numeric
           WHEN ranked.rank BETWEEN 7 AND 10 THEN 15::numeric
         END AS raw_bonus
  FROM ranked
  WHERE ranked.rank <= 10
  ORDER BY ranked.rank;
$$;

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
      AND NOT run.is_prerelease_test
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
      AND NOT run.is_prerelease_test
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

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_run_audit(
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
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE = 'P0205';
  END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(row_data ORDER BY (row_data ->> 'event_at')::timestamptz DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'run_id', run.id,
        'student_id', run.student_id,
        'student_name', student.name,
        'status', run.status,
        'is_prerelease_test', run.is_prerelease_test,
        'official_score', run.official_score,
        'official_duration_ms', run.official_duration_ms,
        'game_over_at', run.game_over_at,
        'submitted_at', run.submitted_at,
        'event_at', coalesce(run.game_over_at, run.submitted_at, run.created_at),
        'rejection_code', run.rejection_code,
        'rejection_reason', run.rejection_reason,
        'invalidated', moderation.id IS NOT NULL,
        'invalidation_reason', moderation.reason
      ) AS row_data
      FROM public.arcade_runs run
      JOIN public.students student ON student.id = run.student_id
      LEFT JOIN public.arcade_run_moderation_events moderation ON moderation.run_id = run.id
      WHERE run.classroom_id = v_classroom_id
        AND run.game_id = v_game_id
        AND coalesce(run.game_over_at, run.submitted_at, run.created_at) >= v_period.starts_at
        AND coalesce(run.game_over_at, run.submitted_at, run.created_at) < v_period.ends_at_exclusive
      ORDER BY coalesce(run.game_over_at, run.submitted_at, run.created_at) DESC, run.id DESC
      LIMIT 200
    ) audit_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_arcade_run_result(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_run public.arcade_runs%ROWTYPE;
BEGIN
  v_student_id := public.current_student_id();
  SELECT * INTO v_run FROM public.arcade_runs WHERE id = p_run_id;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'status', v_run.status,
    'is_prerelease_test', v_run.is_prerelease_test,
    'official_score', v_run.official_score,
    'official_duration_ms', v_run.official_duration_ms,
    'game_over_at', v_run.game_over_at,
    'stats', v_run.stats,
    'rejection_code', v_run.rejection_code,
    'rejection_reason', v_run.rejection_reason
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Explicit ACL boundary.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.student_get_arcade_game_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_arcade_prerelease_test_access(integer, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_list_arcade_prerelease_test_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_create_arcade_run(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.arcade_resolve_period_top10(integer, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_resolve_period_student_ranks(integer, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_run_audit(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_get_arcade_run_result(bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.student_get_arcade_game_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_arcade_prerelease_test_access(integer, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_list_arcade_prerelease_test_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_create_arcade_run(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_run_audit(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_arcade_run_result(bigint) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'arcade_runs'
  AND column_name = 'is_prerelease_test';

SELECT c.relname AS relation_name,
       c.relrowsecurity AS rls_enabled,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select_directly,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'arcade_prerelease_test_access';

SELECT indexname AS index_name, indexdef AS index_definition
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'ix_arcade_prerelease_test_access_classroom_game',
    'ix_arcade_runs_official_game_classroom_finished'
  )
ORDER BY indexname;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'student_get_arcade_game_access',
    'teacher_set_arcade_prerelease_test_access',
    'teacher_list_arcade_prerelease_test_access',
    'student_create_arcade_run',
    'arcade_resolve_period_top10',
    'arcade_resolve_period_student_ranks',
    'get_arcade_leaderboard',
    'teacher_get_arcade_run_audit'
  )
ORDER BY function_name, identity_arguments;

SELECT pg_get_functiondef('public.student_create_arcade_run(text)'::regprocedure)
         ILIKE '%is_prerelease_test%' AS create_run_marks_prerelease_test_server_side,
       pg_get_functiondef('public.arcade_resolve_period_top10(integer,bigint,bigint)'::regprocedure)
         ILIKE '%NOT run.is_prerelease_test%' AS top10_excludes_prerelease_test_runs,
       pg_get_functiondef('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)'::regprocedure)
         ILIKE '%NOT run.is_prerelease_test%' AS full_rank_excludes_prerelease_test_runs,
       pg_get_functiondef('public.get_arcade_leaderboard(text,bigint)'::regprocedure)
         ILIKE '%NOT run.is_prerelease_test%' AS active_leaderboard_excludes_prerelease_test_runs;
