-- =============================================================================
-- B.R.A.N.D 2.0 Arcade — teacher one-step period force finalize (with preview).
-- 2026-10-30.
--
-- Problem: teacher_force_finalize_arcade_month_for_guild5 aborts (P0268/PTK50)
-- whenever a verification run is in progress or a Rakaruka official challenge
-- is still ACTIVE, so a month can be held open by a single unfinished student.
--
-- New behaviour (atomic, one transaction; any failure rolls everything back):
--   1. Lock in the same order students use (runs -> sessions -> rakaruka
--      sessions -> period) so concurrent submissions cannot deadlock with it.
--   2. ACTIVE + still running period: only with p_end_running_period=true —
--      end now, expire in-flight standard runs that would block freezing, freeze.
--   3. Preserve earned verification results first (spec §33.8):
--        a. success already achieved      -> normal session finalization
--                                            (max(frozen record, best verification))
--        b. no frozen record + valid run   -> best valid verification run
--   4. Every in-progress verification run -> EXPIRED + attempt
--      TECHNICAL_CANCELLED (not consumed). Late submissions cannot revive it.
--   5. Each still-open game -> existing teacher_force_close_arcade_game_verification
--      (unresolved reward-range students adopt their frozen record; unchanged policy).
--   6. Rakaruka ACTIVE official challenges -> CANCELLED (unfinished, no official
--      record), official window closed.
--   7. Existing teacher_finalize_arcade_monthly_snapshot (snapshots + Guild 2).
--   Re-running after success returns already_finalized (idempotent).
--
-- teacher_force_finalize_arcade_month_for_guild5(text,text) keeps its exact
-- signature/ACL/return keys and now delegates to the new function, so the
-- Guild 5 monthly close button no longer gets stuck.
-- No table is altered. No FINALIZED data is touched.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.teacher_force_close_arcade_game_verification(bigint,text,text)') IS NULL
     OR to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)') IS NULL
     OR to_regprocedure('public.teacher_freeze_arcade_monthly_period(bigint)') IS NULL
     OR to_regprocedure('public.teacher_end_arcade_ranking_period_now(bigint)') IS NULL
     OR to_regprocedure('public.arcade_finalize_verification_session(bigint)') IS NULL
     OR to_regprocedure('public.arcade_refresh_verification_readiness(integer,bigint)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)') IS NULL
     OR to_regclass('public.tikatuka_official_sessions') IS NULL THEN
    RAISE EXCEPTION '[ARCADE FORCE] required production functions/tables are missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='tikatuka_official_session_status_check'
      AND pg_get_constraintdef(oid) LIKE '%CANCELLED%'
  ) THEN
    RAISE EXCEPTION '[ARCADE FORCE] tikatuka_official_sessions does not allow CANCELLED; production schema differs.';
  END IF;
END;
$preflight$;

