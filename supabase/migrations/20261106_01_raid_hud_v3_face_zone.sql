-- B.R.A.N.D 2.0 — Raid HUD v3: boss face zone + HUD preset (2026-11-06)
-- RAID_HUD_V3_20261106
--
-- What this does
--   1) raid_phases.metadata.hud_v3 = {"version":1,"face_zone":{x,y,width,height}|null,"preset":"AUTO|A|B|C|D"}
--      (display only: no hit-test, no combat rule changes)
--   2) public.teacher_save_raid_hud_layout(raid_id, phase_no, payload): teacher saves hud_v3
--   3) public.raid_targeting_public_config(...) also returns face_zone + hud_preset
--      → student state and broadcast state receive it without touching those functions.
--
-- Safe to run while a raid is in progress (only adds keys to a returned jsonb).
-- Safe to run twice (markers / IF NOT EXISTS).

DO $guard$
BEGIN
  IF to_regprocedure('public.raid_targeting_public_config(bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'raid_targeting_public_config not found: apply Targeting V1 first.';
  END IF;
  IF to_regprocedure('public.raid_teacher_require_raid(bigint)') IS NULL THEN
    RAISE EXCEPTION 'raid_teacher_require_raid not found.';
  END IF;
  IF to_regprocedure('brand_backup.replace_once(regprocedure,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'brand_backup.replace_once not found.';
  END IF;
END
$guard$;

-- 0) backup (once)
INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5, captured_at)
SELECT 'PRE_HUD_V3_20261106', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid)), now()
  FROM pg_proc p
 WHERE p.oid = 'public.raid_targeting_public_config(bigint,jsonb)'::regprocedure
   AND NOT EXISTS (
     SELECT 1 FROM brand_backup.function_snapshots s
      WHERE s.snapshot_label = 'PRE_HUD_V3_20261106'
        AND s.signature = p.oid::regprocedure::text
   );

