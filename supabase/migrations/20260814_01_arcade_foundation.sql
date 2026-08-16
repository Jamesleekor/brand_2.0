-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade 0.1 foundation
-- 2026-08-14
--
-- Production compatibility basis
--   * PREFLIGHT_ARCADE_INTEGRATION.sql Section 1~13 was run on production.
--   * public.rankings is a legacy daily economy/achievement ranking table with
--     existing history. This migration never writes to or alters it.
--   * Existing student, classroom, Guild membership, season, and Guild 2
--     structures are reused through foreign keys; no duplicate identity/GS
--     system is created.
--
-- Scope
--   * Arcade registry, rule versions, configurable periods, protected run and
--     audit storage, monthly snapshot storage, RLS/ACL, and period management.
--   * Game #01 validation and Guild 2 rollup belong to later migrations.
--   * Existing Guild 1/Guild 2 migration files and historical rows are not
--     modified or rerun.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Production preconditions verified by the Arcade preflight
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.guild_seasons') IS NULL
     OR to_regclass('public.guild2_individual_contributions') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] required production source tables are missing.';
  END IF;

  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.is_teacher_or_admin()') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] required production identity helpers are missing.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION '[ARCADE] btree_gist is required for ranking-period overlap protection.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Arcade-owned, append-oriented data
-- -----------------------------------------------------------------------------
CREATE TABLE public.arcade_games (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  internal_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  available_from date NOT NULL,
  available_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_games_code_unique UNIQUE (code),
  CONSTRAINT arcade_games_code_format_check
    CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT arcade_games_availability_check
    CHECK (available_until IS NULL OR available_until >= available_from)
);

COMMENT ON TABLE public.arcade_games IS
  'Arcade game registry. Availability dates, rather than a later is_active value alone, determine which games belong to a historical ranking period.';

CREATE TABLE public.arcade_game_rule_versions (
  id bigserial PRIMARY KEY,
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  version_code text NOT NULL,
  config jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  -- NULL is reserved for a version seeded by an audited deployment migration;
  -- teacher-created future versions retain the authenticated actor UUID.
  created_by_user_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_game_rule_version_unique UNIQUE (game_id, version_code),
  CONSTRAINT arcade_game_rule_versions_config_object_check CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT arcade_game_rule_versions_version_code_check
    CHECK (version_code ~ '^[A-Za-z0-9._-]{1,80}$')
);

CREATE UNIQUE INDEX arcade_game_rule_versions_one_active_per_game
  ON public.arcade_game_rule_versions(game_id)
  WHERE is_active;

COMMENT ON TABLE public.arcade_game_rule_versions IS
  'Immutable-by-convention Arcade rule versions. Runs retain the version that generated their official schedule.';

CREATE TABLE public.arcade_ranking_periods (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_kind text NOT NULL,
  display_name text NOT NULL,
  guild_season_id integer REFERENCES public.guild_seasons(id),
  contribution_year_month varchar(7),
  starts_at timestamptz NOT NULL,
  ends_at_exclusive timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_ranking_period_kind_check CHECK (period_kind IN ('MONTHLY', 'SEASON')),
  CONSTRAINT arcade_ranking_period_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'FINALIZED')),
  CONSTRAINT arcade_ranking_period_display_name_check CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT arcade_ranking_period_range_check CHECK (ends_at_exclusive > starts_at),
  CONSTRAINT arcade_ranking_period_month_format_check
    CHECK (contribution_year_month IS NULL OR contribution_year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT arcade_ranking_period_shape_check CHECK (
    (period_kind = 'MONTHLY' AND contribution_year_month IS NOT NULL)
    OR (period_kind = 'SEASON' AND contribution_year_month IS NULL)
  ),
  CONSTRAINT arcade_ranking_period_no_overlap
    EXCLUDE USING gist (
      classroom_id WITH =,
      period_kind WITH =,
      tstzrange(starts_at, ends_at_exclusive, '[)') WITH &&
    )
);

