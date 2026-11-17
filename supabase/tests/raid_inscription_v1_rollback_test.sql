-- B.R.A.N.D 2.0 — 주문 각인 V1 server test (ROLLBACK SANDBOX)
-- Run AFTER the migration text in the SAME query string. The final RAISE aborts everything.

CREATE FUNCTION pg_temp.t_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

-- raid in classroom 5: 10,000 HP, every hit exactly 1,000, barrier 500,000 / 1,000,000
CREATE FUNCTION pg_temp.t_mk(p_title text, p_students integer[]) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  UPDATE public.raids SET status = 'FAILED' WHERE classroom_id = 5 AND status IN ('LOBBY_OPEN','ACTIVE','PAUSED');
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'각인 테스트 보스','FIRE',10000,10000,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
  UPDATE public.raid_patterns SET is_enabled = false WHERE raid_id = v;
  INSERT INTO public.raid_combat_configs(raid_id) VALUES (v) ON CONFLICT (raid_id) DO NOTHING;
  UPDATE public.raid_combat_configs SET enabled = true, boss_attack_interval_seconds = 60, boss_attack_fixed_damage = 0, boss_attack_barrier_ratio = 0.04 WHERE raid_id = v;
  INSERT INTO public.raid_phases(raid_id, phase_no, hp_from_ratio, hp_to_ratio, metadata) VALUES (v, 1, 1.0, 0, '{}'::jsonb);
  INSERT INTO public.raid_combat_states(raid_id, barrier_max_hp, barrier_current_hp, next_boss_attack_at)
  VALUES (v, 1000000, 500000, clock_timestamp() + interval '60 seconds')
  ON CONFLICT (raid_id) DO UPDATE SET barrier_max_hp = excluded.barrier_max_hp, barrier_current_hp = excluded.barrier_current_hp, next_boss_attack_at = excluded.next_boss_attack_at;
  INSERT INTO public.raid_participants(raid_id,student_id,snapshot_student_name,snapshot_owned_shard_count,snapshot_raid_power,
         snapshot_base_crit_bp,snapshot_shard_crit_bp,snapshot_collection_crit_bp,snapshot_final_crit_bp,snapshot_element_power)
  SELECT v, s, '테스트학생' || s, 0, 1000, 0, 0, 0, 0, '{}'::jsonb FROM unnest(p_students) s;
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.t_go(p_raid bigint) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.raids SET status = 'ACTIVE', starts_at = clock_timestamp(), ends_at = clock_timestamp() + interval '10 minutes' WHERE id = p_raid;
$f$;

CREATE FUNCTION pg_temp.t_s(p_raid bigint) RETURNS public.raid_inscription_sessions LANGUAGE sql AS $f$
  SELECT * FROM public.raid_inscription_sessions WHERE raid_id = p_raid ORDER BY id DESC LIMIT 1;
$f$;

CREATE FUNCTION pg_temp.t_pid(p_raid bigint, p_student integer) RETURNS bigint LANGUAGE sql AS $f$
  SELECT id FROM public.raid_participants WHERE raid_id = p_raid AND student_id = p_student;
$f$;

CREATE FUNCTION pg_temp.t_tap(p_raid bigint) RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN
  RETURN public.submit_raid_tap_batch(p_raid, gen_random_uuid(), jsonb_build_array(jsonb_build_object('x',0.5,'y',0.5,'client_t',0)));
END $f$;

-- clock helpers: pretend time has passed
CREATE FUNCTION pg_temp.t_close_volunteering(p_raid bigint) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.raid_inscription_sessions
     SET volunteer_accept_until = clock_timestamp() - interval '1 second', draw_at = clock_timestamp() - interval '0.5 second'
   WHERE raid_id = p_raid AND phase = 'VOLUNTEERING';
$f$;
CREATE FUNCTION pg_temp.t_start_play(p_raid bigint) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.raid_inscription_sessions
     SET play_starts_at = clock_timestamp() - interval '5 seconds', play_deadline_at = clock_timestamp() + interval '10 seconds'
   WHERE raid_id = p_raid AND phase IN ('SELECTED','PLAYING');
$f$;
CREATE FUNCTION pg_temp.t_end_result_screen(p_raid bigint) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.raid_inscription_sessions SET resume_at = clock_timestamp() - interval '0.1 second'
   WHERE raid_id = p_raid AND phase IN ('RESOLVED','CANCELLED');
  UPDATE public.raid_corruptions SET starts_at = clock_timestamp() - interval '0.1 second' WHERE raid_id = p_raid AND starts_at > clock_timestamp();
