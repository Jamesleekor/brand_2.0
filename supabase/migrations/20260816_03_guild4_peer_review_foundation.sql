-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 4-A1 Peer Review Foundation + Review Capture
-- 2026-08-16
--
-- LOCKED source contract:
--   Guild3 FINALIZED + peer_review_required=true -> guild3_peer_review_openings
--   Guild3 mission-instance participant snapshot is copied exactly once.
--
-- This migration is intentionally additive and does NOT yet:
--   * post 2,000 GOLD missing-review penalties,
--   * compute the final /300 Peer score,
--   * connect Guild4 score readiness to Guild2,
--   * freeze/correct through Guild5 month FINAL/REOPEN.
-- Those cross-feature adapters belong to Guild4-A2 after Guild3 E2E is closed.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.is_teacher_or_admin()') IS NULL THEN
    RAISE EXCEPTION '[G4] required auth/context helpers are missing.';
  END IF;

  IF to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild3_mission_participants') IS NULL
     OR to_regclass('public.guild3_peer_review_openings') IS NULL
     OR to_regclass('public.transactions') IS NULL
     OR to_regclass('public.test_classroom_fixtures') IS NULL THEN
    RAISE EXCEPTION '[G4] Guild3 source tables must exist first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Round / participant / obligation current projections.