CREATE UNIQUE INDEX arcade_ranking_period_month_unique
  ON public.arcade_ranking_periods(classroom_id, contribution_year_month)
  WHERE period_kind = 'MONTHLY';
CREATE INDEX ix_arcade_ranking_period_class_kind_range
  ON public.arcade_ranking_periods(classroom_id, period_kind, starts_at, ends_at_exclusive);

COMMENT ON TABLE public.arcade_ranking_periods IS
  'Teacher-configurable Arcade monthly/season periods. FINALIZED periods are immutable and require a future explicit correction flow to reopen.';

CREATE TABLE public.arcade_runs (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  rule_version_id bigint NOT NULL REFERENCES public.arcade_game_rule_versions(id),
  status text NOT NULL DEFAULT 'READY',
  schedule_seed bigint NOT NULL,
  countdown_started_at timestamptz,
  play_started_at timestamptz,
  game_over_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  official_score bigint,
  official_duration_ms integer,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejection_code text,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_runs_status_check CHECK (status IN ('READY', 'COUNTDOWN', 'PLAYING', 'GAME_OVER', 'SUBMITTING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT arcade_runs_seed_check CHECK (schedule_seed BETWEEN 1 AND 4294967295),
  CONSTRAINT arcade_runs_score_check CHECK (official_score IS NULL OR official_score >= 0),
  CONSTRAINT arcade_runs_duration_check CHECK (official_duration_ms IS NULL OR official_duration_ms >= 0),
  CONSTRAINT arcade_runs_stats_object_check CHECK (jsonb_typeof(stats) = 'object'),
  CONSTRAINT arcade_runs_verified_shape_check CHECK (
    (status <> 'VERIFIED')
    OR (play_started_at IS NOT NULL AND game_over_at IS NOT NULL AND submitted_at IS NOT NULL
        AND verified_at IS NOT NULL AND official_score IS NOT NULL AND official_duration_ms IS NOT NULL)
  ),
  CONSTRAINT arcade_runs_rejected_shape_check CHECK (
    (status <> 'REJECTED') OR rejection_code IS NOT NULL
  )
);

CREATE INDEX ix_arcade_runs_game_classroom_finished
  ON public.arcade_runs(game_id, classroom_id, game_over_at, id)
  WHERE status = 'VERIFIED';
CREATE INDEX ix_arcade_runs_student_game_finished
  ON public.arcade_runs(student_id, game_id, game_over_at DESC, id DESC)
  WHERE status = 'VERIFIED';
CREATE INDEX ix_arcade_runs_classroom_status_created
  ON public.arcade_runs(classroom_id, status, created_at DESC);

COMMENT ON TABLE public.arcade_runs IS
  'Server-issued Arcade runs. schedule_seed, official score, and validated completion time are never client-writable.';

CREATE TABLE public.arcade_run_submissions (
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  input_events jsonb NOT NULL,
  input_event_count integer NOT NULL,
  client_game_over_elapsed_ms integer NOT NULL,
  payload_hash text NOT NULL,
  validation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_run_submissions_run_unique UNIQUE (run_id),
  CONSTRAINT arcade_run_submissions_events_array_check CHECK (jsonb_typeof(input_events) = 'array'),
  CONSTRAINT arcade_run_submissions_event_count_check CHECK (input_event_count BETWEEN 0 AND 20000),
  CONSTRAINT arcade_run_submissions_elapsed_check CHECK (client_game_over_elapsed_ms BETWEEN 0 AND 3600000),
  CONSTRAINT arcade_run_submissions_hash_check CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT arcade_run_submissions_metadata_object_check CHECK (jsonb_typeof(validation_metadata) = 'object')
);

COMMENT ON TABLE public.arcade_run_submissions IS
  'One raw input submission per run. It contains no client-claimed score and is not directly readable by students.';

CREATE TABLE public.arcade_monthly_finalizations (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  contribution_year_month varchar(7) NOT NULL,
  eligible_game_count integer NOT NULL,
  finalized_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_monthly_finalizations_period_unique UNIQUE (period_id),
  CONSTRAINT arcade_monthly_finalizations_scope_unique UNIQUE (classroom_id, contribution_year_month),
  CONSTRAINT arcade_monthly_finalizations_month_check CHECK (contribution_year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT arcade_monthly_finalizations_game_count_check CHECK (eligible_game_count >= 0)
);

COMMENT ON TABLE public.arcade_monthly_finalizations IS
  'Immutable parent proof that every eligible game for one monthly period was atomically snapshotted before Guild 2 Arcade readiness became READY.';

CREATE TABLE public.arcade_monthly_snapshots (
  id bigserial PRIMARY KEY,
  finalization_id bigint NOT NULL REFERENCES public.arcade_monthly_finalizations(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  contribution_year_month varchar(7) NOT NULL,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_monthly_snapshots_period_game_unique UNIQUE (period_id, game_id),
  CONSTRAINT arcade_monthly_snapshots_finalization_game_unique UNIQUE (finalization_id, game_id),
  CONSTRAINT arcade_monthly_snapshots_month_check CHECK (contribution_year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX ix_arcade_monthly_snapshots_classroom_month
  ON public.arcade_monthly_snapshots(classroom_id, contribution_year_month, game_id);

CREATE TABLE public.arcade_monthly_snapshot_entries (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES public.arcade_monthly_snapshots(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  source_run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  rank integer NOT NULL,
  official_score bigint NOT NULL,
  achieved_at timestamptz NOT NULL,
  raw_bonus numeric(8,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_monthly_snapshot_entries_student_unique UNIQUE (snapshot_id, student_id),
  CONSTRAINT arcade_monthly_snapshot_entries_rank_unique UNIQUE (snapshot_id, rank),
  CONSTRAINT arcade_monthly_snapshot_entries_source_run_unique UNIQUE (snapshot_id, source_run_id),
  CONSTRAINT arcade_monthly_snapshot_entries_rank_check CHECK (rank BETWEEN 1 AND 10),
  CONSTRAINT arcade_monthly_snapshot_entries_score_check CHECK (official_score >= 0),
  CONSTRAINT arcade_monthly_snapshot_entries_bonus_check CHECK (
    (rank = 1 AND raw_bonus = 30)
    OR (rank = 2 AND raw_bonus = 27)
    OR (rank = 3 AND raw_bonus = 24)
    OR (rank BETWEEN 4 AND 6 AND raw_bonus = 18)
    OR (rank BETWEEN 7 AND 10 AND raw_bonus = 15)
  )
);

CREATE INDEX ix_arcade_monthly_snapshot_entries_student
  ON public.arcade_monthly_snapshot_entries(student_id, achieved_at DESC);

COMMENT ON TABLE public.arcade_monthly_snapshot_entries IS
  'Immutable per-game Top 10 evidence. achieved_at is copied from the source run game_over_at, not a separate run timestamp.';

CREATE TABLE public.arcade_run_moderation_events (
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES public.arcade_runs(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  event_kind text NOT NULL DEFAULT 'INVALIDATE',
  reason text NOT NULL,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_run_moderation_events_run_unique UNIQUE (run_id),
  CONSTRAINT arcade_run_moderation_events_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT arcade_run_moderation_events_kind_check CHECK (event_kind = 'INVALIDATE'),
  CONSTRAINT arcade_run_moderation_events_reason_check CHECK (char_length(btrim(reason)) BETWEEN 2 AND 300)
);

COMMENT ON TABLE public.arcade_run_moderation_events IS
  'Append-only teacher invalidation evidence. Invalidated runs remain auditable but are excluded from future leaderboard and snapshot candidates.';

-- -----------------------------------------------------------------------------
-- 2. Immutability and safe metadata updates
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER arcade_games_set_updated_at
  BEFORE UPDATE ON public.arcade_games
  FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();

CREATE TRIGGER arcade_ranking_periods_set_updated_at
  BEFORE UPDATE ON public.arcade_ranking_periods
  FOR EACH ROW EXECUTE FUNCTION public.arcade_set_updated_at();

CREATE OR REPLACE FUNCTION public.arcade_block_finalized_period_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE] finalized monthly/season period is immutable; use a future explicit correction flow.'
      USING ERRCODE = 'P0180';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER arcade_ranking_periods_block_finalized_mutation
  BEFORE UPDATE OR DELETE ON public.arcade_ranking_periods
  FOR EACH ROW EXECUTE FUNCTION public.arcade_block_finalized_period_mutation();

CREATE OR REPLACE FUNCTION public.arcade_block_immutable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '[ARCADE] % history is append-only and immutable.', TG_TABLE_NAME
    USING ERRCODE = 'P0181';
END;
$$;

CREATE TRIGGER arcade_monthly_finalizations_immutable
  BEFORE UPDATE OR DELETE ON public.arcade_monthly_finalizations
  FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();
CREATE TRIGGER arcade_monthly_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.arcade_monthly_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();
CREATE TRIGGER arcade_monthly_snapshot_entries_immutable
  BEFORE UPDATE OR DELETE ON public.arcade_monthly_snapshot_entries
  FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();
CREATE TRIGGER arcade_run_moderation_events_immutable
  BEFORE UPDATE OR DELETE ON public.arcade_run_moderation_events
  FOR EACH ROW EXECUTE FUNCTION public.arcade_block_immutable_history_mutation();

-- -----------------------------------------------------------------------------
-- 3. RLS and direct table permissions
-- -----------------------------------------------------------------------------
ALTER TABLE public.arcade_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_game_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_ranking_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_run_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_monthly_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_monthly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_monthly_snapshot_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_run_moderation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.arcade_games FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_game_rule_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_ranking_periods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_run_submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_monthly_finalizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_monthly_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_monthly_snapshot_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_run_moderation_events FROM PUBLIC, anon, authenticated;

-- Registry and current-classroom periods are the only direct Arcade reads.
-- Runs, seeds, raw inputs, moderation, and snapshots are exposed through
-- purpose-specific RPCs in later migrations.
GRANT SELECT ON TABLE public.arcade_games TO authenticated;
GRANT SELECT ON TABLE public.arcade_ranking_periods TO authenticated;

CREATE POLICY arcade_games_authenticated_select
  ON public.arcade_games
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY arcade_ranking_periods_classroom_select
  ON public.arcade_ranking_periods
  FOR SELECT TO authenticated
  USING (classroom_id = public.current_classroom_id());

-- -----------------------------------------------------------------------------
-- 4. Teacher period management (no client table writes)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_create_arcade_ranking_period(
  p_period_kind text,
  p_display_name text,
  p_guild_season_id integer,
  p_contribution_year_month text,
  p_starts_at timestamptz,
  p_ends_at_exclusive timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] teacher classroom context is missing.' USING ERRCODE = 'P0182';
  END IF;

  IF p_period_kind NOT IN ('MONTHLY', 'SEASON') THEN
    RAISE EXCEPTION '[ARCADE] period kind must be MONTHLY or SEASON.' USING ERRCODE = 'P0183';
  END IF;
  IF coalesce(btrim(p_display_name), '') = '' OR char_length(btrim(p_display_name)) > 120 THEN
    RAISE EXCEPTION '[ARCADE] period display name must be 1 to 120 characters.' USING ERRCODE = 'P0184';
  END IF;
  IF p_ends_at_exclusive <= p_starts_at THEN
    RAISE EXCEPTION '[ARCADE] period end must be after its start.' USING ERRCODE = 'P0185';
  END IF;
  IF (p_period_kind = 'MONTHLY' AND coalesce(p_contribution_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
     OR (p_period_kind = 'SEASON' AND p_contribution_year_month IS NOT NULL) THEN
    RAISE EXCEPTION '[ARCADE] monthly periods require YYYY-MM; season periods must not have a contribution month.' USING ERRCODE = 'P0186';
  END IF;

  IF p_guild_season_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.guild_seasons gs
    WHERE gs.id = p_guild_season_id AND gs.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION '[ARCADE] guild season does not belong to this classroom.' USING ERRCODE = 'P0187';
  END IF;

  INSERT INTO public.arcade_ranking_periods (
    classroom_id, period_kind, display_name, guild_season_id,
    contribution_year_month, starts_at, ends_at_exclusive, status
  ) VALUES (
    v_classroom_id, p_period_kind, btrim(p_display_name), p_guild_season_id,
    p_contribution_year_month, p_starts_at, p_ends_at_exclusive, 'DRAFT'
  )
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'classroom_id', v_period.classroom_id,
    'status', v_period.status
  );
END;
$$;

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
  v_period public.arcade_ranking_periods;
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
    RAISE EXCEPTION '[ARCADE] finalized period is immutable; use a future explicit correction flow.' USING ERRCODE = 'P0180';
  END IF;
  IF p_status NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION '[ARCADE] general period updates may set only DRAFT or ACTIVE. FINALIZED is reserved for monthly finalization.' USING ERRCODE = 'P0189';
  END IF;
  IF coalesce(btrim(p_display_name), '') = '' OR char_length(btrim(p_display_name)) > 120 THEN
    RAISE EXCEPTION '[ARCADE] period display name must be 1 to 120 characters.' USING ERRCODE = 'P0184';
  END IF;
  IF p_ends_at_exclusive <= p_starts_at THEN
    RAISE EXCEPTION '[ARCADE] period end must be after its start.' USING ERRCODE = 'P0185';
  END IF;
  IF (v_period.period_kind = 'MONTHLY' AND coalesce(p_contribution_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
     OR (v_period.period_kind = 'SEASON' AND p_contribution_year_month IS NOT NULL) THEN
    RAISE EXCEPTION '[ARCADE] monthly periods require YYYY-MM; season periods must not have a contribution month.' USING ERRCODE = 'P0186';
  END IF;
  IF p_guild_season_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.guild_seasons gs
    WHERE gs.id = p_guild_season_id AND gs.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION '[ARCADE] guild season does not belong to this classroom.' USING ERRCODE = 'P0187';
  END IF;

  UPDATE public.arcade_ranking_periods
  SET display_name = btrim(p_display_name),
      guild_season_id = p_guild_season_id,
      contribution_year_month = p_contribution_year_month,
      starts_at = p_starts_at,
      ends_at_exclusive = p_ends_at_exclusive,
      status = p_status
  WHERE id = v_period.id
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'classroom_id', v_period.classroom_id,
    'status', v_period.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_block_finalized_period_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_block_immutable_history_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_create_arcade_ranking_period(text, text, integer, text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_update_arcade_ranking_period(bigint, text, integer, text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_create_arcade_ranking_period(text, text, integer, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_update_arcade_ranking_period(bigint, text, integer, text, timestamptz, timestamptz, text) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT c.relname AS relation_name,
       c.relrowsecurity AS rls_enabled,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'arcade_games', 'arcade_game_rule_versions', 'arcade_ranking_periods',
    'arcade_runs', 'arcade_run_submissions', 'arcade_monthly_finalizations',
    'arcade_monthly_snapshots', 'arcade_monthly_snapshot_entries',
    'arcade_run_moderation_events'
  )
ORDER BY relation_name;

SELECT conrelid::regclass::text AS table_name,
       conname AS constraint_name,
       pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.arcade_ranking_periods'::regclass,
  'public.arcade_monthly_snapshot_entries'::regclass
)
ORDER BY table_name, constraint_name;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('teacher_create_arcade_ranking_period', 'teacher_update_arcade_ranking_period')
ORDER BY function_name;
