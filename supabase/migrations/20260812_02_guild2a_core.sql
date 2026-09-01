-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 2A Core: GS ledger and individual contribution engine
-- 2026-08-12
--
-- Production compatibility basis
--   * Verified by PREFLIGHT_GUILD2_GS_ENGINE.sql on production.
--   * Existing guild_gs and guild_individual_contributions are legacy,
--     BV-growth based tables with incompatible NOT NULL columns and CHECKs.
--   * This migration never rewrites or deletes those legacy tables or Guild 1
--     history. Guild 2 uses new guild2_* tables instead.
--
-- Scope
--   * Guild 2A only: session + teacher-observation components, draft aggregate,
--     append-only GS ledger, manual compensation, teacher/student read models.
--   * Mission, peer review, and Arcade remain explicitly NOT_READY. This file
--     creates no Guild 3/4 lifecycle, peer-round, or Arcade game model.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Production preconditions already verified by preflight
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.guilds') IS NULL
     OR to_regclass('public.guild_seasons') IS NULL
     OR to_regclass('public.guild_members') IS NULL
     OR to_regclass('public.guild_sessions') IS NULL
     OR to_regclass('public.guild_session_participants') IS NULL THEN
    RAISE EXCEPTION '[G2A] Guild 1 source tables are missing.';
  END IF;

  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.is_teacher_or_admin()') IS NULL THEN
    RAISE EXCEPTION '[G2A] required identity helper functions are missing.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. New Guild 2 tables
-- -----------------------------------------------------------------------------

