-- B.R.A.N.D 2.0
-- Per-game Arcade verification force close
-- Applied to production as Supabase migration: arcade_game_verification_force_close

ALTER TABLE public.arcade_verification_period_games
  ADD COLUMN IF NOT EXISTS verification_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_closed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS verification_close_reason text;

CREATE OR REPLACE FUNCTION public.arcade_guard_closed_verification_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status='ACTIVE'
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'ACTIVE')
     AND EXISTS (
       SELECT 1
       FROM public.arcade_verification_period_games pg
       WHERE pg.period_id=NEW.period_id
         AND pg.game_id=NEW.game_id
         AND pg.verification_closed_at IS NOT NULL
     )
  THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this game verification is already closed.'
      USING ERRCODE='P0277';
  END IF;
  RETURN NEW;
END;
$function$
;

DROP TRIGGER IF EXISTS trg_arcade_guard_closed_verification_session
ON public.arcade_verification_sessions;
CREATE TRIGGER trg_arcade_guard_closed_verification_session BEFORE INSERT OR UPDATE OF status ON public.arcade_verification_sessions FOR EACH ROW EXECUTE FUNCTION arcade_guard_closed_verification_session();

CREATE OR REPLACE FUNCTION public.arcade_guard_closed_verification_official_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period_id bigint;
  v_game_id bigint;
BEGIN
  v_period_id := CASE WHEN TG_OP='DELETE' THEN OLD.period_id ELSE NEW.period_id END;
  v_game_id := CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id=v_period_id
      AND pg.game_id=v_game_id
      AND pg.verification_closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this game verification is already closed.'
      USING ERRCODE='P0277';
  END IF;

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$
;

DROP TRIGGER IF EXISTS trg_arcade_guard_closed_verification_official_result
ON public.arcade_verification_official_results;
CREATE TRIGGER trg_arcade_guard_closed_verification_official_result BEFORE INSERT OR DELETE OR UPDATE ON public.arcade_verification_official_results FOR EACH ROW EXECUTE FUNCTION arcade_guard_closed_verification_official_result();

