-- B.R.A.N.D 2.0 — CLASH V4 (선생님이 격돌잡이 선택) server test (ROLLBACK SANDBOX)
-- Run AFTER the migration text in the SAME query string. The final RAISE aborts everything.

CREATE FUNCTION pg_temp.t_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

CREATE FUNCTION pg_temp.t_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM; END $f$;

CREATE FUNCTION pg_temp.t_mk(p_title text, p_students integer[]) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'CLASH4 테스트 보스','FIRE',100000,100000,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
  UPDATE public.raid_patterns SET is_enabled = false WHERE raid_id = v;
  INSERT INTO public.raid_combat_configs(raid_id) VALUES (v) ON CONFLICT (raid_id) DO NOTHING;
  UPDATE public.raid_combat_configs SET enabled = true, boss_attack_interval_seconds = 10, boss_attack_fixed_damage = 0, boss_attack_barrier_ratio = 0.04 WHERE raid_id = v;
  INSERT INTO public.raid_phases(raid_id, phase_no, hp_from_ratio, hp_to_ratio) VALUES (v, 1, 1.0, 0);
  INSERT INTO public.raid_combat_states(raid_id, barrier_max_hp, barrier_current_hp, next_boss_attack_at)
  VALUES (v, 1000000, 500000, clock_timestamp() + interval '30 seconds')
  ON CONFLICT (raid_id) DO UPDATE SET barrier_max_hp = excluded.barrier_max_hp, barrier_current_hp = excluded.barrier_current_hp, next_boss_attack_at = excluded.next_boss_attack_at;
  INSERT INTO public.raid_participants(raid_id,student_id,snapshot_student_name,snapshot_owned_shard_count,snapshot_raid_power,
         snapshot_base_crit_bp,snapshot_shard_crit_bp,snapshot_collection_crit_bp,snapshot_final_crit_bp,snapshot_element_power)
  SELECT v, s, '테스트학생' || s, 0, 1000, 0, 0, 0, 0, '{}'::jsonb FROM unnest(p_students) s;
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.t_activate(p_raid bigint) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.raids SET status = 'FAILED' WHERE classroom_id = 5 AND id <> p_raid AND title LIKE 'CLASH4-%' AND status IN ('LOBBY_OPEN','ACTIVE','PAUSED');
  UPDATE public.raids SET status = 'ACTIVE', starts_at = clock_timestamp() WHERE id = p_raid;
END $f$;

-- teacher triggers, students volunteer (volunteering still open)
CREATE FUNCTION pg_temp.t_open(p_raid bigint, p_teacher uuid, p_volunteers uuid[]) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u uuid;
BEGIN
  PERFORM pg_temp.t_as(p_teacher);
  PERFORM public.teacher_trigger_raid_clash(p_raid);
  FOREACH u IN ARRAY p_volunteers LOOP
    PERFORM pg_temp.t_as(u);
    PERFORM public.student_volunteer_raid_clash(p_raid);
  END LOOP;
  PERFORM pg_temp.t_as(p_teacher);
END $f$;

CREATE FUNCTION pg_temp.t_close(p_raid bigint, p_ago interval) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - p_ago, volunteer_closes_at = clock_timestamp() - p_ago - interval '2 seconds' WHERE raid_id = p_raid;
$f$;

CREATE FUNCTION pg_temp.t_pid(p_raid bigint, p_student integer) RETURNS bigint LANGUAGE sql AS $f$
  SELECT id FROM public.raid_participants WHERE raid_id = p_raid AND student_id = p_student;
$f$;

