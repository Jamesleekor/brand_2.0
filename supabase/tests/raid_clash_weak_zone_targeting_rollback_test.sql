-- B.R.A.N.D 2.0 — CLASH 약점 × C/D 영역 판정 server test (ROLLBACK SANDBOX)
-- Run AFTER the migration text in the SAME query string. The final RAISE aborts everything.

CREATE FUNCTION pg_temp.t_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

-- p_mode: 'BODY' | 'DOMAIN' | 'ANCHOR'; p_face: hud_v3.face_zone or NULL
CREATE FUNCTION pg_temp.t_mk(p_title text, p_students integer[], p_mode text, p_face jsonb) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint; v_phase bigint; v_meta jsonb := '{}'::jsonb;
BEGIN
  UPDATE public.raids SET status = 'FAILED' WHERE classroom_id = 5 AND status IN ('LOBBY_OPEN','ACTIVE','PAUSED');
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'WZ 테스트 보스','FIRE',100000,100000,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
  UPDATE public.raid_patterns SET is_enabled = false WHERE raid_id = v;
  INSERT INTO public.raid_combat_configs(raid_id) VALUES (v) ON CONFLICT (raid_id) DO NOTHING;
  UPDATE public.raid_combat_configs SET enabled = true, boss_attack_interval_seconds = 60, boss_attack_fixed_damage = 0, boss_attack_barrier_ratio = 0.04 WHERE raid_id = v;
  IF p_mode <> 'BODY' THEN v_meta := jsonb_build_object('targeting_v1', jsonb_build_object('mode', p_mode)); END IF;
  IF p_face IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('hud_v3', jsonb_build_object('version',1,'face_zone',p_face)); END IF;
  INSERT INTO public.raid_phases(raid_id, phase_no, hp_from_ratio, hp_to_ratio, metadata) VALUES (v, 1, 1.0, 0, v_meta) RETURNING id INTO v_phase;
  IF p_mode <> 'BODY' THEN
    -- 제피라와 같은 지배 영역
    INSERT INTO public.raid_hit_zones(raid_phase_id, zone_key, name, x, y, width, height)
    VALUES (v_phase, 'PRIMARY_TARGET', '지배 영역', 0.63, 0.10, 0.145, 0.36);
  END IF;
  INSERT INTO public.raid_combat_states(raid_id, barrier_max_hp, barrier_current_hp, next_boss_attack_at)
  VALUES (v, 1000000, 500000, clock_timestamp() + interval '60 seconds')
  ON CONFLICT (raid_id) DO UPDATE SET barrier_max_hp = excluded.barrier_max_hp, barrier_current_hp = excluded.barrier_current_hp, next_boss_attack_at = excluded.next_boss_attack_at;
  INSERT INTO public.raid_participants(raid_id,student_id,snapshot_student_name,snapshot_owned_shard_count,snapshot_raid_power,
         snapshot_base_crit_bp,snapshot_shard_crit_bp,snapshot_collection_crit_bp,snapshot_final_crit_bp,snapshot_element_power)
  SELECT v, s, '테스트학생' || s, 0, 1000, 0, 0, 0, 0, '{}'::jsonb FROM unnest(p_students) s;
  RETURN v;
END $f$;

