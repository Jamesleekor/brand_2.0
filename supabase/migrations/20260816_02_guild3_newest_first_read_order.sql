-- =============================================================================
-- B.R.A.N.D 2.0 — Guild3 mission newest-first read ordering
-- 2026-08-16
--
-- Scope:
--   * Student mission board: latest published/visible mission first.
--   * Teacher mission list: latest published/created mission first.
--   * Read API only. No scoring/lifecycle semantics changed.
-- =============================================================================

BEGIN;

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

  SELECT coalesce(jsonb_agg(row_data.payload ORDER BY row_data.sort_visible_at DESC, row_data.mission_id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      mission.id AS mission_id,
      coalesce(mission.published_at, mission.created_at) AS sort_visible_at,
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
  ) ORDER BY coalesce(mission.published_at, mission.created_at) DESC, mission.id DESC),'[]'::jsonb)
  INTO v_result FROM public.guild3_missions mission WHERE mission.classroom_id=v_classroom_id;
  RETURN v_result;
END;
$$;

COMMIT;
