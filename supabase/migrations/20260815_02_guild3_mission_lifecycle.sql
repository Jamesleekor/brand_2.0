-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 3 Mission lifecycle and evidence RPCs
-- 2026-08-15
--
-- Depends on: 20260815_01_guild3_mission_foundation.sql
--
-- Scope
--   * Teacher DRAFT → ACTIVE → CLOSED → FINALIZED lifecycle, cancellation,
--     correction, and void flows.
--   * Immutable participant snapshots, formal submission/activity revisions,
--     quick S/A/B/C/F grading, guild CLEARED/FAILED judgement, and Guild 4
--     open-condition evidence.
--   * Student and teacher read RPCs. Students never receive raw unpublished
--     mission rows, hidden teacher fields, other students' activity records,
--     or grade-calculation internals.
--   * Guild 2 refresh is invoked after finalization/correction. The following
--     migration replaces Guild 2's Mission placeholder with this source data.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild3_mission_participants') IS NULL
     OR to_regclass('public.guild3_mission_submissions') IS NULL
     OR to_regclass('public.guild3_mission_activity_records') IS NULL
     OR to_regclass('public.guild3_mission_grade_events') IS NULL
     OR to_regclass('public.guild3_mission_judgment_events') IS NULL
     OR to_regclass('public.guild3_peer_review_openings') IS NULL THEN
    RAISE EXCEPTION '[G3] Guild 3 foundation migration must be applied first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Teacher mission definition and lifecycle.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_create_guild3_mission(
  p_contribution_year_month text,
  p_title text,
  p_teaser_visible boolean,
  p_teaser_title text,
  p_description text,
  p_student_success_criteria text,
  p_teacher_guidance text,
  p_weight numeric,
  p_submission_scope text,
  p_submission_requirement text,
  p_due_at timestamptz,
  p_activity_record_due_at timestamptz,
  p_peer_review_required boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_season_id integer;
  v_activity_due_at timestamptz;
  v_mission public.guild3_missions%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G3] teacher classroom context is missing.' USING ERRCODE = 'P0310';
  END IF;
  IF coalesce(p_contribution_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G3] contribution month must be YYYY-MM.' USING ERRCODE = 'P0311';
  END IF;
  IF char_length(btrim(coalesce(p_title, ''))) < 1 THEN
    RAISE EXCEPTION '[G3] mission title is required.' USING ERRCODE = 'P0312';
  END IF;
  IF p_weight IS NULL OR p_weight <= 0 THEN
    RAISE EXCEPTION '[G3] mission weight must be greater than zero.' USING ERRCODE = 'P0313';
  END IF;
  IF p_due_at IS NULL THEN
    RAISE EXCEPTION '[G3] mission due_at is required.' USING ERRCODE = 'P0314';
  END IF;

  PERFORM public.guild3_validate_submission_configuration(
    p_submission_scope,
    p_submission_requirement
  );

  v_activity_due_at := coalesce(p_activity_record_due_at, p_due_at + interval '24 hours');
  IF v_activity_due_at < p_due_at THEN
    RAISE EXCEPTION '[G3] activity-record deadline cannot be earlier than mission deadline.'
      USING ERRCODE = 'P0315';
  END IF;

  v_season_id := public.guild2_resolve_season_for_month(v_classroom_id, p_contribution_year_month);

  INSERT INTO public.guild3_missions (
    classroom_id, season_id, contribution_year_month,
    title, teaser_visible, teaser_title, description, student_success_criteria,
    teacher_guidance, weight, submission_scope, submission_requirement,
    due_at, activity_record_due_at, peer_review_required, lifecycle_state,
    created_by_user_id
  ) VALUES (
    v_classroom_id, v_season_id, p_contribution_year_month,
    btrim(p_title), coalesce(p_teaser_visible, false), nullif(btrim(p_teaser_title), ''),
    nullif(btrim(p_description), ''), nullif(btrim(p_student_success_criteria), ''),
    nullif(btrim(p_teacher_guidance), ''), p_weight,
    p_submission_scope, p_submission_requirement,
    p_due_at, v_activity_due_at, coalesce(p_peer_review_required, true), 'DRAFT', auth.uid()
  )
  RETURNING * INTO v_mission;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_CREATED', NULL,
    '{}'::jsonb,
    jsonb_build_object(
      'lifecycle_state', v_mission.lifecycle_state,
      'contribution_year_month', v_mission.contribution_year_month,
      'season_id', v_mission.season_id,
      'weight', v_mission.weight,
      'submission_scope', v_mission.submission_scope,
      'submission_requirement', v_mission.submission_requirement,
      'peer_review_required', v_mission.peer_review_required
    )
  );

  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'season_id', v_mission.season_id,
    'contribution_year_month', v_mission.contribution_year_month
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_update_guild3_mission_draft(
  p_mission_id bigint,
  p_contribution_year_month text,
  p_title text,
  p_teaser_visible boolean,
  p_teaser_title text,
  p_description text,
  p_student_success_criteria text,
  p_teacher_guidance text,
  p_weight numeric,
  p_submission_scope text,
  p_submission_requirement text,
  p_due_at timestamptz,
  p_activity_record_due_at timestamptz,
  p_peer_review_required boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_season_id integer;
  v_activity_due_at timestamptz;
  v_mission public.guild3_missions%ROWTYPE;
  v_before jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission
  FROM public.guild3_missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'DRAFT' THEN
    RAISE EXCEPTION '[G3] only DRAFT missions may use the draft editor.' USING ERRCODE = 'P0317';
  END IF;
  IF coalesce(p_contribution_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR char_length(btrim(coalesce(p_title, ''))) < 1
     OR p_weight IS NULL OR p_weight <= 0 OR p_due_at IS NULL THEN
    RAISE EXCEPTION '[G3] mission draft input is incomplete or invalid.' USING ERRCODE = 'P0318';
  END IF;

  PERFORM public.guild3_validate_submission_configuration(
    p_submission_scope,
    p_submission_requirement
  );
  v_activity_due_at := coalesce(p_activity_record_due_at, p_due_at + interval '24 hours');
  IF v_activity_due_at < p_due_at THEN
    RAISE EXCEPTION '[G3] activity-record deadline cannot be earlier than mission deadline.'
      USING ERRCODE = 'P0315';
  END IF;
  v_season_id := public.guild2_resolve_season_for_month(v_classroom_id, p_contribution_year_month);
  v_before := to_jsonb(v_mission);

  UPDATE public.guild3_missions
  SET season_id = v_season_id,
      contribution_year_month = p_contribution_year_month,
      title = btrim(p_title),
      teaser_visible = coalesce(p_teaser_visible, false),
      teaser_title = nullif(btrim(p_teaser_title), ''),
      description = nullif(btrim(p_description), ''),
      student_success_criteria = nullif(btrim(p_student_success_criteria), ''),
      teacher_guidance = nullif(btrim(p_teacher_guidance), ''),
      weight = p_weight,
      submission_scope = p_submission_scope,
      submission_requirement = p_submission_requirement,
      due_at = p_due_at,
      activity_record_due_at = v_activity_due_at,
      peer_review_required = coalesce(p_peer_review_required, true)
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_DRAFT_UPDATED', NULL,
    v_before, to_jsonb(v_mission)
  );

  RETURN jsonb_build_object('mission_id', v_mission.id, 'lifecycle_state', v_mission.lifecycle_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_update_guild3_mission_presentation(
  p_mission_id bigint,
  p_title text,
  p_teaser_visible boolean,
  p_teaser_title text,
  p_description text,
  p_student_success_criteria text,
  p_teacher_guidance text,
  p_due_at timestamptz,
  p_activity_record_due_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state NOT IN ('ACTIVE', 'CLOSED') THEN
    RAISE EXCEPTION '[G3] published presentation updates are allowed only before finalization.' USING ERRCODE = 'P0319';
  END IF;
  IF char_length(btrim(coalesce(p_title, ''))) < 1 OR p_due_at IS NULL
     OR p_activity_record_due_at IS NULL OR p_activity_record_due_at < p_due_at
     OR char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] audited presentation correction input is invalid.' USING ERRCODE = 'P0320';
  END IF;

  v_before := to_jsonb(v_mission);
  UPDATE public.guild3_missions
  SET title = btrim(p_title),
      teaser_visible = coalesce(p_teaser_visible, false),
      teaser_title = nullif(btrim(p_teaser_title), ''),
      description = nullif(btrim(p_description), ''),
      student_success_criteria = nullif(btrim(p_student_success_criteria), ''),
      teacher_guidance = nullif(btrim(p_teacher_guidance), ''),
      due_at = p_due_at,
      activity_record_due_at = p_activity_record_due_at
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_PRESENTATION_CORRECTED', p_reason,
    v_before, to_jsonb(v_mission)
  );
  RETURN jsonb_build_object('mission_id', v_mission.id, 'lifecycle_state', v_mission.lifecycle_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_publish_guild3_mission(
  p_mission_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_instance_count integer;
  v_participant_count integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'DRAFT' THEN
    RAISE EXCEPTION '[G3] only a DRAFT mission can be published.' USING ERRCODE = 'P0321';
  END IF;

  IF v_mission.season_id IS DISTINCT FROM public.guild2_resolve_season_for_month(
    v_classroom_id,
    v_mission.contribution_year_month
  ) THEN
    RAISE EXCEPTION '[G3] mission season no longer matches its contribution month.' USING ERRCODE = 'P0322';
  END IF;

  INSERT INTO public.guild3_mission_instances (
    mission_id, classroom_id, season_id, guild_id, special_rule_note
  )
  SELECT v_mission.id, v_mission.classroom_id, v_mission.season_id, guild.id, NULL
  FROM public.guilds guild
  WHERE guild.classroom_id = v_mission.classroom_id
    AND guild.season_id = v_mission.season_id
    AND coalesce(guild.is_active, true);
  GET DIAGNOSTICS v_instance_count = ROW_COUNT;

  INSERT INTO public.guild3_mission_participants (
    mission_id, mission_instance_id, classroom_id, season_id, guild_id,
    student_id, membership_id, student_name_at_snapshot, guild_name_at_snapshot,
    assigned_element_at_snapshot, membership_joined_at_at_snapshot, snapshot_at
  )
  SELECT
    v_mission.id, instance.id, v_mission.classroom_id, v_mission.season_id, instance.guild_id,
    student.id, membership.id, student.name::text, guild.name::text,
    membership.element::text, membership.joined_at, now()
  FROM public.guild3_mission_instances instance
  JOIN public.guilds guild ON guild.id = instance.guild_id
  JOIN public.guild_members membership
    ON membership.guild_id = instance.guild_id
   AND membership.season_id = v_mission.season_id
   AND membership.left_at IS NULL
  JOIN public.students student
    ON student.id = membership.student_id
   AND student.classroom_id = v_mission.classroom_id
   AND student.transferred_at IS NULL
   AND student.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD')
  WHERE instance.mission_id = v_mission.id;
  GET DIAGNOSTICS v_participant_count = ROW_COUNT;

  IF v_instance_count = 0 OR v_participant_count = 0 THEN
    RAISE EXCEPTION '[G3] an official mission needs at least one active guild and participant snapshot.'
      USING ERRCODE = 'P0323';
  END IF;

  UPDATE public.guild3_missions
  SET lifecycle_state = 'ACTIVE', published_at = now()
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_PUBLISHED', NULL,
    jsonb_build_object('lifecycle_state', 'DRAFT'),
    jsonb_build_object('lifecycle_state', 'ACTIVE', 'instance_count', v_instance_count, 'participant_count', v_participant_count)
  );
  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'instance_count', v_instance_count,
    'participant_count', v_participant_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_close_guild3_mission(
  p_mission_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'ACTIVE' THEN
    RAISE EXCEPTION '[G3] only an ACTIVE mission can be closed.' USING ERRCODE = 'P0324';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] close reason must be 2 to 300 characters.' USING ERRCODE = 'P0325';
  END IF;

  UPDATE public.guild3_missions
  SET lifecycle_state = 'CLOSED', closed_at = now()
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;
  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_CLOSED', p_reason,
    jsonb_build_object('lifecycle_state', 'ACTIVE'), jsonb_build_object('lifecycle_state', 'CLOSED')
  );
  RETURN jsonb_build_object('mission_id', v_mission.id, 'lifecycle_state', v_mission.lifecycle_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_reopen_guild3_mission(
  p_mission_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'CLOSED' THEN
    RAISE EXCEPTION '[G3] only a CLOSED mission can be reopened.' USING ERRCODE = 'P0326';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] reopen reason must be 2 to 300 characters.' USING ERRCODE = 'P0327';
  END IF;

  UPDATE public.guild3_missions
  SET lifecycle_state = 'ACTIVE', closed_at = NULL
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;
  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_REOPENED', p_reason,
    jsonb_build_object('lifecycle_state', 'CLOSED'), jsonb_build_object('lifecycle_state', 'ACTIVE')
  );
  RETURN jsonb_build_object('mission_id', v_mission.id, 'lifecycle_state', v_mission.lifecycle_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_cancel_guild3_mission(
  p_mission_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_before jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state NOT IN ('DRAFT', 'ACTIVE', 'CLOSED') THEN
    RAISE EXCEPTION '[G3] only DRAFT, ACTIVE, or CLOSED mission can be cancelled.' USING ERRCODE = 'P0328';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] cancellation reason must be 2 to 300 characters.' USING ERRCODE = 'P0329';
  END IF;

  v_before := jsonb_build_object('lifecycle_state', v_mission.lifecycle_state);
  UPDATE public.guild3_missions
  SET lifecycle_state = 'CANCELLED', cancelled_at = now()
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;
  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_CANCELLED', p_reason,
    v_before,
    jsonb_build_object('lifecycle_state', 'CANCELLED')
  );
  RETURN jsonb_build_object('mission_id', v_mission.id, 'lifecycle_state', v_mission.lifecycle_state);
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Student submissions and activity records. Both are revision inserts;
-- no browser role receives direct INSERT or UPDATE on the raw tables.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_submit_guild3_mission_result(
  p_mission_id bigint,
  p_content text,
  p_reference_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_participant public.guild3_mission_participants%ROWTYPE;
  v_revision_number integer;
  v_submission_id bigint;
BEGIN
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION '[G3] authenticated student context is required.' USING ERRCODE = 'P0330';
  END IF;
  IF char_length(btrim(coalesce(p_content, ''))) < 1 THEN
    RAISE EXCEPTION '[G3] mission submission content is required.' USING ERRCODE = 'P0331';
  END IF;

  SELECT * INTO v_mission
  FROM public.guild3_missions
  WHERE id = p_mission_id
  FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0332';
  END IF;
  IF v_mission.lifecycle_state <> 'ACTIVE' OR clock_timestamp() >= v_mission.due_at THEN
    RAISE EXCEPTION '[G3] formal mission submission is closed.' USING ERRCODE = 'P0333';
  END IF;
  IF v_mission.submission_scope = 'NONE' THEN
    RAISE EXCEPTION '[G3] this mission has no formal submission.' USING ERRCODE = 'P0334';
  END IF;

  SELECT * INTO v_participant
  FROM public.guild3_mission_participants
  WHERE mission_id = v_mission.id AND student_id = v_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G3] only a participant in this mission snapshot can submit.' USING ERRCODE = 'P0335';
  END IF;

  PERFORM pg_advisory_xact_lock(v_mission.id);
  IF v_mission.submission_scope = 'GUILD' THEN
    SELECT coalesce(max(revision_number), 0) + 1 INTO v_revision_number
    FROM public.guild3_mission_submissions
    WHERE mission_id = v_mission.id
      AND guild_id = v_participant.guild_id
      AND submission_scope = 'GUILD';
  ELSE
    SELECT coalesce(max(revision_number), 0) + 1 INTO v_revision_number
    FROM public.guild3_mission_submissions
    WHERE mission_id = v_mission.id
      AND submitted_by_student_id = v_student_id
      AND submission_scope = 'INDIVIDUAL';
  END IF;

  INSERT INTO public.guild3_mission_submissions (
    mission_id, mission_instance_id, classroom_id, guild_id,
    submitted_by_student_id, submission_scope, revision_number,
    content, reference_url, submitted_by_user_id
  ) VALUES (
    v_mission.id, v_participant.mission_instance_id, v_classroom_id, v_participant.guild_id,
    v_student_id, v_mission.submission_scope, v_revision_number,
    btrim(p_content), nullif(btrim(p_reference_url), ''), auth.uid()
  )
  RETURNING id INTO v_submission_id;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, v_participant.mission_instance_id, v_participant.id, v_classroom_id,
    'MISSION_SUBMISSION_REVISION', NULL,
    jsonb_build_object('previous_revision_number', v_revision_number - 1),
    jsonb_build_object('submission_id', v_submission_id, 'revision_number', v_revision_number,
      'submission_scope', v_mission.submission_scope)
  );
  RETURN jsonb_build_object(
    'submission_id', v_submission_id,
    'revision_number', v_revision_number,
    'submission_scope', v_mission.submission_scope
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_record_guild3_mission_activity(
  p_mission_id bigint,
  p_content text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_participant public.guild3_mission_participants%ROWTYPE;
  v_revision_number integer;
  v_activity_id bigint;
BEGIN
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION '[G3] authenticated student context is required.' USING ERRCODE = 'P0330';
  END IF;
  IF char_length(btrim(coalesce(p_content, ''))) NOT BETWEEN 20 AND 500 THEN
    RAISE EXCEPTION '[G3] personal activity record must be 20 to 500 characters.' USING ERRCODE = 'P0336';
  END IF;

  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0332';
  END IF;
  IF v_mission.lifecycle_state NOT IN ('ACTIVE', 'CLOSED')
     OR clock_timestamp() > v_mission.activity_record_due_at THEN
    RAISE EXCEPTION '[G3] personal activity-record deadline has passed.' USING ERRCODE = 'P0337';
  END IF;
  SELECT * INTO v_participant
  FROM public.guild3_mission_participants
  WHERE mission_id = v_mission.id AND student_id = v_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G3] only a participant in this mission snapshot can record activity.' USING ERRCODE = 'P0338';
  END IF;

  PERFORM pg_advisory_xact_lock(v_mission.id);
  SELECT coalesce(max(revision_number), 0) + 1 INTO v_revision_number
  FROM public.guild3_mission_activity_records
  WHERE mission_id = v_mission.id AND student_id = v_student_id;

  INSERT INTO public.guild3_mission_activity_records (
    mission_id, mission_instance_id, classroom_id, guild_id, student_id,
    revision_number, content, submitted_by_user_id
  ) VALUES (
    v_mission.id, v_participant.mission_instance_id, v_classroom_id, v_participant.guild_id,
    v_student_id, v_revision_number, btrim(p_content), auth.uid()
  )
  RETURNING id INTO v_activity_id;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, v_participant.mission_instance_id, v_participant.id, v_classroom_id,
    'MISSION_ACTIVITY_RECORD_REVISION', NULL,
    jsonb_build_object('previous_revision_number', v_revision_number - 1),
    jsonb_build_object('activity_record_id', v_activity_id, 'revision_number', v_revision_number)
  );
  RETURN jsonb_build_object('activity_record_id', v_activity_id, 'revision_number', v_revision_number);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Teacher judging and fast S/A/B/C/F grading.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_set_guild3_instance_result(
  p_mission_instance_id bigint,
  p_guild_result text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_instance public.guild3_mission_instances%ROWTYPE;
  v_mission public.guild3_missions%ROWTYPE;
  v_previous_event_id bigint;
  v_event_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_instance FROM public.guild3_mission_instances WHERE id = p_mission_instance_id FOR UPDATE;
  IF NOT FOUND OR v_instance.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission instance was not found in this classroom.' USING ERRCODE = 'P0340';
  END IF;
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = v_instance.mission_id FOR UPDATE;
  IF v_mission.lifecycle_state <> 'CLOSED' THEN
    RAISE EXCEPTION '[G3] guild result can be judged only while mission is CLOSED.' USING ERRCODE = 'P0341';
  END IF;
  IF p_guild_result NOT IN ('CLEARED', 'FAILED') THEN
    RAISE EXCEPTION '[G3] guild result must be CLEARED or FAILED.' USING ERRCODE = 'P0342';
  END IF;
  IF p_reason IS NOT NULL AND char_length(btrim(p_reason)) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] judgment note must be 2 to 300 characters when provided.' USING ERRCODE = 'P0343';
  END IF;

  IF v_instance.current_guild_result = p_guild_result THEN
    RETURN jsonb_build_object('mission_instance_id', v_instance.id, 'guild_result', v_instance.current_guild_result, 'unchanged', true);
  END IF;

  SELECT id INTO v_previous_event_id
  FROM public.guild3_mission_judgment_events
  WHERE mission_instance_id = v_instance.id
  ORDER BY id DESC LIMIT 1;

  INSERT INTO public.guild3_mission_judgment_events (
    mission_id, mission_instance_id, classroom_id, guild_id, guild_result,
    event_kind, reason, supersedes_judgment_event_id, judged_by_user_id
  ) VALUES (
    v_mission.id, v_instance.id, v_classroom_id, v_instance.guild_id, p_guild_result,
    'JUDGMENT', nullif(btrim(p_reason), ''), v_previous_event_id, auth.uid()
  )
  RETURNING id INTO v_event_id;

  UPDATE public.guild3_mission_instances
  SET current_guild_result = p_guild_result, judged_at = now(), judged_by_user_id = auth.uid()
  WHERE id = v_instance.id;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, v_instance.id, NULL, v_classroom_id, 'GUILD_RESULT_JUDGED', nullif(btrim(p_reason), ''),
    jsonb_build_object('guild_result', v_instance.current_guild_result),
    jsonb_build_object('guild_result', p_guild_result, 'judgment_event_id', v_event_id)
  );
  RETURN jsonb_build_object('mission_instance_id', v_instance.id, 'guild_result', p_guild_result, 'judgment_event_id', v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild3_participant_grade(
  p_participant_id bigint,
  p_grade text,
  p_override_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_participant public.guild3_mission_participants%ROWTYPE;
  v_mission public.guild3_missions%ROWTYPE;
  v_has_activity boolean;
  v_is_override boolean;
  v_previous_grade_id bigint;
  v_grade_event_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_participant FROM public.guild3_mission_participants WHERE id = p_participant_id;
  IF NOT FOUND OR v_participant.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission participant was not found in this classroom.' USING ERRCODE = 'P0344';
  END IF;
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = v_participant.mission_id FOR UPDATE;
  IF v_mission.lifecycle_state <> 'CLOSED' THEN
    RAISE EXCEPTION '[G3] participant grade can be set only while mission is CLOSED.' USING ERRCODE = 'P0345';
  END IF;
  IF p_grade NOT IN ('S', 'A', 'B', 'C', 'F') THEN
    RAISE EXCEPTION '[G3] grade must be S, A, B, C, or F.' USING ERRCODE = 'P0346';
  END IF;

  v_has_activity := public.guild3_latest_activity_record_id(v_participant.mission_id, v_participant.student_id) IS NOT NULL;
  v_is_override := NOT v_has_activity AND p_grade <> 'F';
  IF v_is_override AND char_length(btrim(coalesce(p_override_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] a non-F grade without an activity record needs an override reason.' USING ERRCODE = 'P0347';
  END IF;
  IF NOT v_is_override AND p_override_reason IS NOT NULL AND btrim(p_override_reason) <> '' THEN
    RAISE EXCEPTION '[G3] override reason is allowed only for a non-F no-record exception.' USING ERRCODE = 'P0348';
  END IF;

  SELECT id INTO v_previous_grade_id
  FROM public.guild3_mission_grade_events
  WHERE participant_id = v_participant.id
  ORDER BY id DESC LIMIT 1;

  INSERT INTO public.guild3_mission_grade_events (
    mission_id, mission_instance_id, participant_id, student_id, grade,
    is_missing_activity_override, override_reason, supersedes_grade_event_id,
    graded_by_user_id
  ) VALUES (
    v_participant.mission_id, v_participant.mission_instance_id, v_participant.id,
    v_participant.student_id, p_grade, v_is_override,
    CASE WHEN v_is_override THEN btrim(p_override_reason) ELSE NULL END,
    v_previous_grade_id, auth.uid()
  )
  RETURNING id INTO v_grade_event_id;

  PERFORM public.guild3_write_audit_event(
    v_participant.mission_id, v_participant.mission_instance_id, v_participant.id, v_classroom_id,
    'PARTICIPANT_GRADE_SET', CASE WHEN v_is_override THEN btrim(p_override_reason) ELSE NULL END,
    jsonb_build_object('previous_grade_event_id', v_previous_grade_id),
    jsonb_build_object('grade_event_id', v_grade_event_id, 'grade', p_grade, 'missing_activity_override', v_is_override)
  );
  RETURN jsonb_build_object('participant_id', v_participant.id, 'grade_event_id', v_grade_event_id, 'grade', p_grade, 'missing_activity_override', v_is_override);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_apply_guild3_missing_activity_f(
  p_mission_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_count integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'CLOSED' THEN
    RAISE EXCEPTION '[G3] missing-record F bulk action is available only while mission is CLOSED.' USING ERRCODE = 'P0349';
  END IF;

  INSERT INTO public.guild3_mission_grade_events (
    mission_id, mission_instance_id, participant_id, student_id, grade,
    is_missing_activity_override, override_reason, graded_by_user_id
  )
  SELECT participant.mission_id, participant.mission_instance_id, participant.id,
         participant.student_id, 'F', false, NULL, auth.uid()
  FROM public.guild3_mission_participants participant
  WHERE participant.mission_id = v_mission.id
    AND public.guild3_latest_activity_record_id(participant.mission_id, participant.student_id) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.guild3_mission_grade_events grade
      WHERE grade.participant_id = participant.id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSING_ACTIVITY_BULK_F_APPLIED', NULL,
    '{}'::jsonb, jsonb_build_object('grade_events_created', v_count)
  );
  RETURN jsonb_build_object('mission_id', v_mission.id, 'grade_events_created', v_count);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Finalization and explicit pre-Guild-5 correction flows.
--
-- There is no production Guild 5 monthly-close contract yet, as proven by
-- preflight. These correction functions preserve all evidence and are the only
-- available path before that future close. Guild 5 must later add the explicit
-- month-closed assertion rather than Guild 3 inventing a duplicate lock.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_finalize_guild3_mission(
  p_mission_id bigint,
  p_missing_required_submission_override_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_unresolved_instances integer;
  v_ungraded_with_activity integer;
  v_missing_required_submissions integer;
  v_auto_f_count integer;
  v_opening_count integer;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'CLOSED' THEN
    RAISE EXCEPTION '[G3] only a CLOSED mission can be finalized.' USING ERRCODE = 'P0350';
  END IF;
  IF clock_timestamp() < v_mission.activity_record_due_at THEN
    RAISE EXCEPTION '[G3] finalization is available after the personal activity-record deadline.'
      USING ERRCODE = 'P0350';
  END IF;

  SELECT count(*) INTO v_unresolved_instances
  FROM public.guild3_mission_instances instance
  WHERE instance.mission_id = v_mission.id
    AND instance.current_guild_result = 'UNDECIDED';
  IF v_unresolved_instances > 0 THEN
    RAISE EXCEPTION '[G3] every guild instance must be CLEARED or FAILED before finalization.' USING ERRCODE = 'P0351';
  END IF;

  -- The locked default: a participant with no activity record receives F.
  -- This records that official default as immutable evidence rather than
  -- leaving a hidden, non-reproducible fallback in an aggregate query.
  INSERT INTO public.guild3_mission_grade_events (
    mission_id, mission_instance_id, participant_id, student_id, grade,
    is_missing_activity_override, override_reason, graded_by_user_id
  )
  SELECT participant.mission_id, participant.mission_instance_id, participant.id,
         participant.student_id, 'F', false, NULL, auth.uid()
  FROM public.guild3_mission_participants participant
  WHERE participant.mission_id = v_mission.id
    AND public.guild3_latest_activity_record_id(participant.mission_id, participant.student_id) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.guild3_mission_grade_events grade
      WHERE grade.participant_id = participant.id
    );
  GET DIAGNOSTICS v_auto_f_count = ROW_COUNT;

  SELECT count(*) INTO v_ungraded_with_activity
  FROM public.guild3_mission_participants participant
  WHERE participant.mission_id = v_mission.id
    AND public.guild3_latest_activity_record_id(participant.mission_id, participant.student_id) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.guild3_mission_grade_events grade
      WHERE grade.participant_id = participant.id
    );
  IF v_ungraded_with_activity > 0 THEN
    RAISE EXCEPTION '[G3] every participant with an activity record needs S/A/B/C/F before finalization.'
      USING ERRCODE = 'P0352';
  END IF;

  v_missing_required_submissions := 0;
  IF v_mission.submission_requirement = 'REQUIRED' AND v_mission.submission_scope = 'GUILD' THEN
    SELECT count(*) INTO v_missing_required_submissions
    FROM public.guild3_mission_instances instance
    WHERE instance.mission_id = v_mission.id
      AND NOT EXISTS (
        SELECT 1 FROM public.guild3_mission_submissions submission
        WHERE submission.mission_id = v_mission.id
          AND submission.guild_id = instance.guild_id
          AND submission.submission_scope = 'GUILD'
      );
  ELSIF v_mission.submission_requirement = 'REQUIRED' AND v_mission.submission_scope = 'INDIVIDUAL' THEN
    SELECT count(*) INTO v_missing_required_submissions
    FROM public.guild3_mission_participants participant
    WHERE participant.mission_id = v_mission.id
      AND NOT EXISTS (
        SELECT 1 FROM public.guild3_mission_submissions submission
        WHERE submission.mission_id = v_mission.id
          AND submission.submitted_by_student_id = participant.student_id
          AND submission.submission_scope = 'INDIVIDUAL'
      );
  END IF;
  IF v_missing_required_submissions > 0
     AND char_length(btrim(coalesce(p_missing_required_submission_override_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] finalizing with missing REQUIRED submissions needs an explicit 2 to 300 character override reason.'
      USING ERRCODE = 'P0353';
  END IF;

  UPDATE public.guild3_mission_instances
  SET finalized_at = now()
  WHERE mission_id = v_mission.id;

  UPDATE public.guild3_missions
  SET lifecycle_state = 'FINALIZED', finalized_at = now()
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  IF v_mission.peer_review_required THEN
    INSERT INTO public.guild3_peer_review_openings (
      mission_id, mission_instance_id, classroom_id, season_id, guild_id,
      opening_status, created_by_user_id
    )
    SELECT v_mission.id, instance.id, v_mission.classroom_id, v_mission.season_id,
           instance.guild_id, 'OPENABLE', auth.uid()
    FROM public.guild3_mission_instances instance
    WHERE instance.mission_id = v_mission.id
    ON CONFLICT (mission_instance_id) DO NOTHING;
    GET DIAGNOSTICS v_opening_count = ROW_COUNT;
  ELSE
    v_opening_count := 0;
  END IF;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_FINALIZED',
    CASE WHEN v_missing_required_submissions > 0 THEN btrim(p_missing_required_submission_override_reason) ELSE NULL END,
    jsonb_build_object('lifecycle_state', 'CLOSED'),
    jsonb_build_object(
      'lifecycle_state', 'FINALIZED',
      'auto_f_grade_events', v_auto_f_count,
      'missing_required_submission_count', v_missing_required_submissions,
      'guild4_openings_created', v_opening_count
    )
  );

  -- This is intentionally a Guild 2 DRAFT refresh. Guild 5 alone will own
  -- final monthly GS, ranking, reopen, and conquest.
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);

  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'auto_f_grade_events', v_auto_f_count,
    'missing_required_submission_count', v_missing_required_submissions,
    'guild4_openings_created', v_opening_count,
    'guild2_draft_refresh', v_refresh
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_correct_guild3_instance_result(
  p_mission_instance_id bigint,
  p_guild_result text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_instance public.guild3_mission_instances%ROWTYPE;
  v_mission public.guild3_missions%ROWTYPE;
  v_previous_event_id bigint;
  v_event_id bigint;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_instance FROM public.guild3_mission_instances WHERE id = p_mission_instance_id FOR UPDATE;
  IF NOT FOUND OR v_instance.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission instance was not found in this classroom.' USING ERRCODE = 'P0340';
  END IF;
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = v_instance.mission_id FOR UPDATE;
  IF v_mission.lifecycle_state <> 'FINALIZED' THEN
    RAISE EXCEPTION '[G3] explicit result correction is available only after mission finalization.' USING ERRCODE = 'P0354';
  END IF;
  IF p_guild_result NOT IN ('CLEARED', 'FAILED')
     OR char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] correction needs CLEARED/FAILED and a 2 to 300 character reason.' USING ERRCODE = 'P0355';
  END IF;
  IF v_instance.current_guild_result = p_guild_result THEN
    RETURN jsonb_build_object('mission_instance_id', v_instance.id, 'guild_result', p_guild_result, 'unchanged', true);
  END IF;

  SELECT id INTO v_previous_event_id
  FROM public.guild3_mission_judgment_events
  WHERE mission_instance_id = v_instance.id ORDER BY id DESC LIMIT 1;
  INSERT INTO public.guild3_mission_judgment_events (
    mission_id, mission_instance_id, classroom_id, guild_id, guild_result,
    event_kind, reason, supersedes_judgment_event_id, judged_by_user_id
  ) VALUES (
    v_mission.id, v_instance.id, v_classroom_id, v_instance.guild_id, p_guild_result,
    'CORRECTION', btrim(p_reason), v_previous_event_id, auth.uid()
  ) RETURNING id INTO v_event_id;

  UPDATE public.guild3_mission_instances
  SET current_guild_result = p_guild_result, judged_at = now(), judged_by_user_id = auth.uid()
  WHERE id = v_instance.id;
  PERFORM public.guild3_write_audit_event(
    v_mission.id, v_instance.id, NULL, v_classroom_id, 'GUILD_RESULT_CORRECTED', btrim(p_reason),
    jsonb_build_object('guild_result', v_instance.current_guild_result),
    jsonb_build_object('guild_result', p_guild_result, 'judgment_event_id', v_event_id)
  );

  -- Existing Guild 4 opening proof is intentionally not regenerated.
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);
  RETURN jsonb_build_object('mission_instance_id', v_instance.id, 'guild_result', p_guild_result, 'guild2_draft_refresh', v_refresh);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_correct_guild3_participant_grade(
  p_participant_id bigint,
  p_grade text,
  p_override_reason text,
  p_correction_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_participant public.guild3_mission_participants%ROWTYPE;
  v_mission public.guild3_missions%ROWTYPE;
  v_has_activity boolean;
  v_is_override boolean;
  v_previous_grade_id bigint;
  v_grade_event_id bigint;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_participant FROM public.guild3_mission_participants WHERE id = p_participant_id;
  IF NOT FOUND OR v_participant.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission participant was not found in this classroom.' USING ERRCODE = 'P0344';
  END IF;
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = v_participant.mission_id FOR UPDATE;
  IF v_mission.lifecycle_state <> 'FINALIZED' THEN
    RAISE EXCEPTION '[G3] explicit grade correction is available only after mission finalization.' USING ERRCODE = 'P0356';
  END IF;
  IF p_grade NOT IN ('S', 'A', 'B', 'C', 'F')
     OR char_length(btrim(coalesce(p_correction_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] correction needs S/A/B/C/F and a 2 to 300 character reason.' USING ERRCODE = 'P0357';
  END IF;

  v_has_activity := public.guild3_latest_activity_record_id(v_participant.mission_id, v_participant.student_id) IS NOT NULL;
  v_is_override := NOT v_has_activity AND p_grade <> 'F';
  IF v_is_override AND char_length(btrim(coalesce(p_override_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] a non-F correction without an activity record needs an override reason.' USING ERRCODE = 'P0347';
  END IF;
  IF NOT v_is_override AND p_override_reason IS NOT NULL AND btrim(p_override_reason) <> '' THEN
    RAISE EXCEPTION '[G3] override reason is allowed only for a non-F no-record exception.' USING ERRCODE = 'P0348';
  END IF;

  SELECT id INTO v_previous_grade_id
  FROM public.guild3_mission_grade_events
  WHERE participant_id = v_participant.id ORDER BY id DESC LIMIT 1;
  INSERT INTO public.guild3_mission_grade_events (
    mission_id, mission_instance_id, participant_id, student_id, grade,
    is_missing_activity_override, override_reason, supersedes_grade_event_id,
    graded_by_user_id
  ) VALUES (
    v_participant.mission_id, v_participant.mission_instance_id, v_participant.id,
    v_participant.student_id, p_grade, v_is_override,
    CASE WHEN v_is_override THEN btrim(p_override_reason) ELSE NULL END,
    v_previous_grade_id, auth.uid()
  ) RETURNING id INTO v_grade_event_id;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, v_participant.mission_instance_id, v_participant.id, v_classroom_id,
    'PARTICIPANT_GRADE_CORRECTED', btrim(p_correction_reason),
    jsonb_build_object('previous_grade_event_id', v_previous_grade_id),
    jsonb_build_object('grade_event_id', v_grade_event_id, 'grade', p_grade, 'missing_activity_override', v_is_override)
  );
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);
  RETURN jsonb_build_object('participant_id', v_participant.id, 'grade', p_grade, 'guild2_draft_refresh', v_refresh);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_void_guild3_mission(
  p_mission_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_opening_count integer;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;
  IF v_mission.lifecycle_state <> 'FINALIZED' THEN
    RAISE EXCEPTION '[G3] only a FINALIZED mission can be voided through correction flow.' USING ERRCODE = 'P0358';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] void reason must be 2 to 300 characters.' USING ERRCODE = 'P0359';
  END IF;

  UPDATE public.guild3_missions
  SET lifecycle_state = 'VOIDED', voided_at = now()
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  UPDATE public.guild3_peer_review_openings
  SET opening_status = 'VOIDED', voided_at = now(), void_reason = btrim(p_reason)
  WHERE mission_id = v_mission.id
    AND opening_status = 'OPENABLE';
  GET DIAGNOSTICS v_opening_count = ROW_COUNT;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id, 'MISSION_VOIDED', btrim(p_reason),
    jsonb_build_object('lifecycle_state', 'FINALIZED'),
    jsonb_build_object('lifecycle_state', 'VOIDED', 'guild4_openings_voided', v_opening_count)
  );
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);
  RETURN jsonb_build_object('mission_id', v_mission.id, 'lifecycle_state', v_mission.lifecycle_state, 'guild4_openings_voided', v_opening_count, 'guild2_draft_refresh', v_refresh);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Purpose-specific read RPCs. They avoid exposing raw tables to students.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_guild3_mission_board()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student_id integer;
  v_result jsonb;
BEGIN
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION '[G3] authenticated student context is required.' USING ERRCODE = 'P0330';
  END IF;

  SELECT coalesce(jsonb_agg(row_data.payload ORDER BY row_data.sort_due_at, row_data.mission_id), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      mission.id AS mission_id,
      mission.due_at AS sort_due_at,
      CASE
        WHEN mission.lifecycle_state = 'DRAFT' THEN
          jsonb_build_object(
            'mission_id', mission.id,
            'title', coalesce(mission.teaser_title, mission.title),
            'lifecycle_state', 'DRAFT',
            'teaser_only', true
          )
        ELSE
          jsonb_build_object(
            'mission_id', mission.id,
            'title', mission.title,
            'lifecycle_state', mission.lifecycle_state,
            'teaser_only', false,
            'description', mission.description,
            'student_success_criteria', mission.student_success_criteria,
            'due_at', mission.due_at,
            'activity_record_due_at', mission.activity_record_due_at,
            'submission_scope', mission.submission_scope,
            'submission_requirement', mission.submission_requirement,
            'guild_result', instance.current_guild_result,
            'my_grade', CASE WHEN mission.lifecycle_state IN ('FINALIZED', 'VOIDED') THEN latest_grade.grade ELSE NULL END,
            'my_activity_record', latest_activity.content,
            'my_activity_record_revision', latest_activity.revision_number,
            'current_submission', CASE
              WHEN mission.submission_scope = 'GUILD' THEN guild_submission.content
              WHEN mission.submission_scope = 'INDIVIDUAL' THEN individual_submission.content
              ELSE NULL
            END,
            'current_submission_revision', CASE
              WHEN mission.submission_scope = 'GUILD' THEN guild_submission.revision_number
              WHEN mission.submission_scope = 'INDIVIDUAL' THEN individual_submission.revision_number
              ELSE NULL
            END
          )
      END AS payload
    FROM public.guild3_missions mission
    LEFT JOIN public.guild3_mission_participants participant
      ON participant.mission_id = mission.id AND participant.student_id = v_student_id
    LEFT JOIN public.guild3_mission_instances instance ON instance.id = participant.mission_instance_id
    LEFT JOIN LATERAL (
      SELECT activity.content, activity.revision_number
      FROM public.guild3_mission_activity_records activity
      WHERE activity.mission_id = mission.id AND activity.student_id = v_student_id
      ORDER BY activity.revision_number DESC, activity.id DESC
      LIMIT 1
    ) latest_activity ON true
    LEFT JOIN LATERAL (
      SELECT grade.grade
      FROM public.guild3_mission_grade_events grade
      WHERE grade.participant_id = participant.id
      ORDER BY grade.id DESC
      LIMIT 1
    ) latest_grade ON true
    LEFT JOIN LATERAL (
      SELECT submission.content, submission.revision_number
      FROM public.guild3_mission_submissions submission
      WHERE submission.mission_id = mission.id
        AND submission.guild_id = participant.guild_id
        AND submission.submission_scope = 'GUILD'
      ORDER BY submission.revision_number DESC, submission.id DESC
      LIMIT 1
    ) guild_submission ON true
    LEFT JOIN LATERAL (
      SELECT submission.content, submission.revision_number
      FROM public.guild3_mission_submissions submission
      WHERE submission.mission_id = mission.id
        AND submission.submitted_by_student_id = v_student_id
        AND submission.submission_scope = 'INDIVIDUAL'
      ORDER BY submission.revision_number DESC, submission.id DESC
      LIMIT 1
    ) individual_submission ON true
    WHERE mission.classroom_id = v_classroom_id
      AND (
        (mission.lifecycle_state = 'DRAFT' AND mission.teaser_visible)
        OR (mission.lifecycle_state <> 'DRAFT' AND participant.id IS NOT NULL)
      )
  ) row_data;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_guild3_mission_detail(
  p_mission_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_mission public.guild3_missions%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id = p_mission_id;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0316';
  END IF;

  SELECT jsonb_build_object(
    'mission', to_jsonb(v_mission),
    'instances', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'instance', to_jsonb(instance),
          'participants', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'participant', to_jsonb(participant),
              'latest_activity_record', latest_activity.record,
              'latest_grade_event', latest_grade.event
            ) ORDER BY participant.student_name_at_snapshot, participant.id)
            FROM public.guild3_mission_participants participant
            LEFT JOIN LATERAL (
              SELECT to_jsonb(activity) AS record
              FROM public.guild3_mission_activity_records activity
              WHERE activity.mission_id = participant.mission_id
                AND activity.student_id = participant.student_id
              ORDER BY activity.revision_number DESC, activity.id DESC
              LIMIT 1
            ) latest_activity ON true
            LEFT JOIN LATERAL (
              SELECT to_jsonb(grade) AS event
              FROM public.guild3_mission_grade_events grade
              WHERE grade.participant_id = participant.id
              ORDER BY grade.id DESC LIMIT 1
            ) latest_grade ON true
            WHERE participant.mission_instance_id = instance.id
          ), '[]'::jsonb),
          'submissions', coalesce((
            SELECT jsonb_agg(to_jsonb(submission) ORDER BY submission.submission_scope, submission.revision_number DESC, submission.id DESC)
            FROM public.guild3_mission_submissions submission
            WHERE submission.mission_instance_id = instance.id
          ), '[]'::jsonb)
        ) ORDER BY instance.guild_id
      )
      FROM public.guild3_mission_instances instance
      WHERE instance.mission_id = v_mission.id
    ), '[]'::jsonb),
    'audit_history', coalesce((
      SELECT jsonb_agg(to_jsonb(audit) ORDER BY audit.occurred_at DESC, audit.id DESC)
      FROM public.guild3_mission_audit_events audit
      WHERE audit.mission_id = v_mission.id
    ), '[]'::jsonb),
    'guild4_openings', coalesce((
      SELECT jsonb_agg(to_jsonb(opening) ORDER BY opening.guild_id, opening.id)
      FROM public.guild3_peer_review_openings opening
      WHERE opening.mission_id = v_mission.id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Public RPC ACLs. Internal helpers and raw score/source tables remain
-- unavailable to browser roles.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.teacher_create_guild3_mission(text, text, boolean, text, text, text, text, numeric, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_update_guild3_mission_draft(bigint, text, text, boolean, text, text, text, text, numeric, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_update_guild3_mission_presentation(bigint, text, boolean, text, text, text, text, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_publish_guild3_mission(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_close_guild3_mission(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_reopen_guild3_mission(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_cancel_guild3_mission(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_set_guild3_instance_result(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_set_guild3_participant_grade(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_apply_guild3_missing_activity_f(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_finalize_guild3_mission(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_correct_guild3_instance_result(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_correct_guild3_participant_grade(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_void_guild3_mission(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_get_guild3_mission_detail(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_submit_guild3_mission_result(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_record_guild3_mission_activity(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_get_guild3_mission_board() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.teacher_create_guild3_mission(text, text, boolean, text, text, text, text, numeric, text, text, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_update_guild3_mission_draft(bigint, text, text, boolean, text, text, text, text, numeric, text, text, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_update_guild3_mission_presentation(bigint, text, boolean, text, text, text, text, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_publish_guild3_mission(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_close_guild3_mission(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_reopen_guild3_mission(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_cancel_guild3_mission(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild3_instance_result(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild3_participant_grade(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_apply_guild3_missing_activity_f(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_guild3_mission(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_correct_guild3_instance_result(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_correct_guild3_participant_grade(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_void_guild3_mission(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_guild3_mission_detail(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_guild3_mission_result(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_record_guild3_mission_activity(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild3_mission_board() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. SQL Editor-safe structural postcheck. It verifies function/ACL presence
-- without calling auth/JWT-dependent teacher or student RPCs.
-- -----------------------------------------------------------------------------
SELECT
  to_regprocedure('public.teacher_publish_guild3_mission(bigint)') IS NOT NULL AS publish_rpc_exists,
  to_regprocedure('public.student_submit_guild3_mission_result(bigint,text,text)') IS NOT NULL AS student_submission_rpc_exists,
  to_regprocedure('public.student_record_guild3_mission_activity(bigint,text)') IS NOT NULL AS student_activity_rpc_exists,
  to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)') IS NOT NULL AS finalize_rpc_exists,
  to_regprocedure('public.teacher_void_guild3_mission(bigint,text)') IS NOT NULL AS void_rpc_exists,
  to_regprocedure('public.student_get_guild3_mission_board()') IS NOT NULL AS safe_student_read_rpc_exists,
  has_function_privilege('authenticated', 'public.student_get_guild3_mission_board()', 'EXECUTE') AS student_board_rpc_granted,
  has_function_privilege('authenticated', 'public.teacher_finalize_guild3_mission(bigint,text)', 'EXECUTE') AS teacher_finalize_rpc_granted,
  NOT has_function_privilege('authenticated', 'public.guild3_write_audit_event(bigint,bigint,bigint,integer,text,text,jsonb,jsonb)', 'EXECUTE') AS internal_audit_helper_still_private;

COMMIT;
