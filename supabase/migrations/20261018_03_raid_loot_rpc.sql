-- ============================================================================
-- B.R.A.N.D 2.0 — 레이드 전리품 획득식 V1.2 · 3/3 (함수·RPC)
--
-- 선행 조건: 01(enum) → 02(스키마) 가 먼저 성공해야 합니다.
--
-- 구성
--   [A] 내부 계산 함수 (DB에 쓰지 않음 — 실제 진행과 리허설이 함께 사용)
--   [B] 내부 지급 함수 (조각 / 완성 편린)  ※ 학생·교사 브라우저에서 직접 호출 불가
--   [C] 내부 진행 함수 (상품 공개 / 당첨자 확정)
--   [D] 화면용 상태 조립 함수
--   [E] 교사 RPC  : 설정 조회·저장·복사, 획득식 시작·진행·조회, 리허설
--   [F] 학생 RPC  : 공개된 전리품만 조회
--   [G] 기존 teacher_delete_raid_record 에 "획득식 기록 보호" 확인만 추가
--   [H] 권한(GRANT/REVOKE)
--
-- 기존 함수 중 수정하는 것은 teacher_delete_raid_record 하나뿐이며,
-- 기존 삭제 순서·반환값은 그대로 두고 앞부분에 확인 4줄만 추가합니다.
-- create_transaction / raid_settle_rewards / _expedition_adjust_fragments 등은 수정하지 않습니다.
--
-- 오류 코드: P0L1x 설정 / P0L2x 추첨 / P0L3x 지급 / P0L4x 시작 / P0L5x 진행 / P0L6x 삭제 / P0L7x 리허설
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.raid_loot_ceremonies') IS NULL THEN
    RAISE EXCEPTION '먼저 20261018_02_raid_loot_schema.sql 을 실행하세요.';
  END IF;
END $$;

-- ============================================================================
-- [A] 내부 계산 함수 (쓰기 없음)
-- ============================================================================