-- Teacher observation is an append-only evidence record. A correction is a
-- separate REVERSAL row linked to the original recognition; old evidence is
-- never overwritten or deleted.
CREATE TABLE IF NOT EXISTS public.guild2_observation_events (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  year_month varchar(7) NOT NULL,
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  event_kind text NOT NULL DEFAULT 'RECOGNITION',
  category text NOT NULL,
  reason text NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  occurred_on date NOT NULL,
  reversal_of bigint REFERENCES public.guild2_observation_events(id),
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild2_observation_year_month_check
    CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guild2_observation_event_kind_check
    CHECK (event_kind IN ('RECOGNITION','REVERSAL')),
  CONSTRAINT guild2_observation_category_check
    CHECK (category IN ('COOPERATION','LEADERSHIP','RESPONSIBILITY','SUPPORT','PROBLEM_SOLVING','OTHER')),
  CONSTRAINT guild2_observation_reason_check
    CHECK (char_length(btrim(reason)) BETWEEN 2 AND 300),
  CONSTRAINT guild2_observation_reversal_shape_check
    CHECK (
      (event_kind = 'RECOGNITION' AND reversal_of IS NULL)
      OR (event_kind = 'REVERSAL' AND reversal_of IS NOT NULL)
    ),
  CONSTRAINT guild2_observation_idempotency_unique UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guild2_observation_one_reversal
  ON public.guild2_observation_events(reversal_of)
  WHERE event_kind = 'REVERSAL';
CREATE INDEX IF NOT EXISTS ix_guild2_observation_student_month
  ON public.guild2_observation_events(classroom_id, student_id, year_month, occurred_on DESC);
CREATE INDEX IF NOT EXISTS ix_guild2_observation_guild_month
  ON public.guild2_observation_events(classroom_id, guild_id, year_month, created_at DESC);

COMMENT ON TABLE public.guild2_observation_events IS
  'Guild 2 teacher observation evidence. Recognition corrections append REVERSAL rows; historical evidence is never updated or deleted.';

-- The compensation switch is intentionally manual. It does not infer anything
-- from a guild's current headcount.
CREATE TABLE IF NOT EXISTS public.guild2_compensation_configs (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  enabled boolean NOT NULL DEFAULT false,
  factor numeric(3,2) NOT NULL DEFAULT 0.50,
  changed_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild2_compensation_factor_check CHECK (factor = 0.50),
  CONSTRAINT guild2_compensation_scope_unique UNIQUE (season_id, guild_id)
);
CREATE INDEX IF NOT EXISTS ix_guild2_compensation_class_season
  ON public.guild2_compensation_configs(classroom_id, season_id, enabled);

COMMENT ON TABLE public.guild2_compensation_configs IS
  'Guild 2 manual 4-member compensation setting. Factor is the accepted fixed 0.50; no automatic headcount toggle exists.';

-- This is a mutable draft/cache derived from raw source evidence. It is not a
-- final monthly snapshot; Guild 5 will own final roster and close semantics.
CREATE TABLE IF NOT EXISTS public.guild2_individual_contributions (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  year_month varchar(7) NOT NULL,
  student_id integer NOT NULL REFERENCES public.students(id),
  scoring_guild_id integer REFERENCES public.guilds(id),
  guild_context_status text NOT NULL DEFAULT 'NEEDS_ROSTER_RESOLUTION',
  guild_context_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  peer_points numeric(8,2) NOT NULL DEFAULT 0,
  mission_points numeric(8,2) NOT NULL DEFAULT 0,
  session_points numeric(8,2) NOT NULL DEFAULT 0,
  teacher_observation_points numeric(8,2) NOT NULL DEFAULT 0,
  basic_total numeric(8,2) NOT NULL DEFAULT 0,
  arcade_raw_total numeric(8,2) NOT NULL DEFAULT 0,
  arcade_applied numeric(8,2) NOT NULL DEFAULT 0,
  final_total numeric(8,2) NOT NULL DEFAULT 0,
  peer_status text NOT NULL DEFAULT 'NOT_READY',
  mission_status text NOT NULL DEFAULT 'NOT_READY',
  session_status text NOT NULL DEFAULT 'NOT_READY',
  teacher_observation_status text NOT NULL DEFAULT 'READY',
  arcade_status text NOT NULL DEFAULT 'NOT_READY',
  session_absent_count integer NOT NULL DEFAULT 0,
  session_unmarked_count integer NOT NULL DEFAULT 0,
  observation_count integer NOT NULL DEFAULT 0,
  calculation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_version text NOT NULL DEFAULT 'GUILD_CONTRIBUTION_V2_2026',
  calculated_by_user_id uuid DEFAULT auth.uid(),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild2_contribution_year_month_check
    CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guild2_contribution_context_status_check
    CHECK (guild_context_status IN ('RESOLVED','NEEDS_ROSTER_RESOLUTION')),
  CONSTRAINT guild2_contribution_component_status_check
    CHECK (
      peer_status IN ('NOT_READY','PENDING','READY')
      AND mission_status IN ('NOT_READY','PENDING','READY')
      AND session_status IN ('NOT_READY','PENDING','READY')
      AND teacher_observation_status IN ('NOT_READY','PENDING','READY')
      AND arcade_status IN ('NOT_READY','PENDING','READY')
    ),
  CONSTRAINT guild2_contribution_scoring_context_check
    CHECK (
      (guild_context_status = 'RESOLVED' AND scoring_guild_id IS NOT NULL)
      OR (guild_context_status = 'NEEDS_ROSTER_RESOLUTION' AND scoring_guild_id IS NULL)
    ),
  CONSTRAINT guild2_contribution_peer_range_check CHECK (peer_points BETWEEN 0 AND 300),
  CONSTRAINT guild2_contribution_mission_range_check CHECK (mission_points BETWEEN 0 AND 300),
  CONSTRAINT guild2_contribution_session_range_check CHECK (session_points BETWEEN 0 AND 150),
  CONSTRAINT guild2_contribution_teacher_range_check CHECK (teacher_observation_points BETWEEN 0 AND 150),
  CONSTRAINT guild2_contribution_basic_range_check CHECK (basic_total BETWEEN 0 AND 900),
  CONSTRAINT guild2_contribution_arcade_raw_check CHECK (arcade_raw_total >= 0),
  CONSTRAINT guild2_contribution_arcade_applied_check CHECK (arcade_applied BETWEEN 0 AND 90),
  CONSTRAINT guild2_contribution_final_range_check CHECK (final_total BETWEEN 0 AND 990),
  CONSTRAINT guild2_contribution_session_absent_check CHECK (session_absent_count >= 0),
  CONSTRAINT guild2_contribution_session_unmarked_check CHECK (session_unmarked_count >= 0),
  CONSTRAINT guild2_contribution_observation_count_check CHECK (observation_count >= 0),
  CONSTRAINT guild2_contribution_scope_unique UNIQUE (classroom_id, season_id, year_month, student_id)
);
CREATE INDEX IF NOT EXISTS ix_guild2_contribution_student_month
  ON public.guild2_individual_contributions(student_id, year_month DESC);
CREATE INDEX IF NOT EXISTS ix_guild2_contribution_guild_month
  ON public.guild2_individual_contributions(classroom_id, season_id, year_month, scoring_guild_id);

COMMENT ON TABLE public.guild2_individual_contributions IS
  'Guild 2 draft individual-contribution cache. A null scoring_guild_id means a mid-month guild context is unresolved and must not be auto-moved to a current guild.';

-- Every GS change is posted as an immutable event. If an automatic calculation
-- changes, the old event receives a separate reversal and a corrected post.
CREATE TABLE IF NOT EXISTS public.guild2_gs_events (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  year_month varchar(7) NOT NULL,
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  source_type text NOT NULL,
  source_id bigint,
  student_id integer REFERENCES public.students(id),
  event_kind text NOT NULL DEFAULT 'POST',
  points numeric(10,2) NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  reversal_of bigint REFERENCES public.guild2_gs_events(id),
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild2_gs_event_year_month_check
    CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guild2_gs_event_source_type_check
    CHECK (source_type IN ('INDIVIDUAL_CONTRIBUTION','MISSION_GS','MEMBER_COMPENSATION','MANUAL_ADJUSTMENT','REVERSAL')),
  CONSTRAINT guild2_gs_event_kind_check CHECK (event_kind IN ('POST','REVERSAL')),
  CONSTRAINT guild2_gs_event_reason_check CHECK (char_length(btrim(reason)) BETWEEN 2 AND 300),
  CONSTRAINT guild2_gs_event_nonzero_points_check CHECK (points <> 0),
  CONSTRAINT guild2_gs_event_reversal_shape_check
    CHECK (
      (event_kind = 'POST' AND reversal_of IS NULL)
      OR (event_kind = 'REVERSAL' AND reversal_of IS NOT NULL AND source_type = 'REVERSAL')
    ),
  CONSTRAINT guild2_gs_event_idempotency_unique UNIQUE (idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guild2_gs_event_one_reversal
  ON public.guild2_gs_events(reversal_of)
  WHERE event_kind = 'REVERSAL';
CREATE INDEX IF NOT EXISTS ix_guild2_gs_event_guild_month
  ON public.guild2_gs_events(classroom_id, season_id, year_month, guild_id, created_at, id);
CREATE INDEX IF NOT EXISTS ix_guild2_gs_event_source
  ON public.guild2_gs_events(source_type, source_id, event_kind, id);

COMMENT ON TABLE public.guild2_gs_events IS
  'Guild 2 append-only GS ledger. Never update/delete a posted event: append a REVERSAL and corrected POST instead.';

-- Derived display cache for the teacher overview and student guild header.
CREATE TABLE IF NOT EXISTS public.guild2_monthly_gs_summaries (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  year_month varchar(7) NOT NULL,
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  scoring_roster_count integer NOT NULL DEFAULT 0,
  individual_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  mission_gs_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  compensation_amount numeric(10,2) NOT NULL DEFAULT 0,
  manual_adjustment_total numeric(10,2) NOT NULL DEFAULT 0,
  draft_gs_total numeric(10,2) NOT NULL DEFAULT 0,
  draft_rank integer,
  compensation_enabled boolean NOT NULL DEFAULT false,
  source_readiness jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_version text NOT NULL DEFAULT 'GUILD_CONTRIBUTION_V2_2026',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild2_gs_summary_year_month_check
    CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guild2_gs_summary_roster_count_check CHECK (scoring_roster_count >= 0),
  CONSTRAINT guild2_gs_summary_rank_check CHECK (draft_rank IS NULL OR draft_rank > 0),
  CONSTRAINT guild2_gs_summary_scope_unique UNIQUE (classroom_id, season_id, year_month, guild_id)
);
CREATE INDEX IF NOT EXISTS ix_guild2_gs_summary_class_month_rank
  ON public.guild2_monthly_gs_summaries(classroom_id, year_month, draft_gs_total DESC);

COMMENT ON TABLE public.guild2_monthly_gs_summaries IS
  'Guild 2 draft GS display cache derived from the append-only ledger. It is not Guild 5 final ranking or snapshot data.';

-- -----------------------------------------------------------------------------
-- 2. RLS and direct table permissions
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild2_observation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild2_compensation_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild2_individual_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild2_gs_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild2_monthly_gs_summaries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guild2_observation_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild2_compensation_configs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild2_individual_contributions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild2_gs_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild2_monthly_gs_summaries FROM PUBLIC, anon, authenticated;

-- Reads are the only direct authenticated access. All score/config writes use
-- security-definer teacher RPCs below.
GRANT SELECT ON TABLE public.guild2_observation_events TO authenticated;
GRANT SELECT ON TABLE public.guild2_compensation_configs TO authenticated;
GRANT SELECT ON TABLE public.guild2_individual_contributions TO authenticated;
GRANT SELECT ON TABLE public.guild2_gs_events TO authenticated;
GRANT SELECT ON TABLE public.guild2_monthly_gs_summaries TO authenticated;

CREATE POLICY guild2_observation_teacher_select
  ON public.guild2_observation_events
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild2_observation_student_public_select
  ON public.guild2_observation_events
  FOR SELECT TO authenticated
  USING (
    student_id = public.current_student_id()
    AND event_kind = 'RECOGNITION'
    AND is_public = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.guild2_observation_events reversal
      WHERE reversal.reversal_of = guild2_observation_events.id
        AND reversal.event_kind = 'REVERSAL'
    )
  );

CREATE POLICY guild2_compensation_teacher_select
  ON public.guild2_compensation_configs
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );

CREATE POLICY guild2_contribution_teacher_select
  ON public.guild2_individual_contributions
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild2_contribution_student_select
  ON public.guild2_individual_contributions
  FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

CREATE POLICY guild2_gs_ledger_teacher_select
  ON public.guild2_gs_events
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );

