-- B.R.A.N.D 2.0 — Raid HUD v3 face zone: server test (ROLLBACK SANDBOX)
-- Run AFTER the migration text in the SAME query string. The final RAISE aborts everything.
-- Uses classroom 5 (B.R.A.N.D LOADTEST) and its teacher.

CREATE FUNCTION pg_temp.t_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

CREATE FUNCTION pg_temp.t_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM; END $f$;

CREATE FUNCTION pg_temp.t_mk(p_title text, p_status text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  INSERT INTO public.raids(classroom_id,title,boss_name,boss_element,max_hp,current_hp,status,damage_coefficient,variance_min,variance_max,crit_multiplier,tap_rate_limit_per_second)
  VALUES (5,p_title,'HUD 테스트 보스','FIRE',100000,100000,'DRAFT',1,1,1,2,7) RETURNING id INTO v;
  INSERT INTO public.raid_phases(raid_id, phase_no, hp_from_ratio, hp_to_ratio, metadata)
  VALUES (v, 1, 1.0, 0, '{"visual_v2":{"keep":true}}'::jsonb);
  IF p_status <> 'DRAFT' THEN
    UPDATE public.raids SET status = p_status WHERE id = v;
  END IF;
  RETURN v;
END $f$;

DO $test$
DECLARE
  r jsonb := '[]'::jsonb;
  v_teacher uuid; v_other uuid;
  v_a bigint; v_done bigint; v_act bigint;
  v_res jsonb; v_txt text; v_meta jsonb; v_pass integer; v_fail jsonb;
BEGIN
  SELECT teacher_user_id INTO v_teacher FROM public.classrooms WHERE id = 5;
  SELECT c.teacher_user_id INTO v_other FROM public.classrooms c WHERE c.id <> 5 AND c.teacher_user_id IS NOT NULL AND c.teacher_user_id <> v_teacher LIMIT 1;

  v_a := pg_temp.t_mk('HUDV3-A', 'DRAFT');
  v_done := pg_temp.t_mk('HUDV3-DONE', 'COMPLETED');
  v_act := pg_temp.t_mk('HUDV3-ACT', 'ACTIVE');

  -- P1 public config for a phase without hud_v3
  v_res := public.raid_targeting_public_config((SELECT id FROM public.raid_phases WHERE raid_id = v_a), (SELECT metadata FROM public.raid_phases WHERE raid_id = v_a));
  r := r || jsonb_build_object('t','P1 no hud_v3 → face null, AUTO, BODY valid','ok',
       jsonb_typeof(v_res->'face_zone') = 'null' AND v_res->>'hud_preset' = 'AUTO' AND v_res->>'mode' = 'BODY' AND (v_res->>'valid')::boolean, 'd', v_res);

  -- S1 teacher saves face zone + preset
  PERFORM pg_temp.t_as(v_teacher);
  v_res := public.teacher_save_raid_hud_layout(v_a, 1::smallint, '{"face_zone":{"x":0.53,"y":0.02,"width":0.14,"height":0.22},"preset":"b"}'::jsonb);
  v_meta := (SELECT metadata FROM public.raid_phases WHERE raid_id = v_a);
  r := r || jsonb_build_object('t','S1 save returns face zone + preset B','ok',
       (v_res->'face_zone'->>'x')::numeric = 0.53 AND (v_res->'face_zone'->>'height')::numeric = 0.22 AND v_res->>'hud_preset' = 'B', 'd', v_res);
  r := r || jsonb_build_object('t','S2 stored in metadata.hud_v3, other metadata kept','ok',
       v_meta->'hud_v3'->>'preset' = 'B' AND (v_meta->'hud_v3'->>'version')::int = 1 AND (v_meta->'visual_v2'->>'keep')::boolean, 'd', v_meta);

  -- S3 clear face zone
  v_res := public.teacher_save_raid_hud_layout(v_a, 1::smallint, '{"face_zone":null,"preset":"AUTO"}'::jsonb);
  r := r || jsonb_build_object('t','S3 face_zone null clears it','ok',
       jsonb_typeof(v_res->'face_zone') = 'null' AND v_res->>'hud_preset' = 'AUTO', 'd', v_res);

  -- V1..V5 validation
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_a, '{"face_zone":{"x":0.9,"y":0.1,"width":0.2,"height":0.2}}'));
  r := r || jsonb_build_object('t','V1 out of screen rejected (P0213)','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_a, '{"face_zone":{"x":0.1,"y":0.1,"width":0.01,"height":0.2}}'));
  r := r || jsonb_build_object('t','V2 too small rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_a, '{"face_zone":{"x":"abc","y":0.1,"width":0.2,"height":0.2}}'));
  r := r || jsonb_build_object('t','V3 non-numeric rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_a, '{"preset":"Z"}'));
  r := r || jsonb_build_object('t','V4 unknown preset rejected','ok', v_txt LIKE 'ERR:P0213%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 2::smallint, %L::jsonb)', v_a, '{"preset":"A"}'));
  r := r || jsonb_build_object('t','V5 missing phase P0202','ok', v_txt LIKE 'ERR:P0202%', 'd', v_txt);

  -- L1 ended raid locked, L2 active raid allowed
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_done, '{"preset":"A"}'));
  r := r || jsonb_build_object('t','L1 completed raid locked (P0215)','ok', v_txt LIKE 'ERR:P0215%', 'd', v_txt);
  v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_act, '{"face_zone":{"x":0.4,"y":0.05,"width":0.2,"height":0.25},"preset":"AUTO"}'));
  r := r || jsonb_build_object('t','L2 active raid can save (display only)','ok', v_txt = 'OK', 'd', v_txt);

  -- A1 other teacher denied
  IF v_other IS NOT NULL THEN
    PERFORM pg_temp.t_as(v_other);
    v_txt := pg_temp.t_try(format('SELECT public.teacher_save_raid_hud_layout(%s, 1::smallint, %L::jsonb)', v_a, '{"preset":"A"}'));
    r := r || jsonb_build_object('t','A1 other teacher denied','ok', v_txt LIKE 'ERR:%' AND v_txt NOT LIKE 'ERR:P0213%', 'd', v_txt);
    PERFORM pg_temp.t_as(v_teacher);
  END IF;

  -- K1 targeting save keeps hud_v3 (C/D save rewrites targeting_v1 only)
  PERFORM public.teacher_save_raid_hud_layout(v_a, 1::smallint, '{"face_zone":{"x":0.53,"y":0.02,"width":0.14,"height":0.22},"preset":"AUTO"}'::jsonb);
  v_res := public.teacher_save_raid_targeting(v_a, 1::smallint, '{"mode":"DOMAIN","x":0.3,"y":0.2,"width":0.3,"height":0.3}'::jsonb);
  r := r || jsonb_build_object('t','K1 targeting save keeps face zone; DOMAIN valid','ok',
       v_res->>'mode' = 'DOMAIN' AND (v_res->>'valid')::boolean AND (v_res->'face_zone'->>'x')::numeric = 0.53, 'd', v_res);

  -- K2 student battle-state path: raid_targeting_public_config with stored metadata
  v_res := public.raid_targeting_public_config((SELECT id FROM public.raid_phases WHERE raid_id = v_act), (SELECT metadata FROM public.raid_phases WHERE raid_id = v_act));
  r := r || jsonb_build_object('t','K2 public config of active raid carries face zone','ok',
       (v_res->'face_zone'->>'width')::numeric = 0.2, 'd', v_res);

  -- K3 corrupt stored value is ignored on read
  UPDATE public.raid_phases SET metadata = jsonb_set(metadata, '{hud_v3}', '{"face_zone":{"x":"bad"},"preset":"Q"}'::jsonb) WHERE raid_id = v_act;
  v_res := public.raid_targeting_public_config((SELECT id FROM public.raid_phases WHERE raid_id = v_act), (SELECT metadata FROM public.raid_phases WHERE raid_id = v_act));
  r := r || jsonb_build_object('t','K3 corrupt hud_v3 → null / AUTO','ok',
       jsonb_typeof(v_res->'face_zone') = 'null' AND v_res->>'hud_preset' = 'AUTO', 'd', v_res);

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean), jsonb_agg(e) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean, false))
    INTO v_pass, v_fail FROM jsonb_array_elements(r) e;
  RAISE EXCEPTION 'HUDV3_TEST_RESULT pass=% total=% failed=%', v_pass, jsonb_array_length(r), COALESCE(v_fail, '[]'::jsonb);
END
$test$;
