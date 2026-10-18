-- ============================================================================
-- 레이드 전리품 V1.2 — 운영 DB 시험 실행(드라이런) 스크립트
--
-- 사용법: 02 · 03 마이그레이션 본문(BEGIN/COMMIT/NOTIFY 제외) 바로 뒤에 이 블록을 붙여
--         한 번에 실행합니다. 마지막에 일부러 오류(LT_RESULT)를 내므로
--         테이블·함수·지급·거래 등 모든 변경이 자동으로 취소됩니다.
--         결과는 오류 메시지 안의 JSON으로 확인합니다.
--
-- 시나리오 (3차 레이드 ID 62, 1반 데이터 사용)
--   A: 1차 GOLD 고정 종류 + 2차 완성 편린  → 버튼 8단계 · 중복 요청 · 다른 화면 선행 · 삭제 보호
--   B: 1차 CRYSTAL + 2차 편린 조각          → 원정 공용 조각 장부
--   C: 2차 확정 편린을 모두가 이미 보유      → 기준가 90% 크리스탈 대체
--   D: 적격자 1명                           → 두 전리품 독식
--   E: 적격자 0명                           → 획득식 미생성
--   F: 학생 화면 공개 범위 · 학생 권한 차단 · 시작 후 설정 잠금 · 미저장 설정 리허설
--   G: 리허설 10회 → DB 변화 0건
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.lt_set_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.lt_run(p_raid bigint, p_payload jsonb, p_teacher uuid)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_state jsonb; v_steps jsonb := '[]'::jsonb; v_req uuid; v_first_req uuid;
  v_dup jsonb; v_stale jsonb; v_cfg jsonb; v_reh jsonb; v_exp text; i int;
BEGIN
  PERFORM pg_temp.lt_set_user(p_teacher);
  UPDATE public.raids SET status = 'LOBBY_OPEN' WHERE id = p_raid;
  v_cfg := public.teacher_save_raid_loot_config(p_raid, p_payload, NULL);
  UPDATE public.raids SET status = 'COMPLETED' WHERE id = p_raid;

  v_reh := public.teacher_rehearse_raid_loot(p_raid, 'RAID', NULL, NULL);
  v_state := public.teacher_prepare_raid_loot(p_raid, gen_random_uuid());

  IF coalesce(jsonb_typeof(v_state->'ceremony'), 'null') = 'null' THEN
    RETURN jsonb_build_object(
      'prepare_reason', v_state->'unavailable_reason',
      'prepare_eligible', v_state->'eligible_count',
      'ceremony_rows', (SELECT count(*) FROM public.raid_loot_ceremonies WHERE raid_id = p_raid),
      'rehearsal_reason', v_reh->'unavailable_reason');
  END IF;

  FOR i IN 1..7 LOOP
    v_exp := v_state->>'stage';
    v_req := gen_random_uuid();
    IF i = 1 THEN v_first_req := v_req; END IF;
    v_state := public.teacher_advance_raid_loot(p_raid, v_exp, v_req);
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'from', v_exp, 'to', v_state->>'stage', 'next_label', v_state->'next_action'->>'label'));
  END LOOP;

  v_dup := public.teacher_advance_raid_loot(p_raid, 'READY', v_first_req);
  v_stale := public.teacher_advance_raid_loot(p_raid, 'READY', gen_random_uuid());

  RETURN jsonb_build_object(
    'save_issues', v_cfg->'issues',
    'pool_count', jsonb_array_length(coalesce(v_cfg->'config'->'pool', '[]'::jsonb)),
    'rehearsal', (SELECT jsonb_agg(jsonb_build_object(
        'slot', r->'slot_no', 'label', r->'label', 'winner', r->'winner'->>'display_name',
        'delivered', r->'delivered_kind', 'amount', r->'delivered_amount', 'dup', r->'duplicate_character_converted'))
      FROM jsonb_array_elements(v_reh->'rewards') r),
    'steps', v_steps,
    'final_stage', v_state->>'stage',
    'eligible_count', v_state->'eligible_count',
    'rewards', (SELECT jsonb_agg(jsonb_build_object(
        'slot', r->'slot_no', 'kind', r->'kind', 'label', r->'label', 'status', r->'settlement_status',
        'winner_id', r->'winner'->'student_id', 'winner', r->'winner'->>'display_name',
        'delivered', r->'delivered_kind', 'amount', r->'delivered_amount',
        'dup', r->'duplicate_character_converted', 'tx', r->'transaction_id',
        'ledger', r->'fragment_ledger_id', 'acq', r->'acquisition_event_id',
        'prob', r->'winner_snapshot'->'draw_probability', 'cands', r->'winner_snapshot'->'candidate_count'))
      FROM jsonb_array_elements(v_state->'rewards') r),
    'dup_request_flag', v_dup->'duplicate_request',
    'stale_flag', v_stale->'stale',
    'stale_stage', v_stale->>'stage');
