-- B.R.A.N.D 2.0 — Raid CLASH: C/D타입 보스 격돌 약점 판정 수정 (2026-11-09)
-- CLASH_WZ_TARGET_20261109
--
-- 문제
--   C(지배 영역)·D(핵심 표적) 보스는 지정 영역 밖 터치를 서버가 막는데,
--   격돌 약점은 항상 화면 가운데(x 0.40~0.60, y 0.26~0.52)에 고정으로 떠서
--   영역과 겹치지 않으면 약점을 쳐도 대미지가 전혀 들어가지 않았다. (레이드 118 제피라)
--
-- 무엇이 바뀌나
--   1) 격돌이 시작될 때, 지금 단계(phase)가 DOMAIN/ANCHOR이면 약점을 그 영역 "안"에 만든다.
--      · 보스 얼굴 영역(hud_v3.face_zone)이 있으면 얼굴 중심, 없으면 영역 중심
--      · 크기는 기본(0.20×0.26)과 영역 크기 중 작은 쪽 → 영역 밖으로 삐져나오지 않음
--      · 일반 보스(BODY)는 지금과 똑같이 화면 가운데
--   2) 격돌 버프(10초) 중 약점 칸 터치는 지정 영역 밖이어도 서버가 받는다. (만일의 안전장치)
--
-- 바뀌지 않는 것: 배율 규칙(raid_clash_hit_factor), 격돌 진행 흐름, 일반 공격의 영역 판정.
-- 두 번 실행해도 안전. 격돌이 진행 중이면 적용을 거부.

