-- B.R.A.N.D 2.0 — Raid CLASH V2 (대표 3인) server test (ROLLBACK SANDBOX)
-- Run AFTER the V2 migration text in the SAME query string (V1 is already in production).
-- The final RAISE aborts the whole transaction: nothing (migration, test raids, results) is kept.
-- Uses classroom 5 (B.R.A.N.D LOADTEST: no live raid) students and its teacher.

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

CREATE FUNCTION pg_temp.t_mk_raid(p_title text, p_hp bigint, p_bcur bigint, p_teacher uuid, p_students integer[])
RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'CLASH 테스트 보스','FIRE',100000,p_hp,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
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
  PERFORM pg_temp.t_as(p_teacher);
  PERFORM public.teacher_save_raid_clash_config(v, '{"enabled":true,"difficulty":"EASY"}'::jsonb);
  UPDATE public.raids SET status = 'FAILED' WHERE classroom_id = 5 AND id <> v AND title LIKE 'CLASH2-%' AND status IN ('LOBBY_OPEN','ACTIVE','PAUSED');
  UPDATE public.raids SET status = 'ACTIVE', starts_at = clock_timestamp() WHERE id = v;
  RETURN v;
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

CREATE FUNCTION pg_temp.t_ready_all(p_raid bigint) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE s integer;
BEGIN
  FOR s IN SELECT pl.slot FROM public.raid_clash_players pl JOIN public.raid_clash_sessions cs ON cs.id = pl.session_id WHERE cs.raid_id = p_raid ORDER BY pl.slot LOOP
    PERFORM pg_temp.t_as(pg_temp.t_uid(p_raid, s));
    PERFORM public.student_ready_raid_clash(p_raid);
  END LOOP;
END $f$;