CREATE POLICY guild2_summary_teacher_select
  ON public.guild2_monthly_gs_summaries
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild2_summary_current_member_select
  ON public.guild2_monthly_gs_summaries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.guild_members gm
      WHERE gm.guild_id = guild2_monthly_gs_summaries.guild_id
        AND gm.student_id = public.current_student_id()
        AND gm.left_at IS NULL
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Internal calculation helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guild2_resolve_season_for_month(
  p_classroom_id integer,
  p_year_month text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_season_id integer;
BEGIN
  IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G2A] year_month must be YYYY-MM.' USING ERRCODE = 'P0164';
  END IF;

  v_month_start := (p_year_month || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  SELECT gs.id
    INTO v_season_id
  FROM public.guild_seasons gs
  WHERE gs.classroom_id = p_classroom_id
    AND coalesce(gs.starts_on, gs.start_date) <= v_month_end
    AND coalesce(gs.ends_on, gs.end_date) >= v_month_start
  ORDER BY (gs.lifecycle_status = 'ACTIVE') DESC,
           coalesce(gs.starts_on, gs.start_date) DESC,
           gs.id DESC
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION '[G2A] no applicable guild season was found for this month.' USING ERRCODE = 'P0165';
  END IF;

  RETURN v_season_id;
END;
$$;

-- Rebuilds only the mutable Guild 2 draft aggregate. Raw Guild 1 snapshots,
-- observation evidence, and legacy score tables are not updated.
CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_scores(
  p_classroom_id integer,
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id integer;
  v_month_start date;
  v_month_end date;
  v_count integer := 0;
BEGIN
  IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G2A] year_month must be YYYY-MM.' USING ERRCODE = 'P0164';
  END IF;

  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);

  v_month_start := (p_year_month || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;
  v_season_id := public.guild2_resolve_season_for_month(p_classroom_id, p_year_month);

  WITH active_roster AS (
    SELECT s.id AS student_id, gm.guild_id
    FROM public.students s
    JOIN public.guild_members gm
      ON gm.student_id = s.id
     AND gm.season_id = v_season_id
     AND gm.joined_at::date <= v_month_end
     AND gm.left_at IS NULL
    JOIN public.guilds g ON g.id = gm.guild_id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
      AND g.classroom_id = p_classroom_id
      AND g.season_id = v_season_id
  ), session_rollup AS (
    SELECT
      participant.student_id,
      array_agg(DISTINCT participant.guild_id_at_session) AS guild_ids,
      count(*) AS session_count,
      count(*) FILTER (WHERE participant.attendance_status = 'ABSENT') AS absent_count,
      count(*) FILTER (WHERE participant.attendance_status = 'UNMARKED') AS unmarked_count
    FROM public.guild_session_participants participant
    JOIN public.guild_sessions session ON session.id = participant.session_id
    WHERE session.classroom_id = p_classroom_id
      AND session.season_id = v_season_id
      AND session.session_date BETWEEN v_month_start AND v_month_end
    GROUP BY participant.student_id
  ), observation_rollup AS (
    SELECT
      event.student_id,
      array_agg(DISTINCT event.guild_id) AS guild_ids,
      count(*) AS recognition_count,
      jsonb_object_agg(event.category, event.category_count) AS category_counts
    FROM (
      SELECT
        observation.student_id,
        observation.guild_id,
        observation.category,
        count(*) AS category_count
      FROM public.guild2_observation_events observation
      WHERE observation.classroom_id = p_classroom_id
        AND observation.season_id = v_season_id
        AND observation.year_month = p_year_month
        AND observation.event_kind = 'RECOGNITION'
        AND NOT EXISTS (
          SELECT 1
          FROM public.guild2_observation_events reversal
          WHERE reversal.reversal_of = observation.id
            AND reversal.event_kind = 'REVERSAL'
        )
      GROUP BY observation.student_id, observation.guild_id, observation.category
    ) event
    GROUP BY event.student_id
  ), previous_contribution_context AS (
    -- Recalculation may follow a correction or a membership move. Retain the
    -- previous draft context long enough to turn an old allocation into an
    -- explicit reversal; never silently leave that allocation behind.
    SELECT contribution.student_id,
           previous_context.guild_id_text::integer AS guild_id
    FROM public.guild2_individual_contributions contribution
    CROSS JOIN LATERAL jsonb_array_elements_text(contribution.guild_context_ids) AS previous_context(guild_id_text)
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), student_scope AS (
    SELECT student_id FROM active_roster
    UNION
    SELECT student_id FROM session_rollup
    UNION
    SELECT student_id FROM observation_rollup
    UNION
    SELECT student_id FROM previous_contribution_context
  ), all_contexts AS (
    SELECT context_row.student_id,
           array_agg(DISTINCT context_row.guild_id ORDER BY context_row.guild_id) AS guild_ids
    FROM (
      SELECT student_id, guild_id FROM active_roster
      UNION
      SELECT student_id, unnest(guild_ids) FROM session_rollup
      UNION
      SELECT student_id, unnest(guild_ids) FROM observation_rollup
      UNION
      SELECT student_id, guild_id FROM previous_contribution_context
    ) context_row
    GROUP BY context_row.student_id
  ), calculated AS (
    SELECT
      scope.student_id,
      CASE
        WHEN roster.guild_id IS NOT NULL
         AND cardinality(contexts.guild_ids) = 1
         AND contexts.guild_ids[1] = roster.guild_id
        THEN roster.guild_id
        ELSE NULL
      END AS scoring_guild_id,
      CASE
        WHEN roster.guild_id IS NOT NULL
         AND cardinality(contexts.guild_ids) = 1
         AND contexts.guild_ids[1] = roster.guild_id
        THEN 'RESOLVED'
        ELSE 'NEEDS_ROSTER_RESOLUTION'
      END AS guild_context_status,
      contexts.guild_ids,
      coalesce(session.session_count, 0)::integer AS session_count,
      coalesce(session.absent_count, 0)::integer AS session_absent_count,
      coalesce(session.unmarked_count, 0)::integer AS session_unmarked_count,
      CASE
        -- A month with no Guild 1 participant snapshot has no session source
        -- yet. Keep the numeric value at 0 and use NOT_READY so 0 is never
        -- presented as a completed attendance result.
        WHEN coalesce(session.session_count, 0) = 0 THEN 0::numeric(8,2)
        ELSE greatest(0, 150 - 30 * coalesce(session.absent_count, 0))::numeric(8,2)
      END AS session_points,
      CASE
        WHEN coalesce(session.session_count, 0) = 0 THEN 'NOT_READY'
        WHEN coalesce(session.unmarked_count, 0) > 0 THEN 'PENDING'
        ELSE 'READY'
      END AS session_status,
      coalesce(observation.recognition_count, 0)::integer AS observation_count,
      least(coalesce(observation.recognition_count, 0) * 10, 150)::numeric(8,2) AS teacher_observation_points,
      coalesce(observation.category_counts, '{}'::jsonb) AS category_counts
    FROM student_scope scope
    JOIN all_contexts contexts ON contexts.student_id = scope.student_id
    LEFT JOIN active_roster roster ON roster.student_id = scope.student_id
    LEFT JOIN session_rollup session ON session.student_id = scope.student_id
    LEFT JOIN observation_rollup observation ON observation.student_id = scope.student_id
  )
  INSERT INTO public.guild2_individual_contributions (
    classroom_id, season_id, year_month, student_id,
    scoring_guild_id, guild_context_status, guild_context_ids,
    peer_points, mission_points, session_points, teacher_observation_points,
    basic_total, arcade_raw_total, arcade_applied, final_total,
    peer_status, mission_status, session_status, teacher_observation_status, arcade_status,
    session_absent_count, session_unmarked_count, observation_count,
    calculation_metadata, formula_version, calculated_by_user_id, calculated_at, updated_at
  )
  SELECT
    p_classroom_id, v_season_id, p_year_month, calculated.student_id,
    calculated.scoring_guild_id, calculated.guild_context_status, to_jsonb(calculated.guild_ids),
    0, 0, calculated.session_points, calculated.teacher_observation_points,
    calculated.session_points + calculated.teacher_observation_points,
    0, 0, calculated.session_points + calculated.teacher_observation_points,
    'NOT_READY', 'NOT_READY', calculated.session_status, 'READY', 'NOT_READY',
    calculated.session_absent_count, calculated.session_unmarked_count, calculated.observation_count,
    jsonb_build_object(
      'session_count', calculated.session_count,
      'observation_category_counts', calculated.category_counts,
      'allocation_note', CASE
        WHEN calculated.guild_context_status = 'RESOLVED' THEN 'CURRENT_DRAFT_CONTEXT'
        ELSE 'MID_MONTH_OR_HISTORICAL_GUILD_CONTEXT_REQUIRES_GUILD5_ROSTER_RESOLUTION'
      END
    ),
    'GUILD_CONTRIBUTION_V2_2026', auth.uid(), now(), now()
  FROM calculated
  ON CONFLICT (classroom_id, season_id, year_month, student_id) DO UPDATE SET
    scoring_guild_id = EXCLUDED.scoring_guild_id,
    guild_context_status = EXCLUDED.guild_context_status,
    guild_context_ids = EXCLUDED.guild_context_ids,
    peer_points = EXCLUDED.peer_points,
    mission_points = EXCLUDED.mission_points,
    session_points = EXCLUDED.session_points,
    teacher_observation_points = EXCLUDED.teacher_observation_points,
    basic_total = EXCLUDED.basic_total,
    arcade_raw_total = EXCLUDED.arcade_raw_total,
    arcade_applied = EXCLUDED.arcade_applied,
    final_total = EXCLUDED.final_total,
    peer_status = EXCLUDED.peer_status,
    mission_status = EXCLUDED.mission_status,
    session_status = EXCLUDED.session_status,
    teacher_observation_status = EXCLUDED.teacher_observation_status,
    arcade_status = EXCLUDED.arcade_status,
    session_absent_count = EXCLUDED.session_absent_count,
    session_unmarked_count = EXCLUDED.session_unmarked_count,
    observation_count = EXCLUDED.observation_count,
    calculation_metadata = EXCLUDED.calculation_metadata,
    formula_version = EXCLUDED.formula_version,
    calculated_by_user_id = EXCLUDED.calculated_by_user_id,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.guild2_refresh_monthly_gs_summary(p_classroom_id, p_year_month, v_season_id);

  RETURN jsonb_build_object(
    'classroom_id', p_classroom_id,
    'season_id', v_season_id,
    'year_month', p_year_month,
    'contributions_recalculated', v_count,
    'formula_version', 'GUILD_CONTRIBUTION_V2_2026'
  );
END;
$$;

-- Posts/reverses automatic contribution and compensation ledger entries, then
-- refreshes the display cache. This helper is intentionally not client-callable.
CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_gs_summary(
  p_classroom_id integer,
  p_year_month text,
  p_season_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  contribution record;
  compensation record;
  prior_event record;
BEGIN
  -- This helper can also be reached after a teacher's manual GS adjustment,
  -- so it needs its own lock in addition to the caller's refresh lock.
  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);

  -- Resolved individual contribution events.
  FOR contribution IN
    SELECT contribution_row.*
    FROM public.guild2_individual_contributions contribution_row
    WHERE contribution_row.classroom_id = p_classroom_id
      AND contribution_row.season_id = p_season_id
      AND contribution_row.year_month = p_year_month
      AND contribution_row.guild_context_status = 'RESOLVED'
      AND contribution_row.scoring_guild_id IS NOT NULL
  LOOP
    SELECT ledger.* INTO prior_event
    FROM public.guild2_gs_events ledger
    WHERE ledger.source_type = 'INDIVIDUAL_CONTRIBUTION'
      AND ledger.source_id = contribution.id
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
    ORDER BY ledger.id DESC
    LIMIT 1;

    IF contribution.final_total = 0 THEN
      -- The ledger deliberately forbids zero-point events. If a previously
      -- posted score becomes zero, preserve its history with a reversal only.
      IF prior_event.id IS NOT NULL THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          student_id, event_kind, points, reason, metadata, reversal_of
        ) VALUES (
          prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
          'REVERSAL', prior_event.source_id, prior_event.student_id,
          'REVERSAL', -prior_event.points, '개인 기여도 0점 전환 취소',
          jsonb_build_object('reversal_reason', 'RECALCULATION_TO_ZERO'), prior_event.id
        );
      END IF;
    ELSIF prior_event.id IS NULL THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        student_id, event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, contribution.scoring_guild_id,
        'INDIVIDUAL_CONTRIBUTION', contribution.id, contribution.student_id,
        'POST', contribution.final_total,
        '개인 기여도 초안 반영',
        jsonb_build_object('formula_version', contribution.formula_version)
      );
    ELSIF prior_event.points IS DISTINCT FROM contribution.final_total
       OR prior_event.guild_id IS DISTINCT FROM contribution.scoring_guild_id THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        student_id, event_kind, points, reason, metadata, reversal_of
      ) VALUES (
        prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
        'REVERSAL', prior_event.source_id, prior_event.student_id,
        'REVERSAL', -prior_event.points, '개인 기여도 초안 변경 취소',
        jsonb_build_object('reversal_reason', 'RECALCULATION'), prior_event.id
      );
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        student_id, event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, contribution.scoring_guild_id,
        'INDIVIDUAL_CONTRIBUTION', contribution.id, contribution.student_id,
        'POST', contribution.final_total,
        '개인 기여도 초안 재계산 반영',
        jsonb_build_object('formula_version', contribution.formula_version, 'replaces_event_id', prior_event.id)
      );
    END IF;
  END LOOP;

  -- A contribution whose context is no longer safely resolved must not remain
  -- allocated to a current guild. Reverse its latest ledger post instead.
  FOR prior_event IN
    SELECT ledger.*
    FROM public.guild2_gs_events ledger
    JOIN public.guild2_individual_contributions contribution_row
      ON contribution_row.id = ledger.source_id
    WHERE ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.source_type = 'INDIVIDUAL_CONTRIBUTION'
      AND ledger.event_kind = 'POST'
      AND contribution_row.guild_context_status <> 'RESOLVED'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
  LOOP
    INSERT INTO public.guild2_gs_events (
      classroom_id, season_id, year_month, guild_id, source_type, source_id,
      student_id, event_kind, points, reason, metadata, reversal_of
    ) VALUES (
      prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
      'REVERSAL', prior_event.source_id, prior_event.student_id,
      'REVERSAL', -prior_event.points, '길드 소속 맥락 확인 전 배정 보류',
      jsonb_build_object('reversal_reason', 'UNRESOLVED_GUILD_CONTEXT'), prior_event.id
    );
  END LOOP;

  -- Manual 4-member compensation: the accepted 0.5 factor, Basic only,
  -- rounded once on the server to the nearest 10 GS.
  FOR compensation IN
    SELECT
      config.id AS config_id,
      config.guild_id,
      config.enabled,
      coalesce(round((avg(contribution_row.basic_total) * config.factor) / 10) * 10, 0)::numeric(10,2) AS desired_points
    FROM public.guild2_compensation_configs config
    LEFT JOIN public.guild2_individual_contributions contribution_row
      ON contribution_row.classroom_id = p_classroom_id
     AND contribution_row.season_id = p_season_id
     AND contribution_row.year_month = p_year_month
     AND contribution_row.scoring_guild_id = config.guild_id
     AND contribution_row.guild_context_status = 'RESOLVED'
    WHERE config.classroom_id = p_classroom_id
      AND config.season_id = p_season_id
    GROUP BY config.id, config.guild_id, config.enabled, config.factor
  LOOP
    SELECT ledger.* INTO prior_event
    FROM public.guild2_gs_events ledger
    WHERE ledger.source_type = 'MEMBER_COMPENSATION'
      AND ledger.source_id = compensation.config_id
      AND ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
    ORDER BY ledger.id DESC
    LIMIT 1;

    IF compensation.enabled AND compensation.desired_points > 0 THEN
      IF prior_event.id IS NULL THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata
        ) VALUES (
          p_classroom_id, p_season_id, p_year_month, compensation.guild_id,
          'MEMBER_COMPENSATION', compensation.config_id,
          'POST', compensation.desired_points,
          '수동 지정 인원 보정 반영',
          jsonb_build_object('factor', 0.50, 'rounding', 'NEAREST_10_BASIC_ONLY')
        );
      ELSIF prior_event.points IS DISTINCT FROM compensation.desired_points THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata, reversal_of
        ) VALUES (
          prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
          'REVERSAL', prior_event.source_id,
          'REVERSAL', -prior_event.points, '인원 보정 재계산 취소',
          jsonb_build_object('reversal_reason', 'RECALCULATION'), prior_event.id
        );
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata
        ) VALUES (
          p_classroom_id, p_season_id, p_year_month, compensation.guild_id,
          'MEMBER_COMPENSATION', compensation.config_id,
          'POST', compensation.desired_points,
          '수동 지정 인원 보정 재계산 반영',
          jsonb_build_object('factor', 0.50, 'rounding', 'NEAREST_10_BASIC_ONLY', 'replaces_event_id', prior_event.id)
        );
      END IF;
    ELSIF prior_event.id IS NOT NULL THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata, reversal_of
      ) VALUES (
        prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
        'REVERSAL', prior_event.source_id,
        'REVERSAL', -prior_event.points, '인원 보정 해제 또는 산정 대상 없음',
        jsonb_build_object('reversal_reason', 'CONFIG_DISABLED_OR_EMPTY_ROSTER'), prior_event.id
      );
    END IF;
  END LOOP;

  WITH guild_scope AS (
    SELECT g.id AS guild_id
    FROM public.guilds g
    WHERE g.classroom_id = p_classroom_id
      AND g.season_id = p_season_id
      AND coalesce(g.is_active, true)
  ), ledger_totals AS (
    SELECT
      event.guild_id,
      coalesce(sum(event.points) FILTER (WHERE event.source_type = 'INDIVIDUAL_CONTRIBUTION'), 0) AS individual_subtotal,
      coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MISSION_GS'), 0) AS mission_gs_subtotal,
      coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MEMBER_COMPENSATION'), 0) AS compensation_amount,
      coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MANUAL_ADJUSTMENT'), 0) AS manual_adjustment_total,
      coalesce(sum(event.points), 0) AS draft_gs_total
    FROM public.guild2_gs_events event
    WHERE event.classroom_id = p_classroom_id
      AND event.season_id = p_season_id
      AND event.year_month = p_year_month
    GROUP BY event.guild_id
  ), roster_totals AS (
    SELECT scoring_guild_id AS guild_id, count(*) AS scoring_roster_count
    FROM public.guild2_individual_contributions
    WHERE classroom_id = p_classroom_id
      AND season_id = p_season_id
      AND year_month = p_year_month
      AND guild_context_status = 'RESOLVED'
    GROUP BY scoring_guild_id
  ), config AS (
    SELECT guild_id, enabled
    FROM public.guild2_compensation_configs
    WHERE classroom_id = p_classroom_id AND season_id = p_season_id
  )
  INSERT INTO public.guild2_monthly_gs_summaries (
    classroom_id, season_id, year_month, guild_id, scoring_roster_count,
    individual_subtotal, mission_gs_subtotal, compensation_amount, manual_adjustment_total,
    draft_gs_total, compensation_enabled, source_readiness, formula_version, calculated_at, updated_at
  )
  SELECT
    p_classroom_id, p_season_id, p_year_month, guild_scope.guild_id,
    coalesce(roster_totals.scoring_roster_count, 0),
    coalesce(ledger_totals.individual_subtotal, 0),
    coalesce(ledger_totals.mission_gs_subtotal, 0),
    coalesce(ledger_totals.compensation_amount, 0),
    coalesce(ledger_totals.manual_adjustment_total, 0),
    coalesce(ledger_totals.draft_gs_total, 0),
    coalesce(config.enabled, false),
    jsonb_build_object(
      'peer', 'NOT_READY',
      'mission', 'NOT_READY',
      'session', 'READY',
      'teacher_observation', 'READY',
      'arcade', 'NOT_READY',
      'guild_mission_gs', 'NOT_READY'
    ),
    'GUILD_CONTRIBUTION_V2_2026', now(), now()
  FROM guild_scope
  LEFT JOIN ledger_totals ON ledger_totals.guild_id = guild_scope.guild_id
  LEFT JOIN roster_totals ON roster_totals.guild_id = guild_scope.guild_id
  LEFT JOIN config ON config.guild_id = guild_scope.guild_id
  ON CONFLICT (classroom_id, season_id, year_month, guild_id) DO UPDATE SET
    scoring_roster_count = EXCLUDED.scoring_roster_count,
    individual_subtotal = EXCLUDED.individual_subtotal,
    mission_gs_subtotal = EXCLUDED.mission_gs_subtotal,
    compensation_amount = EXCLUDED.compensation_amount,
    manual_adjustment_total = EXCLUDED.manual_adjustment_total,
    draft_gs_total = EXCLUDED.draft_gs_total,
    compensation_enabled = EXCLUDED.compensation_enabled,
    source_readiness = EXCLUDED.source_readiness,
    formula_version = EXCLUDED.formula_version,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  WITH ranked AS (
    SELECT summary.id,
           rank() OVER (ORDER BY summary.draft_gs_total DESC) AS new_rank
    FROM public.guild2_monthly_gs_summaries summary
    WHERE summary.classroom_id = p_classroom_id
      AND summary.season_id = p_season_id
      AND summary.year_month = p_year_month
  )
  UPDATE public.guild2_monthly_gs_summaries summary
  SET draft_rank = ranked.new_rank,
      updated_at = now()
  FROM ranked
  WHERE summary.id = ranked.id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Teacher-only public RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_recalculate_guild2_scores(
  p_classroom_id integer,
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[G2A] teacher classroom denied.' USING ERRCODE = 'P0166';
  END IF;
  RETURN public.guild2_refresh_monthly_scores(p_classroom_id, p_year_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_record_guild2_observation(
  p_student_id integer,
  p_category text,
  p_reason text,
  p_is_public boolean DEFAULT false,
  p_occurred_on date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_year_month text;
  v_season_id integer;
  v_guild_id integer;
  v_id bigint;
  v_occurred_on date;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G2A] teacher classroom not found.' USING ERRCODE = 'P0166';
  END IF;
  IF coalesce(btrim(p_category), '') NOT IN ('COOPERATION','LEADERSHIP','RESPONSIBILITY','SUPPORT','PROBLEM_SOLVING','OTHER') THEN
    RAISE EXCEPTION '[G2A] unsupported observation category.' USING ERRCODE = 'P0167';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G2A] observation reason must be 2 to 300 characters.' USING ERRCODE = 'P0167';
  END IF;

  v_occurred_on := coalesce(p_occurred_on, (now() AT TIME ZONE 'Asia/Seoul')::date);
  v_year_month := to_char(v_occurred_on, 'YYYY-MM');
  v_season_id := public.guild2_resolve_season_for_month(v_classroom_id, v_year_month);

  SELECT gm.guild_id INTO v_guild_id
  FROM public.guild_members gm
  JOIN public.students s ON s.id = gm.student_id
  JOIN public.guilds g ON g.id = gm.guild_id
  WHERE gm.student_id = p_student_id
    AND gm.season_id = v_season_id
    AND gm.joined_at::date <= v_occurred_on
    AND (gm.left_at IS NULL OR gm.left_at::date > v_occurred_on)
    AND s.classroom_id = v_classroom_id
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND g.classroom_id = v_classroom_id
    AND g.season_id = v_season_id
  ORDER BY gm.joined_at DESC, gm.id DESC
  LIMIT 1;

  IF v_guild_id IS NULL THEN
    RAISE EXCEPTION '[G2A] active student membership was not found in this season.' USING ERRCODE = 'P0168';
  END IF;

  INSERT INTO public.guild2_observation_events (
    classroom_id, season_id, year_month, guild_id, student_id,
    event_kind, category, reason, is_public, occurred_on, idempotency_key
  ) VALUES (
    v_classroom_id, v_season_id, v_year_month, v_guild_id, p_student_id,
    'RECOGNITION', btrim(p_category), btrim(p_reason), coalesce(p_is_public, false), v_occurred_on,
    coalesce(p_idempotency_key, gen_random_uuid())
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.guild2_observation_events
    WHERE idempotency_key = p_idempotency_key
      AND classroom_id = v_classroom_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '[G2A] observation idempotency key belongs to another classroom.' USING ERRCODE = 'P0166';
    END IF;
  END IF;

  PERFORM public.guild2_refresh_monthly_scores(v_classroom_id, v_year_month);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_reverse_guild2_observation(
  p_observation_event_id bigint,
  p_reason text,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_original public.guild2_observation_events%ROWTYPE;
  v_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G2A] reversal reason must be 2 to 300 characters.' USING ERRCODE = 'P0167';
  END IF;

  SELECT * INTO v_original
  FROM public.guild2_observation_events
  WHERE id = p_observation_event_id
    AND classroom_id = v_classroom_id
    AND event_kind = 'RECOGNITION'
  FOR UPDATE;

  IF v_original.id IS NULL THEN
    RAISE EXCEPTION '[G2A] observation record not found in teacher classroom.' USING ERRCODE = 'P0168';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.guild2_observation_events reversal
    WHERE reversal.reversal_of = v_original.id AND reversal.event_kind = 'REVERSAL'
  ) THEN
    SELECT reversal.id INTO v_id
    FROM public.guild2_observation_events reversal
    WHERE reversal.reversal_of = v_original.id
      AND reversal.event_kind = 'REVERSAL'
      AND p_idempotency_key IS NOT NULL
      AND reversal.idempotency_key = p_idempotency_key;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
    RAISE EXCEPTION '[G2A] observation record was already reversed.' USING ERRCODE = 'P0169';
  END IF;

  INSERT INTO public.guild2_observation_events (
    classroom_id, season_id, year_month, guild_id, student_id,
    event_kind, category, reason, is_public, occurred_on, reversal_of, idempotency_key
  ) VALUES (
    v_original.classroom_id, v_original.season_id, v_original.year_month,
    v_original.guild_id, v_original.student_id,
    'REVERSAL', v_original.category, btrim(p_reason), false, v_original.occurred_on,
    v_original.id, coalesce(p_idempotency_key, gen_random_uuid())
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.guild2_observation_events
    WHERE idempotency_key = p_idempotency_key
      AND classroom_id = v_classroom_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '[G2A] observation idempotency key belongs to another classroom.' USING ERRCODE = 'P0166';
    END IF;
  END IF;

  PERFORM public.guild2_refresh_monthly_scores(v_classroom_id, v_original.year_month);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild2_compensation(
  p_guild_id integer,
  p_season_id integer,
  p_enabled boolean,
  p_year_month text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_config_id bigint;
  v_resolved_season_id integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  v_resolved_season_id := public.guild2_resolve_season_for_month(v_classroom_id, p_year_month);
  IF p_season_id IS DISTINCT FROM v_resolved_season_id THEN
    RAISE EXCEPTION '[G2A] guild compensation season does not match the selected month.' USING ERRCODE = 'P0167';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guilds g
    WHERE g.id = p_guild_id
      AND g.classroom_id = v_classroom_id
      AND g.season_id = p_season_id
  ) THEN
    RAISE EXCEPTION '[G2A] guild is not in the teacher classroom and season.' USING ERRCODE = 'P0168';
  END IF;

  INSERT INTO public.guild2_compensation_configs (
    classroom_id, season_id, guild_id, enabled, factor, changed_by_user_id, changed_at
  ) VALUES (
    v_classroom_id, p_season_id, p_guild_id, p_enabled, 0.50, auth.uid(), now()
  )
  ON CONFLICT (season_id, guild_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    factor = 0.50,
    changed_by_user_id = auth.uid(),
    changed_at = now()
  RETURNING id INTO v_config_id;

  PERFORM public.guild2_refresh_monthly_scores(v_classroom_id, p_year_month);
  RETURN v_config_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_post_guild2_gs_adjustment(
  p_classroom_id integer,
  p_year_month text,
  p_guild_id integer,
  p_points numeric,
  p_reason text,
  p_idempotency_key uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id integer;
  v_event_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[G2A] teacher classroom denied.' USING ERRCODE = 'P0166';
  END IF;
  IF p_idempotency_key IS NULL OR p_points IS NULL OR p_points = 0 OR abs(p_points) > 5000 THEN
    RAISE EXCEPTION '[G2A] adjustment points or idempotency key is invalid.' USING ERRCODE = 'P0167';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G2A] adjustment reason must be 2 to 300 characters.' USING ERRCODE = 'P0167';
  END IF;

  v_season_id := public.guild2_resolve_season_for_month(p_classroom_id, p_year_month);
  IF NOT EXISTS (
    SELECT 1 FROM public.guilds g
    WHERE g.id = p_guild_id AND g.classroom_id = p_classroom_id AND g.season_id = v_season_id
  ) THEN
    RAISE EXCEPTION '[G2A] adjustment guild is outside the selected classroom and season.' USING ERRCODE = 'P0168';
  END IF;

  INSERT INTO public.guild2_gs_events (
    classroom_id, season_id, year_month, guild_id, source_type,
    event_kind, points, reason, metadata, idempotency_key
  ) VALUES (
    p_classroom_id, v_season_id, p_year_month, p_guild_id, 'MANUAL_ADJUSTMENT',
    'POST', round(p_points, 2), btrim(p_reason), jsonb_build_object('entered_by', 'TEACHER'), p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.guild2_gs_events
    WHERE idempotency_key = p_idempotency_key
      AND classroom_id = p_classroom_id;
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION '[G2A] GS idempotency key belongs to another classroom.' USING ERRCODE = 'P0166';
    END IF;
  END IF;

  PERFORM public.guild2_refresh_monthly_gs_summary(p_classroom_id, p_year_month, v_season_id);
  RETURN v_event_id;
END;
$$;

-- The old formula is verified incompatible with Guild 2 and has no active
-- frontend caller. Keep its historical tables intact, but close direct public
-- execution paths so a browser cannot accidentally write legacy score data.
REVOKE ALL ON FUNCTION public.calculate_individual_contribution(integer, character varying) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_monthly_guild_gs(integer, character varying) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_guild_mission_log(integer, integer, integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_guild_activity(integer, integer, public.guild_activity_type, integer, boolean, date) FROM PUBLIC, anon, authenticated;

-- Helpers must never be directly callable from the browser.
REVOKE ALL ON FUNCTION public.guild2_resolve_season_for_month(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_scores(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_gs_summary(integer, text, integer) FROM PUBLIC, anon, authenticated;

-- Public Guild 2 RPCs are teacher-only internally and callable only by an
-- authenticated application session; anon/PUBLIC receive no execute grant.
REVOKE ALL ON FUNCTION public.teacher_recalculate_guild2_scores(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_record_guild2_observation(integer, text, text, boolean, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_reverse_guild2_observation(bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_guild2_compensation(integer, integer, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_post_guild2_gs_adjustment(integer, text, integer, numeric, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_recalculate_guild2_scores(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_record_guild2_observation(integer, text, text, boolean, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_reverse_guild2_observation(bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild2_compensation(integer, integer, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_post_guild2_gs_adjustment(integer, text, integer, numeric, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- -----------------------------------------------------------------------------
-- 5. SQL Editor-safe structural postcheck (does not call auth-dependent RPCs)
-- -----------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'guild2_observation_events',
    'guild2_compensation_configs',
    'guild2_individual_contributions',
    'guild2_gs_events',
    'guild2_monthly_gs_summaries'
  )
ORDER BY table_name, ordinal_position;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'teacher_recalculate_guild2_scores',
    'teacher_record_guild2_observation',
    'teacher_reverse_guild2_observation',
    'teacher_set_guild2_compensation',
    'teacher_post_guild2_gs_adjustment'
  )
ORDER BY p.proname;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
WHERE n.nspname = 'public'
  AND p.proname IN (
    'teacher_recalculate_guild2_scores',
    'teacher_record_guild2_observation',
    'teacher_reverse_guild2_observation',
    'teacher_set_guild2_compensation',
    'teacher_post_guild2_gs_adjustment',
    'calculate_individual_contribution',
    'calculate_monthly_guild_gs',
    'evaluate_guild_mission_log',
    'record_guild_activity'
  )
ORDER BY function_name, identity_arguments, grantee;
