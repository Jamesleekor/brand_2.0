-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade Game #02 Pure Reaction Speed v0.1
-- 2026-09-10
-- Incremental: reuses the existing Arcade Core / ranking / verification / Guild2.
-- =============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_game_rule_versions') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_run_submissions') IS NULL
     OR to_regclass('public.arcade_verification_game_configs') IS NULL
     OR to_regprocedure('public.arcade_xorshift32_next(bigint)') IS NULL
     OR to_regprocedure('public.arcade_capture_verification_attempt(bigint)') IS NULL
     OR to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE GAME02] required production Arcade baseline is missing.';
  END IF;
END $$;

INSERT INTO public.arcade_games(code,internal_name,is_active,available_from,available_until)
VALUES('pure_reaction_02','Pure Reaction Speed',true,DATE '2099-12-31',NULL)
ON CONFLICT(code) DO UPDATE SET internal_name=EXCLUDED.internal_name,is_active=EXCLUDED.is_active,updated_at=now();

INSERT INTO public.arcade_game_rule_versions(game_id,version_code,config,is_active,created_by_user_id)
SELECT g.id,'v0.1',
$json${
  "game_code":"pure_reaction_02",
  "trialCount":5,
  "waitMinMs":1500,
  "waitMaxMs":4500,
  "minValidReactionMs":120,
  "responseTimeoutMs":3000,
  "interTrialFeedbackMs":700,
  "countdown_ms":5000,
  "max_input_events":5,
  "max_client_elapsed_ms":60000,
  "client_end_tolerance_ms":2000,
  "server_elapsed_tolerance_ms":10000,
  "visualTheme":"MAGIC_CORE_IGNITION"
}$json$::jsonb,true,NULL
FROM public.arcade_games g WHERE g.code='pure_reaction_02'
ON CONFLICT(game_id,version_code) DO UPDATE SET config=EXCLUDED.config,is_active=true;

INSERT INTO public.arcade_verification_game_configs(game_id,is_enabled,target_rank_count,threshold_percent,max_attempts)
SELECT id,true,10,80,3 FROM public.arcade_games WHERE code='pure_reaction_02'
ON CONFLICT(game_id) DO UPDATE SET is_enabled=true,target_rank_count=10,threshold_percent=80,max_attempts=3,updated_at=now();

DO $$
BEGIN
  IF to_regclass('public.arcade_analytics_game_semantics') IS NOT NULL THEN
    INSERT INTO public.arcade_analytics_game_semantics(game_id,comparison_mode,notes)
    SELECT id,'HIGHER_SCORE_BETTER','Pure Reaction #02 uses inverse-square SCORE; higher official_score ranks better.'
    FROM public.arcade_games WHERE code='pure_reaction_02'
    ON CONFLICT(game_id) DO UPDATE SET comparison_mode='HIGHER_SCORE_BETTER',notes=EXCLUDED.notes,updated_at=now();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.arcade_pure_reaction_02_waits(p_seed bigint,p_config jsonb)
RETURNS TABLE(trial_index integer,wait_ms integer)
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=public,pg_temp
AS $$
DECLARE
  v_state bigint:=p_seed;
  v_min integer;
  v_max integer;
  v_count integer;
  v_i integer;
