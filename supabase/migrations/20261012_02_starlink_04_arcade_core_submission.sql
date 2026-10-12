-- B.R.A.N.D 2.0 / Starlink #04 — shared Arcade Core integration
-- Run AFTER 20261011_01..06 + 20261012_01; stays disabled until teacher activation.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_replay(bigint,jsonb,integer)') IS NULL
     OR to_regprocedure('public.arcade_capture_verification_attempt(bigint)') IS NULL
     OR to_regprocedure('public.arcade_sha256_hex(text)') IS NULL
     OR to_regprocedure('public.arcade_generate_run_seed()') IS NULL
     OR to_regclass('public.arcade_run_submissions') IS NULL
     OR to_regclass('public.arcade_verification_seed_pack_slots') IS NULL
  THEN
    RAISE EXCEPTION '[STARLINK INTEGRATION] prerequisite Arcade Core functions/tables missing.';
  END IF;
END;
$$;

-- Called by the already-present arcade_prepare_verification_seed_pack dispatcher,
-- inside the teacher's period freeze transaction. No student-facing seed API.
CREATE OR REPLACE FUNCTION public.arcade_starlink_04_prepare_seed_pack(p_period_game_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_pg public.arcade_verification_period_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_game_code text;
  v_slot_count integer;
  v_slot integer;
  v_candidate bigint;
  v_attempt integer;
  v_initial jsonb;
  v_board_signature text;
  v_board_hash text;
BEGIN
  SELECT * INTO v_pg
  FROM public.arcade_verification_period_games
  WHERE id=p_period_game_id
  FOR UPDATE;

  IF NOT FOUND OR v_pg.seed_strategy<>'PERIOD_PACK_PERMUTED'
     OR v_pg.seed_pack_status NOT IN ('DRAFT','LOCKED') THEN
    RAISE EXCEPTION '[STARLINK SEED] frozen pack scope is unavailable.' USING ERRCODE='P0282';
  END IF;

  SELECT g.code INTO v_game_code FROM public.arcade_games g WHERE g.id=v_pg.game_id;
  SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_pg.rule_version_id AND game_id=v_pg.game_id;
  IF v_game_code<>'starlink_04'
     OR NOT FOUND
     OR v_rule.version_code<>'starlink_04_v0.3'
     OR v_pg.max_attempts<>3 THEN
    RAISE EXCEPTION '[STARLINK SEED] rule pin or A/B/C attempt policy mismatch.' USING ERRCODE='P0282';
  END IF;

  SELECT count(*) INTO v_slot_count
  FROM public.arcade_verification_seed_pack_slots
  WHERE period_game_id=v_pg.id AND preflight_status='READY';

  IF v_pg.seed_pack_status='LOCKED' THEN
    IF v_slot_count<>3 THEN
      RAISE EXCEPTION '[STARLINK SEED] locked pack is incomplete.' USING ERRCODE='P0282';
    END IF;
    RETURN;
  END IF;

  -- Frozen pack is provisioned atomically; never rewrite a partially prepared
  -- pack or silently issue different A/B/C seeds on a retry.
  IF EXISTS(SELECT 1 FROM public.arcade_verification_seed_pack_slots WHERE period_game_id=v_pg.id) THEN
    IF v_slot_count<>3 THEN
      RAISE EXCEPTION '[STARLINK SEED] unexpected partial A/B/C pack.' USING ERRCODE='P0282';
    END IF;
    RETURN;
  END IF;

  FOR v_slot IN 1..3 LOOP
    v_candidate:=NULL;
    FOR v_attempt IN 1..256 LOOP
      v_candidate:=public.arcade_generate_run_seed();
      v_initial:=public.arcade_starlink_04_generate_initial_board(v_candidate);
      v_board_signature:=array_to_string(ARRAY(
        SELECT j.value
        FROM jsonb_array_elements_text(v_initial->'board') WITH ORDINALITY AS j(value,ord)
        ORDER BY j.ord
      ),'');
      v_board_hash:=public.arcade_sha256_hex(v_board_signature);

      IF (v_initial->'metrics'->>'playable')::boolean
         AND (v_initial->'metrics'->>'largestComponent')::integer<=8
         AND NOT EXISTS (
           SELECT 1 FROM public.arcade_verification_seed_pack_slots slot
           WHERE slot.period_game_id=v_pg.id
             AND (slot.gameplay_seed=v_candidate OR slot.initial_board_hash=v_board_hash)
         ) THEN
        EXIT;
      END IF;
      v_candidate:=NULL;
    END LOOP;

    IF v_candidate IS NULL THEN
      RAISE EXCEPTION '[STARLINK SEED] could not prepare three distinct playable seed boards.'
        USING ERRCODE='P0282';
    END IF;

    INSERT INTO public.arcade_verification_seed_pack_slots(
      period_game_id,slot_code,slot_number,gameplay_seed,
      preflight_status,initial_board_hash,preflight_metrics
    ) VALUES (
      v_pg.id,chr(64+v_slot),v_slot,v_candidate,
      'READY',v_board_hash,v_initial->'metrics'
    );
  END LOOP;

  IF (SELECT count(*) FROM public.arcade_verification_seed_pack_slots
      WHERE period_game_id=v_pg.id AND preflight_status='READY')<>3 THEN
    RAISE EXCEPTION '[STARLINK SEED] incomplete A/B/C seed-pack.' USING ERRCODE='P0282';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_starlink_04_prepare_seed_pack(bigint) FROM PUBLIC,anon,authenticated;

-- Only entrypoint for a student; all scoring stays server-authoritative.
CREATE OR REPLACE FUNCTION public.student_submit_starlink_04_run(
  p_run_id bigint,
  p_run_nonce uuid,
  p_input_events jsonb,
  p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_now timestamptz:=clock_timestamp();
  v_run public.arcade_runs%ROWTYPE;
  v_game_code text;
  v_config jsonb;
  v_version_code text;
  v_validation jsonb;
  v_capture jsonb;
  v_event_count integer;
  v_payload_hash text;
  v_existing_hash text;
  v_elapsed_ms bigint;
  v_expected_wall_ms integer;
  v_duration_ms integer;
  v_client_tolerance_ms integer;
  v_server_tolerance_ms integer;
  v_reject_code text:=NULL;
  v_reject_message text:=NULL;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_pg public.arcade_verification_period_games%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195';
  END IF;

  SELECT * INTO v_run FROM public.arcade_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for student.' USING ERRCODE='P0199';
  END IF;

  SELECT g.code,rv.version_code,rv.config
  INTO v_game_code,v_version_code,v_config
  FROM public.arcade_games g
  JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
  WHERE g.id=v_run.game_id AND rv.id=v_run.rule_version_id;

  IF v_game_code IS DISTINCT FROM 'starlink_04'
     OR v_version_code IS DISTINCT FROM 'starlink_04_v0.3'
     OR v_config->>'game_code' IS DISTINCT FROM 'starlink_04' THEN
    RAISE EXCEPTION '[STARLINK] run uses an unsupported game/rule pin.' USING ERRCODE='P0203';
  END IF;

  -- Nonce comparison precedes all idempotency information disclosure.
  IF p_run_nonce IS NULL OR v_run.run_nonce IS DISTINCT FROM p_run_nonce THEN
    RAISE EXCEPTION '[STARLINK] run nonce mismatch.' USING ERRCODE='P0291';
  END IF;

  IF p_input_events IS NULL
     OR jsonb_typeof(p_input_events)<>'array'
     OR jsonb_array_length(p_input_events)>5000
     OR p_client_game_over_elapsed_ms IS NULL
     OR p_client_game_over_elapsed_ms NOT BETWEEN 60000 AND 180000 THEN
    RAISE EXCEPTION '[STARLINK] invalid submission envelope.' USING ERRCODE='P0292';
  END IF;
  v_event_count:=jsonb_array_length(p_input_events);
  v_payload_hash:=public.arcade_sha256_hex(
    v_run.run_nonce::text||'|'||p_input_events::text||'|'||p_client_game_over_elapsed_ms::text
  );

  IF v_run.status IN ('VERIFIED','REJECTED') THEN
    SELECT s.payload_hash INTO v_existing_hash
    FROM public.arcade_run_submissions s WHERE s.run_id=v_run.id;
    IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
      RAISE EXCEPTION '[STARLINK] replay submission payload differs from committed submission.'
        USING ERRCODE='P0293';
    END IF;
    RETURN jsonb_build_object(
      'accepted',(v_run.status='VERIFIED'),
      'run_id',v_run.id,'official_score',v_run.official_score,
      'official_duration_ms',v_run.official_duration_ms,
      'game_over_at',v_run.game_over_at,'stats',v_run.stats,
      'code',v_run.rejection_code,'message',v_run.rejection_reason,
      'run_context',v_run.run_context,'already_submitted',true
    );
  END IF;

  IF v_run.status<>'PLAYING' OR v_run.play_started_at IS NULL THEN
    RAISE EXCEPTION '[STARLINK] run is not PLAYING or was cancelled.' USING ERRCODE='P0202';
  END IF;

  -- Force-close/period finalization must win over late submissions.
  IF v_run.run_context='VERIFICATION' THEN
    SELECT * INTO v_attempt FROM public.arcade_verification_attempts
    WHERE run_id=v_run.id FOR UPDATE;
    IF NOT FOUND OR v_attempt.status<>'ISSUED' OR NOT v_attempt.consumed THEN
      RAISE EXCEPTION '[STARLINK VERIFY] attempt is not available.' USING ERRCODE='P0269';
    END IF;
    SELECT * INTO v_session FROM public.arcade_verification_sessions
    WHERE id=v_attempt.session_id FOR UPDATE;
    IF NOT FOUND OR v_session.status<>'ACTIVE'
       OR v_session.game_id<>v_run.game_id
       OR v_session.student_id<>v_student_id
       OR v_session.rule_version_id<>v_run.rule_version_id THEN
      RAISE EXCEPTION '[STARLINK VERIFY] session is not active/matching.' USING ERRCODE='P0255';
    END IF;
    SELECT * INTO v_pg FROM public.arcade_verification_period_games
    WHERE period_id=v_session.period_id AND game_id=v_run.game_id FOR UPDATE;
    SELECT * INTO v_period FROM public.arcade_ranking_periods
    WHERE id=v_session.period_id;
    IF v_pg.id IS NULL OR v_pg.verification_closed_at IS NOT NULL
       OR v_pg.rule_version_id<>v_run.rule_version_id
       OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE')
       OR v_pg.seed_pack_status<>'LOCKED' THEN
      RAISE EXCEPTION '[STARLINK VERIFY] certification closed or seed pack unlocked.'
        USING ERRCODE='P0277';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM public.arcade_verification_seed_assignments a
      JOIN public.arcade_verification_seed_pack_slots slot
        ON slot.id=a.seed_slot_id AND slot.period_game_id=a.period_game_id
      WHERE a.period_game_id=v_pg.id AND a.student_id=v_student_id
        AND a.opportunity_number=v_attempt.opportunity_number
        AND slot.gameplay_seed=v_run.schedule_seed AND slot.preflight_status='READY'
    ) THEN
      RAISE EXCEPTION '[STARLINK VERIFY] immutable A/B/C seed assignment mismatch.'
        USING ERRCODE='P0286';
    END IF;
  ELSE
    IF v_run.run_context<>'STANDARD' THEN
      RAISE EXCEPTION '[STARLINK] unsupported run context.' USING ERRCODE='P0203';
    END IF;
  END IF;

  -- Validation exceptions in user input are rejected, but unexpected server
  -- errors must ROLLBACK rather than corrupt/consume a formerly playable run.
  BEGIN
    v_validation:=public.arcade_starlink_04_replay(
      v_run.schedule_seed,p_input_events,p_client_game_over_elapsed_ms
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_reject_code:='REPLAY_INPUT_INVALID';
    v_reject_message:='입력 기록이나 종료 시각이 올바르지 않아 공식 기록으로 인정되지 않았습니다.';
    v_validation:=jsonb_build_object('valid',false,'code',v_reject_code);
  END;

  v_elapsed_ms:=floor(extract(epoch FROM (v_now-v_run.play_started_at))*1000)::bigint;
  v_server_tolerance_ms:=coalesce((v_config->>'server_elapsed_tolerance_ms')::integer,10000);
  v_client_tolerance_ms:=coalesce((v_config->>'client_end_tolerance_ms')::integer,2000);

  IF v_reject_code IS NULL THEN
    v_expected_wall_ms:=(v_validation->>'game_end_wall_ms')::integer;
    v_duration_ms:=(v_validation->>'official_duration_ms')::integer;

    IF v_expected_wall_ms IS NULL OR v_duration_ms<>60000
       OR abs(p_client_game_over_elapsed_ms-v_expected_wall_ms)>v_client_tolerance_ms THEN
      v_reject_code:='CLIENT_TIME_MISMATCH';
      v_reject_message:='종료 시각이 서버 계산과 일치하지 않습니다.';
    ELSIF v_elapsed_ms < v_expected_wall_ms-2000
       OR v_elapsed_ms > v_expected_wall_ms+v_server_tolerance_ms THEN
      v_reject_code:='SERVER_TIME_MISMATCH';
      v_reject_message:='실제 서버 시각과 게임 기록이 일치하지 않습니다.';
    END IF;
  END IF;

  -- Preserve the shared Arcade audit/submission schema. One source_run_id
  -- supplies score, stats, monthly leaderboard, history and Guild2.
  INSERT INTO public.arcade_run_submissions(
    run_id,input_events,input_event_count,client_game_over_elapsed_ms,
    payload_hash,validation_metadata,submitted_at
  ) VALUES(
    v_run.id,p_input_events,v_event_count,p_client_game_over_elapsed_ms,
    v_payload_hash,
    coalesce(v_validation,'{}'::jsonb)||jsonb_build_object(
      'server_elapsed_ms',v_elapsed_ms,
      'server_time_valid',(v_reject_code IS NULL),
      'run_nonce_bound',true,
      'rule_version',v_version_code
    ),v_now
  );

  IF v_reject_code IS NOT NULL THEN
    UPDATE public.arcade_runs
    SET status='REJECTED',submitted_at=v_now,
        rejection_code=v_reject_code,rejection_reason=v_reject_message
    WHERE id=v_run.id
    RETURNING * INTO v_run;
    IF v_run.run_context='VERIFICATION' THEN
      v_capture:=public.arcade_capture_verification_attempt(v_run.id);
    END IF;
    RETURN jsonb_build_object(
      'accepted',false,'run_id',v_run.id,'code',v_reject_code,
      'message',v_reject_message,'run_context',v_run.run_context,
      'verification_capture',v_capture
    );
  END IF;

  UPDATE public.arcade_runs
  SET status='VERIFIED',
      submitted_at=v_now,
      game_over_at=v_run.play_started_at+
        ((v_expected_wall_ms::text||' milliseconds')::interval),
      verified_at=v_now,
      official_score=(v_validation->>'official_score')::bigint,
      official_duration_ms=v_duration_ms,
      stats=v_validation->'stats',
      rejection_code=NULL,rejection_reason=NULL
  WHERE id=v_run.id
  RETURNING * INTO v_run;

  IF v_run.run_context='VERIFICATION' THEN
    v_capture:=public.arcade_capture_verification_attempt(v_run.id);
  END IF;

  RETURN jsonb_build_object(
    'accepted',true,'run_id',v_run.id,
    'official_score',v_run.official_score,
    'official_duration_ms',v_run.official_duration_ms,
    'game_over_at',v_run.game_over_at,
    'stats',v_run.stats,
    'run_context',v_run.run_context,
    'verification_capture',v_capture,
    'already_submitted',false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer)
FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer)
TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