-- -----------------------------------------------------------------------------
CREATE TABLE public.guild4_peer_review_rounds (
  id bigserial PRIMARY KEY,
  source_opening_id bigint NOT NULL REFERENCES public.guild3_peer_review_openings(id) ON DELETE CASCADE,
  mission_id bigint NOT NULL REFERENCES public.guild3_missions(id),
  mission_instance_id bigint NOT NULL REFERENCES public.guild3_mission_instances(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  lifecycle_state text NOT NULL DEFAULT 'OPEN',
  deadline_at timestamptz NOT NULL,
  source_finalized_at timestamptz NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  finalized_at timestamptz,
  created_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_rounds_source_opening_unique UNIQUE (source_opening_id),
  CONSTRAINT guild4_rounds_instance_unique UNIQUE (mission_instance_id),
  CONSTRAINT guild4_rounds_state_check CHECK (lifecycle_state IN ('OPEN','CLOSED','FINALIZED')),
  CONSTRAINT guild4_rounds_deadline_check CHECK (deadline_at >= source_finalized_at),
  CONSTRAINT guild4_rounds_lifecycle_shape_check CHECK (
    (lifecycle_state='OPEN' AND closed_at IS NULL AND finalized_at IS NULL)
    OR (lifecycle_state='CLOSED' AND closed_at IS NOT NULL AND finalized_at IS NULL)
    OR (lifecycle_state='FINALIZED' AND closed_at IS NOT NULL AND finalized_at IS NOT NULL)
  )
);

CREATE INDEX ix_guild4_rounds_classroom_state_deadline
  ON public.guild4_peer_review_rounds(classroom_id,lifecycle_state,deadline_at,id);
CREATE INDEX ix_guild4_rounds_season_guild
  ON public.guild4_peer_review_rounds(season_id,guild_id,id);
CREATE INDEX ix_guild4_rounds_mission
  ON public.guild4_peer_review_rounds(mission_id,mission_instance_id);

COMMENT ON TABLE public.guild4_peer_review_rounds IS
  'Guild4 peer-review round materialized from one Guild3 peer-review opening. Participant/target scope never follows later guild membership changes.';

CREATE TABLE public.guild4_peer_review_participants (
  id bigserial PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  source_guild3_participant_id bigint NOT NULL REFERENCES public.guild3_mission_participants(id),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  student_name_at_snapshot text NOT NULL,
  guild_name_at_snapshot text NOT NULL,
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_participants_round_student_unique UNIQUE (round_id,student_id),
  CONSTRAINT guild4_participants_source_unique UNIQUE (source_guild3_participant_id)
);

CREATE INDEX ix_guild4_participants_student_round
  ON public.guild4_peer_review_participants(student_id,round_id DESC);
CREATE INDEX ix_guild4_participants_round
  ON public.guild4_peer_review_participants(round_id,student_id);

COMMENT ON TABLE public.guild4_peer_review_participants IS
  'Immutable Guild4 participant snapshot copied from Guild3 mission participants.';

CREATE TABLE public.guild4_peer_review_obligations (
  id bigserial PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  reviewer_participant_id bigint NOT NULL REFERENCES public.guild4_peer_review_participants(id) ON DELETE CASCADE,
  target_participant_id bigint NOT NULL REFERENCES public.guild4_peer_review_participants(id) ON DELETE CASCADE,
  reviewer_student_id integer NOT NULL REFERENCES public.students(id),
  target_student_id integer NOT NULL REFERENCES public.students(id),
  obligation_status text NOT NULL DEFAULT 'REQUIRED',
  latest_review_revision_id bigint,
  latest_review_revision_number integer,
  latest_submitted_at timestamptz,
  current_exception_reason text,
  current_exception_at timestamptz,
  current_exception_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_obligations_round_pair_unique UNIQUE (round_id,reviewer_student_id,target_student_id),
  CONSTRAINT guild4_obligations_no_self_check CHECK (reviewer_student_id <> target_student_id),
  CONSTRAINT guild4_obligations_status_check CHECK (obligation_status IN ('REQUIRED','EXCUSED')),
  CONSTRAINT guild4_obligations_review_projection_check CHECK (
    (latest_review_revision_id IS NULL AND latest_review_revision_number IS NULL AND latest_submitted_at IS NULL)
    OR (latest_review_revision_id IS NOT NULL AND latest_review_revision_number >= 1 AND latest_submitted_at IS NOT NULL)
  ),
  CONSTRAINT guild4_obligations_exception_shape_check CHECK (
    (obligation_status='REQUIRED' AND current_exception_reason IS NULL AND current_exception_at IS NULL AND current_exception_by_user_id IS NULL)
    OR (obligation_status='EXCUSED'
        AND char_length(btrim(coalesce(current_exception_reason,''))) BETWEEN 2 AND 500
        AND current_exception_at IS NOT NULL
        AND current_exception_by_user_id IS NOT NULL)
  )
);

CREATE INDEX ix_guild4_obligations_reviewer_status
  ON public.guild4_peer_review_obligations(round_id,reviewer_student_id,obligation_status,id);
CREATE INDEX ix_guild4_obligations_target
  ON public.guild4_peer_review_obligations(round_id,target_student_id,id);

COMMENT ON TABLE public.guild4_peer_review_obligations IS
  'Directed reviewer->target obligations. EXCUSED obligations are excluded from completion/penalty/scoring denominators by later Guild4-A2 logic.';

-- -----------------------------------------------------------------------------
-- 2. Append-only review / exception / audit evidence.
-- -----------------------------------------------------------------------------
CREATE TABLE public.guild4_peer_review_revisions (
  id bigserial PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  obligation_id bigint NOT NULL REFERENCES public.guild4_peer_review_obligations(id) ON DELETE CASCADE,
  reviewer_student_id integer NOT NULL REFERENCES public.students(id),
  target_student_id integer NOT NULL REFERENCES public.students(id),
  revision_number integer NOT NULL,
  score smallint NOT NULL,
  comment text NOT NULL,
  submitted_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_review_revisions_obligation_revision_unique UNIQUE (obligation_id,revision_number),
  CONSTRAINT guild4_review_revisions_revision_check CHECK (revision_number >= 1),
  CONSTRAINT guild4_review_revisions_score_check CHECK (score BETWEEN 1 AND 10),
  CONSTRAINT guild4_review_revisions_comment_check CHECK (char_length(btrim(comment)) >= 20),
  CONSTRAINT guild4_review_revisions_no_self_check CHECK (reviewer_student_id <> target_student_id)
);

ALTER TABLE public.guild4_peer_review_obligations
  ADD CONSTRAINT guild4_obligations_latest_revision_fk
  FOREIGN KEY (latest_review_revision_id)
  REFERENCES public.guild4_peer_review_revisions(id) ON DELETE SET NULL;

CREATE INDEX ix_guild4_review_revisions_round_reviewer
  ON public.guild4_peer_review_revisions(round_id,reviewer_student_id,submitted_at DESC,id DESC);
CREATE INDEX ix_guild4_review_revisions_round_target
  ON public.guild4_peer_review_revisions(round_id,target_student_id,submitted_at DESC,id DESC);

COMMENT ON TABLE public.guild4_peer_review_revisions IS
  'Append-only student peer-review revisions. Deadline-time edits create a new revision; old scores/comments are never overwritten.';

CREATE TABLE public.guild4_peer_review_exception_events (
  id bigserial PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  obligation_id bigint NOT NULL REFERENCES public.guild4_peer_review_obligations(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_exception_events_kind_check CHECK (event_kind IN ('EXCUSED','RESTORED')),
  CONSTRAINT guild4_exception_events_reason_check CHECK (char_length(btrim(reason)) BETWEEN 2 AND 500)
);

CREATE INDEX ix_guild4_exception_events_obligation
  ON public.guild4_peer_review_exception_events(obligation_id,occurred_at DESC,id DESC);

CREATE TABLE public.guild4_peer_review_audit_events (
  id bigserial PRIMARY KEY,
  round_id bigint REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  obligation_id bigint REFERENCES public.guild4_peer_review_obligations(id) ON DELETE CASCADE,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  event_kind text NOT NULL,
  reason text,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_audit_kind_check CHECK (char_length(btrim(event_kind)) BETWEEN 2 AND 100),
  CONSTRAINT guild4_audit_reason_check CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 2 AND 500),
  CONSTRAINT guild4_audit_before_object_check CHECK (jsonb_typeof(before_data)='object'),
  CONSTRAINT guild4_audit_after_object_check CHECK (jsonb_typeof(after_data)='object')
);

CREATE INDEX ix_guild4_audit_round_time
  ON public.guild4_peer_review_audit_events(round_id,occurred_at DESC,id DESC)
  WHERE round_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Reserved shells for A2 penalty/scoring integration.
--    These tables make the data contract explicit without touching economy/Guild2.
-- -----------------------------------------------------------------------------
CREATE TABLE public.guild4_peer_review_penalties (
  id bigserial PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  reviewer_participant_id bigint NOT NULL REFERENCES public.guild4_peer_review_participants(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES public.students(id),
  penalty_amount bigint NOT NULL DEFAULT 2000,
  penalty_status text NOT NULL DEFAULT 'NOT_EVALUATED',
  missing_required_count integer NOT NULL DEFAULT 0,
  transaction_id bigint REFERENCES public.transactions(id),
  waiver_reason text,
  evaluated_at timestamptz,
  waived_at timestamptz,
  waived_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_penalties_round_student_unique UNIQUE(round_id,student_id),
  CONSTRAINT guild4_penalties_amount_check CHECK (penalty_amount=2000),
  CONSTRAINT guild4_penalties_missing_count_check CHECK (missing_required_count >= 0),
  CONSTRAINT guild4_penalties_status_check CHECK (penalty_status IN ('NOT_EVALUATED','NO_PENALTY','POSTED','PENDING_FUNDS','WAIVED')),
  CONSTRAINT guild4_penalties_waiver_shape_check CHECK (
    (penalty_status <> 'WAIVED' AND waiver_reason IS NULL AND waived_at IS NULL AND waived_by_user_id IS NULL)
    OR (penalty_status='WAIVED'
        AND char_length(btrim(coalesce(waiver_reason,''))) BETWEEN 2 AND 500
        AND waived_at IS NOT NULL
        AND waived_by_user_id IS NOT NULL)
  )
);

CREATE INDEX ix_guild4_penalties_round_status
  ON public.guild4_peer_review_penalties(round_id,penalty_status,student_id);

CREATE TABLE public.guild4_peer_review_score_rollups (
  id bigserial PRIMARY KEY,
  round_id bigint NOT NULL REFERENCES public.guild4_peer_review_rounds(id) ON DELETE CASCADE,
  target_participant_id bigint NOT NULL REFERENCES public.guild4_peer_review_participants(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES public.students(id),
  rollup_status text NOT NULL DEFAULT 'NOT_CALCULATED',
  eligible_review_count integer NOT NULL DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz,
  calculation_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild4_score_rollups_round_student_unique UNIQUE(round_id,student_id),
  CONSTRAINT guild4_score_rollups_status_check CHECK (rollup_status IN ('NOT_CALCULATED','CALCULATED','EXCLUDED')),
  CONSTRAINT guild4_score_rollups_count_check CHECK (eligible_review_count >= 0),
  CONSTRAINT guild4_score_rollups_payload_object_check CHECK (jsonb_typeof(raw_payload)='object')
);

CREATE INDEX ix_guild4_score_rollups_round_status
  ON public.guild4_peer_review_score_rollups(round_id,rollup_status,student_id);

COMMENT ON TABLE public.guild4_peer_review_penalties IS
  'One penalty decision per reviewer per round. A2 will enforce the locked 2,000 GOLD once-per-round rule and POSTED/PENDING_FUNDS/WAIVED transitions.';
COMMENT ON TABLE public.guild4_peer_review_score_rollups IS
  'Reserved per-round target rollup projection. A2 will populate bias-corrected scoring and later monthly Guild2 adapter state.';

-- -----------------------------------------------------------------------------
-- 4. Mutation guards and timestamps.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild4_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
BEGIN
  NEW.updated_at=now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER guild4_rounds_set_updated_at
  BEFORE UPDATE ON public.guild4_peer_review_rounds
  FOR EACH ROW EXECUTE FUNCTION public.guild4_set_updated_at();
CREATE TRIGGER guild4_obligations_set_updated_at
  BEFORE UPDATE ON public.guild4_peer_review_obligations
  FOR EACH ROW EXECUTE FUNCTION public.guild4_set_updated_at();
CREATE TRIGGER guild4_penalties_set_updated_at
  BEFORE UPDATE ON public.guild4_peer_review_penalties
  FOR EACH ROW EXECUTE FUNCTION public.guild4_set_updated_at();

CREATE OR REPLACE FUNCTION public.guild4_block_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures AS fixture
    WHERE fixture.fixture_code='BRAND_TEST_V1'
      AND fixture.classroom_id=CASE
        WHEN coalesce(current_setting('brand.test_fixture_reset_classroom_id',true),'') ~ '^[0-9]+$'
          THEN current_setting('brand.test_fixture_reset_classroom_id',true)::integer
        ELSE NULL
      END
  ) THEN
    IF TG_OP='DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '[G4] % is append-only history and cannot be changed or deleted.',TG_TABLE_NAME
    USING ERRCODE='P0401';
END;
$$;

CREATE TRIGGER guild4_review_revisions_append_only
  BEFORE UPDATE OR DELETE ON public.guild4_peer_review_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guild4_block_append_only_mutation();
CREATE TRIGGER guild4_exception_events_append_only
  BEFORE UPDATE OR DELETE ON public.guild4_peer_review_exception_events
  FOR EACH ROW EXECUTE FUNCTION public.guild4_block_append_only_mutation();
CREATE TRIGGER guild4_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.guild4_peer_review_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.guild4_block_append_only_mutation();

-- Participant roster is immutable after materialization.
CREATE OR REPLACE FUNCTION public.guild4_block_participant_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures AS fixture
    WHERE fixture.fixture_code='BRAND_TEST_V1'
      AND fixture.classroom_id=CASE
        WHEN coalesce(current_setting('brand.test_fixture_reset_classroom_id',true),'') ~ '^[0-9]+$'
          THEN current_setting('brand.test_fixture_reset_classroom_id',true)::integer
        ELSE NULL
      END
  ) THEN
    IF TG_OP='DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '[G4] peer-review participant snapshot is immutable.' USING ERRCODE='P0402';
END;
$$;
CREATE TRIGGER guild4_participants_immutable
  BEFORE UPDATE OR DELETE ON public.guild4_peer_review_participants
  FOR EACH ROW EXECUTE FUNCTION public.guild4_block_participant_mutation();

-- -----------------------------------------------------------------------------
-- 5. Direct table security: no browser role gets raw table access.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild4_peer_review_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_exception_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_score_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild4_peer_review_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guild4_peer_review_rounds FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_participants FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_obligations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_revisions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_exception_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_penalties FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_score_rollups FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.guild4_peer_review_audit_events FROM PUBLIC,anon,authenticated;

CREATE POLICY guild4_rounds_teacher_select ON public.guild4_peer_review_rounds
  FOR SELECT TO authenticated
  USING(public.is_teacher_or_admin() AND classroom_id=public.current_classroom_id());
CREATE POLICY guild4_participants_teacher_select ON public.guild4_peer_review_participants
  FOR SELECT TO authenticated
  USING(public.is_teacher_or_admin() AND classroom_id=public.current_classroom_id());

-- Other child tables intentionally have no direct policy/grant. Teacher/student
-- reads are purpose-specific RPCs so raw reviewer identity/score/comment cannot leak.

-- -----------------------------------------------------------------------------
-- 6. Internal audit/materialization helpers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild4_write_audit_event(
  p_round_id bigint,
  p_obligation_id bigint,
  p_classroom_id integer,
  p_event_kind text,
  p_reason text,
  p_before_data jsonb,
  p_after_data jsonb,
  p_actor_user_id uuid DEFAULT auth.uid()
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.guild4_peer_review_audit_events(
    round_id,obligation_id,classroom_id,event_kind,reason,before_data,after_data,actor_user_id
  ) VALUES (
    p_round_id,p_obligation_id,p_classroom_id,btrim(p_event_kind),nullif(btrim(coalesce(p_reason,'')),''),
    coalesce(p_before_data,'{}'::jsonb),coalesce(p_after_data,'{}'::jsonb),p_actor_user_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guild4_materialize_round_from_opening(p_opening_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_opening public.guild3_peer_review_openings%ROWTYPE;
  v_mission public.guild3_missions%ROWTYPE;
  v_instance public.guild3_mission_instances%ROWTYPE;
  v_round_id bigint;
  v_participant_count integer;
  v_obligation_count integer;
BEGIN
  SELECT * INTO v_opening
  FROM public.guild3_peer_review_openings
  WHERE id=p_opening_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[G4] source opening not found.' USING ERRCODE='P0410';
  END IF;

  SELECT id INTO v_round_id
  FROM public.guild4_peer_review_rounds
  WHERE source_opening_id=v_opening.id;
  IF v_round_id IS NOT NULL THEN
    RETURN v_round_id;
  END IF;

  IF v_opening.opening_status <> 'OPENABLE' OR v_opening.voided_at IS NOT NULL THEN
    RAISE EXCEPTION '[G4] source opening is not openable.' USING ERRCODE='P0411';
  END IF;

  SELECT * INTO v_mission FROM public.guild3_missions WHERE id=v_opening.mission_id;
  SELECT * INTO v_instance FROM public.guild3_mission_instances WHERE id=v_opening.mission_instance_id;

  IF v_mission.id IS NULL OR v_instance.id IS NULL
     OR v_mission.lifecycle_state <> 'FINALIZED'
     OR v_mission.peer_review_required IS DISTINCT FROM true
     OR v_mission.finalized_at IS NULL
     OR v_instance.mission_id IS DISTINCT FROM v_mission.id
     OR v_instance.classroom_id IS DISTINCT FROM v_opening.classroom_id
     OR v_instance.guild_id IS DISTINCT FROM v_opening.guild_id THEN
    RAISE EXCEPTION '[G4] Guild3 source opening contract is inconsistent.' USING ERRCODE='P0412';
  END IF;

  INSERT INTO public.guild4_peer_review_rounds(
    source_opening_id,mission_id,mission_instance_id,classroom_id,season_id,guild_id,
    lifecycle_state,deadline_at,source_finalized_at,opened_at,created_by_user_id
  ) VALUES (
    v_opening.id,v_opening.mission_id,v_opening.mission_instance_id,v_opening.classroom_id,v_opening.season_id,v_opening.guild_id,
    'OPEN',v_mission.finalized_at+interval '48 hours',v_mission.finalized_at,now(),auth.uid()
  ) RETURNING id INTO v_round_id;

  INSERT INTO public.guild4_peer_review_participants(
    round_id,source_guild3_participant_id,classroom_id,season_id,guild_id,student_id,
    student_name_at_snapshot,guild_name_at_snapshot,snapshot_at
  )
  SELECT
    v_round_id,p.id,p.classroom_id,p.season_id,p.guild_id,p.student_id,
    p.student_name_at_snapshot,p.guild_name_at_snapshot,p.snapshot_at
  FROM public.guild3_mission_participants p
  WHERE p.mission_instance_id=v_opening.mission_instance_id
  ORDER BY p.student_id;

  GET DIAGNOSTICS v_participant_count=ROW_COUNT;

  INSERT INTO public.guild4_peer_review_obligations(
    round_id,reviewer_participant_id,target_participant_id,reviewer_student_id,target_student_id
  )
  SELECT
    v_round_id,rp.id,tp.id,rp.student_id,tp.student_id
  FROM public.guild4_peer_review_participants rp
  JOIN public.guild4_peer_review_participants tp
    ON tp.round_id=rp.round_id AND tp.student_id<>rp.student_id
  WHERE rp.round_id=v_round_id
  ORDER BY rp.student_id,tp.student_id;

  GET DIAGNOSTICS v_obligation_count=ROW_COUNT;

  -- Pre-create one penalty-decision shell per reviewer and one score shell per target.
  INSERT INTO public.guild4_peer_review_penalties(round_id,reviewer_participant_id,student_id)
  SELECT v_round_id,p.id,p.student_id
  FROM public.guild4_peer_review_participants p
  WHERE p.round_id=v_round_id;

  INSERT INTO public.guild4_peer_review_score_rollups(round_id,target_participant_id,student_id)
  SELECT v_round_id,p.id,p.student_id
  FROM public.guild4_peer_review_participants p
  WHERE p.round_id=v_round_id;

  PERFORM public.guild4_write_audit_event(
    v_round_id,NULL,v_opening.classroom_id,'ROUND_MATERIALIZED',NULL,'{}'::jsonb,
    jsonb_build_object(
      'source_opening_id',v_opening.id,
      'source_finalized_at',v_mission.finalized_at,
      'deadline_at',v_mission.finalized_at+interval '48 hours',
      'participant_count',v_participant_count,
      'obligation_count',v_obligation_count
    ),auth.uid()
  );

  RETURN v_round_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Teacher RPCs: sync/opening materialization + operations safe before A2.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_sync_guild4_peer_review_rounds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_opening record;
  v_round_id bigint;
  v_created integer:=0;
  v_existing integer:=0;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G4] teacher classroom context is missing.' USING ERRCODE='P0420';
  END IF;

  FOR v_opening IN
    SELECT o.id
    FROM public.guild3_peer_review_openings o
    JOIN public.guild3_missions m ON m.id=o.mission_id
    WHERE o.classroom_id=v_classroom_id
      AND o.opening_status='OPENABLE'
      AND m.lifecycle_state='FINALIZED'
      AND m.peer_review_required=true
    ORDER BY o.id
  LOOP
    IF EXISTS(SELECT 1 FROM public.guild4_peer_review_rounds r WHERE r.source_opening_id=v_opening.id) THEN
      v_existing:=v_existing+1;
    ELSE
      v_round_id:=public.guild4_materialize_round_from_opening(v_opening.id);
      v_created:=v_created+1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created',v_created,'already_existing',v_existing);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_list_guild4_peer_review_rounds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_classroom_id integer; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'deadline_at' DESC,x->>'round_id' DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'round_id',r.id,
      'mission_id',r.mission_id,
      'mission_title',m.title,
      'guild_id',r.guild_id,
      'guild_name',g.name,
      'lifecycle_state',r.lifecycle_state,
      'deadline_at',r.deadline_at,
      'source_finalized_at',r.source_finalized_at,
      'participant_count',(SELECT count(*) FROM public.guild4_peer_review_participants p WHERE p.round_id=r.id),
      'required_obligation_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.obligation_status='REQUIRED'),
      'submitted_required_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.obligation_status='REQUIRED' AND o.latest_review_revision_id IS NOT NULL),
      'excused_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.obligation_status='EXCUSED')
    ) AS x
    FROM public.guild4_peer_review_rounds r
    JOIN public.guild3_missions m ON m.id=r.mission_id
    JOIN public.guilds g ON g.id=r.guild_id
    WHERE r.classroom_id=v_classroom_id
  ) q;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_guild4_peer_review_round_detail(p_round_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_classroom_id integer; v_round public.guild4_peer_review_rounds%ROWTYPE; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id;
  IF NOT FOUND OR v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] round not found in teacher classroom.' USING ERRCODE='P0421';
  END IF;

  SELECT jsonb_build_object(
    'round',to_jsonb(v_round),
    'mission',(SELECT jsonb_build_object('id',m.id,'title',m.title,'finalized_at',m.finalized_at,'lifecycle_state',m.lifecycle_state) FROM public.guild3_missions m WHERE m.id=v_round.mission_id),
    'participants',coalesce((
      SELECT jsonb_agg(jsonb_build_object('participant_id',p.id,'student_id',p.student_id,'student_name',p.student_name_at_snapshot) ORDER BY p.student_id)
      FROM public.guild4_peer_review_participants p WHERE p.round_id=v_round.id
    ),'[]'::jsonb),
    'obligations',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'obligation_id',o.id,
        'reviewer_student_id',o.reviewer_student_id,
        'reviewer_name',rp.student_name_at_snapshot,
        'target_student_id',o.target_student_id,
        'target_name',tp.student_name_at_snapshot,
        'obligation_status',o.obligation_status,
        'latest_revision_number',o.latest_review_revision_number,
        'latest_submitted_at',o.latest_submitted_at,
        'current_exception_reason',o.current_exception_reason,
        'latest_review',CASE WHEN rv.id IS NULL THEN NULL ELSE jsonb_build_object(
          'revision_id',rv.id,'revision_number',rv.revision_number,'score',rv.score,'comment',rv.comment,'submitted_at',rv.submitted_at
        ) END
      ) ORDER BY rp.student_id,tp.student_id)
      FROM public.guild4_peer_review_obligations o
      JOIN public.guild4_peer_review_participants rp ON rp.id=o.reviewer_participant_id
      JOIN public.guild4_peer_review_participants tp ON tp.id=o.target_participant_id
      LEFT JOIN public.guild4_peer_review_revisions rv ON rv.id=o.latest_review_revision_id
      WHERE o.round_id=v_round.id
    ),'[]'::jsonb),
    'review_revision_history',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',rv.id,'obligation_id',rv.obligation_id,'reviewer_student_id',rv.reviewer_student_id,'target_student_id',rv.target_student_id,
        'revision_number',rv.revision_number,'score',rv.score,'comment',rv.comment,'submitted_at',rv.submitted_at
      ) ORDER BY rv.submitted_at,rv.id)
      FROM public.guild4_peer_review_revisions rv WHERE rv.round_id=v_round.id
    ),'[]'::jsonb),
    'audit_history',coalesce((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.occurred_at,a.id)
      FROM public.guild4_peer_review_audit_events a WHERE a.round_id=v_round.id
    ),'[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_update_guild4_peer_review_deadline(
  p_round_id bigint,
  p_deadline_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_classroom_id integer; v_round public.guild4_peer_review_rounds%ROWTYPE; v_before timestamptz; v_reason text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=btrim(coalesce(p_reason,''));
  IF char_length(v_reason)<2 OR char_length(v_reason)>500 THEN
    RAISE EXCEPTION '[G4] deadline change reason must be 2-500 characters.' USING ERRCODE='P0422';
  END IF;

  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] round not found in teacher classroom.' USING ERRCODE='P0423';
  END IF;
  IF v_round.lifecycle_state<>'OPEN' THEN
    RAISE EXCEPTION '[G4] deadline may be changed only while round is OPEN.' USING ERRCODE='P0424';
  END IF;
  IF p_deadline_at IS NULL OR p_deadline_at<v_round.source_finalized_at THEN
    RAISE EXCEPTION '[G4] invalid deadline.' USING ERRCODE='P0425';
  END IF;

  v_before:=v_round.deadline_at;
  UPDATE public.guild4_peer_review_rounds SET deadline_at=p_deadline_at WHERE id=v_round.id;
  PERFORM public.guild4_write_audit_event(v_round.id,NULL,v_classroom_id,'DEADLINE_CHANGED',v_reason,
    jsonb_build_object('deadline_at',v_before),jsonb_build_object('deadline_at',p_deadline_at),auth.uid());

  RETURN jsonb_build_object('round_id',v_round.id,'deadline_at',p_deadline_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild4_peer_review_excused(
  p_obligation_id bigint,
  p_excused boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer; v_ob public.guild4_peer_review_obligations%ROWTYPE;
  v_round public.guild4_peer_review_rounds%ROWTYPE; v_reason text; v_before text; v_after text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=btrim(coalesce(p_reason,''));
  IF char_length(v_reason)<2 OR char_length(v_reason)>500 THEN
    RAISE EXCEPTION '[G4] exception reason must be 2-500 characters.' USING ERRCODE='P0426';
  END IF;

  SELECT * INTO v_ob FROM public.guild4_peer_review_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[G4] obligation not found.' USING ERRCODE='P0427'; END IF;
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=v_ob.round_id FOR UPDATE;
  IF v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] obligation not found in teacher classroom.' USING ERRCODE='P0428';
  END IF;
  IF v_round.lifecycle_state='FINALIZED' THEN
    RAISE EXCEPTION '[G4] finalized round exception changes are reserved for audited correction flow.' USING ERRCODE='P0429';
  END IF;

  v_before:=v_ob.obligation_status;
  v_after:=CASE WHEN p_excused THEN 'EXCUSED' ELSE 'REQUIRED' END;

  IF v_before=v_after THEN
    RETURN jsonb_build_object('obligation_id',v_ob.id,'obligation_status',v_before,'changed',false);
  END IF;

  IF p_excused THEN
    UPDATE public.guild4_peer_review_obligations
    SET obligation_status='EXCUSED',current_exception_reason=v_reason,current_exception_at=now(),current_exception_by_user_id=auth.uid()
    WHERE id=v_ob.id;
  ELSE
    UPDATE public.guild4_peer_review_obligations
    SET obligation_status='REQUIRED',current_exception_reason=NULL,current_exception_at=NULL,current_exception_by_user_id=NULL
    WHERE id=v_ob.id;
  END IF;

  INSERT INTO public.guild4_peer_review_exception_events(round_id,obligation_id,event_kind,reason)
  VALUES(v_round.id,v_ob.id,CASE WHEN p_excused THEN 'EXCUSED' ELSE 'RESTORED' END,v_reason);

  PERFORM public.guild4_write_audit_event(v_round.id,v_ob.id,v_classroom_id,
    CASE WHEN p_excused THEN 'OBLIGATION_EXCUSED' ELSE 'OBLIGATION_RESTORED' END,v_reason,
    jsonb_build_object('obligation_status',v_before),jsonb_build_object('obligation_status',v_after),auth.uid());

  RETURN jsonb_build_object('obligation_id',v_ob.id,'obligation_status',v_after,'changed',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_close_guild4_peer_review_round(
  p_round_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_classroom_id integer; v_round public.guild4_peer_review_rounds%ROWTYPE; v_reason text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=btrim(coalesce(p_reason,''));
  IF char_length(v_reason)<2 OR char_length(v_reason)>500 THEN
    RAISE EXCEPTION '[G4] close reason must be 2-500 characters.' USING ERRCODE='P0430';
  END IF;

  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] round not found in teacher classroom.' USING ERRCODE='P0431';
  END IF;
  IF v_round.lifecycle_state<>'OPEN' THEN
    RAISE EXCEPTION '[G4] only OPEN round may be closed.' USING ERRCODE='P0432';
  END IF;

  UPDATE public.guild4_peer_review_rounds SET lifecycle_state='CLOSED',closed_at=now() WHERE id=v_round.id;
  PERFORM public.guild4_write_audit_event(v_round.id,NULL,v_classroom_id,'ROUND_CLOSED',v_reason,
    jsonb_build_object('lifecycle_state','OPEN'),jsonb_build_object('lifecycle_state','CLOSED','closed_at',now()),auth.uid());
  RETURN jsonb_build_object('round_id',v_round.id,'lifecycle_state','CLOSED');
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Student RPCs: own obligations only; received raw review data never exposed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_guild4_peer_review_rounds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_student_id integer; v_classroom_id integer; v_result jsonb;
BEGIN
  v_student_id:=public.current_student_id();
  v_classroom_id:=public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G4] student context is missing.' USING ERRCODE='P0440';
  END IF;

  SELECT coalesce(jsonb_agg(round_row ORDER BY round_row->>'deadline_at' DESC,round_row->>'round_id' DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'round_id',r.id,
      'mission_id',r.mission_id,
      'mission_title',m.title,
      'guild_name',p.guild_name_at_snapshot,
      'lifecycle_state',r.lifecycle_state,
      'deadline_at',r.deadline_at,
      'required_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.reviewer_student_id=v_student_id AND o.obligation_status='REQUIRED'),
      'submitted_required_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.reviewer_student_id=v_student_id AND o.obligation_status='REQUIRED' AND o.latest_review_revision_id IS NOT NULL),
      'obligations',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'obligation_id',o.id,
          'target_student_id',o.target_student_id,
          'target_name',tp.student_name_at_snapshot,
          'obligation_status',o.obligation_status,
          'latest_review_revision_number',o.latest_review_revision_number,
          'latest_score',rv.score,
          'latest_comment',rv.comment,
          'latest_submitted_at',o.latest_submitted_at
        ) ORDER BY tp.student_id)
        FROM public.guild4_peer_review_obligations o
        JOIN public.guild4_peer_review_participants tp ON tp.id=o.target_participant_id
        LEFT JOIN public.guild4_peer_review_revisions rv ON rv.id=o.latest_review_revision_id
        WHERE o.round_id=r.id AND o.reviewer_student_id=v_student_id
      ),'[]'::jsonb)
    ) AS round_row
    FROM public.guild4_peer_review_participants p
    JOIN public.guild4_peer_review_rounds r ON r.id=p.round_id
    JOIN public.guild3_missions m ON m.id=r.mission_id
    WHERE p.student_id=v_student_id AND r.classroom_id=v_classroom_id
  ) q;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_submit_guild4_peer_review(
  p_obligation_id bigint,
  p_score integer,
  p_comment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student_id integer; v_classroom_id integer; v_ob public.guild4_peer_review_obligations%ROWTYPE;
  v_round public.guild4_peer_review_rounds%ROWTYPE; v_revision integer; v_revision_id bigint; v_comment text;
BEGIN
  v_student_id:=public.current_student_id();
  v_classroom_id:=public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G4] student context is missing.' USING ERRCODE='P0441';
  END IF;
  IF p_score IS NULL OR p_score<1 OR p_score>10 THEN
    RAISE EXCEPTION '[G4] review score must be 1-10.' USING ERRCODE='P0442';
  END IF;
  v_comment:=btrim(coalesce(p_comment,''));
  IF char_length(v_comment)<20 THEN
    RAISE EXCEPTION '[G4] review comment must be at least 20 characters.' USING ERRCODE='P0443';
  END IF;

  SELECT * INTO v_ob FROM public.guild4_peer_review_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND OR v_ob.reviewer_student_id IS DISTINCT FROM v_student_id THEN
    RAISE EXCEPTION '[G4] this review obligation does not belong to the current student.' USING ERRCODE='P0444';
  END IF;

  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=v_ob.round_id FOR UPDATE;
  IF v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] peer-review round classroom mismatch.' USING ERRCODE='P0445';
  END IF;
  IF v_round.lifecycle_state<>'OPEN' THEN
    RAISE EXCEPTION '[G4] peer-review round is not OPEN.' USING ERRCODE='P0446';
  END IF;
  IF now()>v_round.deadline_at THEN
    RAISE EXCEPTION '[G4] peer-review deadline has passed.' USING ERRCODE='P0447';
  END IF;
  IF v_ob.obligation_status='EXCUSED' THEN
    RAISE EXCEPTION '[G4] this review obligation is EXCUSED.' USING ERRCODE='P0448';
  END IF;

  SELECT coalesce(max(revision_number),0)+1 INTO v_revision
  FROM public.guild4_peer_review_revisions
  WHERE obligation_id=v_ob.id;

  INSERT INTO public.guild4_peer_review_revisions(
    round_id,obligation_id,reviewer_student_id,target_student_id,revision_number,score,comment
  ) VALUES (
    v_round.id,v_ob.id,v_student_id,v_ob.target_student_id,v_revision,p_score,v_comment
  ) RETURNING id INTO v_revision_id;

  UPDATE public.guild4_peer_review_obligations
  SET latest_review_revision_id=v_revision_id,latest_review_revision_number=v_revision,latest_submitted_at=now()
  WHERE id=v_ob.id;

  PERFORM public.guild4_write_audit_event(v_round.id,v_ob.id,v_classroom_id,'REVIEW_REVISION_SUBMITTED',NULL,
    jsonb_build_object('previous_revision_number',v_ob.latest_review_revision_number),
    jsonb_build_object('revision_number',v_revision),auth.uid());

  RETURN jsonb_build_object(
    'round_id',v_round.id,'obligation_id',v_ob.id,'revision_id',v_revision_id,'revision_number',v_revision,'submitted_at',now()
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Function privileges. Browser clients execute only purpose-specific RPCs.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guild4_set_updated_at() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_block_append_only_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_block_participant_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_write_audit_event(bigint,bigint,integer,text,text,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_materialize_round_from_opening(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild4_materialize_round_from_opening(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.teacher_sync_guild4_peer_review_rounds() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_list_guild4_peer_review_rounds() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_get_guild4_peer_review_round_detail(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_update_guild4_peer_review_deadline(bigint,timestamptz,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_set_guild4_peer_review_excused(bigint,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_close_guild4_peer_review_round(bigint,text) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.teacher_sync_guild4_peer_review_rounds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_list_guild4_peer_review_rounds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_guild4_peer_review_round_detail(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_update_guild4_peer_review_deadline(bigint,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild4_peer_review_excused(bigint,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_close_guild4_peer_review_round(bigint,text) TO authenticated;

REVOKE ALL ON FUNCTION public.student_get_guild4_peer_review_rounds() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.student_submit_guild4_peer_review(bigint,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild4_peer_review_rounds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_guild4_peer_review(bigint,integer,text) TO authenticated;

COMMIT;
