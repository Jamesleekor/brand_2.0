-- B.R.A.N.D 2.0 — Guild5 close readiness simplification + Arcade force finalize
-- 2026-10-02

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
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.guild3_missions mission
    WHERE mission.classroom_id = p_classroom_id
      AND mission.season_id = p_season_id
      AND mission.contribution_year_month = p_year_month
      AND mission.lifecycle_state NOT IN ('CANCELLED', 'VOIDED')
      AND mission.lifecycle_state <> 'FINALIZED'
  );
$function$;

CREATE OR REPLACE FUNCTION public.guild5_build_close_preview(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_closure public.guild5_month_closures%ROWTYPE;
  v_guild_count integer;
  v_summary_count integer;
  v_contribution_count integer;
  v_unresolved integer;
  v_session_total integer;
  v_session_open integer;
  v_session_ready boolean;
  v_obs_bad integer;
  v_four_missing integer;
  v_territory_count integer;
  v_mission_ready boolean;
  v_peer_ready boolean;
  v_arcade_ready boolean;
  v_arcade_period_status text;
  v_mission_status text;
  v_peer_status text;
  v_all_ready boolean;
  v_guilds jsonb;
  v_students jsonb;
  v_season_locked boolean;
  v_month_start date;
  v_month_end_exclusive date;
BEGIN
  IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G5] year_month must be YYYY-MM.' USING ERRCODE='P0501';
  END IF;

  v_month_start := (p_year_month || '-01')::date;
  v_month_end_exclusive := (v_month_start + interval '1 month')::date;

  SELECT * INTO v_closure
  FROM public.guild5_month_closures
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id AND year_month=p_year_month;

  SELECT count(*) INTO v_guild_count
  FROM public.guilds g
  WHERE g.classroom_id=p_classroom_id AND g.season_id=p_season_id AND coalesce(g.is_active,true);

  SELECT count(*) INTO v_summary_count
  FROM public.guild2_monthly_gs_summaries s
  JOIN public.guilds g ON g.id=s.guild_id
  WHERE s.classroom_id=p_classroom_id AND s.season_id=p_season_id AND s.year_month=p_year_month
    AND g.classroom_id=p_classroom_id AND g.season_id=p_season_id AND coalesce(g.is_active,true);

  SELECT count(*),
         count(*) FILTER(WHERE guild_context_status<>'RESOLVED'),
         count(*) FILTER(WHERE teacher_observation_status<>'READY')
  INTO v_contribution_count,v_unresolved,v_obs_bad
  FROM public.guild2_individual_contributions
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id AND year_month=p_year_month;

  SELECT count(*),count(*) FILTER(WHERE s.status<>'CLOSED')
  INTO v_session_total,v_session_open
  FROM public.guild_sessions s
  WHERE s.classroom_id=p_classroom_id
    AND s.season_id=p_season_id
    AND s.session_date>=v_month_start
    AND s.session_date<v_month_end_exclusive;
  v_session_ready := (v_session_open=0);

  SELECT count(*) INTO v_four_missing
  FROM public.guild2_monthly_gs_summaries s
  WHERE s.classroom_id=p_classroom_id AND s.season_id=p_season_id AND s.year_month=p_year_month
    AND s.scoring_roster_count=4
    AND NOT EXISTS(
      SELECT 1 FROM public.guild2_compensation_configs cc
      WHERE cc.classroom_id=p_classroom_id AND cc.season_id=p_season_id AND cc.guild_id=s.guild_id
    );

  SELECT count(*) INTO v_territory_count
  FROM public.guild5_territories
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id;

  v_mission_ready:=public.guild3_mission_month_is_ready(p_classroom_id,p_season_id,p_year_month);
  v_peer_ready:=public.guild4_peer_month_is_ready(p_classroom_id,p_season_id,p_year_month);
  v_arcade_ready:=public.arcade_monthly_finalization_is_complete(p_classroom_id,p_year_month);

  SELECT p.status INTO v_arcade_period_status
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id=p_classroom_id
    AND p.period_kind='MONTHLY'
    AND p.contribution_year_month=p_year_month
  LIMIT 1;

  v_season_locked:=EXISTS(
    SELECT 1 FROM public.guild5_season_locks
    WHERE classroom_id=p_classroom_id AND season_id=p_season_id
  );

  v_mission_status:=CASE WHEN v_mission_ready THEN 'READY' WHEN coalesce(v_closure.mission_override_active,false) THEN 'OVERRIDDEN' ELSE 'NOT_READY' END;
  v_peer_status:=CASE WHEN v_peer_ready THEN 'READY' WHEN coalesce(v_closure.peer_override_active,false) THEN 'OVERRIDDEN' ELSE 'NOT_READY' END;

  v_all_ready :=
    v_guild_count>=3
    AND v_summary_count=v_guild_count
    AND v_contribution_count>0
    AND v_unresolved=0
    AND v_session_ready
    AND v_obs_bad=0
    AND v_mission_status IN ('READY','OVERRIDDEN')
    AND v_peer_status IN ('READY','OVERRIDDEN')
    AND v_arcade_ready
    AND v_four_missing=0
    AND v_territory_count=3
    AND NOT v_season_locked;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'guild_id',s.guild_id,'guild_name',g.name,'roster_count',s.scoring_roster_count,
    'individual_subtotal',s.individual_subtotal,'official_mission_gs',s.mission_gs_subtotal,
    'compensation_amount',s.compensation_amount,'manual_adjustment_total',s.manual_adjustment_total,
    'draft_gs_total',s.draft_gs_total,'draft_rank',s.draft_rank,'compensation_enabled',s.compensation_enabled
  ) ORDER BY s.draft_gs_total DESC,s.guild_id),'[]'::jsonb)
  INTO v_guilds
  FROM public.guild2_monthly_gs_summaries s JOIN public.guilds g ON g.id=s.guild_id
  WHERE s.classroom_id=p_classroom_id AND s.season_id=p_season_id AND s.year_month=p_year_month
    AND g.classroom_id=p_classroom_id AND g.season_id=p_season_id AND coalesce(g.is_active,true);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'student_id',c.student_id,'student_name',s.name,'brand_name',s.brand_name,
    'guild_id',c.scoring_guild_id,'guild_context_status',c.guild_context_status,
    'peer_points',c.peer_points,'mission_points',c.mission_points,'session_points',c.session_points,
    'observation_points',c.teacher_observation_points,'basic_total',c.basic_total,
    'arcade_raw_total',c.arcade_raw_total,'arcade_applied',c.arcade_applied,'final_total',c.final_total,
    'peer_status',c.peer_status,'mission_status',c.mission_status,'session_status',c.session_status,
    'observation_status',c.teacher_observation_status,'arcade_status',c.arcade_status
  ) ORDER BY coalesce(c.scoring_guild_id,2147483647),c.student_id),'[]'::jsonb)
  INTO v_students
  FROM public.guild2_individual_contributions c JOIN public.students s ON s.id=c.student_id
  WHERE c.classroom_id=p_classroom_id AND c.season_id=p_season_id AND c.year_month=p_year_month;

  RETURN jsonb_build_object(
    'classroom_id',p_classroom_id,'season_id',p_season_id,'year_month',p_year_month,
    'closure_id',v_closure.id,'closure_state',coalesce(v_closure.lifecycle_state,'OPEN'),
    'current_version_id',v_closure.current_version_id,'can_finalize',v_all_ready,
    'season_locked',v_season_locked,
    'readiness',jsonb_build_object(
      'guild_count',jsonb_build_object('status',CASE WHEN v_guild_count>=3 THEN 'READY' ELSE 'NOT_READY' END,'count',v_guild_count,'recommended',5),
      'guild2_summary',jsonb_build_object('status',CASE WHEN v_guild_count>0 AND v_summary_count=v_guild_count THEN 'READY' ELSE 'NOT_READY' END,'summary_count',v_summary_count,'guild_count',v_guild_count),
      'roster_context',jsonb_build_object('status',CASE WHEN v_contribution_count>0 AND v_unresolved=0 THEN 'READY' ELSE 'NOT_READY' END,'contribution_count',v_contribution_count,'unresolved_count',v_unresolved),
      'session',jsonb_build_object('status',CASE WHEN v_session_ready THEN 'READY' ELSE 'NOT_READY' END,'session_count',v_session_total,'open_count',v_session_open),
      'teacher_observation',jsonb_build_object('status',CASE WHEN v_contribution_count>0 AND v_obs_bad=0 THEN 'READY' ELSE 'NOT_READY' END,'not_ready_count',v_obs_bad),
      'mission',jsonb_build_object('status',v_mission_status,'raw_ready',v_mission_ready,'override_reason',v_closure.mission_override_reason),
      'peer',jsonb_build_object('status',v_peer_status,'raw_ready',v_peer_ready,'override_reason',v_closure.peer_override_reason),
      'arcade',jsonb_build_object('status',CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,'period_status',coalesce(v_arcade_period_status,'NO_PERIOD')),
      'compensation_config',jsonb_build_object('status',CASE WHEN v_four_missing=0 THEN 'READY' ELSE 'NOT_READY' END,'four_member_guilds_missing_explicit_config',v_four_missing),
      'territories',jsonb_build_object('status',CASE WHEN v_territory_count=3 THEN 'READY' ELSE 'NOT_READY' END,'configured_count',v_territory_count,'required_count',3)
    ),
    'overrides',jsonb_build_object(
      'mission',jsonb_build_object('active',coalesce(v_closure.mission_override_active,false),'reason',v_closure.mission_override_reason),
      'peer',jsonb_build_object('active',coalesce(v_closure.peer_override_active,false),'reason',v_closure.peer_override_reason)
    ),
    'guilds',v_guilds,'students',v_students
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_force_finalize_arcade_month_for_guild5(
  p_year_month text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  WHERE f.classroom_id=v_classroom_id AND f.contribution_year_month=p_year_month;

  IF v_existing_finalization_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','FINALIZED','already_finalized',true,'finalization_id',v_existing_finalization_id,'year_month',p_year_month);
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id=v_classroom_id AND p.period_kind='MONTHLY' AND p.contribution_year_month=p_year_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 ARCADE] monthly Arcade period not found for %.',p_year_month USING ERRCODE='P0273';
  END IF;
  IF v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[G5 ARCADE] period is FINALIZED but its monthly snapshot is missing.' USING ERRCODE='P0220';
  END IF;

  IF v_period.status='ACTIVE' THEN
    IF v_period.ends_at_exclusive > clock_timestamp() THEN
      RAISE EXCEPTION '[G5 ARCADE] the monthly Arcade period is still running. End it before force-ready.' USING ERRCODE='P0274';
    END IF;
    PERFORM public.teacher_freeze_arcade_monthly_period(v_period.id);
    SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_period.id FOR UPDATE;
  END IF;

  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready requires a frozen monthly period; current status is %.',v_period.status USING ERRCODE='P0275';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_runs r
    JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
    WHERE s.period_id=v_period.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[G5 ARCADE] an Arcade verification run is still in progress. Finish or cancel it first.' USING ERRCODE='P0268';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id=v_classroom_id AND os.arcade_period_id=v_period.id AND os.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION '[G5 ARCADE] a Rakaruka official challenge is still active. Finish it first.' USING ERRCODE='PTK50';
  END IF;

  WITH target_rows AS (
    SELECT pg.game_id,r.student_id
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,pg.game_id) r
    WHERE pg.period_id=v_period.id
      AND r.rank<=pg.target_rank_count
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id AND o.game_id=pg.game_id AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.game_id,t.student_id,p.source_run_id,p.official_score,p.official_duration_ms,p.stats,p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=t.game_id AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_corrections(
    classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason
  )
  SELECT v_classroom_id,v_period.id,s.game_id,s.student_id,'SET_SOURCE',s.source_run_id,btrim(p_reason)
  FROM source_rows s;

  WITH target_rows AS (
    SELECT pg.game_id,r.student_id
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,pg.game_id) r
    WHERE pg.period_id=v_period.id
      AND r.rank<=pg.target_rank_count
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id AND o.game_id=pg.game_id AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.game_id,t.student_id,p.source_run_id,p.official_score,p.official_duration_ms,p.stats,p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=t.game_id AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
  )
  SELECT v_classroom_id,v_period.id,s.game_id,s.student_id,NULL,'MANUAL_SOURCE',
         s.source_run_id,s.official_score,s.official_duration_ms,s.stats,s.achieved_at,true,auth.uid()
  FROM source_rows s
  ON CONFLICT(period_id,game_id,student_id) DO NOTHING;
  GET DIAGNOSTICS v_forced_result_count=ROW_COUNT;

  UPDATE public.arcade_verification_sessions
  SET status='OVERRIDDEN',ended_at=now()
  WHERE classroom_id=v_classroom_id AND period_id=v_period.id AND status='ACTIVE';
  GET DIAGNOSTICS v_overridden_session_count=ROW_COUNT;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,v_period.id,'PERIOD_FORCE_READY_FOR_GUILD5',btrim(p_reason),
    jsonb_build_object('forced_provisional_results',v_forced_result_count,'overridden_active_sessions',v_overridden_session_count,'year_month',p_year_month),
    auth.uid()
  );

  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  IF v_status<>'READY_TO_FINALIZE' THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready could not resolve every current reward-range record; status is %.',v_status USING ERRCODE='P0276';
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

REVOKE ALL ON FUNCTION public.teacher_force_finalize_arcade_month_for_guild5(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_force_finalize_arcade_month_for_guild5(text,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