-- A-1. 수량 범위 {min,max,step} 검증·정규화. 비어 있으면 NULL.
CREATE OR REPLACE FUNCTION public._raid_loot_norm_range(p_range jsonb, p_cap bigint, p_label text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_min bigint;
  v_max bigint;
  v_step bigint;
BEGIN
  IF p_range IS NULL OR jsonb_typeof(p_range) <> 'object' THEN
    RETURN NULL;
  END IF;
  IF coalesce(p_range->>'min','') = '' AND coalesce(p_range->>'max','') = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_min  := nullif(p_range->>'min','')::bigint;
    v_max  := nullif(p_range->>'max','')::bigint;
    v_step := coalesce(nullif(p_range->>'step','')::bigint, 1);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '%: 최소·최대·간격은 정수로 입력하세요.', p_label USING ERRCODE='P0L11';
  END;

  IF v_min IS NULL OR v_max IS NULL THEN
    RAISE EXCEPTION '%: 최소와 최대를 모두 입력하세요.', p_label USING ERRCODE='P0L11';
  END IF;
  IF v_min < 1 THEN
    RAISE EXCEPTION '%: 최소는 1 이상이어야 합니다.', p_label USING ERRCODE='P0L11';
  END IF;
  IF v_max < v_min THEN
    RAISE EXCEPTION '%: 최대는 최소보다 크거나 같아야 합니다.', p_label USING ERRCODE='P0L11';
  END IF;
  IF v_step < 1 THEN
    RAISE EXCEPTION '%: 간격은 1 이상이어야 합니다.', p_label USING ERRCODE='P0L11';
  END IF;
  IF (v_max - v_min) % v_step <> 0 THEN
    RAISE EXCEPTION '%: (최대 − 최소)가 간격으로 나누어떨어져야 합니다.', p_label USING ERRCODE='P0L11';
  END IF;
  IF v_max > p_cap THEN
    RAISE EXCEPTION '%: 최대는 % 이하로 입력하세요.', p_label, p_cap USING ERRCODE='P0L11';
  END IF;

  RETURN jsonb_build_object('min', v_min, 'max', v_max, 'step', v_step);
END;
$function$;

-- A-2. 완성 편린 가중치: sqrt(1000 / 기준가) × 교사 가중치
CREATE OR REPLACE FUNCTION public._raid_loot_char_weight(p_price bigint, p_factor numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT round(sqrt(1000.0 / greatest(p_price, 1)::numeric) * coalesce(p_factor, 1), 6);
$function$;

-- A-3. 후보 목록에 선택 후보 기준 출현 확률을 붙임
CREATE OR REPLACE FUNCTION public._raid_loot_with_probabilities(p_pool jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total numeric;
  v_out jsonb;
BEGIN
  SELECT coalesce(sum((t.e->>'weight')::numeric) FILTER (WHERE coalesce((t.e->>'is_selected')::boolean, true)), 0)
    INTO v_total
  FROM jsonb_array_elements(coalesce(p_pool, '[]'::jsonb)) AS t(e);

  SELECT coalesce(jsonb_agg(
           t.e || jsonb_build_object(
             'probability',
             CASE WHEN coalesce((t.e->>'is_selected')::boolean, true) AND v_total > 0
                  THEN round((t.e->>'weight')::numeric / v_total, 6) ELSE 0 END)
           ORDER BY coalesce((t.e->>'sort_order')::int, 0), (t.e->>'character_id')::bigint),
         '[]'::jsonb)
    INTO v_out
  FROM jsonb_array_elements(coalesce(p_pool, '[]'::jsonb)) AS t(e);

  RETURN v_out;
END;
$function$;

-- A-4. 설정이 "시작 가능할 만큼" 채워졌는지 검사 → 부족한 점 목록 (빈 배열이면 OK)
CREATE OR REPLACE FUNCTION public._raid_loot_config_issues(p_cfg jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_s1 jsonb := coalesce(p_cfg->'slot1', '{}'::jsonb);
  v_s2 jsonb := coalesce(p_cfg->'slot2', '{}'::jsonb);
  v_m1 text := coalesce(v_s1->>'mode', 'AUTO');
  v_m2 text := coalesce(v_s2->>'mode', 'AUTO');
  v_fk1 text := v_s1->>'fixed_kind';
  v_fk2 text := v_s2->>'fixed_kind';
  v_selected int;
  v_issues text[] := '{}';
BEGIN
  SELECT count(*) INTO v_selected
  FROM jsonb_array_elements(coalesce(p_cfg->'pool', '[]'::jsonb)) AS t(e)
  WHERE coalesce((t.e->>'is_selected')::boolean, true);

  -- 제1전리품
  IF v_m1 = 'AUTO' THEN
    IF coalesce(jsonb_typeof(v_s1->'gold'), 'null') = 'null' THEN
      v_issues := v_issues || '제1전리품: GOLD 수량 범위를 입력하세요.'::text;
    END IF;
    IF coalesce(jsonb_typeof(v_s1->'crystal'), 'null') = 'null' THEN
      v_issues := v_issues || '제1전리품: CRYSTAL 수량 범위를 입력하세요.'::text;
    END IF;
  ELSIF v_m1 = 'FIXED_KIND' THEN
    IF v_fk1 IS NULL THEN
      v_issues := v_issues || '제1전리품: 지정할 종류(GOLD/CRYSTAL)를 고르세요.'::text;
    ELSIF coalesce(jsonb_typeof(v_s1->lower(v_fk1)), 'null') = 'null' THEN
      v_issues := v_issues || ('제1전리품: ' || v_fk1 || ' 수량 범위를 입력하세요.');
    END IF;
  ELSIF v_m1 = 'FIXED_ITEM' THEN
    IF v_fk1 IS NULL THEN
      v_issues := v_issues || '제1전리품: 지정할 종류(GOLD/CRYSTAL)를 고르세요.'::text;
    END IF;
    IF coalesce(jsonb_typeof(v_s1->'fixed_amount'), 'null') = 'null' THEN
      v_issues := v_issues || '제1전리품: 고정 수량을 입력하세요.'::text;
    END IF;
  END IF;

  -- 제2전리품
  IF v_m2 = 'AUTO' THEN
    IF coalesce(jsonb_typeof(v_s2->'fragments'), 'null') = 'null' THEN
      v_issues := v_issues || '제2전리품: 편린 조각 수량 범위를 입력하세요.'::text;
    END IF;
    IF v_selected = 0 THEN
      v_issues := v_issues || '제2전리품: 완성 편린 후보를 1개 이상 선택하세요.'::text;
    END IF;
  ELSIF v_m2 = 'FIXED_KIND' THEN
    IF v_fk2 IS NULL THEN
      v_issues := v_issues || '제2전리품: 지정할 종류(편린 조각/완성 편린)를 고르세요.'::text;
    ELSIF v_fk2 = 'FRAGMENTS' AND coalesce(jsonb_typeof(v_s2->'fragments'), 'null') = 'null' THEN
      v_issues := v_issues || '제2전리품: 편린 조각 수량 범위를 입력하세요.'::text;
    ELSIF v_fk2 = 'CHARACTER' AND v_selected = 0 THEN
      v_issues := v_issues || '제2전리품: 완성 편린 후보를 1개 이상 선택하세요.'::text;
    END IF;
  ELSIF v_m2 = 'FIXED_ITEM' THEN
    IF v_fk2 IS NULL THEN
      v_issues := v_issues || '제2전리품: 지정할 종류(편린 조각/완성 편린)를 고르세요.'::text;
    ELSIF v_fk2 = 'FRAGMENTS' AND coalesce(jsonb_typeof(v_s2->'fixed_amount'), 'null') = 'null' THEN
      v_issues := v_issues || '제2전리품: 고정 조각 수량을 입력하세요.'::text;
    ELSIF v_fk2 = 'CHARACTER' AND coalesce(jsonb_typeof(v_s2->'fixed_character'), 'null') = 'null' THEN
      v_issues := v_issues || '제2전리품: 확정으로 내보낼 편린을 고르세요.'::text;
    END IF;
  END IF;

  RETURN v_issues;
END;
$function$;

-- A-5. 이 학급에서 전리품 후보가 될 수 있는 편린인지 확인 → 스냅샷(아니면 NULL)
--      조건: 편린 활성 · 영입 상품 활성 · 영입 방식 '크리스탈 영입' · 기준가 1,000C 이상
--      ('이벤트 전용' 등 다른 방식은 DB 제약상 기준가가 0이라 자동 제외)
CREATE OR REPLACE FUNCTION public._raid_loot_eligible_offer(p_classroom_id integer, p_character_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
           'character_id', c.id,
           'character_uid', c.character_uid,
           'display_name', c.name,
           'image_url', coalesce(c.card_image_url, c.full_image_url, c.avatar_image_url, c.resource_url),
           'emoji', c.emoji,
           'base_price_crystal', o.base_price_crystal)
  FROM public.characters c
  JOIN public.character_recruitment_offers o
    ON o.character_id = c.id AND o.classroom_id = p_classroom_id
  WHERE c.id = p_character_id
    AND c.is_active = true
    AND o.is_active = true
    AND o.acquisition_mode = 'CRYSTAL'
    AND o.base_price_crystal >= 1000;
$function$;

-- A-6. 교사가 보낸 설정을 검증·정규화 (실시간 영입 설정을 읽어 가격·이름 스냅샷 생성)
--      p_strict=true : 조건 미달 편린이 있으면 오류 (저장)
--      p_strict=false: 조건 미달 편린은 빼고 dropped 에 기록 (설정 복사)
CREATE OR REPLACE FUNCTION public._raid_loot_normalize_config(p_classroom_id integer, p_payload jsonb, p_strict boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_s1 jsonb := coalesce(p_payload->'slot1', '{}'::jsonb);
  v_s2 jsonb := coalesce(p_payload->'slot2', '{}'::jsonb);
  v_m1 text := upper(coalesce(nullif(v_s1->>'mode', ''), 'AUTO'));
  v_m2 text := upper(coalesce(nullif(v_s2->>'mode', ''), 'AUTO'));
  v_fk1 text := upper(nullif(v_s1->>'fixed_kind', ''));
  v_fk2 text := upper(nullif(v_s2->>'fixed_kind', ''));
  v_fa1 bigint;
  v_fa2 bigint;
  v_fc_id bigint;
  v_fc jsonb;
  v_pool jsonb := '[]'::jsonb;
  v_item jsonb;
  v_offer jsonb;
  v_cid bigint;
  v_factor numeric;
  v_sel boolean;
  v_seen bigint[] := '{}';
  v_order integer := 0;
  v_dropped text[] := '{}';
  v_out jsonb;
BEGIN
  IF v_m1 NOT IN ('AUTO','FIXED_KIND','FIXED_ITEM') THEN
    RAISE EXCEPTION '제1전리품 방식이 올바르지 않습니다.' USING ERRCODE='P0L10';
  END IF;
  IF v_m2 NOT IN ('AUTO','FIXED_KIND','FIXED_ITEM') THEN
    RAISE EXCEPTION '제2전리품 방식이 올바르지 않습니다.' USING ERRCODE='P0L10';
  END IF;

  IF v_m1 = 'AUTO' THEN
    v_fk1 := NULL;
  ELSIF v_fk1 IS NOT NULL AND v_fk1 NOT IN ('GOLD','CRYSTAL') THEN
    RAISE EXCEPTION '제1전리품 종류는 GOLD 또는 CRYSTAL만 가능합니다.' USING ERRCODE='P0L10';
  END IF;
  IF v_m2 = 'AUTO' THEN
    v_fk2 := NULL;
  ELSIF v_fk2 IS NOT NULL AND v_fk2 NOT IN ('FRAGMENTS','CHARACTER') THEN
    RAISE EXCEPTION '제2전리품 종류는 편린 조각 또는 완성 편린만 가능합니다.' USING ERRCODE='P0L10';
  END IF;

  -- 고정 수량
  IF v_m1 = 'FIXED_ITEM' AND nullif(v_s1->>'fixed_amount', '') IS NOT NULL THEN
    BEGIN
      v_fa1 := (v_s1->>'fixed_amount')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '제1전리품 고정 수량은 정수로 입력하세요.' USING ERRCODE='P0L11';
    END;
    IF v_fa1 < 1 OR v_fa1 > 1000000 THEN
      RAISE EXCEPTION '제1전리품 고정 수량은 1 ~ 1,000,000 사이로 입력하세요.' USING ERRCODE='P0L11';
    END IF;
  END IF;
  IF v_m2 = 'FIXED_ITEM' AND v_fk2 = 'FRAGMENTS' AND nullif(v_s2->>'fixed_amount', '') IS NOT NULL THEN
    BEGIN
      v_fa2 := (v_s2->>'fixed_amount')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '제2전리품 고정 조각 수량은 정수로 입력하세요.' USING ERRCODE='P0L11';
    END;
    IF v_fa2 < 1 OR v_fa2 > 100000 THEN
      RAISE EXCEPTION '제2전리품 고정 조각 수량은 1 ~ 100,000 사이로 입력하세요.' USING ERRCODE='P0L11';
    END IF;
  END IF;

  -- 확정 지정 편린
  IF v_m2 = 'FIXED_ITEM' AND v_fk2 = 'CHARACTER' AND nullif(v_s2->>'fixed_character_id', '') IS NOT NULL THEN
    BEGIN
      v_fc_id := (v_s2->>'fixed_character_id')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '확정 지정 편린 ID가 올바르지 않습니다.' USING ERRCODE='P0L12';
    END;
    v_fc := public._raid_loot_eligible_offer(p_classroom_id, v_fc_id);
    IF v_fc IS NULL THEN
      IF p_strict THEN
        RAISE EXCEPTION '확정 지정할 편린은 크리스탈 영입 · 기준가 1,000C 이상 · 활성 상태여야 합니다. (이벤트 전용 편린 불가)'
          USING ERRCODE='P0L12';
      END IF;
      v_dropped := v_dropped || ('확정 지정 편린(ID ' || v_fc_id || ')이 조건을 만족하지 않아 빠졌습니다.');
      v_fc_id := NULL;
    END IF;
  END IF;

  -- 후보 풀
  FOR v_item IN
    SELECT t.e FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_payload->'pool') = 'array' THEN p_payload->'pool' ELSE '[]'::jsonb END
    ) AS t(e)
  LOOP
    BEGIN
      v_cid := (v_item->>'character_id')::bigint;
      v_factor := coalesce(nullif(v_item->>'manual_factor', '')::numeric, 1);
      v_sel := coalesce((v_item->>'is_selected')::boolean, true);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '후보 편린 정보가 올바르지 않습니다.' USING ERRCODE='P0L12';
    END;

    IF v_cid IS NULL OR v_cid = ANY(v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := v_seen || v_cid;

    IF v_factor < 0.25 OR v_factor > 4 THEN
      RAISE EXCEPTION '교사 가중치는 0.25 ~ 4.0 사이로 입력하세요.' USING ERRCODE='P0L13';
    END IF;
    v_factor := round(v_factor, 3);

    v_offer := public._raid_loot_eligible_offer(p_classroom_id, v_cid);
    IF v_offer IS NULL THEN
      IF p_strict THEN
        RAISE EXCEPTION '편린(ID %)은 전리품 후보 조건(크리스탈 영입 · 기준가 1,000C 이상 · 활성)을 만족하지 않습니다.', v_cid
          USING ERRCODE='P0L12';
      END IF;
      v_dropped := v_dropped || ('편린(ID ' || v_cid || ')이 후보 조건을 만족하지 않아 빠졌습니다.');
      CONTINUE;
    END IF;

    v_order := v_order + 1;
    v_pool := v_pool || jsonb_build_array(
      v_offer || jsonb_build_object(
        'manual_factor', v_factor,
        'is_selected', v_sel,
        'sort_order', v_order,
        'weight', public._raid_loot_char_weight((v_offer->>'base_price_crystal')::bigint, v_factor)));
  END LOOP;

  v_out := jsonb_build_object(
    'slot1', jsonb_build_object(
      'mode', v_m1,
      'gold_bp', 6000,
      'crystal_bp', 4000,
      'gold', public._raid_loot_norm_range(v_s1->'gold', 1000000, '제1전리품 GOLD'),
      'crystal', public._raid_loot_norm_range(v_s1->'crystal', 1000000, '제1전리품 CRYSTAL'),
      'fixed_kind', v_fk1,
      'fixed_amount', v_fa1),
    'slot2', jsonb_build_object(
      'mode', v_m2,
      'fragments_bp', 6000,
      'character_bp', 4000,
      'fragments', public._raid_loot_norm_range(v_s2->'fragments', 100000, '제2전리품 편린 조각'),
      'fixed_kind', v_fk2,
      'fixed_amount', v_fa2,
      'fixed_character_id', v_fc_id,
      'fixed_character', CASE WHEN v_fc_id IS NULL THEN NULL ELSE v_fc END,
      'duplicate_policy', 'CONVERT_TO_CRYSTAL_90',
      'duplicate_conversion_bp', 9000),
    'pool', public._raid_loot_with_probabilities(v_pool));

  RETURN v_out || jsonb_build_object(
    'issues', to_jsonb(public._raid_loot_config_issues(v_out)),
    'dropped', to_jsonb(v_dropped));
END;
$function$;

-- A-7. 저장된 설정을 하나의 JSON으로 (가격 등은 저장 시점 스냅샷)
CREATE OR REPLACE FUNCTION public._raid_loot_stored_config(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg public.raid_loot_configs%ROWTYPE;
  v_pool jsonb;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_loot_configs WHERE raid_id = p_raid_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'character_id', p.character_id,
           'character_uid', p.character_uid,
           'display_name', p.display_name,
           'image_url', p.image_url,
           'emoji', p.emoji,
           'base_price_crystal', p.base_price_crystal,
           'manual_factor', p.manual_factor,
           'is_selected', p.is_selected,
           'sort_order', p.sort_order,
           'weight', public._raid_loot_char_weight(p.base_price_crystal, p.manual_factor))
           ORDER BY p.sort_order, p.character_id), '[]'::jsonb)
    INTO v_pool
  FROM public.raid_loot_character_pool p
  WHERE p.raid_id = p_raid_id;

  RETURN jsonb_build_object(
    'slot1', v_cfg.slot1,
    'slot2', v_cfg.slot2,
    'pool', public._raid_loot_with_probabilities(v_pool),
    'enabled', v_cfg.enabled,
    'config_version', v_cfg.config_version,
    'updated_at', v_cfg.updated_at);
END;
$function$;

-- A-8. 적격자 스냅샷 (전체 피해량 1% 이상 · 전출 제외 · 동점자 같은 가중치)
--      가중치 = 2 − (순위 − 1)/(N − 1), 동점자는 차지한 순위 자리의 평균 → 최고 2, 최저 1
CREATE OR REPLACE FUNCTION public._raid_loot_eligible_snapshot(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total numeric;
  v_n integer;
  v_list jsonb;
BEGIN
  SELECT coalesce(sum(rp.total_damage), 0)::numeric INTO v_total
  FROM public.raid_participants rp
  WHERE rp.raid_id = p_raid_id;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('total_damage', 0, 'eligible_count', 0, 'eligible', '[]'::jsonb);
  END IF;

  WITH base AS (
    SELECT rp.id AS participant_id, rp.student_id,
           rp.snapshot_student_name AS name, rp.snapshot_brand_name AS brand_name,
           rp.snapshot_equipped_character_image_url AS avatar_url,
           rp.final_rank, rp.total_damage
    FROM public.raid_participants rp
    JOIN public.students s ON s.id = rp.student_id
    WHERE rp.raid_id = p_raid_id
      AND rp.accepted_tap_count > 0
      AND rp.final_rank IS NOT NULL
      AND s.transferred_at IS NULL
      AND rp.total_damage::numeric * 100 >= v_total
  ), ranked AS (
    SELECT b.*,
           count(*) OVER () AS n,
           rank() OVER (ORDER BY b.total_damage DESC) AS rk,
           count(*) OVER (PARTITION BY b.total_damage) AS tie_cnt,
           row_number() OVER (ORDER BY b.total_damage DESC, b.final_rank ASC, b.student_id ASC) AS display_order
    FROM base b
  )
  SELECT count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', participant_id,
           'student_id', student_id,
           'name', name,
           'brand_name', brand_name,
           'avatar_url', avatar_url,
           'final_rank', final_rank,
           'total_damage', total_damage,
           'contribution_percent', round(total_damage::numeric * 100 / v_total, 2),
           'display_order', display_order,
           'weight', CASE WHEN n <= 1 THEN 1.0
                          ELSE round(2.0 - ((rk + (tie_cnt - 1) / 2.0) - 1) / (n - 1), 6) END)
           ORDER BY display_order), '[]'::jsonb)
    INTO v_n, v_list
  FROM ranked;

  RETURN jsonb_build_object('total_damage', v_total, 'eligible_count', v_n, 'eligible', v_list);
