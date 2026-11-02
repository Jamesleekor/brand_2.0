-- =============================================================================
-- ROLLBACK for 20261030_10..13 (Starlink mainline + period force finalize).
-- Use ONLY if a serious problem appears. Order matters. Existing GAME1/2,
-- Rakaruka, snapshots and Guild 2 data are never touched by this script.
--
-- STEP A (instant, always safe): hide Starlink from students.
--   UPDATE public.arcade_games SET available_from = DATE '2099-12-31' WHERE code='starlink_04';
--   (Do not do this after a month that includes Starlink has been frozen.)
--
-- STEP B (this file): restore the original Guild 5 force function (exact
-- production text of 2026-10-30, md5 a300ffbb6a4383ac31b44bdb6278ef60), drop the
-- new force-finalize functions and the Starlink binding trigger. Starlink tables
-- and any rows in them are KEPT (records are never deleted by rollback).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.teacher_force_finalize_arcade_month_for_guild5(p_year_month text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_existing_finalization_id bigint;
  v_forced_result_count integer := 0;
  v_overridden_session_count integer := 0;
  v_status text;
  v_finalize_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G5 ARCADE] year_month must be YYYY-MM.' USING ERRCODE='22023';
  END IF;
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready reason must be 2 to 500 characters.' USING ERRCODE='22023';
  END IF;

  SELECT f.id INTO v_existing_finalization_id
  FROM public.arcade_monthly_finalizations f
  WHERE f.classroom_id=v_classroom_id
    AND f.contribution_year_month=p_year_month;

  IF v_existing_finalization_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status','FINALIZED',
      'already_finalized',true,
      'finalization_id',v_existing_finalization_id,
      'year_month',p_year_month
    );
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id=v_classroom_id
    AND p.period_kind='MONTHLY'
    AND p.contribution_year_month=p_year_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 ARCADE] monthly Arcade period not found for %.',p_year_month
      USING ERRCODE='P0273';
  END IF;

  IF v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[G5 ARCADE] period is FINALIZED but its monthly snapshot is missing.'
      USING ERRCODE='P0220';
  END IF;

  IF v_period.status='ACTIVE' THEN
    IF v_period.ends_at_exclusive > clock_timestamp() THEN
      RAISE EXCEPTION '[G5 ARCADE] the monthly Arcade period is still running. End it before force-ready.'
        USING ERRCODE='P0274';
    END IF;
    PERFORM public.teacher_freeze_arcade_monthly_period(v_period.id);
    SELECT * INTO v_period
    FROM public.arcade_ranking_periods
    WHERE id=v_period.id
    FOR UPDATE;
  END IF;

  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready requires a frozen monthly period; current status is %.',v_period.status
      USING ERRCODE='P0275';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_runs r
    JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
    WHERE s.period_id=v_period.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[G5 ARCADE] an Arcade verification run is still in progress. Finish or cancel it first.'
      USING ERRCODE='P0268';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id=v_classroom_id
      AND os.arcade_period_id=v_period.id
      AND os.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION '[G5 ARCADE] a Rakaruka official challenge is still active. Finish it first.'
      USING ERRCODE='PTK50';
  END IF;

  -- For unresolved students currently inside each game's reward range,
  -- accept the already-frozen provisional record as the official source.
  WITH target_rows AS (
    SELECT pg.game_id, r.student_id
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(
      v_classroom_id,v_period.id,pg.game_id
    ) r
    WHERE pg.period_id=v_period.id
      AND r.rank<=pg.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=pg.game_id
          AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.game_id,
           t.student_id,
           p.source_run_id,
           p.official_score,
           p.official_duration_ms,
           p.stats,
           p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=t.game_id
     AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_corrections(
    classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason
  )
  SELECT v_classroom_id,v_period.id,s.game_id,s.student_id,'SET_SOURCE',s.source_run_id,btrim(p_reason)
  FROM source_rows s;

  WITH target_rows AS (
    SELECT pg.game_id, r.student_id
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(
      v_classroom_id,v_period.id,pg.game_id
    ) r
    WHERE pg.period_id=v_period.id
      AND r.rank<=pg.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=pg.game_id
          AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.game_id,
           t.student_id,
           p.source_run_id,
           p.official_score,
           p.official_duration_ms,
           p.stats,
           p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=t.game_id
     AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,
    ranking_eligible,decided_by_user_id
  )
  SELECT v_classroom_id,v_period.id,s.game_id,s.student_id,NULL,'MANUAL_SOURCE',
         s.source_run_id,s.official_score,s.official_duration_ms,s.stats,s.achieved_at,
         true,auth.uid()
  FROM source_rows s
  ON CONFLICT(period_id,game_id,student_id) DO NOTHING;
  GET DIAGNOSTICS v_forced_result_count=ROW_COUNT;

  UPDATE public.arcade_verification_sessions
  SET status='OVERRIDDEN',ended_at=now()
  WHERE classroom_id=v_classroom_id
    AND period_id=v_period.id
    AND status='ACTIVE';
  GET DIAGNOSTICS v_overridden_session_count=ROW_COUNT;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,
    v_period.id,
    'PERIOD_FORCE_READY_FOR_GUILD5',
    btrim(p_reason),
    jsonb_build_object(
      'forced_provisional_results',v_forced_result_count,
      'overridden_active_sessions',v_overridden_session_count,
      'year_month',p_year_month
    ),
    auth.uid()
  );

  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  IF v_status<>'READY_TO_FINALIZE' THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready could not resolve every current reward-range record; status is %.',v_status
      USING ERRCODE='P0276';
  END IF;

  v_finalize_result:=public.teacher_finalize_arcade_monthly_snapshot(v_period.id);

  RETURN coalesce(v_finalize_result,'{}'::jsonb) || jsonb_build_object(
    'forced_ready',true,
    'forced_provisional_results',v_forced_result_count,
    'overridden_active_sessions',v_overridden_session_count,
    'reason',btrim(p_reason)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.teacher_force_finalize_arcade_period(bigint,text,boolean);
DROP FUNCTION IF EXISTS public.teacher_get_arcade_force_finalize_preview(bigint);
DROP FUNCTION IF EXISTS public.arcade_force_finalize_session_plan(integer,bigint);

DROP TRIGGER IF EXISTS arcade_starlink_04_bind_on_playing ON public.arcade_runs;
DROP FUNCTION IF EXISTS public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer);
DROP FUNCTION IF EXISTS public.student_begin_starlink_04_run(bigint);

-- Starlink catalog rows are hidden, not deleted (keeps any test/official runs valid).
UPDATE public.arcade_games SET available_from = DATE '2099-12-31'
WHERE code='starlink_04' AND available_from < DATE '2099-12-31';

COMMIT;
NOTIFY pgrst, 'reload schema';
