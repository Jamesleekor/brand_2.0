-- ============================================================================
-- B.R.A.N.D 2.0
-- Feature 3: 실시간 온라인 경매
-- 생성일: 2026-08-07
--
-- 핵심 규칙
--   * 서버 시간이 경매 타이머의 유일한 기준이다.
--   * 새 최고 입찰이 들어오면 마지막 입찰자에게 최소 extension_seconds를 보장한다.
--     기존 남은 시간이 더 길면 시간을 줄이지 않는다.
--   * 즉시 입찰가는 서버가 CEIL(현재가 * 1.1)로 계산한다.
--   * 입찰·최종 낙찰·유찰은 행 잠금 + advisory lock으로 직렬화한다.
--   * 학생은 테이블에 직접 쓰지 않고 검증된 외부 RPC만 호출한다.
--   * create_transaction은 계속 service_role/내부 전용이다.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. 사전 조건
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.auctions') IS NULL
     OR to_regclass('public.auction_items') IS NULL
     OR to_regclass('public.auction_bids') IS NULL
     OR to_regclass('public.auction_results') IS NULL
     OR to_regclass('public.auction_failures') IS NULL THEN
    RAISE EXCEPTION 'Required auction tables are missing';
  END IF;

  IF to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected function not found: create_transaction(...)';
  END IF;
  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL THEN
    RAISE EXCEPTION 'Required identity helper function is missing';
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 1. 실시간 상태 컬럼
-- --------------------------------------------------------------------------
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS initial_duration_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS extension_seconds integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS current_item_id integer,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_remaining_seconds integer,
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 0;

ALTER TABLE public.auction_items
  ADD COLUMN IF NOT EXISTS emoji varchar(16) NOT NULL DEFAULT '🎁',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS current_price integer,
  ADD COLUMN IF NOT EXISTS current_bid_id bigint,
  ADD COLUMN IF NOT EXISTS bidding_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS bidding_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_bid_at timestamptz;

ALTER TABLE public.auction_bids
  ADD COLUMN IF NOT EXISTS is_winning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invalid_reason text;

UPDATE public.auction_items
   SET current_price = starting_price
 WHERE current_price IS NULL;

