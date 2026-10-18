-- ============================================================================
-- [정식 적용] 레이드 전리품 V1.2 — 03 뒷부분 (교사·학생 RPC, 삭제 보호, 권한)
--
-- Supabase SQL Editor에 통째로 붙여 넣고 Run 하세요.
-- 이번에는 "정식 적용"입니다. 성공하면 "Success. No rows returned" 가 나옵니다.
--
-- 이미 적용된 것: 01(enum) · 02(테이블) · 03 앞부분(내부 함수)  ← 2026-10-18 적용 완료
-- 이 파일은 운영 데이터(지갑·거래·편린)를 바꾸지 않습니다. 함수만 만들고 권한을 정합니다.
-- 전리품은 레이드별 설정에서 직접 켜기 전까지 어디에서도 작동하지 않습니다.
-- 중간에 오류가 나면 이 파일의 내용은 하나도 적용되지 않습니다(한 묶음으로 실행).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public._raid_loot_settle_round(bigint,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION '03 앞부분(내부 함수)이 먼저 적용되어 있어야 합니다.';
  END IF;
END $$;

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
