-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 3 production reconcile + browser read APIs
-- 2026-08-15
-- Incremental only. Do NOT rerun/edit already-applied 01~03 migrations.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild2_gs_events') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL THEN
    RAISE EXCEPTION '[G3] required production Guild 2/Guild 3 structures are missing; stop reconcile.';
  END IF;
END;
$$;

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
  v_refresh jsonb;
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

  -- A DRAFT official mission already belongs to the month's valid mission set,
  -- so creating it immediately changes Mission readiness/normalization.
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);

  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'season_id', v_mission.season_id,
    'contribution_year_month', v_mission.contribution_year_month,
    'guild2_draft_refresh', v_refresh
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
  v_old_year_month text;
  v_old_refresh jsonb;
  v_new_refresh jsonb;
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
  v_old_year_month := v_mission.contribution_year_month;
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

  -- Weight/month changes affect the denominator and readiness immediately.
  -- If the DRAFT moved between months, refresh both the old and new month.
  v_old_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_old_year_month);
  IF v_mission.contribution_year_month = v_old_year_month THEN
    v_new_refresh := v_old_refresh;
  ELSE
    v_new_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);
  END IF;

  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'old_month_guild2_draft_refresh', v_old_refresh,
    'new_month_guild2_draft_refresh', v_new_refresh
  );
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
  v_before jsonb;
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
  v_refresh jsonb;
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
  -- Publication creates the immutable participant/guild context used by the
  -- Mission rollup, so refresh the current Guild 2 DRAFT projection.
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);
  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'instance_count', v_instance_count,
    'participant_count', v_participant_count,
    'guild2_draft_refresh', v_refresh
  );
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
  v_refresh jsonb;
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
  -- CANCELLED leaves the monthly denominator and can make the remaining
  -- finalized mission set READY, so refresh immediately.
  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);
  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'guild2_draft_refresh', v_refresh
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild3_instance_special_rule_note(
  p_mission_instance_id bigint,
  p_special_rule_note text
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
  v_before_note text;
  v_after_note text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_instance
  FROM public.guild3_mission_instances
  WHERE id = p_mission_instance_id
  FOR UPDATE;
  IF NOT FOUND OR v_instance.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission instance was not found in this classroom.' USING ERRCODE = 'P0340';
  END IF;

  SELECT * INTO v_mission
  FROM public.guild3_missions
  WHERE id = v_instance.mission_id
  FOR UPDATE;
  IF v_mission.lifecycle_state NOT IN ('ACTIVE', 'CLOSED') THEN
    RAISE EXCEPTION '[G3] special rule note can be changed only while mission is ACTIVE or CLOSED.' USING ERRCODE = 'P0360';
  END IF;

  v_before_note := v_instance.special_rule_note;
  v_after_note := nullif(btrim(p_special_rule_note), '');
  IF v_before_note IS NOT DISTINCT FROM v_after_note THEN
    RETURN jsonb_build_object(
      'mission_instance_id', v_instance.id,
      'special_rule_note', v_before_note,
      'unchanged', true
    );
  END IF;

  UPDATE public.guild3_mission_instances
  SET special_rule_note = v_after_note
  WHERE id = v_instance.id
  RETURNING * INTO v_instance;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, v_instance.id, NULL, v_classroom_id,
    'INSTANCE_SPECIAL_RULE_NOTE_UPDATED', NULL,
    jsonb_build_object('special_rule_note', v_before_note),
    jsonb_build_object('special_rule_note', v_after_note)
  );

  RETURN jsonb_build_object(
    'mission_instance_id', v_instance.id,
    'special_rule_note', v_instance.special_rule_note
  );
END;
$$;

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
            'special_rule_note', instance.special_rule_note,
            'guild_result', CASE
              WHEN mission.lifecycle_state IN ('FINALIZED', 'VOIDED') THEN instance.current_guild_result
              ELSE NULL
            END,
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

