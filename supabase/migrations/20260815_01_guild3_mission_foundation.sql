-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 3 Mission foundation
-- 2026-08-15
--
-- Production compatibility basis
--   * PREFLIGHT_GUILD3_MISSION_ALL_RESULTS.sql was run on production.
--   * guild_missions, guild_mission_logs, and guild_peer_reviews are legacy
--     structures with zero live rows. They use an incompatible lifecycle and
--     are deliberately preserved without alteration or reuse.
--   * Guild 1 membership/season snapshots and Guild 2 draft/cache/ledger
--     tables are present with the expected production signatures.
--   * No Guild 5 monthly-close data contract exists yet. Guild 3 therefore
--     does not create a competing monthly-finalization system; Guild 5 must
--     add its explicit close/reopen adapter in a later incremental migration.
--
-- Scope
--   * New Guild 3 mission definitions, immutable participant snapshots,
--     append-only evidence/audit tables, future Guild 4 opening proof,
--     indexes, RLS, ACLs, and immutability guards.
--   * Lifecycle and Guild 2 adapter RPCs are added in the following Guild 3
--     incremental migrations.
--   * No legacy Guild 1/Guild 2 migration, legacy mission table, or historical
--     row is modified, rerun, deleted, or rewritten.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Production preconditions confirmed by the Guild 3 preflight.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.guilds') IS NULL
     OR to_regclass('public.guild_seasons') IS NULL
     OR to_regclass('public.guild_members') IS NULL
     OR to_regclass('public.guild2_individual_contributions') IS NULL
     OR to_regclass('public.guild2_gs_events') IS NULL
     OR to_regclass('public.guild2_monthly_gs_summaries') IS NULL THEN
    RAISE EXCEPTION '[G3] required production Guild source tables are missing.';
  END IF;

  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.is_teacher_or_admin()') IS NULL
     OR to_regprocedure('public.guild2_resolve_season_for_month(integer,text)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL THEN
    RAISE EXCEPTION '[G3] required production identity or Guild 2 helper is missing.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Guild 3-owned mission domain tables.
--
-- The legacy guild_missions/guild_mission_logs tables intentionally remain
-- untouched. The G3-prefixed tables are a separate lifecycle/audit model.
-- -----------------------------------------------------------------------------
CREATE TABLE public.guild3_missions (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  contribution_year_month varchar(7) NOT NULL,
  title text NOT NULL,
  teaser_visible boolean NOT NULL DEFAULT false,
  teaser_title text,
  description text,
  student_success_criteria text,
  teacher_guidance text,
  weight numeric(18,8) NOT NULL,
  submission_scope text NOT NULL,
  submission_requirement text NOT NULL,
  due_at timestamptz NOT NULL,
  activity_record_due_at timestamptz NOT NULL,
  peer_review_required boolean NOT NULL DEFAULT true,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  published_at timestamptz,
  closed_at timestamptz,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  voided_at timestamptz,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_missions_month_check
    CHECK (contribution_year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guild3_missions_title_check CHECK (char_length(btrim(title)) >= 1),
  CONSTRAINT guild3_missions_teaser_title_check
    CHECK (teaser_title IS NULL OR char_length(btrim(teaser_title)) >= 1),
  CONSTRAINT guild3_missions_weight_check CHECK (weight > 0),
  CONSTRAINT guild3_missions_submission_scope_check
    CHECK (submission_scope IN ('GUILD', 'INDIVIDUAL', 'NONE')),
  CONSTRAINT guild3_missions_submission_requirement_check
    CHECK (submission_requirement IN ('REQUIRED', 'OPTIONAL', 'NONE')),
  CONSTRAINT guild3_missions_submission_shape_check CHECK (
    (submission_scope IN ('GUILD', 'INDIVIDUAL')
      AND submission_requirement IN ('REQUIRED', 'OPTIONAL'))
    OR (submission_scope = 'NONE' AND submission_requirement = 'NONE')
  ),
  CONSTRAINT guild3_missions_lifecycle_check
    CHECK (lifecycle_state IN ('DRAFT', 'ACTIVE', 'CLOSED', 'FINALIZED', 'CANCELLED', 'VOIDED')),
  CONSTRAINT guild3_missions_activity_due_check
    CHECK (activity_record_due_at >= due_at),
  CONSTRAINT guild3_missions_state_timestamp_shape_check CHECK (
    (lifecycle_state = 'DRAFT'
      AND published_at IS NULL AND closed_at IS NULL AND finalized_at IS NULL
      AND cancelled_at IS NULL AND voided_at IS NULL)
    OR (lifecycle_state = 'ACTIVE'
      AND published_at IS NOT NULL AND finalized_at IS NULL
      AND cancelled_at IS NULL AND voided_at IS NULL)
    OR (lifecycle_state = 'CLOSED'
      AND published_at IS NOT NULL AND closed_at IS NOT NULL
      AND finalized_at IS NULL AND cancelled_at IS NULL AND voided_at IS NULL)
    OR (lifecycle_state = 'FINALIZED'
      AND published_at IS NOT NULL AND closed_at IS NOT NULL AND finalized_at IS NOT NULL
      AND cancelled_at IS NULL AND voided_at IS NULL)
    OR (lifecycle_state = 'CANCELLED'
      AND cancelled_at IS NOT NULL AND finalized_at IS NULL AND voided_at IS NULL)
    OR (lifecycle_state = 'VOIDED'
      AND published_at IS NOT NULL AND closed_at IS NOT NULL AND finalized_at IS NOT NULL
      AND voided_at IS NOT NULL AND cancelled_at IS NULL)
  )
);

CREATE INDEX ix_guild3_missions_classroom_month_state
  ON public.guild3_missions(classroom_id, contribution_year_month, lifecycle_state, due_at, id);
CREATE INDEX ix_guild3_missions_season_state
  ON public.guild3_missions(season_id, lifecycle_state, id);

COMMENT ON TABLE public.guild3_missions IS
  'Guild 3 official mission definitions. The scoring-critical configuration becomes immutable when lifecycle_state changes from DRAFT to ACTIVE.';

CREATE TABLE public.guild3_mission_instances (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  current_guild_result text NOT NULL DEFAULT 'UNDECIDED',
  special_rule_note text,
  judged_at timestamptz,
  judged_by_user_id uuid,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_mission_instances_mission_guild_unique UNIQUE (mission_id, guild_id),
  CONSTRAINT guild3_mission_instances_result_check
    CHECK (current_guild_result IN ('UNDECIDED', 'CLEARED', 'FAILED')),
  CONSTRAINT guild3_mission_instances_judgment_shape_check CHECK (
    (current_guild_result = 'UNDECIDED' AND judged_at IS NULL AND judged_by_user_id IS NULL)
    OR (current_guild_result IN ('CLEARED', 'FAILED') AND judged_at IS NOT NULL AND judged_by_user_id IS NOT NULL)
  )
);

CREATE INDEX ix_guild3_mission_instances_mission_result
  ON public.guild3_mission_instances(mission_id, current_guild_result, guild_id);
CREATE INDEX ix_guild3_mission_instances_guild
  ON public.guild3_mission_instances(classroom_id, season_id, guild_id, id);

COMMENT ON TABLE public.guild3_mission_instances IS
  'One Guild 3 instance for every participating guild. current_guild_result is an audited current projection; judgment evidence remains append-only.';

CREATE TABLE public.guild3_mission_participants (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  membership_id integer NOT NULL REFERENCES public.guild_members(id),
  student_name_at_snapshot text NOT NULL,
  guild_name_at_snapshot text NOT NULL,
  assigned_element_at_snapshot text NOT NULL,
  membership_joined_at_at_snapshot timestamptz NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_mission_participants_mission_student_unique UNIQUE (mission_id, student_id),
  CONSTRAINT guild3_mission_participants_instance_student_unique UNIQUE (mission_instance_id, student_id)
);

CREATE INDEX ix_guild3_mission_participants_student
  ON public.guild3_mission_participants(student_id, mission_id DESC);
CREATE INDEX ix_guild3_mission_participants_instance
  ON public.guild3_mission_participants(mission_instance_id, student_id);

COMMENT ON TABLE public.guild3_mission_participants IS
  'Immutable participant roster fixed when a mission becomes ACTIVE. Later guild movement, transfer, or removal never rewrites this snapshot.';

CREATE TABLE public.guild3_mission_submissions (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  submitted_by_student_id integer NOT NULL REFERENCES public.students(id),
  submission_scope text NOT NULL,
  revision_number integer NOT NULL,
  content text NOT NULL,
  reference_url text,
  submitted_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_mission_submissions_scope_check
    CHECK (submission_scope IN ('GUILD', 'INDIVIDUAL')),
  CONSTRAINT guild3_mission_submissions_content_check CHECK (char_length(btrim(content)) >= 1),
  CONSTRAINT guild3_mission_submissions_revision_check CHECK (revision_number >= 1)
);

-- GUILD revisions are shared by a guild; INDIVIDUAL revisions are independent
-- per student. Partial unique indexes preserve both contracts without relying
-- on a PostgreSQL-version-specific NULLS NOT DISTINCT feature.
CREATE UNIQUE INDEX guild3_mission_submissions_guild_revision_unique
  ON public.guild3_mission_submissions(mission_id, guild_id, revision_number)
  WHERE submission_scope = 'GUILD';
CREATE UNIQUE INDEX guild3_mission_submissions_individual_revision_unique
  ON public.guild3_mission_submissions(mission_id, submitted_by_student_id, revision_number)
  WHERE submission_scope = 'INDIVIDUAL';
CREATE INDEX ix_guild3_mission_submissions_instance_revision
  ON public.guild3_mission_submissions(mission_instance_id, submitted_at DESC, id DESC);
CREATE INDEX ix_guild3_mission_submissions_student
  ON public.guild3_mission_submissions(submitted_by_student_id, mission_id DESC, revision_number DESC);

COMMENT ON TABLE public.guild3_mission_submissions IS
  'Append-only formal mission result submissions. Latest revision is current; earlier evidence is never overwritten or deleted.';

CREATE TABLE public.guild3_mission_activity_records (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  revision_number integer NOT NULL,
  content text NOT NULL,
  submitted_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_activity_records_revision_unique UNIQUE (mission_id, student_id, revision_number),
  CONSTRAINT guild3_activity_records_content_check
    CHECK (char_length(btrim(content)) BETWEEN 20 AND 500),
  CONSTRAINT guild3_activity_records_revision_check CHECK (revision_number >= 1)
);

CREATE INDEX ix_guild3_activity_records_participant_revision
  ON public.guild3_mission_activity_records(mission_id, student_id, revision_number DESC, id DESC);
CREATE INDEX ix_guild3_activity_records_instance
  ON public.guild3_mission_activity_records(mission_instance_id, student_id, submitted_at DESC);

COMMENT ON TABLE public.guild3_mission_activity_records IS
  'Append-only personal activity evidence. Students may add a new revision only through the allowed activity-record deadline.';

CREATE TABLE public.guild3_mission_grade_events (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  participant_id bigint NOT NULL REFERENCES public.guild3_mission_participants(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  grade text NOT NULL,
  is_missing_activity_override boolean NOT NULL DEFAULT false,
  override_reason text,
  supersedes_grade_event_id bigint REFERENCES public.guild3_mission_grade_events(id),
  graded_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  graded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_mission_grade_events_grade_check CHECK (grade IN ('S', 'A', 'B', 'C', 'F')),
  CONSTRAINT guild3_mission_grade_events_override_shape_check CHECK (
    (is_missing_activity_override = false AND override_reason IS NULL)
    OR (is_missing_activity_override = true AND grade <> 'F'
      AND char_length(btrim(coalesce(override_reason, ''))) BETWEEN 2 AND 300)
  )
);

CREATE INDEX ix_guild3_mission_grade_events_participant
  ON public.guild3_mission_grade_events(participant_id, graded_at DESC, id DESC);
CREATE INDEX ix_guild3_mission_grade_events_mission_student
  ON public.guild3_mission_grade_events(mission_id, student_id, id DESC);

COMMENT ON TABLE public.guild3_mission_grade_events IS
  'Append-only S/A/B/C/F teacher grade evidence. A non-F grade without a personal activity record is an audited exception requiring a reason.';

CREATE TABLE public.guild3_mission_judgment_events (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  guild_result text NOT NULL,
  event_kind text NOT NULL,
  reason text,
  supersedes_judgment_event_id bigint REFERENCES public.guild3_mission_judgment_events(id),
  judged_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  judged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_mission_judgment_events_result_check CHECK (guild_result IN ('CLEARED', 'FAILED')),
  CONSTRAINT guild3_mission_judgment_events_kind_check CHECK (event_kind IN ('JUDGMENT', 'CORRECTION')),
  CONSTRAINT guild3_mission_judgment_events_reason_check
    CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 2 AND 300)
);

CREATE INDEX ix_guild3_mission_judgment_events_instance
  ON public.guild3_mission_judgment_events(mission_instance_id, judged_at DESC, id DESC);

COMMENT ON TABLE public.guild3_mission_judgment_events IS
  'Append-only guild CLEARED/FAILED judgment evidence. Corrections supersede but never erase prior official judgment evidence.';

CREATE TABLE public.guild3_mission_audit_events (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint REFERENCES public.guild3_mission_instances(id),
  participant_id bigint REFERENCES public.guild3_mission_participants(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  event_kind text NOT NULL,
  reason text,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild3_mission_audit_events_kind_check CHECK (char_length(btrim(event_kind)) BETWEEN 2 AND 100),
  CONSTRAINT guild3_mission_audit_events_reason_check
    CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 2 AND 300),
  CONSTRAINT guild3_mission_audit_events_before_object_check CHECK (jsonb_typeof(before_data) = 'object'),
  CONSTRAINT guild3_mission_audit_events_after_object_check CHECK (jsonb_typeof(after_data) = 'object')
);

CREATE INDEX ix_guild3_mission_audit_events_mission_time
  ON public.guild3_mission_audit_events(mission_id, occurred_at DESC, id DESC);
CREATE INDEX ix_guild3_mission_audit_events_instance_time
  ON public.guild3_mission_audit_events(mission_instance_id, occurred_at DESC, id DESC)
  WHERE mission_instance_id IS NOT NULL;

COMMENT ON TABLE public.guild3_mission_audit_events IS
  'Append-only lifecycle/configuration/correction audit evidence for Guild 3. It never replaces raw mission evidence.';

CREATE TABLE public.guild3_peer_review_openings (
  id bigserial PRIMARY KEY,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  opening_status text NOT NULL DEFAULT 'OPENABLE',
  opened_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  CONSTRAINT guild3_peer_review_openings_instance_unique UNIQUE (mission_instance_id),
  CONSTRAINT guild3_peer_review_openings_status_check CHECK (opening_status IN ('OPENABLE', 'VOIDED')),
  CONSTRAINT guild3_peer_review_openings_void_shape_check CHECK (
    (opening_status = 'OPENABLE' AND voided_at IS NULL AND void_reason IS NULL)
    OR (opening_status = 'VOIDED' AND voided_at IS NOT NULL
      AND char_length(btrim(coalesce(void_reason, ''))) BETWEEN 2 AND 300)
  )
);

CREATE INDEX ix_guild3_peer_review_openings_future_round
  ON public.guild3_peer_review_openings(classroom_id, season_id, guild_id, opening_status, mission_id);

COMMENT ON TABLE public.guild3_peer_review_openings IS
  'Stable Guild 4 opening condition created once when a peer-review-required mission finalizes. It is not a peer score or a fake Guild 4 round.';

-- -----------------------------------------------------------------------------
-- 2. Immutability and configuration-freeze guards.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild3_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER guild3_missions_set_updated_at
  BEFORE UPDATE ON public.guild3_missions
  FOR EACH ROW EXECUTE FUNCTION public.guild3_set_updated_at();
CREATE TRIGGER guild3_mission_instances_set_updated_at
  BEFORE UPDATE ON public.guild3_mission_instances
  FOR EACH ROW EXECUTE FUNCTION public.guild3_set_updated_at();

CREATE OR REPLACE FUNCTION public.guild3_block_immutable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '[G3] % is append-only mission history and cannot be changed or deleted.', TG_TABLE_NAME
    USING ERRCODE = 'P0301';
END;
$$;

CREATE TRIGGER guild3_mission_participants_immutable
  BEFORE UPDATE OR DELETE ON public.guild3_mission_participants
  FOR EACH ROW EXECUTE FUNCTION public.guild3_block_immutable_history_mutation();
CREATE TRIGGER guild3_mission_submissions_immutable
  BEFORE UPDATE OR DELETE ON public.guild3_mission_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guild3_block_immutable_history_mutation();
CREATE TRIGGER guild3_mission_activity_records_immutable
  BEFORE UPDATE OR DELETE ON public.guild3_mission_activity_records
  FOR EACH ROW EXECUTE FUNCTION public.guild3_block_immutable_history_mutation();
CREATE TRIGGER guild3_mission_grade_events_immutable
  BEFORE UPDATE OR DELETE ON public.guild3_mission_grade_events
  FOR EACH ROW EXECUTE FUNCTION public.guild3_block_immutable_history_mutation();
CREATE TRIGGER guild3_mission_judgment_events_immutable
  BEFORE UPDATE OR DELETE ON public.guild3_mission_judgment_events
  FOR EACH ROW EXECUTE FUNCTION public.guild3_block_immutable_history_mutation();
CREATE TRIGGER guild3_mission_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.guild3_mission_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.guild3_block_immutable_history_mutation();

CREATE OR REPLACE FUNCTION public.guild3_guard_mission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[G3] missions are historical records and cannot be deleted.' USING ERRCODE = 'P0302';
  END IF;

  IF OLD.lifecycle_state IN ('CANCELLED', 'VOIDED') THEN
    RAISE EXCEPTION '[G3] cancelled or voided mission is terminal and immutable.' USING ERRCODE = 'P0303';
  END IF;

  IF OLD.lifecycle_state = 'FINALIZED' AND NEW.lifecycle_state NOT IN ('FINALIZED', 'VOIDED') THEN
    RAISE EXCEPTION '[G3] finalized mission can change only through the explicit VOIDED correction flow.' USING ERRCODE = 'P0304';
  END IF;

  IF OLD.lifecycle_state <> 'DRAFT' AND (
    NEW.classroom_id IS DISTINCT FROM OLD.classroom_id
    OR NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.contribution_year_month IS DISTINCT FROM OLD.contribution_year_month
    OR NEW.weight IS DISTINCT FROM OLD.weight
    OR NEW.submission_scope IS DISTINCT FROM OLD.submission_scope
    OR NEW.submission_requirement IS DISTINCT FROM OLD.submission_requirement
    OR NEW.peer_review_required IS DISTINCT FROM OLD.peer_review_required
  ) THEN
    RAISE EXCEPTION '[G3] scoring-critical mission configuration is frozen after publication.' USING ERRCODE = 'P0305';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guild3_missions_guard_mutation
  BEFORE UPDATE OR DELETE ON public.guild3_missions
  FOR EACH ROW EXECUTE FUNCTION public.guild3_guard_mission_mutation();

-- -----------------------------------------------------------------------------
-- 3. Direct table security. Student mission reads are purpose-specific RPCs,
-- not raw table SELECTs, so DRAFT hidden fields cannot leak through a client
-- query. Every table write goes through a SECURITY DEFINER function.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild3_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_activity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_grade_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_judgment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_mission_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild3_peer_review_openings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guild3_missions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_instances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_activity_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_grade_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_judgment_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_mission_audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guild3_peer_review_openings FROM PUBLIC, anon, authenticated;

-- Policies are defense in depth for future carefully scoped direct reads.
-- No authenticated table grant is made in this migration.
CREATE POLICY guild3_missions_teacher_select
  ON public.guild3_missions
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_mission_instances_teacher_select
  ON public.guild3_mission_instances
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_mission_participants_teacher_select
  ON public.guild3_mission_participants
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_mission_submissions_teacher_select
  ON public.guild3_mission_submissions
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_activity_records_teacher_select
  ON public.guild3_mission_activity_records
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_grade_events_teacher_select
  ON public.guild3_mission_grade_events
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND EXISTS (
      SELECT 1
      FROM public.guild3_missions mission
      WHERE mission.id = guild3_mission_grade_events.mission_id
        AND mission.classroom_id = public.current_classroom_id()
    )
  );
CREATE POLICY guild3_judgment_events_teacher_select
  ON public.guild3_mission_judgment_events
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_audit_events_teacher_select
  ON public.guild3_mission_audit_events
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );
CREATE POLICY guild3_peer_openings_teacher_select
  ON public.guild3_peer_review_openings
  FOR SELECT TO authenticated
  USING (
    public.is_teacher_or_admin()
    AND classroom_id = public.current_classroom_id()
  );

