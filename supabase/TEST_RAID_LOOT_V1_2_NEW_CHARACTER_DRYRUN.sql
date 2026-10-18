-- ============================================================================
-- [시험 · 자동 취소] 레이드 전리품 V1.2 — "새 편린 실제 지급" 경로 확인
--
-- APPLY_RAID_LOOT_V1_2_03B_RPC.sql 을 먼저 성공시킨 뒤 실행하세요.
-- SQL Editor에 통째로 붙여 넣고 Run → 마지막에 일부러 오류(LT_RESULT ...)를 내서
-- 이 시험의 모든 변경이 취소됩니다. 빨간 LT_RESULT 문장 전체를 복사해 보내 주세요.
--
-- H1: 3차 레이드 참가자 아무도 갖지 않은 「모르드레드」(ID 48)를 2차 전리품으로 확정
--     → 당첨자에게 새로 지급되는지 (보유 기록 + 획득 이력 RAID_LOOT 1건, 크리스탈 거래 0건)
-- H2: 「제이든」(ID 50)을 참가자 전원이 "회수된 상태(is_owned=false)"로 만든 뒤 확정
--     → 회수 기록이 다시 보유로 되살아나는지
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.lt_set_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.lt_full(p_raid bigint, p_char bigint)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_state jsonb; v_exp text; i int; v_round jsonb; v_winner int; v_sc record;
BEGIN
  UPDATE public.raids SET status = 'LOBBY_OPEN' WHERE id = p_raid;
  PERFORM public.teacher_save_raid_loot_config(p_raid, jsonb_build_object('enabled', true,
    'slot1', jsonb_build_object('mode', 'FIXED_ITEM', 'fixed_kind', 'GOLD', 'fixed_amount', 100),
    'slot2', jsonb_build_object('mode', 'FIXED_ITEM', 'fixed_kind', 'CHARACTER', 'fixed_character_id', p_char)),
    (SELECT config_version FROM public.raid_loot_configs WHERE raid_id = p_raid));
  UPDATE public.raids SET status = 'COMPLETED' WHERE id = p_raid;
  v_state := public.teacher_prepare_raid_loot(p_raid, gen_random_uuid());
  FOR i IN 1..7 LOOP
    v_exp := v_state->>'stage';
    v_state := public.teacher_advance_raid_loot(p_raid, v_exp, gen_random_uuid());
  END LOOP;
  v_round := v_state->'rewards'->1;
  v_winner := (v_round->'winner'->>'student_id')::int;
  SELECT is_owned, acquired_via, revoked_at INTO v_sc
  FROM public.student_characters WHERE student_id = v_winner AND character_id = p_char;
  RETURN jsonb_build_object(
    'final_stage', v_state->>'stage',
    'slot2_label', v_round->>'label',
    'slot2_status', v_round->>'settlement_status',
    'winner', v_round->'winner'->>'display_name',
    'delivered', v_round->>'delivered_kind',
    'dup', v_round->'duplicate_character_converted',
    'acq_id', v_round->'acquisition_event_id',
    'tx_id', v_round->'transaction_id',
    'owned_now', v_sc.is_owned,
    'acquired_via', v_sc.acquired_via,
    'revoked_at_cleared', v_sc.revoked_at IS NULL,
    'acq_rows_for_char', (SELECT count(*) FROM public.character_acquisition_events
                          WHERE character_id = p_char AND event_type = 'RAID_LOOT'),
    'acq_meta', (SELECT metadata FROM public.character_acquisition_events
                 WHERE character_id = p_char AND event_type = 'RAID_LOOT' LIMIT 1),
    'raid_loot_crystal_tx', (SELECT count(*) FROM public.transactions
                             WHERE source_type = 'RAID_LOOT' AND value_token = 'CRYSTAL'));
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
END $f$;

DO $test$
DECLARE
  v_teacher uuid := '4c43edcb-f4eb-48dd-befd-7323fc33d193';
  v_out jsonb := '{}'::jsonb;
  v_r jsonb;
BEGIN
  PERFORM pg_temp.lt_set_user(v_teacher);

  -- H1 ----------------------------------------------------------------------
  BEGIN
    v_r := pg_temp.lt_full(62, 48);
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN v_r := jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM); END IF;
  END;
  v_out := v_out || jsonb_build_object('H1_new_character', v_r);

  -- H2 ----------------------------------------------------------------------
  BEGIN
    INSERT INTO public.student_characters(classroom_id, student_id, character_id, is_owned, acquired_at,
                                          acquired_via, revoked_at, revoke_reason)
    SELECT 1, rp.student_id, 50, false, now() - interval '30 days', 'LT_TEST', now() - interval '1 day', 'LT_TEST'
    FROM public.raid_participants rp WHERE rp.raid_id = 62
    ON CONFLICT (student_id, character_id) DO UPDATE
      SET is_owned = false, revoked_at = now() - interval '1 day', revoke_reason = 'LT_TEST';
    v_r := pg_temp.lt_full(62, 50);
    RAISE EXCEPTION 'LT_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'LT_ROLLBACK' THEN v_r := jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM); END IF;
  END;
  v_out := v_out || jsonb_build_object('H2_revoked_restored', v_r);

  RAISE EXCEPTION 'LT_RESULT %', v_out::text;
END
$test$;

ROLLBACK;