END $f$;

DO $test$
DECLARE
  v_teacher uuid := '4c43edcb-f4eb-48dd-befd-7323fc33d193';
  v_raid bigint := 62;
  v_chars bigint[];
  v_pool jsonb;
  v_out jsonb := '{}'::jsonb;
  v_r jsonb;
  v_tmp jsonb;
  v_price bigint;
  v_student_uid uuid;
  v_counts_before jsonb;
  v_counts_after jsonb;
  i int;
BEGIN
  SELECT array_agg(x.id) INTO v_chars FROM (
    SELECT c.id FROM public.characters c
    JOIN public.character_recruitment_offers o ON o.character_id = c.id AND o.classroom_id = 1
    WHERE c.is_active AND o.is_active AND o.acquisition_mode = 'CRYSTAL' AND o.base_price_crystal >= 1000
    ORDER BY o.base_price_crystal, c.id LIMIT 3) x;
  SELECT jsonb_agg(jsonb_build_object('character_id', x, 'manual_factor', 1, 'is_selected', true))
    INTO v_pool FROM unnest(v_chars) x;
  v_out := v_out || jsonb_build_object('pool_chars', to_jsonb(v_chars));

  -- A ------------------------------------------------------------------------
  BEGIN
    v_r := pg_temp.lt_run(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'GOLD',
                                  'gold', jsonb_build_object('min', 100, 'max', 200, 'step', 10)),
      'slot2', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'CHARACTER'),
      'pool', v_pool), v_teacher);
    v_r := v_r || jsonb_build_object(
      'tx_rows', (SELECT jsonb_agg(jsonb_build_object('src', t.source_type, 'token', t.value_token,
                    'amount', t.amount, 'source_id', t.source_id, 'memo', t.memo))
                  FROM public.transactions t WHERE t.source_type = 'RAID_LOOT'),
      'acq_rows', (SELECT jsonb_agg(jsonb_build_object('type', e.event_type, 'student', e.student_id, 'char', e.character_id))
                   FROM public.character_acquisition_events e WHERE e.event_type = 'RAID_LOOT'),
      'owned_via_raid_loot', (SELECT count(*) FROM public.student_characters WHERE acquired_via = 'RAID_LOOT'));
    BEGIN
      PERFORM public.teacher_delete_raid_record(v_raid);
      v_r := v_r || '{"delete_guard":"NOT_BLOCKED"}'::jsonb;
    EXCEPTION WHEN others THEN
      v_r := v_r || jsonb_build_object('delete_guard', SQLSTATE || ' ' || SQLERRM);
    END;
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('A', v_r); v_r := NULL;

  -- B ------------------------------------------------------------------------
  BEGIN
    v_r := pg_temp.lt_run(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'CRYSTAL',
                                  'crystal', jsonb_build_object('min', 50, 'max', 50, 'step', 1)),
      'slot2', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'FRAGMENTS',
                                  'fragments', jsonb_build_object('min', 5, 'max', 15, 'step', 5)),
      'pool', '[]'::jsonb), v_teacher);
    v_r := v_r || jsonb_build_object(
      'ledger_rows', (SELECT jsonb_agg(jsonb_build_object('event', l.event_type, 'student', l.student_id,
                        'delta', l.delta, 'balance_after', l.balance_after, 'meta', l.metadata))
                      FROM public.expedition_fragment_ledger l WHERE l.event_type = 'RAID_LOOT'));
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('B', v_r); v_r := NULL;

  -- C ------------------------------------------------------------------------
  BEGIN
    SELECT o.base_price_crystal INTO v_price FROM public.character_recruitment_offers o
    WHERE o.classroom_id = 1 AND o.character_id = v_chars[1];
    INSERT INTO public.student_characters(classroom_id, student_id, character_id, is_owned, acquired_at, acquired_via)
    SELECT 1, rp.student_id, v_chars[1], true, now(), 'LT_TEST'
    FROM public.raid_participants rp WHERE rp.raid_id = v_raid
    ON CONFLICT (student_id, character_id) DO UPDATE SET is_owned = true, revoked_at = NULL, revoke_reason = NULL;

    v_r := pg_temp.lt_run(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'AUTO',
                                  'gold', jsonb_build_object('min', 100, 'max', 300, 'step', 50),
                                  'crystal', jsonb_build_object('min', 10, 'max', 30, 'step', 10)),
      'slot2', jsonb_build_object('mode', 'FIXED_ITEM', 'fixed_kind', 'CHARACTER', 'fixed_character_id', v_chars[1]),
      'pool', v_pool), v_teacher);
    v_r := v_r || jsonb_build_object(
      'fixed_char_price', v_price,
      'expected_dup_crystal', (v_price * 90) / 100,
      'acq_rows', (SELECT count(*) FROM public.character_acquisition_events e WHERE e.event_type = 'RAID_LOOT'),
      'dup_tx', (SELECT jsonb_agg(jsonb_build_object('token', t.value_token, 'amount', t.amount, 'memo', t.memo))
                 FROM public.transactions t WHERE t.source_type = 'RAID_LOOT'));
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('C', v_r); v_r := NULL;

  -- D ------------------------------------------------------------------------
  BEGIN
    UPDATE public.raid_participants SET total_damage = 1
    WHERE raid_id = v_raid AND student_id <> (
      SELECT student_id FROM public.raid_participants WHERE raid_id = v_raid ORDER BY total_damage DESC LIMIT 1);
    v_r := pg_temp.lt_run(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'AUTO',
                                  'gold', jsonb_build_object('min', 100, 'max', 300, 'step', 50),
                                  'crystal', jsonb_build_object('min', 10, 'max', 30, 'step', 10)),
      'slot2', jsonb_build_object('mode', 'AUTO', 'fragments', jsonb_build_object('min', 5, 'max', 15, 'step', 5)),
      'pool', v_pool), v_teacher);
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('D', v_r); v_r := NULL;

  -- E ------------------------------------------------------------------------
  BEGIN
    UPDATE public.raid_participants SET total_damage = 0 WHERE raid_id = v_raid;
    v_r := pg_temp.lt_run(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'GOLD',
                                  'gold', jsonb_build_object('min', 100, 'max', 200, 'step', 10)),
      'slot2', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'FRAGMENTS',
                                  'fragments', jsonb_build_object('min', 5, 'max', 15, 'step', 5)),
      'pool', '[]'::jsonb), v_teacher);
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('E', v_r); v_r := NULL;

  -- F ------------------------------------------------------------------------
  BEGIN
    v_r := '{}'::jsonb;
    PERFORM pg_temp.lt_set_user(v_teacher);

    -- 미저장 설정으로 리허설
    v_tmp := public.teacher_rehearse_raid_loot(v_raid, 'DRAFT', NULL, jsonb_build_object(
      'slot1', jsonb_build_object('mode', 'FIXED_ITEM', 'fixed_kind', 'GOLD', 'fixed_amount', 777),
      'slot2', jsonb_build_object('mode', 'FIXED_ITEM', 'fixed_kind', 'CHARACTER', 'fixed_character_id', v_chars[2]),
      'pool', v_pool));
    v_r := v_r || jsonb_build_object('draft_rehearsal', (SELECT jsonb_agg(jsonb_build_object(
      'slot', r->'slot_no', 'label', r->'label', 'winner', r->'winner'->>'display_name')) FROM jsonb_array_elements(v_tmp->'rewards') r));

    -- 끝난 레이드 설정 저장 → 잠금 오류여야 함
    BEGIN
      PERFORM public.teacher_save_raid_loot_config(v_raid, '{}'::jsonb, NULL);
      v_r := v_r || '{"save_after_start":"NOT_BLOCKED"}'::jsonb;
    EXCEPTION WHEN others THEN
      v_r := v_r || jsonb_build_object('save_after_start', SQLSTATE || ' ' || SQLERRM);
    END;

    -- 이벤트 전용 편린 확정 지정 → 거절이어야 함
    BEGIN
      UPDATE public.raids SET status = 'LOBBY_OPEN' WHERE id = v_raid;
      PERFORM public.teacher_save_raid_loot_config(v_raid, jsonb_build_object(
        'slot1', jsonb_build_object('mode', 'AUTO'),
        'slot2', jsonb_build_object('mode', 'FIXED_ITEM', 'fixed_kind', 'CHARACTER',
          'fixed_character_id', (SELECT o.character_id FROM public.character_recruitment_offers o
                                 WHERE o.classroom_id = 1 AND o.acquisition_mode = 'EVENT_ONLY' LIMIT 1))), NULL);
      v_r := v_r || '{"event_only_fixed":"NOT_BLOCKED"}'::jsonb;
    EXCEPTION WHEN others THEN
      v_r := v_r || jsonb_build_object('event_only_fixed', SQLSTATE || ' ' || SQLERRM);
    END;

    -- 정상 저장 → 시작 → 1차 상품 공개까지
    UPDATE public.raids SET status = 'LOBBY_OPEN' WHERE id = v_raid;
    PERFORM public.teacher_save_raid_loot_config(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'GOLD',
                                  'gold', jsonb_build_object('min', 100, 'max', 200, 'step', 10)),
      'slot2', jsonb_build_object('mode', 'FIXED_KIND', 'fixed_kind', 'CHARACTER'),
      'pool', v_pool), NULL);
    UPDATE public.raids SET status = 'COMPLETED' WHERE id = v_raid;
    v_tmp := public.teacher_prepare_raid_loot(v_raid, gen_random_uuid());
    v_tmp := public.teacher_advance_raid_loot(v_raid, 'READY', gen_random_uuid());
    v_r := v_r || jsonb_build_object('teacher_stage', v_tmp->>'stage');

    -- 학생으로 전환
    SELECT s.user_id INTO v_student_uid
    FROM public.raid_participants rp JOIN public.students s ON s.id = rp.student_id
    WHERE rp.raid_id = v_raid AND s.user_id IS NOT NULL LIMIT 1;
    PERFORM pg_temp.lt_set_user(v_student_uid);

    v_tmp := public.student_get_raid_loot_public_state(v_raid);
    v_r := v_r || jsonb_build_object('student_view_slot1_item', v_tmp);

    BEGIN
      PERFORM public.teacher_advance_raid_loot(v_raid, 'SLOT1_ITEM', gen_random_uuid());
      v_r := v_r || '{"student_advance":"NOT_BLOCKED"}'::jsonb;
    EXCEPTION WHEN others THEN
      v_r := v_r || jsonb_build_object('student_advance', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      PERFORM public.teacher_get_raid_loot_ceremony(v_raid);
      v_r := v_r || '{"student_admin_read":"NOT_BLOCKED"}'::jsonb;
    EXCEPTION WHEN others THEN
      v_r := v_r || jsonb_build_object('student_admin_read', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      PERFORM public.teacher_rehearse_raid_loot(v_raid, 'RAID', NULL, NULL);
      v_r := v_r || '{"student_rehearsal":"NOT_BLOCKED"}'::jsonb;
    EXCEPTION WHEN others THEN
      v_r := v_r || jsonb_build_object('student_rehearsal', SQLSTATE || ' ' || SQLERRM);
    END;
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('F', v_r); v_r := NULL;

  -- G ------------------------------------------------------------------------
  BEGIN
    PERFORM pg_temp.lt_set_user(v_teacher);
    UPDATE public.raids SET status = 'LOBBY_OPEN' WHERE id = v_raid;
    PERFORM public.teacher_save_raid_loot_config(v_raid, jsonb_build_object('enabled', true,
      'slot1', jsonb_build_object('mode', 'AUTO',
                                  'gold', jsonb_build_object('min', 100, 'max', 300, 'step', 50),
                                  'crystal', jsonb_build_object('min', 10, 'max', 30, 'step', 10)),
      'slot2', jsonb_build_object('mode', 'AUTO', 'fragments', jsonb_build_object('min', 5, 'max', 15, 'step', 5)),
      'pool', v_pool), NULL);
    UPDATE public.raids SET status = 'COMPLETED' WHERE id = v_raid;

    v_counts_before := jsonb_build_object(
      'tx', (SELECT count(*) FROM public.transactions),
      'wallet_sum', (SELECT sum(gold) + sum(crystal) FROM public.wallets),
      'sc', (SELECT count(*) FROM public.student_characters),
      'acq', (SELECT count(*) FROM public.character_acquisition_events),
      'ledger', (SELECT count(*) FROM public.expedition_fragment_ledger),
      'cer', (SELECT count(*) FROM public.raid_loot_ceremonies),
      'rounds', (SELECT count(*) FROM public.raid_loot_rounds),
      'audit', (SELECT count(*) FROM public.raid_loot_audit_events));
    FOR i IN 1..10 LOOP
      v_tmp := public.teacher_rehearse_raid_loot(v_raid, 'RAID', NULL, NULL);
    END LOOP;
    v_counts_after := jsonb_build_object(
      'tx', (SELECT count(*) FROM public.transactions),
      'wallet_sum', (SELECT sum(gold) + sum(crystal) FROM public.wallets),
      'sc', (SELECT count(*) FROM public.student_characters),
      'acq', (SELECT count(*) FROM public.character_acquisition_events),
      'ledger', (SELECT count(*) FROM public.expedition_fragment_ledger),
      'cer', (SELECT count(*) FROM public.raid_loot_ceremonies),
      'rounds', (SELECT count(*) FROM public.raid_loot_rounds),
      'audit', (SELECT count(*) FROM public.raid_loot_audit_events));
    v_r := jsonb_build_object('unchanged', v_counts_before = v_counts_after,
                              'before', v_counts_before, 'after', v_counts_after,
                              'last_rehearsal_labels', (SELECT jsonb_agg(r->'label') FROM jsonb_array_elements(v_tmp->'rewards') r));
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN
      v_r := coalesce(v_r, '{}'::jsonb) || jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
    END IF;
  END;
  v_out := v_out || jsonb_build_object('G', v_r);

  RAISE EXCEPTION 'LT_RESULT %', v_out::text;
END
$test$;
