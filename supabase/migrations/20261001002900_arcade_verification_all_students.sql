-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade verification eligibility: all official students
-- 2026-10-01
--
-- Policy change:
--   * Top 10 remains the monthly reward range only.
--   * Verification eligibility is no longer limited by provisional/current rank.
--   * Every official student in the classroom can receive a verification session.
--   * Students with no frozen STANDARD record can create a new official record
--     through 3 verification attempts; their best valid verification run becomes
--     their official result.
--   * Finalization still requires the current reward-range Top 10 to be resolved.
--     Lower-ranked students are optional challengers; however, any active
--     verification session must be resolved before finalization.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_verification_sessions') IS NULL
     OR to_regclass('public.arcade_verification_provisional_entries') IS NULL
     OR to_regclass('public.arcade_verification_official_results') IS NULL
     OR to_regclass('public.arcade_verification_period_games') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)') IS NULL
     OR to_regprocedure('public.arcade_refresh_verification_readiness(integer,bigint)') IS NULL
     OR to_regprocedure('public.arcade_finalize_verification_session(bigint)') IS NULL
     OR to_regprocedure('public.teacher_get_arcade_verification_overview(bigint,text)') IS NULL
     OR to_regprocedure('public.teacher_start_arcade_verification_session(bigint,text,integer)') IS NULL
     OR to_regprocedure('public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text)') IS NULL
     OR to_regprocedure('public.student_get_arcade_verification_state(text)') IS NULL
     OR to_regprocedure('public.student_create_arcade_verification_run(bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY ALL] required verification baseline is missing.';
  END IF;
END $$;

-- A student who did not play during the frozen STANDARD period has no
-- provisional source. Keep that absence explicit instead of fabricating a run.
ALTER TABLE public.arcade_verification_sessions
  ALTER COLUMN provisional_entry_id DROP NOT NULL,
  ALTER COLUMN provisional_source_run_id DROP NOT NULL,
  ALTER COLUMN provisional_score DROP NOT NULL,
  ALTER COLUMN verification_threshold DROP NOT NULL;

ALTER TABLE public.arcade_verification_sessions
  DROP CONSTRAINT arcade_verification_session_score_check;
ALTER TABLE public.arcade_verification_sessions
  ADD CONSTRAINT arcade_verification_session_score_check CHECK (
    (provisional_score IS NULL OR provisional_score >= 0)
    AND (verification_threshold IS NULL OR verification_threshold >= 0)
  );

-- -----------------------------------------------------------------------------
-- Ranking resolver: during verification, include official-result-only students
-- (students who had no frozen STANDARD record but established a verification
-- record). FINALIZED and live behavior remain unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_student_ranks(
  p_classroom_id integer,
  p_period_id bigint,
  p_game_id bigint
)
RETURNS TABLE(
  source_run_id bigint,
  student_id integer,
  official_score bigint,
  achieved_at timestamptz,
  rank integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_snapshot_id bigint;
BEGIN
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
    AND classroom_id = p_classroom_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status = 'FINALIZED' THEN
    SELECT s.id INTO v_snapshot_id
    FROM public.arcade_monthly_snapshots s
    WHERE s.period_id = v_period.id
      AND s.game_id = p_game_id;
    IF v_snapshot_id IS NULL THEN
      RAISE EXCEPTION '[ARCADE] finalized monthly snapshot is missing for this period/game; data integrity error.'
        USING ERRCODE = 'P0220';
    END IF;

    RETURN QUERY
    SELECT r.source_run_id, r.student_id, r.official_score, r.achieved_at, r.rank
    FROM public.arcade_monthly_snapshot_student_ranks r
    WHERE r.snapshot_id = v_snapshot_id
      AND public.is_official_participant(r.student_id)
    ORDER BY r.rank;
    RETURN;
  END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RETURN QUERY
    WITH candidates AS (
      SELECT
        COALESCE(o.source_run_id, p.source_run_id) AS source_run_id,
        COALESCE(o.student_id, p.student_id) AS student_id,
        COALESCE(o.official_score, p.official_score) AS official_score,
        COALESCE(o.achieved_at, p.achieved_at) AS achieved_at,
        COALESCE(o.ranking_eligible, true) AS ranking_eligible
      FROM public.arcade_verification_provisional_entries p
      FULL OUTER JOIN public.arcade_verification_official_results o
        ON o.period_id = p.period_id
       AND o.game_id = p.game_id
       AND o.student_id = p.student_id
      WHERE COALESCE(o.classroom_id, p.classroom_id) = p_classroom_id
        AND COALESCE(o.period_id, p.period_id) = p_period_id
        AND COALESCE(o.game_id, p.game_id) = p_game_id
        AND public.is_official_participant(COALESCE(o.student_id, p.student_id))
    ), ranked AS (
      SELECT c.source_run_id,
             c.student_id,
             c.official_score,
             c.achieved_at,
             row_number() OVER (
               ORDER BY c.official_score DESC, c.achieved_at ASC, c.source_run_id ASC
             )::integer AS rank
      FROM candidates c
      WHERE c.ranking_eligible
        AND c.source_run_id IS NOT NULL
        AND c.official_score IS NOT NULL
    )
    SELECT r.source_run_id, r.student_id, r.official_score, r.achieved_at, r.rank
    FROM ranked r
    ORDER BY r.rank;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate_runs AS (
    SELECT r.id AS source_run_id,
           r.student_id,
           r.official_score,
           r.game_over_at,
           row_number() OVER (
             PARTITION BY r.student_id
             ORDER BY r.official_score DESC, r.game_over_at ASC, r.id ASC
           ) AS student_best_row
    FROM public.arcade_runs r
    WHERE r.classroom_id = p_classroom_id
      AND r.game_id = p_game_id
      AND r.run_context = 'STANDARD'
      AND r.status = 'VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id = r.id AND m.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT c.source_run_id,
           c.student_id,
           c.official_score,
           c.game_over_at,
           row_number() OVER (
             ORDER BY c.official_score DESC, c.game_over_at ASC, c.source_run_id ASC
           )::integer AS rank
    FROM candidate_runs c
    WHERE c.student_best_row = 1
  )
  SELECT r.source_run_id, r.student_id, r.official_score, r.game_over_at, r.rank
  FROM ranked r
  ORDER BY r.rank;
END;
$$;

-- -----------------------------------------------------------------------------
-- Readiness: Top 10 remains the reward/finalization gate, not the eligibility
-- gate. Any official student may start verification, and any ACTIVE session
-- (including a lower-ranked challenger) keeps the period in VERIFICATION until
-- it is resolved. Once there are no active sessions and every current Top 10
-- student has an official result, the period may be finalized.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_refresh_verification_readiness(
  p_classroom_id integer,
  p_period_id bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game record;
  v_game_missing bigint;
  v_active_sessions bigint := 0;
  v_missing bigint := 0;
  v_next text;
BEGIN
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = p_classroom_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE = 'P0250';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' OR v_period.status = 'FINALIZED' THEN
    RETURN v_period.status;
  END IF;

  SELECT count(*) INTO v_active_sessions
  FROM public.arcade_verification_sessions s
  WHERE s.classroom_id = p_classroom_id
    AND s.period_id = v_period.id
    AND s.status = 'ACTIVE';

  FOR v_game IN
    SELECT pg.game_id, pg.target_rank_count
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id = v_period.id
    ORDER BY pg.game_id
  LOOP
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(p_classroom_id, v_period.id, v_game.game_id) r
    WHERE r.rank <= v_game.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id = v_period.id
          AND o.game_id = v_game.game_id
          AND o.student_id = r.student_id
      );
    v_missing := v_missing + v_game_missing;
  END LOOP;

  v_next := CASE WHEN v_missing = 0 AND v_active_sessions = 0 THEN 'READY_TO_FINALIZE' ELSE 'VERIFICATION' END;
  IF v_period.status IS DISTINCT FROM v_next THEN
    UPDATE public.arcade_ranking_periods
    SET status = v_next
    WHERE id = v_period.id
      AND status IN ('VERIFICATION','READY_TO_FINALIZE');
  END IF;
  RETURN v_next;
END;
$$;

-- -----------------------------------------------------------------------------
-- Finalizer: sessions with no provisional baseline use the best valid
-- verification run as a newly established official record. Because their
-- threshold is NULL, they receive all configured attempts (normally 3).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_finalize_verification_session(
  p_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_has_provisional boolean := false;
  v_used integer;
  v_best record;
  v_result_kind text;
  v_result_status text;
  v_source_run_id bigint;
  v_score bigint;
  v_duration integer;
  v_stats jsonb := '{}'::jsonb;
  v_achieved_at timestamptz;
  v_eligible boolean := true;
  v_period_status text;
BEGIN
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session not found.' USING ERRCODE = 'P0251';
  END IF;
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = v_session.period_id
    AND classroom_id = v_session.classroom_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE = 'P0216';
  END IF;
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF v_session.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('session_id',v_session.id,'status',v_session.status,'result_status',v_session.result_status);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arcade_runs r
    WHERE r.verification_session_id = v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] a verification run is still in progress.' USING ERRCODE = 'P0268';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id = v_session.id AND a.consumed;
  IF NOT v_session.success_achieved AND v_used < v_session.max_attempts THEN
    RAISE EXCEPTION '[ARCADE VERIFY] remaining attempts exist and success has not been reached.' USING ERRCODE = 'P0252';
  END IF;

  IF v_session.provisional_entry_id IS NOT NULL THEN
    SELECT * INTO v_provisional
    FROM public.arcade_verification_provisional_entries p
    WHERE p.id = v_session.provisional_entry_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[ARCADE VERIFY] frozen provisional source is missing.' USING ERRCODE = 'P0253';
    END IF;
    v_has_provisional := true;
  END IF;

  SELECT a.run_id, a.official_score, a.official_duration_ms, a.stats, r.game_over_at
  INTO v_best
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_runs r ON r.id = a.run_id
  WHERE a.session_id = v_session.id
    AND a.status = 'TERMINAL'
    AND a.consumed
    AND a.valid_run
    AND a.official_score IS NOT NULL
  ORDER BY a.official_score DESC, r.game_over_at ASC, a.run_id ASC
  LIMIT 1;

  IF NOT v_has_provisional AND v_best.run_id IS NOT NULL THEN
    -- No general-play baseline existed. The verification challenge itself
    -- establishes the student's official monthly record.
    v_result_status := 'SUCCESS';
    v_result_kind := 'SESSION_SUCCESS_VERIFICATION';
    v_source_run_id := v_best.run_id;
    v_score := v_best.official_score;
    v_duration := v_best.official_duration_ms;
    v_stats := v_best.stats;
    v_achieved_at := v_best.game_over_at;
  ELSIF v_session.success_achieved THEN
    v_result_status := 'SUCCESS';
    IF v_best.run_id IS NOT NULL AND v_best.official_score > v_provisional.official_score THEN
      v_result_kind := 'SESSION_SUCCESS_VERIFICATION';
      v_source_run_id := v_best.run_id;
      v_score := v_best.official_score;
      v_duration := v_best.official_duration_ms;
      v_stats := v_best.stats;
      v_achieved_at := v_best.game_over_at;
    ELSE
      v_result_kind := 'SESSION_SUCCESS_PROVISIONAL';
      v_source_run_id := v_provisional.source_run_id;
      v_score := v_provisional.official_score;
      v_duration := v_provisional.official_duration_ms;
      v_stats := v_provisional.stats;
      v_achieved_at := v_provisional.achieved_at;
    END IF;
  ELSIF v_best.run_id IS NOT NULL THEN
    v_result_status := 'FAILURE_VALID';
    v_result_kind := 'SESSION_FAILURE_VERIFICATION';
    v_source_run_id := v_best.run_id;
    v_score := v_best.official_score;
    v_duration := v_best.official_duration_ms;
    v_stats := v_best.stats;
    v_achieved_at := v_best.game_over_at;
  ELSE
    v_result_status := 'FAILURE_NO_VALID';
    v_result_kind := 'SESSION_FAILURE_NO_VALID';
    v_source_run_id := NULL;
    v_score := NULL;
    v_duration := NULL;
    v_stats := '{}'::jsonb;
    v_achieved_at := NULL;
    v_eligible := false;
  END IF;

  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,
    decided_by_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_result_kind,
    v_source_run_id,v_score,v_duration,v_stats,v_achieved_at,v_eligible,auth.uid()
  )
  ON CONFLICT (period_id,game_id,student_id) DO UPDATE SET
    session_id=EXCLUDED.session_id,
    decision_kind=EXCLUDED.decision_kind,
    source_run_id=EXCLUDED.source_run_id,
    official_score=EXCLUDED.official_score,
    official_duration_ms=EXCLUDED.official_duration_ms,
    stats=EXCLUDED.stats,
    achieved_at=EXCLUDED.achieved_at,
    ranking_eligible=EXCLUDED.ranking_eligible,
    decided_by_user_id=EXCLUDED.decided_by_user_id,
    decided_at=now(),
    updated_at=now();

  UPDATE public.arcade_verification_sessions
  SET status='COMPLETED', result_status=v_result_status, ended_at=now()
  WHERE id=v_session.id;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,
    'SESSION_COMPLETED',
    jsonb_build_object('result_status',v_result_status,'decision_kind',v_result_kind,'source_run_id',v_source_run_id,'official_score',v_score,'had_provisional_record',v_has_provisional),
    auth.uid()
  );

  v_period_status := public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object(
    'session_id',v_session.id,'status','COMPLETED','result_status',v_result_status,
    'decision_kind',v_result_kind,'official_source_run_id',v_source_run_id,
    'official_score',v_score,'ranking_eligible',v_eligible,'period_status',v_period_status
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Teacher overview: show every official student, regardless of rank or whether
-- a frozen STANDARD record exists.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_verification_overview(
  p_period_id bigint,
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;

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
    'period_id',v_period.id,'period_status',v_period.status,'period_name',v_period.display_name,
    'game_code',p_game_code,
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
      'is_current_reward_range',(subject.rank IS NOT NULL AND subject.rank<=10),
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
    ) ORDER BY subject.rank NULLS LAST, subject.student_name, subject.student_id),'[]'::jsonb)
  ) INTO v_result
  FROM subject;
  RETURN coalesce(v_result,jsonb_build_object('period_id',v_period.id,'period_status',v_period.status,'period_name',v_period.display_name,'game_code',p_game_code,'rows','[]'::jsonb));
