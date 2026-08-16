-- =============================================================================
-- B.R.A.N.D 2.0 — Guild3 finalize + publish notification fix
-- 2026-08-16
--
-- Incremental migration. Do NOT edit previously applied Guild3 migrations.
-- 1) Allows explicit teacher FINALIZE while CLOSED even before activity due time.
--    FINALIZED lifecycle already freezes further student activity revisions.
-- 2) Emits one Feature4 global alert when a DRAFT mission is first published.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild3_missions') IS NULL THEN
    RAISE EXCEPTION '[G3 FIX] guild3_missions is missing.';
  END IF;
  IF to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)') IS NULL THEN
    RAISE EXCEPTION '[G3 FIX] teacher_finalize_guild3_mission(bigint,text) is missing.';
  END IF;
  IF to_regprocedure('public.teacher_broadcast_alert(integer,text,character varying,integer)') IS NULL THEN
    RAISE EXCEPTION '[G3 FIX] Feature4 teacher_broadcast_alert dependency is missing.';
  END IF;
  IF to_regclass('public.global_alerts') IS NULL THEN
    RAISE EXCEPTION '[G3 FIX] global_alerts table is missing.';
  END IF;
END $$;

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
  v_early_finalize boolean;
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
  -- A teacher may explicitly finalize a CLOSED mission before the configured
  -- activity-record deadline. FINALIZED itself freezes further student edits.
  v_early_finalize := clock_timestamp() < v_mission.activity_record_due_at;

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
      'guild4_openings_created', v_opening_count,
      'finalized_before_activity_deadline', v_early_finalize,
      'activity_record_due_at', v_mission.activity_record_due_at
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
    'finalized_before_activity_deadline', v_early_finalize,
    'guild2_draft_refresh', v_refresh
  );
END;
$$;

-- Keep the RPC browser-accessible exactly as the existing Guild3 lifecycle API.
REVOKE ALL ON FUNCTION public.teacher_finalize_guild3_mission(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_guild3_mission(bigint,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guild3_emit_publish_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.lifecycle_state = 'DRAFT' AND NEW.lifecycle_state = 'ACTIVE' THEN
    BEGIN
      PERFORM public.teacher_broadcast_alert(
        NEW.classroom_id,
        format('새 길드 미션이 공개되었습니다: %s', NEW.title),
        '🗺️',
        168
      );
    EXCEPTION WHEN OTHERS THEN
      -- Notification delivery must never make the core mission publish fail.
      RAISE WARNING '[G3] publish alert failed for mission %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guild3_emit_publish_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guild3_emit_publish_alert() TO service_role;

DROP TRIGGER IF EXISTS trg_guild3_mission_publish_alert ON public.guild3_missions;
CREATE TRIGGER trg_guild3_mission_publish_alert
AFTER UPDATE OF lifecycle_state ON public.guild3_missions
FOR EACH ROW
WHEN (OLD.lifecycle_state IS DISTINCT FROM NEW.lifecycle_state)
EXECUTE FUNCTION public.guild3_emit_publish_alert();

COMMIT;