-- teacher saves clash config (EASY, 3명) then the raid goes ACTIVE
CREATE FUNCTION pg_temp.t_go(p_raid bigint, p_teacher uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.t_as(p_teacher);
  PERFORM public.teacher_save_raid_clash_config(p_raid, '{"enabled":true,"difficulty":"EASY","player_count":3}'::jsonb);
  UPDATE public.raids SET status = 'ACTIVE', starts_at = clock_timestamp() WHERE id = p_raid;
END $f$;

CREATE FUNCTION pg_temp.t_wz(p_raid bigint) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT weak_zone FROM public.raid_clash_sessions WHERE raid_id = p_raid;
$f$;

-- clash already won: buff active (or expired) with the given weak zone
CREATE FUNCTION pg_temp.t_buff(p_raid bigint, p_zone jsonb, p_active boolean) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.raid_clash_sessions
     SET phase = 'RESOLVED', outcome = 'SUCCESS', clash_component = 1.5, weak_zone = COALESCE(p_zone, weak_zone),
         resolved_at = clock_timestamp() - interval '1 second',
         buff_until = clock_timestamp() + CASE WHEN p_active THEN interval '9 seconds' ELSE interval '-1 second' END
   WHERE raid_id = p_raid;
$f$;

CREATE FUNCTION pg_temp.t_tap(p_raid bigint, p_x numeric, p_y numeric) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  v := public.submit_raid_tap_batch(p_raid, gen_random_uuid(),
         jsonb_build_array(jsonb_build_object('x',p_x,'y',p_y,'client_t',0)));
  RETURN v->'results'->0;
END $f$;

DO $test$
DECLARE
  r jsonb := '[]'::jsonb;
  v_teacher uuid; v_uid uuid[]; v_sid integer[];
  v_a bigint; v_b bigint; v_c bigint; v_d bigint;
  v_z jsonb; v_t jsonb; v_hp0 bigint; v_hp1 bigint; v_fail jsonb; v_pass integer;
  c_old jsonb := '{"x":0.40,"y":0.26,"width":0.20,"height":0.26,"multiplier":2.0}'::jsonb;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT array_agg(user_id ORDER BY id), array_agg(id ORDER BY id) INTO v_uid, v_sid
    FROM (SELECT * FROM public.students WHERE classroom_id = 5 AND role::text = 'STUDENT' AND transferred_at IS NULL AND user_id IS NOT NULL ORDER BY id LIMIT 3) s;

  -- ── A. DOMAIN, 얼굴 영역 없음 → 약점이 지배 영역 안(영역 가운데) ──
  v_a := pg_temp.t_mk('WZ-A', v_sid, 'DOMAIN', NULL);
  PERFORM pg_temp.t_go(v_a, v_teacher);
  PERFORM public.teacher_trigger_raid_clash(v_a);
  v_z := pg_temp.t_wz(v_a);
  r := r || jsonb_build_object('t','A1 DOMAIN weak zone fits inside the domain','ok',
        (v_z->>'x')::numeric = 0.63 AND (v_z->>'y')::numeric = 0.15
        AND (v_z->>'width')::numeric = 0.145 AND (v_z->>'height')::numeric = 0.26
        AND (v_z->>'multiplier')::numeric = 2, 'd', v_z);
  r := r || jsonb_build_object('t','A2 weak zone lies fully inside PRIMARY_TARGET','ok',
        (v_z->>'x')::numeric >= 0.63 AND (v_z->>'x')::numeric + (v_z->>'width')::numeric <= 0.775
        AND (v_z->>'y')::numeric >= 0.10 AND (v_z->>'y')::numeric + (v_z->>'height')::numeric <= 0.46, 'd', v_z);
  r := r || jsonb_build_object('t','A3 public state shows the moved weak zone','ok',
        (public.raid_clash_public_state(v_a, NULL)#>'{session,weak_zone}') = v_z
        OR (public.raid_clash_public_state(v_a, NULL)->'weak_zone') = v_z, 'd', public.raid_clash_public_state(v_a, NULL));

  -- A4~A6: buff active → tap in weak zone accepted, tap outside both rejected
  PERFORM pg_temp.t_buff(v_a, NULL, true);
  PERFORM pg_temp.t_as(v_uid[1]);
  SELECT current_hp INTO v_hp0 FROM public.raids WHERE id = v_a;
  v_t := pg_temp.t_tap(v_a, 0.70, 0.28);
  SELECT current_hp INTO v_hp1 FROM public.raids WHERE id = v_a;
  r := r || jsonb_build_object('t','A4 tap on moved weak zone accepted with clash damage','ok',
        COALESCE((v_t->>'accepted')::boolean,false) AND v_hp0 - v_hp1 >= 3000, 'd', jsonb_build_object('res',v_t,'dmg',v_hp0 - v_hp1));
  v_t := pg_temp.t_tap(v_a, 0.20, 0.80);
  r := r || jsonb_build_object('t','A5 tap outside domain and weak zone still rejected','ok',
        NOT COALESCE((v_t->>'accepted')::boolean,true) AND v_t->>'reason' = 'OUTSIDE_TARGET_ZONE', 'd', v_t);
  v_t := pg_temp.t_tap(v_a, 0.65, 0.42);
  r := r || jsonb_build_object('t','A6 domain tap outside weak zone accepted (normal)','ok',
        COALESCE((v_t->>'accepted')::boolean,false), 'd', v_t);

  -- ── B. DOMAIN + 얼굴 영역 → 얼굴 중심 쪽, 영역 밖으로는 안 나감 ──
  v_b := pg_temp.t_mk('WZ-B', v_sid, 'DOMAIN', '{"x":0.66,"y":0.11,"width":0.08,"height":0.08}'::jsonb);
  PERFORM pg_temp.t_go(v_b, v_teacher);
  PERFORM public.teacher_trigger_raid_clash(v_b);
  v_z := pg_temp.t_wz(v_b);
  r := r || jsonb_build_object('t','B1 face zone pulls weak zone up, clamped to domain top','ok',
        (v_z->>'x')::numeric = 0.63 AND (v_z->>'y')::numeric = 0.10 AND (v_z->>'height')::numeric = 0.26, 'd', v_z);

  -- ── C. 일반 보스(BODY) → 기존 가운데 약점 그대로, 화면 어디든 공격 가능 ──
  v_c := pg_temp.t_mk('WZ-C', v_sid, 'BODY', NULL);
  PERFORM pg_temp.t_go(v_c, v_teacher);
  PERFORM public.teacher_trigger_raid_clash(v_c);
  v_z := pg_temp.t_wz(v_c);
  r := r || jsonb_build_object('t','C1 BODY boss keeps the original center weak zone','ok',
        (v_z->>'x')::numeric = 0.40 AND (v_z->>'y')::numeric = 0.26 AND (v_z->>'width')::numeric = 0.20 AND (v_z->>'height')::numeric = 0.26, 'd', v_z);
  PERFORM pg_temp.t_buff(v_c, NULL, true);
  PERFORM pg_temp.t_as(v_uid[1]);
  v_t := pg_temp.t_tap(v_c, 0.10, 0.90);
  r := r || jsonb_build_object('t','C2 BODY boss tap anywhere accepted','ok', COALESCE((v_t->>'accepted')::boolean,false), 'd', v_t);

  -- ── D. 안전장치: 약점이 영역 밖(옛 위치)에 있어도 버프 중에는 받음, 버프 끝나면 다시 막힘 ──
  v_d := pg_temp.t_mk('WZ-D', v_sid, 'DOMAIN', NULL);
  PERFORM pg_temp.t_go(v_d, v_teacher);
  PERFORM public.teacher_trigger_raid_clash(v_d);
  PERFORM pg_temp.t_buff(v_d, c_old, true);
  PERFORM pg_temp.t_as(v_uid[1]);
  SELECT current_hp INTO v_hp0 FROM public.raids WHERE id = v_d;
  v_t := pg_temp.t_tap(v_d, 0.50, 0.35);
  SELECT current_hp INTO v_hp1 FROM public.raids WHERE id = v_d;
  r := r || jsonb_build_object('t','D1 old-position weak zone outside domain accepted during buff','ok',
        COALESCE((v_t->>'accepted')::boolean,false) AND v_hp0 - v_hp1 >= 3000, 'd', jsonb_build_object('res',v_t,'dmg',v_hp0 - v_hp1));
  PERFORM pg_temp.t_buff(v_d, c_old, false);
  v_t := pg_temp.t_tap(v_d, 0.50, 0.35);
  r := r || jsonb_build_object('t','D2 after buff ends the same spot is rejected again','ok',
        NOT COALESCE((v_t->>'accepted')::boolean,true) AND v_t->>'reason' = 'OUTSIDE_TARGET_ZONE', 'd', v_t);

  -- ── E. 헬퍼 단위 / 권한 ──
  r := r || jsonb_build_object('t','E1 weak_zone_hit false without buff','ok',
        NOT public.raid_clash_weak_zone_hit(jsonb_build_object('buff_active',false,'weak_zone',c_old),0.5,0.35), 'd', NULL);
  r := r || jsonb_build_object('t','E2 weak_zone_hit tolerates garbage zone','ok',
        NOT public.raid_clash_weak_zone_hit('{"buff_active":true,"weak_zone":{"x":"bad"}}'::jsonb,0.5,0.35), 'd', NULL);
  r := r || jsonb_build_object('t','E3 helpers not executable by authenticated','ok',
        NOT has_function_privilege('authenticated','public.raid_clash_weak_zone_for_raid(bigint,jsonb)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.raid_clash_weak_zone_hit(jsonb,numeric,numeric)','EXECUTE'), 'd', NULL);
  r := r || jsonb_build_object('t','E4 markers present once','ok',
        position('/*CLASH_WZ_TARGET:begin*/' in pg_get_functiondef('public.raid_clash_begin(bigint)'::regprocedure)) > 0
        AND position('/*CLASH_WZ_TARGET:tap*/' in pg_get_functiondef('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)) > 0, 'd', NULL);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), COALESCE(jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean,false)),'[]'::jsonb)
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'WZ_TEST_RESULT pass=%/% fail=%', v_pass, jsonb_array_length(r), v_fail;
END
$test$;
