-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade record verification framework v2
-- 2026-09-06
--
-- User policy locked for this migration:
--   * General Arcade play remains free/live.
--   * Monthly reward ranks require teacher-supervised verification.
--   * Default verification: current Top 10 / 80% threshold / max 3 consumed tries.
--   * Guild 2 Arcade applied bonus remains capped at +90 per student/month.
--   * Existing FINALIZED snapshots are immutable and are never rewritten.
--   * Game #01 reuses the existing authoritative validator.
--   * Verification runs never enter normal live/PB/statistics period membership.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Production preflight. Fail before changing schema if the live baseline is
--    not the one this incremental migration was reviewed against.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_recent_inflight bigint;
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.guild_seasons') IS NULL
     OR to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_game_rule_versions') IS NULL
     OR to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_run_submissions') IS NULL
     OR to_regclass('public.arcade_run_moderation_events') IS NULL
     OR to_regclass('public.arcade_monthly_finalizations') IS NULL
     OR to_regclass('public.arcade_monthly_snapshots') IS NULL
     OR to_regclass('public.arcade_monthly_snapshot_entries') IS NULL
     OR to_regclass('public.arcade_monthly_snapshot_student_ranks') IS NULL
     OR to_regclass('public.guild2_individual_contributions') IS NULL
     OR to_regclass('public.arcade_analytics_game_semantics') IS NULL
     OR to_regclass('public.test_classroom_fixtures') IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY] required production tables are missing.';
  END IF;

  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.is_official_participant(integer)') IS NULL
     OR to_regprocedure('public.arcade_generate_run_seed()') IS NULL
     OR to_regprocedure('public.arcade_set_updated_at()') IS NULL
     OR to_regprocedure('public.student_begin_arcade_run(bigint)') IS NULL
     OR to_regprocedure('public.student_submit_focus_reaction_01_run(bigint,jsonb,integer)') IS NULL
     OR to_regprocedure('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_top10(integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY] required production functions are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.arcade_ranking_periods'::regclass
      AND c.conname = 'arcade_ranking_period_status_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%DRAFT%ACTIVE%FINALIZED%'
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] ranking period status constraint differs from reviewed baseline.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.guild2_individual_contributions'::regclass
      AND c.conname = 'guild2_contribution_arcade_applied_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%90%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.guild2_individual_contributions'::regclass
      AND c.conname = 'guild2_contribution_final_range_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%990%'
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] locked Guild 2 +90 / 990 contract is missing.';
  END IF;

  -- Deployment safety: do not take DDL locks while a student is actively
  -- starting/submitting a run. Old abandoned runtime rows do not block deploy.
  SELECT count(*) INTO v_recent_inflight
  FROM public.arcade_runs r
  WHERE r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    AND r.created_at >= clock_timestamp() - interval '15 minutes';
  IF v_recent_inflight > 0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % recent in-flight Arcade run(s) exist; deploy when active play has stopped.', v_recent_inflight;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='arcade_runs'
      AND column_name IN ('run_context','verification_session_id')
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('arcade_verification_game_configs'),('arcade_verification_period_games'),
      ('arcade_verification_provisional_entries'),('arcade_verification_sessions'),
      ('arcade_verification_attempts'),('arcade_verification_official_results'),
      ('arcade_verification_corrections'),('arcade_verification_audit_events')
    ) AS expected(name)
    WHERE to_regclass('public.' || expected.name) IS NOT NULL
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification schema appears partially/already applied; stop and inspect before rerunning.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.arcade_games WHERE code = 'focus_reaction_01'
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] Game #01 is missing from production registry.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Period lifecycle + run context.
-- -----------------------------------------------------------------------------
ALTER TABLE public.arcade_ranking_periods
  DROP CONSTRAINT arcade_ranking_period_status_check;
ALTER TABLE public.arcade_ranking_periods
  ADD CONSTRAINT arcade_ranking_period_status_check
  CHECK (status IN ('DRAFT','ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED'));

ALTER TABLE public.arcade_runs
  ADD COLUMN run_context text NOT NULL DEFAULT 'STANDARD';
ALTER TABLE public.arcade_runs
  ADD CONSTRAINT arcade_runs_context_check
  CHECK (run_context IN ('STANDARD','VERIFICATION'));