-- -----------------------------------------------------------------------------
-- Internal: classify ACTIVE verification sessions of a period (shared by preview
-- and execution so the preview shows exactly what execution will do).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_force_finalize_session_plan(p_classroom_id integer, p_period_id bigint)
RETURNS TABLE(
  session_id bigint,
  game_id bigint,
  student_id integer,
  plan text,
  has_provisional boolean,
  provisional_score bigint,
  best_valid_run_id bigint,
  best_valid_score bigint,
  best_valid_duration_ms integer,
  best_valid_stats jsonb,
  best_valid_achieved_at timestamptz,
  used_attempts integer,
  in_progress_run_id bigint,
  in_reward_range boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (
    SELECT s.* FROM public.arcade_verification_sessions s
    WHERE s.classroom_id=p_classroom_id AND s.period_id=p_period_id AND s.status='ACTIVE'
  ), best AS (
    SELECT DISTINCT ON (a.session_id) a.session_id, a.run_id, a.official_score, a.official_duration_ms, a.stats, r.game_over_at
    FROM public.arcade_verification_attempts a
    JOIN public.arcade_runs r ON r.id=a.run_id
    WHERE a.session_id IN (SELECT id FROM s) AND a.status='TERMINAL' AND a.consumed AND a.valid_run AND a.official_score IS NOT NULL
    ORDER BY a.session_id, a.official_score DESC, r.game_over_at ASC, a.run_id ASC
  ), used AS (
    SELECT a.session_id, count(*) FILTER (WHERE a.consumed)::integer AS used
    FROM public.arcade_verification_attempts a WHERE a.session_id IN (SELECT id FROM s) GROUP BY a.session_id
  ), inprog AS (
    SELECT DISTINCT ON (r.verification_session_id) r.verification_session_id AS session_id, r.id
    FROM public.arcade_runs r
    WHERE r.verification_session_id IN (SELECT id FROM s) AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    ORDER BY r.verification_session_id, r.id DESC
  ), ranges AS (
    SELECT pg.game_id, rk.student_id, (rk.rank <= pg.target_rank_count) AS in_range
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(p_classroom_id, p_period_id, pg.game_id) rk
    WHERE pg.period_id=p_period_id
  )
  SELECT s.id, s.game_id, s.student_id,
    CASE
      WHEN s.success_achieved THEN 'FINALIZE_SUCCESS'
      WHEN s.provisional_entry_id IS NULL AND b.run_id IS NOT NULL THEN 'ADOPT_BEST_VERIFICATION'
      WHEN s.provisional_entry_id IS NULL THEN 'NO_RECORD'
      WHEN coalesce(rg.in_range,false) THEN 'ADOPT_FROZEN_RECORD'
      ELSE 'CLOSE_KEEP_FROZEN_RANK'
    END,
    (s.provisional_entry_id IS NOT NULL), s.provisional_score,
    b.run_id, b.official_score, b.official_duration_ms, coalesce(b.stats,'{}'::jsonb), b.game_over_at,
    coalesce(u.used,0), ip.id, coalesce(rg.in_range,false)
  FROM s
  LEFT JOIN best b ON b.session_id=s.id
  LEFT JOIN used u ON u.session_id=s.id
  LEFT JOIN inprog ip ON ip.session_id=s.id
  LEFT JOIN ranges rg ON rg.game_id=s.game_id AND rg.student_id=s.student_id
$$;

-- -----------------------------------------------------------------------------
-- Preview (read-only): what the force finalize will do, before the teacher confirms.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_force_finalize_preview(p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_finalization_id bigint;
  v_frozen boolean;
  v_running boolean;
  v_games jsonb := '[]'::jsonb;
  v_sessions jsonb;
  v_rakaruka jsonb;
  v_standard_inflight integer := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_game record;
  v_start_date date;
  v_end_date date;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE FORCE] monthly period not found.' USING ERRCODE='P0290';
  END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.contribution_year_month IS NULL THEN
    RAISE EXCEPTION '[ARCADE FORCE] only monthly periods can be force-finalized.' USING ERRCODE='P0291';
  END IF;

  SELECT id INTO v_finalization_id FROM public.arcade_monthly_finalizations WHERE period_id=v_period.id;
  IF v_finalization_id IS NOT NULL OR v_period.status='FINALIZED' THEN
    RETURN jsonb_build_object('period_id',v_period.id,'period_name',v_period.display_name,'status',v_period.status,
      'year_month',v_period.contribution_year_month,'already_finalized',true,'finalization_id',v_finalization_id,'can_execute',false,'blockers','[]'::jsonb);
  END IF;

  v_frozen := v_period.status IN ('VERIFICATION','READY_TO_FINALIZE');
  v_running := v_period.status='ACTIVE' AND v_period.ends_at_exclusive > clock_timestamp();
  IF v_period.status='DRAFT' THEN v_blockers := v_blockers || '"PERIOD_DRAFT"'::jsonb; END IF;
  IF v_running THEN v_blockers := v_blockers || '"PERIOD_RUNNING_NEEDS_END_FLAG"'::jsonb; END IF;

  IF v_period.status='ACTIVE' THEN
    SELECT count(*)::integer INTO v_standard_inflight
    FROM public.arcade_runs r
    WHERE r.classroom_id=v_classroom_id AND r.run_context='STANDARD' AND NOT r.is_prerelease_test
      AND r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
      AND r.created_at >= greatest(v_period.starts_at, clock_timestamp()-interval '15 minutes')
      AND r.created_at < least(v_period.ends_at_exclusive, clock_timestamp());
    v_start_date := (v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date;
    v_end_date := ((least(v_period.ends_at_exclusive, clock_timestamp()) - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date;
    FOR v_game IN
      SELECT g.id, g.code, g.internal_name
      FROM public.arcade_games g
      JOIN public.arcade_verification_game_configs c ON c.game_id=g.id AND c.is_enabled
      WHERE g.available_from <= v_end_date AND (g.available_until IS NULL OR g.available_until >= v_start_date)
      ORDER BY g.id
    LOOP
      v_games := v_games || jsonb_build_object(
        'game_id',v_game.id,'game_code',v_game.code,'game_name',v_game.internal_name,'frozen',false,
        'students_with_record',(SELECT count(DISTINCT r.student_id) FROM public.arcade_runs r
           WHERE r.classroom_id=v_classroom_id AND r.game_id=v_game.id AND r.run_context='STANDARD' AND r.status='VERIFIED'
             AND NOT r.is_prerelease_test AND public.is_official_participant(r.student_id)
             AND r.game_over_at >= v_period.starts_at AND r.game_over_at < least(v_period.ends_at_exclusive, clock_timestamp())));
    END LOOP;
  ELSIF v_frozen THEN
    FOR v_game IN
      SELECT pg.game_id, pg.target_rank_count, pg.verification_closed_at, g.code, g.internal_name
      FROM public.arcade_verification_period_games pg JOIN public.arcade_games g ON g.id=pg.game_id
      WHERE pg.period_id=v_period.id ORDER BY pg.game_id
    LOOP
      v_games := v_games || (
        WITH plan AS (SELECT * FROM public.arcade_force_finalize_session_plan(v_classroom_id, v_period.id) p WHERE p.game_id=v_game.game_id),
        ranks AS (SELECT * FROM public.arcade_resolve_period_student_ranks(v_classroom_id, v_period.id, v_game.game_id)),
        -- projected candidates after step 3 (earned results replace the frozen record where better)
        proj AS (
          SELECT rk.student_id,
                 CASE WHEN pl.plan='FINALIZE_SUCCESS' AND pl.best_valid_score > coalesce(pl.provisional_score,-1) THEN pl.best_valid_score ELSE rk.official_score END AS score,
                 CASE WHEN pl.plan='FINALIZE_SUCCESS' AND pl.best_valid_score > coalesce(pl.provisional_score,-1) THEN pl.best_valid_achieved_at ELSE rk.achieved_at END AS achieved_at,
                 CASE WHEN pl.plan='FINALIZE_SUCCESS' AND pl.best_valid_score > coalesce(pl.provisional_score,-1) THEN pl.best_valid_run_id ELSE rk.source_run_id END AS run_id,
                 CASE WHEN EXISTS (SELECT 1 FROM public.arcade_verification_official_results o WHERE o.period_id=v_period.id AND o.game_id=v_game.game_id AND o.student_id=rk.student_id) THEN 'OFFICIAL'
                      WHEN pl.plan='FINALIZE_SUCCESS' THEN 'VERIFIED_NOW'
                      ELSE 'FROZEN_RECORD' END AS source
          FROM ranks rk LEFT JOIN plan pl ON pl.student_id=rk.student_id
          UNION ALL
          SELECT pl.student_id, pl.best_valid_score, pl.best_valid_achieved_at, pl.best_valid_run_id, 'VERIFIED_NOW'
          FROM plan pl WHERE pl.plan='ADOPT_BEST_VERIFICATION'
        ),
        top AS (
          SELECT row_number() OVER (ORDER BY p.score DESC, p.achieved_at ASC, p.run_id ASC)::integer AS rank, p.*, st.name AS student_name
          FROM proj p JOIN public.students st ON st.id=p.student_id
        )
        SELECT jsonb_build_object(
          'game_id',v_game.game_id,'game_code',v_game.code,'game_name',v_game.internal_name,'frozen',true,
          'verification_closed',v_game.verification_closed_at IS NOT NULL,'target_rank_count',v_game.target_rank_count,
          'active_sessions',(SELECT count(*) FROM plan),
          'in_progress_runs',(SELECT count(*) FROM plan WHERE in_progress_run_id IS NOT NULL),
          'plan_counts',jsonb_build_object(
            'FINALIZE_SUCCESS',(SELECT count(*) FROM plan WHERE plan='FINALIZE_SUCCESS'),
            'ADOPT_BEST_VERIFICATION',(SELECT count(*) FROM plan WHERE plan='ADOPT_BEST_VERIFICATION'),
            'ADOPT_FROZEN_RECORD',(SELECT count(*) FROM plan WHERE plan='ADOPT_FROZEN_RECORD'),
            'CLOSE_KEEP_FROZEN_RANK',(SELECT count(*) FROM plan WHERE plan='CLOSE_KEEP_FROZEN_RANK'),
            'NO_RECORD',(SELECT count(*) FROM plan WHERE plan='NO_RECORD')),
          'already_official',(SELECT count(*) FROM public.arcade_verification_official_results o WHERE o.period_id=v_period.id AND o.game_id=v_game.game_id),
          'projected_top10',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',t.rank,'student_id',t.student_id,'student_name',t.student_name,'score',t.score,'source',t.source) ORDER BY t.rank) FROM top t WHERE t.rank<=10),'[]'::jsonb),
          'sessions',coalesce((SELECT jsonb_agg(jsonb_build_object('session_id',pl.session_id,'student_id',pl.student_id,'student_name',st.name,'plan',pl.plan,
              'used_attempts',pl.used_attempts,'provisional_score',pl.provisional_score,'best_valid_score',pl.best_valid_score,
              'in_progress_run_id',pl.in_progress_run_id) ORDER BY st.name) FROM plan pl JOIN public.students st ON st.id=pl.student_id),'[]'::jsonb)
        )
      );
    END LOOP;
  END IF;

  SELECT jsonb_build_object(
    'active',count(*) FILTER (WHERE os.status='ACTIVE'),
    'completed',count(*) FILTER (WHERE os.status='COMPLETED'),
    'active_sessions',coalesce(jsonb_agg(jsonb_build_object('session_id',os.id,'student_id',os.student_id,'student_name',st.name,
        'games_played',os.games_played,'points',os.points,'difficulty',os.difficulty)) FILTER (WHERE os.status='ACTIVE'),'[]'::jsonb))
  INTO v_rakaruka
  FROM public.tikatuka_official_sessions os JOIN public.students st ON st.id=os.student_id
  WHERE os.classroom_id=v_classroom_id AND os.arcade_period_id=v_period.id;

  RETURN jsonb_build_object(
    'period_id',v_period.id,'period_name',v_period.display_name,'status',v_period.status,'year_month',v_period.contribution_year_month,
    'starts_at',v_period.starts_at,'ends_at_exclusive',v_period.ends_at_exclusive,
    'already_finalized',false,'period_running',v_running,'needs_freeze',v_period.status='ACTIVE',
    'standard_runs_to_expire',v_standard_inflight,
    'games',v_games,'rakaruka',v_rakaruka,
    'guild2',jsonb_build_object('will_refresh',true,'year_month',v_period.contribution_year_month),
    'blockers',v_blockers,
    'can_execute',(v_period.status IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE')),
    'requires_end_flag',v_running,
    'generated_at',clock_timestamp());
END;
$$;

-- -----------------------------------------------------------------------------
-- Execute
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_force_finalize_arcade_period(
  p_period_id bigint,
  p_reason text,
  p_end_running_period boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_reason text := btrim(coalesce(p_reason,''));
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_finalization_id bigint;
  v_ended boolean := false;
  v_expired_standard integer := 0;
  v_froze boolean := false;
  v_plan record;
  v_game record;
  v_close jsonb;
  v_closed_games jsonb := '[]'::jsonb;
  v_adopted integer := 0;
  v_cancelled_runs integer := 0;
  v_finalized_success integer := 0;
  v_adopted_verification integer := 0;
  v_overridden integer := 0;
  v_swept integer := 0;
  v_rakaruka_cancelled integer := 0;
  v_status text;
  v_finalize jsonb;
  v_run record;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF char_length(v_reason) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[ARCADE FORCE] reason must be 2 to 500 characters.' USING ERRCODE='22023';
  END IF;

  -- Lock order = student order: runs -> sessions -> rakaruka sessions -> period.
  PERFORM r.id FROM public.arcade_runs r
  JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
  WHERE s.classroom_id=v_classroom_id AND s.period_id=p_period_id
    AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ORDER BY r.id FOR UPDATE OF r;
  PERFORM s.id FROM public.arcade_verification_sessions s
  WHERE s.classroom_id=v_classroom_id AND s.period_id=p_period_id AND s.status='ACTIVE'
  ORDER BY s.id FOR UPDATE;
  PERFORM os.id FROM public.tikatuka_official_sessions os
  WHERE os.classroom_id=v_classroom_id AND os.arcade_period_id=p_period_id AND os.status='ACTIVE'
  ORDER BY os.id FOR UPDATE;

  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE FORCE] monthly period not found.' USING ERRCODE='P0290';
  END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.contribution_year_month IS NULL THEN
    RAISE EXCEPTION '[ARCADE FORCE] only monthly periods can be force-finalized.' USING ERRCODE='P0291';
  END IF;

  SELECT id INTO v_finalization_id FROM public.arcade_monthly_finalizations WHERE period_id=v_period.id;
  IF v_finalization_id IS NOT NULL THEN
    RETURN jsonb_build_object('period_id',v_period.id,'status','FINALIZED','already_finalized',true,'finalization_id',v_finalization_id);
  END IF;
  IF v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE FORCE] period is FINALIZED but its monthly snapshot is missing.' USING ERRCODE='P0220';
  END IF;
  IF v_period.status NOT IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE FORCE] period status % cannot be force-finalized.', v_period.status USING ERRCODE='P0293';
  END IF;

  -- 2. ACTIVE period: end (only when explicitly allowed) and freeze.
  IF v_period.status='ACTIVE' THEN
    IF v_period.ends_at_exclusive > clock_timestamp() THEN
      IF NOT coalesce(p_end_running_period,false) THEN
        RAISE EXCEPTION '[ARCADE FORCE] the period is still running; pass p_end_running_period=true to end it now.' USING ERRCODE='P0292';
      END IF;
      PERFORM public.teacher_end_arcade_ranking_period_now(v_period.id);
      v_ended := true;
      SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_period.id FOR UPDATE;
    END IF;
    -- freeze refuses while recent standard runs are in flight (P0272): close them.
    WITH expired AS (
      UPDATE public.arcade_runs r
      SET status='EXPIRED', rejection_code='PERIOD_FORCE_FINALIZED', rejection_reason=v_reason
      WHERE r.classroom_id=v_classroom_id AND r.run_context='STANDARD' AND NOT r.is_prerelease_test
        AND r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
        AND r.created_at >= greatest(v_period.starts_at, clock_timestamp()-interval '15 minutes')
        AND r.created_at < v_period.ends_at_exclusive
      RETURNING r.id
    ) SELECT count(*)::integer INTO v_expired_standard FROM expired;
    PERFORM public.teacher_freeze_arcade_monthly_period(v_period.id);
    v_froze := true;
    SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_period.id FOR UPDATE;
  END IF;

  -- 4 (first half). Cancel every in-progress verification run (technical, not consumed).
  FOR v_run IN
    SELECT r.id AS run_id, a.id AS attempt_id, a.opportunity_number, s.id AS session_id, s.student_id, s.game_id
    FROM public.arcade_runs r
    JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
    LEFT JOIN public.arcade_verification_attempts a ON a.run_id=r.id
    WHERE s.classroom_id=v_classroom_id AND s.period_id=v_period.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    ORDER BY r.id
  LOOP
    UPDATE public.arcade_runs SET status='EXPIRED', rejection_code='PERIOD_FORCE_FINALIZED', rejection_reason=v_reason WHERE id=v_run.run_id;
    IF v_run.attempt_id IS NOT NULL THEN
      UPDATE public.arcade_verification_attempts
      SET status='TECHNICAL_CANCELLED', consumed=false, valid_run=false, terminal_outcome='TECHNICAL_CANCELLED', terminal_at=now()
      WHERE id=v_run.attempt_id AND status='ISSUED';
    END IF;
    INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,reason,metadata,actor_user_id)
    VALUES (v_classroom_id,v_period.id,v_run.game_id,v_run.student_id,v_run.session_id,v_run.attempt_id,'RUN_FORCE_CANCELLED_BY_PERIOD_FINALIZE',v_reason,
      jsonb_build_object('run_id',v_run.run_id,'opportunity_number',v_run.opportunity_number),auth.uid());
    v_cancelled_runs := v_cancelled_runs + 1;
  END LOOP;

  -- 3. Preserve earned verification results before games are closed.
  FOR v_plan IN
    SELECT p.* FROM public.arcade_force_finalize_session_plan(v_classroom_id, v_period.id) p
    JOIN public.arcade_verification_period_games pg ON pg.period_id=v_period.id AND pg.game_id=p.game_id AND pg.verification_closed_at IS NULL
    WHERE p.plan IN ('FINALIZE_SUCCESS','ADOPT_BEST_VERIFICATION')
    ORDER BY p.session_id
  LOOP
    IF v_plan.plan='FINALIZE_SUCCESS' THEN
      PERFORM public.arcade_finalize_verification_session(v_plan.session_id);
      v_finalized_success := v_finalized_success + 1;
    ELSE
      INSERT INTO public.arcade_verification_official_results(
        classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id)
      VALUES (v_classroom_id,v_period.id,v_plan.game_id,v_plan.student_id,v_plan.session_id,'SESSION_SUCCESS_VERIFICATION',
        v_plan.best_valid_run_id,v_plan.best_valid_score,v_plan.best_valid_duration_ms,v_plan.best_valid_stats,v_plan.best_valid_achieved_at,true,auth.uid())
      ON CONFLICT (period_id,game_id,student_id) DO NOTHING;
      UPDATE public.arcade_verification_sessions SET status='COMPLETED', result_status='SUCCESS', ended_at=now()
      WHERE id=v_plan.session_id AND status='ACTIVE';
      INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,event_kind,reason,metadata,actor_user_id)
      VALUES (v_classroom_id,v_period.id,v_plan.game_id,v_plan.student_id,v_plan.session_id,'SESSION_FORCE_COMPLETED_BEST_VERIFICATION',v_reason,
        jsonb_build_object('source_run_id',v_plan.best_valid_run_id,'official_score',v_plan.best_valid_score,'used_attempts',v_plan.used_attempts),auth.uid());
      v_adopted_verification := v_adopted_verification + 1;
    END IF;
  END LOOP;

  -- 5. Close each still-open game with the existing production policy.
  FOR v_game IN
    SELECT g.code FROM public.arcade_verification_period_games pg JOIN public.arcade_games g ON g.id=pg.game_id
    WHERE pg.period_id=v_period.id AND pg.verification_closed_at IS NULL ORDER BY pg.game_id
  LOOP
    v_close := public.teacher_force_close_arcade_game_verification(v_period.id, v_game.code, v_reason);
    v_closed_games := v_closed_games || jsonb_build_array(v_game.code);
    v_adopted := v_adopted + coalesce((v_close->>'forced_provisional_results')::integer,0);
    v_cancelled_runs := v_cancelled_runs + coalesce((v_close->>'cancelled_active_runs')::integer,0);
    v_overridden := v_overridden + coalesce((v_close->>'overridden_active_sessions')::integer,0);
  END LOOP;

  -- Safety net: no ACTIVE session may survive (already-closed games).
  WITH o AS (
    UPDATE public.arcade_verification_sessions SET status='OVERRIDDEN', ended_at=now()
    WHERE classroom_id=v_classroom_id AND period_id=v_period.id AND status='ACTIVE'
    RETURNING id
  ) SELECT count(*)::integer INTO v_swept FROM o;
  v_overridden := v_overridden + v_swept;

  -- 6. Rakaruka: unfinished official challenges end without an official record.
  WITH c AS (
    UPDATE public.tikatuka_official_sessions SET status='CANCELLED', completed_at=now()
    WHERE classroom_id=v_classroom_id AND arcade_period_id=v_period.id AND status='ACTIVE'
    RETURNING id, student_id, games_played, points
  ), audit AS (
    INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,student_id,event_kind,reason,metadata,actor_user_id)
    SELECT v_classroom_id, v_period.id, c.student_id, 'RAKARUKA_SESSION_FORCE_CANCELLED', v_reason,
      jsonb_build_object('tikatuka_session_id',c.id,'games_played',c.games_played,'points',c.points), auth.uid()
    FROM c RETURNING 1
  ) SELECT count(*)::integer INTO v_rakaruka_cancelled FROM audit;
  UPDATE public.tikatuka_official_windows SET is_open=false, closed_at=now(), updated_at=now()
  WHERE classroom_id=v_classroom_id AND arcade_period_id=v_period.id AND is_open;

  v_status := public.arcade_refresh_verification_readiness(v_classroom_id, v_period.id);
  IF v_status<>'READY_TO_FINALIZE' THEN
    RAISE EXCEPTION '[ARCADE FORCE] unresolved reward-range records remain after force (status %).', v_status USING ERRCODE='P0294';
  END IF;

  -- 7. Existing monthly snapshot + Guild 2 pipeline (unchanged).
  v_finalize := public.teacher_finalize_arcade_monthly_snapshot(v_period.id);

  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,event_kind,reason,metadata,actor_user_id)
  VALUES (v_classroom_id,v_period.id,'PERIOD_FORCE_FINALIZED',v_reason,jsonb_build_object(
    'ended_running_period',v_ended,'froze',v_froze,'expired_standard_runs',v_expired_standard,
    'cancelled_verification_runs',v_cancelled_runs,'finalized_success_sessions',v_finalized_success,
    'adopted_best_verification',v_adopted_verification,'adopted_provisional_results',v_adopted,
    'overridden_sessions',v_overridden,'cancelled_rakaruka_sessions',v_rakaruka_cancelled,
    'closed_games',v_closed_games,'finalization_id',v_finalize->'finalization_id'),auth.uid());

  RETURN coalesce(v_finalize,'{}'::jsonb) || jsonb_build_object(
    'forced',true,'already_finalized',false,'reason',v_reason,
    'ended_running_period',v_ended,'froze',v_froze,'expired_standard_runs',v_expired_standard,
    'cancelled_verification_runs',v_cancelled_runs,'finalized_success_sessions',v_finalized_success,
    'adopted_best_verification',v_adopted_verification,'adopted_provisional_results',v_adopted,
    'overridden_sessions',v_overridden,'cancelled_rakaruka_sessions',v_rakaruka_cancelled,'closed_games',v_closed_games);