BEGIN
  IF p_seed NOT BETWEEN 1 AND 4294967295 OR jsonb_typeof(p_config)<>'object' THEN
    RAISE EXCEPTION '[ARCADE GAME02] invalid wait generator arguments.' USING ERRCODE='P0192';
  END IF;
  v_min:=(p_config->>'waitMinMs')::integer;
  v_max:=(p_config->>'waitMaxMs')::integer;
  v_count:=(p_config->>'trialCount')::integer;
  IF v_min<>1500 OR v_max<>4500 OR v_count<>5 THEN
    RAISE EXCEPTION '[ARCADE GAME02] v0.1 wait configuration mismatch.' USING ERRCODE='P0193';
  END IF;
  FOR v_i IN 0..v_count-1 LOOP
    v_state:=public.arcade_xorshift32_next(v_state);
    trial_index:=v_i;
    wait_ms:=v_min+(v_state % (v_max-v_min+1))::integer;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_validate_pure_reaction_02_submission(
  p_seed bigint,p_config jsonb,p_input_events jsonb,p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_event record;
  v_key text;
  v_times integer[]:=ARRAY[]::integer[];
  v_sources text[]:=ARRAY[]::text[];
  v_event_count integer:=0;
  v_prev integer:=-1;
  v_time_text text;
  v_source text;
  v_waits integer[]:=ARRAY[]::integer[];
  v_wait record;
  v_input_index integer:=1;
  v_trial integer;
  v_cursor integer:=0;
  v_signal integer;
  v_input integer;
  v_reaction integer;
  v_reactions integer[]:=ARRAY[]::integer[];
  v_sum integer:=0;
  v_avg_x10 integer;
  v_score bigint;
  v_official_duration integer;
  v_min_reaction integer;
  v_timeout integer;
  v_feedback integer;
  v_max_elapsed integer;
  v_end_tolerance integer;
BEGIN
  IF jsonb_typeof(p_config)<>'object' OR p_config->>'game_code'<>'pure_reaction_02' THEN
    RAISE EXCEPTION '[ARCADE GAME02] rule configuration is invalid.' USING ERRCODE='P0194';
  END IF;
  v_min_reaction:=(p_config->>'minValidReactionMs')::integer;
  v_timeout:=(p_config->>'responseTimeoutMs')::integer;
  v_feedback:=(p_config->>'interTrialFeedbackMs')::integer;
  v_max_elapsed:=coalesce((p_config->>'max_client_elapsed_ms')::integer,60000);
  v_end_tolerance:=coalesce((p_config->>'client_end_tolerance_ms')::integer,2000);
  IF v_min_reaction<>120 OR v_timeout<>3000 OR v_feedback<>700 OR (p_config->>'trialCount')::integer<>5 THEN
    RAISE EXCEPTION '[ARCADE GAME02] v0.1 configuration mismatch.' USING ERRCODE='P0194';
  END IF;
  IF jsonb_typeof(p_input_events)<>'array' THEN
    RETURN jsonb_build_object('valid',false,'code','INPUT_EVENTS_NOT_ARRAY','message','입력 기록 형식이 올바르지 않습니다.');
  END IF;
  IF p_client_game_over_elapsed_ms IS NULL OR p_client_game_over_elapsed_ms NOT BETWEEN 0 AND v_max_elapsed THEN
    RETURN jsonb_build_object('valid',false,'code','ELAPSED_OUT_OF_RANGE','message','게임 시간 기록이 허용 범위를 벗어났습니다.');
  END IF;

  FOR v_event IN SELECT value,ordinality FROM jsonb_array_elements(p_input_events) WITH ORDINALITY LOOP
    v_event_count:=v_event_count+1;
    IF v_event_count>5 OR jsonb_typeof(v_event.value)<>'object' THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_INVALID','message','입력 기록이 너무 많거나 형식이 올바르지 않습니다.');
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_event.value) LOOP
      IF v_key NOT IN ('elapsed_ms','source') THEN
        RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_EXTRA_FIELD','message','허용되지 않은 입력 기록 항목이 있습니다.');
      END IF;
    END LOOP;
    IF NOT(v_event.value?'elapsed_ms') OR NOT(v_event.value?'source')
       OR jsonb_typeof(v_event.value->'elapsed_ms')<>'number' OR jsonb_typeof(v_event.value->'source')<>'string' THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_SHAPE','message','입력 기록 형식이 올바르지 않습니다.');
    END IF;
    v_time_text:=v_event.value->>'elapsed_ms'; v_source:=v_event.value->>'source';
    IF v_time_text!~'^[0-9]+$' OR char_length(v_time_text)>7 OR v_source NOT IN('SPACE','POINTER') THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_VALUE','message','입력 시간 또는 입력 방식이 올바르지 않습니다.');
    END IF;
    IF v_time_text::integer<=v_prev OR v_time_text::integer>p_client_game_over_elapsed_ms THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_ORDER','message','입력 시간 순서가 올바르지 않습니다.');
    END IF;
    v_prev:=v_time_text::integer;
    v_times:=array_append(v_times,v_prev); v_sources:=array_append(v_sources,v_source);
  END LOOP;

  FOR v_wait IN SELECT * FROM public.arcade_pure_reaction_02_waits(p_seed,p_config) ORDER BY trial_index LOOP
    v_waits:=array_append(v_waits,v_wait.wait_ms);
  END LOOP;
  IF array_length(v_waits,1) IS DISTINCT FROM 5 THEN RAISE EXCEPTION '[ARCADE GAME02] deterministic wait generation failed.'; END IF;

  FOR v_trial IN 1..5 LOOP
    v_signal:=v_cursor+v_waits[v_trial];
    IF v_input_index<=v_event_count THEN v_input:=v_times[v_input_index]; ELSE v_input:=NULL; END IF;

    IF v_input IS NOT NULL AND v_input<v_signal THEN
      IF p_client_game_over_elapsed_ms < v_input OR p_client_game_over_elapsed_ms > v_input+v_end_tolerance THEN
        RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
      END IF;
      RETURN jsonb_build_object('valid',false,'terminal',true,'code','FALSE_START_PRE_SIGNAL','message','부정 출발로 실격당했습니다. 신호가 나오기 전에 입력했습니다.','official_duration_ms',v_input);
    END IF;

    IF v_input IS NULL OR v_input>=v_signal+v_timeout THEN
      v_official_duration:=v_signal+v_timeout;
      IF p_client_game_over_elapsed_ms < v_official_duration OR p_client_game_over_elapsed_ms > v_official_duration+v_end_tolerance THEN
        RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
      END IF;
      RETURN jsonb_build_object('valid',false,'terminal',true,'code','REACTION_TIMEOUT','message','반응 실패. 제한 시간 안에 반응하지 못했습니다.','official_duration_ms',v_official_duration);
    END IF;

    v_reaction:=v_input-v_signal;
    IF v_reaction<v_min_reaction THEN
      IF p_client_game_over_elapsed_ms < v_input OR p_client_game_over_elapsed_ms > v_input+v_end_tolerance THEN
        RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
      END IF;
      RETURN jsonb_build_object('valid',false,'terminal',true,'code','FALSE_START_UNDER_120MS','message','부정 출발로 실격당했습니다. 정상 반응 범위보다 지나치게 빠른 입력이 감지되었습니다.','official_duration_ms',v_input);
    END IF;

    v_reactions:=array_append(v_reactions,v_reaction); v_sum:=v_sum+v_reaction; v_input_index:=v_input_index+1;
    IF v_trial<5 THEN v_cursor:=v_input+v_feedback; ELSE v_official_duration:=v_input; END IF;
  END LOOP;

  IF v_input_index<=v_event_count THEN
    RETURN jsonb_build_object('valid',false,'code','INPUT_AFTER_GAME_OVER','message','게임 종료 뒤의 입력 기록이 감지되었습니다.');
  END IF;
  IF p_client_game_over_elapsed_ms < v_official_duration OR p_client_game_over_elapsed_ms > v_official_duration+v_end_tolerance THEN
    RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
  END IF;

  v_avg_x10:=v_sum*2;
  v_score:=floor(25000000000::numeric/(v_sum::numeric*v_sum::numeric))::bigint;
  RETURN jsonb_build_object(
    'valid',true,'official_score',v_score,'official_duration_ms',v_official_duration,
    'stats',jsonb_build_object(
      'trial_reaction_ms',to_jsonb(v_reactions),'sum_reaction_ms',v_sum,'average_reaction_ms_x10',v_avg_x10,
      'best_reaction_ms',(SELECT min(x) FROM unnest(v_reactions) x),'worst_reaction_ms',(SELECT max(x) FROM unnest(v_reactions) x)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_submit_pure_reaction_02_run(p_run_id bigint,p_input_events jsonb,p_client_game_over_elapsed_ms integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_validation jsonb;
  v_submitted_at timestamptz:=clock_timestamp();
  v_server_elapsed_ms integer;
  v_server_tolerance_ms integer;
  v_payload_hash text;
  v_input_event_count integer;
  v_capture jsonb;
BEGIN
  SELECT run.* INTO v_run FROM public.arcade_runs run WHERE run.id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE='P0199';
  END IF;
  IF v_run.status<>'PLAYING' OR v_run.play_started_at IS NULL THEN RAISE EXCEPTION '[ARCADE] this run is not ready for submission.' USING ERRCODE='P0202'; END IF;
  SELECT config INTO v_config FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
  IF v_config->>'game_code'<>'pure_reaction_02' THEN RAISE EXCEPTION '[ARCADE GAME02] this run does not use Game #02 rules.' USING ERRCODE='P0203'; END IF;

  IF p_input_events IS NULL OR jsonb_typeof(p_input_events)<>'array' OR jsonb_array_length(p_input_events)>5 THEN
    UPDATE public.arcade_runs SET status='REJECTED',submitted_at=v_submitted_at,rejection_code='INPUT_EVENTS_INVALID',rejection_reason='입력 기록 형식이 올바르지 않습니다.' WHERE id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','INPUT_EVENTS_INVALID','message','입력 기록 형식이 올바르지 않습니다.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;
  v_input_event_count:=jsonb_array_length(p_input_events);
  UPDATE public.arcade_runs SET status='SUBMITTING',submitted_at=v_submitted_at WHERE id=v_run.id;
  v_validation:=public.arcade_validate_pure_reaction_02_submission(v_run.schedule_seed,v_config,p_input_events,p_client_game_over_elapsed_ms);
  v_payload_hash:=public.arcade_sha256_hex(p_input_events::text||'|'||coalesce(p_client_game_over_elapsed_ms::text,''));
  INSERT INTO public.arcade_run_submissions(run_id,input_events,input_event_count,client_game_over_elapsed_ms,payload_hash,validation_metadata,submitted_at)
  VALUES(v_run.id,p_input_events,v_input_event_count,p_client_game_over_elapsed_ms,v_payload_hash,v_validation,v_submitted_at);

  IF coalesce((v_validation->>'valid')::boolean,false) IS NOT TRUE THEN
    UPDATE public.arcade_runs SET status='REJECTED',game_over_at=CASE WHEN (v_validation->>'terminal')::boolean IS TRUE AND v_validation?'official_duration_ms' THEN v_run.play_started_at+((v_validation->>'official_duration_ms')::integer*interval '1 millisecond') ELSE NULL END,
      rejection_code=coalesce(v_validation->>'code','VALIDATION_FAILED'),rejection_reason=coalesce(v_validation->>'message','게임 기록을 검증하지 못했습니다.') WHERE id=v_run.id RETURNING * INTO v_run;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'run_id',v_run.id,'code',v_run.rejection_code,'message',v_run.rejection_reason,'run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  v_server_elapsed_ms:=floor(extract(epoch FROM(v_submitted_at-v_run.play_started_at))*1000)::integer;
  v_server_tolerance_ms:=coalesce((v_config->>'server_elapsed_tolerance_ms')::integer,10000);
  IF v_server_elapsed_ms < (v_validation->>'official_duration_ms')::integer-2000 OR v_server_elapsed_ms > (v_validation->>'official_duration_ms')::integer+v_server_tolerance_ms THEN
    UPDATE public.arcade_runs SET status='REJECTED',rejection_code='SERVER_TIME_MISMATCH',rejection_reason='서버 시간과 게임 진행 시간이 크게 달라 공식 기록으로 인정되지 않았습니다.' WHERE id=v_run.id RETURNING * INTO v_run;
    UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_elapsed_ms',v_server_elapsed_ms,'server_time_valid',false) WHERE run_id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','SERVER_TIME_MISMATCH','message','게임 시간 검증에 실패했습니다. 다시 시도해 주세요.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  UPDATE public.arcade_runs SET status='VERIFIED',game_over_at=v_run.play_started_at+((v_validation->>'official_duration_ms')::integer*interval '1 millisecond'),verified_at=v_submitted_at,
    official_score=(v_validation->>'official_score')::bigint,official_duration_ms=(v_validation->>'official_duration_ms')::integer,stats=v_validation->'stats',rejection_code=NULL,rejection_reason=NULL
  WHERE id=v_run.id RETURNING * INTO v_run;
  UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_elapsed_ms',v_server_elapsed_ms,'server_time_valid',true) WHERE run_id=v_run.id;
  IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
  RETURN jsonb_build_object('accepted',true,'run_id',v_run.id,'official_score',v_run.official_score,'official_duration_ms',v_run.official_duration_ms,'game_over_at',v_run.game_over_at,'stats',v_run.stats,'run_context',v_run.run_context,'verification_capture',v_capture);
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_pure_reaction_02_waits(bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_validate_pure_reaction_02_submission(bigint,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.student_submit_pure_reaction_02_run(bigint,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_submit_pure_reaction_02_run(bigint,jsonb,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(
  p_game_code text,
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_result jsonb;
BEGIN
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE='P0204';
  END IF;

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
    AND classroom_id = v_classroom_id;

  IF NOT FOUND
     OR v_period.status NOT IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED') THEN
    RAISE EXCEPTION '[ARCADE] ranking period was not found or is not visible.'
      USING ERRCODE='P0205';
  END IF;

  SELECT id
  INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206';
  END IF;

  WITH
  ranks AS (
    SELECT *
    FROM public.arcade_resolve_period_student_ranks(
      v_classroom_id,
      v_period.id,
      v_game_id
    )
  ),
  standard_candidates AS (
    SELECT
      r.student_id,
      r.official_score,
      r.game_over_at,
      r.id AS source_run_id,
      row_number() OVER (
        PARTITION BY r.student_id
        ORDER BY r.official_score DESC, r.game_over_at ASC, r.id ASC
      ) AS student_best_row
    FROM public.arcade_runs r
    WHERE r.classroom_id = v_classroom_id
      AND r.game_id = v_game_id
      AND r.run_context = 'STANDARD'
      AND r.status = 'VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id = r.id
          AND m.event_kind = 'INVALIDATE'
      )
  ),
  general_scores AS (
    SELECT
      c.student_id,
      c.official_score AS general_score,
      c.game_over_at AS general_achieved_at,
      c.source_run_id AS general_source_run_id
    FROM standard_candidates c
    WHERE c.student_best_row = 1
  ),
  decorated AS (
    SELECT
      r.rank,
      r.student_id,
      s.name AS student_name,
      r.official_score,
      COALESCE(gs.general_score, r.official_score) AS general_score,
      CASE
        WHEN o.id IS NOT NULL AND o.ranking_eligible
          THEN o.official_score
        ELSE NULL
      END AS certified_score,
      CASE
        WHEN v_period.period_kind <> 'MONTHLY'
          OR v_period.status = 'ACTIVE'
          THEN 'NONE'
        WHEN o.id IS NOT NULL AND o.ranking_eligible
          THEN 'CERTIFIED'
        WHEN o.id IS NOT NULL AND NOT o.ranking_eligible
          THEN 'FAILED'
        WHEN r.rank <= 10
          THEN 'PENDING'
        ELSE 'NONE'
      END AS certification_status,
      r.achieved_at AS game_over_at,
      CASE WHEN p_game_code='pure_reaction_02' THEN nullif(source_run.stats->>'average_reaction_ms_x10','')::integer ELSE NULL END AS average_reaction_ms_x10
    FROM ranks r
    JOIN public.students s
      ON s.id = r.student_id
    LEFT JOIN public.arcade_runs source_run
      ON source_run.id = r.source_run_id
    LEFT JOIN general_scores gs
      ON gs.student_id = r.student_id
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id = v_period.id
     AND o.game_id = v_game_id
     AND o.student_id = r.student_id
  ),
  guild_aggregate AS (
    SELECT
      g.id AS guild_id,
      g.name AS guild_name,
      g.logo_url AS guild_logo_url,
      count(gm.student_id)::integer AS member_count,
      count(gs.student_id)::integer AS participant_count,
      count(o.student_id) FILTER (
        WHERE o.ranking_eligible
          AND o.official_score IS NOT NULL
      )::integer AS certified_count,
      COALESCE(sum(gs.general_score), 0)::bigint AS general_total,
      COALESCE(sum(
        CASE
          WHEN o.ranking_eligible THEN o.official_score
          ELSE 0
        END
      ), 0)::bigint AS certified_total
    FROM public.guilds g
    LEFT JOIN public.guild_members gm
      ON gm.guild_id = g.id
     AND gm.left_at IS NULL
     AND public.is_official_participant(gm.student_id)
    LEFT JOIN general_scores gs
      ON gs.student_id = gm.student_id
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id = v_period.id
     AND o.game_id = v_game_id
     AND o.student_id = gm.student_id
    WHERE g.classroom_id = v_classroom_id
      AND g.is_active
    GROUP BY g.id, g.name, g.logo_url
  ),
  guild_ranked AS (
    SELECT
      row_number() OVER (
        ORDER BY ga.general_total DESC, ga.certified_total DESC, ga.guild_id ASC
      )::integer AS rank,
      ga.*
    FROM guild_aggregate ga
  )
  SELECT jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank', d.rank,
            'student_id', d.student_id,
            'student_name', d.student_name,
            'official_score', d.official_score,
            'general_score', d.general_score,
            'certified_score', d.certified_score,
            'certification_status', d.certification_status,
            'game_over_at', d.game_over_at,
            'average_reaction_ms_x10', d.average_reaction_ms_x10
          )
          ORDER BY d.rank
        )
        FROM decorated d
        WHERE d.rank <= 10
      ),
      '[]'::jsonb
    ),
    'guild_totals', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank', gr.rank,
            'guild_id', gr.guild_id,
            'guild_name', gr.guild_name,
            'guild_logo_url', gr.guild_logo_url,
            'member_count', gr.member_count,
            'participant_count', gr.participant_count,
            'certified_count', gr.certified_count,
            'general_total', gr.general_total,
            'certified_total', gr.certified_total
          )
          ORDER BY gr.rank
        )
        FROM guild_ranked gr
      ),
      '[]'::jsonb
    ),
    'my_rank', (
      SELECT d.rank
      FROM decorated d
      WHERE d.student_id = v_student_id
      LIMIT 1
    ),
    'my_score', (
      SELECT d.official_score
      FROM decorated d
      WHERE d.student_id = v_student_id
      LIMIT 1
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;


REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text,bigint) TO authenticated;

COMMIT;
