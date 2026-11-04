-- B.R.A.N.D 2.0 — Raid CLASH V3 (레이드마다 대표 인원 1~12명) server test (ROLLBACK SANDBOX)
-- Run AFTER the V3 migration text in the SAME query string (V1 + V2 are already in production).
-- The final RAISE aborts the whole transaction: nothing (migration, test raids, results) is kept.
-- Uses classroom 5 (B.R.A.N.D LOADTEST: no live raid) students and its teacher.

CREATE FUNCTION pg_temp.t_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

CREATE FUNCTION pg_temp.t_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLERRM; END $f$;

-- DRAFT raid with barrier on and the given participants (no CLASH config yet)
CREATE FUNCTION pg_temp.t_mk_draft(p_title text, p_bcur bigint, p_students integer[])
RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'CLASH 테스트 보스','FIRE',100000,100000,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
  UPDATE public.raid_patterns SET is_enabled = false WHERE raid_id = v;
  INSERT INTO public.raid_combat_configs(raid_id) VALUES (v) ON CONFLICT (raid_id) DO NOTHING;
  UPDATE public.raid_combat_configs SET enabled = true, boss_attack_interval_seconds = 10, boss_attack_fixed_damage = 0, boss_attack_barrier_ratio = 0.04 WHERE raid_id = v;
  INSERT INTO public.raid_phases(raid_id, phase_no, hp_from_ratio, hp_to_ratio) VALUES (v, 1, 1.0, 0);
  INSERT INTO public.raid_combat_states(raid_id, barrier_max_hp, barrier_current_hp, next_boss_attack_at)
  VALUES (v, 1000000, p_bcur, clock_timestamp() + interval '30 seconds')
  ON CONFLICT (raid_id) DO UPDATE SET barrier_max_hp = excluded.barrier_max_hp, barrier_current_hp = excluded.barrier_current_hp, next_boss_attack_at = excluded.next_boss_attack_at;
  INSERT INTO public.raid_participants(raid_id,student_id,snapshot_student_name,snapshot_owned_shard_count,snapshot_raid_power,
         snapshot_base_crit_bp,snapshot_shard_crit_bp,snapshot_collection_crit_bp,snapshot_final_crit_bp,snapshot_element_power)
  SELECT v, s, '테스트학생' || s, 0, 1000, 0, 0, 0, 0, '{}'::jsonb FROM unnest(p_students) s;
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.t_activate(p_raid bigint) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.raids SET status = 'FAILED' WHERE classroom_id = 5 AND id <> p_raid AND title LIKE 'CLASH3-%' AND status IN ('LOBBY_OPEN','ACTIVE','PAUSED');
  UPDATE public.raids SET status = 'ACTIVE', starts_at = clock_timestamp() WHERE id = p_raid;
END $f$;

-- teacher trigger + the given students volunteer + volunteering closes + draw
CREATE FUNCTION pg_temp.t_draw(p_raid bigint, p_teacher uuid, p_volunteers uuid[]) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u uuid;
BEGIN
  PERFORM pg_temp.t_as(p_teacher);
  PERFORM public.teacher_trigger_raid_clash(p_raid);
  FOREACH u IN ARRAY COALESCE(p_volunteers, ARRAY[]::uuid[]) LOOP
    PERFORM pg_temp.t_as(u);
    PERFORM public.student_volunteer_raid_clash(p_raid);
  END LOOP;
  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - interval '1 millisecond' WHERE raid_id = p_raid;
  PERFORM public.raid_clash_advance(p_raid);
END $f$;

CREATE FUNCTION pg_temp.t_uid(p_raid bigint, p_slot integer) RETURNS uuid LANGUAGE sql AS $f$
  SELECT st.user_id FROM public.raid_clash_players pl
    JOIN public.raid_clash_sessions cs ON cs.id = pl.session_id
    JOIN public.raid_participants p ON p.id = pl.participant_id
    JOIN public.students st ON st.id = p.student_id
   WHERE cs.raid_id = p_raid AND pl.slot = p_slot;
$f$;