DO $test$
DECLARE
  r jsonb := '[]'::jsonb;
  v_teacher uuid; v_uid uuid[]; v_sid integer[];
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint;
  v_res jsonb; v_s public.raid_clash_sessions%ROWTYPE; v_txt text; v_cnt integer; v_fail jsonb; v_pass integer; v_vols jsonb;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 7) s;

  -- M1 existing configs default RANDOM
  r := r || jsonb_build_object('t','M1 existing configs are RANDOM','ok',
        NOT EXISTS (SELECT 1 FROM public.raid_clash_configs WHERE selection_mode <> 'RANDOM'), 'd', NULL);

  -- ── A. RANDOM: hold 4~8s after close, then 3 drawn ──
  v_a := pg_temp.t_mk('CLASH4-A', v_sid[1:6]);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_save_raid_clash_config(v_a, '{"enabled":true,"difficulty":"EASY","player_count":3}'::jsonb);
  r := r || jsonb_build_object('t','C1 teacher config returns selection_mode RANDOM','ok', v_res->>'selection_mode' = 'RANDOM', 'd', v_res->'selection_mode');
  PERFORM pg_temp.t_activate(v_a);
  PERFORM pg_temp.t_open(v_a, v_teacher, v_uid[1:5]);
  PERFORM pg_temp.t_close(v_a, interval '1 millisecond');
  PERFORM public.raid_clash_advance(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','R1 RANDOM: just after close still drawing (hold 4~8s)','ok',
        v_s.phase = 'VOLUNTEERING' AND v_s.draw_at BETWEEN v_s.volunteer_accept_until + interval '4 seconds' AND v_s.volunteer_accept_until + interval '8 seconds',
        'd', jsonb_build_object('phase', v_s.phase, 'hold', extract(epoch FROM v_s.draw_at - v_s.volunteer_accept_until)));
  UPDATE public.raid_clash_sessions SET draw_at = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_a;
  PERFORM public.raid_clash_advance(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  SELECT count(*) INTO v_cnt FROM public.raid_clash_players WHERE session_id = v_s.id;
  r := r || jsonb_build_object('t','R2 RANDOM: after hold 3 drawn','ok', v_s.phase = 'SELECTED' AND v_cnt = 3, 'd', jsonb_build_object('phase', v_s.phase, 'n', v_cnt));
  v_txt := pg_temp.t_try(format('SELECT public.teacher_set_raid_clash_selection_mode(%s, %L)', v_a, 'TEACHER'));
  r := r || jsonb_build_object('t','S0 mode can be changed during an active raid','ok', v_txt = 'OK', 'd', v_txt);

  -- ── B. TEACHER: waits for the teacher; pick 2, third random ──
  v_b := pg_temp.t_mk('CLASH4-B', v_sid[1:7]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_b, '{"enabled":true,"difficulty":"EASY","player_count":3}'::jsonb);
  v_res := public.teacher_set_raid_clash_selection_mode(v_b, 'teacher');
  r := r || jsonb_build_object('t','S1 set TEACHER (case-insensitive)','ok', v_res->>'selection_mode' = 'TEACHER' AND v_res->'session' = 'null'::jsonb, 'd', v_res->'selection_mode');
  PERFORM pg_temp.t_activate(v_b);
  PERFORM pg_temp.t_open(v_b, v_teacher, v_uid[1:5]);
  PERFORM pg_temp.t_close(v_b, interval '1 millisecond');
  PERFORM public.raid_clash_advance(v_b);
  UPDATE public.raid_clash_sessions SET draw_at = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_b;
  PERFORM public.raid_clash_advance(v_b);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  r := r || jsonb_build_object('t','T1 TEACHER: still waiting after the random hold','ok', v_s.phase = 'VOLUNTEERING', 'd', v_s.phase);

  v_res := public.teacher_get_raid_clash_pick_state(v_b);
  v_vols := v_res->'session'->'volunteers';
  r := r || jsonb_build_object('t','P1 pick state: 5 volunteers, mode, deadline, planned 3','ok',
        jsonb_array_length(v_vols) = 5 AND v_res->>'selection_mode' = 'TEACHER' AND (v_res->>'planned_player_count')::int = 3
        AND (v_res->'session'->>'picked')::boolean = false AND v_res->'session'->>'pick_deadline_at' IS NOT NULL, 'd', v_res->'session'->'picked');
  r := r || jsonb_build_object('t','P2 total clash count counts other raids (raid A players = 1)','ok',
        (SELECT count(*) FROM jsonb_array_elements(v_vols) e WHERE (e->>'clash_count_total')::int >= 1) =
        (SELECT count(*) FROM public.raid_clash_players pl JOIN public.raid_participants p ON p.id = pl.participant_id
           JOIN public.raid_clash_sessions s ON s.id = pl.session_id
          WHERE s.raid_id = v_a AND p.student_id = ANY (v_sid[1:5]))
        AND (SELECT count(*) FROM jsonb_array_elements(v_vols) e WHERE (e->>'clash_count_total')::int >= 1) = 3,
        'd', (SELECT jsonb_agg(e->'clash_count_total') FROM jsonb_array_elements(v_vols) e));

  v_txt := pg_temp.t_try(format('SELECT public.teacher_pick_raid_clash_players(%s, ARRAY[%s]::bigint[])', v_b, pg_temp.t_pid(v_b, v_sid[7])));
  r := r || jsonb_build_object('t','V1 non-volunteer rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pick_raid_clash_players(%s, ARRAY[%s,%s,%s,%s]::bigint[])', v_b,
            pg_temp.t_pid(v_b, v_sid[1]), pg_temp.t_pid(v_b, v_sid[2]), pg_temp.t_pid(v_b, v_sid[3]), pg_temp.t_pid(v_b, v_sid[4])));
  r := r || jsonb_build_object('t','V2 more than 3 rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pick_raid_clash_players(%s, ARRAY[%s,%s]::bigint[])', v_b, pg_temp.t_pid(v_b, v_sid[1]), pg_temp.t_pid(v_b, v_sid[1])));
  r := r || jsonb_build_object('t','V3 duplicate rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pick_raid_clash_players(%s, ARRAY[%s]::bigint[])', v_b, pg_temp.t_pid(v_b, v_sid[1])));
  r := r || jsonb_build_object('t','A1 a student cannot pick','ok', v_txt LIKE 'ERR:%' AND v_txt NOT LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_get_raid_clash_pick_state(%s)', v_b));
  r := r || jsonb_build_object('t','A2 a student cannot read the pick panel','ok', v_txt LIKE 'ERR:%', 'd', v_txt);
  v_res := public.get_raid_battle_state(v_b)->'clash';
  r := r || jsonb_build_object('t','H1 student state never shows the mode / picks','ok',
        strpos(v_res::text, 'TEACHER') = 0 AND strpos(v_res::text, 'selection_mode') = 0 AND strpos(v_res::text, 'teacher_pick') = 0
        AND v_res->'session'->>'phase' = 'VOLUNTEERING', 'd', v_res->'session'->'phase');

  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_pick_raid_clash_players(v_b, ARRAY[pg_temp.t_pid(v_b, v_sid[5]), pg_temp.t_pid(v_b, v_sid[4])]);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  r := r || jsonb_build_object('t','T2 pick 2 → selected at once, picked first (slot 0,1), 3rd random volunteer','ok',
        v_s.phase = 'SELECTED' AND v_s.player_count = 3
        AND (SELECT participant_id FROM public.raid_clash_players WHERE session_id = v_s.id AND slot = 0) = pg_temp.t_pid(v_b, v_sid[5])
        AND (SELECT participant_id FROM public.raid_clash_players WHERE session_id = v_s.id AND slot = 1) = pg_temp.t_pid(v_b, v_sid[4])
        AND (SELECT participant_id FROM public.raid_clash_players WHERE session_id = v_s.id AND slot = 2) IN
            (SELECT participant_id FROM public.raid_clash_volunteers WHERE session_id = v_s.id)
        AND v_s.selected_participant_id = pg_temp.t_pid(v_b, v_sid[5])
        AND (v_res->'session'->>'phase') = 'SELECTED',
        'd', jsonb_build_object('phase', v_s.phase, 'n', v_s.player_count));
  r := r || jsonb_build_object('t','H2 CLASH_SELECTED event carries no mode / pick info','ok',
        NOT EXISTS (SELECT 1 FROM public.raid_combat_events WHERE raid_id = v_b AND (payload::text LIKE '%TEACHER%' OR payload::text LIKE '%teacher_pick%')), 'd', NULL);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pick_raid_clash_players(%s, ARRAY[]::bigint[])', v_b));
  r := r || jsonb_build_object('t','V4 pick again after selection rejected','ok', v_txt LIKE 'ERR:P0215%', 'd', v_txt);

  -- ── C. TEACHER, no decision in 30s → random ──
  v_c := pg_temp.t_mk('CLASH4-C', v_sid[1:6]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_c, '{"enabled":true,"difficulty":"EASY","player_count":3}'::jsonb);
  PERFORM public.teacher_set_raid_clash_selection_mode(v_c, 'TEACHER');
  PERFORM pg_temp.t_activate(v_c);
  PERFORM pg_temp.t_open(v_c, v_teacher, v_uid[1:5]);
  PERFORM pg_temp.t_close(v_c, interval '29 seconds');
  PERFORM public.raid_clash_advance(v_c);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_c;
  r := r || jsonb_build_object('t','T3 29s after close: still waiting','ok', v_s.phase = 'VOLUNTEERING', 'd', v_s.phase);
  PERFORM pg_temp.t_close(v_c, interval '31 seconds');
  PERFORM public.raid_clash_advance(v_c);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_c;
  SELECT count(*) INTO v_cnt FROM public.raid_clash_players WHERE session_id = v_s.id;
  r := r || jsonb_build_object('t','T4 31s after close: random 3 drawn','ok', v_s.phase = 'SELECTED' AND v_cnt = 3, 'd', jsonb_build_object('phase', v_s.phase, 'n', v_cnt));

  -- ── D. TEACHER: confirm with empty list = all random now; switch back to RANDOM blocks picking ──
  v_d := pg_temp.t_mk('CLASH4-D', v_sid[1:6]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_d, '{"enabled":true,"difficulty":"EASY","player_count":3}'::jsonb);
  PERFORM public.teacher_set_raid_clash_selection_mode(v_d, 'TEACHER');
  PERFORM pg_temp.t_activate(v_d);
  PERFORM pg_temp.t_open(v_d, v_teacher, v_uid[1:4]);
  -- confirm before volunteering closes → waits until close, then draws immediately
  v_res := public.teacher_pick_raid_clash_players(v_d, ARRAY[pg_temp.t_pid(v_d, v_sid[2])]);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_d;
  r := r || jsonb_build_object('t','T5 confirmed before close → still volunteering','ok', v_s.phase = 'VOLUNTEERING' AND (v_res->'session'->>'picked')::boolean, 'd', v_s.phase);
  PERFORM pg_temp.t_close(v_d, interval '1 millisecond');
  PERFORM public.raid_clash_advance(v_d);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_d;
  r := r || jsonb_build_object('t','T6 right after close → drawn with the pick in slot 0','ok', v_s.phase = 'SELECTED'
        AND (SELECT participant_id FROM public.raid_clash_players WHERE session_id = v_s.id AND slot = 0) = pg_temp.t_pid(v_d, v_sid[2]), 'd', v_s.phase);

  v_e := pg_temp.t_mk('CLASH4-E', v_sid[1:6]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_e, '{"enabled":true,"difficulty":"EASY","player_count":3}'::jsonb);
  PERFORM pg_temp.t_activate(v_e);
  PERFORM pg_temp.t_open(v_e, v_teacher, v_uid[1:4]);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_pick_raid_clash_players(%s, ARRAY[]::bigint[])', v_e));
  r := r || jsonb_build_object('t','M2 RANDOM mode: picking rejected (P0215)','ok', v_txt LIKE 'ERR:P0215%', 'd', v_txt);
  PERFORM public.teacher_set_raid_clash_selection_mode(v_e, 'TEACHER');
  PERFORM pg_temp.t_close(v_e, interval '1 millisecond');
  v_res := public.teacher_pick_raid_clash_players(v_e, ARRAY[]::bigint[]);
  r := r || jsonb_build_object('t','T7 empty confirm = all random now','ok', v_res->'session'->>'phase' = 'SELECTED' AND jsonb_array_length(v_res->'session'->'players') = 3, 'd', v_res->'session'->'phase');

  v_txt := pg_temp.t_try(format('SELECT public.teacher_set_raid_clash_selection_mode(%s, %L)', v_e, 'SOMETIMES'));
  r := r || jsonb_build_object('t','S2 unknown mode rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  UPDATE public.raids SET status = 'COMPLETED' WHERE id = v_a;
  v_txt := pg_temp.t_try(format('SELECT public.teacher_set_raid_clash_selection_mode(%s, %L)', v_a, 'RANDOM'));
  r := r || jsonb_build_object('t','S3 ended raid locked','ok', v_txt LIKE 'ERR:P0215%', 'd', v_txt);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean, false))
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'CLASH4_TEST_RESULT pass=% total=% failed=%', v_pass, jsonb_array_length(r), COALESCE(v_fail, '[]'::jsonb);
END
$test$;