ALTER TABLE public.auction_items
  ALTER COLUMN current_price SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auctions_initial_duration_check'
  ) THEN
    ALTER TABLE public.auctions
      ADD CONSTRAINT auctions_initial_duration_check
      CHECK (initial_duration_seconds BETWEEN 10 AND 300);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auctions_extension_seconds_check'
  ) THEN
    ALTER TABLE public.auctions
      ADD CONSTRAINT auctions_extension_seconds_check
      CHECK (extension_seconds BETWEEN 5 AND 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auctions_pause_remaining_check'
  ) THEN
    ALTER TABLE public.auctions
      ADD CONSTRAINT auctions_pause_remaining_check
      CHECK (pause_remaining_seconds IS NULL OR pause_remaining_seconds >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auction_items_current_price_check'
  ) THEN
    ALTER TABLE public.auction_items
      ADD CONSTRAINT auction_items_current_price_check CHECK (current_price > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auctions_current_item_id_fkey'
  ) THEN
    ALTER TABLE public.auctions
      ADD CONSTRAINT auctions_current_item_id_fkey
      FOREIGN KEY (current_item_id) REFERENCES public.auction_items(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auction_items_current_bid_id_fkey'
  ) THEN
    ALTER TABLE public.auction_items
      ADD CONSTRAINT auction_items_current_bid_id_fkey
      FOREIGN KEY (current_bid_id) REFERENCES public.auction_bids(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_auction_bids_winning
  ON public.auction_bids(auction_item_id, is_winning)
  WHERE is_winning = true AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auction_items_timer
  ON public.auction_items(bidding_ends_at)
  WHERE final_status IS NULL AND bidding_ends_at IS NOT NULL;

-- --------------------------------------------------------------------------
-- 1-1. 최고 입찰 GOLD 예약을 create_transaction에서 중앙 보호
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_transaction(
  p_student_id integer,
  p_value_token public.value_token_type,
  p_amount bigint,
  p_source_type public.transaction_source_type,
  p_source_id bigint DEFAULT NULL,
  p_tax_amount bigint DEFAULT 0,
  p_memo text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student_active boolean;
  v_current_balance bigint;
  v_new_balance bigint;
  v_reserved_gold bigint := 0;
  v_tx_id bigint;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION '거래 금액은 0일 수 없습니다.' USING ERRCODE = 'P0000';
  END IF;
  IF abs(p_amount) > 10000000 THEN
    RAISE EXCEPTION '거래 금액이 허용 범위를 초과합니다: %', p_amount USING ERRCODE = 'P0005';
  END IF;
  IF p_tax_amount < 0 THEN
    RAISE EXCEPTION '세금은 음수일 수 없습니다.' USING ERRCODE = 'P0006';
  END IF;
  IF length(p_memo) > 500 THEN
    p_memo := left(p_memo, 497) || '...';
  END IF;

  SELECT classroom_id, (transferred_at IS NULL)
    INTO v_classroom_id, v_student_active
    FROM public.students
   WHERE id = p_student_id;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '학생을 찾을 수 없습니다: %', p_student_id USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_student_active THEN
    RAISE EXCEPTION '전출된 학생은 거래할 수 없습니다: %', p_student_id USING ERRCODE = 'P0002';
  END IF;

  EXECUTE format(
    'SELECT %I FROM public.wallets WHERE student_id = $1 FOR UPDATE',
    lower(p_value_token::text)
  ) INTO v_current_balance USING p_student_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '지갑을 찾을 수 없습니다: student=%', p_student_id USING ERRCODE = 'P0003';
  END IF;

  v_new_balance := v_current_balance + p_amount;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION '잔액이 부족합니다. 현재: %, 시도: %',
      v_current_balance, p_amount USING ERRCODE = 'P0004';
  END IF;

  -- 현재 최고 입찰자는 해당 입찰액만큼 GOLD가 예약된다.
  -- 낙찰 결제 자체(AUCTION_PAYMENT)는 예약액을 실제로 차감하므로 예외다.
  IF p_value_token = 'GOLD'::public.value_token_type
     AND p_amount < 0
     AND p_source_type <> 'AUCTION_PAYMENT'::public.transaction_source_type THEN
    SELECT coalesce(max(b.bid_amount), 0)::bigint
      INTO v_reserved_gold
      FROM public.auction_bids b
      JOIN public.auction_items i ON i.id = b.auction_item_id
      JOIN public.auctions a ON a.id = i.auction_id
     WHERE b.student_id = p_student_id
       AND b.is_winning = true
       AND b.invalidated_at IS NULL
       AND i.final_status IS NULL
       AND a.status = 'IN_PROGRESS'
       AND a.current_item_id = i.id;

    IF v_new_balance < v_reserved_gold THEN
      RAISE EXCEPTION '현재 최고 입찰액 % GOLD가 예약되어 있습니다. 사용 가능한 GOLD가 부족합니다.',
        v_reserved_gold USING ERRCODE = 'P0733';
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE public.wallets SET %I = $1, updated_at = now() WHERE student_id = $2',
    lower(p_value_token::text)
  ) USING v_new_balance, p_student_id;

  INSERT INTO public.transactions(
    classroom_id, student_id, value_token, amount, balance_after,
    source_type, source_id, tax_amount, memo
  ) VALUES (
    v_classroom_id, p_student_id, p_value_token, p_amount, v_new_balance,
    p_source_type, p_source_id, p_tax_amount, p_memo
  ) RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$$;

COMMENT ON FUNCTION public.create_transaction(integer, public.value_token_type, bigint, public.transaction_source_type, bigint, bigint, text)
IS '모든 자산 변경의 Aggregate Root. 최고 경매 입찰액 GOLD 예약을 중앙 보호하며 브라우저 직접 호출은 차단한다.';

REVOKE ALL ON FUNCTION public.create_transaction(integer, public.value_token_type, bigint, public.transaction_source_type, bigint, bigint, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_transaction(integer, public.value_token_type, bigint, public.transaction_source_type, bigint, bigint, text)
TO service_role;

-- --------------------------------------------------------------------------
-- 2. 이벤트 원장
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_event_logs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  auction_id integer NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  auction_item_id integer REFERENCES public.auction_items(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_event_logs_auction
  ON public.auction_event_logs(auction_id, created_at DESC);

ALTER TABLE public.auction_event_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'auction_event_logs'
       AND policyname = 'auction_event_logs_select_classroom'
  ) THEN
    CREATE POLICY auction_event_logs_select_classroom
      ON public.auction_event_logs FOR SELECT
      USING (public.is_classroom_member(classroom_id));
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 3. 내부 헬퍼
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._auction_log_event(
  p_classroom_id integer,
  p_auction_id integer,
  p_item_id integer,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.auction_event_logs(
    classroom_id, auction_id, auction_item_id,
    event_type, actor_user_id, payload
  ) VALUES (
    p_classroom_id, p_auction_id, p_item_id,
    p_event_type, auth.uid(), coalesce(p_payload, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._auction_log_event(integer, integer, integer, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auction_log_event(integer, integer, integer, text, jsonb)
TO service_role;

CREATE OR REPLACE FUNCTION public._auction_assert_teacher_for_auction(p_auction_id integer)
RETURNS public.auctions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();

  SELECT * INTO v_auction
    FROM public.auctions
   WHERE id = p_auction_id;

  IF v_auction.id IS NULL THEN
    RAISE EXCEPTION '경매 회차를 찾을 수 없습니다.' USING ERRCODE = 'P0701';
  END IF;

  IF v_auction.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 경매만 관리할 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;

  RETURN v_auction;
END;
$$;

REVOKE ALL ON FUNCTION public._auction_assert_teacher_for_auction(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auction_assert_teacher_for_auction(integer)
TO service_role;

CREATE OR REPLACE FUNCTION public._auction_failure_discount(p_classroom_id integer)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_setting jsonb;
  v_rate numeric;
BEGIN
  SELECT setting_value INTO v_setting
    FROM public.classroom_settings
   WHERE classroom_id = p_classroom_id
     AND setting_key = 'auction_failed_discount';

  BEGIN
    v_rate := trim(both '"' FROM coalesce(v_setting::text, '0.10'))::numeric;
  EXCEPTION WHEN others THEN
    v_rate := 0.10;
  END;

  RETURN greatest(0, least(v_rate, 0.90));
END;
$$;

REVOKE ALL ON FUNCTION public._auction_failure_discount(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auction_failure_discount(integer)
TO service_role;

CREATE OR REPLACE FUNCTION public._auction_fail_current_attempt(
  p_item_id integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_failure_type public.auction_failure_type;
  v_discount numeric;
  v_next_price integer;
  v_failure_id integer;
BEGIN
  SELECT * INTO v_item
    FROM public.auction_items
   WHERE id = p_item_id
   FOR UPDATE;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '경매 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703';
  END IF;

  SELECT * INTO v_auction
    FROM public.auctions
   WHERE id = v_item.auction_id
   FOR UPDATE;

  IF v_item.final_status IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ALREADY_FINAL');
  END IF;

  v_failure_type := CASE v_item.current_attempt
    WHEN 1 THEN 'FIRST_FAIL'::public.auction_failure_type
    WHEN 2 THEN 'SECOND_FAIL'::public.auction_failure_type
    ELSE 'FINAL_FAIL'::public.auction_failure_type
  END;

  IF v_item.current_attempt >= 3 THEN
    INSERT INTO public.auction_failures(
      auction_item_id, attempt_number, failure_type,
      price_before, price_after, note
    ) VALUES (
      v_item.id, v_item.current_attempt, v_failure_type,
      v_item.current_price, NULL, p_note
    ) RETURNING id INTO v_failure_id;

    UPDATE public.auction_items
       SET final_status = 'FAILED_FINAL',
           current_bid_id = NULL,
           bidding_started_at = NULL,
           bidding_ends_at = NULL,
           last_bid_at = NULL
     WHERE id = v_item.id;

    UPDATE public.auctions
       SET current_item_id = NULL,
           paused_at = NULL,
           pause_remaining_seconds = NULL,
           state_version = state_version + 1
     WHERE id = v_auction.id;

    PERFORM public._auction_log_event(
      v_auction.classroom_id, v_auction.id, v_item.id, 'ITEM_FAILED_FINAL',
      jsonb_build_object('attempt', v_item.current_attempt, 'price', v_item.current_price, 'note', p_note)
    );

    RETURN jsonb_build_object(
      'status', 'FAILED_FINAL',
      'failure_id', v_failure_id,
      'attempt', v_item.current_attempt
    );
  END IF;

  v_discount := public._auction_failure_discount(v_auction.classroom_id);
  v_next_price := ceil(v_item.starting_price * power(1 - v_discount, v_item.current_attempt))::integer;
  v_next_price := greatest(1, v_next_price);

  INSERT INTO public.auction_failures(
    auction_item_id, attempt_number, failure_type,
    price_before, price_after, note
  ) VALUES (
    v_item.id, v_item.current_attempt, v_failure_type,
    v_item.current_price, v_next_price, p_note
  ) RETURNING id INTO v_failure_id;

  UPDATE public.auction_bids
     SET is_winning = false
   WHERE auction_item_id = v_item.id
     AND attempt_number = v_item.current_attempt
     AND is_winning = true;

  UPDATE public.auction_items
     SET current_attempt = current_attempt + 1,
         current_price = v_next_price,
         current_bid_id = NULL,
         bidding_started_at = NULL,
         bidding_ends_at = NULL,
         last_bid_at = NULL
   WHERE id = v_item.id;

  UPDATE public.auctions
     SET current_item_id = NULL,
         paused_at = NULL,
         pause_remaining_seconds = NULL,
         state_version = state_version + 1
   WHERE id = v_auction.id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, v_auction.id, v_item.id, 'ITEM_RETRY_READY',
    jsonb_build_object(
      'failed_attempt', v_item.current_attempt,
      'next_attempt', v_item.current_attempt + 1,
      'price_before', v_item.current_price,
      'price_after', v_next_price,
      'note', p_note
    )
  );

  RETURN jsonb_build_object(
    'status', 'RETRY_READY',
    'failure_id', v_failure_id,
    'next_attempt', v_item.current_attempt + 1,
    'next_price', v_next_price
  );
END;
$$;

REVOKE ALL ON FUNCTION public._auction_fail_current_attempt(integer, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auction_fail_current_attempt(integer, text)
TO service_role;

-- --------------------------------------------------------------------------
-- 4. 교사 회차·상품 관리 RPC
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_create_live_auction(
  p_classroom_id integer,
  p_round_number integer,
  p_school_year integer,
  p_scheduled_date date,
  p_initial_duration_seconds integer DEFAULT 30,
  p_extension_seconds integer DEFAULT 15
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id integer;
BEGIN
  PERFORM public.ensure_teacher_role();

  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 경매만 만들 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;
  IF p_round_number IS NULL OR p_round_number <= 0 OR p_round_number > 99 THEN
    RAISE EXCEPTION '경매 회차는 1~99 사이여야 합니다.' USING ERRCODE = 'P0704';
  END IF;
  IF p_school_year IS NULL OR p_school_year < 2020 OR p_school_year > 2100 THEN
    RAISE EXCEPTION '학년도가 올바르지 않습니다.' USING ERRCODE = 'P0705';
  END IF;
  IF p_initial_duration_seconds NOT BETWEEN 10 AND 300
     OR p_extension_seconds NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION '타이머 설정 범위가 올바르지 않습니다.' USING ERRCODE = 'P0706';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.auctions
     WHERE classroom_id = p_classroom_id
       AND status IN ('SCHEDULED', 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION '이미 준비 중이거나 진행 중인 경매가 있습니다.' USING ERRCODE = 'P0707';
  END IF;

  INSERT INTO public.auctions(
    classroom_id, round_number, school_year, scheduled_date,
    status, created_by, initial_duration_seconds, extension_seconds
  ) VALUES (
    p_classroom_id, p_round_number, p_school_year, p_scheduled_date,
    'SCHEDULED', auth.uid(), p_initial_duration_seconds, p_extension_seconds
  ) RETURNING id INTO v_id;

  PERFORM public._auction_log_event(
    p_classroom_id, v_id, NULL, 'AUCTION_CREATED',
    jsonb_build_object(
      'round_number', p_round_number,
      'initial_duration_seconds', p_initial_duration_seconds,
      'extension_seconds', p_extension_seconds
    )
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_add_live_auction_item(
  p_auction_id integer,
  p_item_name text,
  p_description text,
  p_category text,
  p_emoji text,
  p_image_url text,
  p_starting_price integer,
  p_display_order integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_id integer;
  v_order integer;
BEGIN
  v_auction := public._auction_assert_teacher_for_auction(p_auction_id);

  IF v_auction.status = 'COMPLETED' THEN
    RAISE EXCEPTION '완료된 경매에는 상품을 추가할 수 없습니다.' USING ERRCODE = 'P0708';
  END IF;
  IF v_auction.current_item_id IS NOT NULL THEN
    RAISE EXCEPTION '상품 진행 중에는 상품 목록을 변경할 수 없습니다.' USING ERRCODE = 'P0709';
  END IF;

  p_item_name := btrim(coalesce(p_item_name, ''));
  p_category := btrim(coalesce(p_category, '기타'));
  p_emoji := nullif(btrim(coalesce(p_emoji, '')), '');
  p_description := nullif(btrim(coalesce(p_description, '')), '');
  p_image_url := nullif(btrim(coalesce(p_image_url, '')), '');

  IF char_length(p_item_name) < 1 OR char_length(p_item_name) > 100 THEN
    RAISE EXCEPTION '상품명은 1~100자여야 합니다.' USING ERRCODE = 'P0710';
  END IF;
  IF char_length(p_category) > 50 OR char_length(coalesce(p_emoji, '🎁')) > 16 THEN
    RAISE EXCEPTION '카테고리 또는 이모지가 너무 깁니다.' USING ERRCODE = 'P0711';
  END IF;
  IF p_starting_price IS NULL OR p_starting_price <= 0 OR p_starting_price > 10000000 THEN
    RAISE EXCEPTION '시작가는 1~10,000,000 사이여야 합니다.' USING ERRCODE = 'P0712';
  END IF;

  SELECT coalesce(max(display_order), 0) + 1 INTO v_order
    FROM public.auction_items
   WHERE auction_id = p_auction_id;
  v_order := coalesce(p_display_order, v_order);

  INSERT INTO public.auction_items(
    auction_id, category, item_name, description,
    starting_price, current_price, display_order,
    current_attempt, emoji, image_url
  ) VALUES (
    p_auction_id, p_category, p_item_name, p_description,
    p_starting_price, p_starting_price, v_order,
    1, coalesce(p_emoji, '🎁'), p_image_url
  ) RETURNING id INTO v_id;

  UPDATE public.auctions
     SET state_version = state_version + 1
   WHERE id = p_auction_id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, p_auction_id, v_id, 'ITEM_ADDED',
    jsonb_build_object('item_name', p_item_name, 'starting_price', p_starting_price)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_update_live_auction_item(
  p_item_id integer,
  p_item_name text,
  p_description text,
  p_category text,
  p_emoji text,
  p_image_url text,
  p_starting_price integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '경매 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703';
  END IF;
  v_auction := public._auction_assert_teacher_for_auction(v_item.auction_id);

  IF v_auction.current_item_id IS NOT NULL
     OR v_item.final_status IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.auction_bids WHERE auction_item_id = p_item_id) THEN
    RAISE EXCEPTION '진행 또는 입찰 이력이 있는 상품은 수정할 수 없습니다.' USING ERRCODE = 'P0713';
  END IF;

  p_item_name := btrim(coalesce(p_item_name, ''));
  IF char_length(p_item_name) < 1 OR char_length(p_item_name) > 100
     OR p_starting_price IS NULL OR p_starting_price <= 0 OR p_starting_price > 10000000 THEN
    RAISE EXCEPTION '상품 정보가 올바르지 않습니다.' USING ERRCODE = 'P0714';
  END IF;

  UPDATE public.auction_items
     SET item_name = p_item_name,
         description = nullif(btrim(coalesce(p_description, '')), ''),
         category = left(btrim(coalesce(p_category, '기타')), 50),
         emoji = left(coalesce(nullif(btrim(coalesce(p_emoji, '')), ''), '🎁'), 16),
         image_url = nullif(btrim(coalesce(p_image_url, '')), ''),
         starting_price = p_starting_price,
         current_price = p_starting_price
   WHERE id = p_item_id;

  UPDATE public.auctions SET state_version = state_version + 1 WHERE id = v_auction.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_delete_live_auction_item(p_item_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RETURN; END IF;
  v_auction := public._auction_assert_teacher_for_auction(v_item.auction_id);

  IF v_auction.current_item_id IS NOT NULL
     OR v_item.final_status IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.auction_bids WHERE auction_item_id = p_item_id) THEN
    RAISE EXCEPTION '진행 또는 입찰 이력이 있는 상품은 삭제할 수 없습니다.' USING ERRCODE = 'P0715';
  END IF;

  DELETE FROM public.auction_items WHERE id = p_item_id;
  UPDATE public.auctions SET state_version = state_version + 1 WHERE id = v_auction.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_move_live_auction_item(
  p_item_id integer,
  p_direction integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_target public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
BEGIN
  IF p_direction NOT IN (-1, 1) THEN
    RAISE EXCEPTION '이동 방향은 -1 또는 1이어야 합니다.' USING ERRCODE = 'P0716';
  END IF;

  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '경매 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703';
  END IF;
  v_auction := public._auction_assert_teacher_for_auction(v_item.auction_id);
  IF v_auction.current_item_id IS NOT NULL THEN
    RAISE EXCEPTION '상품 진행 중에는 순서를 바꿀 수 없습니다.' USING ERRCODE = 'P0709';
  END IF;

  SELECT * INTO v_target
    FROM public.auction_items
   WHERE auction_id = v_item.auction_id
     AND (
       (p_direction = -1 AND display_order < v_item.display_order)
       OR (p_direction = 1 AND display_order > v_item.display_order)
     )
   ORDER BY
     CASE WHEN p_direction = -1 THEN display_order END DESC,
     CASE WHEN p_direction = 1 THEN display_order END ASC
   LIMIT 1
   FOR UPDATE;

  IF v_target.id IS NULL THEN RETURN; END IF;

  UPDATE public.auction_items SET display_order = -1 WHERE id = v_item.id;
  UPDATE public.auction_items SET display_order = v_item.display_order WHERE id = v_target.id;
  UPDATE public.auction_items SET display_order = v_target.display_order WHERE id = v_item.id;
  UPDATE public.auctions SET state_version = state_version + 1 WHERE id = v_auction.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_delete_scheduled_auction(p_auction_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
BEGIN
  v_auction := public._auction_assert_teacher_for_auction(p_auction_id);
  IF v_auction.status <> 'SCHEDULED' OR v_auction.current_item_id IS NOT NULL THEN
    RAISE EXCEPTION '준비 상태의 경매만 삭제할 수 있습니다.' USING ERRCODE = 'P0734';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.auction_bids b
      JOIN public.auction_items i ON i.id = b.auction_item_id
     WHERE i.auction_id = p_auction_id
  ) OR EXISTS (
    SELECT 1
      FROM public.auction_results r
      JOIN public.auction_items i ON i.id = r.auction_item_id
     WHERE i.auction_id = p_auction_id
  ) THEN
    RAISE EXCEPTION '입찰 또는 낙찰 기록이 있는 경매는 삭제할 수 없습니다.' USING ERRCODE = 'P0735';
  END IF;
  DELETE FROM public.auctions WHERE id = p_auction_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. 경매 진행 제어
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_start_live_auction(p_auction_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_count integer;
BEGIN
  v_auction := public._auction_assert_teacher_for_auction(p_auction_id);
  IF v_auction.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION '준비 상태의 경매만 시작할 수 있습니다.' USING ERRCODE = 'P0717';
  END IF;

  SELECT count(*) INTO v_count FROM public.auction_items WHERE auction_id = p_auction_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION '상품을 하나 이상 등록해야 합니다.' USING ERRCODE = 'P0718';
  END IF;

  UPDATE public.auctions
     SET status = 'IN_PROGRESS', started_at = now(), ended_at = NULL,
         state_version = state_version + 1
   WHERE id = p_auction_id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, p_auction_id, NULL, 'AUCTION_STARTED',
    jsonb_build_object('item_count', v_count)
  );

  INSERT INTO public.global_alerts(
    alert_uid, classroom_id, category, message, emoji,
    related_source_type, related_source_id, status, expires_at
  ) VALUES (
    'AUC_START_' || p_auction_id || '_' || extract(epoch FROM clock_timestamp())::bigint,
    v_auction.classroom_id, 'AUCTION',
    format('%s회차 실시간 경매가 시작되었습니다.', v_auction.round_number),
    '🔨', 'AUCTION', p_auction_id, 'ACTIVE', now() + interval '6 hours'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_start_live_auction_item(p_item_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_ends timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(74001, p_item_id);
  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '경매 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703';
  END IF;
  v_auction := public._auction_assert_teacher_for_auction(v_item.auction_id);

  IF v_auction.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION '경매 회차를 먼저 시작해야 합니다.' USING ERRCODE = 'P0719';
  END IF;
  IF v_auction.current_item_id IS NOT NULL THEN
    RAISE EXCEPTION '이미 진행 중인 상품이 있습니다.' USING ERRCODE = 'P0720';
  END IF;
  IF v_item.final_status IS NOT NULL THEN
    RAISE EXCEPTION '이미 종료된 상품입니다.' USING ERRCODE = 'P0721';
  END IF;

  v_ends := v_now + make_interval(secs => v_auction.initial_duration_seconds);

  UPDATE public.auction_items
     SET bidding_started_at = v_now,
         bidding_ends_at = v_ends,
         last_bid_at = NULL,
         current_bid_id = NULL
   WHERE id = p_item_id;

  UPDATE public.auction_bids
     SET is_winning = false
   WHERE auction_item_id = p_item_id
     AND attempt_number = v_item.current_attempt;

  UPDATE public.auctions
     SET current_item_id = p_item_id,
         paused_at = NULL,
         pause_remaining_seconds = NULL,
         state_version = state_version + 1
   WHERE id = v_auction.id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, v_auction.id, p_item_id, 'ITEM_STARTED',
    jsonb_build_object(
      'attempt', v_item.current_attempt,
      'price', v_item.current_price,
      'ends_at', v_ends
    )
  );

  RETURN jsonb_build_object('item_id', p_item_id, 'server_now', v_now, 'ends_at', v_ends);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_pause_live_auction_item(p_item_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_remaining integer;
BEGIN
  PERFORM pg_advisory_xact_lock(74001, p_item_id);
  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703'; END IF;
  v_auction := public._auction_assert_teacher_for_auction(v_item.auction_id);

  IF v_auction.current_item_id IS DISTINCT FROM p_item_id OR v_auction.paused_at IS NOT NULL THEN
    RAISE EXCEPTION '현재 진행 중인 상품이 아니거나 이미 일시정지 상태입니다.' USING ERRCODE = 'P0722';
  END IF;

  v_remaining := greatest(0, ceil(extract(epoch FROM (v_item.bidding_ends_at - clock_timestamp())))::integer);
  UPDATE public.auctions
     SET paused_at = clock_timestamp(), pause_remaining_seconds = v_remaining,
         state_version = state_version + 1
   WHERE id = v_auction.id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, v_auction.id, p_item_id, 'ITEM_PAUSED',
    jsonb_build_object('remaining_seconds', v_remaining)
  );
  RETURN v_remaining;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_resume_live_auction_item(p_item_id integer)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_ends timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(74001, p_item_id);
  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703'; END IF;
  v_auction := public._auction_assert_teacher_for_auction(v_item.auction_id);

  IF v_auction.current_item_id IS DISTINCT FROM p_item_id OR v_auction.paused_at IS NULL THEN
    RAISE EXCEPTION '일시정지된 현재 상품이 아닙니다.' USING ERRCODE = 'P0723';
  END IF;

  v_ends := clock_timestamp() + make_interval(secs => greatest(1, coalesce(v_auction.pause_remaining_seconds, 1)));
  UPDATE public.auction_items SET bidding_ends_at = v_ends WHERE id = p_item_id;
  UPDATE public.auctions
     SET paused_at = NULL, pause_remaining_seconds = NULL,
         state_version = state_version + 1
   WHERE id = v_auction.id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, v_auction.id, p_item_id, 'ITEM_RESUMED',
    jsonb_build_object('ends_at', v_ends)
  );
  RETURN v_ends;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. 학생 입찰
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_live_auction_bid(
  p_auction_item_id integer,
  p_student_id integer,
  p_bid_amount integer DEFAULT NULL,
  p_quick_bid boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_current_bidder integer;
  v_amount integer;
  v_bid_id bigint;
  v_now timestamptz := clock_timestamp();
  v_min_end timestamptz;
  v_new_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;
  IF public.current_student_id() IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION '본인 명의로만 입찰할 수 있습니다.' USING ERRCODE = 'P0510';
  END IF;

  PERFORM pg_advisory_xact_lock(74001, p_auction_item_id);

  SELECT * INTO v_item
    FROM public.auction_items
   WHERE id = p_auction_item_id
   FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '경매 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703';
  END IF;

  SELECT * INTO v_auction
    FROM public.auctions
   WHERE id = v_item.auction_id
   FOR UPDATE;

  SELECT * INTO v_student
    FROM public.students
   WHERE id = p_student_id
     AND classroom_id = v_auction.classroom_id
     AND user_id = auth.uid()
     AND transferred_at IS NULL
     AND role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');
  IF v_student.id IS NULL THEN
    RAISE EXCEPTION '같은 학급의 활성 학생만 입찰할 수 있습니다.' USING ERRCODE = 'P0724';
  END IF;

  IF v_auction.status <> 'IN_PROGRESS'
     OR v_auction.current_item_id IS DISTINCT FROM v_item.id
     OR v_auction.paused_at IS NOT NULL
     OR v_item.final_status IS NOT NULL
     OR v_item.bidding_ends_at IS NULL THEN
    RAISE EXCEPTION '현재 입찰 가능한 상품이 아닙니다.' USING ERRCODE = 'P0725';
  END IF;
  IF v_now >= v_item.bidding_ends_at THEN
    RAISE EXCEPTION '입찰 시간이 종료되었습니다.' USING ERRCODE = 'P0726';
  END IF;

  IF p_quick_bid THEN
    v_amount := greatest(v_item.current_price + 1, ceil(v_item.current_price * 1.10)::integer);
  ELSE
    v_amount := p_bid_amount;
  END IF;

  IF v_amount IS NULL OR v_amount <= v_item.current_price OR v_amount > 10000000 THEN
    RAISE EXCEPTION '현재가보다 높은 10,000,000 이하의 금액을 입력해야 합니다.' USING ERRCODE = 'P0727';
  END IF;

  IF v_item.current_bid_id IS NOT NULL THEN
    SELECT student_id INTO v_current_bidder
      FROM public.auction_bids WHERE id = v_item.current_bid_id;
    IF v_current_bidder = p_student_id THEN
      RAISE EXCEPTION '이미 최고 입찰자입니다.' USING ERRCODE = 'P0728';
    END IF;
  END IF;

  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE student_id = p_student_id
   FOR UPDATE;
  IF v_wallet.id IS NULL OR v_wallet.gold < v_amount THEN
    RAISE EXCEPTION '입찰할 GOLD가 부족합니다.' USING ERRCODE = 'P0729';
  END IF;

  UPDATE public.auction_bids
     SET is_winning = false
   WHERE auction_item_id = v_item.id
     AND attempt_number = v_item.current_attempt
     AND is_winning = true;

  INSERT INTO public.auction_bids(
    auction_item_id, student_id, bid_amount, attempt_number, is_winning
  ) VALUES (
    v_item.id, p_student_id, v_amount, v_item.current_attempt, true
  ) RETURNING id INTO v_bid_id;

  v_min_end := v_now + make_interval(secs => v_auction.extension_seconds);
  v_new_end := greatest(v_item.bidding_ends_at, v_min_end);

  UPDATE public.auction_items
     SET current_price = v_amount,
         current_bid_id = v_bid_id,
         last_bid_at = v_now,
         bidding_ends_at = v_new_end
   WHERE id = v_item.id;

  UPDATE public.auctions SET state_version = state_version + 1 WHERE id = v_auction.id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, v_auction.id, v_item.id, 'BID_ACCEPTED',
    jsonb_build_object(
      'bid_id', v_bid_id,
      'student_id', p_student_id,
      'amount', v_amount,
      'ends_at', v_new_end,
      'quick_bid', p_quick_bid
    )
  );

  RETURN jsonb_build_object(
    'bid_id', v_bid_id,
    'amount', v_amount,
    'server_now', v_now,
    'ends_at', v_new_end,
    'student_id', p_student_id
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 7. 만료 정산 및 교사 강제 정산
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._finalize_live_auction_item(
  p_item_id integer,
  p_require_expired boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_bid public.auction_bids%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_tx_id bigint;
  v_result_id integer;
  v_now timestamptz := clock_timestamp();
  v_failure jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(74001, p_item_id);

  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '경매 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703';
  END IF;
  SELECT * INTO v_auction FROM public.auctions WHERE id = v_item.auction_id FOR UPDATE;

  IF v_item.final_status IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ALREADY_FINAL', 'item_id', v_item.id);
  END IF;
  IF v_auction.current_item_id IS DISTINCT FROM v_item.id THEN
    RETURN jsonb_build_object('status', 'NOT_CURRENT', 'item_id', v_item.id);
  END IF;
  IF v_auction.paused_at IS NOT NULL AND p_require_expired THEN
    RETURN jsonb_build_object('status', 'PAUSED', 'item_id', v_item.id);
  END IF;
  IF p_require_expired AND (v_item.bidding_ends_at IS NULL OR v_now < v_item.bidding_ends_at) THEN
    RETURN jsonb_build_object(
      'status', 'NOT_EXPIRED', 'item_id', v_item.id,
      'server_now', v_now, 'ends_at', v_item.bidding_ends_at
    );
  END IF;

  LOOP
    SELECT * INTO v_bid
      FROM public.auction_bids
     WHERE auction_item_id = v_item.id
       AND attempt_number = v_item.current_attempt
       AND invalidated_at IS NULL
     ORDER BY bid_amount DESC, created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE;

    EXIT WHEN v_bid.id IS NULL;

    SELECT * INTO v_wallet
      FROM public.wallets
     WHERE student_id = v_bid.student_id
     FOR UPDATE;

    IF v_wallet.id IS NOT NULL AND v_wallet.gold >= v_bid.bid_amount THEN
      EXIT;
    END IF;

    UPDATE public.auction_bids
       SET is_winning = false,
           invalidated_at = v_now,
           invalid_reason = 'INSUFFICIENT_BALANCE_AT_SETTLEMENT'
     WHERE id = v_bid.id;

    PERFORM public._auction_log_event(
      v_auction.classroom_id, v_auction.id, v_item.id, 'BID_INVALIDATED',
      jsonb_build_object('bid_id', v_bid.id, 'student_id', v_bid.student_id, 'amount', v_bid.bid_amount)
    );

    v_bid.id := NULL;
  END LOOP;

  IF v_bid.id IS NULL THEN
    v_failure := public._auction_fail_current_attempt(v_item.id, '입찰 없음 또는 정산 시 잔액 부족');
    RETURN v_failure || jsonb_build_object('item_id', v_item.id, 'server_now', v_now);
  END IF;

  UPDATE public.auction_bids
     SET is_winning = (id = v_bid.id)
   WHERE auction_item_id = v_item.id
     AND attempt_number = v_item.current_attempt;

  v_tx_id := public.create_transaction(
    v_bid.student_id, 'GOLD', -v_bid.bid_amount, 'AUCTION_PAYMENT', v_item.id, 0,
    format('[경매 낙찰] %s — %s GOLD', v_item.item_name, v_bid.bid_amount)
  );

  INSERT INTO public.auction_results(
    auction_item_id, winner_student_id, final_price,
    attempt_number, transaction_id, confirmed_at
  ) VALUES (
    v_item.id, v_bid.student_id, v_bid.bid_amount,
    v_item.current_attempt, v_tx_id, v_now
  ) RETURNING id INTO v_result_id;

  UPDATE public.auction_items
     SET final_status = 'SOLD',
         current_price = v_bid.bid_amount,
         current_bid_id = v_bid.id,
         bidding_ends_at = v_now
   WHERE id = v_item.id;

  UPDATE public.auctions
     SET current_item_id = NULL,
         paused_at = NULL,
         pause_remaining_seconds = NULL,
         state_version = state_version + 1
   WHERE id = v_auction.id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, v_auction.id, v_item.id, 'ITEM_SOLD',
    jsonb_build_object(
      'result_id', v_result_id,
      'winner_student_id', v_bid.student_id,
      'final_price', v_bid.bid_amount,
      'attempt', v_item.current_attempt,
      'transaction_id', v_tx_id
    )
  );

  RETURN jsonb_build_object(
    'status', 'SOLD',
    'item_id', v_item.id,
    'result_id', v_result_id,
    'winner_student_id', v_bid.student_id,
    'final_price', v_bid.bid_amount,
    'server_now', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public._finalize_live_auction_item(integer, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finalize_live_auction_item(integer, boolean)
TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_live_auction_item_if_expired(p_item_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  SELECT a.classroom_id INTO v_classroom_id
    FROM public.auction_items i
    JOIN public.auctions a ON a.id = i.auction_id
   WHERE i.id = p_item_id;

  IF v_classroom_id IS NULL OR v_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '소속 학급의 경매만 확인할 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;

  RETURN public._finalize_live_auction_item(p_item_id, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_close_live_auction_item_now(p_item_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction_id integer;
BEGIN
  SELECT auction_id INTO v_auction_id FROM public.auction_items WHERE id = p_item_id;
  PERFORM public._auction_assert_teacher_for_auction(v_auction_id);
  RETURN public._finalize_live_auction_item(p_item_id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_fail_live_auction_item(
  p_item_id integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.auction_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.auction_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.' USING ERRCODE = 'P0703'; END IF;
  PERFORM public._auction_assert_teacher_for_auction(v_item.auction_id);

  IF EXISTS (
    SELECT 1 FROM public.auction_bids
     WHERE auction_item_id = p_item_id
       AND attempt_number = v_item.current_attempt
       AND invalidated_at IS NULL
  ) THEN
    RAISE EXCEPTION '유효한 입찰이 있어 수동 유찰할 수 없습니다. 종료 버튼을 사용하세요.' USING ERRCODE = 'P0730';
  END IF;

  RETURN public._auction_fail_current_attempt(p_item_id, nullif(btrim(coalesce(p_note, '')), ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_complete_live_auction(p_auction_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
BEGIN
  v_auction := public._auction_assert_teacher_for_auction(p_auction_id);
  IF v_auction.current_item_id IS NOT NULL THEN
    RAISE EXCEPTION '진행 중인 상품이 있습니다.' USING ERRCODE = 'P0731';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.auction_items
     WHERE auction_id = p_auction_id AND final_status IS NULL
  ) THEN
    RAISE EXCEPTION '아직 종료되지 않은 상품이 있습니다.' USING ERRCODE = 'P0732';
  END IF;

  UPDATE public.auctions
     SET status = 'COMPLETED', ended_at = clock_timestamp(),
         state_version = state_version + 1
   WHERE id = p_auction_id;

  PERFORM public._auction_log_event(
    v_auction.classroom_id, p_auction_id, NULL, 'AUCTION_COMPLETED', '{}'::jsonb
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 8. 통합 상태 읽기 RPC
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_live_auction_state(
  p_classroom_id integer,
  p_include_scheduled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_is_teacher boolean;
  v_state jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '소속 학급의 경매만 조회할 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;

  v_is_teacher := public.is_teacher_or_admin();

  SELECT * INTO v_auction
    FROM public.auctions
   WHERE classroom_id = p_classroom_id
     AND (
       status = 'IN_PROGRESS'
       OR (p_include_scheduled AND v_is_teacher AND status = 'SCHEDULED')
     )
   ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END, created_at DESC
   LIMIT 1;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object('server_now', clock_timestamp(), 'auction', NULL);
  END IF;

  SELECT jsonb_build_object(
    'server_now', clock_timestamp(),
    'auction', jsonb_build_object(
      'id', v_auction.id,
      'classroom_id', v_auction.classroom_id,
      'round_number', v_auction.round_number,
      'school_year', v_auction.school_year,
      'scheduled_date', v_auction.scheduled_date,
      'status', v_auction.status,
      'started_at', v_auction.started_at,
      'ended_at', v_auction.ended_at,
      'initial_duration_seconds', v_auction.initial_duration_seconds,
      'extension_seconds', v_auction.extension_seconds,
      'current_item_id', v_auction.current_item_id,
      'paused_at', v_auction.paused_at,
      'pause_remaining_seconds', v_auction.pause_remaining_seconds,
      'state_version', v_auction.state_version
    ),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'auction_id', i.auction_id,
          'item_name', i.item_name,
          'description', i.description,
          'category', i.category,
          'emoji', i.emoji,
          'image_url', i.image_url,
          'starting_price', i.starting_price,
          'current_price', i.current_price,
          'previous_sale_price', (
            SELECT r2.final_price
              FROM public.auction_results r2
              JOIN public.auction_items i2 ON i2.id = r2.auction_item_id
              JOIN public.auctions a2 ON a2.id = i2.auction_id
             WHERE a2.classroom_id = v_auction.classroom_id
               AND a2.id <> v_auction.id
               AND i2.item_name = i.item_name
               AND i2.category = i.category
             ORDER BY r2.confirmed_at DESC
             LIMIT 1
          ),
          'display_order', i.display_order,
          'current_attempt', i.current_attempt,
          'final_status', i.final_status,
          'bidding_started_at', i.bidding_started_at,
          'bidding_ends_at', i.bidding_ends_at,
          'last_bid_at', i.last_bid_at,
          'is_current', v_auction.current_item_id = i.id,
          'bid_count', (
            SELECT count(*) FROM public.auction_bids b
             WHERE b.auction_item_id = i.id
               AND b.attempt_number = i.current_attempt
               AND b.invalidated_at IS NULL
          ),
          'top_bid', CASE WHEN i.current_bid_id IS NULL THEN NULL ELSE (
            SELECT jsonb_build_object(
              'bid_id', b.id,
              'student_id', b.student_id,
              'student_name', s.name,
              'brand_name', s.brand_name,
              'amount', b.bid_amount,
              'created_at', b.created_at
            )
              FROM public.auction_bids b
              JOIN public.students s ON s.id = b.student_id
             WHERE b.id = i.current_bid_id
               AND b.invalidated_at IS NULL
          ) END,
          'result', (
            SELECT jsonb_build_object(
              'winner_student_id', r.winner_student_id,
              'winner_name', s.name,
              'winner_brand_name', s.brand_name,
              'final_price', r.final_price,
              'attempt_number', r.attempt_number,
              'confirmed_at', r.confirmed_at
            )
              FROM public.auction_results r
              JOIN public.students s ON s.id = r.winner_student_id
             WHERE r.auction_item_id = i.id
          )
        ) ORDER BY i.display_order, i.id
      )
      FROM public.auction_items i
      WHERE i.auction_id = v_auction.id
    ), '[]'::jsonb),
    'recent_bids', coalesce((
      SELECT jsonb_agg(x.obj ORDER BY x.created_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', b.id,
          'auction_item_id', b.auction_item_id,
          'student_id', b.student_id,
          'student_name', s.name,
          'brand_name', s.brand_name,
          'bid_amount', b.bid_amount,
          'attempt_number', b.attempt_number,
          'created_at', b.created_at,
          'is_winning', b.is_winning,
          'invalidated_at', b.invalidated_at
        ) AS obj, b.created_at
          FROM public.auction_bids b
          JOIN public.auction_items i ON i.id = b.auction_item_id
          JOIN public.students s ON s.id = b.student_id
         WHERE i.auction_id = v_auction.id
         ORDER BY b.created_at DESC
         LIMIT 20
      ) x
    ), '[]'::jsonb)
  ) INTO v_state;

  RETURN v_state;
END;
$$;

-- --------------------------------------------------------------------------
-- 9. 기존 불완전/저수준 RPC 잠금 및 새 외부 RPC ACL
-- --------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('record_auction_bid', 'confirm_auction_sale', 'report_auction_failure')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'teacher_create_live_auction',
         'teacher_add_live_auction_item',
         'teacher_update_live_auction_item',
         'teacher_delete_live_auction_item',
         'teacher_move_live_auction_item',
         'teacher_start_live_auction',
         'teacher_start_live_auction_item',
         'teacher_pause_live_auction_item',
         'teacher_resume_live_auction_item',
         'teacher_close_live_auction_item_now',
         'teacher_fail_live_auction_item',
         'teacher_complete_live_auction',
         'teacher_delete_scheduled_auction',
         'place_live_auction_bid',
         'finalize_live_auction_item_if_expired',
         'get_live_auction_state'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END
$$;

-- 테이블 직접 쓰기 차단. 읽기는 로그인한 학급 구성원 + RLS.
REVOKE ALL ON TABLE public.auctions, public.auction_items, public.auction_bids,
  public.auction_results, public.auction_failures, public.auction_event_logs
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.auctions, public.auction_items, public.auction_bids,
  public.auction_results, public.auction_failures, public.auction_event_logs
FROM authenticated;

GRANT SELECT ON TABLE public.auctions, public.auction_items, public.auction_bids,
  public.auction_results, public.auction_failures, public.auction_event_logs
TO authenticated;

GRANT ALL ON TABLE public.auctions, public.auction_items, public.auction_bids,
  public.auction_results, public.auction_failures, public.auction_event_logs
TO service_role;

-- --------------------------------------------------------------------------
-- 10. Realtime publication
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY[
      'auctions', 'auction_items', 'auction_bids', 'auction_results', 'auction_failures'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
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

-- --------------------------------------------------------------------------
-- 적용 후 검증
-- --------------------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('auctions', 'auction_items', 'auction_bids')
  AND column_name IN (
    'initial_duration_seconds', 'extension_seconds', 'current_item_id',
    'paused_at', 'pause_remaining_seconds', 'state_version',
    'emoji', 'image_url', 'current_price', 'current_bid_id',
    'bidding_started_at', 'bidding_ends_at', 'last_bid_at',
    'is_winning', 'invalidated_at', 'invalid_reason'
  )
ORDER BY table_name, ordinal_position;

WITH roles(role_name) AS (
  VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)
), funcs(function_name) AS (
  VALUES
    ('place_live_auction_bid'),
    ('finalize_live_auction_item_if_expired'),
    ('get_live_auction_state'),
    ('teacher_create_live_auction'),
    ('teacher_start_live_auction'),
    ('teacher_start_live_auction_item'),
    ('teacher_close_live_auction_item_now'),
    ('record_auction_bid'),
    ('confirm_auction_sale'),
    ('report_auction_failure')
)
SELECT r.role_name, f.function_name,
       EXISTS (
         SELECT 1
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = f.function_name
            AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
       ) AS can_execute
FROM roles r CROSS JOIN funcs f
ORDER BY f.function_name, r.role_name;

SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('auctions', 'auction_items', 'auction_bids', 'auction_results', 'auction_failures')
ORDER BY tablename;