CREATE OR REPLACE FUNCTION public.guild3_mission_month_is_ready(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.guild3_missions mission
      WHERE mission.classroom_id = p_classroom_id
        AND mission.season_id = p_season_id
        AND mission.contribution_year_month = p_year_month
        AND mission.lifecycle_state NOT IN ('CANCELLED', 'VOIDED')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.guild3_missions mission
      WHERE mission.classroom_id = p_classroom_id
        AND mission.season_id = p_season_id
        AND mission.contribution_year_month = p_year_month
        AND mission.lifecycle_state NOT IN ('CANCELLED', 'VOIDED')
        AND mission.lifecycle_state <> 'FINALIZED'
    );
$$;

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
  mission_event record;
  prior_event record;
  v_arcade_ready boolean;
  v_mission_ready boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);
  v_arcade_ready := public.arcade_monthly_finalization_is_complete(p_classroom_id, p_year_month);
  v_mission_ready := public.guild3_mission_month_is_ready(p_classroom_id, p_season_id, p_year_month);

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
    ORDER BY ledger.id DESC LIMIT 1;

    IF contribution.final_total = 0 THEN
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
        'POST', contribution.final_total, '개인 기여도 초안 반영',
        jsonb_build_object(
          'formula_version', contribution.formula_version,
          'mission_status', contribution.mission_status,
          'arcade_status', contribution.arcade_status
        )
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
        'POST', contribution.final_total, '개인 기여도 초안 재계산 반영',
        jsonb_build_object(
          'formula_version', contribution.formula_version,
          'mission_status', contribution.mission_status,
          'arcade_status', contribution.arcade_status,
          'replaces_event_id', prior_event.id
        )
      );
    END IF;
  END LOOP;

  FOR prior_event IN
    SELECT ledger.*
    FROM public.guild2_gs_events ledger
    JOIN public.guild2_individual_contributions contribution_row ON contribution_row.id = ledger.source_id
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

  -- One active POST per cleared finalized guild mission instance. A corrected,
  -- failed, cancelled, or voided source is reversed, never deleted.
  FOR mission_event IN
    SELECT *
    FROM public.guild3_official_mission_gs_rollup(p_classroom_id, p_season_id, p_year_month)
    WHERE mission_gs_points > 0
  LOOP
    SELECT ledger.* INTO prior_event
    FROM public.guild2_gs_events ledger
    WHERE ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.source_type = 'MISSION_GS'
      AND ledger.source_id = mission_event.mission_instance_id
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
    ORDER BY ledger.id DESC LIMIT 1;

    IF prior_event.id IS NULL THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, mission_event.guild_id,
        'MISSION_GS', mission_event.mission_instance_id,
        'POST', mission_event.mission_gs_points, 'Guild 3 공식 미션 CLEARED 초안 반영',
        jsonb_build_object(
          'guild3_mission_id', mission_event.mission_id,
          'mission_weight', mission_event.mission_weight,
          'normalization', '5000_X_WEIGHT_OVER_VALID_MONTHLY_WEIGHT_SUM'
        )
      );
    ELSIF prior_event.points IS DISTINCT FROM mission_event.mission_gs_points
       OR prior_event.guild_id IS DISTINCT FROM mission_event.guild_id THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata, reversal_of
      ) VALUES (
        prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
        'REVERSAL', prior_event.source_id,
        'REVERSAL', -prior_event.points, 'Guild 3 공식 미션 GS 초안 변경 취소',
        jsonb_build_object('reversal_reason', 'GUILD3_MISSION_RECALCULATION'), prior_event.id
      );
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, mission_event.guild_id,
        'MISSION_GS', mission_event.mission_instance_id,
        'POST', mission_event.mission_gs_points, 'Guild 3 공식 미션 GS 초안 재계산 반영',
        jsonb_build_object(
          'guild3_mission_id', mission_event.mission_id,
          'mission_weight', mission_event.mission_weight,
          'normalization', '5000_X_WEIGHT_OVER_VALID_MONTHLY_WEIGHT_SUM',
          'replaces_event_id', prior_event.id
        )
      );
    END IF;
  END LOOP;

  FOR prior_event IN
    SELECT ledger.*
    FROM public.guild2_gs_events ledger
    WHERE ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.source_type = 'MISSION_GS'
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.guild3_official_mission_gs_rollup(p_classroom_id, p_season_id, p_year_month) desired
        WHERE desired.mission_instance_id = ledger.source_id
          AND desired.guild_id = ledger.guild_id
          AND desired.mission_gs_points > 0
      )
  LOOP
    INSERT INTO public.guild2_gs_events (
      classroom_id, season_id, year_month, guild_id, source_type, source_id,
      event_kind, points, reason, metadata, reversal_of
    ) VALUES (
      prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
      'REVERSAL', prior_event.source_id,
      'REVERSAL', -prior_event.points, 'Guild 3 미션 실패·취소·무효 또는 재계산 취소',
      jsonb_build_object('reversal_reason', 'GUILD3_SOURCE_NO_LONGER_CLEARED'), prior_event.id
    );
  END LOOP;

  -- The accepted Guild 2 manual four-member compensation remains BASIC-only.
  -- Arcade is not part of this average and no automatic headcount inference is added.
  FOR compensation IN
    SELECT config.id AS config_id, config.guild_id, config.enabled,
           coalesce(round((avg(contribution_row.basic_total) * config.factor) / 10) * 10, 0)::numeric(10,2) AS desired_points
    FROM public.guild2_compensation_configs config
    LEFT JOIN public.guild2_individual_contributions contribution_row
      ON contribution_row.classroom_id = p_classroom_id
     AND contribution_row.season_id = p_season_id
     AND contribution_row.year_month = p_year_month
     AND contribution_row.scoring_guild_id = config.guild_id
     AND contribution_row.guild_context_status = 'RESOLVED'
    WHERE config.classroom_id = p_classroom_id AND config.season_id = p_season_id
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
    ORDER BY ledger.id DESC LIMIT 1;

    IF compensation.enabled AND compensation.desired_points > 0 THEN
      IF prior_event.id IS NULL THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata
        ) VALUES (
          p_classroom_id, p_season_id, p_year_month, compensation.guild_id,
          'MEMBER_COMPENSATION', compensation.config_id,
          'POST', compensation.desired_points, '수동 지정 인원 보정 반영',
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
          'POST', compensation.desired_points, '수동 지정 인원 보정 재계산 반영',
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
  ), active_posts AS (
    -- Summary/cache values reflect only currently-effective POST events.
    -- Historical POST + REVERSAL pairs remain in the ledger for audit, but
    -- reversed POSTs cannot inflate source subtotals.
    SELECT event.*
    FROM public.guild2_gs_events event
    WHERE event.classroom_id = p_classroom_id
      AND event.season_id = p_season_id
      AND event.year_month = p_year_month
      AND event.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1
        FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = event.id
          AND reversal.event_kind = 'REVERSAL'
      )
  ), ledger_totals AS (
    SELECT event.guild_id,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'INDIVIDUAL_CONTRIBUTION'), 0), 2) AS individual_subtotal,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MISSION_GS'), 0), 2) AS mission_gs_subtotal,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MEMBER_COMPENSATION'), 0), 2) AS compensation_amount,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MANUAL_ADJUSTMENT'), 0), 2) AS manual_adjustment_total,
           round(coalesce(sum(event.points), 0), 2) AS draft_gs_total
    FROM active_posts event
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
  SELECT p_classroom_id, p_season_id, p_year_month, guild_scope.guild_id,
         coalesce(roster_totals.scoring_roster_count, 0),
         coalesce(ledger_totals.individual_subtotal, 0),
         coalesce(ledger_totals.mission_gs_subtotal, 0),
         coalesce(ledger_totals.compensation_amount, 0),
         coalesce(ledger_totals.manual_adjustment_total, 0),
         coalesce(ledger_totals.draft_gs_total, 0),
         coalesce(config.enabled, false),
         jsonb_build_object(
           'peer', 'NOT_READY',
           'mission', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
           'session', 'READY',
           'teacher_observation', 'READY',
           'arcade', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
           'guild_mission_gs', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
           'rounding', 'AGGREGATE_DISPLAY_AND_SUMMARY_STORAGE_ROUNDED_TO_2_DECIMALS'
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
  SET draft_rank = ranked.new_rank, updated_at = now()
  FROM ranked
  WHERE summary.id = ranked.id;
END;
$$;

-- Teacher-safe mission list. Raw Guild 3 tables stay private.
CREATE OR REPLACE FUNCTION public.teacher_list_guild3_missions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_classroom_id integer; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G3] teacher classroom context is missing.' USING ERRCODE='P0310';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'mission_id',mission.id,'season_id',mission.season_id,
    'contribution_year_month',mission.contribution_year_month,'title',mission.title,
    'teaser_visible',mission.teaser_visible,'teaser_title',mission.teaser_title,
    'weight',mission.weight,'submission_scope',mission.submission_scope,
    'submission_requirement',mission.submission_requirement,
    'peer_review_required',mission.peer_review_required,'lifecycle_state',mission.lifecycle_state,
    'due_at',mission.due_at,'activity_record_due_at',mission.activity_record_due_at,
    'published_at',mission.published_at,'closed_at',mission.closed_at,
    'finalized_at',mission.finalized_at,'cancelled_at',mission.cancelled_at,'voided_at',mission.voided_at,
    'instance_count',(SELECT count(*) FROM public.guild3_mission_instances i WHERE i.mission_id=mission.id),
    'participant_count',(SELECT count(*) FROM public.guild3_mission_participants p WHERE p.mission_id=mission.id),
    'unresolved_instance_count',(SELECT count(*) FROM public.guild3_mission_instances i WHERE i.mission_id=mission.id AND i.current_guild_result='UNDECIDED'),
    'ungraded_participant_count',(SELECT count(*) FROM public.guild3_mission_participants p WHERE p.mission_id=mission.id AND NOT EXISTS (SELECT 1 FROM public.guild3_mission_grade_events g WHERE g.participant_id=p.id))
  ) ORDER BY mission.contribution_year_month DESC,mission.due_at DESC,mission.id DESC),'[]'::jsonb)
  INTO v_result FROM public.guild3_missions mission WHERE mission.classroom_id=v_classroom_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_guild3_mission_score_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_classroom_id integer; v_student_id integer; v_result jsonb;
