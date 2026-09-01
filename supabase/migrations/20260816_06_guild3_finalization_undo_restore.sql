-- =============================================================================
-- B.R.A.N.D 2.0 — Guild3 safe finalization undo + accidental VOID restore
-- 2026-08-16
--
-- Purpose
--   * Distinguish ordinary "I need to edit the finalized result" from a true VOID.
--   * Allow FINALIZED -> CLOSED only before any Guild4 round has been materialized.
--   * Preserve submissions, activity revisions, judgment events, grade events and audit.
--   * Allow accidental VOID -> FINALIZED restore only before any Guild4 round exists.
--   * Keep CANCELLED terminal and keep post-Guild4 corrections append-only.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild3_peer_review_openings') IS NULL
     OR to_regprocedure('public.guild3_guard_mission_mutation()') IS NULL
     OR to_regprocedure('public.teacher_void_guild3_mission(bigint,text)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL
     OR to_regclass('public.guild4_peer_review_rounds') IS NULL THEN
    RAISE EXCEPTION '[G3-CORRECTION] Guild3/Guild4/Guild2 dependencies are missing.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Tighten the mutation guard while allowing two explicit RPC-scoped repairs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild3_guard_mission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_correction_mode text := coalesce(current_setting('brand.guild3_lifecycle_correction', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[G3] missions are historical records and cannot be deleted.' USING ERRCODE = 'P0302';
  END IF;

  IF OLD.lifecycle_state = 'CANCELLED' THEN
    RAISE EXCEPTION '[G3] cancelled mission is terminal and immutable.' USING ERRCODE = 'P0303';
  END IF;

  IF OLD.lifecycle_state = 'VOIDED' THEN
    IF NOT (
      v_correction_mode = 'RESTORE_VOID'
      AND NEW.lifecycle_state = 'FINALIZED'
      AND NEW.voided_at IS NULL
      AND NEW.finalized_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION '[G3] voided mission is terminal except through the explicit VOID restore RPC.' USING ERRCODE = 'P0303';
    END IF;
  END IF;

  IF OLD.lifecycle_state = 'FINALIZED' AND NEW.lifecycle_state NOT IN ('FINALIZED', 'VOIDED') THEN
    IF NOT (
      v_correction_mode = 'UNFINALIZE'
      AND NEW.lifecycle_state = 'CLOSED'
      AND NEW.finalized_at IS NULL
      AND NEW.voided_at IS NULL
    ) THEN
      RAISE EXCEPTION '[G3] finalized mission can change only through explicit correction, VOID, or safe finalization-undo flow.' USING ERRCODE = 'P0304';
    END IF;
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

-- -----------------------------------------------------------------------------
-- 2. FINALIZED -> CLOSED, but only before Guild4 materialization.
--    Evidence is retained. Only finalization timestamps and derived G4 openings
--    are withdrawn so a later FINALIZE creates a clean opening again.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_unfinalize_guild3_mission(
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
  v_round_count integer;
  v_opening_count integer;
  v_openings jsonb;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_mission
  FROM public.guild3_missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0360';
  END IF;
  IF v_mission.lifecycle_state <> 'FINALIZED' THEN
    RAISE EXCEPTION '[G3] only a FINALIZED mission can undo finalization.' USING ERRCODE = 'P0361';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] finalization-undo reason must be 2 to 300 characters.' USING ERRCODE = 'P0362';
  END IF;

  SELECT count(*)::integer INTO v_round_count
  FROM public.guild4_peer_review_rounds
  WHERE mission_id = v_mission.id;

  IF v_round_count > 0 THEN
    RAISE EXCEPTION '[G3] Guild4 round already exists. Finalization cannot be undone; use append-only Guild3/Guild4 correction controls instead.' USING ERRCODE = 'P0363';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'opening_id', o.id,
           'mission_instance_id', o.mission_instance_id,
           'guild_id', o.guild_id,
           'opening_status', o.opening_status
         ) ORDER BY o.id), '[]'::jsonb)
  INTO v_openings
  FROM public.guild3_peer_review_openings o
  WHERE o.mission_id = v_mission.id;

  -- No Guild4 round exists, so openings are only derived invitations and can be
  -- withdrawn. Submission/activity/judgment/grade evidence is never deleted.
  DELETE FROM public.guild3_peer_review_openings
  WHERE mission_id = v_mission.id;
  GET DIAGNOSTICS v_opening_count = ROW_COUNT;

  UPDATE public.guild3_mission_instances
  SET finalized_at = NULL
  WHERE mission_id = v_mission.id;

  PERFORM set_config('brand.guild3_lifecycle_correction', 'UNFINALIZE', true);
  UPDATE public.guild3_missions
  SET lifecycle_state = 'CLOSED', finalized_at = NULL
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id,
    'MISSION_FINALIZATION_UNDONE', btrim(p_reason),
    jsonb_build_object('lifecycle_state', 'FINALIZED', 'withdrawn_guild4_openings', v_openings),
    jsonb_build_object('lifecycle_state', 'CLOSED', 'withdrawn_guild4_opening_count', v_opening_count)
  );

  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);

  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'withdrawn_guild4_openings', v_opening_count,
    'guild2_draft_refresh', v_refresh
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Accidental VOID restore. Safe only before any Guild4 round exists.
--    This restores the prior FINALIZED state; the teacher may then either use
--    append-only correction controls or press "최종 확정 취소" to return CLOSED.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_restore_voided_guild3_mission(
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
  v_round_count integer;
  v_opening_count integer;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_mission
  FROM public.guild3_missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE = 'P0364';
  END IF;
  IF v_mission.lifecycle_state <> 'VOIDED' THEN
    RAISE EXCEPTION '[G3] only a VOIDED mission can be restored.' USING ERRCODE = 'P0365';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[G3] VOID restore reason must be 2 to 300 characters.' USING ERRCODE = 'P0366';
  END IF;

  SELECT count(*)::integer INTO v_round_count
  FROM public.guild4_peer_review_rounds
  WHERE mission_id = v_mission.id;

  IF v_round_count > 0 THEN
    RAISE EXCEPTION '[G3] Guild4 round already exists for this VOIDED mission. Automatic VOID restore is blocked to preserve peer-review/penalty history.' USING ERRCODE = 'P0367';
  END IF;

  PERFORM set_config('brand.guild3_lifecycle_correction', 'RESTORE_VOID', true);
  UPDATE public.guild3_missions
  SET lifecycle_state = 'FINALIZED', voided_at = NULL
  WHERE id = v_mission.id
  RETURNING * INTO v_mission;

  UPDATE public.guild3_peer_review_openings
  SET opening_status = 'OPENABLE', voided_at = NULL, void_reason = NULL
  WHERE mission_id = v_mission.id
    AND opening_status = 'VOIDED';
  GET DIAGNOSTICS v_opening_count = ROW_COUNT;

  PERFORM public.guild3_write_audit_event(
    v_mission.id, NULL, NULL, v_classroom_id,
    'MISSION_VOID_RESTORED', btrim(p_reason),
    jsonb_build_object('lifecycle_state', 'VOIDED'),
    jsonb_build_object('lifecycle_state', 'FINALIZED', 'guild4_openings_restored', v_opening_count)
  );

  v_refresh := public.guild2_refresh_monthly_scores(v_classroom_id, v_mission.contribution_year_month);

  RETURN jsonb_build_object(
    'mission_id', v_mission.id,
    'lifecycle_state', v_mission.lifecycle_state,
    'guild4_openings_restored', v_opening_count,
    'guild2_draft_refresh', v_refresh
  );
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_unfinalize_guild3_mission(bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_restore_voided_guild3_mission(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_unfinalize_guild3_mission(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_restore_voided_guild3_mission(bigint,text) TO authenticated;

COMMIT;
