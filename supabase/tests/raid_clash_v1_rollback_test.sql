-- B.R.A.N.D 2.0 — Raid CLASH V1 server test (ROLLBACK SANDBOX)
-- Run AFTER the migration text in the SAME query string.
-- The final RAISE aborts the whole transaction: nothing (migration, test raids, results) is kept.
-- Uses classroom 5 (B.R.A.N.D LOADTEST: no live raid) students and its teacher.
-- A classroom may have only one live raid, so each new test raid first parks the previous test raid (rolled back anyway).

CREATE FUNCTION pg_temp.t_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

CREATE FUNCTION pg_temp.t_taps(p_n integer, p_x numeric, p_y numeric) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('x', p_x, 'y', p_y)) FROM generate_series(1, p_n);
$f$;

CREATE FUNCTION pg_temp.t_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLERRM; END $f$;

CREATE FUNCTION pg_temp.t_mk_raid(p_title text, p_max bigint, p_hp bigint, p_bmax bigint, p_bcur bigint,
                                  p_clash boolean, p_difficulty text, p_teacher uuid, p_students integer[], p_activate boolean DEFAULT true)
RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'CLASH 테스트 보스','FIRE',p_max,p_hp,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
  -- 기본 패턴(자동 생성)은 끄기만 한다(삭제 없음) → 테스트 중 저절로 발동하지 않게
  UPDATE public.raid_patterns SET is_enabled = false WHERE raid_id = v;
  INSERT INTO public.raid_combat_configs(raid_id) VALUES (v) ON CONFLICT (raid_id) DO NOTHING;
  UPDATE public.raid_combat_configs SET enabled = true, boss_attack_interval_seconds = 10, boss_attack_fixed_damage = 0, boss_attack_barrier_ratio = 0.04 WHERE raid_id = v;
  INSERT INTO public.raid_phases(raid_id, phase_no, hp_from_ratio, hp_to_ratio) VALUES (v, 1, 1.0, 0);
  INSERT INTO public.raid_combat_states(raid_id, barrier_max_hp, barrier_current_hp, next_boss_attack_at)
  VALUES (v, p_bmax, p_bcur, clock_timestamp() + interval '30 seconds')
  ON CONFLICT (raid_id) DO UPDATE SET barrier_max_hp = excluded.barrier_max_hp, barrier_current_hp = excluded.barrier_current_hp, next_boss_attack_at = excluded.next_boss_attack_at;
  INSERT INTO public.raid_participants(raid_id,student_id,snapshot_student_name,snapshot_owned_shard_count,snapshot_raid_power,
         snapshot_base_crit_bp,snapshot_shard_crit_bp,snapshot_collection_crit_bp,snapshot_final_crit_bp,snapshot_element_power)
  SELECT v, s, '테스트학생' || s, 0, 1000, 0, 0, 0, 0, '{}'::jsonb FROM unnest(p_students) s;
  IF p_clash THEN
    PERFORM pg_temp.t_as(p_teacher);
    PERFORM public.teacher_save_raid_clash_config(v, jsonb_build_object('enabled', true, 'difficulty', p_difficulty));
  END IF;
  IF p_activate THEN
    UPDATE public.raids SET status = 'FAILED' WHERE classroom_id = 5 AND id <> v AND title LIKE 'CLASH-%' AND status IN ('LOBBY_OPEN','ACTIVE','PAUSED');
    UPDATE public.raids SET status = 'ACTIVE', starts_at = clock_timestamp() WHERE id = v;
  END IF;
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.t_part(p_raid bigint, p_student integer) RETURNS bigint LANGUAGE sql AS $f$
  SELECT id FROM public.raid_participants WHERE raid_id = p_raid AND student_id = p_student;
$f$;