END;
$$;

-- -----------------------------------------------------------------------------
-- Teacher session start: any official classroom student is eligible. If there
-- is no frozen record, choose the frozen period game's latest observed rule
-- version (falling back to the current active rule), and create a baseline-less
-- session with NULL provisional/threshold values.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_start_arcade_verification_session(
  p_period_id bigint,
  p_game_code text,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_threshold bigint;
  v_has_provisional boolean := false;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256';
  END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period is not in verification stage.' USING ERRCODE='P0261';
  END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  SELECT * INTO v_config FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id AND game_id=v_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.' USING ERRCODE='P0260'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id=p_student_id
      AND student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not an official participant in this classroom.' USING ERRCODE='P0270';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arcade_verification_official_results o
    WHERE o.period_id=v_period.id AND o.game_id=v_game_id AND o.student_id=p_student_id
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student already has an official verification result.' USING ERRCODE='P0262';
  END IF;

  SELECT * INTO v_session FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id AND status='ACTIVE';
  IF FOUND THEN
    RETURN jsonb_build_object('session_id',v_session.id,'status',v_session.status,'already_active',true,'verification_threshold',v_session.verification_threshold);
  END IF;

  SELECT * INTO v_provisional FROM public.arcade_verification_provisional_entries
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id;
  v_has_provisional := FOUND;

  IF v_has_provisional THEN
    v_threshold := ceil((v_provisional.official_score::numeric * v_config.threshold_percent::numeric) / 100::numeric)::bigint;
    INSERT INTO public.arcade_verification_sessions(
      classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
      rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
    ) VALUES (
      v_classroom_id,v_period.id,v_game_id,p_student_id,v_provisional.id,v_provisional.source_run_id,
      v_provisional.rule_version_id,v_provisional.official_score,v_threshold,v_config.threshold_percent,v_config.max_attempts
    ) RETURNING * INTO v_session;
  ELSE
    -- Prefer the rule version actually observed in this frozen period/game so
    -- a non-participant verifies under the same gameplay contract as classmates.
    SELECT rv.* INTO v_rule
    FROM public.arcade_game_rule_versions rv
    WHERE rv.id = (
      SELECT p.rule_version_id
      FROM public.arcade_verification_provisional_entries p
      WHERE p.period_id=v_period.id AND p.game_id=v_game_id
      ORDER BY p.achieved_at DESC,p.id DESC
      LIMIT 1
    );
    IF NOT FOUND THEN
      SELECT * INTO v_rule
      FROM public.arcade_game_rule_versions
      WHERE game_id=v_game_id AND is_active
      ORDER BY id DESC
      LIMIT 1;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[ARCADE VERIFY] game rule version is missing.' USING ERRCODE='P0198';
    END IF;

    INSERT INTO public.arcade_verification_sessions(
      classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
      rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
    ) VALUES (
      v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,NULL,
      v_rule.id,NULL,NULL,v_config.threshold_percent,v_config.max_attempts
    ) RETURNING * INTO v_session;
  END IF;

  UPDATE public.arcade_ranking_periods SET status='VERIFICATION' WHERE id=v_period.id AND status='READY_TO_FINALIZE';
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_classroom_id,v_period.id,v_game_id,p_student_id,v_session.id,'SESSION_STARTED',
    jsonb_build_object(
      'has_provisional_record',v_has_provisional,
      'provisional_score',CASE WHEN v_has_provisional THEN v_provisional.official_score ELSE NULL END,
      'threshold',v_threshold,
      'percent',v_config.threshold_percent,
      'max_attempts',v_config.max_attempts
    ),auth.uid()
  );
  RETURN jsonb_build_object(
    'session_id',v_session.id,'status','ACTIVE','already_active',false,
    'has_provisional_record',v_has_provisional,
    'verification_threshold',v_session.verification_threshold,
    'max_attempts',v_config.max_attempts
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Manual correction/no-record is also available for any official student, not
-- only students who happened to have a frozen STANDARD record.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_set_arcade_verification_correction(
  p_period_id bigint,
  p_game_code text,
  p_student_id integer,
  p_source_run_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_run public.arcade_runs%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_action text;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] correction reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id OR v_period.period_kind<>'MONTHLY' THEN RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found.' USING ERRCODE='P0256'; END IF;
  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN RAISE EXCEPTION '[ARCADE VERIFY] correction is allowed only during verification.' USING ERRCODE='P0261'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id=p_student_id
      AND student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not an official participant in this classroom.' USING ERRCODE='P0270';
  END IF;

  SELECT * INTO v_session FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id AND status='ACTIVE'
  FOR UPDATE;
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.arcade_runs r
    WHERE r.verification_session_id=v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN RAISE EXCEPTION '[ARCADE VERIFY] finish/cancel the active verification run before correction.' USING ERRCODE='P0268'; END IF;
  IF FOUND THEN UPDATE public.arcade_verification_sessions SET status='OVERRIDDEN',ended_at=now() WHERE id=v_session.id; END IF;

  IF p_source_run_id IS NULL THEN
    v_action:='NO_RECORD';
    INSERT INTO public.arcade_verification_official_results(
      classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
    ) VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,'MANUAL_NONE',NULL,NULL,NULL,'{}'::jsonb,NULL,false,auth.uid())
    ON CONFLICT(period_id,game_id,student_id) DO UPDATE SET session_id=NULL,decision_kind='MANUAL_NONE',source_run_id=NULL,official_score=NULL,official_duration_ms=NULL,stats='{}'::jsonb,achieved_at=NULL,ranking_eligible=false,decided_by_user_id=auth.uid(),decided_at=now(),updated_at=now();
  ELSE
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_source_run_id;
    IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM v_classroom_id OR v_run.student_id IS DISTINCT FROM p_student_id OR v_run.game_id IS DISTINCT FROM v_game_id OR v_run.status<>'VERIFIED' THEN
      RAISE EXCEPTION '[ARCADE VERIFY] correction source run is not a matching verified run.' USING ERRCODE='P0267';
    END IF;
    IF v_run.run_context='STANDARD' THEN
      IF v_run.is_prerelease_test OR v_run.game_over_at<v_period.starts_at OR v_run.game_over_at>=v_period.ends_at_exclusive OR EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=v_run.id AND m.event_kind='INVALIDATE') THEN
        RAISE EXCEPTION '[ARCADE VERIFY] standard correction source is outside this target period or invalid.' USING ERRCODE='P0267';
      END IF;
    ELSIF v_run.run_context='VERIFICATION' THEN
      IF NOT EXISTS(
        SELECT 1 FROM public.arcade_verification_sessions s
        WHERE s.id=v_run.verification_session_id AND s.period_id=v_period.id AND s.game_id=v_game_id AND s.student_id=p_student_id
      ) THEN RAISE EXCEPTION '[ARCADE VERIFY] verification correction source belongs to a different target period.' USING ERRCODE='P0267'; END IF;
    ELSE RAISE EXCEPTION '[ARCADE VERIFY] unsupported correction source context.' USING ERRCODE='P0267'; END IF;
    v_action:='SET_SOURCE';
    INSERT INTO public.arcade_verification_official_results(
      classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
    ) VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,'MANUAL_SOURCE',v_run.id,v_run.official_score,v_run.official_duration_ms,v_run.stats,v_run.game_over_at,true,auth.uid())
    ON CONFLICT(period_id,game_id,student_id) DO UPDATE SET session_id=NULL,decision_kind='MANUAL_SOURCE',source_run_id=EXCLUDED.source_run_id,official_score=EXCLUDED.official_score,official_duration_ms=EXCLUDED.official_duration_ms,stats=EXCLUDED.stats,achieved_at=EXCLUDED.achieved_at,ranking_eligible=true,decided_by_user_id=auth.uid(),decided_at=now(),updated_at=now();
  END IF;

  INSERT INTO public.arcade_verification_corrections(classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason)
  VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,v_action,p_source_run_id,btrim(p_reason));
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,event_kind,reason,metadata,actor_user_id)
  VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,'MANUAL_CORRECTION',btrim(p_reason),jsonb_build_object('action_kind',v_action,'source_run_id',p_source_run_id),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  RETURN jsonb_build_object('period_id',v_period.id,'student_id',p_student_id,'action_kind',v_action,'source_run_id',p_source_run_id,'period_status',v_status);