END;
$function$;

-- A-9. 당첨자 가중 추첨 (쓰기 없음)
--      후보에서 p_exclude_student_id(1차 당첨자)와 지금 전출 상태인 학생을 빼고
--      남은 인원으로 가중치를 다시 계산(동점 평균 포함)한 뒤 뽑습니다. 남은 후보가 없으면 NULL.
CREATE OR REPLACE FUNCTION public._raid_loot_pick_winner(p_candidates jsonb, p_exclude_student_id integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pool jsonb;
  v_n integer;
  v_total numeric;
  v_r numeric;
  v_acc numeric := 0;
  v_item jsonb;
BEGIN
  WITH c AS (
    SELECT t.e
    FROM jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) AS t(e)
    JOIN public.students s ON s.id = (t.e->>'student_id')::integer AND s.transferred_at IS NULL
    WHERE p_exclude_student_id IS NULL OR (t.e->>'student_id')::integer <> p_exclude_student_id
  ), r AS (
    SELECT c.e,
           (c.e->>'display_order')::integer AS ord,
           count(*) OVER () AS n,
           rank() OVER (ORDER BY (c.e->>'total_damage')::bigint DESC) AS rk,
           count(*) OVER (PARTITION BY (c.e->>'total_damage')::bigint) AS tie_cnt
    FROM c
  )
  SELECT coalesce(jsonb_agg(
           r.e || jsonb_build_object('draw_weight',
             CASE WHEN r.n <= 1 THEN 1.0
                  ELSE round(2.0 - ((r.rk + (r.tie_cnt - 1) / 2.0) - 1) / (r.n - 1), 6) END)
           ORDER BY r.ord), '[]'::jsonb)
    INTO v_pool
  FROM r;

  v_n := jsonb_array_length(v_pool);
  IF v_n = 0 THEN
    RETURN NULL;
  END IF;
  IF v_n = 1 THEN
    RETURN (v_pool->0) || jsonb_build_object('draw_probability', 1.0, 'candidate_count', 1);
  END IF;

  SELECT sum((t.e->>'draw_weight')::numeric) INTO v_total
  FROM jsonb_array_elements(v_pool) AS t(e);

  v_r := random()::numeric * v_total;
  FOR v_item IN SELECT t.e FROM jsonb_array_elements(v_pool) WITH ORDINALITY AS t(e, i) ORDER BY t.i LOOP
    v_acc := v_acc + (v_item->>'draw_weight')::numeric;
    IF v_r < v_acc THEN
      RETURN v_item || jsonb_build_object(
        'draw_probability', round((v_item->>'draw_weight')::numeric / v_total, 6),
        'candidate_count', v_n);
    END IF;
  END LOOP;

  v_item := v_pool->(v_n - 1);
  RETURN v_item || jsonb_build_object(
    'draw_probability', round((v_item->>'draw_weight')::numeric / v_total, 6),
    'candidate_count', v_n);
END;
$function$;

-- A-10. 범위 안에서 간격에 맞는 수량을 균등 추첨
CREATE OR REPLACE FUNCTION public._raid_loot_draw_amount(p_range jsonb)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_min bigint := (p_range->>'min')::bigint;
  v_max bigint := (p_range->>'max')::bigint;
  v_step bigint := coalesce((p_range->>'step')::bigint, 1);
  v_slots bigint;
BEGIN
  IF v_min IS NULL OR v_max IS NULL THEN
    RAISE EXCEPTION '수량 범위가 설정되지 않았습니다.' USING ERRCODE='P0L20';
  END IF;
  v_slots := (v_max - v_min) / v_step + 1;
  RETURN v_min + v_step * floor(random() * v_slots)::bigint;
END;
$function$;