-- 1) read-side helper: validated face_zone + preset from phase metadata
CREATE OR REPLACE FUNCTION public.raid_hud_v3_public(p_phase_metadata jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb := COALESCE(p_phase_metadata->'hud_v3', '{}'::jsonb);
  v_zone jsonb;
  v_preset text;
  v_face jsonb := NULL;
  v_x numeric; v_y numeric; v_w numeric; v_h numeric;
BEGIN
  IF jsonb_typeof(v_cfg) IS DISTINCT FROM 'object' THEN v_cfg := '{}'::jsonb; END IF;
  v_preset := upper(COALESCE(NULLIF(btrim(COALESCE(v_cfg->>'preset', '')), ''), 'AUTO'));
  IF v_preset NOT IN ('AUTO','A','B','C','D') THEN v_preset := 'AUTO'; END IF;

  v_zone := v_cfg->'face_zone';
  IF jsonb_typeof(v_zone) = 'object' THEN
    BEGIN
      v_x := (v_zone->>'x')::numeric;
      v_y := (v_zone->>'y')::numeric;
      v_w := (v_zone->>'width')::numeric;
      v_h := (v_zone->>'height')::numeric;
      IF v_x >= 0 AND v_y >= 0 AND v_w >= 0.02 AND v_h >= 0.02
         AND v_x + v_w <= 1.000001 AND v_y + v_h <= 1.000001 THEN
        v_face := jsonb_build_object('x', v_x, 'y', v_y, 'width', v_w, 'height', v_h);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_face := NULL;
    END;
  END IF;

  RETURN jsonb_build_object('face_zone', v_face, 'hud_preset', v_preset);
END;
$function$;

REVOKE ALL ON FUNCTION public.raid_hud_v3_public(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raid_hud_v3_public(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.raid_hud_v3_public(jsonb) FROM authenticated;

-- 2) public config also returns face_zone + hud_preset (marker /*HUD_V3*/)
SELECT brand_backup.replace_once(
  'public.raid_targeting_public_config(bigint,jsonb)'::regprocedure,
  '/*HUD_V3*/',
  $n$RETURN jsonb_build_object($n$,
  $r$RETURN public.raid_hud_v3_public(p_phase_metadata) /*HUD_V3*/ || jsonb_build_object($r$
);

-- 3) teacher save
CREATE OR REPLACE FUNCTION public.teacher_save_raid_hud_layout(
  p_raid_id bigint,
  p_phase_no smallint,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_phase_id bigint;
  v_preset text;
  v_zone jsonb;
  v_face jsonb := NULL;
  v_x numeric; v_y numeric; v_w numeric; v_h numeric;
  v_bad boolean := false;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);

  SELECT r.status::text, rp.id
    INTO v_status, v_phase_id
    FROM public.raids r
    JOIN public.raid_phases rp ON rp.raid_id = r.id AND rp.phase_no = p_phase_no
   WHERE r.id = p_raid_id
   FOR UPDATE OF rp;

  IF NOT FOUND THEN RAISE EXCEPTION 'Raid phase not found' USING ERRCODE = 'P0202'; END IF;
  IF v_status IN ('COMPLETED','FAILED','ARCHIVED') THEN
    RAISE EXCEPTION 'HUD layout cannot be changed after the raid ends' USING ERRCODE = 'P0215';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid HUD layout payload' USING ERRCODE = 'P0213';
  END IF;

  v_preset := upper(COALESCE(NULLIF(btrim(COALESCE(p_payload->>'preset', '')), ''), 'AUTO'));
  IF v_preset NOT IN ('AUTO','A','B','C','D') THEN
    RAISE EXCEPTION 'Unsupported HUD preset' USING ERRCODE = 'P0213';
  END IF;

  v_zone := p_payload->'face_zone';
  IF v_zone IS NOT NULL AND jsonb_typeof(v_zone) <> 'null' THEN
    IF jsonb_typeof(v_zone) <> 'object' THEN
      v_bad := true;
    ELSE
      BEGIN
        v_x := (v_zone->>'x')::numeric;
        v_y := (v_zone->>'y')::numeric;
        v_w := (v_zone->>'width')::numeric;
        v_h := (v_zone->>'height')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_bad := true;
      END;
      IF NOT v_bad AND (
           v_x IS NULL OR v_y IS NULL OR v_w IS NULL OR v_h IS NULL
           OR v_x < 0 OR v_y < 0 OR v_w < 0.02 OR v_h < 0.02
           OR v_x + v_w > 1.000001 OR v_y + v_h > 1.000001) THEN
        v_bad := true;
      END IF;
    END IF;
    IF v_bad THEN
      RAISE EXCEPTION '보스 얼굴 영역은 화면 안의 사각형이어야 합니다' USING ERRCODE = 'P0213';
    END IF;
    v_face := jsonb_build_object('x', round(v_x, 6), 'y', round(v_y, 6), 'width', round(v_w, 6), 'height', round(v_h, 6));
  END IF;

  UPDATE public.raid_phases
     SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{hud_v3}',
           jsonb_build_object('version', 1, 'face_zone', v_face, 'preset', v_preset),
           true),
         updated_at = now()
   WHERE id = v_phase_id;

  RETURN public.raid_targeting_public_config(
    v_phase_id,
    (SELECT metadata FROM public.raid_phases WHERE id = v_phase_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_save_raid_hud_layout(bigint,smallint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_save_raid_hud_layout(bigint,smallint,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_save_raid_hud_layout(bigint,smallint,jsonb) TO authenticated;

-- 4) sanity
DO $sanity$
DECLARE v jsonb;
BEGIN
  IF strpos(pg_get_functiondef('public.raid_targeting_public_config(bigint,jsonb)'::regprocedure), '/*HUD_V3*/') = 0 THEN
    RAISE EXCEPTION 'HUD_V3 sanity: public config marker missing';
  END IF;
  v := public.raid_targeting_public_config(-1, '{"hud_v3":{"face_zone":{"x":0.5,"y":0.1,"width":0.2,"height":0.2},"preset":"b"}}'::jsonb);
  IF v->>'mode' <> 'BODY' OR v->>'hud_preset' <> 'B' OR (v->'face_zone'->>'width')::numeric <> 0.2 THEN
    RAISE EXCEPTION 'HUD_V3 sanity: public config result %', v;
  END IF;
  v := public.raid_targeting_public_config(-1, '{}'::jsonb);
  IF v->>'hud_preset' <> 'AUTO' OR jsonb_typeof(v->'face_zone') <> 'null' OR (v->>'valid')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'HUD_V3 sanity: empty metadata result %', v;
  END IF;
  IF has_function_privilege('anon', 'public.teacher_save_raid_hud_layout(bigint,smallint,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.teacher_save_raid_hud_layout(bigint,smallint,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.raid_hud_v3_public(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HUD_V3 sanity: privileges';
  END IF;
END
$sanity$;

SELECT 'RAID HUD V3 applied' AS result;
