-- ============================================================================
-- B.R.A.N.D 2.0
-- 기본 경제 행동: P2P 송금 · 화폐 교환 · 복지기금 기부 · 교사 거래 취소
-- 생성일: 2026-08-06
--
-- 적용 방법: Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행
--
-- 보안 원칙:
--   * create_transaction은 계속 service_role 전용
--   * 학생 외부 RPC는 본인 확인 + 활성 학급 + 자산동결 검증
--   * 교사 취소 RPC는 교사 권한 + 담당 학급 검증
--   * P2P/교환처럼 한 사건에 거래가 2개인 경우 두 거래를 함께 취소
--   * 모든 작업은 단일 PostgreSQL 트랜잭션으로 처리
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. 사전 조건 검증
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected function not found: public.create_transaction(...)';
  END IF;
  IF to_regprocedure('public.ensure_self_or_teacher(integer)') IS NULL THEN
    RAISE EXCEPTION 'Expected function not found: public.ensure_self_or_teacher(integer)';
  END IF;
  IF to_regprocedure('public.ensure_teacher_role()') IS NULL THEN
    RAISE EXCEPTION 'Expected function not found: public.ensure_teacher_role()';
  END IF;
  IF to_regprocedure('public.current_classroom_id()') IS NULL THEN
    RAISE EXCEPTION 'Expected function not found: public.current_classroom_id()';
  END IF;
  IF to_regprocedure('public._acquire_wallet_locks_ordered(integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Expected function not found: public._acquire_wallet_locks_ordered(integer,integer)';
  END IF;
  IF to_regclass('public.p2p_transfers') IS NULL
     OR to_regclass('public.exchange_logs') IS NULL
     OR to_regclass('public.welfare_funds') IS NULL
     OR to_regclass('public.welfare_fund_movements') IS NULL THEN
    RAISE EXCEPTION 'Required basic-economy tables are missing';
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 1. 자산동결 활성 여부 내부 함수
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_asset_freeze_active(p_classroom_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.emergencies e
     WHERE e.classroom_id = p_classroom_id
       AND e.emergency_type = 'ASSET_FREEZE'::public.emergency_type
       AND e.status = 'ACTIVE'::public.emergency_status
       AND (e.scheduled_end_at IS NULL OR e.scheduled_end_at > now())
  );
$$;

COMMENT ON FUNCTION public.is_asset_freeze_active(integer)
IS '학급에 유효한 자산동결 비상사태가 활성화되어 있는지 확인하는 내부 함수';

REVOKE ALL ON FUNCTION public.is_asset_freeze_active(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_asset_freeze_active(integer) TO service_role;

-- --------------------------------------------------------------------------
-- 2. P2P 송금 RPC 보안·동시성 보강
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_p2p_with_log(
  p_sender_id integer,
  p_receiver_id integer,
  p_amount bigint,
  p_tag character varying DEFAULT NULL::character varying,
  p_description text DEFAULT NULL::text,
  p_quantity integer DEFAULT NULL::integer,
  p_rating integer DEFAULT NULL::integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_sender bigint;
  v_tx_receiver bigint;
  v_p2p_id bigint;
  v_classroom_id integer;
  v_transfer_uid varchar(50);
  v_receiver_name text;
  v_sender_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  PERFORM public.ensure_self_or_teacher(p_sender_id);

  IF p_sender_id = p_receiver_id THEN
    RAISE EXCEPTION '자기 자신에게 송금할 수 없습니다.' USING ERRCODE = 'P0020';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION '송금 금액은 1 이상 1,000,000 이하이어야 합니다.' USING ERRCODE = 'P0021';
  END IF;
  IF p_rating IS NOT NULL AND (p_rating < 1 OR p_rating > 10) THEN
    RAISE EXCEPTION '거래 평점은 1~10 사이여야 합니다.' USING ERRCODE = 'P0025';
  END IF;
  IF p_quantity IS NOT NULL AND p_quantity <= 0 THEN
    RAISE EXCEPTION '수량은 양수여야 합니다.' USING ERRCODE = 'P0026';
  END IF;

  p_tag := NULLIF(btrim(coalesce(p_tag, '')), '');
  p_description := NULLIF(btrim(coalesce(p_description, '')), '');

  IF char_length(coalesce(p_tag, '')) > 50 THEN
    RAISE EXCEPTION '태그는 50자 이하로 입력해주세요.' USING ERRCODE = 'P0027';
  END IF;
  IF char_length(coalesce(p_description, '')) > 200 THEN
    RAISE EXCEPTION '송금 메모는 200자 이하로 입력해주세요.' USING ERRCODE = 'P0028';
  END IF;

  SELECT s.classroom_id, s.name
    INTO v_classroom_id, v_sender_name
    FROM public.students s
   WHERE s.id = p_sender_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '송금자가 활성 학생이 아닙니다.' USING ERRCODE = 'P0022';
  END IF;

  SELECT s.name
    INTO v_receiver_name
    FROM public.students s
   WHERE s.id = p_receiver_id
     AND s.classroom_id = v_classroom_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');

  IF v_receiver_name IS NULL THEN
    RAISE EXCEPTION '수령자가 같은 학급의 활성 학생이 아닙니다.' USING ERRCODE = 'P0023';
  END IF;

  IF public.is_asset_freeze_active(v_classroom_id) THEN
    RAISE EXCEPTION '자산동결 중에는 학생 간 송금을 할 수 없습니다.' USING ERRCODE = 'P0611';
  END IF;

  PERFORM public._acquire_wallet_locks_ordered(p_sender_id, p_receiver_id);

  v_transfer_uid := 'TXN_' || extract(epoch FROM clock_timestamp())::bigint::text
                    || '_' || substring(md5(random()::text) FROM 1 FOR 6);

  v_tx_sender := public.create_transaction(
    p_sender_id, 'GOLD', -p_amount, 'P2P_SEND', NULL, 0,
    format('[P2P 송금] → %s%s', v_receiver_name,
      CASE WHEN p_description IS NULL THEN '' ELSE ' · ' || p_description END)
  );

  v_tx_receiver := public.create_transaction(
    p_receiver_id, 'GOLD', p_amount, 'P2P_RECEIVE', NULL, 0,
    format('[P2P 수령] ← %s%s', v_sender_name,
      CASE WHEN p_description IS NULL THEN '' ELSE ' · ' || p_description END)
  );

  INSERT INTO public.p2p_transfers (
    transfer_uid, classroom_id, sender_id, receiver_id,
    amount, tag, description, quantity, rating,
    transaction_id_sender, transaction_id_receiver
  ) VALUES (
    v_transfer_uid, v_classroom_id, p_sender_id, p_receiver_id,
    p_amount, p_tag, p_description, p_quantity, p_rating,
    v_tx_sender, v_tx_receiver
  ) RETURNING id INTO v_p2p_id;

  UPDATE public.transactions
     SET source_id = v_p2p_id
   WHERE id IN (v_tx_sender, v_tx_receiver);

  RETURN v_p2p_id;
END;
$$;

COMMENT ON FUNCTION public.transfer_p2p_with_log(integer, integer, bigint, character varying, text, integer, integer)
IS '학생 간 GOLD 송금. 본인·같은 학급·자산동결 검증과 순서 잠금 후 양쪽 거래를 원자적으로 기록한다.';

REVOKE ALL ON FUNCTION public.transfer_p2p_with_log(integer, integer, bigint, character varying, text, integer, integer)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_p2p_with_log(integer, integer, bigint, character varying, text, integer, integer)
TO authenticated, service_role;

-- 구형 무검증 함수는 브라우저에서 사용하지 못하게 잠근다.
REVOKE ALL ON FUNCTION public.transfer_p2p(integer, integer, bigint, character varying, text, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_p2p(integer, integer, bigint, character varying, text, integer)
TO service_role;

-- --------------------------------------------------------------------------
-- 3. 화폐 교환 RPC 보안 보강
-- 기존 규칙 유지: 설정된 비율 N개를 사용하면 반대 화폐 1개를 받는다.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exchange_token(
  p_student_id integer,
  p_from_token public.value_token_type,
  p_from_amount bigint
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_to_token public.value_token_type;
  v_to_amount bigint;
  v_exchange_ratio integer := 2;
  v_tx_pay bigint;
  v_tx_receive bigint;
  v_exchange_id integer;
  v_classroom_id integer;
  v_setting jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  PERFORM public.ensure_self_or_teacher(p_student_id);

  IF p_from_token IS NULL OR p_from_token NOT IN ('GOLD'::public.value_token_type, 'CRYSTAL'::public.value_token_type) THEN
    RAISE EXCEPTION 'BV는 교환할 수 없습니다.' USING ERRCODE = 'P0010';
  END IF;
  IF p_from_amount IS NULL OR p_from_amount <= 0 OR p_from_amount > 1000000 THEN
    RAISE EXCEPTION '교환 금액은 1 이상 1,000,000 이하이어야 합니다.' USING ERRCODE = 'P0011';
  END IF;

  SELECT s.classroom_id
    INTO v_classroom_id
    FROM public.students s
   WHERE s.id = p_student_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '활성 학생 정보를 찾을 수 없습니다.' USING ERRCODE = 'P0022';
  END IF;

  IF public.is_asset_freeze_active(v_classroom_id) THEN
    RAISE EXCEPTION '자산동결 중에는 화폐를 교환할 수 없습니다.' USING ERRCODE = 'P0611';
  END IF;

  SELECT cs.setting_value
    INTO v_setting
    FROM public.classroom_settings cs
   WHERE cs.classroom_id = v_classroom_id
     AND cs.setting_key = 'currency_exchange_ratio';

  IF v_setting IS NOT NULL THEN
    BEGIN
      v_exchange_ratio := trim(both '"' FROM v_setting::text)::integer;
    EXCEPTION WHEN OTHERS THEN
      v_exchange_ratio := 2;
    END;
  END IF;

  IF v_exchange_ratio < 1 THEN
    v_exchange_ratio := 2;
  END IF;

  IF p_from_amount % v_exchange_ratio <> 0 THEN
    RAISE EXCEPTION '교환 금액은 %의 배수여야 합니다.', v_exchange_ratio USING ERRCODE = 'P0012';
  END IF;

  v_to_token := CASE p_from_token
    WHEN 'GOLD'::public.value_token_type THEN 'CRYSTAL'::public.value_token_type
    ELSE 'GOLD'::public.value_token_type
  END;
  v_to_amount := p_from_amount / v_exchange_ratio;

  v_tx_pay := public.create_transaction(
    p_student_id, p_from_token, -p_from_amount, 'EXCHANGE_PAY', NULL, 0,
    format('[화폐 교환] %s %s 사용 → %s %s 수령', p_from_amount, p_from_token, v_to_amount, v_to_token)
  );
  v_tx_receive := public.create_transaction(
    p_student_id, v_to_token, v_to_amount, 'EXCHANGE_RECEIVE', NULL, 0,
    format('[화폐 교환] %s %s 사용 → %s %s 수령', p_from_amount, p_from_token, v_to_amount, v_to_token)
  );

  INSERT INTO public.exchange_logs (
    student_id, from_token, to_token,
    from_amount, to_amount, exchange_ratio,
    transaction_id_pay, transaction_id_receive
  ) VALUES (
    p_student_id, p_from_token, v_to_token,
    p_from_amount, v_to_amount, v_exchange_ratio,
    v_tx_pay, v_tx_receive
  ) RETURNING id INTO v_exchange_id;

  UPDATE public.transactions
     SET source_id = v_exchange_id
   WHERE id IN (v_tx_pay, v_tx_receive);

  RETURN v_exchange_id;
END;
$$;

COMMENT ON FUNCTION public.exchange_token(integer, public.value_token_type, bigint)
IS '학생 본인의 GOLD/CRYSTAL 교환. 학급 교환비율과 자산동결을 서버에서 검증한다.';

REVOKE ALL ON FUNCTION public.exchange_token(integer, public.value_token_type, bigint)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_token(integer, public.value_token_type, bigint)
TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 4. 복지기금 기부 RPC
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.donate_to_welfare_fund(
  p_student_id integer,
  p_amount bigint,
  p_message text DEFAULT NULL::text
)
RETURNS TABLE(
  transaction_id bigint,
  movement_id bigint,
  new_gold_balance bigint,
  welfare_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_fund_id integer;
  v_tx_id bigint;
  v_movement_id bigint;
  v_new_gold bigint;
  v_fund_balance bigint;
  v_message text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  PERFORM public.ensure_self_or_teacher(p_student_id);

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION '기부 금액은 1 이상 1,000,000 이하이어야 합니다.' USING ERRCODE = 'P0612';
  END IF;

  v_message := NULLIF(btrim(coalesce(p_message, '')), '');
  IF char_length(coalesce(v_message, '')) > 200 THEN
    RAISE EXCEPTION '기부 메시지는 200자 이하로 입력해주세요.' USING ERRCODE = 'P0612';
  END IF;

  SELECT s.classroom_id
    INTO v_classroom_id
    FROM public.students s
   WHERE s.id = p_student_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '활성 학생 정보를 찾을 수 없습니다.' USING ERRCODE = 'P0022';
  END IF;

  IF public.is_asset_freeze_active(v_classroom_id) THEN
    RAISE EXCEPTION '자산동결 중에는 기부할 수 없습니다.' USING ERRCODE = 'P0611';
  END IF;

  INSERT INTO public.welfare_funds (classroom_id)
  VALUES (v_classroom_id)
  ON CONFLICT (classroom_id) DO NOTHING;

  SELECT wf.id
    INTO v_fund_id
    FROM public.welfare_funds wf
   WHERE wf.classroom_id = v_classroom_id
   FOR UPDATE;

  v_tx_id := public.create_transaction(
    p_student_id, 'GOLD', -p_amount, 'DONATION', NULL, 0,
    format('[복지기금 기부] %s골드%s', p_amount,
      CASE WHEN v_message IS NULL THEN '' ELSE ' · ' || v_message END)
  );

  INSERT INTO public.welfare_fund_movements (
    fund_id, movement_type, amount, source_type, transaction_id, note
  ) VALUES (
    v_fund_id, 'COLLECT', p_amount, 'DONATION', v_tx_id,
    CASE WHEN v_message IS NULL THEN '학생 복지기금 기부' ELSE v_message END
  ) RETURNING id INTO v_movement_id;

  UPDATE public.welfare_funds
     SET total_collected = total_collected + p_amount,
         current_balance = current_balance + p_amount,
         updated_at = now()
   WHERE id = v_fund_id
   RETURNING current_balance INTO v_fund_balance;

  UPDATE public.transactions
     SET source_id = v_movement_id
   WHERE id = v_tx_id;

  SELECT w.gold INTO v_new_gold
    FROM public.wallets w
   WHERE w.student_id = p_student_id;

  transaction_id := v_tx_id;
  movement_id := v_movement_id;
  new_gold_balance := v_new_gold;
  welfare_balance := v_fund_balance;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.donate_to_welfare_fund(integer, bigint, text)
IS '학생 본인의 GOLD를 복지기금에 기부하고 거래 원장·기금 원장을 하나의 트랜잭션으로 기록한다.';

REVOKE ALL ON FUNCTION public.donate_to_welfare_fund(integer, bigint, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.donate_to_welfare_fund(integer, bigint, text)
TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5. 복지기금 원장에 기부 취소 환급 유형 추가
-- --------------------------------------------------------------------------
ALTER TABLE public.welfare_fund_movements
  DROP CONSTRAINT IF EXISTS welfare_fund_movements_movement_type_check;

ALTER TABLE public.welfare_fund_movements
  ADD CONSTRAINT welfare_fund_movements_movement_type_check
  CHECK (movement_type IN ('COLLECT', 'DISTRIBUTE', 'REFUND'));

-- --------------------------------------------------------------------------
-- 6. 내부 거래 취소 함수 하드닝
-- 외부 브라우저는 직접 호출하지 못하고, 상위 교사 RPC만 호출한다.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_transaction(
  p_original_tx_id bigint,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original public.transactions%ROWTYPE;
  v_reversal_tx_id bigint;
  v_reason text;
BEGIN
  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION '취소 사유는 2자 이상 200자 이하로 입력해주세요.' USING ERRCODE = 'P0624';
  END IF;

  SELECT * INTO v_original
    FROM public.transactions
   WHERE id = p_original_tx_id
   FOR UPDATE;

  IF v_original.id IS NULL THEN
    RAISE EXCEPTION '원본 거래를 찾을 수 없습니다.' USING ERRCODE = 'P0030';
  END IF;
  IF v_original.is_reversed THEN
    RAISE EXCEPTION '이미 취소된 거래입니다.' USING ERRCODE = 'P0031';
  END IF;
  IF v_original.source_type = 'REVERSAL'::public.transaction_source_type THEN
    RAISE EXCEPTION '취소 거래 자체는 다시 취소할 수 없습니다.' USING ERRCODE = 'P0623';
  END IF;

  v_reversal_tx_id := public.create_transaction(
    v_original.student_id,
    v_original.value_token,
    -v_original.amount,
    'REVERSAL',
    p_original_tx_id,
    0,
    format('[거래 취소] %s · 사유: %s',
      coalesce(v_original.memo, '거래 #' || v_original.id::text), v_reason)
  );

  UPDATE public.transactions
     SET is_reversed = true,
         reversed_by_transaction_id = v_reversal_tx_id,
         reversed_at = now(),
         reversal_reason = v_reason
   WHERE id = p_original_tx_id;

  RETURN v_reversal_tx_id;
END;
$$;

COMMENT ON FUNCTION public.reverse_transaction(bigint, text)
IS '내부 거래 취소 함수. 반대 부호 거래를 만들고 원본에 취소 추적 정보를 기록한다.';

REVOKE ALL ON FUNCTION public.reverse_transaction(bigint, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_transaction(bigint, text)
TO service_role;

-- --------------------------------------------------------------------------
-- 7. 교사 전용 경제 사건 취소 RPC
-- 지원: 교사 지급/차감, P2P 송금, 화폐 교환, 복지기금 기부
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_reverse_economic_event(
  p_transaction_id bigint,
  p_reason text
)
RETURNS TABLE(
  event_type text,
  original_transaction_ids bigint[],
  reversal_transaction_ids bigint[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_classroom_id integer;
  v_tx public.transactions%ROWTYPE;
  v_reason text;
  v_event_type text;
  v_original_ids bigint[];
  v_reversal_ids bigint[];
  v_p2p public.p2p_transfers%ROWTYPE;
  v_exchange public.exchange_logs%ROWTYPE;
  v_movement public.welfare_fund_movements%ROWTYPE;
  v_fund public.welfare_funds%ROWTYPE;
  v_rev_1 bigint;
  v_rev_2 bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  PERFORM public.ensure_teacher_role();

  v_reason := btrim(coalesce(p_reason, ''));
  IF char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RAISE EXCEPTION '취소 사유는 2자 이상 200자 이하로 입력해주세요.' USING ERRCODE = 'P0624';
  END IF;

  v_teacher_classroom_id := public.current_classroom_id();
  IF v_teacher_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'P0607';
  END IF;

  SELECT * INTO v_tx
    FROM public.transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION '거래를 찾을 수 없습니다.' USING ERRCODE = 'P0620';
  END IF;
  IF v_tx.classroom_id <> v_teacher_classroom_id THEN
    RAISE EXCEPTION '담당 학급의 거래만 취소할 수 있습니다.' USING ERRCODE = 'P0621';
  END IF;
  IF v_tx.is_reversed THEN
    RAISE EXCEPTION '이미 취소된 거래입니다.' USING ERRCODE = 'P0622';
  END IF;

  -- P2P는 양쪽 거래를 함께 취소한다.
  IF v_tx.source_type IN ('P2P_SEND'::public.transaction_source_type, 'P2P_RECEIVE'::public.transaction_source_type) THEN
    SELECT * INTO v_p2p
      FROM public.p2p_transfers p
     WHERE p.id = v_tx.source_id
        OR p.transaction_id_sender = v_tx.id
        OR p.transaction_id_receiver = v_tx.id
     ORDER BY p.id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_p2p.id IS NULL THEN
      RAISE EXCEPTION '연결된 P2P 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0625';
    END IF;
    IF v_p2p.classroom_id <> v_teacher_classroom_id THEN
      RAISE EXCEPTION '담당 학급의 P2P 거래만 취소할 수 있습니다.' USING ERRCODE = 'P0621';
    END IF;

    PERFORM public._acquire_wallet_locks_ordered(v_p2p.sender_id, v_p2p.receiver_id);

    -- 수령자가 받은 GOLD를 먼저 회수한다. 이미 사용해 잔액이 부족하면 전체 롤백된다.
    v_rev_1 := public.reverse_transaction(v_p2p.transaction_id_receiver, v_reason);
    v_rev_2 := public.reverse_transaction(v_p2p.transaction_id_sender, v_reason);

    v_event_type := 'P2P_TRANSFER';
    v_original_ids := ARRAY[v_p2p.transaction_id_sender, v_p2p.transaction_id_receiver];
    v_reversal_ids := ARRAY[v_rev_2, v_rev_1];

  -- 화폐 교환은 받은 화폐 회수 후 사용 화폐를 환급한다.
  ELSIF v_tx.source_type IN ('EXCHANGE_PAY'::public.transaction_source_type, 'EXCHANGE_RECEIVE'::public.transaction_source_type) THEN
    SELECT * INTO v_exchange
      FROM public.exchange_logs e
     WHERE e.id = v_tx.source_id
        OR e.transaction_id_pay = v_tx.id
        OR e.transaction_id_receive = v_tx.id
     ORDER BY e.id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_exchange.id IS NULL THEN
      RAISE EXCEPTION '연결된 화폐 교환 기록을 찾을 수 없습니다.' USING ERRCODE = 'P0625';
    END IF;

    PERFORM 1 FROM public.wallets w WHERE w.student_id = v_exchange.student_id FOR UPDATE;

    v_rev_1 := public.reverse_transaction(v_exchange.transaction_id_receive, v_reason);
    v_rev_2 := public.reverse_transaction(v_exchange.transaction_id_pay, v_reason);

    v_event_type := 'TOKEN_EXCHANGE';
    v_original_ids := ARRAY[v_exchange.transaction_id_pay, v_exchange.transaction_id_receive];
    v_reversal_ids := ARRAY[v_rev_2, v_rev_1];

  -- 기부는 학생 GOLD 환급과 복지기금 원장을 함께 되돌린다.
  ELSIF v_tx.source_type = 'DONATION'::public.transaction_source_type THEN
    SELECT * INTO v_movement
      FROM public.welfare_fund_movements m
     WHERE m.transaction_id = v_tx.id
       AND m.movement_type = 'COLLECT'
     ORDER BY m.id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_movement.id IS NULL THEN
      RAISE EXCEPTION '연결된 복지기금 원장을 찾을 수 없습니다.' USING ERRCODE = 'P0625';
    END IF;

    SELECT * INTO v_fund
      FROM public.welfare_funds f
     WHERE f.id = v_movement.fund_id
     FOR UPDATE;

    IF v_fund.current_balance < v_movement.amount THEN
      RAISE EXCEPTION '기부금이 이미 분배되어 현재 복지기금 잔액으로는 취소할 수 없습니다.' USING ERRCODE = 'P0613';
    END IF;

    v_rev_1 := public.reverse_transaction(v_tx.id, v_reason);

    INSERT INTO public.welfare_fund_movements (
      fund_id, movement_type, amount, source_type, source_id, transaction_id, note
    ) VALUES (
      v_fund.id, 'REFUND', v_movement.amount, 'REVERSAL', v_movement.id, v_rev_1,
      '기부 취소 환급 · ' || v_reason
    );

    UPDATE public.welfare_funds
       SET total_collected = greatest(0, total_collected - v_movement.amount),
           current_balance = current_balance - v_movement.amount,
           updated_at = now()
     WHERE id = v_fund.id;

    v_event_type := 'DONATION';
    v_original_ids := ARRAY[v_tx.id];
    v_reversal_ids := ARRAY[v_rev_1];

  -- 교사가 직접 만든 단일 자산 조정 거래
  ELSIF v_tx.source_type IN (
    'TEACHER_GRANT'::public.transaction_source_type,
    'TEACHER_DEDUCT'::public.transaction_source_type,
    'BV_REVOKE'::public.transaction_source_type,
    'CORRECTION'::public.transaction_source_type
  ) THEN
    v_rev_1 := public.reverse_transaction(v_tx.id, v_reason);
    v_event_type := 'TEACHER_ADJUSTMENT';
    v_original_ids := ARRAY[v_tx.id];
    v_reversal_ids := ARRAY[v_rev_1];

  ELSE
    RAISE EXCEPTION '이 거래 유형은 전용 취소 기능이 필요해 현재 이 화면에서 취소할 수 없습니다.'
      USING ERRCODE = 'P0623';
  END IF;

  event_type := v_event_type;
  original_transaction_ids := v_original_ids;
  reversal_transaction_ids := v_reversal_ids;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.teacher_reverse_economic_event(bigint, text)
IS '교사 전용 경제 사건 취소. 단일 조정, P2P 양쪽 거래, 화폐 교환 양쪽 거래, 기부와 복지기금 원장을 원자적으로 되돌린다.';

REVOKE ALL ON FUNCTION public.teacher_reverse_economic_event(bigint, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_reverse_economic_event(bigint, text)
TO authenticated, service_role;

-- 내부 복지 적립 함수는 브라우저 직접 호출 차단
ALTER FUNCTION public.collect_to_welfare_fund(integer, bigint, public.transaction_source_type, bigint)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.collect_to_welfare_fund(integer, bigint, public.transaction_source_type, bigint)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_to_welfare_fund(integer, bigint, public.transaction_source_type, bigint)
TO service_role;

-- create_transaction P0 상태 재확인
REVOKE ALL ON FUNCTION public.create_transaction(
  integer, public.value_token_type, bigint, public.transaction_source_type, bigint, bigint, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_transaction(
  integer, public.value_token_type, bigint, public.transaction_source_type, bigint, bigint, text
) TO service_role;

-- --------------------------------------------------------------------------
-- 8. Realtime publication 보강
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['wallets', 'transactions', 'p2p_transfers', 'exchange_logs', 'welfare_funds']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END
$$;

COMMIT;

-- ============================================================================
-- 적용 후 읽기 전용 검증
-- ============================================================================

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'transfer_p2p_with_log', 'exchange_token', 'donate_to_welfare_fund',
    'reverse_transaction', 'teacher_reverse_economic_event', 'is_asset_freeze_active'
  )
ORDER BY p.proname;

SELECT
  r.rolname AS role_name,
  p.proname AS function_name,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_transaction', 'reverse_transaction', 'transfer_p2p_with_log',
    'exchange_token', 'donate_to_welfare_fund', 'teacher_reverse_economic_event'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY p.proname, r.rolname;

-- 기대 권한:
-- create_transaction / reverse_transaction:
--   anon=false, authenticated=false, service_role=true
-- transfer_p2p_with_log / exchange_token / donate_to_welfare_fund / teacher_reverse_economic_event:
--   anon=false, authenticated=true, service_role=true
