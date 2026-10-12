-- Starlink Arcade Core integration postcheck on ephemeral PostgreSQL ONLY.
DO $test$
DECLARE
  v_events jsonb := '[
    {"type":"PATH_START","elapsed_ms":100,"cell":22},
    {"type":"CELL_ENTER","elapsed_ms":150,"cell":29},
    {"type":"CELL_ENTER","elapsed_ms":200,"cell":30},
    {"type":"CELL_ENTER","elapsed_ms":220,"cell":36},
    {"type":"PATH_RELEASE","elapsed_ms":250},
    {"type":"PATH_START","elapsed_ms":450,"cell":3},
    {"type":"CELL_ENTER","elapsed_ms":470,"cell":9},
    {"type":"CELL_ENTER","elapsed_ms":490,"cell":10},
    {"type":"PATH_RELEASE","elapsed_ms":500}
  ]'::jsonb;
  v_out jsonb;
  v_threw boolean;
  v_game_id bigint;
  v_rule_id bigint;
  v_pause_events jsonb:='[]'::jsonb;
  v_pause_paths integer[][]:=ARRAY[
    [0,1,9],[2,9,16],[4,10,11],[8,16,10],[24,30,36],
    [1,8,16],[0,1,7],[2,9,16],[2,8,7]
  ]::integer[][];
  v_pause_starts integer[]:=ARRAY[100,330,560,790,1020,1250,1480,1710,2290];
  v_i integer;
  v_start integer;