-- one note: make "now" = ideal time + offset, then submit with the right (or given) key
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
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint; v_f bigint; v_g bigint; v_h bigint;
  v_res jsonb; v_res2 jsonb; v_s public.raid_clash_sessions%ROWTYPE; v_txt text; v_cnt integer; v_cnt2 integer;
  v_outsider uuid; v_fail jsonb; v_pass integer;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 5) s;

  -- ── A. 5 volunteers → 3 drawn, all ready, 16+15+7 = 38 → SUCCESS (great needs 39) ──
  v_a := pg_temp.t_mk_raid('CLASH2-A', 50500, 400000, v_teacher, v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.submit_raid_tap_batch(v_a, gen_random_uuid(), pg_temp.t_taps(1, 0.05, 0.95));
  r := r || jsonb_build_object('t','A0 50% tap still starts CLASH','ok', (v_res->>'clash_triggered')::boolean, 'd', v_res - 'results');
  FOR i IN 1..5 LOOP PERFORM pg_temp.t_as(v_uid[i]); PERFORM public.student_volunteer_raid_clash(v_a); END LOOP;
  UPDATE public.raid_clash_sessions SET volunteer_accept_until = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_a;
  PERFORM public.raid_clash_advance(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  SELECT count(*), count(DISTINCT participant_id) INTO v_cnt, v_cnt2 FROM public.raid_clash_players WHERE session_id = v_s.id;
  r := r || jsonb_build_object('t','A1 three distinct players drawn from volunteers','ok', v_s.phase = 'SELECTED' AND v_s.player_count = 3 AND v_cnt = 3 AND v_cnt2 = 3
        AND NOT EXISTS (SELECT 1 FROM public.raid_clash_players pl WHERE pl.session_id = v_s.id
                          AND NOT EXISTS (SELECT 1 FROM public.raid_clash_volunteers v WHERE v.session_id = v_s.id AND v.participant_id = pl.participant_id))
        AND v_s.selected_participant_id = (SELECT participant_id FROM public.raid_clash_players WHERE session_id = v_s.id AND slot = 0),
        'd', jsonb_build_object('phase', v_s.phase, 'n', v_s.player_count, 'rows', v_cnt));

  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 2));
  v_res := public.get_raid_battle_state(v_a)->'clash'->'session';
  SELECT st.user_id INTO v_outsider FROM public.students st WHERE st.id = ANY(v_sid) AND st.user_id NOT IN (pg_temp.t_uid(v_a,0), pg_temp.t_uid(v_a,1), pg_temp.t_uid(v_a,2)) LIMIT 1;
  PERFORM pg_temp.t_as(v_outsider);
  v_res2 := public.get_raid_battle_state(v_a)->'clash'->'session';
  r := r || jsonb_build_object('t','A2 public state: players, my_slot, team thresholds','ok',
        (v_res->>'i_am_selected')::boolean AND (v_res->>'my_slot')::int = 2 AND jsonb_array_length(v_res->'players') = 3
        AND (v_res->>'player_count')::int = 3 AND (v_res->>'score_success')::int = 24 AND (v_res->>'score_great')::int = 39 AND (v_res->>'score_max')::int = 48
        AND NOT (v_res2->>'i_am_selected')::boolean AND v_res2->'my_slot' = 'null'::jsonb AND (v_res2->>'i_volunteered')::boolean
        AND v_res->'selected'->>'participant_id' = v_res->'players'->0->>'participant_id',
        'd', jsonb_build_object('me', v_res->'my_slot', 'n', v_res->'player_count'));

  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.submit_raid_tap_batch(v_a, gen_random_uuid(), pg_temp.t_taps(2, 0.05, 0.95));
  r := r || jsonb_build_object('t','A3 still frozen while 3 players get ready','ok', (v_res->>'accepted')::int = 0 AND (v_res->>'clash_active')::boolean, 'd', v_res - 'results');

  PERFORM pg_temp.t_as(v_outsider); v_txt := public.student_ready_raid_clash(v_a)->>'reason';
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 0)); PERFORM public.student_ready_raid_clash(v_a);
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 1)); PERFORM public.student_ready_raid_clash(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A4 2 of 3 ready → still SELECTED; outsider NOT_SELECTED','ok', v_s.phase = 'SELECTED' AND v_txt = 'NOT_SELECTED'
        AND (SELECT count(*) FROM public.raid_clash_players WHERE session_id = v_s.id AND ready_at IS NOT NULL) = 2, 'd', v_s.phase);
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 2)); v_res := public.student_ready_raid_clash(v_a);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A5 last ready → PLAYING, no NOT_READY rows','ok', v_s.phase = 'PLAYING' AND (v_res->>'accepted')::boolean
        AND NOT EXISTS (SELECT 1 FROM public.raid_clash_inputs WHERE session_id = v_s.id), 'd', v_s.phase);

  v_res := pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 0), 0, NULL, 0);
  v_res2 := pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 1), 0, NULL, 150);
  r := r || jsonb_build_object('t','A6 same note, different players: both judged (not duplicate)','ok',
        v_res->>'judgment' = 'PERFECT' AND NOT (v_res->>'duplicate')::boolean AND v_res2->>'judgment' = 'GOOD' AND NOT (v_res2->>'duplicate')::boolean,
        'd', jsonb_build_object('p0', v_res->>'judgment', 'p1', v_res2->>'judgment'));
  v_res := pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 0), 0, NULL, 300);
  PERFORM pg_temp.t_as(v_outsider); v_txt := public.student_submit_raid_clash_input(v_a, 1, 'KeyQ', 0)->>'reason';
  r := r || jsonb_build_object('t','A7 duplicate per player kept; outsider input rejected','ok',
        (v_res->>'duplicate')::boolean AND v_res->>'judgment' = 'PERFECT' AND v_txt = 'NOT_SELECTED', 'd', v_txt);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  v_res := pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 2), 1, (CASE v_s.note_keys[2] WHEN 'KeyQ' THEN 'KeyW' ELSE 'KeyQ' END), 0);
  r := r || jsonb_build_object('t','A8 wrong key MISS for that player only','ok', v_res->>'judgment' = 'MISS' AND v_res->>'flag' = 'WRONG_KEY', 'd', v_res->>'flag');
  -- slot 0: note0 already PERFECT → 7 more PERFECT = 16 / slot 1: note0 GOOD(1) → 7 more PERFECT = 15
  FOR i IN 1..7 LOOP PERFORM pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 0), i, NULL, 0); PERFORM pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 1), i, NULL, 0); END LOOP;
  -- slot 2: note1 MISS already; notes 0,2,3 PERFECT + note4 GOOD = 7, rest client MISS → team 16+15+7 = 38
  PERFORM pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 2), 0, NULL, 0);
  PERFORM pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 2), 2, NULL, 0);
  PERFORM pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 2), 3, NULL, 0);
  PERFORM pg_temp.t_note(v_a, pg_temp.t_uid(v_a, 2), 4, NULL, 150);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A9 not finished before all 24 notes','ok', v_s.phase = 'PLAYING'
        AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 21, 'd', v_s.phase);
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_a, 2));
  PERFORM public.student_submit_raid_clash_input(v_a, 5, NULL, NULL);
  PERFORM public.student_submit_raid_clash_input(v_a, 6, NULL, NULL);
  v_res := public.student_submit_raid_clash_input(v_a, 7, NULL, NULL);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_a;
  r := r || jsonb_build_object('t','A10 38/48 → SUCCESS (team thresholds x3)','ok', v_s.phase = 'RESOLVED' AND v_s.score = 38 AND v_s.outcome = 'SUCCESS'
        AND v_s.clash_component = 1.5 AND v_s.outcome_reason = 'SCORED'
        AND (v_res->'clash'->'session'->'players'->0->>'score')::int = 16 AND (v_res->'clash'->'session'->'players'->1->>'score')::int = 15
        AND (v_res->'clash'->'session'->'players'->2->>'score')::int = 7,
        'd', jsonb_build_object('score', v_s.score, 'outcome', v_s.outcome));

  -- ── B. 39/48 → GREAT ──
  v_b := pg_temp.t_mk_raid('CLASH2-B', 100000, 500000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_b, v_teacher, v_uid[1:4]);
  PERFORM pg_temp.t_ready_all(v_b);
  PERFORM pg_temp.t_play(v_b, 0, 8, 0);
  PERFORM pg_temp.t_play(v_b, 1, 8, 0);
  PERFORM pg_temp.t_play(v_b, 2, 3, 1);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_b;
  r := r || jsonb_build_object('t','B1 39/48 → GREAT_SUCCESS','ok', v_s.score = 39 AND v_s.outcome = 'GREAT_SUCCESS' AND v_s.clash_component = 3.0
        AND v_s.buff_until > clock_timestamp() AND v_s.boss_attack_block_until > clock_timestamp(),
        'd', jsonb_build_object('score', v_s.score, 'outcome', v_s.outcome));

  -- ── C. ready timeout: only slot 0 ready → others all MISS, slot 0 plays; 16 < 24 → FAILED, 20% of current ──
  v_c := pg_temp.t_mk_raid('CLASH2-C', 100000, 100000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_c, v_teacher, v_uid[1:4]);
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_c, 0)); PERFORM public.student_ready_raid_clash(v_c);
  UPDATE public.raid_clash_sessions SET ready_deadline_at = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_c;
  PERFORM public.raid_clash_advance(v_c);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_c;
  SELECT count(*) INTO v_cnt FROM public.raid_clash_inputs WHERE session_id = v_s.id AND source = 'NOT_READY' AND slot IN (1,2) AND judgment = 'MISS';
  r := r || jsonb_build_object('t','C1 timeout → PLAYING, 2 late players get 16 MISS','ok', v_s.phase = 'PLAYING' AND v_cnt = 16
        AND NOT EXISTS (SELECT 1 FROM public.raid_clash_inputs WHERE session_id = v_s.id AND slot = 0), 'd', jsonb_build_object('phase', v_s.phase, 'not_ready', v_cnt));
  PERFORM pg_temp.t_as(pg_temp.t_uid(v_c, 1)); v_txt := public.student_ready_raid_clash(v_c)->>'reason';
  v_res := pg_temp.t_note(v_c, pg_temp.t_uid(v_c, 1), 0, NULL, 0);
  r := r || jsonb_build_object('t','C2 late player: ready TOO_LATE, input stays MISS','ok', v_txt = 'TOO_LATE'
        AND (v_res->>'duplicate')::boolean AND v_res->>'judgment' = 'MISS', 'd', v_txt);
  PERFORM pg_temp.t_play(v_c, 0, 8, 0);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_c;
  r := r || jsonb_build_object('t','C3 16/48 → FAILED, penalty 20% of current barrier','ok', v_s.phase = 'RESOLVED' AND v_s.score = 16 AND v_s.outcome = 'FAILED'
        AND v_s.barrier_penalty_amount = 20000 AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_c) = 80000,
        'd', jsonb_build_object('score', v_s.score, 'pen', v_s.barrier_penalty_amount));

  -- ── D. 2 volunteers → 2 players, thresholds 16 / 26 ──
  v_d := pg_temp.t_mk_raid('CLASH2-D', 100000, 500000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_d, v_teacher, v_uid[1:2]);
  PERFORM pg_temp.t_ready_all(v_d);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_res := public.get_raid_battle_state(v_d)->'clash'->'session';
  PERFORM pg_temp.t_play(v_d, 0, 8, 0);
  PERFORM pg_temp.t_play(v_d, 1, 5, 0);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_d;
  r := r || jsonb_build_object('t','D1 2 players: 26/32 → GREAT (thresholds x2)','ok', v_s.player_count = 2 AND (v_res->>'score_success')::int = 16
        AND (v_res->>'score_great')::int = 26 AND (v_res->>'score_max')::int = 32 AND v_s.score = 26 AND v_s.outcome = 'GREAT_SUCCESS',
        'd', jsonb_build_object('n', v_s.player_count, 'score', v_s.score, 'outcome', v_s.outcome));

  -- ── E. 1 volunteer → works like V1 (8 / 13) ──
  v_e := pg_temp.t_mk_raid('CLASH2-E', 100000, 500000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_e, v_teacher, v_uid[3:3]);
  PERFORM pg_temp.t_ready_all(v_e);
  PERFORM pg_temp.t_play(v_e, 0, 4, 0);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_e;
  r := r || jsonb_build_object('t','E1 1 player: 8/16 → SUCCESS','ok', v_s.player_count = 1 AND v_s.score = 8 AND v_s.outcome = 'SUCCESS'
        AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 8, 'd', jsonb_build_object('score', v_s.score, 'outcome', v_s.outcome));

  -- ── F. nobody ready → all MISS → FAILED at once ──
  v_f := pg_temp.t_mk_raid('CLASH2-F', 100000, 500000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_f, v_teacher, v_uid[1:5]);
  UPDATE public.raid_clash_sessions SET ready_deadline_at = clock_timestamp() - interval '1 millisecond' WHERE raid_id = v_f;
  PERFORM public.raid_clash_advance(v_f);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_f;
  r := r || jsonb_build_object('t','F1 nobody ready → 24 MISS, FAILED, penalty once','ok', v_s.phase = 'RESOLVED' AND v_s.outcome = 'FAILED' AND v_s.score = 0
        AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 24
        AND (SELECT barrier_current_hp FROM public.raid_combat_states WHERE raid_id = v_f) = 400000, 'd', v_s.phase);

  -- ── G. force finish during PLAYING: every missing note of every player → MISS ──
  v_g := pg_temp.t_mk_raid('CLASH2-G', 100000, 500000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_g, v_teacher, v_uid[1:3]);
  PERFORM pg_temp.t_ready_all(v_g);
  PERFORM pg_temp.t_note(v_g, pg_temp.t_uid(v_g, 0), 0, NULL, 0);
  PERFORM pg_temp.t_note(v_g, pg_temp.t_uid(v_g, 1), 0, NULL, 0);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_force_finish_raid_clash(v_g, 'test');
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_g;
  r := r || jsonb_build_object('t','G1 force finish fills 24, scored 4 → FAILED','ok', (v_res->>'forced')::boolean AND v_s.phase = 'RESOLVED'
        AND v_s.outcome_reason = 'FORCED' AND v_s.score = 4 AND (SELECT count(*) FROM public.raid_clash_inputs WHERE session_id = v_s.id) = 24,
        'd', jsonb_build_object('score', v_s.score));

  -- ── H. no volunteer → unchanged ──
  v_h := pg_temp.t_mk_raid('CLASH2-H', 100000, 100000, v_teacher, v_sid);
  PERFORM pg_temp.t_draw(v_h, v_teacher, NULL);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = v_h;
  r := r || jsonb_build_object('t','H1 no volunteer → FAILED, 20% of current','ok', v_s.outcome = 'FAILED' AND v_s.outcome_reason = 'NO_VOLUNTEER'
        AND v_s.barrier_penalty_amount = 20000 AND NOT EXISTS (SELECT 1 FROM public.raid_clash_players WHERE session_id = v_s.id), 'd', v_s.outcome_reason);

  -- ── L. existing V1 session (back-filled) still reads correctly ──
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = (SELECT min(id) FROM public.raid_clash_sessions);
  v_res := public.raid_clash_public_state(v_s.raid_id, NULL)->'session';
  r := r || jsonb_build_object('t','L1 V1 session back-filled as 1 player','ok', v_s.player_count = 1 AND jsonb_array_length(v_res->'players') = 1
        AND (v_res->>'score_max')::int = 16 AND (v_res->>'score')::int = v_s.score
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'inputs') e WHERE (e->>'slot')::int <> 0), 'd', jsonb_build_object('id', v_s.id, 'n', v_s.player_count));

  -- ── P. privileges ──
  r := r || jsonb_build_object('t','P1 privileges','ok',
        NOT has_function_privilege('anon','public.student_ready_raid_clash(bigint)','EXECUTE')
        AND has_function_privilege('authenticated','public.student_submit_raid_clash_input(bigint,integer,text,integer)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_clash_planned_players(jsonb)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_clash_outcome(integer,jsonb,integer)','EXECUTE')
        AND NOT has_table_privilege('authenticated','public.raid_clash_players','SELECT')
        AND NOT has_table_privilege('anon','public.raid_clash_players','SELECT'), 'd', NULL);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), COALESCE(jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean,false)), '[]'::jsonb)
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'CLASH2_TEST_RESULT pass=% total=% failed=%', v_pass, jsonb_array_length(r), v_fail;
END;
$test$;