BEGIN
  v_classroom_id:=public.current_classroom_id(); v_student_id:=public.current_student_id();
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION '[G3] authenticated student context is required.' USING ERRCODE='P0330';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'year_month',m.year_month,'points',coalesce(r.mission_points,0),
    'status',coalesce(r.mission_status,'NOT_READY'),'max_points',300
  ) ORDER BY m.year_month DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT DISTINCT mission.contribution_year_month year_month,mission.season_id
    FROM public.guild3_missions mission
    JOIN public.guild3_mission_participants p ON p.mission_id=mission.id AND p.student_id=v_student_id
    WHERE mission.classroom_id=v_classroom_id AND mission.lifecycle_state NOT IN ('CANCELLED','VOIDED')
  ) m
  LEFT JOIN LATERAL (
    SELECT x.mission_points,x.mission_status
    FROM public.guild3_mission_component_rollup(v_classroom_id,m.season_id,m.year_month) x
    WHERE x.student_id=v_student_id LIMIT 1
  ) r ON true;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_set_guild3_instance_special_rule_note(bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_list_guild3_missions() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.student_get_guild3_mission_score_summary() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild3_instance_special_rule_note(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_list_guild3_missions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild3_mission_score_summary() TO authenticated;
REVOKE ALL ON FUNCTION public.guild3_mission_month_is_ready(integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_gs_summary(integer,text,integer) FROM PUBLIC,anon,authenticated;

SELECT
  to_regprocedure('public.teacher_list_guild3_missions()') IS NOT NULL AS teacher_list_rpc_exists,
  to_regprocedure('public.student_get_guild3_mission_score_summary()') IS NOT NULL AS student_score_summary_rpc_exists,
  to_regprocedure('public.teacher_set_guild3_instance_special_rule_note(bigint,text)') IS NOT NULL AS special_rule_note_rpc_exists,
  pg_get_functiondef('public.guild3_mission_month_is_ready(integer,integer,text)'::regprocedure) ILIKE '%EXISTS (%' AS zero_valid_mission_is_not_ready,
  pg_get_functiondef('public.guild2_refresh_monthly_gs_summary(integer,text,integer)'::regprocedure) ILIKE '%active_posts%' AS reversal_safe_summary;
COMMIT;