$f$;

DO $test$
DECLARE
  r jsonb := '[]'::jsonb;
  v_teacher uuid; v_uid uuid[]; v_sid integer[];
  v_a bigint; v_b bigint; v_c bigint; v_d bigint; v_e bigint;
  v_s public.raid_inscription_sessions%ROWTYPE; v_res jsonb; v_st jsonb; v_t jsonb; v_txt text;
  v_hp0 bigint; v_hp1 bigint; v_ends0 timestamptz; v_ends1 timestamptz; v_cnt integer; v_seq text; v_seqs jsonb;
  v_corr_pid bigint; v_clean_pid bigint; v_corr_uid uuid; v_clean_uid uuid; v_tot0 bigint; v_tot1 bigint;
  v_bar integer; v_fail jsonb; v_pass integer; v_until0 timestamptz; v_until1 timestamptz; v_err text;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 4) s;

  -- ── A. 설정 저장 / 꺼진 레이드 ─────────────────────────────────────────────
  v_a := pg_temp.t_mk('INS-A', v_sid);
  PERFORM pg_temp.t_go(v_a);
  UPDATE public.raids SET current_hp = 3000 WHERE id = v_a;
  PERFORM pg_temp.t_as(v_uid[1]);
  PERFORM pg_temp.t_tap(v_a);
  r := r || jsonb_build_object('t','A1 no config: HP under any point starts nothing','ok',
        NOT EXISTS (SELECT 1 FROM public.raid_inscription_sessions WHERE raid_id = v_a), 'd', NULL);

  v_b := pg_temp.t_mk('INS-B', v_sid);
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_save_raid_inscription_config(v_b, '{"enabled":true,"difficulty":"NORMAL","player_count":3,"auto_trigger_percents":[75,35],"corruption_count":2}'::jsonb);
  r := r || jsonb_build_object('t','A2 save NORMAL: preset letters/time, points 75/35','ok',
        (v_res->>'letter_count')::int = 10 AND (v_res->>'time_limit_seconds')::numeric = 22
        AND v_res->'auto_trigger_percents' = '[75,35]'::jsonb AND (v_res->>'corruption_count')::int = 2, 'd', v_res);
  BEGIN
    PERFORM public.teacher_save_raid_inscription_config(v_b, '{"enabled":true,"difficulty":"CUSTOM","letter_count":20}'::jsonb);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  r := r || jsonb_build_object('t','A3 letter_count 20 refused','ok', v_err LIKE '%8~16%', 'd', v_err);
  PERFORM pg_temp.t_go(v_b);
  BEGIN
    PERFORM public.teacher_save_raid_inscription_config(v_b, '{"enabled":false}'::jsonb);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  r := r || jsonb_build_object('t','A4 config locked after start','ok', v_err LIKE '%전투 시작 전%', 'd', v_err);

  -- ── B. 자동 발동 / 전투 정지 ───────────────────────────────────────────────
  UPDATE public.raids SET current_hp = 7600 WHERE id = v_b;
  SELECT ends_at INTO v_ends0 FROM public.raids WHERE id = v_b;
  PERFORM pg_temp.t_as(v_uid[1]);
  PERFORM pg_temp.t_tap(v_b);   -- 7600 → 6600, crosses 75%
  v_s := pg_temp.t_s(v_b);
  r := r || jsonb_build_object('t','B1 crossing 75% opens volunteering (AUTO 0.75)','ok',
        v_s.phase = 'VOLUNTEERING' AND v_s.trigger_source = 'AUTO' AND v_s.trigger_ratio = 0.75 AND length(v_s.first_sequence) = 10
        AND v_s.first_sequence ~ '^[ASDFJKL]+$', 'd', to_jsonb(v_s));
  v_t := pg_temp.t_tap(v_b);
  r := r || jsonb_build_object('t','B2 attacks rejected while inscription runs','ok',
        (v_t->>'accepted')::int = 0 AND v_t#>>'{results,0,reason}' = 'INSCRIPTION_ACTIVE', 'd', v_t);
  r := r || jsonb_build_object('t','B3 raid_clash_is_frozen covers inscription','ok', public.raid_clash_is_frozen(v_b), 'd', NULL);

  -- ── C. 지원 / 선생님 선택 / 비밀 ───────────────────────────────────────────
  FOR i IN 1..4 LOOP
    PERFORM pg_temp.t_as(v_uid[i]);
    v_res := public.student_volunteer_raid_inscription(v_b);
  END LOOP;
  r := r || jsonb_build_object('t','C1 four volunteers accepted','ok',
        (SELECT count(*) FROM public.raid_inscription_entries WHERE session_id = v_s.id) = 4 AND (v_res->>'accepted')::boolean, 'd', v_res);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_set_raid_inscription_selection_mode(v_b, 'TEACHER');
  BEGIN
    PERFORM public.teacher_pick_raid_inscription_players(v_b, ARRAY[pg_temp.t_pid(v_a, v_sid[1])]);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  r := r || jsonb_build_object('t','C2 picking a non-volunteer refused','ok', v_err LIKE '%지원하지 않았%', 'd', v_err);
  v_res := public.teacher_pick_raid_inscription_players(v_b, ARRAY[pg_temp.t_pid(v_b, v_sid[4])]);
  r := r || jsonb_build_object('t','C3 teacher pick stored, still volunteering until close','ok',
        (v_res#>>'{session,picked}')::boolean AND v_res#>>'{session,phase}' = 'VOLUNTEERING'
        AND jsonb_array_length(v_res#>'{session,volunteers}') = 4, 'd', v_res);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_st := public.get_raid_battle_state(v_b);
  v_txt := v_st::text;
  r := r || jsonb_build_object('t','C4 student state hides mode, pick and letters','ok',
        v_txt NOT LIKE '%selection_mode%' AND v_txt NOT LIKE '%teacher_pick%' AND v_txt NOT LIKE '%TEACHER%'
        AND v_st#>'{inscription,first_sequence}' = 'null'::jsonb AND v_st#>>'{inscription,phase}' = 'VOLUNTEERING'
        AND (v_st#>>'{inscription,me,volunteered}')::boolean, 'd', v_st->'inscription');
  PERFORM pg_temp.t_close_volunteering(v_b);
  PERFORM public.raid_inscription_advance(v_b);
  v_s := pg_temp.t_s(v_b);
  r := r || jsonb_build_object('t','C5 draw: 3 of 4 selected, teacher pick in slot 1','ok',
        v_s.phase = 'SELECTED'
        AND (SELECT count(*) FROM public.raid_inscription_entries WHERE session_id = v_s.id AND slot IS NOT NULL) = 3
        AND (SELECT slot FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = pg_temp.t_pid(v_b, v_sid[4])) = 1
        AND (SELECT count(DISTINCT sequences[2]) FROM public.raid_inscription_entries WHERE session_id = v_s.id AND slot IS NOT NULL) = 3
        AND (SELECT bool_and(sequences[1] = v_s.first_sequence AND array_length(sequences,1) = 40) FROM public.raid_inscription_entries WHERE session_id = v_s.id AND slot IS NOT NULL),
        'd', to_jsonb(v_s));

  -- ── D. 입력 / 서버 확인 ─────────────────────────────────────────────────────
  PERFORM pg_temp.t_start_play(v_b);
  PERFORM public.raid_inscription_advance(v_b);
  -- pick the selected students: slot 1 = student 4; find two others
  SELECT array_agg(p.student_id ORDER BY e.slot) INTO v_sid
    FROM public.raid_inscription_entries e JOIN public.raid_participants p ON p.id = e.participant_id
   WHERE e.session_id = v_s.id AND e.slot IS NOT NULL;
  SELECT array_agg(st.user_id ORDER BY array_position(v_sid, st.id)) INTO v_uid FROM public.students st WHERE st.id = ANY(v_sid);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_st := public.get_raid_battle_state(v_b);
  v_seqs := v_st#>'{inscription,me,sequences}';
  r := r || jsonb_build_object('t','D1 playing: own 40 sequences, first shown to all','ok',
        v_st#>>'{inscription,phase}' = 'PLAYING' AND jsonb_array_length(v_seqs) = 40
        AND v_st#>>'{inscription,first_sequence}' = v_s.first_sequence
        AND v_st::text NOT LIKE '%' || (SELECT sequences[2] FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = pg_temp.t_pid(v_b, v_sid[2])) || '%',
        'd', v_st->'inscription');
  v_res := public.student_submit_raid_inscription(v_b, 0, 'AAAAAAAAAA', 9000);
  r := r || jsonb_build_object('t','D2 wrong letters refused','ok', v_res->>'reason' = 'WRONG_SEQUENCE', 'd', v_res);
  PERFORM public.student_report_raid_inscription_progress(v_b, 1, 4);
  v_res := public.student_submit_raid_inscription(v_b, 1, lower(v_seqs->>1), 8800);
  r := r || jsonb_build_object('t','D3 attempt 2 accepted (lower case ok), 1 mistake counted','ok',
        (v_res->>'accepted')::boolean AND (v_res#>>'{inscription,me,completed}')::boolean
        AND (v_res#>>'{inscription,me,mistakes}')::int = 1 AND (v_res#>>'{inscription,me,completed_ms}')::int BETWEEN 4990 AND 5200, 'd', v_res);
  PERFORM pg_temp.t_as(v_uid[2]);
  UPDATE public.raid_inscription_sessions SET play_starts_at = clock_timestamp() - interval '0.3 second' WHERE id = v_s.id;
  v_seq := (SELECT sequences[1] FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = pg_temp.t_pid(v_b, v_sid[2]));
  v_res := public.student_submit_raid_inscription(v_b, 0, v_seq, 300);
  r := r || jsonb_build_object('t','D4 impossibly fast submit refused','ok', v_res->>'reason' = 'TOO_FAST', 'd', v_res);
  PERFORM pg_temp.t_start_play(v_b);
  v_res := public.student_submit_raid_inscription(v_b, 0, v_seq, 4000);
  r := r || jsonb_build_object('t','D5 second student completes, still playing','ok',
        (v_res->>'accepted')::boolean AND v_res#>>'{inscription,phase}' = 'PLAYING', 'd', v_res);

  -- ── E. 실패 → 타락 ──────────────────────────────────────────────────────────
  UPDATE public.raid_inscription_sessions SET play_deadline_at = clock_timestamp() - interval '2 seconds' WHERE id = v_s.id;
  PERFORM public.raid_inscription_advance(v_b);
  v_s := pg_temp.t_s(v_b);
  SELECT ends_at INTO v_ends1 FROM public.raids WHERE id = v_b;
  r := r || jsonb_build_object('t','E1 one unfinished → FAILED TIME_UP, 2 corrupted among selected','ok',
        v_s.phase = 'RESOLVED' AND v_s.outcome = 'FAILED' AND v_s.outcome_reason = 'TIME_UP'
        AND (SELECT count(*) FROM public.raid_corruptions WHERE session_id = v_s.id) = 2
        AND NOT EXISTS (SELECT 1 FROM public.raid_corruptions c WHERE c.session_id = v_s.id
                         AND NOT EXISTS (SELECT 1 FROM public.raid_inscription_entries e WHERE e.session_id = v_s.id AND e.slot IS NOT NULL AND e.participant_id = c.participant_id)),
        'd', to_jsonb(v_s));
  r := r || jsonb_build_object('t','E2 stopped time returned to raid end time','ok',
        v_ends1 > v_ends0 AND v_ends1 - v_ends0 BETWEEN make_interval(secs => v_s.frozen_seconds - 1) AND make_interval(secs => v_s.frozen_seconds + 1)
        AND v_s.frozen_seconds > 0, 'd', jsonb_build_object('before',v_ends0,'after',v_ends1,'frozen',v_s.frozen_seconds));
  r := r || jsonb_build_object('t','E3 3-second result screen still stops attacks; corruption waits','ok',
        public.raid_inscription_is_active(v_b)
        AND (SELECT bool_and(starts_at = v_s.resume_at) FROM public.raid_corruptions WHERE session_id = v_s.id), 'd', NULL);
  PERFORM pg_temp.t_as(v_teacher);
  v_st := public.teacher_get_raid_broadcast_state(v_b);
  r := r || jsonb_build_object('t','E4 broadcast shows FAILED with 2 corrupted names','ok',
        v_st#>>'{inscription,outcome}' = 'FAILED' AND jsonb_array_length(v_st#>'{inscription,corrupted}') = 2
        AND (v_st#>>'{corruption,count}')::int = 2, 'd', jsonb_build_object('i',v_st->'inscription','c',v_st->'corruption'));

  PERFORM pg_temp.t_end_result_screen(v_b);
  SELECT c.participant_id INTO v_corr_pid FROM public.raid_corruptions c WHERE c.session_id = v_s.id ORDER BY c.id LIMIT 1;
  SELECT p.id INTO v_clean_pid FROM public.raid_participants p WHERE p.raid_id = v_b
     AND NOT EXISTS (SELECT 1 FROM public.raid_corruptions c WHERE c.session_id = v_s.id AND c.participant_id = p.id) ORDER BY p.id LIMIT 1;
  SELECT st.user_id INTO v_corr_uid FROM public.students st JOIN public.raid_participants p ON p.student_id = st.id WHERE p.id = v_corr_pid;
  SELECT st.user_id INTO v_clean_uid FROM public.students st JOIN public.raid_participants p ON p.student_id = st.id WHERE p.id = v_clean_pid;
  PERFORM pg_temp.t_as(v_corr_uid);
  SELECT current_hp INTO v_hp0 FROM public.raids WHERE id = v_b;
  SELECT total_damage INTO v_tot0 FROM public.raid_participants WHERE id = v_corr_pid;
  v_t := pg_temp.t_tap(v_b);
  SELECT current_hp INTO v_hp1 FROM public.raids WHERE id = v_b;
  SELECT total_damage INTO v_tot1 FROM public.raid_participants WHERE id = v_corr_pid;
  r := r || jsonb_build_object('t','E5 corrupted hit heals boss by its damage, own total unchanged','ok',
        v_hp1 - v_hp0 = 1000 AND v_tot1 = v_tot0 AND v_t#>>'{results,0,pattern_effect}' = 'CORRUPTED'
        AND (v_t#>>'{results,0,boss_heal}')::bigint = 1000
        AND (SELECT healed_amount FROM public.raid_corruptions WHERE session_id = v_s.id AND participant_id = v_corr_pid) = 1000,
        'd', v_t);
  v_st := public.get_raid_battle_state(v_b);
  r := r || jsonb_build_object('t','E6 student sees own corruption with seconds left','ok',
        (v_st#>>'{corruption,me,active}')::boolean AND (v_st#>>'{corruption,me,seconds_remaining}')::numeric > 5
        AND v_st#>>'{corruption,label}' = '타락', 'd', v_st->'corruption');
  PERFORM pg_temp.t_as(v_clean_uid);
  SELECT current_hp INTO v_hp0 FROM public.raids WHERE id = v_b;
  PERFORM pg_temp.t_tap(v_b);
  SELECT current_hp INTO v_hp1 FROM public.raids WHERE id = v_b;
  r := r || jsonb_build_object('t','E7 others still deal normal damage','ok', v_hp0 - v_hp1 = 1000, 'd', NULL);
  r := r || jsonb_build_object('t','E8 the 75% point never fires twice','ok',
        (SELECT count(*) FROM public.raid_inscription_sessions WHERE raid_id = v_b) = 1, 'd', NULL);

  -- clash shift extends running corruption
  SELECT until INTO v_until0 FROM public.raid_corruptions WHERE session_id = v_s.id AND participant_id = v_corr_pid;
  PERFORM public.raid_clash_shift_timeline(v_b, interval '20 seconds');
  SELECT until INTO v_until1 FROM public.raid_corruptions WHERE session_id = v_s.id AND participant_id = v_corr_pid;
  r := r || jsonb_build_object('t','E9 clash time return also extends corruption','ok', v_until1 - v_until0 = interval '20 seconds', 'd', NULL);

  -- crossing 35% fires the second point
  UPDATE public.raids SET current_hp = 3600 WHERE id = v_b;
  PERFORM pg_temp.t_tap(v_b);
  v_s := pg_temp.t_s(v_b);
  r := r || jsonb_build_object('t','E10 crossing 35% fires the second automatic inscription','ok',
        v_s.seq_no = 2 AND v_s.trigger_ratio = 0.35 AND v_s.phase = 'VOLUNTEERING', 'd', to_jsonb(v_s));

  -- ── F. 취소 ─────────────────────────────────────────────────────────────────
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_cancel_raid_inscription(v_b);
  r := r || jsonb_build_object('t','F1 teacher cancel: CANCELLED, battle resumes at once','ok',
        v_res#>>'{session,phase}' = 'CANCELLED' AND NOT public.raid_inscription_is_active(v_b), 'd', v_res->'session');

  -- ── G. 성공 → 피해·방벽 / 아무도 지원 안 함 ─────────────────────────────────
  v_c := pg_temp.t_mk('INS-C', (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 4) s));
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_inscription_config(v_c, '{"enabled":true,"difficulty":"NORMAL","player_count":3}'::jsonb);
  PERFORM pg_temp.t_go(v_c);
  UPDATE public.raids SET current_hp = 8000 WHERE id = v_c;
  v_res := public.teacher_trigger_raid_inscription(v_c);
  r := r || jsonb_build_object('t','G1 teacher trigger works','ok', (v_res->>'triggered')::boolean AND v_res#>>'{inscription,phase}' = 'VOLUNTEERING', 'd', v_res);
  BEGIN
    PERFORM public.teacher_trigger_raid_inscription(v_c);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  r := r || jsonb_build_object('t','G2 second trigger while running refused','ok', v_err LIKE '%이미%', 'd', v_err);
  r := r || jsonb_build_object('t','G3 no clash can start during inscription','ok', public.raid_clash_begin(v_c) IS NULL, 'd', NULL);
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 2) s;
  FOR i IN 1..2 LOOP PERFORM pg_temp.t_as(v_uid[i]); PERFORM public.student_volunteer_raid_inscription(v_c); END LOOP;
  PERFORM pg_temp.t_close_volunteering(v_c);
  PERFORM public.raid_inscription_advance(v_c);
  PERFORM pg_temp.t_start_play(v_c);
  PERFORM public.raid_inscription_advance(v_c);
  v_s := pg_temp.t_s(v_c);
  SELECT COALESCE(sum(total_damage),0) INTO v_tot0 FROM public.raid_participants WHERE raid_id = v_c;
  FOR i IN 1..2 LOOP
    PERFORM pg_temp.t_as(v_uid[i]);
    v_res := public.student_submit_raid_inscription(v_c, 0,
               (SELECT sequences[1] FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = pg_temp.t_pid(v_c, v_sid[i])), 6000);
  END LOOP;
  v_s := pg_temp.t_s(v_c);
  SELECT barrier_current_hp INTO v_bar FROM public.raid_combat_states WHERE raid_id = v_c;
  SELECT COALESCE(sum(total_damage),0) INTO v_tot1 FROM public.raid_participants WHERE raid_id = v_c;
  r := r || jsonb_build_object('t','G4 all done → SUCCESS at once: 4% boss damage split, barrier +20%','ok',
        v_s.outcome = 'SUCCESS' AND v_s.boss_damage = 400
        AND (SELECT current_hp FROM public.raids WHERE id = v_c) = 7600
        AND v_tot1 - v_tot0 = 400 AND v_bar = 700000 AND v_s.barrier_heal = 200000
        AND v_res#>>'{inscription,outcome}' = 'SUCCESS', 'd', to_jsonb(v_s));

  -- 아무도 지원 안 함
  PERFORM pg_temp.t_end_result_screen(v_c);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_trigger_raid_inscription(v_c);
  PERFORM pg_temp.t_close_volunteering(v_c);
  PERFORM public.raid_inscription_advance(v_c);
  v_s := pg_temp.t_s(v_c);
  r := r || jsonb_build_object('t','G5 no volunteers → FAILED, 3 corrupted from the whole raid','ok',
        v_s.outcome = 'FAILED' AND v_s.outcome_reason = 'NO_VOLUNTEERS'
        AND (SELECT count(*) FROM public.raid_corruptions WHERE session_id = v_s.id) = 3, 'd', to_jsonb(v_s));

  -- ── H. 격돌과 함께 ───────────────────────────────────────────────────────────
  v_d := pg_temp.t_mk('INS-D', v_sid);
  PERFORM pg_temp.t_as(v_teacher);
  PERFORM public.teacher_save_raid_clash_config(v_d, '{"enabled":true,"difficulty":"EASY","player_count":1}'::jsonb);
  PERFORM public.teacher_save_raid_inscription_config(v_d, '{"enabled":true,"difficulty":"HARD","player_count":1,"corruption_count":1}'::jsonb);
  PERFORM pg_temp.t_go(v_d);
  UPDATE public.raids SET current_hp = 5200 WHERE id = v_d;
  PERFORM public.teacher_trigger_raid_inscription(v_d);
  PERFORM pg_temp.t_as(v_uid[1]); PERFORM public.student_volunteer_raid_inscription(v_d);
  PERFORM pg_temp.t_close_volunteering(v_d); PERFORM public.raid_inscription_advance(v_d);
  PERFORM pg_temp.t_start_play(v_d); PERFORM public.raid_inscription_advance(v_d);
  v_s := pg_temp.t_s(v_d);
  v_res := public.student_submit_raid_inscription(v_d, 0,
             (SELECT sequences[1] FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = pg_temp.t_pid(v_d, v_sid[1])), 9000);
  v_s := pg_temp.t_s(v_d);
  r := r || jsonb_build_object('t','H1 success damage stops above 50% while clash is still armed','ok',
        v_s.outcome = 'SUCCESS' AND v_s.boss_damage_capped AND (SELECT current_hp FROM public.raids WHERE id = v_d) = 5001, 'd', to_jsonb(v_s));
  PERFORM pg_temp.t_end_result_screen(v_d);
  PERFORM pg_temp.t_tap(v_d);  -- 5001 → 4001 crosses 50% → clash
  r := r || jsonb_build_object('t','H2 next hit still starts the clash','ok', public.raid_inscription_clash_busy(v_d), 'd', NULL);
  PERFORM pg_temp.t_as(v_teacher);
  BEGIN
    PERFORM public.teacher_trigger_raid_inscription(v_d);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  r := r || jsonb_build_object('t','H3 manual trigger during clash refused','ok', v_err LIKE '%격돌%', 'd', v_err);
  v_e := public.raid_inscription_begin(v_d, 'AUTO', 0.30);
  v_s := pg_temp.t_s(v_d);
  r := r || jsonb_build_object('t','H4 automatic inscription during clash waits (PENDING)','ok',
        v_e IS NOT NULL AND v_s.phase = 'PENDING' AND NOT public.raid_inscription_is_active(v_d), 'd', to_jsonb(v_s));
  UPDATE public.raid_clash_sessions SET phase = 'RESOLVED', outcome = 'FAILED', resolved_at = clock_timestamp() WHERE raid_id = v_d;
  PERFORM public.raid_inscription_advance(v_d);
  v_s := pg_temp.t_s(v_d);
  r := r || jsonb_build_object('t','H5 after the clash it opens volunteering','ok', v_s.phase = 'VOLUNTEERING' AND v_s.triggered_at IS NOT NULL, 'd', to_jsonb(v_s));

  -- ── I. 권한 / 표식 ───────────────────────────────────────────────────────────
  r := r || jsonb_build_object('t','I1 internal functions closed to students','ok',
        NOT has_function_privilege('authenticated','public.raid_inscription_advance(bigint)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_inscription_resolve(bigint,text,text)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_inscription_public_state(bigint,bigint)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_inscription_begin(bigint,text,numeric)','EXECUTE')
        AND has_function_privilege('authenticated','public.student_submit_raid_inscription(bigint,integer,text,integer)','EXECUTE'), 'd', NULL);
  r := r || jsonb_build_object('t','I2 tables closed to students','ok',
        NOT has_table_privilege('authenticated','public.raid_inscription_entries','SELECT')
        AND NOT has_table_privilege('authenticated','public.raid_inscription_sessions','SELECT')
        AND NOT has_table_privilege('authenticated','public.raid_corruptions','SELECT')
        AND NOT has_table_privilege('anon','public.raid_inscription_configs','SELECT'), 'd', NULL);
  r := r || jsonb_build_object('t','I3 all 11 markers present','ok',
        position('/*INSCRIPTION:vars*/' in pg_get_functiondef('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:frozen*/' in pg_get_functiondef('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:corrupted_flag*/' in pg_get_functiondef('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:corruption*/' in pg_get_functiondef('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:after_batch*/' in pg_get_functiondef('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:tick*/' in pg_get_functiondef('public.raid_combat_tick(bigint)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:frozen_check*/' in pg_get_functiondef('public.raid_clash_is_frozen(bigint)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:shift*/' in pg_get_functiondef('public.raid_clash_shift_timeline(bigint,interval)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:clash_guard*/' in pg_get_functiondef('public.raid_clash_begin(bigint)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:state*/' in pg_get_functiondef('public.get_raid_battle_state(bigint)'::regprocedure)) > 0
        AND position('/*INSCRIPTION:broadcast*/' in pg_get_functiondef('public.teacher_get_raid_broadcast_state(bigint)'::regprocedure)) > 0, 'd', NULL);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), COALESCE(jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean,false)),'[]'::jsonb)
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'INSCRIPTION_TEST_RESULT pass=%/% fail=%', v_pass, jsonb_array_length(r), v_fail;
END
$test$;