CREATE OR REPLACE FUNCTION public.teacher_force_close_arcade_game_verification(p_period_id bigint, p_game_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_run record;
  v_forced_result_count integer := 0;
  v_cancelled_run_count integer := 0;
  v_overridden_session_count integer := 0;
  v_game_missing integer := 0;
  v_period_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] force-close reason must be 2 to 500 characters.'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found.'
      USING ERRCODE='P0256';
  END IF;

  IF v_period.period_kind<>'MONTHLY'
     OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period is not in verification stage.'
      USING ERRCODE='P0261';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.'
      USING ERRCODE='P0206';
  END IF;

  SELECT * INTO v_config
  FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id
    AND game_id=v_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.'
      USING ERRCODE='P0260';
  END IF;

  IF v_config.verification_closed_at IS NOT NULL THEN
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      );

    RETURN jsonb_build_object(
      'period_id',v_period.id,
      'game_code',p_game_code,
      'game_ready',(v_game_missing=0),
      'game_verification_closed',true,
      'game_verification_closed_at',v_config.verification_closed_at,
      'already_closed',true,
      'period_status',v_period.status
    );
  END IF;

  -- Lock all currently active sessions for this game first so no new run can
  -- be issued while the teacher is force-closing the game.
  PERFORM s.id
  FROM public.arcade_verification_sessions s
  WHERE s.classroom_id=v_classroom_id
    AND s.period_id=v_period.id
    AND s.game_id=v_game_id
    AND s.status='ACTIVE'
  FOR UPDATE;

  -- If someone is literally playing when the teacher force-closes,
  -- cancel that run as a technical cancellation and return the attempt slot.
  FOR v_run IN
    SELECT r.id AS run_id,
           a.id AS attempt_id,
           a.opportunity_number,
           s.id AS session_id,
           s.student_id
    FROM public.arcade_runs r
    JOIN public.arcade_verification_attempts a ON a.run_id=r.id
    JOIN public.arcade_verification_sessions s ON s.id=a.session_id
    WHERE s.classroom_id=v_classroom_id
      AND s.period_id=v_period.id
      AND s.game_id=v_game_id
      AND s.status='ACTIVE'
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    ORDER BY r.id
  LOOP
    UPDATE public.arcade_runs
    SET status='EXPIRED',
        rejection_code='VERIFICATION_FORCE_CLOSED',
        rejection_reason=btrim(p_reason)
    WHERE id=v_run.run_id;

    UPDATE public.arcade_verification_attempts
    SET status='TECHNICAL_CANCELLED',
        consumed=false,
        valid_run=false,
        terminal_outcome='TECHNICAL_CANCELLED',
        terminal_at=now()
    WHERE id=v_run.attempt_id;

    INSERT INTO public.arcade_verification_audit_events(
      classroom_id,period_id,game_id,student_id,session_id,attempt_id,
      event_kind,reason,metadata,actor_user_id
    )
    VALUES(
      v_classroom_id,v_period.id,v_game_id,v_run.student_id,v_run.session_id,v_run.attempt_id,
      'RUN_FORCE_CANCELLED_BY_GAME_CLOSE',btrim(p_reason),
      jsonb_build_object('run_id',v_run.run_id,'opportunity_number',v_run.opportunity_number),
      auth.uid()
    );

    v_cancelled_run_count := v_cancelled_run_count + 1;
  END LOOP;

  -- Preserve every result already officially decided.
  -- For unresolved students currently inside the reward range, adopt the
  -- already-frozen provisional record so nobody can hold the month open.
  WITH target_rows AS (
    SELECT r.student_id
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.student_id,
           p.source_run_id,
           p.official_score,
           p.official_duration_ms,
           p.stats,
           p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=v_game_id
     AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_corrections(
    classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason
  )
  SELECT v_classroom_id,v_period.id,v_game_id,s.student_id,'SET_SOURCE',s.source_run_id,btrim(p_reason)
  FROM source_rows s;

  WITH target_rows AS (
    SELECT r.student_id
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.student_id,
           p.source_run_id,
           p.official_score,
           p.official_duration_ms,
           p.stats,
           p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=v_game_id
     AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,
    ranking_eligible,decided_by_user_id
  )
  SELECT v_classroom_id,v_period.id,v_game_id,s.student_id,NULL,'MANUAL_SOURCE',
         s.source_run_id,s.official_score,s.official_duration_ms,s.stats,s.achieved_at,
         true,auth.uid()
  FROM source_rows s
  ON CONFLICT(period_id,game_id,student_id) DO NOTHING;
  GET DIAGNOSTICS v_forced_result_count=ROW_COUNT;

  UPDATE public.arcade_verification_sessions
  SET status='OVERRIDDEN',
      ended_at=now()
  WHERE classroom_id=v_classroom_id
    AND period_id=v_period.id
    AND game_id=v_game_id
    AND status='ACTIVE';
  GET DIAGNOSTICS v_overridden_session_count=ROW_COUNT;

  SELECT count(*) INTO v_game_missing
  FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
  WHERE r.rank<=v_config.target_rank_count
    AND NOT EXISTS (
      SELECT 1
      FROM public.arcade_verification_official_results o
      WHERE o.period_id=v_period.id
        AND o.game_id=v_game_id
        AND o.student_id=r.student_id
    );

  IF v_game_missing<>0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] game force-close left % unresolved reward-range record(s).',v_game_missing
      USING ERRCODE='P0278';
  END IF;

  UPDATE public.arcade_verification_period_games
  SET verification_closed_at=now(),
      verification_closed_by_user_id=auth.uid(),
      verification_close_reason=btrim(p_reason)
  WHERE id=v_config.id
  RETURNING * INTO v_config;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,v_period.id,v_game_id,
    'GAME_VERIFICATION_FORCE_CLOSED',btrim(p_reason),
    jsonb_build_object(
      'forced_provisional_results',v_forced_result_count,
      'cancelled_active_runs',v_cancelled_run_count,
      'overridden_active_sessions',v_overridden_session_count,
      'target_rank_count',v_config.target_rank_count
    ),
    auth.uid()
  );

  v_period_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'game_code',p_game_code,
    'game_ready',true,
    'game_verification_closed',true,
    'game_verification_closed_at',v_config.verification_closed_at,
    'forced_provisional_results',v_forced_result_count,
    'cancelled_active_runs',v_cancelled_run_count,
    'overridden_active_sessions',v_overridden_session_count,
    'period_status',v_period_status
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.teacher_force_close_arcade_game_verification(bigint,text,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_force_close_arcade_game_verification(bigint,text,text)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_verification_overview(p_period_id bigint, p_game_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_game_missing integer := 0;
  v_game_active_sessions integer := 0;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
    AND classroom_id=v_classroom_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206';
  END IF;

  SELECT * INTO v_config
  FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id
    AND game_id=v_game_id;

  IF FOUND THEN
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      );

    SELECT count(*) INTO v_game_active_sessions
    FROM public.arcade_verification_sessions s
    WHERE s.classroom_id=v_classroom_id
      AND s.period_id=v_period.id
      AND s.game_id=v_game_id
      AND s.status='ACTIVE';
  END IF;

  WITH all_ranks AS (
    SELECT * FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id)
  ), subject_ids AS (
    SELECT student.id AS student_id
    FROM public.students student
    WHERE student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ), subject AS (
    SELECT r.rank,ids.student_id,r.source_run_id AS current_source_run_id,r.official_score AS current_official_score,r.achieved_at,
           p.official_score AS provisional_score,p.source_run_id AS provisional_source_run_id,p.id AS provisional_entry_id,
           (p.id IS NOT NULL) AS has_provisional_record,
           s.id AS session_id,s.status AS session_status,s.verification_threshold,s.threshold_percent,s.max_attempts,
           s.success_achieved,s.result_status,s.activated_at,s.ended_at,
           o.decision_kind,o.source_run_id AS official_source_run_id,o.official_score AS decided_official_score,o.ranking_eligible,
           student.name AS student_name,student.brand_name,
           (SELECT count(*) FROM public.arcade_verification_attempts a WHERE a.session_id=s.id AND a.consumed)::integer AS used_attempts,
           (SELECT max(a.official_score) FROM public.arcade_verification_attempts a WHERE a.session_id=s.id AND a.status='TERMINAL' AND a.valid_run) AS best_verification_score,
           (SELECT rr.id FROM public.arcade_runs rr WHERE rr.verification_session_id=s.id AND rr.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') ORDER BY rr.id DESC LIMIT 1) AS active_run_id
    FROM subject_ids ids
    LEFT JOIN all_ranks r ON r.student_id=ids.student_id
    LEFT JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=v_game_id AND p.student_id=ids.student_id
    JOIN public.students student ON student.id=ids.student_id
    LEFT JOIN LATERAL (
      SELECT ss.* FROM public.arcade_verification_sessions ss
      WHERE ss.period_id=v_period.id AND ss.game_id=v_game_id AND ss.student_id=ids.student_id
      ORDER BY (ss.status='ACTIVE') DESC,ss.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id=v_period.id AND o.game_id=v_game_id AND o.student_id=ids.student_id
  )
  SELECT jsonb_build_object(
    'period_id',v_period.id,
    'period_status',v_period.status,
    'period_name',v_period.display_name,
    'game_code',p_game_code,
    'game_ready',(v_config.id IS NOT NULL AND v_game_missing=0 AND v_game_active_sessions=0),
    'game_missing_count',v_game_missing,
    'game_active_session_count',v_game_active_sessions,
    'game_verification_closed',(v_config.verification_closed_at IS NOT NULL),
    'game_verification_closed_at',v_config.verification_closed_at,
    'game_verification_close_reason',v_config.verification_close_reason,
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'rank',subject.rank,'student_id',subject.student_id,'student_name',subject.student_name,'brand_name',subject.brand_name,
      'has_provisional_record',subject.has_provisional_record,
      'provisional_score',subject.provisional_score,'provisional_source_run_id',subject.provisional_source_run_id,
      'current_official_score',subject.current_official_score,'current_source_run_id',subject.current_source_run_id,
      'session_id',subject.session_id,'session_status',subject.session_status,'verification_threshold',subject.verification_threshold,
      'threshold_percent',subject.threshold_percent,'max_attempts',subject.max_attempts,'used_attempts',coalesce(subject.used_attempts,0),
      'success_achieved',coalesce(subject.success_achieved,false),'result_status',subject.result_status,
      'best_verification_score',subject.best_verification_score,'active_run_id',subject.active_run_id,
      'decision_kind',subject.decision_kind,'official_source_run_id',subject.official_source_run_id,
      'decided_official_score',subject.decided_official_score,'ranking_eligible',subject.ranking_eligible,
      'is_current_reward_range',(subject.rank IS NOT NULL AND subject.rank<=coalesce(v_config.target_rank_count,10)),
      'attempts',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'attempt_id',a.id,'issue_number',a.issue_number,'opportunity_number',a.opportunity_number,
          'run_id',a.run_id,'status',a.status,'consumed',a.consumed,'valid_run',a.valid_run,
          'terminal_outcome',a.terminal_outcome,'official_score',a.official_score,
          'issued_at',a.issued_at,'terminal_at',a.terminal_at,'restored_at',a.restored_at,
          'restore_reason',a.restore_reason
        ) ORDER BY a.issue_number)
        FROM public.arcade_verification_attempts a
        WHERE a.session_id=subject.session_id
      ),'[]'::jsonb)
    ) ORDER BY subject.rank NULLS LAST,subject.student_name,subject.student_id),'[]'::jsonb)
  ) INTO v_result
  FROM subject;

  RETURN coalesce(
    v_result,
    jsonb_build_object(
      'period_id',v_period.id,
      'period_status',v_period.status,
      'period_name',v_period.display_name,
      'game_code',p_game_code,
      'game_ready',(v_config.id IS NOT NULL AND v_game_missing=0 AND v_game_active_sessions=0),
      'game_missing_count',v_game_missing,
      'game_active_session_count',v_game_active_sessions,
      'game_verification_closed',(v_config.verification_closed_at IS NOT NULL),
      'game_verification_closed_at',v_config.verification_closed_at,
      'game_verification_close_reason',v_config.verification_close_reason,
      'rows','[]'::jsonb
    )
  );
END;
$function$
;

NOTIFY pgrst, 'reload schema';