END;
$$;

-- -----------------------------------------------------------------------------
-- Guild 5 button: same signature / ACL / return keys, now never stuck.
-- -----------------------------------------------------------------------------
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
  v_result jsonb;
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
  WHERE f.classroom_id=v_classroom_id AND f.contribution_year_month=p_year_month;
  IF v_existing_finalization_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','FINALIZED','already_finalized',true,'finalization_id',v_existing_finalization_id,'year_month',p_year_month);
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id=v_classroom_id AND p.period_kind='MONTHLY' AND p.contribution_year_month=p_year_month;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 ARCADE] monthly Arcade period not found for %.',p_year_month USING ERRCODE='P0273';
  END IF;
  IF v_period.status='ACTIVE' AND v_period.ends_at_exclusive > clock_timestamp() THEN
    RAISE EXCEPTION '[G5 ARCADE] the monthly Arcade period is still running. End it before force-ready.' USING ERRCODE='P0274';
  END IF;

  v_result := public.teacher_force_finalize_arcade_period(v_period.id, p_reason, false);

  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,event_kind,reason,metadata,actor_user_id)
  VALUES (v_classroom_id,v_period.id,'PERIOD_FORCE_READY_FOR_GUILD5',btrim(p_reason),
    jsonb_build_object('delegated_to','teacher_force_finalize_arcade_period','year_month',p_year_month,
      'forced_provisional_results',v_result->'adopted_provisional_results','overridden_active_sessions',v_result->'overridden_sessions'),auth.uid());

  RETURN v_result || jsonb_build_object(
    'forced_ready',true,
    'forced_provisional_results',coalesce((v_result->>'adopted_provisional_results')::integer,0),
    'overridden_active_sessions',coalesce((v_result->>'overridden_sessions')::integer,0),
    'reason',btrim(p_reason));
END;
$function$;

REVOKE ALL ON FUNCTION public.arcade_force_finalize_session_plan(integer,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_force_finalize_preview(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_force_finalize_arcade_period(bigint,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_force_finalize_preview(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_force_finalize_arcade_period(bigint,text,boolean) TO authenticated;
-- guild5 wrapper ACL is unchanged by CREATE OR REPLACE (authenticated, service_role).

COMMIT;
NOTIFY pgrst, 'reload schema';