-- A-11. 전리품 1개 결정 (종류 60:40 → 수량 또는 완성 편린) — 쓰기 없음
CREATE OR REPLACE FUNCTION public._raid_loot_draw_reward(p_slot_no integer, p_cfg jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_slot jsonb;
  v_mode text;
  v_kind text;
  v_kind_prob numeric;
  v_amount bigint;
  v_char jsonb;
  v_total numeric;
  v_r numeric;
  v_acc numeric := 0;
  v_e jsonb;
  v_price bigint;
BEGIN
  v_slot := CASE WHEN p_slot_no = 1 THEN p_cfg->'slot1' ELSE p_cfg->'slot2' END;
  v_mode := coalesce(v_slot->>'mode', 'AUTO');

  -- 제1전리품: GOLD / CRYSTAL
  IF p_slot_no = 1 THEN
    IF v_mode = 'AUTO' THEN
      IF random() < 0.6 THEN v_kind := 'GOLD'; v_kind_prob := 0.6;
      ELSE v_kind := 'CRYSTAL'; v_kind_prob := 0.4; END IF;
    ELSE
      v_kind := v_slot->>'fixed_kind'; v_kind_prob := 1;
    END IF;

    IF v_mode = 'FIXED_ITEM' THEN
      v_amount := (v_slot->>'fixed_amount')::bigint;
    ELSE
      v_amount := public._raid_loot_draw_amount(v_slot->lower(v_kind));
    END IF;

    RETURN jsonb_build_object(
      'slot_no', 1, 'kind', v_kind, 'amount', v_amount, 'character_id', NULL,
      'snapshot', jsonb_build_object(
        'label', to_char(v_amount, 'FM999,999,999,990') || ' ' || v_kind,
        'mode', v_mode,
        'kind_probability', v_kind_prob,
        'amount_range', CASE WHEN v_mode = 'FIXED_ITEM' THEN NULL ELSE v_slot->lower(v_kind) END));
  END IF;

  -- 제2전리품: 편린 조각 / 완성 편린
  IF v_mode = 'AUTO' THEN
    IF random() < 0.6 THEN v_kind := 'FRAGMENTS'; v_kind_prob := 0.6;
    ELSE v_kind := 'CHARACTER'; v_kind_prob := 0.4; END IF;
  ELSE
    v_kind := v_slot->>'fixed_kind'; v_kind_prob := 1;
  END IF;

  IF v_kind = 'FRAGMENTS' THEN
    IF v_mode = 'FIXED_ITEM' THEN
      v_amount := (v_slot->>'fixed_amount')::bigint;
    ELSE
      v_amount := public._raid_loot_draw_amount(v_slot->'fragments');
    END IF;
    RETURN jsonb_build_object(
      'slot_no', 2, 'kind', 'FRAGMENTS', 'amount', v_amount, 'character_id', NULL,
      'snapshot', jsonb_build_object(
        'label', '편린 조각 ' || to_char(v_amount, 'FM999,999,999,990') || '개',
        'mode', v_mode,
        'kind_probability', v_kind_prob,
        'amount_range', CASE WHEN v_mode = 'FIXED_ITEM' THEN NULL ELSE v_slot->'fragments' END));
  END IF;

  -- 완성 편린
  IF v_mode = 'FIXED_ITEM' THEN
    v_char := (v_slot->'fixed_character') || jsonb_build_object('probability', 1, 'weight', NULL, 'manual_factor', NULL);
  ELSE
    SELECT sum((t.e->>'weight')::numeric) INTO v_total
    FROM jsonb_array_elements(coalesce(p_cfg->'pool', '[]'::jsonb)) AS t(e)
    WHERE coalesce((t.e->>'is_selected')::boolean, true);

    IF v_total IS NULL OR v_total <= 0 THEN
      RAISE EXCEPTION '완성 편린 후보가 없습니다.' USING ERRCODE='P0L21';
    END IF;

    v_r := random()::numeric * v_total;
    FOR v_e IN
      SELECT t.e FROM jsonb_array_elements(p_cfg->'pool') WITH ORDINALITY AS t(e, i)
      WHERE coalesce((t.e->>'is_selected')::boolean, true)
      ORDER BY t.i
    LOOP
      v_char := v_e;
      v_acc := v_acc + (v_e->>'weight')::numeric;
      EXIT WHEN v_r < v_acc;
    END LOOP;
    v_char := v_char || jsonb_build_object('probability', round((v_char->>'weight')::numeric / v_total, 6));
  END IF;

  IF v_char IS NULL OR (v_char->>'character_id') IS NULL THEN
    RAISE EXCEPTION '완성 편린을 결정하지 못했습니다.' USING ERRCODE='P0L21';
  END IF;

  v_price := (v_char->>'base_price_crystal')::bigint;
  RETURN jsonb_build_object(
    'slot_no', 2, 'kind', 'CHARACTER', 'amount', NULL,
    'character_id', (v_char->>'character_id')::bigint,
    'snapshot', jsonb_build_object(
      'label', v_char->>'display_name',
      'mode', v_mode,
      'kind_probability', v_kind_prob,
      'character_id', (v_char->>'character_id')::bigint,
      'character_uid', v_char->>'character_uid',
      'display_name', v_char->>'display_name',
      'image_url', v_char->>'image_url',
      'emoji', v_char->>'emoji',
      'base_price_crystal', v_price,
      'character_probability', v_char->'probability',
      'weight', v_char->'weight',
      'manual_factor', v_char->'manual_factor',
      'conversion_rate_bp', 9000,
      'duplicate_crystal_amount', (v_price * 90) / 100));
END;
$function$;

-- ============================================================================
-- [B] 내부 지급 함수  ※ 진행 함수 안에서만 호출 (브라우저 직접 호출 권한 없음)
-- ============================================================================

-- B-1. 편린 조각 지급 — 원정대와 같은 공용 잔액(expedition_fragment_balances)을 증가
--      원정 조각 함수와 같은 잠금 키를 써서 원정 소비·복원과 순서가 엉키지 않게 합니다.
CREATE OR REPLACE FUNCTION public._raid_loot_credit_fragments(
  p_student_id integer, p_amount integer, p_request_id uuid, p_actor_user_id uuid, p_metadata jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_balance integer;
  v_new_balance integer;
  v_ledger_id bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '지급할 조각 수량이 올바르지 않습니다.' USING ERRCODE='P0L30';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION '조각 지급 요청 ID가 없습니다.' USING ERRCODE='P0L30';
  END IF;

  SELECT classroom_id INTO v_classroom_id
  FROM public.students
  WHERE id = p_student_id
    AND transferred_at IS NULL
    AND role::text NOT IN ('TEACHER','ADMIN');
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '조각을 받을 학생을 찾을 수 없습니다.' USING ERRCODE='P0L31';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('EXPEDITION_FRAGMENT|' || p_student_id::text, 0));

  INSERT INTO public.expedition_fragment_balances(student_id, classroom_id, balance)
  VALUES (p_student_id, v_classroom_id, 0)
  ON CONFLICT (student_id) DO NOTHING;

  SELECT balance INTO v_balance
  FROM public.expedition_fragment_balances
  WHERE student_id = p_student_id
  FOR UPDATE;

  v_new_balance := v_balance + p_amount;

  UPDATE public.expedition_fragment_balances
  SET balance = v_new_balance
  WHERE student_id = p_student_id;

  INSERT INTO public.expedition_fragment_ledger(
    classroom_id, student_id, delta, balance_after, event_type,
    source_run_id, source_character_id, request_id, actor_user_id, metadata)
  VALUES (
    v_classroom_id, p_student_id, p_amount, v_new_balance, 'RAID_LOOT',
    NULL, NULL, p_request_id, p_actor_user_id, coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$function$;

-- B-2. 완성 편린 지급. 이미 보유 중이면 편린은 그대로 두고 기준가 90% 크리스탈을 대신 지급.
--      보유 여부는 INSERT ... ON CONFLICT 로 "지급하는 그 순간" 판정 → 영입과 동시에 일어나도 중복 보유 없음
CREATE OR REPLACE FUNCTION public._raid_loot_grant_character(
  p_student_id integer, p_character_id bigint, p_price bigint, p_round_id bigint,
  p_dup_memo text, p_actor_user_id uuid, p_metadata jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_sc_id bigint;
  v_event_id bigint;
  v_tx_id bigint;
  v_converted bigint;
BEGIN
  SELECT classroom_id INTO v_classroom_id
  FROM public.students
  WHERE id = p_student_id AND transferred_at IS NULL;
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '편린을 받을 학생을 찾을 수 없습니다.' USING ERRCODE='P0L31';
  END IF;

  INSERT INTO public.student_characters(
    classroom_id, student_id, character_id, is_owned, acquired_at, acquired_via, revoked_at, revoke_reason)
  VALUES (v_classroom_id, p_student_id, p_character_id, true, now(), 'RAID_LOOT', NULL, NULL)
  ON CONFLICT (student_id, character_id) DO UPDATE
    SET classroom_id = EXCLUDED.classroom_id,
        is_owned = true,
        acquired_at = now(),
        acquired_via = 'RAID_LOOT',
        revoked_at = NULL,
        revoke_reason = NULL
    WHERE public.student_characters.is_owned = false
  RETURNING id INTO v_sc_id;

  IF v_sc_id IS NULL THEN
    -- 이미 보유 중: 기준가 × 90% (정수 내림) 크리스탈
    v_converted := (p_price * 90) / 100;
    IF v_converted <= 0 THEN
      RAISE EXCEPTION '중복 편린 대체 지급액을 계산할 수 없습니다.' USING ERRCODE='P0L32';
    END IF;
    v_tx_id := public.create_transaction(
      p_student_id, 'CRYSTAL'::public.value_token_type, v_converted,
      'RAID_LOOT'::public.transaction_source_type, p_round_id, 0, p_dup_memo);
    RETURN jsonb_build_object('granted', false, 'duplicate', true,
                              'transaction_id', v_tx_id, 'converted_amount', v_converted);
  END IF;

  INSERT INTO public.character_acquisition_events(
    classroom_id, student_id, character_id, event_type, actor_user_id, reason, metadata)
  VALUES (v_classroom_id, p_student_id, p_character_id, 'RAID_LOOT', p_actor_user_id,
          '레이드 전리품', coalesce(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('granted', true, 'duplicate', false,
                            'acquisition_event_id', v_event_id, 'student_character_id', v_sc_id);
END;
$function$;

-- ============================================================================
-- [C] 내부 진행 함수
-- ============================================================================

-- C-1. 상품 공개: 잠긴 설정으로 전리품을 1회 결정해 라운드 행 생성 (이미 있으면 그대로)
CREATE OR REPLACE FUNCTION public._raid_loot_reveal_round(p_ceremony_id bigint, p_slot_no integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cer public.raid_loot_ceremonies%ROWTYPE;
  v_draw jsonb;
BEGIN
  SELECT * INTO v_cer FROM public.raid_loot_ceremonies WHERE id = p_ceremony_id;
  IF EXISTS (SELECT 1 FROM public.raid_loot_rounds WHERE ceremony_id = p_ceremony_id AND slot_no = p_slot_no) THEN
    RETURN;
  END IF;

  v_draw := public._raid_loot_draw_reward(p_slot_no, v_cer.config_snapshot);

  INSERT INTO public.raid_loot_rounds(
    ceremony_id, raid_id, slot_no, reward_kind, reward_amount, character_id, reward_snapshot, revealed_at)
  VALUES (
    p_ceremony_id, v_cer.raid_id, p_slot_no,
    v_draw->>'kind',
    CASE WHEN v_draw->>'kind' = 'CHARACTER' THEN NULL ELSE (v_draw->>'amount')::bigint END,
    CASE WHEN v_draw->>'kind' = 'CHARACTER' THEN (v_draw->>'character_id')::bigint ELSE NULL END,
    coalesce(v_draw->'snapshot', '{}'::jsonb),
    now());
END;
$function$;

-- C-2. 당첨자 확정 + 지급 + 기록 (호출한 진행 RPC의 한 트랜잭션 안에서 실행)
CREATE OR REPLACE FUNCTION public._raid_loot_settle_round(p_ceremony_id bigint, p_slot_no integer, p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cer public.raid_loot_ceremonies%ROWTYPE;
  v_round public.raid_loot_rounds%ROWTYPE;
  v_exclude integer;
  v_pick jsonb;
  v_student integer;
  v_title text;
  v_memo text;
  v_dup_memo text;
  v_winner jsonb;
  v_tx bigint;
  v_ledger bigint;
  v_grant jsonb;
  v_meta jsonb;
BEGIN
  SELECT * INTO v_cer FROM public.raid_loot_ceremonies WHERE id = p_ceremony_id;

  SELECT * INTO v_round
  FROM public.raid_loot_rounds
  WHERE ceremony_id = p_ceremony_id AND slot_no = p_slot_no
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '전리품이 아직 공개되지 않았습니다.' USING ERRCODE='P0L52';
  END IF;
  IF v_round.settlement_status <> 'UNSETTLED' THEN
    RETURN;  -- 이미 확정됨: 재추첨·재지급 없음
  END IF;

  -- 적격자 2명 이상이면 2차에서 1차 당첨자 제외 / 1명이면 같은 학생이 두 번
  IF p_slot_no = 2 AND v_cer.eligible_count >= 2 THEN
    SELECT winner_student_id INTO v_exclude
    FROM public.raid_loot_rounds
    WHERE ceremony_id = p_ceremony_id AND slot_no = 1;
  END IF;

  v_pick := public._raid_loot_pick_winner(v_cer.eligible_snapshot->'eligible', v_exclude);

  IF v_pick IS NULL THEN
    UPDATE public.raid_loot_rounds
    SET settlement_status = 'VOID',
        void_reason = 'NO_DRAWABLE_CANDIDATE',
        settled_at = now(),
        settlement_request_id = p_request_id,
        updated_at = now()
    WHERE id = v_round.id;
    RETURN;
  END IF;

  v_student := (v_pick->>'student_id')::integer;
  SELECT title INTO v_title FROM public.raids WHERE id = v_cer.raid_id;
  v_memo := '[레이드 전리품] ' || coalesce(v_title, '레이드') || ' · ' || p_slot_no || '차 전리품 '
            || coalesce(v_round.reward_snapshot->>'label', v_round.reward_kind);
  v_dup_memo := '[레이드 전리품] ' || coalesce(v_title, '레이드') || ' · 2차 전리품 「'
            || coalesce(v_round.reward_snapshot->>'display_name', '편린')
            || '」 이미 보유 → 기준가 90% 크리스탈 대체 지급';
  v_meta := jsonb_build_object('source', 'RAID_LOOT', 'raid_id', v_cer.raid_id,
                               'ceremony_id', v_cer.id, 'round_id', v_round.id, 'slot_no', p_slot_no);

  v_winner := jsonb_build_object(
    'student_id', v_student,
    'participant_id', (v_pick->>'participant_id')::bigint,
    'name', v_pick->>'name',
    'brand_name', v_pick->>'brand_name',
    'avatar_url', v_pick->>'avatar_url',
    'final_rank', (v_pick->>'final_rank')::integer,
    'total_damage', (v_pick->>'total_damage')::bigint,
    'contribution_percent', (v_pick->>'contribution_percent')::numeric,
    'draw_weight', (v_pick->>'draw_weight')::numeric,
    'draw_probability', (v_pick->>'draw_probability')::numeric,
    'candidate_count', (v_pick->>'candidate_count')::integer);

  IF v_round.reward_kind IN ('GOLD','CRYSTAL') THEN
    v_tx := public.create_transaction(
      v_student, v_round.reward_kind::public.value_token_type, v_round.reward_amount,
      'RAID_LOOT'::public.transaction_source_type, v_round.id, 0, v_memo);

    UPDATE public.raid_loot_rounds
    SET winner_student_id = v_student,
        winner_participant_id = (v_pick->>'participant_id')::bigint,
        winner_snapshot = v_winner,
        delivered_kind = v_round.reward_kind,
        delivered_amount = v_round.reward_amount,
        transaction_id = v_tx,
        settlement_status = 'SETTLED',
        settlement_request_id = p_request_id,
        settled_at = now(),
        updated_at = now()
    WHERE id = v_round.id;

  ELSIF v_round.reward_kind = 'FRAGMENTS' THEN
    v_ledger := public._raid_loot_credit_fragments(
      v_student, v_round.reward_amount::integer, p_request_id, auth.uid(), v_meta);

    UPDATE public.raid_loot_rounds
    SET winner_student_id = v_student,
        winner_participant_id = (v_pick->>'participant_id')::bigint,
        winner_snapshot = v_winner,
        delivered_kind = 'FRAGMENTS',
        delivered_amount = v_round.reward_amount,
        fragment_ledger_id = v_ledger,
        settlement_status = 'SETTLED',
        settlement_request_id = p_request_id,
        settled_at = now(),
        updated_at = now()
    WHERE id = v_round.id;

  ELSE
    -- CHARACTER: 잠긴 기준가로 처리 (잠금 후 비활성화·가격 변경은 무시하고 그대로 지급)
    v_grant := public._raid_loot_grant_character(
      v_student, v_round.character_id,
      (v_round.reward_snapshot->>'base_price_crystal')::bigint,
      v_round.id, v_dup_memo, auth.uid(),
      v_meta || jsonb_build_object('base_price_crystal', (v_round.reward_snapshot->>'base_price_crystal')::bigint));

    IF (v_grant->>'granted')::boolean THEN
      UPDATE public.raid_loot_rounds
      SET winner_student_id = v_student,
          winner_participant_id = (v_pick->>'participant_id')::bigint,
          winner_snapshot = v_winner,
          delivered_kind = 'CHARACTER',
          delivered_character_id = v_round.character_id,
          acquisition_event_id = (v_grant->>'acquisition_event_id')::bigint,
          settlement_status = 'SETTLED',
          settlement_request_id = p_request_id,
          settled_at = now(),
          updated_at = now()
      WHERE id = v_round.id;
    ELSE
      UPDATE public.raid_loot_rounds
      SET winner_student_id = v_student,
          winner_participant_id = (v_pick->>'participant_id')::bigint,
          winner_snapshot = v_winner,
          delivered_kind = 'CRYSTAL',
          delivered_amount = (v_grant->>'converted_amount')::bigint,
          transaction_id = (v_grant->>'transaction_id')::bigint,
          settlement_status = 'SETTLED',
          settlement_request_id = p_request_id,
          settled_at = now(),
          updated_at = now()
      WHERE id = v_round.id;
    END IF;
  END IF;
END;
$function$;

-- ============================================================================
-- [D] 화면용 상태 조립
-- ============================================================================

-- D-1. 라운드 1개를 공개용 JSON으로 (당첨자는 확정된 뒤에만 포함)
CREATE OR REPLACE FUNCTION public._raid_loot_round_public_json(p_round public.raid_loot_rounds, p_me integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'slot_no', p_round.slot_no,
    'kind', p_round.reward_kind,
    'label', coalesce(p_round.reward_snapshot->>'label', p_round.reward_kind),
    'amount', p_round.reward_amount,
    'character_id', p_round.character_id,
    'character_uid', p_round.reward_snapshot->>'character_uid',
    'character_name', p_round.reward_snapshot->>'display_name',
    'character_image_url', p_round.reward_snapshot->>'image_url',
    'character_emoji', p_round.reward_snapshot->>'emoji',
    'settlement_status', p_round.settlement_status,
    'winner', CASE WHEN p_round.settlement_status = 'SETTLED' THEN jsonb_build_object(
        'student_id', p_round.winner_student_id,
        'display_name', p_round.winner_snapshot->>'name',
        'brand_name', p_round.winner_snapshot->>'brand_name',
        'avatar_url', p_round.winner_snapshot->>'avatar_url',
        'final_rank', (p_round.winner_snapshot->>'final_rank')::integer,
        'contribution_percent', (p_round.winner_snapshot->>'contribution_percent')::numeric,
        'is_me', (p_me IS NOT NULL AND p_round.winner_student_id = p_me))
      ELSE NULL END,
    'delivered_kind', CASE WHEN p_round.settlement_status = 'SETTLED' THEN p_round.delivered_kind END,
    'delivered_amount', CASE WHEN p_round.settlement_status = 'SETTLED' THEN p_round.delivered_amount END,
    'duplicate_character_converted', (p_round.settlement_status = 'SETTLED'
                                      AND p_round.reward_kind = 'CHARACTER'
                                      AND p_round.delivered_kind = 'CRYSTAL'),
    'original_base_price_crystal', CASE WHEN p_round.reward_kind = 'CHARACTER'
                                        THEN (p_round.reward_snapshot->>'base_price_crystal')::bigint END,
    'conversion_rate_bp', CASE WHEN p_round.reward_kind = 'CHARACTER' THEN 9000 END,
    'void', p_round.settlement_status = 'VOID');
$function$;

-- D-2. 학생에게 보여줄 상태 (공개된 단계까지만)
CREATE OR REPLACE FUNCTION public._raid_loot_public_state(p_raid_id bigint, p_me integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_enabled boolean;
  v_cer public.raid_loot_ceremonies%ROWTYPE;
  v_rewards jsonb;
  v_reason text;
  v_no_eligible boolean;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  SELECT enabled INTO v_enabled FROM public.raid_loot_configs WHERE raid_id = p_raid_id;
  SELECT * INTO v_cer FROM public.raid_loot_ceremonies WHERE raid_id = p_raid_id;

  IF v_cer.id IS NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.raid_loot_audit_events
                   WHERE raid_id = p_raid_id AND action = 'PREPARE_NO_ELIGIBLE')
      INTO v_no_eligible;
    v_reason := CASE
      WHEN v_raid.status = 'FAILED' THEN 'RAID_FAILED'
      WHEN NOT coalesce(v_enabled, false) THEN 'DISABLED'
      WHEN v_no_eligible THEN 'NO_ELIGIBLE'
      ELSE NULL END;
    RETURN jsonb_build_object(
      'raid_id', p_raid_id,
      'enabled', coalesce(v_enabled, false),
      'stage', NULL,
      'eligible_count', NULL,
      'unavailable_reason', v_reason,
      'rewards', '[]'::jsonb,
      'my_win_count', 0);
  END IF;

  SELECT coalesce(jsonb_agg(public._raid_loot_round_public_json(r, p_me) ORDER BY r.slot_no), '[]'::jsonb)
    INTO v_rewards
  FROM public.raid_loot_rounds r
  WHERE r.ceremony_id = v_cer.id;

  RETURN jsonb_build_object(
    'raid_id', p_raid_id,
    'enabled', coalesce(v_enabled, false),
    'stage', v_cer.status,
    'eligible_count', v_cer.eligible_count,
    'unavailable_reason', NULL,
    'rewards', v_rewards,
    'my_win_count', (SELECT count(*) FROM public.raid_loot_rounds r
                     WHERE r.ceremony_id = v_cer.id AND r.settlement_status = 'SETTLED'
                       AND p_me IS NOT NULL AND r.winner_student_id = p_me));
END;
$function$;

-- D-3. 교사(중계화면)용 전체 상태
CREATE OR REPLACE FUNCTION public._raid_loot_admin_state(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_stored jsonb;
  v_issues text[] := '{}';
  v_cer public.raid_loot_ceremonies%ROWTYPE;
  v_preview jsonb;
  v_eligible jsonb := '[]'::jsonb;
  v_eligible_count integer;
  v_rounds jsonb := '[]'::jsonb;
  v_slot1_winner integer;
  v_shuffle1 jsonb := '[]'::jsonb;
  v_shuffle2 jsonb := '[]'::jsonb;
  v_reason text;
  v_next_label text;
  v_can_prepare boolean := false;
  v_audit jsonb;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  v_stored := public._raid_loot_stored_config(p_raid_id);
  IF v_stored IS NOT NULL THEN
    v_issues := public._raid_loot_config_issues(v_stored);
  END IF;
  SELECT * INTO v_cer FROM public.raid_loot_ceremonies WHERE raid_id = p_raid_id;

  IF v_cer.id IS NOT NULL THEN
    v_eligible := coalesce(v_cer.eligible_snapshot->'eligible', '[]'::jsonb);
    v_eligible_count := v_cer.eligible_count;

    SELECT coalesce(jsonb_agg(
             public._raid_loot_round_public_json(r, NULL) || jsonb_build_object(
               'round_id', r.id,
               'reward_snapshot', r.reward_snapshot,
               'revealed_at', r.revealed_at,
               'drawing_at', r.drawing_at,
               'settled_at', r.settled_at,
               'void_reason', r.void_reason,
               'winner_snapshot', r.winner_snapshot,
               'transaction_id', r.transaction_id,
               'fragment_ledger_id', r.fragment_ledger_id,
               'acquisition_event_id', r.acquisition_event_id)
             ORDER BY r.slot_no), '[]'::jsonb)
      INTO v_rounds
    FROM public.raid_loot_rounds r
    WHERE r.ceremony_id = v_cer.id;

    SELECT winner_student_id INTO v_slot1_winner
    FROM public.raid_loot_rounds
    WHERE ceremony_id = v_cer.id AND slot_no = 1 AND settlement_status = 'SETTLED';

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'student_id', (t.e->>'student_id')::integer,
             'name', t.e->>'name',
             'avatar_url', t.e->>'avatar_url') ORDER BY (t.e->>'display_order')::integer), '[]'::jsonb)
      INTO v_shuffle1
    FROM jsonb_array_elements(v_eligible) AS t(e);

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'student_id', (t.e->>'student_id')::integer,
             'name', t.e->>'name',
             'avatar_url', t.e->>'avatar_url') ORDER BY (t.e->>'display_order')::integer), '[]'::jsonb)
      INTO v_shuffle2
    FROM jsonb_array_elements(v_eligible) AS t(e)
    WHERE v_cer.eligible_count < 2 OR v_slot1_winner IS NULL
       OR (t.e->>'student_id')::integer <> v_slot1_winner;

    v_next_label := CASE v_cer.status
      WHEN 'READY' THEN '1차 전리품 공개'
      WHEN 'SLOT1_ITEM' THEN '1차 획득자 추첨 시작'
      WHEN 'SLOT1_DRAWING' THEN '당첨자 확정'
      WHEN 'SLOT1_WINNER' THEN '2차 전리품 공개'
      WHEN 'SLOT2_ITEM' THEN '2차 획득자 추첨 시작'
      WHEN 'SLOT2_DRAWING' THEN '당첨자 확정'
      WHEN 'SLOT2_WINNER' THEN '최종 결과'
      ELSE NULL END;
  ELSE
    IF v_raid.status = 'COMPLETED' THEN
      v_preview := public._raid_loot_eligible_snapshot(p_raid_id);
      v_eligible := coalesce(v_preview->'eligible', '[]'::jsonb);
      v_eligible_count := (v_preview->>'eligible_count')::integer;
    END IF;

    v_reason := CASE
      WHEN v_raid.status = 'FAILED' THEN 'RAID_FAILED'
      WHEN v_stored IS NULL OR NOT coalesce((v_stored->>'enabled')::boolean, false) THEN 'DISABLED'
      WHEN v_raid.status <> 'COMPLETED' THEN 'NOT_COMPLETED'
      WHEN coalesce(v_eligible_count, 0) = 0 THEN 'NO_ELIGIBLE'
      WHEN cardinality(v_issues) > 0 THEN 'CONFIG_INCOMPLETE'
      ELSE NULL END;
    v_can_prepare := (v_reason IS NULL);
    v_next_label := CASE WHEN v_can_prepare THEN '전리품 획득식 시작' ELSE NULL END;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'action', a.action, 'slot_no', a.slot_no,
           'from_status', a.from_status, 'to_status', a.to_status,
           'created_at', a.created_at, 'metadata', a.metadata) ORDER BY a.id DESC), '[]'::jsonb)
    INTO v_audit
  FROM (SELECT * FROM public.raid_loot_audit_events
        WHERE raid_id = p_raid_id ORDER BY id DESC LIMIT 30) a;

  RETURN jsonb_build_object(
    'raid', jsonb_build_object(
      'id', v_raid.id, 'title', v_raid.title, 'boss_name', v_raid.boss_name,
      'status', v_raid.status, 'classroom_id', v_raid.classroom_id),
    'enabled', coalesce((v_stored->>'enabled')::boolean, false),
    'config_version', (v_stored->>'config_version')::integer,
    'config_issues', to_jsonb(v_issues),
    'ceremony', CASE WHEN v_cer.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_cer.id, 'status', v_cer.status, 'eligible_count', v_cer.eligible_count,
        'total_damage', v_cer.total_damage, 'version', v_cer.version,
        'created_at', v_cer.created_at, 'updated_at', v_cer.updated_at,
        'completed_at', v_cer.completed_at) END,
    'stage', v_cer.status,
    'unavailable_reason', v_reason,
    'can_prepare', v_can_prepare,
    'next_action', CASE WHEN v_next_label IS NULL THEN NULL ELSE jsonb_build_object(
        'expected_status', coalesce(v_cer.status, 'NONE'),
        'label', v_next_label) END,
    'eligible_count', v_eligible_count,
    'eligible', v_eligible,
    'shuffle_candidates', jsonb_build_object('slot1', v_shuffle1, 'slot2', v_shuffle2),
    'rewards', v_rounds,
    'audit', v_audit);