BEGIN
  IF NOT has_function_privilege(
    'authenticated','public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer)','EXECUTE'
  ) OR has_function_privilege(
    'anon','public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer)','EXECUTE'
  ) OR has_function_privilege(
    'authenticated','public.arcade_starlink_04_prepare_seed_pack(bigint)','EXECUTE'
  ) THEN
    RAISE EXCEPTION '[CORE INTEGRATION] RPC/internal ACL is wrong.';
  END IF;

  -- Standard source run becomes exactly one VERIFIED and audit submission.
  v_out:=public.student_submit_starlink_04_run(
    10,'ff3d58b7-9260-4b58-b394-c9e37e454dea',v_events,60000
  );
  IF NOT (v_out->>'accepted')::boolean
     OR (v_out->>'official_score')::bigint<>457
     OR v_out->>'run_context'<>'STANDARD'
     OR (SELECT status FROM public.arcade_runs WHERE id=10)<>'VERIFIED'
     OR (SELECT count(*) FROM public.arcade_run_submissions WHERE run_id=10)<>1
     OR (SELECT official_score FROM public.arcade_runs WHERE id=10)<>457
     OR (SELECT stats->>'normalClearCount' FROM public.arcade_runs WHERE id=10)<>'2'
     OR (SELECT game_over_at FROM public.arcade_runs WHERE id=10)
        IS DISTINCT FROM (SELECT play_started_at+interval '60 seconds' FROM public.arcade_runs WHERE id=10)
  THEN
    RAISE EXCEPTION '[CORE INTEGRATION] standard submission result mismatch: %',v_out;
  END IF;

  -- Same payload is idempotent and cannot produce a second submission.
  v_out:=public.student_submit_starlink_04_run(
    10,'ff3d58b7-9260-4b58-b394-c9e37e454dea',v_events,60000
  );
  IF NOT (v_out->>'already_submitted')::boolean OR
      (SELECT count(*) FROM public.arcade_run_submissions WHERE run_id=10)<>1 THEN
    RAISE EXCEPTION '[CORE INTEGRATION] idempotence failed.';
  END IF;

  v_threw:=false;
  BEGIN
    PERFORM public.student_submit_starlink_04_run(
      10,'11111111-1111-4111-8111-111111111111',v_events,60000
    );
  EXCEPTION WHEN SQLSTATE 'P0291' THEN v_threw:=true;
  END;
  IF NOT v_threw THEN RAISE EXCEPTION '[CORE INTEGRATION] nonce forgery was accepted.'; END IF;

  v_threw:=false;
  BEGIN
    PERFORM public.student_submit_starlink_04_run(
      10,'ff3d58b7-9260-4b58-b394-c9e37e454dea',v_events||jsonb_build_array(
        jsonb_build_object('type','PATH_START','elapsed_ms',60000,'cell',1)
      ),60000
    );
  EXCEPTION WHEN SQLSTATE 'P0293' THEN v_threw:=true;
  END;
  IF NOT v_threw THEN RAISE EXCEPTION '[CORE INTEGRATION] changed retry accepted.'; END IF;

  -- Authorized verification uses immutable assigned A seed and the shared
  -- attempt-capture hook. This is the existing leaderboard/Guild2 source.
  v_out:=public.student_submit_starlink_04_run(
    20,'43c9ce64-4fb8-46bd-aa6b-41c311c4df7c',v_events,60000
  );
  IF NOT (v_out->>'accepted')::boolean OR
     v_out->>'run_context'<>'VERIFICATION'
     OR NOT (v_out->'verification_capture'->>'captured')::boolean
     OR (SELECT status FROM public.arcade_verification_attempts WHERE id=301)<>'TERMINAL'
     OR (SELECT official_score FROM public.arcade_runs WHERE id=20)<>457 THEN
    RAISE EXCEPTION '[CORE INTEGRATION] shared verification capture failed: %',v_out;
  END IF;

  -- Invalid logical events reject the run (no playable state left behind).
  v_out:=public.student_submit_starlink_04_run(
    30,'f6b909fb-bbad-4e76-a51b-d3f737e5e06b',
    '[{"type":"PATH_RELEASE","elapsed_ms":200}]'::jsonb,
    60000
  );
  IF (v_out->>'accepted')::boolean IS DISTINCT FROM false
     OR v_out->>'code'<>'REPLAY_INPUT_INVALID'
     OR (SELECT status FROM public.arcade_runs WHERE id=30)<>'REJECTED' THEN
    RAISE EXCEPTION '[CORE INTEGRATION] malformed path was not rejected: %',v_out;
  END IF;

  SELECT g.id,rv.id INTO v_game_id,v_rule_id
  FROM public.arcade_games g JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
  WHERE g.code='starlink_04';

  INSERT INTO public.arcade_runs(
    id,classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,run_nonce,
    play_started_at,run_context,verification_session_id
  ) VALUES(
    21,1,1,v_game_id,v_rule_id,'PLAYING',6059,
    '64bd0d59-4bb4-4e6e-8480-0e97932bf41a',
    clock_timestamp()-interval '60 seconds','VERIFICATION',201
  );
  INSERT INTO public.arcade_verification_attempts
    (id,run_id,session_id,opportunity_number,status,consumed)
  VALUES(302,21,201,1,'ISSUED',true);

  UPDATE public.arcade_verification_period_games
  SET verification_closed_at=clock_timestamp()
  WHERE id=101;
  v_threw:=false;
  BEGIN
    PERFORM public.student_submit_starlink_04_run(
      21,'64bd0d59-4bb4-4e6e-8480-0e97932bf41a',v_events,60000
    );
  EXCEPTION WHEN SQLSTATE 'P0277' THEN v_threw:=true;
  END;
  IF NOT v_threw
     OR (SELECT status FROM public.arcade_runs WHERE id=21)<>'PLAYING'
     OR EXISTS(SELECT 1 FROM public.arcade_run_submissions WHERE run_id=21) THEN
    RAISE EXCEPTION '[CORE INTEGRATION] forced-close gate failed.';
  END IF;

  -- End-to-end server commit of a real dead-board run (9 clears, 350ms freeze).
  INSERT INTO public.arcade_runs(
    id,classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,run_nonce,
    play_started_at,run_context
  ) VALUES (
    40,1,1,v_game_id,v_rule_id,'PLAYING',8,
    'ee0f51c3-43d4-4dc1-8260-03d8fa7898b3',
    clock_timestamp()-interval '60.350 seconds','STANDARD'
  );

  FOR v_i IN 1..9 LOOP
    v_start:=v_pause_starts[v_i];
    v_pause_events:=v_pause_events||jsonb_build_array(
      jsonb_build_object('type','PATH_START','elapsed_ms',v_start,'cell',v_pause_paths[v_i][1]),
      jsonb_build_object('type','CELL_ENTER','elapsed_ms',v_start+10,'cell',v_pause_paths[v_i][2]),
      jsonb_build_object('type','CELL_ENTER','elapsed_ms',v_start+20,'cell',v_pause_paths[v_i][3]),
      jsonb_build_object('type','PATH_RELEASE','elapsed_ms',v_start+30)
    );
  END LOOP;

  v_out:=public.student_submit_starlink_04_run(
    40,'ee0f51c3-43d4-4dc1-8260-03d8fa7898b3',v_pause_events,60350
  );
  IF NOT (v_out->>'accepted')::boolean
     OR (v_out->>'official_score')::integer<>1618
     OR (v_out->'stats'->>'reshuffleCount')::integer<>1
     OR (v_out->'stats'->>'maxCombo')::integer<>9
     OR (SELECT official_duration_ms FROM public.arcade_runs WHERE id=40)<>60000
     OR (SELECT game_over_at FROM public.arcade_runs WHERE id=40)
         IS DISTINCT FROM
        (SELECT play_started_at+interval '60.350 seconds' FROM public.arcade_runs WHERE id=40) THEN
    RAISE EXCEPTION '[CORE INTEGRATION] 350ms pause source-run score/stats mismatch: %',v_out;
  END IF;

  -- Verify Starlink's 3 immutable pack slots are all playable, unique and ready.
  -- Independent period: production schema uniquely scopes (period_id,game_id).
  INSERT INTO public.arcade_ranking_periods(id,status) VALUES(200,'VERIFICATION');
  INSERT INTO public.arcade_verification_period_games(
    id,period_id,game_id,rule_version_id,max_attempts,seed_strategy,seed_pack_status
  ) VALUES(102,200,v_game_id,v_rule_id,3,'PERIOD_PACK_PERMUTED','DRAFT');

  PERFORM public.arcade_starlink_04_prepare_seed_pack(102);
  PERFORM public.arcade_starlink_04_prepare_seed_pack(102); -- safe idempotent retry
  IF (SELECT count(*) FROM public.arcade_verification_seed_pack_slots
      WHERE period_game_id=102 AND preflight_status='READY')<>3
     OR (SELECT count(DISTINCT initial_board_hash) FROM public.arcade_verification_seed_pack_slots
         WHERE period_game_id=102)<>3 THEN
    RAISE EXCEPTION '[CORE INTEGRATION] A/B/C seed pack generation failed.';
  END IF;

  RAISE NOTICE '[CORE INTEGRATION] standard+certified submit, nonce, idempotence, close, seed pack passed.';
END;
$test$;