-- put note i "right now" for the selected student, then submit
CREATE FUNCTION pg_temp.t_note(p_raid bigint, p_uid uuid, p_index integer, p_key text, p_offset integer, p_delta_ms integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_s public.raid_clash_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid;
  UPDATE public.raid_clash_sessions
     SET play_starts_at = clock_timestamp() - make_interval(secs => ((public.raid_clash_ideal_ms(config, p_index) + p_offset + p_delta_ms)::numeric/1000.0)::double precision),
         play_deadline_at = clock_timestamp() + interval '60 seconds'
   WHERE raid_id = p_raid;
  PERFORM pg_temp.t_as(p_uid);
  RETURN public.student_submit_raid_clash_input(p_raid, p_index, COALESCE(p_key, v_s.note_keys[p_index + 1]), p_offset);
END $f$;

CREATE FUNCTION pg_temp.t_wrong_key(p_key text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE p_key WHEN 'KeyQ' THEN 'KeyW' ELSE 'KeyQ' END;
$f$;

DO $test$
DECLARE
  r jsonb := '[]'::jsonb;
  v_teacher uuid; v_uid uuid[]; v_sid integer[];
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint; v_f bigint; v_g bigint; v_h bigint;
  v_res jsonb; v_res2 jsonb; v_s public.raid_clash_sessions%ROWTYPE; v_txt text; v_batch uuid;
  v_next_before timestamptz; v_run_end_before timestamptz; v_run bigint; v_pat bigint;
  v_sel_uid uuid; v_sel_idx integer; v_other_uid uuid; v_bar bigint; v_cnt integer; v_now timestamptz;
  v_fail jsonb; v_pass integer;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 5) s;

  -- ============ A. failure path, freeze, volunteers, pause guard, penalty, timeline shift ============
  v_a := pg_temp.t_mk_raid('CLASH-A', 100000, 53000, 1000000, 400000, true, 'EASY', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.submit_raid_tap_batch(v_a, gen_random_uuid(), pg_temp.t_taps(10, 0.05, 0.95));
  r := r || jsonb_build_object('t','A1 crossing tap accepted, rest rejected','ok', (v_res->>'accepted')::int = 3 AND (v_res->>'raid_hp')::bigint = 50000
        AND (v_res->>'clash_triggered')::boolean AND v_res->'results'->3->>'reason' = 'CLASH','d', v_res - 'results');
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A1 session VOLUNTEERING','ok', v_s.phase = 'VOLUNTEERING' AND array_length(v_s.note_keys,1) = 8, 'd', v_s.phase);

  PERFORM pg_temp.t_as(v_uid[2]);
  v_batch := gen_random_uuid();
  v_res := public.submit_raid_tap_batch(v_a, v_batch, pg_temp.t_taps(5, 0.05, 0.95));
  v_res2 := public.submit_raid_tap_batch(v_a, v_batch, pg_temp.t_taps(5, 0.05, 0.95));
  r := r || jsonb_build_object('t','A2 frozen: no damage, idempotent','ok', (v_res->>'accepted')::int = 0 AND (v_res->>'clash_active')::boolean
        AND (SELECT current_hp FROM public.raids WHERE id = v_a) = 50000 AND v_res2 = v_res, 'd', v_res - 'results');

  UPDATE public.raid_combat_states SET next_boss_attack_at = clock_timestamp() - interval '1 second', last_tick_at = clock_timestamp() - interval '10 seconds' WHERE raid_id = v_a;
  v_res := public.raid_combat_tick(v_a);
  r := r || jsonb_build_object('t','A3 tick frozen: no boss attack','ok', v_res->>'reason' = 'CLASH_FROZEN'
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_a) = 400000, 'd', v_res);

  -- timers that must be shifted exactly once on resume
  INSERT INTO public.raid_patterns(raid_id,seq,name,pattern_type,trigger_kind,trigger_value,duration_seconds,config)
  VALUES (v_a, 901, 'T 약점', 'WEAK_POINT', 'MANUAL', 0, 30, '{}'::jsonb) RETURNING id INTO v_pat;
  INSERT INTO public.raid_pattern_runs(raid_id,pattern_id,started_at,ends_at,status,state)
  VALUES (v_a, v_pat, clock_timestamp(), clock_timestamp() + interval '20 seconds', 'ACTIVE', '{"x":0.0,"y":0.8,"width":0.2,"height":0.2,"multiplier":2,"body_multiplier":1}'::jsonb)
  RETURNING id, ends_at INTO v_run, v_run_end_before;
  UPDATE public.raid_combat_states SET active_pattern_run_id = v_run, next_boss_attack_at = clock_timestamp() + interval '3 seconds' WHERE raid_id = v_a
  RETURNING next_boss_attack_at INTO v_next_before;

  PERFORM pg_temp.t_as(v_uid[1]); v_res := public.student_volunteer_raid_clash(v_a);
  v_res2 := public.student_volunteer_raid_clash(v_a);
  PERFORM pg_temp.t_as(v_uid[2]); PERFORM public.student_volunteer_raid_clash(v_a);
  UPDATE public.raid_participants SET attack_blocked = true WHERE id = pg_temp.t_part(v_a, v_sid[3]);
  PERFORM pg_temp.t_as(v_uid[3]); v_txt := public.student_volunteer_raid_clash(v_a)->>'reason';
  SELECT count(*) INTO v_cnt FROM public.raid_clash_volunteers WHERE session_id = v_s.id;
  r := r || jsonb_build_object('t','A4 volunteers dedupe + blocked','ok', (v_res->>'accepted')::boolean AND (v_res2->>'accepted')::boolean
        AND v_cnt = 2 AND v_txt = 'ATTACK_BLOCKED', 'd', jsonb_build_object('count', v_cnt, 'blocked_reason', v_txt));

  PERFORM pg_temp.t_as(v_teacher);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pause_raid(%s)', v_a));
  r := r || jsonb_build_object('t','A5 teacher pause blocked during clash','ok', v_txt LIKE 'ERR:%격돌%', 'd', v_txt);

  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_a;
  PERFORM pg_temp.t_as(v_uid[4]); v_txt := public.student_volunteer_raid_clash(v_a)->>'reason';
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A6 selected one of the volunteers','ok', v_s.phase = 'SELECTED' AND v_txt = 'NOT_VOLUNTEERING'
        AND v_s.selected_participant_id IN (pg_temp.t_part(v_a, v_sid[1]), pg_temp.t_part(v_a, v_sid[2])), 'd', v_s.phase);
  v_sel_idx := CASE WHEN v_s.selected_participant_id = pg_temp.t_part(v_a, v_sid[1]) THEN 1 ELSE 2 END;
  v_sel_uid := v_uid[v_sel_idx]; v_other_uid := v_uid[3 - v_sel_idx];

  PERFORM pg_temp.t_as(v_other_uid); v_txt := public.student_ready_raid_clash(v_a)->>'reason';
  PERFORM pg_temp.t_as(v_sel_uid); v_res := public.student_ready_raid_clash(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A7 ready only by selected; reveal kept','ok', v_txt = 'NOT_SELECTED' AND (v_res->>'accepted')::boolean
        AND v_s.phase = 'PLAYING' AND v_s.play_starts_at >= v_s.selected_at + interval '2.5 seconds', 'd', v_s.phase);

  v_res := pg_temp.t_note(v_a, v_sel_uid, 0, NULL, 0);
  v_res2 := pg_temp.t_note(v_a, v_sel_uid, 0, NULL, 300);
  r := r || jsonb_build_object('t','A8 note0 PERFECT, duplicate ignored','ok', v_res->>'judgment' = 'PERFECT' AND (v_res2->>'duplicate')::boolean
        AND (v_res2->>'points')::int = 2, 'd', jsonb_build_object('j', v_res->>'judgment', 'dup', v_res2->>'judgment'));
  PERFORM pg_temp.t_as(v_other_uid);
  v_txt := public.student_submit_raid_clash_input(v_a, 1, 'KeyQ', 0)->>'reason';
  r := r || jsonb_build_object('t','A8 non-selected input rejected','ok', v_txt = 'NOT_SELECTED', 'd', v_txt);
  v_res := pg_temp.t_note(v_a, v_sel_uid, 1, NULL, 150);   r := r || jsonb_build_object('t','A8 150ms GOOD','ok', v_res->>'judgment' = 'GOOD', 'd', v_res->>'judgment');
  v_res := pg_temp.t_note(v_a, v_sel_uid, 2, NULL, 300);   r := r || jsonb_build_object('t','A8 300ms BAD','ok', v_res->>'judgment' = 'BAD', 'd', v_res->>'judgment');
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  v_res := pg_temp.t_note(v_a, v_sel_uid, 3, pg_temp.t_wrong_key(v_s.note_keys[4]), 0);
  r := r || jsonb_build_object('t','A8 wrong key MISS','ok', v_res->>'judgment' = 'MISS' AND v_res->>'flag' = 'WRONG_KEY', 'd', v_res->>'flag');
  PERFORM pg_temp.t_as(v_sel_uid);
  v_res := public.student_submit_raid_clash_input(v_a, 4, NULL, NULL);
  r := r || jsonb_build_object('t','A8 client miss','ok', v_res->>'judgment' = 'MISS', 'd', v_res->>'judgment');
  v_res := pg_temp.t_note(v_a, v_sel_uid, 5, NULL, 100);   r := r || jsonb_build_object('t','A8 100ms = PERFECT edge','ok', v_res->>'judgment' = 'PERFECT', 'd', v_res->>'judgment');
  v_res := pg_temp.t_note(v_a, v_sel_uid, 6, NULL, -101);  r := r || jsonb_build_object('t','A8 -101ms GOOD','ok', v_res->>'judgment' = 'GOOD', 'd', v_res->>'judgment');
  v_res := pg_temp.t_note(v_a, v_sel_uid, 7, NULL, 230);   r := r || jsonb_build_object('t','A8 230ms = GOOD edge','ok', v_res->>'judgment' = 'GOOD', 'd', v_res->>'judgment');

  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A9 score 7 -> FAILED','ok', v_s.phase = 'RESOLVED' AND v_s.score = 7 AND v_s.outcome = 'FAILED', 'd', jsonb_build_object('phase',v_s.phase,'score',v_s.score,'outcome',v_s.outcome));
  r := r || jsonb_build_object('t','A9 penalty = 20% of current (400000 -> 320000)','ok', v_s.barrier_penalty_amount = 80000
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_a) = 320000, 'd', v_s.barrier_penalty_amount);
  r := r || jsonb_build_object('t','A9 timers shifted once by freeze length','ok',
        abs(EXTRACT(EPOCH FROM ((SELECT next_boss_attack_at FROM public.raid_combat_states WHERE raid_id = v_a) - v_next_before)) - v_s.frozen_seconds) < 0.01
        AND abs(EXTRACT(EPOCH FROM ((SELECT ends_at FROM public.raid_pattern_runs WHERE id = v_run) - v_run_end_before)) - v_s.frozen_seconds) < 0.01,
        'd', jsonb_build_object('frozen', v_s.frozen_seconds));
  r := r || jsonb_build_object('t','A9 no buff after failure','ok', v_s.buff_until IS NULL AND v_s.clash_component = 0, 'd', v_s.clash_component);

  UPDATE public.raid_combat_states SET last_tick_at = clock_timestamp() - interval '10 seconds', next_boss_attack_at = clock_timestamp() + interval '60 seconds' WHERE raid_id = v_a;
  PERFORM pg_temp.t_as(v_uid[1]); v_res := public.raid_combat_tick(v_a);
  PERFORM public.raid_clash_advance(v_a);
  r := r || jsonb_build_object('t','A10 no double penalty after resolve','ok', COALESCE(v_res->>'reason','') <> 'CLASH_FROZEN'
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_a) = 320000, 'd', v_res->>'reason');
  UPDATE public.raid_combat_states SET active_pattern_run_id = NULL WHERE raid_id = v_a;
  UPDATE public.raid_pattern_runs SET status = 'SUCCESS' WHERE id = v_run;
  PERFORM pg_temp.t_as(v_uid[4]);
  v_res := public.submit_raid_tap_batch(v_a, gen_random_uuid(), pg_temp.t_taps(3, 0.05, 0.95));
  r := r || jsonb_build_object('t','A10 attacks resume at 1.0x, no second clash','ok', (v_res->>'accepted')::int = 3 AND (v_res->'results'->0->>'damage')::int = 1000
        AND (SELECT count(*) FROM public.raid_clash_sessions WHERE raid_id = v_a) = 1, 'd', v_res - 'results');
  PERFORM pg_temp.t_as(v_teacher);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pause_raid(%s)', v_a));
  r := r || jsonb_build_object('t','A11 pause allowed after clash','ok', v_txt = 'OK' AND (SELECT status FROM public.raids WHERE id = v_a) = 'PAUSED', 'd', v_txt);
  PERFORM public.teacher_resume_raid(v_a);

  -- broadcast + battle state
  v_res := public.teacher_get_raid_broadcast_state(v_a);
  PERFORM pg_temp.t_as(v_uid[1]); v_res2 := public.get_raid_battle_state(v_a);
  r := r || jsonb_build_object('t','A12 broadcast/battle state carry clash','ok', v_res->'clash'->'session'->>'outcome' = 'FAILED'
        AND v_res2->'clash'->'session'->>'phase' = 'RESOLVED' AND (v_res2->'me' ? 'element_multiplier_bp'), 'd', v_res2->'clash'->'session'->>'phase');

  -- ============ B. great success, damage factors, block, pause shift ============
  v_b := pg_temp.t_mk_raid('CLASH-B', 100000, 51000, 500000, 500000, true, 'EASY', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(2, 0.05, 0.95));
  PERFORM public.student_volunteer_raid_clash(v_b);
  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_b;
  UPDATE public.raid_combat_states SET last_tick_at = clock_timestamp() - interval '10 seconds' WHERE raid_id = v_b;
  v_res := public.raid_combat_tick(v_b);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  r := r || jsonb_build_object('t','B1 single volunteer is selected (via tick)','ok', v_s.phase = 'SELECTED' AND v_s.selected_participant_id = pg_temp.t_part(v_b, v_sid[1]), 'd', v_s.phase);
  PERFORM public.student_ready_raid_clash(v_b);
  FOR i IN 0..7 LOOP v_res := pg_temp.t_note(v_b, v_uid[1], i, NULL, 0); END LOOP;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  r := r || jsonb_build_object('t','B2 16 -> GREAT_SUCCESS, 10s buff, 16s block','ok', v_s.outcome = 'GREAT_SUCCESS' AND v_s.score = 16 AND v_s.clash_component = 3.0
        AND abs(EXTRACT(EPOCH FROM (v_s.buff_until - v_s.resolved_at)) - 10) < 0.01 AND abs(EXTRACT(EPOCH FROM (v_s.boss_attack_block_until - v_s.resolved_at)) - 16) < 0.01
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_b) = 500000
        AND (SELECT next_boss_attack_at FROM public.raid_combat_states WHERE raid_id = v_b) >= v_s.boss_attack_block_until,
        'd', jsonb_build_object('outcome', v_s.outcome, 'score', v_s.score));

  PERFORM pg_temp.t_as(v_uid[2]);
  v_res := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.50, 0.39));
  v_res2 := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  r := r || jsonb_build_object('t','B3 great: weak 5.0x / body 4.0x','ok', (v_res->'results'->0->>'damage')::int = 5000 AND (v_res2->'results'->0->>'damage')::int = 4000,
        'd', jsonb_build_object('weak', v_res->'results'->0->>'damage', 'body', v_res2->'results'->0->>'damage'));

  INSERT INTO public.raid_patterns(raid_id,seq,name,pattern_type,trigger_kind,trigger_value,duration_seconds,config)
  VALUES (v_b, 901, 'T 약점', 'WEAK_POINT', 'MANUAL', 0, 30, '{}'::jsonb) RETURNING id INTO v_pat;
  INSERT INTO public.raid_pattern_runs(raid_id,pattern_id,started_at,ends_at,status,state)
  VALUES (v_b, v_pat, clock_timestamp(), clock_timestamp() + interval '30 seconds', 'ACTIVE', '{"x":0.0,"y":0.8,"width":0.2,"height":0.2,"multiplier":2,"body_multiplier":1}'::jsonb)
  RETURNING id INTO v_run;
  UPDATE public.raid_combat_states SET active_pattern_run_id = v_run, groggy_until = clock_timestamp() + interval '20 seconds', groggy_damage_multiplier = 3 WHERE raid_id = v_b;
  PERFORM pg_temp.t_as(v_uid[3]);
  v_res := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  v_res2 := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.50, 0.39));
  r := r || jsonb_build_object('t','B4 bigger of (weak x groggy) and (weak + clash)','ok', (v_res->'results'->0->>'damage')::int = 6000 AND (v_res2->'results'->0->>'damage')::int = 5000,
        'd', jsonb_build_object('legacy_zone', v_res->'results'->0->>'damage', 'clash_zone', v_res2->'results'->0->>'damage'));

  UPDATE public.raid_combat_states SET active_pattern_run_id = NULL, groggy_until = NULL, groggy_damage_multiplier = 1 WHERE raid_id = v_b;
  UPDATE public.raid_pattern_runs SET status = 'SUCCESS' WHERE id = v_run;
  UPDATE public.raid_clash_sessions SET clash_component = 1.5 WHERE raid_id = v_b;
  PERFORM pg_temp.t_as(v_uid[4]);
  v_res := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.50, 0.39));
  v_res2 := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  r := r || jsonb_build_object('t','B5 success: weak 3.5x / body 2.5x','ok', (v_res->'results'->0->>'damage')::int = 3500 AND (v_res2->'results'->0->>'damage')::int = 2500,
        'd', jsonb_build_object('weak', v_res->'results'->0->>'damage', 'body', v_res2->'results'->0->>'damage'));

  UPDATE public.raid_combat_states SET next_boss_attack_at = clock_timestamp() - interval '1 second', last_tick_at = clock_timestamp() - interval '10 seconds' WHERE raid_id = v_b;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  PERFORM pg_temp.t_as(v_uid[1]); v_res := public.raid_combat_tick(v_b);
  r := r || jsonb_build_object('t','B6 boss basic attack blocked, next slot after block','ok', v_res->>'reason' = 'CLASH_ATTACK_BLOCKED'
        AND (SELECT next_boss_attack_at FROM public.raid_combat_states WHERE raid_id = v_b) >= v_s.boss_attack_block_until
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_b) = 500000, 'd', v_res->>'reason');

  UPDATE public.raid_clash_sessions SET buff_until = clock_timestamp() - interval '1 second' WHERE raid_id = v_b;
  PERFORM pg_temp.t_as(v_uid[5]);
  v_res := public.submit_raid_tap_batch(v_b, gen_random_uuid(), pg_temp.t_taps(1, 0.50, 0.39));
  r := r || jsonb_build_object('t','B7 buff expired -> 1.0x','ok', (v_res->'results'->0->>'damage')::int = 1000, 'd', v_res->'results'->0->>'damage');

  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_pause_raid(v_b);
  UPDATE public.raids SET metadata = jsonb_set(metadata, '{raid_pause_started_at}', to_jsonb(clock_timestamp() - interval '30 seconds')) WHERE id = v_b;
  UPDATE public.raid_clash_sessions SET buff_until = clock_timestamp() - interval '25 seconds', boss_attack_block_until = clock_timestamp() - interval '40 seconds' WHERE raid_id = v_b;
  PERFORM public.teacher_resume_raid(v_b);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  r := r || jsonb_build_object('t','B8 pause keeps remaining buff; expired block not revived','ok',
        v_s.buff_until > clock_timestamp() + interval '4 seconds' AND v_s.boss_attack_block_until < clock_timestamp(), 'd', jsonb_build_object('buff', v_s.buff_until));

  -- ============ C. no volunteer ============
  v_c := pg_temp.t_mk_raid('CLASH-C', 100000, 50500, 1000000, 100000, true, 'NORMAL', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  PERFORM public.submit_raid_tap_batch(v_c, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_c;
  UPDATE public.raid_combat_states SET last_tick_at = clock_timestamp() - interval '10 seconds' WHERE raid_id = v_c;
  PERFORM public.raid_combat_tick(v_c);
  PERFORM public.raid_clash_advance(v_c);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_c;
  r := r || jsonb_build_object('t','C1 no volunteer -> FAILED, 20% of current not of max','ok', v_s.outcome = 'FAILED' AND v_s.outcome_reason = 'NO_VOLUNTEER'
        AND v_s.barrier_penalty_amount = 20000 AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_c) = 80000
        AND (SELECT count(*) FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id) = 0, 'd', jsonb_build_object('pen', v_s.barrier_penalty_amount, 'reason', v_s.outcome_reason));

  -- ============ D. CLASH OFF: unchanged behavior ============
  v_d := pg_temp.t_mk_raid('CLASH-D', 100000, 60000, 1000000, 1000000, false, 'EASY', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.submit_raid_tap_batch(v_d, gen_random_uuid(), pg_temp.t_taps(15, 0.05, 0.95));
  UPDATE public.raid_combat_states SET groggy_until = clock_timestamp() + interval '10 seconds', groggy_damage_multiplier = 1.4 WHERE raid_id = v_d;
  PERFORM pg_temp.t_as(v_uid[2]);
  v_res2 := public.submit_raid_tap_batch(v_d, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  r := r || jsonb_build_object('t','D1 OFF: crossing 50% does nothing; groggy 1.4x intact','ok', (v_res->>'accepted')::int = 15 AND (v_res->>'raid_hp')::bigint = 45000
        AND NOT (v_res->>'clash_triggered')::boolean AND (v_res2->'results'->0->>'damage')::int = 1400
        AND NOT EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE raid_id = v_d), 'd', v_res - 'results');
  PERFORM pg_temp.t_as(v_uid[1]); v_res := public.get_raid_battle_state(v_d);
  r := r || jsonb_build_object('t','D2 OFF state: enabled false, no session','ok', NOT (v_res->'clash'->>'enabled')::boolean AND v_res->'clash'->'session' = 'null'::jsonb, 'd', v_res->'clash');

  -- ============ E. killing tap that crosses 50% ============
  v_e := pg_temp.t_mk_raid('CLASH-E', 1000, 600, 100000, 100000, true, 'EASY', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.submit_raid_tap_batch(v_e, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  r := r || jsonb_build_object('t','E1 kill wins over clash','ok', v_res->>'raid_status' = 'COMPLETED' AND NOT (v_res->>'clash_triggered')::boolean
        AND NOT EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE raid_id = v_e), 'd', v_res - 'results');

  -- ============ F. config rules ============
  v_f := pg_temp.t_mk_raid('CLASH-F', 100000, 100000, 100000, 100000, false, 'EASY', v_teacher, v_sid, false);
  INSERT INTO public.raid_patterns(raid_id,seq,name,pattern_type,trigger_kind,trigger_value,duration_seconds,config)
  VALUES (v_f, 901, '반피 패턴', 'ENRAGE', 'HP_RATIO', 0.5, 2, '{}'::jsonb);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_save_raid_clash_config(v_f, '{"enabled":true,"difficulty":"HARD"}'::jsonb);
  r := r || jsonb_build_object('t','F1 save on DRAFT + HP 45~55% warning','ok', (v_res->>'enabled')::boolean AND v_res->>'difficulty' = 'HARD'
        AND jsonb_array_length(v_res->'hp_ratio_warnings') = 1, 'd', v_res->'hp_ratio_warnings');
  UPDATE public.raid_combat_configs SET enabled = false WHERE raid_id = v_f;
  v_txt := pg_temp.t_try(format($q$SELECT public.teacher_save_raid_clash_config(%s, '{"enabled":true}'::jsonb)$q$, v_f));
  r := r || jsonb_build_object('t','F2 requires barrier','ok', v_txt LIKE 'ERR:%공명방벽%', 'd', v_txt);
  v_txt := pg_temp.t_try(format($q$SELECT public.teacher_save_raid_clash_config(%s, '{"enabled":true}'::jsonb)$q$, v_a));
  r := r || jsonb_build_object('t','F3 locked after start','ok', v_txt LIKE 'ERR:%전투 시작 전%', 'd', v_txt);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_txt := pg_temp.t_try(format($q$SELECT public.teacher_save_raid_clash_config(%s, '{"enabled":false}'::jsonb)$q$, v_f));
  r := r || jsonb_build_object('t','F4 student cannot save config','ok', v_txt LIKE 'ERR:%', 'd', v_txt);

  -- ============ G. implausible timing + teacher force finish ============
  v_g := pg_temp.t_mk_raid('CLASH-G', 100000, 50500, 1000000, 500000, true, 'HARD', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[2]);
  PERFORM public.submit_raid_tap_batch(v_g, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  PERFORM public.student_volunteer_raid_clash(v_g);
  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_g;
  PERFORM public.student_ready_raid_clash(v_g);   -- advances to SELECTED then PLAYING
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_g;
  r := r || jsonb_build_object('t','G1 ready advances selection and play','ok', v_s.phase = 'PLAYING', 'd', v_s.phase);
  v_res := pg_temp.t_note(v_g, v_uid[2], 0, NULL, 0);
  v_res := pg_temp.t_note(v_g, v_uid[2], 1, NULL, 55);
  v_res2 := pg_temp.t_note(v_g, v_uid[2], 2, NULL, 0, 10000);
  r := r || jsonb_build_object('t','G2 HARD 55ms PERFECT edge; implausible -> MISS','ok', v_res->>'judgment' = 'PERFECT' AND v_res2->>'judgment' = 'MISS'
        AND v_res2->>'flag' = 'IMPLAUSIBLE_TIMING', 'd', jsonb_build_object('edge', v_res->>'judgment', 'implausible', v_res2->>'flag'));
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_force_finish_raid_clash(v_g, 'test');
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_g;
  r := r || jsonb_build_object('t','G3 force finish: remaining MISS, scored, penalty once','ok', (v_res->>'forced')::boolean AND v_s.phase = 'RESOLVED'
        AND v_s.score = 4 AND v_s.outcome = 'FAILED' AND v_s.outcome_reason = 'FORCED'
        AND (SELECT count(*) FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id) = 8
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_g) = 400000, 'd', jsonb_build_object('score', v_s.score));

  -- ============ H. raid ended during clash -> cancelled, no effects ============
  v_h := pg_temp.t_mk_raid('CLASH-H', 100000, 50500, 1000000, 500000, true, 'EASY', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  PERFORM public.submit_raid_tap_batch(v_h, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  PERFORM pg_temp.t_as(v_teacher); PERFORM public.teacher_end_raid(v_h, 'test');
  PERFORM pg_temp.t_as(v_uid[1]); v_res := public.student_volunteer_raid_clash(v_h);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_h;
  r := r || jsonb_build_object('t','H1 raid ended -> clash cancelled, no penalty','ok', v_s.phase = 'CANCELLED'
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_h) = 500000, 'd', v_s.phase);

  -- ============ J. teacher manual trigger (test helper) ============
  v_e := pg_temp.t_mk_raid('CLASH-J', 100000, 100000, 1000000, 500000, true, 'EASY', v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_trigger_raid_clash(%s)', v_e));
  r := r || jsonb_build_object('t','J1 student cannot trigger','ok', v_txt LIKE 'ERR:%', 'd', v_txt);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_trigger_raid_clash(v_e);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_trigger_raid_clash(%s)', v_e));
  r := r || jsonb_build_object('t','J2 teacher trigger at full HP, once','ok', (v_res->>'triggered')::boolean
        AND v_res->'clash'->'session'->>'phase' = 'VOLUNTEERING' AND (SELECT current_hp FROM public.raids WHERE id = v_e) = 100000
        AND v_txt LIKE 'ERR:%이미 발동%', 'd', v_txt);
  PERFORM pg_temp.t_as(v_uid[2]);
  v_res := public.submit_raid_tap_batch(v_e, gen_random_uuid(), pg_temp.t_taps(3, 0.05, 0.95));
  r := r || jsonb_build_object('t','J3 manual clash freezes attacks too','ok', (v_res->>'accepted')::int = 0 AND (v_res->>'clash_active')::boolean, 'd', v_res - 'results');

  -- ============ I. security: anon cannot call ============
  r := r || jsonb_build_object('t','I1 anon has no EXECUTE','ok',
        NOT has_function_privilege('anon','public.student_volunteer_raid_clash(bigint)','EXECUTE')
        AND NOT has_function_privilege('anon','public.teacher_force_finish_raid_clash(bigint,text)','EXECUTE')
        AND NOT has_function_privilege('anon','public.teacher_trigger_raid_clash(bigint)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_clash_advance(bigint)','EXECUTE')
        AND NOT has_table_privilege('authenticated','public.raid_clash_sessions','SELECT'), 'd', NULL);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), COALESCE(jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean,false)), '[]'::jsonb)
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'CLASH_TEST_RESULT pass=% total=% failed=%', v_pass, jsonb_array_length(r), v_fail;
END;
$test$;