CREATE INDEX ix_arcade_runs_context_class_game
  ON public.arcade_runs(run_context, classroom_id, game_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Verification-owned tables.
-- -----------------------------------------------------------------------------
CREATE TABLE public.arcade_verification_game_configs (
  game_id bigint PRIMARY KEY REFERENCES public.arcade_games(id),
  is_enabled boolean NOT NULL DEFAULT true,
  target_rank_count integer NOT NULL DEFAULT 10,
  threshold_percent integer NOT NULL DEFAULT 80,
  max_attempts integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_config_target_check CHECK (target_rank_count BETWEEN 1 AND 10),
  CONSTRAINT arcade_verification_config_threshold_check CHECK (threshold_percent BETWEEN 1 AND 100),
  CONSTRAINT arcade_verification_config_attempt_check CHECK (max_attempts BETWEEN 1 AND 10)
);

INSERT INTO public.arcade_verification_game_configs(
  game_id, is_enabled, target_rank_count, threshold_percent, max_attempts
)
SELECT id, true, 10, 80, 3
FROM public.arcade_games
WHERE code = 'focus_reaction_01'
ON CONFLICT (game_id) DO NOTHING;

-- Freeze the eligible game set and its verification policy per period. This
-- prevents later game registry/config changes from altering an already-frozen
-- month, including games with zero participants.
CREATE TABLE public.arcade_verification_period_games (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  target_rank_count integer NOT NULL,
  threshold_percent integer NOT NULL,
  max_attempts integer NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_period_game_unique UNIQUE(period_id, game_id),
  CONSTRAINT arcade_verification_period_game_target_check CHECK (target_rank_count BETWEEN 1 AND 10),
  CONSTRAINT arcade_verification_period_game_threshold_check CHECK (threshold_percent BETWEEN 1 AND 100),
  CONSTRAINT arcade_verification_period_game_attempt_check CHECK (max_attempts BETWEEN 1 AND 10)
);
CREATE INDEX ix_arcade_verification_period_games_period
  ON public.arcade_verification_period_games(period_id, game_id);

CREATE TABLE public.arcade_verification_provisional_entries (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  source_run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  rule_version_id bigint NOT NULL REFERENCES public.arcade_game_rule_versions(id),
  official_score bigint NOT NULL,
  official_duration_ms integer NOT NULL,
  stats jsonb NOT NULL,
  achieved_at timestamptz NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_provisional_unique UNIQUE(period_id, game_id, student_id),
  CONSTRAINT arcade_verification_provisional_score_check CHECK (official_score >= 0),
  CONSTRAINT arcade_verification_provisional_duration_check CHECK (official_duration_ms >= 0),
  CONSTRAINT arcade_verification_provisional_stats_check CHECK (jsonb_typeof(stats) = 'object')
);
CREATE INDEX ix_arcade_verification_provisional_period_game
  ON public.arcade_verification_provisional_entries(period_id, game_id, official_score DESC, achieved_at, source_run_id);

CREATE TABLE public.arcade_verification_sessions (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  provisional_entry_id bigint NOT NULL REFERENCES public.arcade_verification_provisional_entries(id),
  provisional_source_run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  rule_version_id bigint NOT NULL REFERENCES public.arcade_game_rule_versions(id),
  provisional_score bigint NOT NULL,
  verification_threshold bigint NOT NULL,
  threshold_percent integer NOT NULL,
  max_attempts integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  success_achieved boolean NOT NULL DEFAULT false,
  result_status text,
  activated_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_session_status_check CHECK (status IN ('ACTIVE','COMPLETED','RESET','OVERRIDDEN')),
  CONSTRAINT arcade_verification_session_result_check CHECK (result_status IS NULL OR result_status IN ('SUCCESS','FAILURE_VALID','FAILURE_NO_VALID')),
  CONSTRAINT arcade_verification_session_score_check CHECK (provisional_score >= 0 AND verification_threshold >= 0),
  CONSTRAINT arcade_verification_session_threshold_check CHECK (threshold_percent BETWEEN 1 AND 100),
  CONSTRAINT arcade_verification_session_attempt_check CHECK (max_attempts BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX ux_arcade_verification_one_active_session
  ON public.arcade_verification_sessions(period_id, game_id, student_id)
  WHERE status = 'ACTIVE';
CREATE INDEX ix_arcade_verification_sessions_period_game
  ON public.arcade_verification_sessions(period_id, game_id, student_id, activated_at DESC);

ALTER TABLE public.arcade_runs
  ADD COLUMN verification_session_id bigint REFERENCES public.arcade_verification_sessions(id);
ALTER TABLE public.arcade_runs
  ADD CONSTRAINT arcade_runs_verification_context_shape_check CHECK (
    (run_context = 'STANDARD' AND verification_session_id IS NULL)
    OR (run_context = 'VERIFICATION' AND verification_session_id IS NOT NULL)
  );
CREATE INDEX ix_arcade_runs_verification_session
  ON public.arcade_runs(verification_session_id, status, created_at DESC)
  WHERE verification_session_id IS NOT NULL;

CREATE TABLE public.arcade_verification_attempts (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES public.arcade_verification_sessions(id),
  issue_number integer NOT NULL,
  opportunity_number integer NOT NULL,
  run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED',
  consumed boolean NOT NULL DEFAULT false,
  valid_run boolean NOT NULL DEFAULT false,
  terminal_outcome text,
  official_score bigint,
  official_duration_ms integer,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  restored_at timestamptz,
  restored_by_user_id uuid,
  restore_reason text,
  CONSTRAINT arcade_verification_attempt_issue_unique UNIQUE(session_id, issue_number),
  CONSTRAINT arcade_verification_attempt_run_unique UNIQUE(run_id),
  CONSTRAINT arcade_verification_attempt_idempotency_unique UNIQUE(idempotency_key),
  CONSTRAINT arcade_verification_attempt_status_check CHECK (status IN ('ISSUED','TERMINAL','TECHNICAL_CANCELLED','RESTORED')),
  CONSTRAINT arcade_verification_attempt_number_check CHECK (issue_number >= 1 AND opportunity_number BETWEEN 1 AND 10),
  CONSTRAINT arcade_verification_attempt_score_check CHECK (official_score IS NULL OR official_score >= 0),
  CONSTRAINT arcade_verification_attempt_duration_check CHECK (official_duration_ms IS NULL OR official_duration_ms >= 0),
  CONSTRAINT arcade_verification_attempt_stats_check CHECK (jsonb_typeof(stats) = 'object')
);
CREATE INDEX ix_arcade_verification_attempts_session
  ON public.arcade_verification_attempts(session_id, issue_number);
CREATE UNIQUE INDEX ux_arcade_verification_consumed_opportunity
  ON public.arcade_verification_attempts(session_id, opportunity_number)
  WHERE consumed;

CREATE TABLE public.arcade_verification_official_results (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  session_id bigint REFERENCES public.arcade_verification_sessions(id),
  decision_kind text NOT NULL,
  source_run_id bigint REFERENCES public.arcade_runs(id),
  official_score bigint,
  official_duration_ms integer,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  achieved_at timestamptz,
  ranking_eligible boolean NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_official_unique UNIQUE(period_id, game_id, student_id),
  CONSTRAINT arcade_verification_official_kind_check CHECK (decision_kind IN (
    'SESSION_SUCCESS_PROVISIONAL','SESSION_SUCCESS_VERIFICATION',
    'SESSION_FAILURE_VERIFICATION','SESSION_FAILURE_NO_VALID',
    'MANUAL_SOURCE','MANUAL_NONE'
  )),
  CONSTRAINT arcade_verification_official_shape_check CHECK (
    (ranking_eligible AND source_run_id IS NOT NULL AND official_score IS NOT NULL AND achieved_at IS NOT NULL)
    OR (NOT ranking_eligible AND source_run_id IS NULL AND official_score IS NULL AND achieved_at IS NULL)
  ),
  CONSTRAINT arcade_verification_official_score_check CHECK (official_score IS NULL OR official_score >= 0),
  CONSTRAINT arcade_verification_official_duration_check CHECK (official_duration_ms IS NULL OR official_duration_ms >= 0),
  CONSTRAINT arcade_verification_official_stats_check CHECK (jsonb_typeof(stats) = 'object')
);
CREATE INDEX ix_arcade_verification_official_period_game
  ON public.arcade_verification_official_results(period_id, game_id, ranking_eligible, official_score DESC, achieved_at);

CREATE TABLE public.arcade_verification_corrections (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  action_kind text NOT NULL,
  source_run_id bigint REFERENCES public.arcade_runs(id),
  reason text NOT NULL,
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_correction_kind_check CHECK (action_kind IN ('SET_SOURCE','NO_RECORD')),
  CONSTRAINT arcade_verification_correction_shape_check CHECK (
    (action_kind = 'SET_SOURCE' AND source_run_id IS NOT NULL)
    OR (action_kind = 'NO_RECORD' AND source_run_id IS NULL)
  ),
  CONSTRAINT arcade_verification_correction_reason_check CHECK (char_length(btrim(reason)) BETWEEN 2 AND 500)
);
CREATE INDEX ix_arcade_verification_corrections_subject
  ON public.arcade_verification_corrections(period_id, game_id, student_id, created_at DESC);

CREATE TABLE public.arcade_verification_audit_events (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint REFERENCES public.arcade_games(id),
  student_id integer REFERENCES public.students(id),
  session_id bigint REFERENCES public.arcade_verification_sessions(id),
  attempt_id bigint REFERENCES public.arcade_verification_attempts(id),
  event_kind text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_audit_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX ix_arcade_verification_audit_period
  ON public.arcade_verification_audit_events(period_id, created_at DESC, id DESC);

CREATE TRIGGER arcade_verification_game_configs_set_updated_at
  BEFORE UPDATE ON public.arcade_verification_game_configs
  FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();
CREATE TRIGGER arcade_verification_sessions_set_updated_at
  BEFORE UPDATE ON public.arcade_verification_sessions
  FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();
CREATE TRIGGER arcade_verification_official_results_set_updated_at
  BEFORE UPDATE ON public.arcade_verification_official_results
  FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Direct table access is closed. All important state transitions go through
--    protected RPCs/functions.
-- -----------------------------------------------------------------------------
ALTER TABLE public.arcade_verification_game_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_period_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_provisional_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_official_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.arcade_verification_game_configs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_period_games FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_provisional_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_official_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_corrections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_audit_events FROM PUBLIC, anon, authenticated;

-- Explicitly close sequence access as well. Table DML is already blocked, but
-- keeping the verification-owned identity sequences private avoids relying on
-- cluster/default-privilege assumptions.
REVOKE ALL ON SEQUENCE public.arcade_verification_period_games_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_provisional_entries_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_sessions_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_attempts_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_official_results_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_corrections_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_audit_events_id_seq FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Core resolver. MONTHLY verification states read frozen provisional rows +
--    official overrides; FINALIZED reads immutable snapshots. SEASON remains
--    the existing time-range leaderboard and never enters verification.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_snapshot_id bigint;
BEGIN
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
    AND classroom_id = p_classroom_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status = 'FINALIZED' THEN
    SELECT s.id INTO v_snapshot_id
    FROM public.arcade_monthly_snapshots s
    WHERE s.period_id = v_period.id
      AND s.game_id = p_game_id;
    IF v_snapshot_id IS NULL THEN
      RAISE EXCEPTION '[ARCADE] finalized monthly snapshot is missing for this period/game; data integrity error.'
        USING ERRCODE = 'P0220';
    END IF;

    RETURN QUERY
    SELECT r.source_run_id, r.student_id, r.official_score, r.achieved_at, r.rank
    FROM public.arcade_monthly_snapshot_student_ranks r
    WHERE r.snapshot_id = v_snapshot_id
      AND public.is_official_participant(r.student_id)
    ORDER BY r.rank;
    RETURN;
  END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RETURN QUERY
    WITH candidates AS (
      SELECT
        COALESCE(o.source_run_id, p.source_run_id) AS source_run_id,
        p.student_id,
        COALESCE(o.official_score, p.official_score) AS official_score,
        COALESCE(o.achieved_at, p.achieved_at) AS achieved_at
      FROM public.arcade_verification_provisional_entries p
      LEFT JOIN public.arcade_verification_official_results o
        ON o.period_id = p.period_id
       AND o.game_id = p.game_id
       AND o.student_id = p.student_id
      WHERE p.classroom_id = p_classroom_id
        AND p.period_id = p_period_id
        AND p.game_id = p_game_id
        AND public.is_official_participant(p.student_id)
        AND COALESCE(o.ranking_eligible, true)
    ), ranked AS (
      SELECT c.*,
             row_number() OVER (
               ORDER BY c.official_score DESC, c.achieved_at ASC, c.source_run_id ASC
             )::integer AS rank
      FROM candidates c
      WHERE c.source_run_id IS NOT NULL AND c.official_score IS NOT NULL
    )
    SELECT r.source_run_id, r.student_id, r.official_score, r.achieved_at, r.rank
    FROM ranked r
    ORDER BY r.rank;
    RETURN;
  END IF;

  -- ACTIVE monthly and SEASON periods remain live and use STANDARD runs only.
  RETURN QUERY
  WITH candidate_runs AS (
    SELECT r.id AS source_run_id,
           r.student_id,
           r.official_score,
           r.game_over_at,
           row_number() OVER (
             PARTITION BY r.student_id
             ORDER BY r.official_score DESC, r.game_over_at ASC, r.id ASC
           ) AS student_best_row
    FROM public.arcade_runs r
    WHERE r.classroom_id = p_classroom_id
      AND r.game_id = p_game_id
      AND r.run_context = 'STANDARD'
      AND r.status = 'VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id = r.id AND m.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT c.source_run_id,
           c.student_id,
           c.official_score,
           c.game_over_at,
           row_number() OVER (
             ORDER BY c.official_score DESC, c.game_over_at ASC, c.source_run_id ASC
           )::integer AS rank
    FROM candidate_runs c
    WHERE c.student_best_row = 1
  )
  SELECT r.source_run_id, r.student_id, r.official_score, r.game_over_at, r.rank
  FROM ranked r
  ORDER BY r.rank;
END;
$$;

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
  SELECT r.source_run_id,
         r.student_id,
         r.official_score,
         r.achieved_at,
         r.rank,
         CASE
           WHEN r.rank = 1 THEN 30::numeric
           WHEN r.rank = 2 THEN 27::numeric
           WHEN r.rank = 3 THEN 24::numeric
           WHEN r.rank BETWEEN 4 AND 6 THEN 18::numeric
           WHEN r.rank BETWEEN 7 AND 10 THEN 15::numeric
         END AS raw_bonus
  FROM public.arcade_resolve_period_student_ranks(p_classroom_id,p_period_id,p_game_id) r
  WHERE r.rank <= 10
  ORDER BY r.rank;
$$;

-- -----------------------------------------------------------------------------
-- 5. Internal readiness + session finalization/capture helpers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_refresh_verification_readiness(
  p_classroom_id integer,
  p_period_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game record;
  v_game_missing bigint;
  v_missing bigint := 0;
  v_next text;
BEGIN
  -- Serialize lifecycle transitions on the period row. All public teacher
  -- mutations follow PERIOD -> SESSION -> ATTEMPT when those locks are needed.
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = p_classroom_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE = 'P0250';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' OR v_period.status = 'FINALIZED' THEN
    RETURN v_period.status;
  END IF;

  FOR v_game IN
    SELECT pg.game_id, pg.target_rank_count
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id = v_period.id
    ORDER BY pg.game_id
  LOOP
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(p_classroom_id, v_period.id, v_game.game_id) r
    WHERE r.rank <= v_game.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id = v_period.id
          AND o.game_id = v_game.game_id
          AND o.student_id = r.student_id
      );
    v_missing := v_missing + v_game_missing;
  END LOOP;

  v_next := CASE WHEN v_missing = 0 THEN 'READY_TO_FINALIZE' ELSE 'VERIFICATION' END;
  IF v_period.status IS DISTINCT FROM v_next THEN
    UPDATE public.arcade_ranking_periods
    SET status = v_next
    WHERE id = v_period.id
      AND status IN ('VERIFICATION','READY_TO_FINALIZE');
  END IF;
  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_finalize_verification_session(
  p_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_used integer;
  v_best record;
  v_result_kind text;
  v_result_status text;
  v_source_run_id bigint;
  v_score bigint;
  v_duration integer;
  v_stats jsonb := '{}'::jsonb;
  v_achieved_at timestamptz;
  v_eligible boolean := true;
  v_period_status text;
BEGIN
  -- Read the owner first without a lock, then serialize PERIOD -> SESSION.
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session not found.' USING ERRCODE = 'P0251';
  END IF;
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = v_session.period_id
    AND classroom_id = v_session.classroom_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE = 'P0216';
  END IF;
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF v_session.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('session_id',v_session.id,'status',v_session.status,'result_status',v_session.result_status);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arcade_runs r
    WHERE r.verification_session_id = v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] a verification run is still in progress.' USING ERRCODE = 'P0268';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id = v_session.id AND a.consumed;
  IF NOT v_session.success_achieved AND v_used < v_session.max_attempts THEN
    RAISE EXCEPTION '[ARCADE VERIFY] remaining attempts exist and success has not been reached.' USING ERRCODE = 'P0252';
  END IF;

  SELECT * INTO v_provisional
  FROM public.arcade_verification_provisional_entries p
  WHERE p.id = v_session.provisional_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen provisional source is missing.' USING ERRCODE = 'P0253';
  END IF;

  SELECT a.run_id, a.official_score, a.official_duration_ms, a.stats, r.game_over_at
  INTO v_best
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_runs r ON r.id = a.run_id
  WHERE a.session_id = v_session.id
    AND a.status = 'TERMINAL'
    AND a.consumed
    AND a.valid_run
    AND a.official_score IS NOT NULL
  ORDER BY a.official_score DESC, r.game_over_at ASC, a.run_id ASC
  LIMIT 1;

  IF v_session.success_achieved THEN
    v_result_status := 'SUCCESS';
    IF v_best.run_id IS NOT NULL AND v_best.official_score > v_provisional.official_score THEN
      v_result_kind := 'SESSION_SUCCESS_VERIFICATION';
      v_source_run_id := v_best.run_id;
      v_score := v_best.official_score;
      v_duration := v_best.official_duration_ms;
      v_stats := v_best.stats;
      v_achieved_at := v_best.game_over_at;
    ELSE
      v_result_kind := 'SESSION_SUCCESS_PROVISIONAL';
      v_source_run_id := v_provisional.source_run_id;
      v_score := v_provisional.official_score;
      v_duration := v_provisional.official_duration_ms;
      v_stats := v_provisional.stats;
      v_achieved_at := v_provisional.achieved_at;
    END IF;
  ELSIF v_best.run_id IS NOT NULL THEN
    v_result_status := 'FAILURE_VALID';
    v_result_kind := 'SESSION_FAILURE_VERIFICATION';
    v_source_run_id := v_best.run_id;
    v_score := v_best.official_score;
    v_duration := v_best.official_duration_ms;
    v_stats := v_best.stats;
    v_achieved_at := v_best.game_over_at;
  ELSE
    v_result_status := 'FAILURE_NO_VALID';
    v_result_kind := 'SESSION_FAILURE_NO_VALID';
    v_source_run_id := NULL;
    v_score := NULL;
    v_duration := NULL;
    v_stats := '{}'::jsonb;
    v_achieved_at := NULL;
    v_eligible := false;
  END IF;

  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,
    decided_by_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_result_kind,
    v_source_run_id,v_score,v_duration,v_stats,v_achieved_at,v_eligible,auth.uid()
  )
  ON CONFLICT (period_id,game_id,student_id) DO UPDATE SET
    session_id=EXCLUDED.session_id,
    decision_kind=EXCLUDED.decision_kind,
    source_run_id=EXCLUDED.source_run_id,
    official_score=EXCLUDED.official_score,
    official_duration_ms=EXCLUDED.official_duration_ms,
    stats=EXCLUDED.stats,
    achieved_at=EXCLUDED.achieved_at,
    ranking_eligible=EXCLUDED.ranking_eligible,
    decided_by_user_id=EXCLUDED.decided_by_user_id,
    decided_at=now(),
    updated_at=now();

  UPDATE public.arcade_verification_sessions
  SET status='COMPLETED', result_status=v_result_status, ended_at=now()
  WHERE id=v_session.id;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,
    'SESSION_COMPLETED',
    jsonb_build_object('result_status',v_result_status,'decision_kind',v_result_kind,'source_run_id',v_source_run_id,'official_score',v_score),
    auth.uid()
  );

  v_period_status := public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object(
    'session_id',v_session.id,'status','COMPLETED','result_status',v_result_status,
    'decision_kind',v_result_kind,'official_source_run_id',v_source_run_id,
    'official_score',v_score,'ranking_eligible',v_eligible,'period_status',v_period_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_capture_verification_attempt(
  p_run_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.arcade_runs%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_used integer;
  v_valid boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id;
  IF NOT FOUND OR v_run.run_context <> 'VERIFICATION' THEN
    RETURN jsonb_build_object('captured',false,'reason','NOT_VERIFICATION');
  END IF;
  IF v_run.status NOT IN ('VERIFIED','REJECTED') THEN
    RETURN jsonb_build_object('captured',false,'reason','NOT_TERMINAL');
  END IF;

  -- Resolve ownership without locks, then use the shared PERIOD -> SESSION ->
  -- ATTEMPT order. The Game #01 submit RPC already owns the run row lock.
  SELECT * INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE run_id=v_run.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.' USING ERRCODE='P0254';
  END IF;
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session is missing.' USING ERRCODE='P0255';
  END IF;
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE='P0216';
  END IF;
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id
  FOR UPDATE;
  SELECT * INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE id=v_attempt.id
  FOR UPDATE;
  IF v_attempt.status = 'TERMINAL' AND v_attempt.consumed THEN
    RETURN jsonb_build_object('captured',true,'already_captured',true,'attempt_id',v_attempt.id);
  END IF;
  IF v_attempt.status IN ('TECHNICAL_CANCELLED','RESTORED') THEN
    RETURN jsonb_build_object('captured',false,'reason',v_attempt.status);
  END IF;
  IF v_session.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session is missing.' USING ERRCODE='P0255';
  END IF;

  v_valid := v_run.status='VERIFIED' AND v_run.official_score IS NOT NULL;
  UPDATE public.arcade_verification_attempts
  SET status='TERMINAL', consumed=true, valid_run=v_valid,
      terminal_outcome=CASE WHEN v_valid THEN 'VERIFIED' ELSE coalesce(v_run.rejection_code,'REJECTED') END,
      official_score=CASE WHEN v_valid THEN v_run.official_score ELSE NULL END,
      official_duration_ms=CASE WHEN v_valid THEN v_run.official_duration_ms ELSE NULL END,
      stats=CASE WHEN v_valid THEN v_run.stats ELSE '{}'::jsonb END,
      terminal_at=now()
  WHERE id=v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_valid AND v_run.official_score >= v_session.verification_threshold THEN
    UPDATE public.arcade_verification_sessions
    SET success_achieved=true
    WHERE id=v_session.id;
    v_session.success_achieved := true;
  END IF;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_attempt.id,
    'ATTEMPT_TERMINAL',
    jsonb_build_object('run_id',v_run.id,'opportunity_number',v_attempt.opportunity_number,'valid_run',v_valid,'outcome',v_attempt.terminal_outcome,'official_score',v_attempt.official_score),
    auth.uid()
  );

  SELECT count(*)::integer INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id AND a.consumed;
  IF v_used >= v_session.max_attempts THEN
    v_result := public.arcade_finalize_verification_session(v_session.id);
  END IF;

  RETURN jsonb_build_object(
    'captured',true,'attempt_id',v_attempt.id,'consumed_attempts',v_used,
    'success_achieved',v_session.success_achieved,'session_result',v_result
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Teacher lifecycle RPCs.
-- -----------------------------------------------------------------------------
-- General period editing remains available only before verification starts.
-- Once frozen, lifecycle changes must go through verification/finalization RPCs.
CREATE OR REPLACE FUNCTION public.teacher_update_arcade_ranking_period(
  p_period_id bigint,
  p_display_name text,
  p_guild_season_id integer,
  p_contribution_year_month text,
  p_starts_at timestamptz,
  p_ends_at_exclusive timestamptz,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE='P0188';
  END IF;
  IF v_period.status NOT IN ('DRAFT','ACTIVE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen/finalized periods cannot be changed by the general period editor.' USING ERRCODE='P0180';
  END IF;
  IF p_status NOT IN ('DRAFT','ACTIVE') THEN
    RAISE EXCEPTION '[ARCADE] general period updates may set only DRAFT or ACTIVE.' USING ERRCODE='P0189';
  END IF;
  IF coalesce(btrim(p_display_name),'')='' OR char_length(btrim(p_display_name))>120 THEN
    RAISE EXCEPTION '[ARCADE] period display name must be 1 to 120 characters.' USING ERRCODE='P0184';
  END IF;
  IF p_ends_at_exclusive<=p_starts_at THEN
    RAISE EXCEPTION '[ARCADE] period end must be after its start.' USING ERRCODE='P0185';
  END IF;
  IF (v_period.period_kind='MONTHLY' AND coalesce(p_contribution_year_month,'')!~'^[0-9]{4}-(0[1-9]|1[0-2])$')
     OR (v_period.period_kind='SEASON' AND p_contribution_year_month IS NOT NULL) THEN
    RAISE EXCEPTION '[ARCADE] monthly periods require YYYY-MM; season periods must not have a contribution month.' USING ERRCODE='P0186';
  END IF;
  IF p_guild_season_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.guild_seasons gs
    WHERE gs.id=p_guild_season_id AND gs.classroom_id=v_classroom_id
  ) THEN
    RAISE EXCEPTION '[ARCADE] guild season does not belong to this classroom.' USING ERRCODE='P0187';
  END IF;
  UPDATE public.arcade_ranking_periods
  SET display_name=btrim(p_display_name),guild_season_id=p_guild_season_id,
      contribution_year_month=p_contribution_year_month,starts_at=p_starts_at,
      ends_at_exclusive=p_ends_at_exclusive,status=p_status
  WHERE id=v_period.id
  RETURNING * INTO v_period;
  RETURN jsonb_build_object('period_id',v_period.id,'classroom_id',v_period.classroom_id,'status',v_period.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_freeze_arcade_monthly_period(
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
  v_start_date date;
  v_end_date date;
  v_missing_config integer;
  v_recent_inflight integer;
  v_frozen integer;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found in this classroom.' USING ERRCODE='P0256';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only monthly periods use record verification.' USING ERRCODE='P0257';
  END IF;
  IF v_period.status IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RETURN jsonb_build_object('period_id',v_period.id,'status',v_period.status,'already_frozen',true);
  END IF;
  IF v_period.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only an active monthly period can be frozen.' USING ERRCODE='P0258';
  END IF;
  IF v_period.ends_at_exclusive > clock_timestamp() THEN
    RAISE EXCEPTION '[ARCADE VERIFY] end the monthly period before freezing records.' USING ERRCODE='P0218';
  END IF;

  SELECT count(*)::integer INTO v_recent_inflight
  FROM public.arcade_runs r
  WHERE r.classroom_id=v_classroom_id
    AND r.run_context='STANDARD'
    AND NOT r.is_prerelease_test
    AND r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    AND r.created_at >= greatest(v_period.starts_at, clock_timestamp()-interval '15 minutes')
    AND r.created_at < v_period.ends_at_exclusive;
  IF v_recent_inflight > 0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % recent standard run(s) are still in progress; wait for submission before freezing.',v_recent_inflight
      USING ERRCODE='P0272';
  END IF;

  IF EXISTS (SELECT 1 FROM public.arcade_verification_provisional_entries WHERE period_id=v_period.id) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] unexpected frozen rows already exist for an ACTIVE period.' USING ERRCODE='P0259';
  END IF;

  v_start_date := (v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date;
  v_end_date := ((v_period.ends_at_exclusive - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*)::integer INTO v_missing_config
  FROM public.arcade_games g
  WHERE g.available_from <= v_end_date
    AND (g.available_until IS NULL OR g.available_until >= v_start_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.arcade_verification_game_configs c
      WHERE c.game_id=g.id AND c.is_enabled
    );
  IF v_missing_config > 0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % eligible game(s) lack an enabled verification config; integrate the game validator first.',v_missing_config
      USING ERRCODE='P0260';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_games g
    JOIN public.arcade_verification_game_configs c ON c.game_id=g.id AND c.is_enabled
    WHERE g.available_from <= v_end_date
      AND (g.available_until IS NULL OR g.available_until >= v_start_date)
      AND c.target_rank_count <> 10
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] current monthly Guild 2 rewards cover Top 10; every eligible game must verify all Top 10 ranks.'
      USING ERRCODE='P0260';
  END IF;

  IF EXISTS (SELECT 1 FROM public.arcade_verification_period_games WHERE period_id=v_period.id) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] unexpected frozen game scope already exists for an ACTIVE period.' USING ERRCODE='P0259';
  END IF;
  INSERT INTO public.arcade_verification_period_games(
    classroom_id,period_id,game_id,target_rank_count,threshold_percent,max_attempts
  )
  SELECT v_classroom_id,v_period.id,g.id,c.target_rank_count,c.threshold_percent,c.max_attempts
  FROM public.arcade_games g
  JOIN public.arcade_verification_game_configs c ON c.game_id=g.id AND c.is_enabled
  WHERE g.available_from <= v_end_date
    AND (g.available_until IS NULL OR g.available_until >= v_start_date);

  WITH eligible_games AS (
    SELECT pg.game_id AS id
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id=v_period.id
  ), candidate_runs AS (
    SELECT r.id AS source_run_id,r.game_id,r.student_id,r.rule_version_id,r.official_score,
           r.official_duration_ms,r.stats,r.game_over_at,
           row_number() OVER (
             PARTITION BY r.game_id,r.student_id
             ORDER BY r.official_score DESC,r.game_over_at ASC,r.id ASC
           ) AS best_row
    FROM public.arcade_runs r
    JOIN eligible_games eg ON eg.id=r.game_id
    WHERE r.classroom_id=v_classroom_id
      AND r.run_context='STANDARD'
      AND r.status='VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_run_moderation_events m
        WHERE m.run_id=r.id AND m.event_kind='INVALIDATE'
      )
  )
  INSERT INTO public.arcade_verification_provisional_entries(
    classroom_id,period_id,game_id,student_id,source_run_id,rule_version_id,
    official_score,official_duration_ms,stats,achieved_at
  )
  SELECT v_classroom_id,v_period.id,c.game_id,c.student_id,c.source_run_id,c.rule_version_id,
         c.official_score,c.official_duration_ms,c.stats,c.game_over_at
  FROM candidate_runs c
  WHERE c.best_row=1;
  GET DIAGNOSTICS v_frozen = ROW_COUNT;

  UPDATE public.arcade_ranking_periods SET status='VERIFICATION' WHERE id=v_period.id;
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_classroom_id,v_period.id,'PERIOD_FROZEN',jsonb_build_object('frozen_student_game_rows',v_frozen),auth.uid()
  );

  v_status := public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  RETURN jsonb_build_object('period_id',v_period.id,'status',v_status,'frozen_rows',v_frozen,'already_frozen',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_verification_overview(
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
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;

  WITH all_ranks AS (
    SELECT * FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id)
  ), subject_ids AS (
    SELECT r.student_id FROM all_ranks r WHERE r.rank<=10
    UNION
    SELECT s.student_id
    FROM public.arcade_verification_sessions s
    WHERE s.period_id=v_period.id AND s.game_id=v_game_id AND s.status='ACTIVE'
  ), subject AS (
    SELECT r.rank,ids.student_id,r.source_run_id AS current_source_run_id,r.official_score AS current_official_score,r.achieved_at,
           p.official_score AS provisional_score,p.source_run_id AS provisional_source_run_id,p.id AS provisional_entry_id,
           s.id AS session_id,s.status AS session_status,s.verification_threshold,s.threshold_percent,s.max_attempts,
           s.success_achieved,s.result_status,s.activated_at,s.ended_at,
           o.decision_kind,o.source_run_id AS official_source_run_id,o.official_score AS decided_official_score,o.ranking_eligible,
           student.name AS student_name,student.brand_name,
           (SELECT count(*) FROM public.arcade_verification_attempts a WHERE a.session_id=s.id AND a.consumed)::integer AS used_attempts,
           (SELECT max(a.official_score) FROM public.arcade_verification_attempts a WHERE a.session_id=s.id AND a.status='TERMINAL' AND a.valid_run) AS best_verification_score,
           (SELECT rr.id FROM public.arcade_runs rr WHERE rr.verification_session_id=s.id AND rr.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') ORDER BY rr.id DESC LIMIT 1) AS active_run_id
    FROM subject_ids ids
    LEFT JOIN all_ranks r ON r.student_id=ids.student_id
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=v_game_id AND p.student_id=ids.student_id
    JOIN public.students student ON student.id=ids.student_id
    LEFT JOIN LATERAL (
      SELECT ss.* FROM public.arcade_verification_sessions ss
      WHERE ss.period_id=v_period.id AND ss.game_id=v_game_id AND ss.student_id=ids.student_id
      ORDER BY (ss.status='ACTIVE') DESC,ss.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id=v_period.id AND o.game_id=v_game_id AND o.student_id=ids.student_id
  )
  SELECT jsonb_build_object(
    'period_id',v_period.id,'period_status',v_period.status,'period_name',v_period.display_name,
    'game_code',p_game_code,
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'rank',subject.rank,'student_id',subject.student_id,'student_name',subject.student_name,'brand_name',subject.brand_name,
      'provisional_score',subject.provisional_score,'provisional_source_run_id',subject.provisional_source_run_id,
      'current_official_score',subject.current_official_score,'current_source_run_id',subject.current_source_run_id,
      'session_id',subject.session_id,'session_status',subject.session_status,'verification_threshold',subject.verification_threshold,
      'threshold_percent',subject.threshold_percent,'max_attempts',subject.max_attempts,'used_attempts',coalesce(subject.used_attempts,0),
      'success_achieved',coalesce(subject.success_achieved,false),'result_status',subject.result_status,
      'best_verification_score',subject.best_verification_score,'active_run_id',subject.active_run_id,
      'decision_kind',subject.decision_kind,'official_source_run_id',subject.official_source_run_id,
      'decided_official_score',subject.decided_official_score,'ranking_eligible',subject.ranking_eligible,
      'is_current_reward_range',(subject.rank IS NOT NULL AND subject.rank<=10),
      'attempts',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'attempt_id',a.id,'issue_number',a.issue_number,'opportunity_number',a.opportunity_number,
          'run_id',a.run_id,'status',a.status,'consumed',a.consumed,'valid_run',a.valid_run,
          'terminal_outcome',a.terminal_outcome,'official_score',a.official_score,
          'issued_at',a.issued_at,'terminal_at',a.terminal_at,'restored_at',a.restored_at,
          'restore_reason',a.restore_reason
        ) ORDER BY a.issue_number)
        FROM public.arcade_verification_attempts a
        WHERE a.session_id=subject.session_id
      ),'[]'::jsonb)
    ) ORDER BY subject.rank NULLS LAST, subject.student_name, subject.student_id),'[]'::jsonb)
  ) INTO v_result
  FROM subject;
  RETURN coalesce(v_result,jsonb_build_object('period_id',v_period.id,'period_status',v_period.status,'period_name',v_period.display_name,'game_code',p_game_code,'rows','[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_start_arcade_verification_session(
  p_period_id bigint,
  p_game_code text,
  p_student_id integer
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
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_rank integer;
  v_threshold bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256';
  END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period is not in verification stage.' USING ERRCODE='P0261';
  END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  SELECT * INTO v_config FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id AND game_id=v_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.' USING ERRCODE='P0260'; END IF;

  SELECT r.rank INTO v_rank FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r WHERE r.student_id=p_student_id;
  IF v_rank IS NULL OR v_rank>v_config.target_rank_count THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not currently in the verification reward range.' USING ERRCODE='P0270';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arcade_verification_official_results o
    WHERE o.period_id=v_period.id AND o.game_id=v_game_id AND o.student_id=p_student_id
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student already has an official verification result.' USING ERRCODE='P0262';
  END IF;

  SELECT * INTO v_session FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id AND status='ACTIVE';
  IF FOUND THEN
    RETURN jsonb_build_object('session_id',v_session.id,'status',v_session.status,'already_active',true,'verification_threshold',v_session.verification_threshold);
  END IF;

  SELECT * INTO v_provisional FROM public.arcade_verification_provisional_entries
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen provisional record is missing.' USING ERRCODE='P0253'; END IF;

  v_threshold := ceil((v_provisional.official_score::numeric * v_config.threshold_percent::numeric) / 100::numeric)::bigint;
  INSERT INTO public.arcade_verification_sessions(
    classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
    rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
  ) VALUES (
    v_classroom_id,v_period.id,v_game_id,p_student_id,v_provisional.id,v_provisional.source_run_id,
    v_provisional.rule_version_id,v_provisional.official_score,v_threshold,v_config.threshold_percent,v_config.max_attempts
  ) RETURNING * INTO v_session;

  UPDATE public.arcade_ranking_periods SET status='VERIFICATION' WHERE id=v_period.id AND status='READY_TO_FINALIZE';
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_classroom_id,v_period.id,v_game_id,p_student_id,v_session.id,'SESSION_STARTED',
    jsonb_build_object('provisional_score',v_provisional.official_score,'threshold',v_threshold,'percent',v_config.threshold_percent,'max_attempts',v_config.max_attempts),auth.uid()
  );
  RETURN jsonb_build_object('session_id',v_session.id,'status','ACTIVE','already_active',false,'verification_threshold',v_threshold,'max_attempts',v_config.max_attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_end_arcade_verification_session(
  p_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session not found.' USING ERRCODE='P0251';
  END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE='P0216';
  END IF;
  RETURN public.arcade_finalize_verification_session(v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_cancel_arcade_verification_run(
  p_run_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.arcade_runs%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] technical cancellation reason must be 2 to 500 characters.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM public.current_classroom_id() OR v_run.run_context<>'VERIFICATION' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification run not found.' USING ERRCODE='P0263';
  END IF;
  IF v_run.status NOT IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only an in-progress verification run can be technically cancelled.' USING ERRCODE='P0264';
  END IF;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE run_id=v_run.id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.' USING ERRCODE='P0254'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] verification session is missing.' USING ERRCODE='P0255'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE='P0216'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE run_id=v_run.id FOR UPDATE;
  IF v_session.status<>'ACTIVE' THEN RAISE EXCEPTION '[ARCADE VERIFY] verification session is not active.' USING ERRCODE='P0255'; END IF;

  UPDATE public.arcade_runs
  SET status='EXPIRED',rejection_code='VERIFICATION_TECHNICAL_CANCEL',rejection_reason=btrim(p_reason)
  WHERE id=v_run.id;
  UPDATE public.arcade_verification_attempts
  SET status='TECHNICAL_CANCELLED',consumed=false,valid_run=false,terminal_outcome='TECHNICAL_CANCELLED',terminal_at=now()
  WHERE id=v_attempt.id;
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,reason,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_attempt.id,
    'RUN_TECHNICAL_CANCELLED',btrim(p_reason),jsonb_build_object('run_id',v_run.id,'opportunity_number',v_attempt.opportunity_number),auth.uid()
  );
  RETURN jsonb_build_object('run_id',v_run.id,'cancelled',true,'attempt_consumed',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_restore_arcade_verification_attempt(
  p_attempt_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_success boolean;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] restore reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] attempt not found.' USING ERRCODE='P0265'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[ARCADE VERIFY] attempt does not belong to this classroom.' USING ERRCODE='P0265'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN RAISE EXCEPTION '[ARCADE VERIFY] finalized period cannot be changed.' USING ERRCODE='P0216'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF v_session.status NOT IN ('ACTIVE','COMPLETED') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] reset/overridden sessions cannot restore attempts.' USING ERRCODE='P0266';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] cancel/finish the active verification run before restoring an attempt.' USING ERRCODE='P0268';
  END IF;
  IF v_attempt.status<>'TERMINAL' OR NOT v_attempt.consumed OR v_attempt.valid_run THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only a consumed invalid attempt can be restored.' USING ERRCODE='P0266';
  END IF;

  UPDATE public.arcade_verification_attempts
  SET status='RESTORED',consumed=false,restored_at=now(),restored_by_user_id=auth.uid(),restore_reason=btrim(p_reason)
  WHERE id=v_attempt.id;

  IF v_session.status='COMPLETED' THEN
    DELETE FROM public.arcade_verification_official_results
    WHERE period_id=v_session.period_id AND game_id=v_session.game_id AND student_id=v_session.student_id AND session_id=v_session.id;
    SELECT EXISTS(
      SELECT 1 FROM public.arcade_verification_attempts a
      WHERE a.session_id=v_session.id AND a.status='TERMINAL' AND a.consumed AND a.valid_run AND a.official_score>=v_session.verification_threshold
    ) INTO v_success;
    UPDATE public.arcade_verification_sessions
    SET status='ACTIVE',result_status=NULL,ended_at=NULL,success_achieved=v_success
    WHERE id=v_session.id;
  END IF;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,reason,actor_user_id
  ) VALUES (v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_attempt.id,'ATTEMPT_RESTORED',btrim(p_reason),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object('attempt_id',v_attempt.id,'restored',true,'session_id',v_session.id,'session_status',CASE WHEN v_session.status='COMPLETED' THEN 'ACTIVE' ELSE v_session.status END,'period_status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_reset_arcade_verification_session(
  p_session_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] reset reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[ARCADE VERIFY] session not found.' USING ERRCODE='P0251'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN RAISE EXCEPTION '[ARCADE VERIFY] finalized period cannot be changed.' USING ERRCODE='P0216'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id FOR UPDATE;
  IF v_session.status NOT IN ('ACTIVE','COMPLETED') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only active/completed sessions can be reset.' USING ERRCODE='P0255';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] cancel/finish the active verification run before resetting the session.' USING ERRCODE='P0268';
  END IF;
  DELETE FROM public.arcade_verification_official_results
  WHERE period_id=v_session.period_id AND game_id=v_session.game_id AND student_id=v_session.student_id AND session_id=v_session.id;
  UPDATE public.arcade_verification_sessions SET status='RESET',ended_at=now() WHERE id=v_session.id;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,event_kind,reason,actor_user_id)
  VALUES(v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,'SESSION_RESET',btrim(p_reason),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object('session_id',v_session.id,'status','RESET','period_status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_arcade_verification_correction(
  p_period_id bigint,
  p_game_code text,
  p_student_id integer,
  p_source_run_id bigint,
  p_reason text
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
  v_run public.arcade_runs%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_action text;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] correction reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id OR v_period.period_kind<>'MONTHLY' THEN RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found.' USING ERRCODE='P0256'; END IF;
  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN RAISE EXCEPTION '[ARCADE VERIFY] correction is allowed only during verification.' USING ERRCODE='P0261'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arcade_verification_provisional_entries p WHERE p.period_id=v_period.id AND p.game_id=v_game_id AND p.student_id=p_student_id) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student has no frozen record in this period/game.' USING ERRCODE='P0253';
  END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id AND status='ACTIVE'
  FOR UPDATE;
  -- Recheck in-flight work only after owning the active session lock. This
  -- closes the race where a student could issue a run between an earlier check
  -- and the teacher's correction.
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.arcade_runs r
    WHERE r.verification_session_id=v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN RAISE EXCEPTION '[ARCADE VERIFY] finish/cancel the active verification run before correction.' USING ERRCODE='P0268'; END IF;
  IF FOUND THEN UPDATE public.arcade_verification_sessions SET status='OVERRIDDEN',ended_at=now() WHERE id=v_session.id; END IF;

  IF p_source_run_id IS NULL THEN
    v_action:='NO_RECORD';
    INSERT INTO public.arcade_verification_official_results(
      classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
    ) VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,'MANUAL_NONE',NULL,NULL,NULL,'{}'::jsonb,NULL,false,auth.uid())
    ON CONFLICT(period_id,game_id,student_id) DO UPDATE SET session_id=NULL,decision_kind='MANUAL_NONE',source_run_id=NULL,official_score=NULL,official_duration_ms=NULL,stats='{}'::jsonb,achieved_at=NULL,ranking_eligible=false,decided_by_user_id=auth.uid(),decided_at=now(),updated_at=now();
  ELSE
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_source_run_id;
    IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM v_classroom_id OR v_run.student_id IS DISTINCT FROM p_student_id OR v_run.game_id IS DISTINCT FROM v_game_id OR v_run.status<>'VERIFIED' THEN
      RAISE EXCEPTION '[ARCADE VERIFY] correction source run is not a matching verified run.' USING ERRCODE='P0267';
    END IF;
    IF v_run.run_context='STANDARD' THEN
      IF v_run.is_prerelease_test OR v_run.game_over_at<v_period.starts_at OR v_run.game_over_at>=v_period.ends_at_exclusive OR EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=v_run.id AND m.event_kind='INVALIDATE') THEN
        RAISE EXCEPTION '[ARCADE VERIFY] standard correction source is outside this target period or invalid.' USING ERRCODE='P0267';
      END IF;
    ELSIF v_run.run_context='VERIFICATION' THEN
      IF NOT EXISTS(
        SELECT 1 FROM public.arcade_verification_sessions s
        WHERE s.id=v_run.verification_session_id AND s.period_id=v_period.id AND s.game_id=v_game_id AND s.student_id=p_student_id
      ) THEN RAISE EXCEPTION '[ARCADE VERIFY] verification correction source belongs to a different target period.' USING ERRCODE='P0267'; END IF;
    ELSE RAISE EXCEPTION '[ARCADE VERIFY] unsupported correction source context.' USING ERRCODE='P0267'; END IF;
    v_action:='SET_SOURCE';
    INSERT INTO public.arcade_verification_official_results(
      classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
    ) VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,'MANUAL_SOURCE',v_run.id,v_run.official_score,v_run.official_duration_ms,v_run.stats,v_run.game_over_at,true,auth.uid())
    ON CONFLICT(period_id,game_id,student_id) DO UPDATE SET session_id=NULL,decision_kind='MANUAL_SOURCE',source_run_id=EXCLUDED.source_run_id,official_score=EXCLUDED.official_score,official_duration_ms=EXCLUDED.official_duration_ms,stats=EXCLUDED.stats,achieved_at=EXCLUDED.achieved_at,ranking_eligible=true,decided_by_user_id=auth.uid(),decided_at=now(),updated_at=now();
  END IF;

  INSERT INTO public.arcade_verification_corrections(classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason)
  VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,v_action,p_source_run_id,btrim(p_reason));
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,event_kind,reason,metadata,actor_user_id)
  VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,'MANUAL_CORRECTION',btrim(p_reason),jsonb_build_object('action_kind',v_action,'source_run_id',p_source_run_id),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  RETURN jsonb_build_object('period_id',v_period.id,'student_id',p_student_id,'action_kind',v_action,'source_run_id',p_source_run_id,'period_status',v_status);
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Student verification RPCs. Student cannot create a session; only an
--    ACTIVE teacher-created session can issue a verification run.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_arcade_verification_state(
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer:=public.current_classroom_id();
  v_student_id integer:=public.current_student_id();
  v_game_id bigint;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_used integer;
  v_active_run_id bigint;
  v_rank integer;
  v_target_rank_count integer;
BEGIN
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  SELECT s.* INTO v_session
  FROM public.arcade_verification_sessions s
  JOIN public.arcade_ranking_periods p ON p.id=s.period_id
  WHERE s.classroom_id=v_classroom_id AND s.student_id=v_student_id AND s.game_id=v_game_id
    AND p.status IN ('VERIFICATION','READY_TO_FINALIZE')
    AND s.status IN ('ACTIVE','COMPLETED')
  ORDER BY (s.status='ACTIVE') DESC,s.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'game_code',p_game_code); END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_session.period_id;
  SELECT pg.target_rank_count INTO v_target_rank_count FROM public.arcade_verification_period_games pg WHERE pg.period_id=v_session.period_id AND pg.game_id=v_game_id;
  IF v_target_rank_count IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen game scope is missing.' USING ERRCODE='P0260'; END IF;
  SELECT count(*)::integer INTO v_used FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id AND a.consumed;
  SELECT r.id INTO v_active_run_id FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') ORDER BY r.id DESC LIMIT 1;
  SELECT r.rank INTO v_rank FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_session.period_id,v_game_id) r WHERE r.student_id=v_student_id;
  RETURN jsonb_build_object(
    'available',true,'game_code',p_game_code,'period_id',v_period.id,'period_name',v_period.display_name,'period_status',v_period.status,
    'session_id',v_session.id,'session_status',v_session.status,'provisional_score',v_session.provisional_score,
    'verification_threshold',v_session.verification_threshold,'threshold_percent',v_session.threshold_percent,
    'max_attempts',v_session.max_attempts,'used_attempts',v_used,'remaining_attempts',greatest(v_session.max_attempts-v_used,0),
    'success_achieved',v_session.success_achieved,'result_status',v_session.result_status,'current_rank',v_rank,
    'active_run_id',v_active_run_id,
    'can_attempt',(v_session.status='ACTIVE' AND v_used<v_session.max_attempts AND v_active_run_id IS NULL AND v_rank IS NOT NULL AND v_rank<=v_target_rank_count),
    'attempts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'attempt_id',a.id,'issue_number',a.issue_number,'opportunity_number',a.opportunity_number,'run_id',a.run_id,
      'status',a.status,'consumed',a.consumed,'valid_run',a.valid_run,'terminal_outcome',a.terminal_outcome,
      'official_score',a.official_score,'issued_at',a.issued_at,'terminal_at',a.terminal_at
    ) ORDER BY a.issue_number) FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_create_arcade_verification_run(
  p_session_id bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_game public.arcade_games%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_used integer;
  v_issue integer;
  v_opportunity integer;
  v_rank integer;
  v_target_rank_count integer;
  v_seed bigint;
BEGIN
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] idempotency key is required.' USING ERRCODE='P0208'; END IF;

  -- Network retry must return the same already-issued run before re-evaluating
  -- a rank that may have changed after the first successful request.
  SELECT a.* INTO v_attempt
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_verification_sessions s ON s.id=a.session_id
  WHERE a.idempotency_key=p_idempotency_key
    AND s.classroom_id=v_classroom_id
    AND s.student_id=v_student_id;
  IF FOUND THEN
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,'verification_opportunity_number',v_attempt.opportunity_number);
  END IF;

  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM v_classroom_id OR v_session.student_id IS DISTINCT FROM v_student_id OR v_session.status<>'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session not found for this student.' USING ERRCODE='P0255';
  END IF;
  -- A concurrent retry may have inserted the idempotent attempt while this
  -- request waited for the session lock. Recheck under the serialization lock.
  SELECT a.* INTO v_attempt
  FROM public.arcade_verification_attempts a
  WHERE a.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_attempt.session_id IS DISTINCT FROM v_session.id THEN
      RAISE EXCEPTION '[ARCADE VERIFY] idempotency key belongs to a different session.' USING ERRCODE='P0212';
    END IF;
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,'verification_opportunity_number',v_attempt.opportunity_number);
  END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_session.period_id;
  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN RAISE EXCEPTION '[ARCADE VERIFY] target period is not accepting verification.' USING ERRCODE='P0261'; END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] another verification run is already in progress.' USING ERRCODE='P0269';
  END IF;
  SELECT pg.target_rank_count INTO v_target_rank_count
  FROM public.arcade_verification_period_games pg
  WHERE pg.period_id=v_session.period_id AND pg.game_id=v_session.game_id;
  IF v_target_rank_count IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen game scope is missing.' USING ERRCODE='P0260'; END IF;
  SELECT r.rank INTO v_rank FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_session.period_id,v_session.game_id) r WHERE r.student_id=v_student_id;
  IF v_rank IS NULL OR v_rank>v_target_rank_count THEN RAISE EXCEPTION '[ARCADE VERIFY] student is no longer in the current verification reward range.' USING ERRCODE='P0270'; END IF;
  SELECT count(*)::integer INTO v_used FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id AND a.consumed;
  IF v_used>=v_session.max_attempts THEN RAISE EXCEPTION '[ARCADE VERIFY] no verification attempts remain.' USING ERRCODE='P0269'; END IF;
  SELECT coalesce(max(a.issue_number),0)+1 INTO v_issue FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id;
  SELECT slot.n INTO v_opportunity
  FROM generate_series(1,v_session.max_attempts) AS slot(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arcade_verification_attempts a
    WHERE a.session_id=v_session.id
      AND a.opportunity_number=slot.n
      AND a.consumed
  )
  ORDER BY slot.n
  LIMIT 1;
  IF v_opportunity IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] no verification opportunity slot remains.' USING ERRCODE='P0269'; END IF;
  SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_session.rule_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen rule version is missing.' USING ERRCODE='P0198'; END IF;
  SELECT * INTO v_game FROM public.arcade_games WHERE id=v_session.game_id;
  v_seed:=public.arcade_generate_run_seed();
  INSERT INTO public.arcade_runs(classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,countdown_started_at,is_prerelease_test,run_context,verification_session_id)
  VALUES(v_classroom_id,v_student_id,v_session.game_id,v_session.rule_version_id,'COUNTDOWN',v_seed,now(),false,'VERIFICATION',v_session.id)
  RETURNING * INTO v_run;
  INSERT INTO public.arcade_verification_attempts(session_id,issue_number,opportunity_number,run_id,idempotency_key)
  VALUES(v_session.id,v_issue,v_opportunity,v_run.id,p_idempotency_key) RETURNING * INTO v_attempt;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,metadata,actor_user_id)
  VALUES(v_classroom_id,v_session.period_id,v_session.game_id,v_student_id,v_session.id,v_attempt.id,'ATTEMPT_ISSUED',jsonb_build_object('run_id',v_run.id,'issue_number',v_issue,'opportunity_number',v_opportunity),auth.uid());
  RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
    'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
    'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
    'verification_session_id',v_session.id,'verification_opportunity_number',v_opportunity);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Existing Game #01 authoritative submission, augmented only to capture a