-- -----------------------------------------------------------------------------
-- 4. Internal helpers. They are SECURITY DEFINER only where they read raw
-- protected evidence; browser roles receive no direct EXECUTE grant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild3_validate_submission_configuration(
  p_submission_scope text,
  p_submission_requirement text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (p_submission_scope IN ('GUILD', 'INDIVIDUAL')
      AND p_submission_requirement IN ('REQUIRED', 'OPTIONAL'))
     OR (p_submission_scope = 'NONE' AND p_submission_requirement = 'NONE') THEN
    RETURN;
  END IF;

  RAISE EXCEPTION '[G3] invalid submission scope/requirement combination.'
    USING ERRCODE = 'P0306';
END;
$$;

CREATE OR REPLACE FUNCTION public.guild3_write_audit_event(
  p_mission_id bigint,
  p_mission_instance_id bigint,
  p_participant_id bigint,
  p_classroom_id integer,
  p_event_kind text,
  p_reason text,
  p_before_data jsonb,
  p_after_data jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.guild3_mission_audit_events (
    mission_id, mission_instance_id, participant_id, classroom_id,
    event_kind, reason, before_data, after_data, actor_user_id
  ) VALUES (
    p_mission_id, p_mission_instance_id, p_participant_id, p_classroom_id,
    p_event_kind, p_reason, coalesce(p_before_data, '{}'::jsonb),
    coalesce(p_after_data, '{}'::jsonb), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guild3_latest_activity_record_id(
  p_mission_id bigint,
  p_student_id integer
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT activity.id
  FROM public.guild3_mission_activity_records activity
  WHERE activity.mission_id = p_mission_id
    AND activity.student_id = p_student_id
  ORDER BY activity.revision_number DESC, activity.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.guild3_validate_submission_configuration(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild3_write_audit_event(bigint, bigint, bigint, integer, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild3_latest_activity_record_id(bigint, integer) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. SQL Editor-safe structural postcheck. This only inspects catalogs; it
-- does not call teacher-authenticated functions or modify production data.
-- -----------------------------------------------------------------------------
SELECT
  to_regclass('public.guild3_missions') IS NOT NULL AS mission_table_exists,
  to_regclass('public.guild3_mission_instances') IS NOT NULL AS instance_table_exists,
  to_regclass('public.guild3_mission_participants') IS NOT NULL AS participant_snapshot_table_exists,
  to_regclass('public.guild3_mission_submissions') IS NOT NULL AS submission_history_table_exists,
  to_regclass('public.guild3_mission_activity_records') IS NOT NULL AS activity_history_table_exists,
  to_regclass('public.guild3_mission_grade_events') IS NOT NULL AS grade_history_table_exists,
  to_regclass('public.guild3_mission_judgment_events') IS NOT NULL AS judgment_history_table_exists,
  to_regclass('public.guild3_peer_review_openings') IS NOT NULL AS guild4_opening_table_exists,
  NOT has_table_privilege('authenticated', 'public.guild3_missions', 'SELECT') AS raw_mission_table_not_granted_to_authenticated,
  NOT has_function_privilege('authenticated', 'public.guild3_write_audit_event(bigint,bigint,bigint,integer,text,text,jsonb,jsonb)', 'EXECUTE') AS internal_audit_helper_not_granted_to_authenticated;

COMMIT;