DO $guard$
BEGIN
  IF to_regprocedure('public.raid_clash_begin(bigint)') IS NULL
     OR to_regprocedure('public.raid_clash_attack_context(bigint)') IS NULL
     OR to_regprocedure('public.raid_targeting_allows_tap(bigint,jsonb,text,jsonb,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'CLASH V1~V4와 Targeting V1이 먼저 적용되어 있어야 합니다.';
  END IF;
  IF to_regprocedure('brand_backup.replace_once(regprocedure,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'brand_backup.replace_once not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE phase IN ('VOLUNTEERING','SELECTED','PLAYING')) THEN
    RAISE EXCEPTION '격돌이 진행 중입니다. 격돌이 끝난 뒤 다시 실행해 주세요.';
  END IF;
END
$guard$;

-- 0) backup (once)
INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5, captured_at)
SELECT 'PRE_CLASH_WZ_TARGET_20261109', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid)), now()
  FROM pg_proc p
 WHERE p.oid IN ('public.raid_clash_begin(bigint)'::regprocedure,
                 'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure)
   AND NOT EXISTS (SELECT 1 FROM brand_backup.function_snapshots s
                    WHERE s.snapshot_label = 'PRE_CLASH_WZ_TARGET_20261109' AND s.signature = p.oid::regprocedure::text);

-- 1) 격돌 약점 위치 계산 (내부 전용)
--    지금 HP 구간의 phase가 DOMAIN/ANCHOR이고 PRIMARY_TARGET이 있으면 그 안에 약점을 맞춘다.
--    그 밖의 경우(일반 보스, 영역 없음, 값이 이상함)에는 p_default(기존 가운데 약점)를 그대로 돌려준다.
CREATE OR REPLACE FUNCTION public.raid_clash_weak_zone_for_raid(p_raid_id bigint, p_default jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_phase public.raid_phases%ROWTYPE;
  v_mode text;
  v_px numeric; v_py numeric; v_pw numeric; v_ph numeric;
  v_dw numeric; v_dh numeric; v_mult numeric;
  v_w numeric; v_h numeric; v_cx numeric; v_cy numeric;
  v_face jsonb;
BEGIN
  IF p_default IS NULL OR jsonb_typeof(p_default) <> 'object' THEN RETURN p_default; END IF;
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  IF NOT FOUND OR COALESCE(v_raid.max_hp,0) <= 0 THEN RETURN p_default; END IF;

  -- submit_raid_tap_batch와 같은 규칙으로 지금 phase를 찾는다
  SELECT rp.* INTO v_phase FROM public.raid_phases rp
   WHERE rp.raid_id = p_raid_id
     AND (v_raid.current_hp::numeric / v_raid.max_hp::numeric) <= rp.hp_from_ratio
     AND ((v_raid.current_hp::numeric / v_raid.max_hp::numeric) > rp.hp_to_ratio OR (v_raid.current_hp = 0 AND rp.hp_to_ratio = 0))
   ORDER BY rp.phase_no
   LIMIT 1;
  IF NOT FOUND THEN RETURN p_default; END IF;

  v_mode := upper(COALESCE(NULLIF(v_phase.metadata#>>'{targeting_v1,mode}',''),'BODY'));
  IF v_mode NOT IN ('DOMAIN','ANCHOR') THEN RETURN p_default; END IF;

  SELECT hz.x, hz.y, hz.width, hz.height INTO v_px, v_py, v_pw, v_ph
    FROM public.raid_hit_zones hz
   WHERE hz.raid_phase_id = v_phase.id
     AND hz.zone_key = 'PRIMARY_TARGET'
     AND hz.is_active = true
     AND hz.width > 0 AND hz.height > 0
     AND hz.x >= 0 AND hz.y >= 0
     AND hz.x + hz.width <= 1 AND hz.y + hz.height <= 1
   ORDER BY hz.id
   LIMIT 1;
  IF NOT FOUND THEN RETURN p_default; END IF;

  BEGIN
    v_dw := COALESCE(NULLIF(p_default->>'width','')::numeric, 0.20);
    v_dh := COALESCE(NULLIF(p_default->>'height','')::numeric, 0.26);
    v_mult := COALESCE(NULLIF(p_default->>'multiplier','')::numeric, 2.0);
  EXCEPTION WHEN OTHERS THEN
    RETURN p_default;
  END;

  v_w := LEAST(v_dw, v_pw);
  v_h := LEAST(v_dh, v_ph);

  -- 기본: 영역 중심 / 얼굴 영역이 있으면 얼굴 중심
  v_cx := v_px + v_pw / 2;
  v_cy := v_py + v_ph / 2;
  v_face := v_phase.metadata#>'{hud_v3,face_zone}';
  IF jsonb_typeof(v_face) = 'object' THEN
    BEGIN
      IF (v_face->>'width')::numeric > 0 AND (v_face->>'height')::numeric > 0 THEN
        v_cx := (v_face->>'x')::numeric + (v_face->>'width')::numeric / 2;
        v_cy := (v_face->>'y')::numeric + (v_face->>'height')::numeric / 2;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- 약점이 영역 밖으로 나가지 않게 중심을 영역 안쪽으로 당긴다
  v_cx := GREATEST(v_px + v_w / 2, LEAST(v_px + v_pw - v_w / 2, v_cx));
  v_cy := GREATEST(v_py + v_h / 2, LEAST(v_py + v_ph - v_h / 2, v_cy));

  RETURN jsonb_build_object(
    'x', round(v_cx - v_w / 2, 4),
    'y', round(v_cy - v_h / 2, 4),
    'width', round(v_w, 4),
    'height', round(v_h, 4),
    'multiplier', v_mult
  );
END;
$function$;

-- 2) 격돌 버프 중 약점 칸 터치인지 (내부 전용)
CREATE OR REPLACE FUNCTION public.raid_clash_weak_zone_hit(p_ctx jsonb, p_x numeric, p_y numeric)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_zone jsonb;
BEGIN
  IF p_ctx IS NULL OR p_x IS NULL OR p_y IS NULL THEN RETURN false; END IF;
  IF NOT COALESCE((p_ctx->>'buff_active')::boolean, false) THEN RETURN false; END IF;
  v_zone := p_ctx->'weak_zone';
  IF jsonb_typeof(v_zone) <> 'object' THEN RETURN false; END IF;
  RETURN p_x >= (v_zone->>'x')::numeric AND p_x <= (v_zone->>'x')::numeric + (v_zone->>'width')::numeric
     AND p_y >= (v_zone->>'y')::numeric AND p_y <= (v_zone->>'y')::numeric + (v_zone->>'height')::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.raid_clash_weak_zone_for_raid(bigint,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_weak_zone_hit(jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated;

-- 3) 격돌 시작: 약점 위치를 보스 영역에 맞춘다
SELECT brand_backup.replace_once(
  'public.raid_clash_begin(bigint)'::regprocedure,
  '/*CLASH_WZ_TARGET:begin*/',
  $n$          v_profile->'weak_zone')
  ON CONFLICT (raid_id) DO NOTHING$n$,
  $r$          /*CLASH_WZ_TARGET:begin*/public.raid_clash_weak_zone_for_raid(p_raid_id, v_profile->'weak_zone'))
  ON CONFLICT (raid_id) DO NOTHING$r$
);

-- 4) 공격 판정: 격돌 버프 중 약점 칸이면 영역 판정을 건너뛴다
SELECT brand_backup.replace_once(
  'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
  '/*CLASH_WZ_TARGET:tap*/',
  $n$    IF NOT public.raid_targeting_allows_tap($n$,
  $r$    IF NOT /*CLASH_WZ_TARGET:tap*/public.raid_clash_weak_zone_hit(v_clash_ctx,v_x,v_y) AND NOT public.raid_targeting_allows_tap($r$
);