CREATE FUNCTION pg_temp.t_note(p_raid bigint, p_uid uuid, p_index integer, p_key text, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_s public.raid_clash_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid;
  UPDATE public.raid_clash_sessions
     SET play_starts_at = clock_timestamp() - make_interval(secs => ((public.raid_clash_ideal_ms(config, p_index) + p_offset)::numeric/1000.0)::double precision),
         play_deadline_at = clock_timestamp() + interval '60 seconds'
   WHERE raid_id = p_raid;
  PERFORM pg_temp.t_as(p_uid);
  RETURN public.student_submit_raid_clash_input(p_raid, p_index, COALESCE(p_key, v_s.note_keys[p_index + 1]), p_offset);
END $f$;

-- a player's 8 notes: first p_perfect PERFECT, next p_good GOOD (EASY: 150ms), rest client MISS
CREATE FUNCTION pg_temp.t_play(p_raid bigint, p_slot integer, p_perfect integer, p_good integer) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE i integer; u uuid := pg_temp.t_uid(p_raid, p_slot); r jsonb;
BEGIN
  FOR i IN 0..7 LOOP
    IF i < p_perfect THEN r := pg_temp.t_note(p_raid, u, i, NULL, 0);
    ELSIF i < p_perfect + p_good THEN r := pg_temp.t_note(p_raid, u, i, NULL, 150);
    ELSE
      PERFORM pg_temp.t_as(u);
      r := public.student_submit_raid_clash_input(p_raid, i, NULL, NULL);
    END IF;
  END LOOP;
  RETURN r;
END $f$;

DO $test$
DECLARE
  r jsonb := '[]'::jsonb;
  v_teacher uuid; v_uid uuid[]; v_sid integer[];
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint;
  v_res jsonb; v_s public.raid_clash_sessions%ROWTYPE; v_txt text; v_cnt integer; v_cnt2 integer; v_fail jsonb; v_pass integer;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 15) s;

  -- ── M. migration: existing configs keep 3, column default 3 ──
  r := r || jsonb_build_object('t','M1 existing configs keep 3 players','ok',
        (SELECT count(*) FROM public.raid_clash_configs) > 0
        AND NOT EXISTS (SELECT 1 FROM public.raid_clash_configs WHERE player_count <> 3), 'd', (SELECT jsonb_agg(player_count) FROM public.raid_clash_configs));

  -- ── S. save / read player_count ──
  v_a := pg_temp.t_mk_draft('CLASH3-A', 500000, v_sid);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_save_raid_clash_config(v_a, '{"enabled":true,"difficulty":"EASY","player_count":12}'::jsonb);
  r := r || jsonb_build_object('t','S1 save 12 → get returns 12, max 12','ok', (v_res->>'player_count')::int = 12 AND (v_res->>'max_player_count')::int = 12
        AND (SELECT player_count FROM public.raid_clash_configs WHERE raid_id = v_a) = 12, 'd', v_res->'player_count');
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_clash_config(%s, %L::jsonb)', v_a, '{"enabled":true,"difficulty":"EASY","player_count":13}'));
  r := r || jsonb_build_object('t','S2 13 rejected','ok', v_txt LIKE 'ERR:%1명부터 12명%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_clash_config(%s, %L::jsonb)', v_a, '{"enabled":true,"difficulty":"EASY","player_count":0}'));
  r := r || jsonb_build_object('t','S3 0 rejected','ok', v_txt LIKE 'ERR:%1명부터 12명%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_clash_config(%s, %L::jsonb)', v_a, '{"enabled":true,"difficulty":"EASY","player_count":"abc"}'));
  r := r || jsonb_build_object('t','S4 text rejected','ok', v_txt LIKE 'ERR:%1명부터 12명%', 'd', v_txt);
  v_res := public.teacher_save_raid_clash_config(v_a, '{"enabled":true,"difficulty":"NORMAL"}'::jsonb);
  r := r || jsonb_build_object('t','S5 old payload (no player_count) keeps 12','ok', (v_res->>'player_count')::int = 12 AND v_res->>'difficulty' = 'NORMAL', 'd', v_res->'player_count');
  v_res := public.teacher_save_raid_clash_config(v_a, '{"enabled":true,"difficulty":"EASY","player_count":"12"}'::jsonb);
  r := r || jsonb_build_object('t','S6 rejected saves did not change it; string "12" ok','ok', (v_res->>'player_count')::int = 12 AND v_res->>'difficulty' = 'EASY', 'd', v_res->'player_count');

  -- ── A. 12 players: 15 volunteers → 12 drawn, slot 11 not ready ──
  PERFORM pg_temp.t_activate(v_a);
  PERFORM pg_temp.t_as(v_teacher);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_clash_config(%s, %L::jsonb)', v_a, '{"enabled":true,"difficulty":"EASY","player_count":5}'));
  r := r || jsonb_build_object('t','S7 cannot change after the battle starts','ok', v_txt LIKE 'ERR:%전투 시작 전%'
        AND (SELECT player_count FROM public.raid_clash_configs WHERE raid_id = v_a) = 12, 'd', v_txt);
  PERFORM pg_temp.t_draw(v_a, v_teacher, v_uid[1:15]);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  SELECT count(*), count(DISTINCT participant_id) INTO v_cnt, v_cnt2 FROM public.raid_clash_players WHERE session_id = v_s.id;
  r := r || jsonb_build_object('t','A1 12 distinct players, slots 0~11','ok', v_s.phase = 'SELECTED' AND v_s.player_count = 12 AND v_cnt = 12 AND v_cnt2 = 12
        AND (v_s.config->>'player_count')::int = 12
        AND (SELECT min(slot) FROM public.raid_clash_players WHERE session_id = v_s.id) = 0
        AND (SELECT max(slot) FROM public.raid_clash_players WHERE session_id = v_s.id) = 11,
        'd', jsonb_build_object('phase', v_s.phase, 'n', v_s.player_count, 'rows', v_cnt));
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 11));
  v_res := public.get_raid_battle_state(v_a)->'clash'->'session';
  r := r || jsonb_build_object('t','A2 public state: 12 players, thresholds 96/156/192','ok',
        (v_res->>'my_slot')::int = 11 AND jsonb_array_length(v_res->'players') = 12 AND (v_res->>'player_count')::int = 12
        AND (v_res->>'planned_player_count')::int = 12
        AND (v_res->>'score_success')::int = 96 AND (v_res->>'score_great')::int = 156 AND (v_res->>'score_max')::int = 192,
        'd', jsonb_build_object('s', v_res->'score_success', 'g', v_res->'score_great', 'm', v_res->'score_max'));
  FOR i IN 0..10 LOOP PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, i)); PERFORM public.student_ready_raid_clash(v_a); END LOOP;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A3 11 of 12 ready → still SELECTED','ok', v_s.phase = 'SELECTED', 'd', v_s.phase);
  UPDATE public.raid_clash_sessions SET ready_deadline_at = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_a;
  PERFORM public.raid_clash_advance(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  SELECT count(*) INTO v_cnt FROM public.raid_clash_inputs WHERE session_id = v_s.id AND slot = 11 AND source = 'NOT_READY' AND judgment = 'MISS';
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 11)); v_txt := public.student_ready_raid_clash(v_a)->>'reason';
  r := r || jsonb_build_object('t','A4 timeout → PLAYING; slot 11 gets 8 MISS, late READY = TOO_LATE','ok', v_s.phase = 'PLAYING' AND v_cnt = 8 AND v_txt = 'TOO_LATE'
        AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 8, 'd', jsonb_build_object('phase', v_s.phase, 'miss', v_cnt, 'ready', v_txt));
  -- slots 0~9 all PERFECT (160), slot 10: 4 PERFECT (8) → 168 ≥ 156 → GREAT
  FOR i IN 0..9 LOOP PERFORM pg_temp.t_play(v_a, i, 8, 0); END LOOP;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A5 not finished before all 96 notes','ok', v_s.phase = 'PLAYING'
        AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 88, 'd', v_s.phase);
  v_res := pg_temp.t_play(v_a, 10, 4, 0);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A6 168/192 → GREAT_SUCCESS (8 x 12 notes)','ok', v_s.phase = 'RESOLVED' AND v_s.score = 168 AND v_s.outcome = 'GREAT_SUCCESS'
        AND v_s.outcome_reason = 'SCORED' AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 96
        AND (v_res->'clash'->'session'->'players'->11->>'score')::int = 0 AND (v_res->'clash'->'session'->'players'->10->>'score')::int = 8,
        'd', jsonb_build_object('score', v_s.score, 'outcome', v_s.outcome));

  -- ── B. 5 planned, only 2 volunteers → 2 players, thresholds 16 / 26 ──
  v_b := pg_temp.t_mk_draft('CLASH3-B', 500000, v_sid[1:6]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_b, '{"enabled":true,"difficulty":"EASY","player_count":5}'::jsonb);
  PERFORM pg_temp.t_activate(v_b);
  PERFORM pg_temp.t_draw(v_b, v_teacher, v_uid[1:2]);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.get_raid_battle_state(v_b)->'clash'->'session';
  r := r || jsonb_build_object('t','B1 5 planned, 2 volunteers → 2 drawn, 16/26/32','ok', v_s.player_count = 2 AND (v_res->>'planned_player_count')::int = 5
        AND (v_res->>'score_success')::int = 16 AND (v_res->>'score_great')::int = 26 AND (v_res->>'score_max')::int = 32,
        'd', jsonb_build_object('n', v_s.player_count, 'planned', v_res->'planned_player_count'));

  -- ── C. 5 planned, 6 volunteers → 5 drawn ──
  v_c := pg_temp.t_mk_draft('CLASH3-C', 500000, v_sid[1:6]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_c, '{"enabled":true,"difficulty":"HARD","player_count":5}'::jsonb);
  PERFORM pg_temp.t_activate(v_c);
  PERFORM pg_temp.t_draw(v_c, v_teacher, v_uid[1:6]);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_c;
  r := r || jsonb_build_object('t','C1 5 planned, 6 volunteers → 5 drawn (HARD kept)','ok', v_s.player_count = 5 AND v_s.difficulty = 'HARD'
        AND (SELECT count(*) FROM public.raid_clash_players WHERE session_id = v_s.id) = 5, 'd', jsonb_build_object('n', v_s.player_count, 'diff', v_s.difficulty));

  -- ── D. 1 planned, 4 volunteers → 1 drawn, works like V1 (8 / 13) ──
  v_d := pg_temp.t_mk_draft('CLASH3-D', 500000, v_sid[1:4]);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_d, '{"enabled":true,"difficulty":"EASY","player_count":1}'::jsonb);
  PERFORM pg_temp.t_activate(v_d);
  PERFORM pg_temp.t_draw(v_d, v_teacher, v_uid[1:4]);
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_d, 0)); PERFORM public.student_ready_raid_clash(v_d);
  PERFORM pg_temp.t_play(v_d, 0, 4, 0);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_d;
  r := r || jsonb_build_object('t','D1 1 planned of 4 volunteers: 8/16 → SUCCESS','ok', v_s.player_count = 1 AND v_s.score = 8 AND v_s.outcome = 'SUCCESS'
        AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 8, 'd', jsonb_build_object('n', v_s.player_count, 'score', v_s.score));

  -- ── E. old payload (no player_count) on a new raid → 3 players, as V2 ──
  v_e := pg_temp.t_mk_draft('CLASH3-E', 500000, v_sid[1:5]);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_save_raid_clash_config(v_e, '{"enabled":true,"difficulty":"EASY"}'::jsonb);
  PERFORM pg_temp.t_activate(v_e);
  PERFORM pg_temp.t_draw(v_e, v_teacher, v_uid[1:5]);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_e;
  r := r || jsonb_build_object('t','E1 old screen payload → 3 players (V2 behavior)','ok', (v_res->>'player_count')::int = 3 AND v_s.player_count = 3,
        'd', jsonb_build_object('cfg', v_res->'player_count', 'n', v_s.player_count));

  -- ── P. privileges ──
  r := r || jsonb_build_object('t','P1 privileges','ok',
        NOT has_function_privilege('authenticated','public.raid_clash_planned_players(jsonb)','EXECUTE')
        AND NOT has_function_privilege('anon','public.teacher_save_raid_clash_config(bigint,jsonb)','EXECUTE')
        AND has_function_privilege('authenticated','public.teacher_save_raid_clash_config(bigint,jsonb)','EXECUTE')
        AND NOT has_table_privilege('authenticated','public.raid_clash_configs','SELECT')
        AND NOT has_table_privilege('anon','public.raid_clash_configs','SELECT'), 'd', NULL);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), COALESCE(jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean,false)), '[]'::jsonb)
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'CLASH3_TEST_RESULT pass=% total=% failed=%', v_pass, jsonb_array_length(r), v_fail;
END;
$test$;