END;
$$;

-- -----------------------------------------------------------------------------
-- Student state/run creation: rank no longer gates attempts. A teacher-created
-- active session is the authorization boundary.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_arcade_verification_state(
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer:=public.current_classroom_id();
  v_student_id integer:=public.current_student_id();
  v_game_id bigint;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_used integer;
  v_active_run_id bigint;
  v_rank integer;
BEGIN
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  SELECT s.* INTO v_session
  FROM public.arcade_verification_sessions s
  JOIN public.arcade_ranking_periods p ON p.id=s.period_id
  WHERE s.classroom_id=v_classroom_id AND s.student_id=v_student_id AND s.game_id=v_game_id
    AND p.status IN ('VERIFICATION','READY_TO_FINALIZE')
    AND s.status IN ('ACTIVE','COMPLETED')
  ORDER BY (s.status='ACTIVE') DESC,s.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'game_code',p_game_code); END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_session.period_id;
  SELECT count(*)::integer INTO v_used FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id AND a.consumed;
  SELECT r.id INTO v_active_run_id FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') ORDER BY r.id DESC LIMIT 1;
  SELECT r.rank INTO v_rank FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_session.period_id,v_game_id) r WHERE r.student_id=v_student_id;
  RETURN jsonb_build_object(
    'available',true,'game_code',p_game_code,'period_id',v_period.id,'period_name',v_period.display_name,'period_status',v_period.status,
    'session_id',v_session.id,'session_status',v_session.status,
    'has_provisional_record',(v_session.provisional_entry_id IS NOT NULL),
    'provisional_score',v_session.provisional_score,
    'verification_threshold',v_session.verification_threshold,'threshold_percent',v_session.threshold_percent,
    'max_attempts',v_session.max_attempts,'used_attempts',v_used,'remaining_attempts',greatest(v_session.max_attempts-v_used,0),
    'success_achieved',v_session.success_achieved,'result_status',v_session.result_status,'current_rank',v_rank,
    'active_run_id',v_active_run_id,
    'can_attempt',(v_session.status='ACTIVE' AND v_used<v_session.max_attempts AND v_active_run_id IS NULL),
    'attempts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'attempt_id',a.id,'issue_number',a.issue_number,'opportunity_number',a.opportunity_number,'run_id',a.run_id,
      'status',a.status,'consumed',a.consumed,'valid_run',a.valid_run,'terminal_outcome',a.terminal_outcome,
      'official_score',a.official_score,'issued_at',a.issued_at,'terminal_at',a.terminal_at
    ) ORDER BY a.issue_number) FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_create_arcade_verification_run(
  p_session_id bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_game public.arcade_games%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_used integer;
  v_issue integer;
  v_opportunity integer;
  v_seed bigint;
BEGIN
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] idempotency key is required.' USING ERRCODE='P0208'; END IF;

  SELECT a.* INTO v_attempt
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_verification_sessions s ON s.id=a.session_id
  WHERE a.idempotency_key=p_idempotency_key
    AND s.classroom_id=v_classroom_id
    AND s.student_id=v_student_id;
  IF FOUND THEN
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,'verification_opportunity_number',v_attempt.opportunity_number);
  END IF;

  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM v_classroom_id OR v_session.student_id IS DISTINCT FROM v_student_id OR v_session.status<>'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session not found for this student.' USING ERRCODE='P0255';
  END IF;
  SELECT a.* INTO v_attempt
  FROM public.arcade_verification_attempts a
  WHERE a.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_attempt.session_id IS DISTINCT FROM v_session.id THEN
      RAISE EXCEPTION '[ARCADE VERIFY] idempotency key belongs to a different session.' USING ERRCODE='P0212';
    END IF;
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,'verification_opportunity_number',v_attempt.opportunity_number);
  END IF;

  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_session.period_id;
  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN RAISE EXCEPTION '[ARCADE VERIFY] target period is not accepting verification.' USING ERRCODE='P0261'; END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] another verification run is already in progress.' USING ERRCODE='P0269';
  END IF;
  IF NOT public.is_official_participant(v_student_id) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not an official participant.' USING ERRCODE='P0270';
  END IF;

  SELECT count(*)::integer INTO v_used FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id AND a.consumed;
  IF v_used>=v_session.max_attempts THEN RAISE EXCEPTION '[ARCADE VERIFY] no verification attempts remain.' USING ERRCODE='P0269'; END IF;
  SELECT coalesce(max(a.issue_number),0)+1 INTO v_issue FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id;
  SELECT slot.n INTO v_opportunity
  FROM generate_series(1,v_session.max_attempts) AS slot(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arcade_verification_attempts a
    WHERE a.session_id=v_session.id
      AND a.opportunity_number=slot.n
      AND a.consumed
  )
  ORDER BY slot.n
  LIMIT 1;
  IF v_opportunity IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] no verification opportunity slot remains.' USING ERRCODE='P0269'; END IF;
  SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_session.rule_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen rule version is missing.' USING ERRCODE='P0198'; END IF;
  SELECT * INTO v_game FROM public.arcade_games WHERE id=v_session.game_id;
  v_seed:=public.arcade_generate_run_seed();
  INSERT INTO public.arcade_runs(classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,countdown_started_at,is_prerelease_test,run_context,verification_session_id)
  VALUES(v_classroom_id,v_student_id,v_session.game_id,v_session.rule_version_id,'COUNTDOWN',v_seed,now(),false,'VERIFICATION',v_session.id)
  RETURNING * INTO v_run;
  INSERT INTO public.arcade_verification_attempts(session_id,issue_number,opportunity_number,run_id,idempotency_key)
  VALUES(v_session.id,v_issue,v_opportunity,v_run.id,p_idempotency_key) RETURNING * INTO v_attempt;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,metadata,actor_user_id)
  VALUES(v_classroom_id,v_session.period_id,v_session.game_id,v_student_id,v_session.id,v_attempt.id,'ATTEMPT_ISSUED',jsonb_build_object('run_id',v_run.id,'issue_number',v_issue,'opportunity_number',v_opportunity),auth.uid());
  RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
    'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
    'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
    'verification_session_id',v_session.id,'verification_opportunity_number',v_opportunity);
END;
$$;

-- Preserve the production RPC boundary explicitly.
REVOKE ALL ON FUNCTION public.arcade_resolve_period_student_ranks(integer,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_refresh_verification_readiness(integer,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_finalize_verification_session(bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.teacher_get_arcade_verification_overview(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_start_arcade_verification_session(bigint,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_get_arcade_verification_state(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_create_arcade_verification_run(bigint,uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_verification_overview(bigint,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_start_arcade_verification_session(bigint,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_get_arcade_verification_state(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_create_arcade_verification_run(bigint,uuid) TO authenticated, service_role;

COMMIT;