END;
$function$;

-- D-4. 교사 설정 패널용 상태
CREATE OR REPLACE FUNCTION public._raid_loot_config_view(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_stored jsonb;
  v_has_cer boolean;
  v_available jsonb;
  v_drift jsonb;
  v_copy jsonb;
  v_rehearsal jsonb;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  v_stored := public._raid_loot_stored_config(p_raid_id);
  SELECT EXISTS (SELECT 1 FROM public.raid_loot_ceremonies WHERE raid_id = p_raid_id) INTO v_has_cer;

  -- 이 학급에서 후보가 될 수 있는 편린 전체
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'character_id', c.id,
           'character_uid', c.character_uid,
           'display_name', c.name,
           'image_url', coalesce(c.card_image_url, c.full_image_url, c.avatar_image_url, c.resource_url),
           'emoji', c.emoji,
           'base_price_crystal', o.base_price_crystal,
           'default_weight', public._raid_loot_char_weight(o.base_price_crystal, 1))
           ORDER BY o.base_price_crystal, c.sort_order, c.id), '[]'::jsonb)
    INTO v_available
  FROM public.characters c
  JOIN public.character_recruitment_offers o
    ON o.character_id = c.id AND o.classroom_id = v_raid.classroom_id
  WHERE c.is_active = true AND o.is_active = true
    AND o.acquisition_mode = 'CRYSTAL' AND o.base_price_crystal >= 1000;

  -- 저장 후 영입 설정이 바뀐 후보 (경고만, 차단하지 않음)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'character_id', p.character_id,
           'display_name', p.display_name,
           'saved_price', p.base_price_crystal,
           'live_price', o.base_price_crystal,
           'message', CASE
             WHEN o.id IS NULL OR NOT coalesce(o.is_active, false) OR NOT coalesce(c.is_active, false)
               THEN '「' || p.display_name || '」 편린이 영입 설정에서 비활성화되었습니다.'
             WHEN o.acquisition_mode <> 'CRYSTAL'
               THEN '「' || p.display_name || '」 편린의 영입 방식이 바뀌었습니다(크리스탈 영입 아님).'
             ELSE '「' || p.display_name || '」 기준가가 ' || p.base_price_crystal || 'C → '
                  || o.base_price_crystal || 'C 로 바뀌었습니다.' END)), '[]'::jsonb)
    INTO v_drift
  FROM public.raid_loot_character_pool p
  LEFT JOIN public.character_recruitment_offers o
    ON o.character_id = p.character_id AND o.classroom_id = v_raid.classroom_id
  LEFT JOIN public.characters c ON c.id = p.character_id
  WHERE p.raid_id = p_raid_id
    AND (o.id IS NULL OR NOT o.is_active OR NOT c.is_active
         OR o.acquisition_mode <> 'CRYSTAL' OR o.base_price_crystal <> p.base_price_crystal);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'raid_id', r.id, 'title', r.title, 'status', r.status,
           'config_version', lc.config_version, 'updated_at', lc.updated_at)
           ORDER BY lc.updated_at DESC), '[]'::jsonb)
    INTO v_copy
  FROM public.raid_loot_configs lc
  JOIN public.raids r ON r.id = lc.raid_id
  WHERE lc.classroom_id = v_raid.classroom_id AND lc.raid_id <> p_raid_id;

  SELECT coalesce(jsonb_agg(x.j ORDER BY x.completed_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_rehearsal
  FROM (
    SELECT jsonb_build_object(
             'raid_id', r.id, 'title', r.title, 'boss_name', r.boss_name,
             'completed_at', r.completed_at,
             'participant_count', (SELECT count(*) FROM public.raid_participants rp WHERE rp.raid_id = r.id),
             'has_config', EXISTS (SELECT 1 FROM public.raid_loot_configs lc WHERE lc.raid_id = r.id)) AS j,
           r.completed_at
    FROM public.raids r
    WHERE r.classroom_id = v_raid.classroom_id AND r.status = 'COMPLETED'
    ORDER BY r.completed_at DESC NULLS LAST
    LIMIT 30
  ) x;

  RETURN jsonb_build_object(
    'raid', jsonb_build_object(
      'id', v_raid.id, 'title', v_raid.title, 'boss_name', v_raid.boss_name,
      'status', v_raid.status, 'classroom_id', v_raid.classroom_id),
    'editable', v_raid.status IN ('DRAFT','LOBBY_OPEN') AND NOT v_has_cer,
    'has_ceremony', v_has_cer,
    'config', v_stored,
    'issues', CASE WHEN v_stored IS NULL THEN '[]'::jsonb
                   ELSE to_jsonb(public._raid_loot_config_issues(v_stored)) END,
    'drift_warnings', v_drift,
    'available_characters', v_available,
    'copy_sources', v_copy,
    'rehearsal_sources', v_rehearsal);
END;
$function$;

-- ============================================================================
-- [E] 교사 RPC
-- ============================================================================

-- E-1. 설정 조회
CREATE OR REPLACE FUNCTION public.teacher_get_raid_loot_config(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
BEGIN
  SELECT classroom_id INTO v_classroom_id FROM public.raids WHERE id = p_raid_id;
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_classroom_id);
  RETURN public._raid_loot_config_view(p_raid_id);
END;
$function$;

-- E-2. 설정 저장 (DRAFT / LOBBY_OPEN 에서만 — 전투가 시작되면 저장 불가 = 잠금)
CREATE OR REPLACE FUNCTION public.teacher_save_raid_loot_config(
  p_raid_id bigint, p_payload jsonb, p_expected_version integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_cfg public.raid_loot_configs%ROWTYPE;
  v_norm jsonb;
  v_issues text[];
  v_enabled boolean;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  IF v_raid.status NOT IN ('DRAFT','LOBBY_OPEN') THEN
    RAISE EXCEPTION '전투가 시작된 레이드의 전리품 설정은 바꿀 수 없습니다. (전투 시작 전 마지막 저장값으로 잠겨 있음)'
      USING ERRCODE='P0L14';
  END IF;
  IF EXISTS (SELECT 1 FROM public.raid_loot_ceremonies WHERE raid_id = p_raid_id) THEN
    RAISE EXCEPTION '이미 전리품 획득식이 진행된 레이드입니다.' USING ERRCODE='P0L14';
  END IF;

  SELECT * INTO v_cfg FROM public.raid_loot_configs WHERE raid_id = p_raid_id FOR UPDATE;
  IF FOUND AND p_expected_version IS DISTINCT FROM v_cfg.config_version THEN
    RAISE EXCEPTION '다른 화면에서 설정이 먼저 저장되었습니다. 새로고침 후 다시 저장하세요.' USING ERRCODE='P0L15';
  END IF;

  v_norm := public._raid_loot_normalize_config(v_raid.classroom_id, coalesce(p_payload, '{}'::jsonb), true);
  v_enabled := coalesce((p_payload->>'enabled')::boolean, false);
  SELECT coalesce(array_agg(x), '{}') INTO v_issues FROM jsonb_array_elements_text(v_norm->'issues') AS x;

  IF v_enabled AND cardinality(v_issues) > 0 THEN
    RAISE EXCEPTION '전리품을 켜려면 설정을 마저 채워 주세요: %', array_to_string(v_issues, ' / ')
      USING ERRCODE='P0L16';
  END IF;

  INSERT INTO public.raid_loot_configs(
    raid_id, classroom_id, enabled, config_version, slot1, slot2, updated_at, updated_by)
  VALUES (p_raid_id, v_raid.classroom_id, v_enabled, 1, v_norm->'slot1', v_norm->'slot2', now(), auth.uid())
  ON CONFLICT (raid_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        slot1 = EXCLUDED.slot1,
        slot2 = EXCLUDED.slot2,
        config_version = public.raid_loot_configs.config_version + 1,
        updated_at = now(),
        updated_by = auth.uid();

  DELETE FROM public.raid_loot_character_pool WHERE raid_id = p_raid_id;
  INSERT INTO public.raid_loot_character_pool(
    raid_id, character_id, manual_factor, base_price_crystal, display_name,
    character_uid, image_url, emoji, is_selected, sort_order, saved_at)
  SELECT p_raid_id,
         (t.e->>'character_id')::bigint,
         (t.e->>'manual_factor')::numeric,
         (t.e->>'base_price_crystal')::bigint,
         t.e->>'display_name',
         t.e->>'character_uid',
         t.e->>'image_url',
         t.e->>'emoji',
         coalesce((t.e->>'is_selected')::boolean, true),
         coalesce((t.e->>'sort_order')::integer, 0),
         now()
  FROM jsonb_array_elements(v_norm->'pool') AS t(e);

  INSERT INTO public.raid_loot_audit_events(raid_id, action, actor_user_id, metadata)
  VALUES (p_raid_id, 'CONFIG_SAVE', auth.uid(),
          jsonb_build_object('enabled', v_enabled, 'issues', v_norm->'issues'));

  RETURN public._raid_loot_config_view(p_raid_id);
END;
$function$;

-- E-3. 다른 레이드의 상품 구성 복사 (당첨자·지급·진행 상태는 절대 복사하지 않음)
CREATE OR REPLACE FUNCTION public.teacher_copy_raid_loot_config(p_from_raid_id bigint, p_to_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from public.raids%ROWTYPE;
  v_to public.raids%ROWTYPE;
  v_src jsonb;
  v_norm jsonb;
  v_enabled boolean;
BEGIN
  SELECT * INTO v_from FROM public.raids WHERE id = p_from_raid_id;
  SELECT * INTO v_to FROM public.raids WHERE id = p_to_raid_id FOR UPDATE;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_from.classroom_id);
  PERFORM public.raid_teacher_require_classroom(v_to.classroom_id);

  IF v_to.status NOT IN ('DRAFT','LOBBY_OPEN')
     OR EXISTS (SELECT 1 FROM public.raid_loot_ceremonies WHERE raid_id = p_to_raid_id) THEN
    RAISE EXCEPTION '설정을 붙여 넣을 레이드는 전투 시작 전이어야 합니다.' USING ERRCODE='P0L14';
  END IF;

  v_src := public._raid_loot_stored_config(p_from_raid_id);
  IF v_src IS NULL THEN
    RAISE EXCEPTION '복사할 전리품 설정이 없습니다.' USING ERRCODE='P0L17';
  END IF;

  v_norm := public._raid_loot_normalize_config(v_to.classroom_id, v_src, false);
  SELECT enabled INTO v_enabled FROM public.raid_loot_configs WHERE raid_id = p_to_raid_id;
  v_enabled := coalesce(v_enabled, false) AND jsonb_array_length(v_norm->'issues') = 0;

  INSERT INTO public.raid_loot_configs(
    raid_id, classroom_id, enabled, config_version, slot1, slot2, updated_at, updated_by)
  VALUES (p_to_raid_id, v_to.classroom_id, v_enabled, 1, v_norm->'slot1', v_norm->'slot2', now(), auth.uid())
  ON CONFLICT (raid_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        slot1 = EXCLUDED.slot1,
        slot2 = EXCLUDED.slot2,
        config_version = public.raid_loot_configs.config_version + 1,
        updated_at = now(),
        updated_by = auth.uid();

  DELETE FROM public.raid_loot_character_pool WHERE raid_id = p_to_raid_id;
  INSERT INTO public.raid_loot_character_pool(
    raid_id, character_id, manual_factor, base_price_crystal, display_name,
    character_uid, image_url, emoji, is_selected, sort_order, saved_at)
  SELECT p_to_raid_id,
         (t.e->>'character_id')::bigint,
         (t.e->>'manual_factor')::numeric,
         (t.e->>'base_price_crystal')::bigint,
         t.e->>'display_name',
         t.e->>'character_uid',
         t.e->>'image_url',
         t.e->>'emoji',
         coalesce((t.e->>'is_selected')::boolean, true),
         coalesce((t.e->>'sort_order')::integer, 0),
         now()
  FROM jsonb_array_elements(v_norm->'pool') AS t(e);

  INSERT INTO public.raid_loot_audit_events(raid_id, action, actor_user_id, metadata)
  VALUES (p_to_raid_id, 'CONFIG_COPY', auth.uid(),
          jsonb_build_object('from_raid_id', p_from_raid_id, 'dropped', v_norm->'dropped'));

  RETURN public._raid_loot_config_view(p_to_raid_id)
         || jsonb_build_object('copy_dropped', v_norm->'dropped');
END;
$function$;

-- E-4. 획득식 시작 (버튼 1: 전리품 획득식 시작)
CREATE OR REPLACE FUNCTION public.teacher_prepare_raid_loot(p_raid_id bigint, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_cfg public.raid_loot_configs%ROWTYPE;
  v_stored jsonb;
  v_issues text[];
  v_elig jsonb;
  v_n integer;
  v_cer_id bigint;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION '요청 ID가 필요합니다.' USING ERRCODE='P0L40';
  END IF;

  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  -- 같은 요청 재전송 / 이미 시작됨 → 현재 상태 그대로
  IF EXISTS (SELECT 1 FROM public.raid_loot_ceremonies WHERE raid_id = p_raid_id)
     OR EXISTS (SELECT 1 FROM public.raid_loot_audit_events WHERE raid_id = p_raid_id AND request_id = p_request_id) THEN
    RETURN public._raid_loot_admin_state(p_raid_id);
  END IF;

  IF v_raid.status <> 'COMPLETED' THEN
    RAISE EXCEPTION '%', CASE v_raid.status
        WHEN 'FAILED' THEN '토벌에 실패한 레이드에는 전리품이 없습니다.'
        WHEN 'ARCHIVED' THEN '보관된 레이드에서는 새 전리품 획득식을 시작할 수 없습니다.'
        ELSE '보스 토벌이 끝난(성공) 레이드에서만 시작할 수 있습니다.' END
      USING ERRCODE='P0L41';
  END IF;

  SELECT * INTO v_cfg FROM public.raid_loot_configs WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND OR NOT v_cfg.enabled THEN
    RAISE EXCEPTION '이 레이드는 전리품이 꺼져 있습니다.' USING ERRCODE='P0L42';
  END IF;

  v_stored := public._raid_loot_stored_config(p_raid_id);
  v_issues := public._raid_loot_config_issues(v_stored);
  IF cardinality(v_issues) > 0 THEN
    RAISE EXCEPTION '전리품 설정이 완성되지 않았습니다: %', array_to_string(v_issues, ' / ') USING ERRCODE='P0L43';
  END IF;

  v_elig := public._raid_loot_eligible_snapshot(p_raid_id);
  v_n := (v_elig->>'eligible_count')::integer;

  IF v_n = 0 THEN
    INSERT INTO public.raid_loot_audit_events(raid_id, action, actor_user_id, request_id, metadata)
    VALUES (p_raid_id, 'PREPARE_NO_ELIGIBLE', auth.uid(), p_request_id,
            jsonb_build_object('total_damage', v_elig->'total_damage'));
    RETURN public._raid_loot_admin_state(p_raid_id);
  END IF;

  UPDATE public.raid_loot_configs
  SET locked_at = coalesce(locked_at, now()),
      locked_snapshot = v_stored,
      updated_at = now()
  WHERE raid_id = p_raid_id;

  INSERT INTO public.raid_loot_ceremonies(
    raid_id, classroom_id, raid_original_status, status,
    config_snapshot, eligible_snapshot, eligible_count, total_damage, prepared_by)
  VALUES (
    p_raid_id, v_raid.classroom_id, 'COMPLETED', 'READY',
    v_stored, v_elig, v_n, (v_elig->>'total_damage')::numeric::bigint, auth.uid())
  RETURNING id INTO v_cer_id;

  INSERT INTO public.raid_loot_audit_events(
    raid_id, ceremony_id, action, from_status, to_status, actor_user_id, request_id, metadata)
  VALUES (p_raid_id, v_cer_id, 'PREPARE', NULL, 'READY', auth.uid(), p_request_id,
          jsonb_build_object('eligible_count', v_n, 'total_damage', v_elig->'total_damage'));

  RETURN public._raid_loot_admin_state(p_raid_id);
END;
$function$;

-- E-5. 획득식 다음 단계 (버튼 2~8)
CREATE OR REPLACE FUNCTION public.teacher_advance_raid_loot(p_raid_id bigint, p_expected_status text, p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_cer public.raid_loot_ceremonies%ROWTYPE;
  v_next text;
  v_slot smallint;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION '요청 ID가 필요합니다.' USING ERRCODE='P0L40';
  END IF;

  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  SELECT * INTO v_cer FROM public.raid_loot_ceremonies WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '아직 전리품 획득식이 시작되지 않았습니다.' USING ERRCODE='P0L50';
  END IF;

  -- 같은 요청 재전송(버튼 연타·네트워크 재시도) → 새 전이 없이 현재 상태
  IF EXISTS (SELECT 1 FROM public.raid_loot_audit_events WHERE raid_id = p_raid_id AND request_id = p_request_id) THEN
    RETURN public._raid_loot_admin_state(p_raid_id) || jsonb_build_object('duplicate_request', true);
  END IF;

  -- 다른 화면이 먼저 진행함 → 최신 상태만 돌려줌
  IF v_cer.status IS DISTINCT FROM p_expected_status THEN
    RETURN public._raid_loot_admin_state(p_raid_id) || jsonb_build_object('stale', true);
  END IF;

  -- 이미 시작한 획득식은 레이드가 보관(ARCHIVED)되어도 끝까지 진행 가능
  IF v_raid.status NOT IN ('COMPLETED','ARCHIVED') THEN
    RAISE EXCEPTION '레이드 상태가 바뀌어 진행할 수 없습니다.' USING ERRCODE='P0L51';
  END IF;

  CASE v_cer.status
    WHEN 'READY' THEN
      v_next := 'SLOT1_ITEM'; v_slot := 1;
      PERFORM public._raid_loot_reveal_round(v_cer.id, 1);
    WHEN 'SLOT1_ITEM' THEN
      v_next := 'SLOT1_DRAWING'; v_slot := 1;
      UPDATE public.raid_loot_rounds SET drawing_at = now(), updated_at = now()
      WHERE ceremony_id = v_cer.id AND slot_no = 1;
    WHEN 'SLOT1_DRAWING' THEN
      v_next := 'SLOT1_WINNER'; v_slot := 1;
      PERFORM public._raid_loot_settle_round(v_cer.id, 1, p_request_id);
    WHEN 'SLOT1_WINNER' THEN
      v_next := 'SLOT2_ITEM'; v_slot := 2;
      PERFORM public._raid_loot_reveal_round(v_cer.id, 2);
    WHEN 'SLOT2_ITEM' THEN
      v_next := 'SLOT2_DRAWING'; v_slot := 2;
      UPDATE public.raid_loot_rounds SET drawing_at = now(), updated_at = now()
      WHERE ceremony_id = v_cer.id AND slot_no = 2;
    WHEN 'SLOT2_DRAWING' THEN
      v_next := 'SLOT2_WINNER'; v_slot := 2;
      PERFORM public._raid_loot_settle_round(v_cer.id, 2, p_request_id);
    WHEN 'SLOT2_WINNER' THEN
      IF (SELECT count(*) FROM public.raid_loot_rounds
          WHERE ceremony_id = v_cer.id AND settlement_status IN ('SETTLED','VOID')) <> 2 THEN
        RAISE EXCEPTION '두 전리품의 지급 기록이 모두 확인되지 않았습니다.' USING ERRCODE='P0L53';
      END IF;
      v_next := 'COMPLETE'; v_slot := NULL;
    ELSE
      RETURN public._raid_loot_admin_state(p_raid_id);
  END CASE;

  UPDATE public.raid_loot_ceremonies
  SET status = v_next,
      version = version + 1,
      updated_at = now(),
      completed_at = CASE WHEN v_next = 'COMPLETE' THEN now() ELSE completed_at END
  WHERE id = v_cer.id;

  INSERT INTO public.raid_loot_audit_events(
    raid_id, ceremony_id, slot_no, action, from_status, to_status, actor_user_id, request_id)
  VALUES (p_raid_id, v_cer.id, v_slot, 'ADVANCE', v_cer.status, v_next, auth.uid(), p_request_id);

  RETURN public._raid_loot_admin_state(p_raid_id);
END;
$function$;

-- E-6. 중계화면 상태 조회 (1초 폴링용)
CREATE OR REPLACE FUNCTION public.teacher_get_raid_loot_ceremony(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
BEGIN
  SELECT classroom_id INTO v_classroom_id FROM public.raids WHERE id = p_raid_id;
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_classroom_id);
  RETURN public._raid_loot_admin_state(p_raid_id);
END;
$function$;

-- E-7. 리허설 대본 (읽기 전용: STABLE 이라 DB가 쓰기를 거절)
--      p_config_source: 'RAID'(이 레이드 설정) / 'OTHER_RAID'(p_config_raid_id 설정) / 'DRAFT'(p_config_payload)
CREATE OR REPLACE FUNCTION public.teacher_rehearse_raid_loot(
  p_source_raid_id bigint,
  p_config_source text DEFAULT 'RAID',
  p_config_raid_id bigint DEFAULT NULL,
  p_config_payload jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_cfg_raid public.raids%ROWTYPE;
  v_source text := upper(coalesce(p_config_source, 'RAID'));
  v_cfg jsonb;
  v_issues text[];
  v_elig jsonb;
  v_n integer;
  v_r1 jsonb;
  v_r2 jsonb;
  v_w1 jsonb;
  v_w2 jsonb;
  v_owned boolean := false;
  v_rewards jsonb;
  v_shuffle1 jsonb;
  v_shuffle2 jsonb;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_source_raid_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '레이드를 찾을 수 없습니다.' USING ERRCODE='P0202';
  END IF;
  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  IF v_raid.status <> 'COMPLETED' THEN
    RAISE EXCEPTION '리허설은 토벌에 성공한 레이드의 기록으로만 할 수 있습니다.' USING ERRCODE='P0L70';
  END IF;

  IF v_source = 'RAID' THEN
    v_cfg := public._raid_loot_stored_config(p_source_raid_id);
    IF v_cfg IS NULL THEN
      RAISE EXCEPTION '이 레이드에는 저장된 전리품 설정이 없습니다. 다른 설정을 골라 리허설하세요.' USING ERRCODE='P0L71';
    END IF;
  ELSIF v_source = 'OTHER_RAID' THEN
    SELECT * INTO v_cfg_raid FROM public.raids WHERE id = p_config_raid_id;
    IF v_cfg_raid.id IS NULL OR v_cfg_raid.classroom_id <> v_raid.classroom_id THEN
      RAISE EXCEPTION '같은 학급 레이드의 설정만 사용할 수 있습니다.' USING ERRCODE='P0L71';
    END IF;
    v_cfg := public._raid_loot_stored_config(p_config_raid_id);
    IF v_cfg IS NULL THEN
      RAISE EXCEPTION '고른 레이드에 저장된 전리품 설정이 없습니다.' USING ERRCODE='P0L71';
    END IF;
  ELSIF v_source = 'DRAFT' THEN
    v_cfg := public._raid_loot_normalize_config(v_raid.classroom_id, coalesce(p_config_payload, '{}'::jsonb), true);
  ELSE
    RAISE EXCEPTION '리허설 설정 원천이 올바르지 않습니다.' USING ERRCODE='P0L71';
  END IF;

  v_issues := public._raid_loot_config_issues(v_cfg);
  IF cardinality(v_issues) > 0 THEN
    RAISE EXCEPTION '리허설할 설정이 아직 완성되지 않았습니다: %', array_to_string(v_issues, ' / ') USING ERRCODE='P0L72';
  END IF;

  v_elig := public._raid_loot_eligible_snapshot(p_source_raid_id);
  v_n := (v_elig->>'eligible_count')::integer;

  IF v_n = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'REHEARSAL', 'source_raid_id', p_source_raid_id,
      'source_raid_title', v_raid.title, 'boss_name', v_raid.boss_name,
      'config_source', v_source, 'eligible_count', 0,
      'unavailable_reason', 'NO_ELIGIBLE', 'rewards', '[]'::jsonb,
      'shuffle_candidates', jsonb_build_object('slot1', '[]'::jsonb, 'slot2', '[]'::jsonb),
      'generated_at', now());
  END IF;

  v_r1 := public._raid_loot_draw_reward(1, v_cfg);
  v_w1 := public._raid_loot_pick_winner(v_elig->'eligible', NULL);
  v_r2 := public._raid_loot_draw_reward(2, v_cfg);
  v_w2 := public._raid_loot_pick_winner(
            v_elig->'eligible',
            CASE WHEN v_n >= 2 THEN (v_w1->>'student_id')::integer END);

  IF v_r2->>'kind' = 'CHARACTER' AND v_w2 IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.student_characters sc
      WHERE sc.student_id = (v_w2->>'student_id')::integer
        AND sc.character_id = (v_r2->>'character_id')::bigint
        AND sc.is_owned = true)
      INTO v_owned;
  END IF;

  SELECT jsonb_agg(x.j ORDER BY x.slot) INTO v_rewards
  FROM (
    SELECT s.slot,
           jsonb_build_object(
             'slot_no', s.slot,
             'kind', s.r->>'kind',
             'label', s.r->'snapshot'->>'label',
             'amount', CASE WHEN s.r->>'kind' = 'CHARACTER' THEN NULL ELSE (s.r->>'amount')::bigint END,
             'character_id', (s.r->>'character_id')::bigint,
             'character_uid', s.r->'snapshot'->>'character_uid',
             'character_name', s.r->'snapshot'->>'display_name',
             'character_image_url', s.r->'snapshot'->>'image_url',
             'character_emoji', s.r->'snapshot'->>'emoji',
             'settlement_status', CASE WHEN s.w IS NULL THEN 'VOID' ELSE 'SETTLED' END,
             'winner', CASE WHEN s.w IS NULL THEN NULL ELSE jsonb_build_object(
                 'student_id', (s.w->>'student_id')::integer,
                 'display_name', s.w->>'name',
                 'brand_name', s.w->>'brand_name',
                 'avatar_url', s.w->>'avatar_url',
                 'final_rank', (s.w->>'final_rank')::integer,
                 'contribution_percent', (s.w->>'contribution_percent')::numeric,
                 'is_me', false) END,
             'delivered_kind', CASE
                 WHEN s.w IS NULL THEN NULL
                 WHEN s.r->>'kind' = 'CHARACTER' AND s.dup THEN 'CRYSTAL'
                 ELSE s.r->>'kind' END,
             'delivered_amount', CASE
                 WHEN s.w IS NULL THEN NULL
                 WHEN s.r->>'kind' = 'CHARACTER' AND s.dup THEN (s.r->'snapshot'->>'duplicate_crystal_amount')::bigint
                 WHEN s.r->>'kind' = 'CHARACTER' THEN NULL
                 ELSE (s.r->>'amount')::bigint END,
             'duplicate_character_converted', (s.w IS NOT NULL AND s.r->>'kind' = 'CHARACTER' AND s.dup),
             'original_base_price_crystal', CASE WHEN s.r->>'kind' = 'CHARACTER'
                                                 THEN (s.r->'snapshot'->>'base_price_crystal')::bigint END,
             'conversion_rate_bp', CASE WHEN s.r->>'kind' = 'CHARACTER' THEN 9000 END,
             'void', s.w IS NULL,
             'reward_snapshot', s.r->'snapshot',
             'winner_snapshot', s.w) AS j
    FROM (VALUES (1, v_r1, v_w1, false), (2, v_r2, v_w2, v_owned)) AS s(slot, r, w, dup)
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'student_id', (t.e->>'student_id')::integer, 'name', t.e->>'name', 'avatar_url', t.e->>'avatar_url')
           ORDER BY (t.e->>'display_order')::integer), '[]'::jsonb)
    INTO v_shuffle1
  FROM jsonb_array_elements(v_elig->'eligible') AS t(e);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'student_id', (t.e->>'student_id')::integer, 'name', t.e->>'name', 'avatar_url', t.e->>'avatar_url')
           ORDER BY (t.e->>'display_order')::integer), '[]'::jsonb)
    INTO v_shuffle2
  FROM jsonb_array_elements(v_elig->'eligible') AS t(e)
  WHERE v_n < 2 OR v_w1 IS NULL OR (t.e->>'student_id')::integer <> (v_w1->>'student_id')::integer;

  RETURN jsonb_build_object(
    'mode', 'REHEARSAL',
    'source_raid_id', p_source_raid_id,
    'source_raid_title', v_raid.title,
    'boss_name', v_raid.boss_name,
    'config_source', v_source,
    'eligible_count', v_n,
    'eligible', v_elig->'eligible',
    'unavailable_reason', NULL,
    'shuffle_candidates', jsonb_build_object('slot1', v_shuffle1, 'slot2', v_shuffle2),
    'rewards', v_rewards,
    'generated_at', now());
END;
$function$;

-- ============================================================================
-- [F] 학생 RPC — 공개된 단계까지만 (상품 공개 전 내용·당첨 전 당첨자·내부 가중치 없음)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.student_get_raid_loot_public_state(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me integer;
BEGIN
  v_me := public.raid_current_student_for_raid(p_raid_id);
  RETURN public._raid_loot_public_state(p_raid_id, v_me);
END;
$function$;

-- ============================================================================
-- [G] 기존 teacher_delete_raid_record — 앞부분에 "획득식 기록 보호" 확인만 추가
--     (아래 표시된 V1.2 블록 외에는 운영 DB의 기존 정의와 한 글자도 다르지 않습니다)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.teacher_delete_raid_record(p_raid_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_attack_batches integer := 0;
  v_participants integer := 0;
  v_reward_settlements integer := 0;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid not found' USING ERRCODE='P0202'; END IF;
  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  -- [V1.2 raid loot] 전리품 획득식 기록(지급 증거)이 있으면 삭제하지 않음
  IF EXISTS (SELECT 1 FROM public.raid_loot_ceremonies WHERE raid_id=p_raid_id) THEN
    RAISE EXCEPTION '전리품 획득식 기록이 있는 레이드는 삭제할 수 없습니다. (지급 기록 보존)' USING ERRCODE='P0L60';
  END IF;
  DELETE FROM public.raid_loot_character_pool WHERE raid_id=p_raid_id;
  DELETE FROM public.raid_loot_configs WHERE raid_id=p_raid_id;
  DELETE FROM public.raid_loot_audit_events WHERE raid_id=p_raid_id AND ceremony_id IS NULL;
  -- [/V1.2 raid loot]

  SELECT count(*)::integer INTO v_attack_batches FROM public.raid_attack_batches WHERE raid_id=p_raid_id;
  SELECT count(*)::integer INTO v_participants FROM public.raid_participants WHERE raid_id=p_raid_id;
  SELECT count(*)::integer INTO v_reward_settlements FROM public.raid_reward_settlements WHERE raid_id=p_raid_id;

  DELETE FROM public.raid_attack_batches WHERE raid_id=p_raid_id;
  DELETE FROM public.raid_balance_reports WHERE raid_id=p_raid_id;
  DELETE FROM public.raid_lobby_messages WHERE raid_id=p_raid_id;
  DELETE FROM public.raid_hit_zones WHERE raid_phase_id IN (SELECT id FROM public.raid_phases WHERE raid_id=p_raid_id);
  DELETE FROM public.raid_participants WHERE raid_id=p_raid_id;
  DELETE FROM public.raid_phases WHERE raid_id=p_raid_id;
  DELETE FROM public.raids WHERE id=p_raid_id;

  RETURN jsonb_build_object(
    'deleted', true, 'raid_id', p_raid_id, 'title', v_raid.title, 'previous_status', v_raid.status,
    'attack_batch_count', v_attack_batches, 'participant_snapshot_count', v_participants,
    'reward_settlement_count', v_reward_settlements, 'reward_reversal_applied', false
  );
END;
$function$;

-- ============================================================================
-- [H] 권한
--   내부 함수: 브라우저(anon/authenticated)에서 직접 호출 불가
--   교사·학생 RPC: 로그인 사용자만 호출 가능 (함수 안에서 교사/학생/학급 검사)
-- ============================================================================
REVOKE ALL ON FUNCTION public._raid_loot_norm_range(jsonb, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_char_weight(bigint, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_with_probabilities(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_config_issues(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_eligible_offer(integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_normalize_config(integer, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_stored_config(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_eligible_snapshot(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_pick_winner(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_draw_amount(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_draw_reward(integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_credit_fragments(integer, integer, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_grant_character(integer, bigint, bigint, bigint, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_reveal_round(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_settle_round(bigint, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_round_public_json(public.raid_loot_rounds, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_public_state(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_admin_state(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raid_loot_config_view(bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.teacher_get_raid_loot_config(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_save_raid_loot_config(bigint, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_copy_raid_loot_config(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_prepare_raid_loot(bigint, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_advance_raid_loot(bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_loot_ceremony(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_rehearse_raid_loot(bigint, text, bigint, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_get_raid_loot_public_state(bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_get_raid_loot_config(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_save_raid_loot_config(bigint, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_copy_raid_loot_config(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_prepare_raid_loot(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_advance_raid_loot(bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_loot_ceremony(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_rehearse_raid_loot(bigint, text, bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_raid_loot_public_state(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