--    verification attempt after every PLAYING terminal outcome.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_submit_focus_reaction_01_run(
  p_run_id bigint,
  p_input_events jsonb,
  p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_validation jsonb;
  v_submitted_at timestamptz := clock_timestamp();
  v_server_elapsed_ms integer;
  v_server_tolerance_ms integer;
  v_payload_hash text;
  v_input_event_count integer;
  v_capture jsonb;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  SELECT run.* INTO v_run FROM public.arcade_runs run WHERE run.id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE='P0199';
  END IF;
  IF v_run.status<>'PLAYING' OR v_run.play_started_at IS NULL THEN RAISE EXCEPTION '[ARCADE] this run is not ready for submission.' USING ERRCODE='P0202'; END IF;

  IF p_client_game_over_elapsed_ms IS NULL OR p_client_game_over_elapsed_ms NOT BETWEEN 0 AND 3600000 THEN
    UPDATE public.arcade_runs SET status='REJECTED',submitted_at=v_submitted_at,rejection_code='ELAPSED_OUT_OF_RANGE',rejection_reason='게임 시간 기록이 허용 범위를 벗어났습니다.' WHERE id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','ELAPSED_OUT_OF_RANGE','message','게임 시간 기록이 올바르지 않습니다.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;
  IF p_input_events IS NULL OR jsonb_typeof(p_input_events)<>'array' THEN
    UPDATE public.arcade_runs SET status='REJECTED',submitted_at=v_submitted_at,rejection_code='INPUT_EVENTS_NOT_ARRAY',rejection_reason='입력 기록 형식이 올바르지 않습니다.' WHERE id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','INPUT_EVENTS_NOT_ARRAY','message','입력 기록 형식이 올바르지 않습니다.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;
  v_input_event_count:=jsonb_array_length(p_input_events);
  IF v_input_event_count IS NULL OR v_input_event_count>20000 THEN
    UPDATE public.arcade_runs SET status='REJECTED',submitted_at=v_submitted_at,rejection_code='INPUT_EVENT_COUNT_EXCEEDED',rejection_reason='입력 기록이 허용된 개수를 초과했습니다.' WHERE id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','INPUT_EVENT_COUNT_EXCEEDED','message','입력 기록이 너무 많아 공식 기록으로 인정되지 않았습니다.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  SELECT config INTO v_config FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
  IF v_config->>'game_code'<>'focus_reaction_01' THEN RAISE EXCEPTION '[ARCADE] this run does not use Game #01 rules.' USING ERRCODE='P0203'; END IF;
  UPDATE public.arcade_runs SET status='SUBMITTING',submitted_at=v_submitted_at WHERE id=v_run.id;
  v_validation:=public.arcade_validate_focus_reaction_01_submission(v_run.schedule_seed,v_config,p_input_events,p_client_game_over_elapsed_ms);
  v_payload_hash:=public.arcade_sha256_hex(p_input_events::text||'|'||p_client_game_over_elapsed_ms::text);
  INSERT INTO public.arcade_run_submissions(run_id,input_events,input_event_count,client_game_over_elapsed_ms,payload_hash,validation_metadata,submitted_at)
  VALUES(v_run.id,p_input_events,v_input_event_count,p_client_game_over_elapsed_ms,v_payload_hash,v_validation,v_submitted_at);

  IF coalesce((v_validation->>'valid')::boolean,false) IS NOT TRUE THEN
    UPDATE public.arcade_runs SET status='REJECTED',rejection_code=v_validation->>'code',rejection_reason=v_validation->>'message' WHERE id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code',coalesce(v_validation->>'code','VALIDATION_FAILED'),'message',coalesce(v_validation->>'message','게임 기록을 검증하지 못했습니다.'),'run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  v_server_elapsed_ms:=floor(extract(epoch FROM (v_submitted_at-v_run.play_started_at))*1000)::integer;
  v_server_tolerance_ms:=coalesce((v_config->>'server_elapsed_tolerance_ms')::integer,10000);
  IF v_server_elapsed_ms < (v_validation->>'official_duration_ms')::integer-2000 OR v_server_elapsed_ms > (v_validation->>'official_duration_ms')::integer+v_server_tolerance_ms THEN
    UPDATE public.arcade_runs SET status='REJECTED',rejection_code='SERVER_TIME_MISMATCH',rejection_reason='서버 시간과 게임 진행 시간이 크게 달라 공식 기록으로 인정되지 않았습니다.' WHERE id=v_run.id;
    UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_elapsed_ms',v_server_elapsed_ms,'server_time_valid',false) WHERE run_id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','SERVER_TIME_MISMATCH','message','게임 시간 검증에 실패했습니다. 다시 시도해 주세요.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  UPDATE public.arcade_runs SET status='VERIFIED',game_over_at=v_run.play_started_at+((v_validation->>'official_duration_ms')::integer*interval '1 millisecond'),verified_at=v_submitted_at,
    official_score=(v_validation->>'official_score')::bigint,official_duration_ms=(v_validation->>'official_duration_ms')::integer,stats=v_validation->'stats',rejection_code=NULL,rejection_reason=NULL
  WHERE id=v_run.id RETURNING * INTO v_run;
  UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_elapsed_ms',v_server_elapsed_ms,'server_time_valid',true) WHERE run_id=v_run.id;
  IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
  RETURN jsonb_build_object('accepted',true,'run_id',v_run.id,'official_score',v_run.official_score,'official_duration_ms',v_run.official_duration_ms,'game_over_at',v_run.game_over_at,'stats',v_run.stats,
    'run_context',v_run.run_context,'verification_capture',v_capture);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Leaderboard/finalization. FINALIZED still writes/reads the existing
--    immutable snapshot structure; Guild 2 +90 cap remains inside its existing
--    refresh adapter.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(p_game_code text,p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_student_id integer:=public.current_student_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint; v_result jsonb;
BEGIN
  IF v_classroom_id IS NULL THEN RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE='P0204'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND OR v_period.status NOT IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED') THEN RAISE EXCEPTION '[ARCADE] ranking period was not found or is not visible.' USING ERRCODE='P0205'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  WITH ranks AS (SELECT * FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id))
  SELECT jsonb_build_object('period_id',v_period.id,'period_kind',v_period.period_kind,'game_code',p_game_code,
    'top10',coalesce(jsonb_agg(jsonb_build_object('rank',r.rank,'student_id',r.student_id,'student_name',s.name,'official_score',r.official_score,'game_over_at',r.achieved_at) ORDER BY r.rank) FILTER(WHERE r.rank<=10),'[]'::jsonb),
    'my_rank',max(r.rank) FILTER(WHERE r.student_id=v_student_id),'my_score',max(r.official_score) FILTER(WHERE r.student_id=v_student_id)) INTO v_result
  FROM ranks r JOIN public.students s ON s.id=r.student_id;
  RETURN coalesce(v_result,jsonb_build_object('period_id',v_period.id,'period_kind',v_period.period_kind,'game_code',p_game_code,'top10','[]'::jsonb,'my_rank',NULL,'my_score',NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_finalize_arcade_monthly_snapshot(p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer; v_period public.arcade_ranking_periods%ROWTYPE; v_finalization public.arcade_monthly_finalizations%ROWTYPE;
  v_game record; v_snapshot public.arcade_monthly_snapshots%ROWTYPE; v_eligible_game_count integer:=0; v_snapshot_count integer:=0; v_full_rank_count integer:=0;
  v_refresh_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role(); v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[ARCADE] monthly ranking period not found in this classroom.' USING ERRCODE='P0214'; END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.contribution_year_month IS NULL THEN RAISE EXCEPTION '[ARCADE] only a monthly period can update Guild 2 Arcade contribution.' USING ERRCODE='P0215'; END IF;
  IF v_period.status='FINALIZED' OR EXISTS(SELECT 1 FROM public.arcade_monthly_finalizations f WHERE f.period_id=v_period.id) THEN RAISE EXCEPTION '[ARCADE] this monthly period is already finalized and immutable.' USING ERRCODE='P0216'; END IF;
  IF v_period.status<>'READY_TO_FINALIZE' THEN RAISE EXCEPTION '[ARCADE VERIFY] current Top 10 verification is not complete.' USING ERRCODE='P0271'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.arcade_runs r JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
    WHERE s.period_id=v_period.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN RAISE EXCEPTION '[ARCADE VERIFY] a verification run is still in progress.' USING ERRCODE='P0271'; END IF;
  IF public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id)<>'READY_TO_FINALIZE' THEN RAISE EXCEPTION '[ARCADE VERIFY] current Top 10 still contains unverified students.' USING ERRCODE='P0271'; END IF;

  -- Sessions that were activated earlier but later fell outside the reward
  -- range no longer need a result. Close only those idle non-Top10 sessions and
  -- preserve an explicit audit event for each automatic closure.
  WITH closed AS (
    UPDATE public.arcade_verification_sessions s
    SET status='OVERRIDDEN',ended_at=now()
    WHERE s.period_id=v_period.id AND s.status='ACTIVE'
      AND NOT EXISTS(
        SELECT 1
        FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,s.game_id) r
        WHERE r.student_id=s.student_id AND r.rank<=10
      )
    RETURNING s.classroom_id,s.period_id,s.game_id,s.student_id,s.id
  )
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  )
  SELECT c.classroom_id,c.period_id,c.game_id,c.student_id,c.id,'SESSION_AUTO_OVERRIDDEN_OUTSIDE_TOP10','{}'::jsonb,auth.uid()
  FROM closed c;

  PERFORM pg_advisory_xact_lock(v_classroom_id,replace(v_period.contribution_year_month,'-','')::integer);
  SELECT count(*) INTO v_eligible_game_count
  FROM public.arcade_verification_period_games pg
  WHERE pg.period_id=v_period.id;
  INSERT INTO public.arcade_monthly_finalizations(classroom_id,period_id,contribution_year_month,eligible_game_count)
  VALUES(v_classroom_id,v_period.id,v_period.contribution_year_month,v_eligible_game_count) RETURNING * INTO v_finalization;
  FOR v_game IN
    SELECT g.id,g.code
    FROM public.arcade_verification_period_games pg
    JOIN public.arcade_games g ON g.id=pg.game_id
    WHERE pg.period_id=v_period.id
    ORDER BY g.id
  LOOP
    INSERT INTO public.arcade_monthly_snapshots(finalization_id,classroom_id,period_id,game_id,contribution_year_month)
    VALUES(v_finalization.id,v_classroom_id,v_period.id,v_game.id,v_period.contribution_year_month) RETURNING * INTO v_snapshot;
    INSERT INTO public.arcade_monthly_snapshot_entries(snapshot_id,student_id,source_run_id,rank,official_score,achieved_at,raw_bonus)
    SELECT v_snapshot.id,t.student_id,t.source_run_id,t.rank,t.official_score,t.achieved_at,t.raw_bonus FROM public.arcade_resolve_period_top10(v_classroom_id,v_period.id,v_game.id)t;
    INSERT INTO public.arcade_monthly_snapshot_student_ranks(snapshot_id,student_id,source_run_id,rank,official_score,achieved_at)
    SELECT v_snapshot.id,r.student_id,r.source_run_id,r.rank,r.official_score,r.achieved_at FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game.id)r;
  END LOOP;
  SELECT count(*) INTO v_snapshot_count FROM public.arcade_monthly_snapshots s WHERE s.finalization_id=v_finalization.id;
  IF v_snapshot_count<>v_eligible_game_count THEN RAISE EXCEPTION '[ARCADE] incomplete monthly snapshot set; transaction was not finalized.' USING ERRCODE='P0219'; END IF;
  SELECT count(*) INTO v_full_rank_count FROM public.arcade_monthly_snapshot_student_ranks r JOIN public.arcade_monthly_snapshots s ON s.id=r.snapshot_id WHERE s.finalization_id=v_finalization.id;
  v_refresh_result:=public.guild2_refresh_monthly_scores(v_classroom_id,v_period.contribution_year_month);

  UPDATE public.arcade_ranking_periods SET status='FINALIZED' WHERE id=v_period.id;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,event_kind,metadata,actor_user_id)
  VALUES(v_classroom_id,v_period.id,'PERIOD_FINALIZED',jsonb_build_object('finalization_id',v_finalization.id,'snapshot_count',v_snapshot_count),auth.uid());
  RETURN jsonb_build_object('period_id',v_period.id,'finalization_id',v_finalization.id,'eligible_game_count',v_eligible_game_count,'snapshot_count',v_snapshot_count,'full_rank_count',v_full_rank_count,'guild2_refresh',v_refresh_result,'status','FINALIZED');
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Compatibility: general history/audit/prerelease/statistics must not treat
--     verification runs as ordinary play.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_my_arcade_history(p_period_id bigint,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0,p_game_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_student_id integer:=public.current_student_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint; v_result jsonb;
BEGIN
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN RAISE EXCEPTION '[ARCADE] authenticated student context is required.' USING ERRCODE='P0195'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION '[ARCADE] invalid history pagination.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id AND status IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED');
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE] visible ranking period was not found.' USING ERRCODE='P0205'; END IF;
  IF p_game_code IS NOT NULL THEN SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code; IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF; END IF;
  WITH filtered AS (
    SELECT r.id run_id,g.code game_code,g.internal_name game_name,r.status,r.official_score,r.official_duration_ms,r.game_over_at,r.submitted_at,
      coalesce(r.game_over_at,r.submitted_at,r.created_at) occurred_at,r.rejection_code,r.rejection_reason,(inv.created_at IS NOT NULL)is_invalidated,inv.reason invalidation_reason,inv.created_at invalidated_at
    FROM public.arcade_runs r JOIN public.arcade_games g ON g.id=r.game_id
    LEFT JOIN LATERAL(SELECT m.reason,m.created_at FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE' ORDER BY m.id DESC LIMIT 1)inv ON true
    WHERE r.classroom_id=v_classroom_id AND r.student_id=v_student_id AND r.run_context='STANDARD' AND r.status IN('VERIFIED','REJECTED') AND NOT r.is_prerelease_test
      AND coalesce(r.game_over_at,r.submitted_at,r.created_at)>=v_period.starts_at AND coalesce(r.game_over_at,r.submitted_at,r.created_at)<v_period.ends_at_exclusive
      AND (v_game_id IS NULL OR r.game_id=v_game_id)
  ), page AS(SELECT * FROM filtered ORDER BY occurred_at DESC,run_id DESC LIMIT p_limit OFFSET p_offset)
  SELECT jsonb_build_object('period_id',v_period.id,'period_kind',v_period.period_kind,'display_name',v_period.display_name,'period_status',v_period.status,'total_count',(SELECT count(*) FROM filtered),'limit',p_limit,'offset',p_offset,
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('run_id',page.run_id,'game_code',page.game_code,'game_name',page.game_name,'status',page.status,'official_score',page.official_score,'official_duration_ms',page.official_duration_ms,'game_over_at',page.game_over_at,'submitted_at',page.submitted_at,'occurred_at',page.occurred_at,'rejection_code',page.rejection_code,'rejection_reason',page.rejection_reason,'is_invalidated',page.is_invalidated,'invalidation_reason',page.invalidation_reason,'invalidated_at',page.invalidated_at)ORDER BY page.occurred_at DESC,page.run_id DESC)FROM page),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(p_period_id bigint,p_game_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role(); SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE] ranking period was not found in this classroom.' USING ERRCODE='P0205'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code; IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  WITH candidate_runs AS(SELECT r.id run_id,r.student_id,r.official_score,r.game_over_at,row_number()OVER(PARTITION BY r.student_id ORDER BY r.official_score DESC,r.game_over_at,r.id)best_row FROM public.arcade_runs r
    WHERE r.classroom_id=v_classroom_id AND r.game_id=v_game_id AND r.run_context='STANDARD' AND r.status='VERIFIED' AND r.is_prerelease_test AND r.game_over_at>=v_period.starts_at AND r.game_over_at<v_period.ends_at_exclusive
      AND NOT EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE')),
  ranked AS(SELECT c.*,row_number()OVER(ORDER BY c.official_score DESC,c.game_over_at,c.run_id)rank FROM candidate_runs c WHERE c.best_row=1)
  SELECT jsonb_build_object('period_id',v_period.id,'game_code',p_game_code,'participant_count',count(*),'top10',coalesce(jsonb_agg(jsonb_build_object('rank',r.rank,'student_id',r.student_id,'student_name',s.name,'official_score',r.official_score,'game_over_at',r.game_over_at)ORDER BY r.rank)FILTER(WHERE r.rank<=10),'[]'::jsonb)) INTO v_result FROM ranked r JOIN public.students s ON s.id=r.student_id;
  RETURN coalesce(v_result,jsonb_build_object('period_id',v_period.id,'game_code',p_game_code,'participant_count',0,'top10','[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_run_audit(p_period_id bigint,p_game_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role(); SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE='P0205'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code; IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  RETURN(SELECT coalesce(jsonb_agg(row_data ORDER BY(row_data->>'event_at')::timestamptz DESC),'[]'::jsonb) FROM(
    SELECT jsonb_build_object('run_id',r.id,'student_id',r.student_id,'student_name',s.name,'status',r.status,'run_context',r.run_context,'is_prerelease_test',r.is_prerelease_test,
      'official_score',r.official_score,'official_duration_ms',r.official_duration_ms,'game_over_at',r.game_over_at,'submitted_at',r.submitted_at,'event_at',coalesce(r.game_over_at,r.submitted_at,r.created_at),
      'rejection_code',r.rejection_code,'rejection_reason',r.rejection_reason,'invalidated',m.id IS NOT NULL,'invalidation_reason',m.reason)row_data
    FROM public.arcade_runs r JOIN public.students s ON s.id=r.student_id LEFT JOIN public.arcade_run_moderation_events m ON m.run_id=r.id
    WHERE r.classroom_id=v_classroom_id AND r.game_id=v_game_id AND r.run_context='STANDARD'
      AND coalesce(r.game_over_at,r.submitted_at,r.created_at)>=v_period.starts_at AND coalesce(r.game_over_at,r.submitted_at,r.created_at)<v_period.ends_at_exclusive
    ORDER BY coalesce(r.game_over_at,r.submitted_at,r.created_at)DESC,r.id DESC LIMIT 200)audit_rows);
END; $$;

CREATE OR REPLACE FUNCTION public.teacher_invalidate_arcade_run(p_run_id bigint,p_reason text,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_run public.arcade_runs%ROWTYPE; v_event public.arcade_run_moderation_events%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF coalesce(btrim(p_reason),'')='' OR char_length(btrim(p_reason))NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION '[ARCADE] invalidation reason must be 2 to 300 characters.' USING ERRCODE='P0207'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION '[ARCADE] idempotency key is required.' USING ERRCODE='P0208'; END IF;
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[ARCADE] run not found in this classroom.' USING ERRCODE='P0209'; END IF;
  IF v_run.run_context<>'STANDARD' OR v_run.status<>'VERIFIED' THEN RAISE EXCEPTION '[ARCADE] only verified standard runs can be invalidated.' USING ERRCODE='P0210'; END IF;
  IF EXISTS(SELECT 1 FROM public.arcade_monthly_snapshot_entries e WHERE e.source_run_id=v_run.id)
     OR EXISTS(SELECT 1 FROM public.arcade_monthly_snapshot_student_ranks r WHERE r.source_run_id=v_run.id) THEN
    RAISE EXCEPTION '[ARCADE] this run is already part of a finalized snapshot; use correction flow.' USING ERRCODE='P0211';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM public.arcade_verification_provisional_entries p
    JOIN public.arcade_ranking_periods period ON period.id=p.period_id
    WHERE p.source_run_id=v_run.id AND period.status IN('VERIFICATION','READY_TO_FINALIZE')
  ) OR EXISTS(
    SELECT 1
    FROM public.arcade_verification_official_results o
    JOIN public.arcade_ranking_periods period ON period.id=o.period_id
    WHERE o.source_run_id=v_run.id AND period.status IN('VERIFICATION','READY_TO_FINALIZE')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this run is frozen/selected as an official verification source; use verification correction instead.' USING ERRCODE='P0273';
  END IF;
  SELECT * INTO v_event FROM public.arcade_run_moderation_events WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN IF v_event.run_id IS DISTINCT FROM v_run.id THEN RAISE EXCEPTION '[ARCADE] idempotency key belongs to a different moderation action.' USING ERRCODE='P0212'; END IF; RETURN jsonb_build_object('moderation_event_id',v_event.id,'run_id',v_event.run_id,'invalidated',true); END IF;
  IF EXISTS(SELECT 1 FROM public.arcade_run_moderation_events e WHERE e.run_id=v_run.id) THEN RAISE EXCEPTION '[ARCADE] this run was already invalidated.' USING ERRCODE='P0213'; END IF;
  INSERT INTO public.arcade_run_moderation_events(run_id,classroom_id,event_kind,reason,idempotency_key)VALUES(v_run.id,v_classroom_id,'INVALIDATE',btrim(p_reason),p_idempotency_key)RETURNING * INTO v_event;
  RETURN jsonb_build_object('moderation_event_id',v_event.id,'run_id',v_event.run_id,'invalidated',true);
END; $$;

-- -----------------------------------------------------------------------------
-- 11. Analytics compatibility. Keep current production semantics, but exclude
--     verification context from ordinary plays/PB and include verification
--     lifecycle states in the selected monthly rank.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_statistics(
  p_classroom_id integer,p_guild_season_id integer DEFAULT NULL,p_year_month text DEFAULT NULL,p_include_test boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_season_id integer; v_year_month text; v_period_id bigint; v_period_status text; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS NULL OR p_classroom_id<>public.current_classroom_id() THEN RAISE EXCEPTION 'Permission denied: classroom mismatch' USING ERRCODE='P0511'; END IF;
  SELECT coalesce(p_guild_season_id,(SELECT gs.id FROM public.guild_seasons gs WHERE gs.classroom_id=p_classroom_id AND gs.is_active=true ORDER BY gs.id DESC LIMIT 1))INTO v_season_id;
  IF v_season_id IS NULL THEN RAISE EXCEPTION 'No active guild season found' USING ERRCODE='P0610'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.guild_seasons gs WHERE gs.id=v_season_id AND gs.classroom_id=p_classroom_id)THEN RAISE EXCEPTION 'Guild season does not belong to classroom' USING ERRCODE='P0611'; END IF;
  v_year_month:=coalesce(p_year_month,to_char(timezone('Asia/Seoul',clock_timestamp()),'YYYY-MM')); IF v_year_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid year month: %',v_year_month USING ERRCODE='22023'; END IF;
  SELECT p.id,p.status INTO v_period_id,v_period_status FROM public.arcade_ranking_periods p WHERE p.classroom_id=p_classroom_id AND p.period_kind='MONTHLY' AND p.guild_season_id=v_season_id AND p.contribution_year_month=v_year_month AND p.status IN('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED')
  ORDER BY CASE p.status WHEN 'ACTIVE' THEN 0 WHEN 'VERIFICATION' THEN 1 WHEN 'READY_TO_FINALIZE' THEN 2 ELSE 3 END,p.id DESC LIMIT 1;
  WITH eligible_students AS(
    SELECT s.id,s.name,s.brand_name,s.is_test_account FROM public.students s WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL AND (s.role::text IN('STUDENT','STUDENT_LEADER','GUARD')OR(p_include_test AND s.role::text='TEST'))AND(p_include_test OR NOT coalesce(s.is_test_account,false))
  ),games AS(
    SELECT g.id,g.code,g.internal_name,g.is_active,g.available_from,g.available_until,sem.comparison_mode,sem.notes semantics_notes FROM public.arcade_games g LEFT JOIN public.arcade_analytics_game_semantics sem ON sem.game_id=g.id
  ),run_scope AS(
    SELECT r.* FROM public.arcade_runs r JOIN eligible_students es ON es.id=r.student_id WHERE r.classroom_id=p_classroom_id AND r.run_context='STANDARD' AND NOT r.is_prerelease_test AND NOT EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE')
  ),run_agg AS(
    SELECT r.student_id,r.game_id,count(*)FILTER(WHERE r.play_started_at IS NOT NULL)play_count,count(*)FILTER(WHERE r.submitted_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.arcade_run_submissions rs WHERE rs.run_id=r.id))submission_count,
      count(*)FILTER(WHERE r.status='VERIFIED')verification_success_count,count(*)FILTER(WHERE r.status='REJECTED')verification_failure_count,min(r.play_started_at)FILTER(WHERE r.play_started_at IS NOT NULL)first_play_at,max(r.play_started_at)FILTER(WHERE r.play_started_at IS NOT NULL)latest_play_at FROM run_scope r GROUP BY r.student_id,r.game_id
  ),alltime_pb AS(
    SELECT DISTINCT ON(r.student_id,r.game_id)r.student_id,r.game_id,r.id run_id,r.official_score,r.game_over_at,r.rule_version_id,r.official_duration_ms,r.stats FROM run_scope r JOIN games g ON g.id=r.game_id AND g.comparison_mode='HIGHER_SCORE_BETTER' WHERE r.status='VERIFIED' AND r.official_score IS NOT NULL ORDER BY r.student_id,r.game_id,r.official_score DESC,r.game_over_at,r.id
  ),live_period_rank AS(
    SELECT g.id game_id,x.source_run_id,x.student_id,x.official_score,x.achieved_at,x.rank
    FROM games g
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(p_classroom_id,v_period_id,g.id)x
    WHERE v_period_id IS NOT NULL AND v_period_status IN('ACTIVE','VERIFICATION','READY_TO_FINALIZE')
  ),finalized_period_rank AS(
    SELECT sn.game_id,sr.source_run_id,sr.student_id,sr.official_score,sr.achieved_at,sr.rank
    FROM public.arcade_monthly_snapshots sn
    JOIN public.arcade_monthly_snapshot_student_ranks sr ON sr.snapshot_id=sn.id
    JOIN eligible_students es ON es.id=sr.student_id
    WHERE v_period_id IS NOT NULL AND v_period_status='FINALIZED'
      AND sn.classroom_id=p_classroom_id AND sn.period_id=v_period_id
  ),current_period_rank AS(
    SELECT * FROM live_period_rank
    UNION ALL
    SELECT * FROM finalized_period_rank
  ),official_ranks AS(
    SELECT sn.game_id,sn.contribution_year_month,p.guild_season_id,sr.student_id,sr.source_run_id,sr.rank,sr.official_score,sr.achieved_at FROM public.arcade_monthly_snapshots sn JOIN public.arcade_monthly_finalizations f ON f.id=sn.finalization_id JOIN public.arcade_ranking_periods p ON p.id=sn.period_id AND p.status='FINALIZED' AND p.period_kind='MONTHLY' JOIN public.arcade_monthly_snapshot_student_ranks sr ON sr.snapshot_id=sn.id JOIN eligible_students es ON es.id=sr.student_id WHERE sn.classroom_id=p_classroom_id
  ),official_agg AS(
    SELECT o.student_id,o.game_id,min(o.rank)monthly_best_rank_all_time,min(o.rank)FILTER(WHERE o.guild_season_id=v_season_id)season_best_rank,count(*)FILTER(WHERE o.rank=1)monthly_win_count,count(*)FILTER(WHERE o.rank<=3)monthly_top3_count,count(*)FILTER(WHERE o.rank<=10)monthly_top10_count FROM official_ranks o GROUP BY o.student_id,o.game_id
  ),top10_months AS(
    SELECT o.student_id,o.game_id,o.contribution_year_month,(substring(o.contribution_year_month,1,4)::integer*12+substring(o.contribution_year_month,6,2)::integer)month_index,row_number()OVER(PARTITION BY o.student_id,o.game_id ORDER BY o.contribution_year_month)rn FROM official_ranks o WHERE o.rank<=10
  ),top10_groups AS(SELECT t.*,t.month_index-t.rn::integer grp FROM top10_months t),top10_streaks AS(SELECT student_id,game_id,grp,count(*)::integer streak_len,min(month_index)start_idx,max(month_index)end_idx FROM top10_groups GROUP BY student_id,game_id,grp),
  latest_game_month AS(SELECT o.game_id,max(substring(o.contribution_year_month,1,4)::integer*12+substring(o.contribution_year_month,6,2)::integer)latest_idx FROM official_ranks o GROUP BY o.game_id),
  streak_agg AS(SELECT s.student_id,s.game_id,max(s.streak_len)max_consecutive_top10,coalesce(max(s.streak_len)FILTER(WHERE s.end_idx=lg.latest_idx),0)current_consecutive_top10 FROM top10_streaks s JOIN latest_game_month lg ON lg.game_id=s.game_id GROUP BY s.student_id,s.game_id),
  student_game AS(
    SELECT es.id student_id,es.name student_name,es.brand_name,es.is_test_account,g.id game_id,g.code game_code,g.internal_name game_name,g.comparison_mode,
      coalesce(ra.play_count,0)play_count,coalesce(ra.submission_count,0)official_submission_count,coalesce(ra.verification_success_count,0)verification_success_count,coalesce(ra.verification_failure_count,0)verification_failure_count,ra.first_play_at,ra.latest_play_at,
      pb.official_score all_time_pb,pb.game_over_at all_time_pb_at,pb.run_id all_time_pb_run_id,rv.version_code all_time_pb_rule_version,pb.official_duration_ms all_time_pb_duration_ms,pb.stats all_time_pb_stats,
      cpr.official_score current_period_pb,cpr.rank current_period_rank,cpr.achieved_at current_period_pb_at,oa.monthly_best_rank_all_time,oa.season_best_rank,coalesce(oa.monthly_win_count,0)monthly_win_count,coalesce(oa.monthly_top3_count,0)monthly_top3_count,coalesce(oa.monthly_top10_count,0)monthly_top10_count,coalesce(sa.current_consecutive_top10,0)current_consecutive_top10,coalesce(sa.max_consecutive_top10,0)max_consecutive_top10
    FROM eligible_students es CROSS JOIN games g LEFT JOIN run_agg ra ON ra.student_id=es.id AND ra.game_id=g.id LEFT JOIN alltime_pb pb ON pb.student_id=es.id AND pb.game_id=g.id LEFT JOIN public.arcade_game_rule_versions rv ON rv.id=pb.rule_version_id LEFT JOIN current_period_rank cpr ON cpr.student_id=es.id AND cpr.game_id=g.id LEFT JOIN official_agg oa ON oa.student_id=es.id AND oa.game_id=g.id LEFT JOIN streak_agg sa ON sa.student_id=es.id AND sa.game_id=g.id
  ),student_summary AS(
    SELECT es.id student_id,es.name student_name,count(DISTINCT r.game_id)FILTER(WHERE r.play_started_at IS NOT NULL)different_games_played,count(DISTINCT o.game_id)FILTER(WHERE o.rank=1)different_games_won FROM eligible_students es LEFT JOIN run_scope r ON r.student_id=es.id LEFT JOIN official_ranks o ON o.student_id=es.id GROUP BY es.id,es.name
  ),game_summary AS(
    SELECT g.id game_id,g.code game_code,g.internal_name game_name,g.is_active,g.comparison_mode,g.semantics_notes,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',rv.id,'version_code',rv.version_code,'is_active',rv.is_active,'created_at',rv.created_at)ORDER BY rv.id),'[]'::jsonb)FROM public.arcade_game_rule_versions rv WHERE rv.game_id=g.id)rule_versions,
      count(r.id)FILTER(WHERE r.play_started_at IS NOT NULL)play_count,count(r.id)FILTER(WHERE r.status='VERIFIED')verified_count,count(r.id)FILTER(WHERE r.status='REJECTED')rejected_count,min(r.created_at)tracking_start_at FROM games g LEFT JOIN run_scope r ON r.game_id=g.id GROUP BY g.id,g.code,g.internal_name,g.is_active,g.comparison_mode,g.semantics_notes
  )
  SELECT jsonb_build_object('scope',jsonb_build_object('classroom_id',p_classroom_id,'guild_season_id',v_season_id,'year_month',v_year_month,'monthly_period_id',v_period_id,'monthly_period_status',v_period_status,'include_test',p_include_test),
    'definitions',jsonb_build_object('plays','STANDARD run rows with play_started_at, excluding prerelease and invalidated runs','official_submissions','STANDARD submitted run or run submission payload exists','current_period_rank','ACTIVE uses live STANDARD runs; VERIFICATION/READY uses frozen + official override; FINALIZED uses immutable snapshot','official_history','FINALIZED monthly snapshots only','season_best_rank','best rank among FINALIZED monthly snapshots linked to selected guild season','pb_semantics','all-time PB uses STANDARD runs only and only HIGHER_SCORE_BETTER games','rank1_hold_history','candidate phase should reconstruct only for supported semantics; no invented backfill'),
    'games',coalesce((SELECT jsonb_agg(to_jsonb(gs)ORDER BY gs.game_id)FROM game_summary gs),'[]'::jsonb),'student_game_rows',coalesce((SELECT jsonb_agg(to_jsonb(sg)ORDER BY sg.student_name,sg.student_id,sg.game_id)FROM student_game sg),'[]'::jsonb),'student_summaries',coalesce((SELECT jsonb_agg(to_jsonb(ss)ORDER BY ss.student_name,ss.student_id)FROM student_summary ss),'[]'::jsonb),
    'data_quality',jsonb_build_object('eligible_student_count',(SELECT count(*)FROM eligible_students),'game_count',(SELECT count(*)FROM games),'active_game_without_semantics',(SELECT count(*)FROM games WHERE is_active AND comparison_mode IS NULL),'verified_run_without_score',(SELECT count(*)FROM run_scope WHERE status='VERIFIED' AND official_score IS NULL),'verified_run_without_game_over_at',(SELECT count(*)FROM run_scope WHERE status='VERIFIED' AND game_over_at IS NULL),'finalized_monthly_period_without_finalization',(SELECT count(*)FROM public.arcade_ranking_periods p WHERE p.classroom_id=p_classroom_id AND p.period_kind='MONTHLY' AND p.status='FINALIZED' AND NOT EXISTS(SELECT 1 FROM public.arcade_monthly_finalizations f WHERE f.period_id=p.id)),'snapshot_test_student_rows',(SELECT count(*)FROM public.arcade_monthly_snapshot_student_ranks sr JOIN public.arcade_monthly_snapshots sn ON sn.id=sr.snapshot_id JOIN public.students s ON s.id=sr.student_id WHERE sn.classroom_id=p_classroom_id AND coalesce(s.is_test_account,false)),'snapshot_nonverified_source_runs',(SELECT count(*)FROM public.arcade_monthly_snapshot_student_ranks sr JOIN public.arcade_monthly_snapshots sn ON sn.id=sr.snapshot_id JOIN public.arcade_runs r ON r.id=sr.source_run_id WHERE sn.classroom_id=p_classroom_id AND r.status<>'VERIFIED'),'invalidated_verified_runs',(SELECT count(*)FROM public.arcade_runs r WHERE r.classroom_id=p_classroom_id AND r.run_context='STANDARD' AND r.status='VERIFIED' AND EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE')),'official_finalization_count',(SELECT count(*)FROM public.arcade_monthly_finalizations f WHERE f.classroom_id=p_classroom_id),'current_period_rank_count',(SELECT count(*)FROM current_period_rank))) INTO v_result;
  RETURN v_result;
END; $$;

-- teacher_get_student_statistics is intentionally left unchanged. Its Arcade
-- detail payload already comes from teacher_get_arcade_statistics above. The
-- generic recent_activity_at timestamp may include a supervised verification
-- run, which is acceptable as activity and avoids replacing a large unrelated
-- analytics function for a cosmetic timestamp difference.

-- -----------------------------------------------------------------------------
-- 12. Test-fixture compatibility without weakening production foreign keys.
--     The existing reset sets a transaction-local marker; this trigger only
--     cascades verification-owned rows for that exact registered TEST classroom.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_verification_test_fixture_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_marker text := coalesce(current_setting('brand.test_fixture_reset_classroom_id',true),'');
  v_classroom_id integer;
BEGIN
  -- The pre-existing TEST reset writes this transaction-local marker before it
  -- deletes Arcade runtime rows. Ordinary production DELETE statements have no
  -- marker and therefore do nothing here.
  IF v_marker !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  v_classroom_id := v_marker::integer;
  IF NOT EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures f
    WHERE f.fixture_code='BRAND_TEST_V1'
      AND f.classroom_id=v_classroom_id
  ) THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.arcade_verification_audit_events WHERE classroom_id=v_classroom_id;
  DELETE FROM public.arcade_verification_corrections WHERE classroom_id=v_classroom_id;
  DELETE FROM public.arcade_verification_official_results WHERE classroom_id=v_classroom_id;
  DELETE FROM public.arcade_verification_attempts a
  USING public.arcade_verification_sessions s
  WHERE a.session_id=s.id AND s.classroom_id=v_classroom_id;

  -- Break the run -> session FK before the existing reset DELETE begins. A
  -- statement-level BEFORE trigger avoids modifying the very row currently
  -- being deleted, which can happen with a row-level trigger.
  UPDATE public.arcade_runs
  SET run_context='STANDARD', verification_session_id=NULL
  WHERE classroom_id=v_classroom_id AND run_context='VERIFICATION';

  DELETE FROM public.arcade_verification_sessions WHERE classroom_id=v_classroom_id;
  DELETE FROM public.arcade_verification_provisional_entries WHERE classroom_id=v_classroom_id;
  DELETE FROM public.arcade_verification_period_games WHERE classroom_id=v_classroom_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER arcade_verification_test_fixture_cleanup_before_run_delete
  BEFORE DELETE ON public.arcade_runs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.arcade_verification_test_fixture_cleanup();

-- -----------------------------------------------------------------------------
-- 13. ACL. Internal helpers are not browser APIs.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.arcade_refresh_verification_readiness(integer,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_finalize_verification_session(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_capture_verification_attempt(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_verification_test_fixture_cleanup() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_resolve_period_student_ranks(integer,bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_resolve_period_top10(integer,bigint,bigint) FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.teacher_update_arcade_ranking_period(bigint,text,integer,text,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_update_arcade_ranking_period(bigint,text,integer,text,timestamptz,timestamptz,text) TO authenticated;
REVOKE ALL ON FUNCTION public.teacher_freeze_arcade_monthly_period(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_verification_overview(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_start_arcade_verification_session(bigint,text,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_end_arcade_verification_session(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_cancel_arcade_verification_run(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_restore_arcade_verification_attempt(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_reset_arcade_verification_session(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_freeze_arcade_monthly_period(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_verification_overview(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_start_arcade_verification_session(bigint,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_end_arcade_verification_session(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_cancel_arcade_verification_run(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_restore_arcade_verification_attempt(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_reset_arcade_verification_session(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text) TO authenticated;

REVOKE ALL ON FUNCTION public.student_get_arcade_verification_state(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.student_create_arcade_verification_run(bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_get_arcade_verification_state(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_create_arcade_verification_run(bigint,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.student_submit_focus_reaction_01_run(bigint,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text,bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.student_get_my_arcade_history(bigint,integer,integer,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_run_audit(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_invalidate_arcade_run(bigint,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_finalize_arcade_monthly_snapshot(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_statistics(integer,integer,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_submit_focus_reaction_01_run(bigint,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_my_arcade_history(bigint,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_run_audit(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_invalidate_arcade_run(bigint,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_arcade_monthly_snapshot(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_statistics(integer,integer,text,boolean) TO authenticated,service_role;

-- -----------------------------------------------------------------------------
-- 14. Transactional postcheck. Any failure rolls back the entire migration.
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_bad integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.arcade_ranking_periods'::regclass AND c.conname='arcade_ranking_period_status_check' AND pg_get_constraintdef(c.oid) ILIKE '%VERIFICATION%' AND pg_get_constraintdef(c.oid) ILIKE '%READY_TO_FINALIZE%')THEN
    RAISE EXCEPTION '[ARCADE VERIFY] lifecycle constraint postcheck failed.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.arcade_runs WHERE run_context<>'STANDARD')THEN
    RAISE EXCEPTION '[ARCADE VERIFY] legacy run backfill changed context unexpectedly.';
  END IF;
  SELECT count(*) INTO v_bad FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('arcade_verification_game_configs','arcade_verification_period_games','arcade_verification_provisional_entries','arcade_verification_sessions','arcade_verification_attempts','arcade_verification_official_results','arcade_verification_corrections','arcade_verification_audit_events') AND NOT c.relrowsecurity;
  IF v_bad<>0 THEN RAISE EXCEPTION '[ARCADE VERIFY] verification table RLS postcheck failed.'; END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('arcade_verification_game_configs'),('arcade_verification_period_games'),
      ('arcade_verification_provisional_entries'),('arcade_verification_sessions'),
      ('arcade_verification_attempts'),('arcade_verification_official_results'),
      ('arcade_verification_corrections'),('arcade_verification_audit_events')
    ) AS t(name)
    WHERE has_table_privilege('authenticated','public.'||t.name,'SELECT')
       OR has_table_privilege('authenticated','public.'||t.name,'INSERT')
       OR has_table_privilege('authenticated','public.'||t.name,'UPDATE')
       OR has_table_privilege('authenticated','public.'||t.name,'DELETE')
       OR has_table_privilege('anon','public.'||t.name,'SELECT')
       OR has_table_privilege('anon','public.'||t.name,'INSERT')
       OR has_table_privilege('anon','public.'||t.name,'UPDATE')
       OR has_table_privilege('anon','public.'||t.name,'DELETE')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] direct client table privilege leaked.';
  END IF;
  IF has_sequence_privilege('authenticated','public.arcade_verification_period_games_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.arcade_verification_provisional_entries_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.arcade_verification_sessions_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.arcade_verification_attempts_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.arcade_verification_official_results_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.arcade_verification_corrections_id_seq','USAGE')
     OR has_sequence_privilege('authenticated','public.arcade_verification_audit_events_id_seq','USAGE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] direct authenticated sequence privilege leaked.';
  END IF;
  IF NOT has_function_privilege('authenticated','public.student_get_arcade_verification_state(text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.student_create_arcade_verification_run(bigint,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_freeze_arcade_monthly_period(bigint)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_get_arcade_verification_overview(bigint,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_start_arcade_verification_session(bigint,text,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_end_arcade_verification_session(bigint)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_cancel_arcade_verification_run(bigint,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_restore_arcade_verification_attempt(bigint,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_reset_arcade_verification_session(bigint,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text)','EXECUTE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] public RPC ACL postcheck failed.';
  END IF;
  IF has_function_privilege('authenticated','public.arcade_capture_verification_attempt(bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_finalize_verification_session(bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_refresh_verification_readiness(integer,bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_verification_test_fixture_cleanup()','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_resolve_period_student_ranks(integer,bigint,bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_resolve_period_top10(integer,bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] internal helper execute privilege leaked.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arcade_verification_game_configs c JOIN public.arcade_games g ON g.id=c.game_id WHERE g.code='focus_reaction_01' AND c.is_enabled AND c.target_rank_count=10 AND c.threshold_percent=80 AND c.max_attempts=3)THEN
    RAISE EXCEPTION '[ARCADE VERIFY] Game #01 verification config postcheck failed.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.guild2_individual_contributions'::regclass AND c.conname='guild2_contribution_arcade_applied_check' AND pg_get_constraintdef(c.oid)ILIKE'%90%')THEN
    RAISE EXCEPTION '[ARCADE VERIFY] Guild 2 +90 cap changed unexpectedly.';
  END IF;
END $$;

COMMIT;
