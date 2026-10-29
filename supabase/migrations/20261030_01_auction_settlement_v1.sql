-- =====================================================================
-- B.R.A.N.D 2.0 — 경매 낙찰품 정리(Auction Settlement) v1
-- 2026-10-30
--
-- 목적
--   본 경매가 끝난 뒤, 한 학생이 같은 카테고리(자리·1인1역·급식순서)
--   상품을 2개 이상 낙찰받았을 때 운영국(교사)이 정리하는 장부.
--
-- 규칙 (사용자 확정 2026-10-29)
--   1) 무료 양도: 2개 이상 가진 학생은 남는 상품을 원하는 친구에게 무료로 넘긴다.
--      받는 친구가 이미 상품을 가지고 있어도 되며, 그 친구도 다시 정리해야 한다.
--   2) 강제 분배: 무료 양도하지 않은 남는 상품은, 그 카테고리 상품이 0개인 학생 중
--      1명에게 랜덤으로 간다. 받은 학생은 낙찰가를 운영국에 내고(부족하면 미납 기록),
--      운영국은 낙찰가의 50%를 최초 낙찰자에게 수수료로 지급한다(소득세 없음).
--   3) 최종 유찰 상품: 0개인 학생 중 1명에게 랜덤 분배, 가격은 이전 회차 낙찰가.
--      (이전 낙찰 기록이 없으면 그 상품의 시작가) — 수수료 없음.
--   4) 정리가 끝나면 카테고리별 최종 배치표를 본다.
--
-- 안전 원칙
--   - auction_results / auction_items 등 기존 경매 기록은 절대 수정하지 않는다.
--   - 돈 이동은 서버 함수 안에서만, 한 트랜잭션으로 처리한다.
--   - 새 테이블은 RLS ON + anon/authenticated 직접 접근 차단, 교사 RPC만 공개.
--   - 정리 장부가 생긴 회차는 auction_items FK 때문에 "같은 회차 초기화"가 막힌다.
--     (정리 과정의 돈 기록이 초기화로 꼬이는 것을 막기 위한 의도된 보호)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auction_settlement_categories (
  id            bigserial PRIMARY KEY,
  classroom_id  integer NOT NULL REFERENCES public.classrooms(id),
  auction_id    integer NOT NULL REFERENCES public.auctions(id),
  category      varchar(30) NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','FINALIZED')),
  finalized_at  timestamptz,
  finalized_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_settlement_categories_uniq UNIQUE (auction_id, category),
  CONSTRAINT auction_settlement_categories_category_check
    CHECK (category IN ('자리','1인1역','급식순서'))
);

CREATE TABLE IF NOT EXISTS public.auction_settlement_items (
  id                          bigserial PRIMARY KEY,
  classroom_id                integer NOT NULL REFERENCES public.classrooms(id),
  auction_id                  integer NOT NULL REFERENCES public.auctions(id),
  auction_item_id             integer NOT NULL REFERENCES public.auction_items(id),
  category                    varchar(30) NOT NULL,
  -- SOLD: 낙찰된 상품 / UNSOLD: 최종 유찰된 상품
  origin                      text NOT NULL CHECK (origin IN ('SOLD','UNSOLD')),
  original_winner_student_id  integer REFERENCES public.students(id),
  base_price                  integer NOT NULL CHECK (base_price >= 0),
  price_source                text NOT NULL
                              CHECK (price_source IN ('FINAL_PRICE','PREVIOUS_SALE','STARTING_PRICE')),
  -- 지금 이 상품을 가지고 있는 학생(정리 중) / 최종 보유자(확정 후)
  holder_student_id           integer REFERENCES public.students(id),
  -- HOLD            : 보유 중 (원래 낙찰 또는 무료 양도로 받음)
  -- FORCED_PENDING  : 보유자가 "강제 분배"를 선택함 (추첨 대기)
  -- UNSOLD_PENDING  : 유찰품 (추첨 대기)
  -- FORCED_ASSIGNED : 강제 분배로 새 주인이 정해짐
  -- UNSOLD_ASSIGNED : 유찰품이 랜덤 분배됨
  -- UNASSIGNED      : 받을 학생이 남지 않아 주인이 없음
  disposition                 text NOT NULL
                              CHECK (disposition IN ('HOLD','FORCED_PENDING','UNSOLD_PENDING',
                                                     'FORCED_ASSIGNED','UNSOLD_ASSIGNED','UNASSIGNED')),
  transfer_count              integer NOT NULL DEFAULT 0 CHECK (transfer_count >= 0),
  forced_by_student_id        integer REFERENCES public.students(id),
  charge_amount               bigint NOT NULL DEFAULT 0,
  charge_collected            bigint NOT NULL DEFAULT 0,
  charge_outstanding          bigint NOT NULL DEFAULT 0,
  charge_transaction_id       bigint REFERENCES public.transactions(id),
  arrear_id                   bigint REFERENCES public.student_asset_arrears(id),
  fee_student_id              integer REFERENCES public.students(id),
  fee_amount                  bigint NOT NULL DEFAULT 0,
  fee_transaction_id          bigint REFERENCES public.transactions(id),
  assigned_at                 timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_settlement_items_item_uniq UNIQUE (auction_item_id)
);

CREATE INDEX IF NOT EXISTS auction_settlement_items_auction_cat_idx
  ON public.auction_settlement_items (auction_id, category);

CREATE TABLE IF NOT EXISTS public.auction_settlement_events (
  id                  bigserial PRIMARY KEY,
  classroom_id        integer NOT NULL,
  auction_id          integer NOT NULL,
  settlement_item_id  bigint REFERENCES public.auction_settlement_items(id),
  category            varchar(30) NOT NULL,
  event_type          text NOT NULL
                      CHECK (event_type IN ('FREE_TRANSFER','MARK_FORCED','UNDO_TRANSFER',
                                            'UNDO_MARK_FORCED','FORCED_ASSIGN','UNSOLD_ASSIGN',
                                            'NO_RECIPIENT','CATEGORY_FINALIZED')),
  from_student_id     integer,
  to_student_id       integer,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  undone_at           timestamptz,
  actor_user_id       uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auction_settlement_events_auction_idx
  ON public.auction_settlement_events (auction_id, id DESC);

-- 직접 접근 차단 (교사 RPC로만 읽고 쓴다)
ALTER TABLE public.auction_settlement_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_settlement_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_settlement_events     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.auction_settlement_categories FROM anon, authenticated;
REVOKE ALL ON public.auction_settlement_items      FROM anon, authenticated;
REVOKE ALL ON public.auction_settlement_events     FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.auction_settlement_categories_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.auction_settlement_items_id_seq      FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.auction_settlement_events_id_seq     FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 내부 도우미 (학생/교사가 직접 호출 불가)
-- ---------------------------------------------------------------------

-- 2-1. 교사 권한 + 담당 학급 + 완료된 경매인지 확인
CREATE OR REPLACE FUNCTION public._auction_settlement_assert_auction(p_auction_id integer)
RETURNS public.auctions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_a public.auctions%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v_a FROM public.auctions WHERE id = p_auction_id;
  IF v_a.id IS NULL OR v_a.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 경매만 정리할 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;
  IF v_a.status::text <> 'COMPLETED' THEN
    RAISE EXCEPTION '완료된 경매 회차만 낙찰품 정리를 할 수 있습니다.' USING ERRCODE = 'P0S01';
  END IF;
  RETURN v_a;
END;
$function$;

-- 2-2. 정리 장부 초기화 (이미 있으면 아무것도 하지 않음)
CREATE OR REPLACE FUNCTION public._auction_settlement_ensure_initialized(p_auction_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_a public.auctions%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.auctions WHERE id = p_auction_id;

  INSERT INTO public.auction_settlement_categories (classroom_id, auction_id, category)
  SELECT DISTINCT v_a.classroom_id, v_a.id, i.category
  FROM public.auction_items i
  WHERE i.auction_id = v_a.id
    AND i.category IN ('자리','1인1역','급식순서')
  ON CONFLICT (auction_id, category) DO NOTHING;

  INSERT INTO public.auction_settlement_items (
    classroom_id, auction_id, auction_item_id, category, origin,
    original_winner_student_id, base_price, price_source,
    holder_student_id, disposition
  )
  SELECT
    v_a.classroom_id,
    v_a.id,
    i.id,
    i.category,
    CASE WHEN r.id IS NOT NULL THEN 'SOLD' ELSE 'UNSOLD' END,
    r.winner_student_id,
    greatest(coalesce(r.final_price, prev.final_price, i.starting_price, 0), 0),
    CASE
      WHEN r.id IS NOT NULL THEN 'FINAL_PRICE'
      WHEN prev.final_price IS NOT NULL THEN 'PREVIOUS_SALE'
      ELSE 'STARTING_PRICE'
    END,
    r.winner_student_id,
    CASE WHEN r.id IS NOT NULL THEN 'HOLD' ELSE 'UNSOLD_PENDING' END
  FROM public.auction_items i
  LEFT JOIN public.auction_results r ON r.auction_item_id = i.id
  LEFT JOIN LATERAL (
    -- 경매 화면의 "이전 낙찰가"와 같은 기준: 같은 학급·같은 카테고리·같은 상품명,
    -- 이번 회차보다 먼저 확정된 낙찰 중 가장 최근 것
    SELECT r2.final_price
    FROM public.auction_results r2
    JOIN public.auction_items i2 ON i2.id = r2.auction_item_id
    JOIN public.auctions a2 ON a2.id = i2.auction_id
    WHERE a2.classroom_id = v_a.classroom_id
      AND a2.id <> v_a.id
      AND i2.item_name = i.item_name
      AND i2.category = i.category
      AND r2.confirmed_at < coalesce(v_a.started_at, v_a.created_at, now())
    ORDER BY r2.confirmed_at DESC
    LIMIT 1
  ) prev ON r.id IS NULL
  WHERE i.auction_id = v_a.id
    AND i.category IN ('자리','1인1역','급식순서')
  ON CONFLICT (auction_item_id) DO NOTHING;
END;
$function$;

-- 2-3. 카테고리 잠금 + 정리 중(OPEN)인지 확인
CREATE OR REPLACE FUNCTION public._auction_settlement_lock_open_category(p_auction_id integer, p_category text)
RETURNS public.auction_settlement_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_c public.auction_settlement_categories%ROWTYPE;
BEGIN
  SELECT * INTO v_c
  FROM public.auction_settlement_categories
  WHERE auction_id = p_auction_id AND category = p_category
  FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION '정리 대상 카테고리가 아닙니다: %', p_category USING ERRCODE = 'P0S02';
  END IF;
  IF v_c.status <> 'OPEN' THEN
    RAISE EXCEPTION '% 카테고리는 이미 최종 확정되어 바꿀 수 없습니다.', p_category USING ERRCODE = 'P0S03';
  END IF;
  RETURN v_c;
END;
$function$;

-- 2-4. 학급 명단(정리 대상 학생): 활성 학생, 테스트 계정 제외
CREATE OR REPLACE FUNCTION public._auction_settlement_is_roster_student(p_classroom_id integer, p_student_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = p_student_id
      AND s.classroom_id = p_classroom_id
      AND s.role::text = 'STUDENT'
      AND s.transferred_at IS NULL
      AND NOT coalesce(s.is_test_account, false)
  );
$function$;

-- 2-5. 강제 분배 대금 징수: 낼 수 있는 만큼 내고, 부족분은 자산 미납으로 기록
--      (_teacher_apply_asset_deduction 과 같은 "사용 가능 잔액" 계산 방식)
CREATE OR REPLACE FUNCTION public._auction_settlement_collect_gold(
  p_student_id integer,
  p_amount bigint,
  p_source_id bigint,
  p_memo text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_current bigint := 0;
  v_reserved_auction bigint := 0;
  v_equalization_debt bigint := 0;
  v_equalization_reserve bigint := 0;
  v_available bigint := 0;
  v_collected bigint := 0;
  v_outstanding bigint := 0;
  v_tx_id bigint := null;
  v_arrear_id bigint := null;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('transaction_id', null, 'arrear_id', null,
                              'collected_amount', 0, 'outstanding_amount', 0);
  END IF;

  SELECT s.classroom_id INTO v_classroom_id
  FROM public.students s
  WHERE s.id = p_student_id AND s.transferred_at IS NULL;
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '활성 학생을 찾을 수 없습니다.' USING ERRCODE = 'P0S04';
  END IF;

  PERFORM 1 FROM public.wallets w WHERE w.student_id = p_student_id FOR UPDATE;
  SELECT coalesce(w.gold, 0) INTO v_current FROM public.wallets w WHERE w.student_id = p_student_id;
  v_current := coalesce(v_current, 0);

  SELECT coalesce(max(b.bid_amount), 0)::bigint INTO v_reserved_auction
  FROM public.auction_bids b
  JOIN public.auction_items i ON i.id = b.auction_item_id
  JOIN public.auctions a ON a.id = i.auction_id
  WHERE b.student_id = p_student_id
    AND b.is_winning = true
    AND b.invalidated_at IS NULL
    AND i.final_status IS NULL
    AND a.status = 'IN_PROGRESS'
    AND a.current_item_id = i.id;

  SELECT coalesce(sum(ep.amount - ep.paid_amount), 0)::bigint INTO v_equalization_debt
  FROM public.equalization_contribution_payments ep
  WHERE ep.student_id = p_student_id
    AND ep.paid_amount < ep.amount;

  v_equalization_reserve := least(v_equalization_debt, v_current);
  v_available := greatest(v_current - greatest(v_reserved_auction, v_equalization_reserve), 0);
  v_collected := least(p_amount, v_available);
  v_outstanding := p_amount - v_collected;

  IF v_collected > 0 THEN
    v_tx_id := public.create_transaction(
      p_student_id,
      'GOLD'::public.value_token_type,
      -v_collected,
      'AUCTION_PAYMENT'::public.transaction_source_type,
      p_source_id,
      0,
      p_memo
    );
  END IF;

  IF v_outstanding > 0 THEN
    INSERT INTO public.student_asset_arrears (
      classroom_id, student_id, value_token, assessed_amount, paid_amount,
      reason, status, initial_transaction_id, created_by
    ) VALUES (
      v_classroom_id, p_student_id, 'GOLD'::public.value_token_type, p_amount, v_collected,
      left(p_reason, 200),
      CASE WHEN v_collected > 0 THEN 'PARTIAL' ELSE 'UNPAID' END,
      v_tx_id, auth.uid()
    )
    RETURNING id INTO v_arrear_id;
  END IF;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'arrear_id', v_arrear_id,
    'collected_amount', v_collected,
    'outstanding_amount', v_outstanding
  );
END;
$function$;

-- 2-6. 화면에 보낼 전체 상태
CREATE OR REPLACE FUNCTION public._auction_settlement_build_state(p_auction_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_a public.auctions%ROWTYPE;
  v_categories jsonb;
  v_items jsonb;
  v_students jsonb;
  v_events jsonb;
BEGIN
  SELECT * INTO v_a FROM public.auctions WHERE id = p_auction_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'category', c.category,
      'status', c.status,
      'finalized_at', c.finalized_at
    ) ORDER BY array_position(ARRAY['자리','1인1역','급식순서']::text[], c.category::text)), '[]'::jsonb)
  INTO v_categories
  FROM public.auction_settlement_categories c
  WHERE c.auction_id = p_auction_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', si.id,
      'auction_item_id', si.auction_item_id,
      'category', si.category,
      'item_name', i.item_name,
      'emoji', i.emoji,
      'display_order', i.display_order,
      'origin', si.origin,
      'base_price', si.base_price,
      'price_source', si.price_source,
      'original_winner_student_id', si.original_winner_student_id,
      'holder_student_id', si.holder_student_id,
      'disposition', si.disposition,
      'transfer_count', si.transfer_count,
      'forced_by_student_id', si.forced_by_student_id,
      'charge_amount', si.charge_amount,
      'charge_collected', si.charge_collected,
      'charge_outstanding', si.charge_outstanding,
      'fee_student_id', si.fee_student_id,
      'fee_amount', si.fee_amount,
      'assigned_at', si.assigned_at
    ) ORDER BY i.display_order, i.id), '[]'::jsonb)
  INTO v_items
  FROM public.auction_settlement_items si
  JOIN public.auction_items i ON i.id = si.auction_item_id
  WHERE si.auction_id = p_auction_id;

  -- 명단 학생 + (명단 밖이지만 장부에 등장하는 학생) 이름을 함께 보낸다
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'brand_name', s.brand_name,
      'in_roster', public._auction_settlement_is_roster_student(v_a.classroom_id, s.id)
    ) ORDER BY s.name, s.id), '[]'::jsonb)
  INTO v_students
  FROM public.students s
  WHERE s.classroom_id = v_a.classroom_id
    AND (
      public._auction_settlement_is_roster_student(v_a.classroom_id, s.id)
      OR s.id IN (
        SELECT x.sid FROM (
          SELECT si.original_winner_student_id AS sid FROM public.auction_settlement_items si WHERE si.auction_id = p_auction_id
          UNION SELECT si.holder_student_id FROM public.auction_settlement_items si WHERE si.auction_id = p_auction_id
        ) x WHERE x.sid IS NOT NULL
      )
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'settlement_item_id', e.settlement_item_id,
      'category', e.category,
      'event_type', e.event_type,
      'from_student_id', e.from_student_id,
      'to_student_id', e.to_student_id,
      'payload', e.payload,
      'undone_at', e.undone_at,
      'created_at', e.created_at
    ) ORDER BY e.id DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT * FROM public.auction_settlement_events
    WHERE auction_id = p_auction_id
    ORDER BY id DESC
    LIMIT 200
  ) e;

  RETURN jsonb_build_object(
    'auction', jsonb_build_object(
      'id', v_a.id,
      'round_number', v_a.round_number,
      'school_year', v_a.school_year,
      'scheduled_date', v_a.scheduled_date,
      'ended_at', v_a.ended_at
    ),
    'categories', v_categories,
    'items', v_items,
    'students', v_students,
    'events', v_events
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. 교사 RPC
-- ---------------------------------------------------------------------

-- 3-1. 상태 조회 (처음 열면 장부를 자동으로 만든다. 돈은 움직이지 않음)
CREATE OR REPLACE FUNCTION public.teacher_auction_settlement_state(p_auction_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_a public.auctions%ROWTYPE;
BEGIN
  v_a := public._auction_settlement_assert_auction(p_auction_id);
  PERFORM public._auction_settlement_ensure_initialized(v_a.id);
  RETURN public._auction_settlement_build_state(v_a.id);
END;
$function$;

-- 3-2. 무료 양도
CREATE OR REPLACE FUNCTION public.teacher_auction_settlement_transfer(
  p_settlement_item_id bigint,
  p_to_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.auction_settlement_items%ROWTYPE;
  v_a public.auctions%ROWTYPE;
  v_hold_count integer;
  v_from integer;
BEGIN
  SELECT * INTO v_item FROM public.auction_settlement_items WHERE id = p_settlement_item_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '정리 대상 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0S05';
  END IF;
  v_a := public._auction_settlement_assert_auction(v_item.auction_id);
  PERFORM public._auction_settlement_lock_open_category(v_item.auction_id, v_item.category);

  -- 잠금 후 최신 값으로 다시 읽기
  SELECT * INTO v_item FROM public.auction_settlement_items WHERE id = p_settlement_item_id FOR UPDATE;

  IF v_item.disposition <> 'HOLD' OR v_item.holder_student_id IS NULL THEN
    RAISE EXCEPTION '보유 중인 상품만 무료 양도할 수 있습니다.' USING ERRCODE = 'P0S06';
  END IF;
  v_from := v_item.holder_student_id;

  IF p_to_student_id IS NULL OR p_to_student_id = v_from THEN
    RAISE EXCEPTION '받을 친구를 다시 선택해 주세요.' USING ERRCODE = 'P0S07';
  END IF;
  IF NOT public._auction_settlement_is_roster_student(v_a.classroom_id, p_to_student_id) THEN
    RAISE EXCEPTION '우리 반 학생에게만 양도할 수 있습니다.' USING ERRCODE = 'P0S08';
  END IF;

  SELECT count(*) INTO v_hold_count
  FROM public.auction_settlement_items
  WHERE auction_id = v_item.auction_id
    AND category = v_item.category
    AND disposition = 'HOLD'
    AND holder_student_id = v_from;

  IF v_hold_count < 2 THEN
    RAISE EXCEPTION '이 학생은 이 카테고리 상품이 1개뿐이라 정리할 필요가 없습니다. (1개는 반드시 남겨야 합니다)'
      USING ERRCODE = 'P0S09';
  END IF;

  UPDATE public.auction_settlement_items
  SET holder_student_id = p_to_student_id,
      transfer_count = transfer_count + 1,
      updated_at = now()
  WHERE id = v_item.id;

  INSERT INTO public.auction_settlement_events (
    classroom_id, auction_id, settlement_item_id, category, event_type,
    from_student_id, to_student_id, actor_user_id
  ) VALUES (
    v_a.classroom_id, v_item.auction_id, v_item.id, v_item.category, 'FREE_TRANSFER',
    v_from, p_to_student_id, auth.uid()
  );

  RETURN public._auction_settlement_build_state(v_item.auction_id);
END;
$function$;

-- 3-3. 강제 분배 지정
CREATE OR REPLACE FUNCTION public.teacher_auction_settlement_mark_forced(p_settlement_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.auction_settlement_items%ROWTYPE;
  v_a public.auctions%ROWTYPE;
  v_hold_count integer;
BEGIN
  SELECT * INTO v_item FROM public.auction_settlement_items WHERE id = p_settlement_item_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '정리 대상 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0S05';
  END IF;
  v_a := public._auction_settlement_assert_auction(v_item.auction_id);
  PERFORM public._auction_settlement_lock_open_category(v_item.auction_id, v_item.category);
  SELECT * INTO v_item FROM public.auction_settlement_items WHERE id = p_settlement_item_id FOR UPDATE;

  IF v_item.disposition <> 'HOLD' OR v_item.holder_student_id IS NULL THEN
    RAISE EXCEPTION '보유 중인 상품만 강제 분배로 보낼 수 있습니다.' USING ERRCODE = 'P0S06';
  END IF;

  SELECT count(*) INTO v_hold_count
  FROM public.auction_settlement_items
  WHERE auction_id = v_item.auction_id
    AND category = v_item.category
    AND disposition = 'HOLD'
    AND holder_student_id = v_item.holder_student_id;

  IF v_hold_count < 2 THEN
    RAISE EXCEPTION '이 학생은 이 카테고리 상품이 1개뿐이라 정리할 필요가 없습니다. (1개는 반드시 남겨야 합니다)'
      USING ERRCODE = 'P0S09';
  END IF;

  UPDATE public.auction_settlement_items
  SET disposition = 'FORCED_PENDING',
      forced_by_student_id = v_item.holder_student_id,
      updated_at = now()
  WHERE id = v_item.id;

  INSERT INTO public.auction_settlement_events (
    classroom_id, auction_id, settlement_item_id, category, event_type,
    from_student_id, actor_user_id
  ) VALUES (
    v_a.classroom_id, v_item.auction_id, v_item.id, v_item.category, 'MARK_FORCED',
    v_item.holder_student_id, auth.uid()
  );

  RETURN public._auction_settlement_build_state(v_item.auction_id);
END;
$function$;

-- 3-4. 되돌리기 (강제 분배 지정 취소 → 마지막 무료 양도 취소 순)
CREATE OR REPLACE FUNCTION public.teacher_auction_settlement_undo(p_settlement_item_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.auction_settlement_items%ROWTYPE;
  v_a public.auctions%ROWTYPE;
  v_event public.auction_settlement_events%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.auction_settlement_items WHERE id = p_settlement_item_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '정리 대상 상품을 찾을 수 없습니다.' USING ERRCODE = 'P0S05';
  END IF;
  v_a := public._auction_settlement_assert_auction(v_item.auction_id);
  PERFORM public._auction_settlement_lock_open_category(v_item.auction_id, v_item.category);
  SELECT * INTO v_item FROM public.auction_settlement_items WHERE id = p_settlement_item_id FOR UPDATE;

  IF v_item.disposition = 'FORCED_PENDING' THEN
    UPDATE public.auction_settlement_items
    SET disposition = 'HOLD',
        forced_by_student_id = NULL,
        updated_at = now()
    WHERE id = v_item.id;

    INSERT INTO public.auction_settlement_events (
      classroom_id, auction_id, settlement_item_id, category, event_type,
      from_student_id, actor_user_id
    ) VALUES (
      v_a.classroom_id, v_item.auction_id, v_item.id, v_item.category, 'UNDO_MARK_FORCED',
      v_item.holder_student_id, auth.uid()
    );

  ELSIF v_item.disposition = 'HOLD' AND v_item.transfer_count > 0 THEN
    SELECT * INTO v_event
    FROM public.auction_settlement_events
    WHERE settlement_item_id = v_item.id
      AND event_type = 'FREE_TRANSFER'
      AND undone_at IS NULL
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_event.id IS NULL OR v_event.to_student_id IS DISTINCT FROM v_item.holder_student_id THEN
      RAISE EXCEPTION '되돌릴 양도 기록을 찾지 못했습니다.' USING ERRCODE = 'P0S10';
    END IF;

    UPDATE public.auction_settlement_items
    SET holder_student_id = v_event.from_student_id,
        transfer_count = transfer_count - 1,
        updated_at = now()
    WHERE id = v_item.id;

    UPDATE public.auction_settlement_events SET undone_at = now() WHERE id = v_event.id;

    INSERT INTO public.auction_settlement_events (
      classroom_id, auction_id, settlement_item_id, category, event_type,
      from_student_id, to_student_id, payload, actor_user_id
    ) VALUES (
      v_a.classroom_id, v_item.auction_id, v_item.id, v_item.category, 'UNDO_TRANSFER',
      v_event.to_student_id, v_event.from_student_id,
      jsonb_build_object('undone_event_id', v_event.id), auth.uid()
    );
  ELSE
    RAISE EXCEPTION '이 상품에는 되돌릴 작업이 없습니다.' USING ERRCODE = 'P0S11';
  END IF;

  RETURN public._auction_settlement_build_state(v_item.auction_id);
END;
$function$;

-- 3-5. 카테고리 최종 확정: 랜덤 추첨 + 대금 징수(부족분 미납) + 수수료 지급
CREATE OR REPLACE FUNCTION public.teacher_auction_settlement_finalize(
  p_auction_id integer,
  p_category text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_a public.auctions%ROWTYPE;
  v_c public.auction_settlement_categories%ROWTYPE;
  v_unresolved text;
  v_pool integer[];
  v_used integer[] := ARRAY[]::integer[];
  v_item record;
  v_recipient integer;
  v_candidate integer;
  v_charge jsonb;
  v_fee bigint;
  v_fee_tx bigint;
  v_fee_student integer;
  v_label text;
  v_draw jsonb := '[]'::jsonb;
  v_state jsonb;
BEGIN
  v_a := public._auction_settlement_assert_auction(p_auction_id);
  PERFORM public._auction_settlement_ensure_initialized(v_a.id);
  v_c := public._auction_settlement_lock_open_category(v_a.id, p_category);

  -- (1) 아직 2개 이상 들고 있는 학생이 있으면 확정 불가
  SELECT string_agg(format('%s(%s개)', s.name, x.cnt), ', ' ORDER BY s.name)
  INTO v_unresolved
  FROM (
    SELECT si.holder_student_id AS sid, count(*) AS cnt
    FROM public.auction_settlement_items si
    WHERE si.auction_id = v_a.id
      AND si.category = p_category
      AND si.disposition = 'HOLD'
      AND si.holder_student_id IS NOT NULL
    GROUP BY si.holder_student_id
    HAVING count(*) > 1
  ) x
  JOIN public.students s ON s.id = x.sid;

  IF v_unresolved IS NOT NULL THEN
    RAISE EXCEPTION '아직 정리가 끝나지 않은 학생이 있습니다: %', v_unresolved USING ERRCODE = 'P0S12';
  END IF;

  -- (2) 추첨 대상: 이 카테고리 상품이 0개인 우리 반 학생 (무작위 순서)
  SELECT coalesce(array_agg(s.id ORDER BY random()), ARRAY[]::integer[])
  INTO v_pool
  FROM public.students s
  WHERE public._auction_settlement_is_roster_student(v_a.classroom_id, s.id)
    AND s.classroom_id = v_a.classroom_id
    AND NOT EXISTS (
      SELECT 1 FROM public.auction_settlement_items si
      WHERE si.auction_id = v_a.id
        AND si.category = p_category
        AND si.disposition = 'HOLD'
        AND si.holder_student_id = s.id
    );

  -- (3) 분배 대기 상품을 무작위 순서로 하나씩 배정
  FOR v_item IN
    SELECT si.*, i.item_name
    FROM public.auction_settlement_items si
    JOIN public.auction_items i ON i.id = si.auction_item_id
    WHERE si.auction_id = v_a.id
      AND si.category = p_category
      AND si.disposition IN ('FORCED_PENDING','UNSOLD_PENDING')
    ORDER BY random()
    FOR UPDATE OF si
  LOOP
    v_recipient := NULL;
    FOREACH v_candidate IN ARRAY v_pool LOOP
      IF NOT (v_candidate = ANY(v_used))
         AND v_candidate IS DISTINCT FROM v_item.original_winner_student_id
         AND v_candidate IS DISTINCT FROM v_item.holder_student_id THEN
        v_recipient := v_candidate;
        EXIT;
      END IF;
    END LOOP;

    IF v_recipient IS NULL THEN
      -- 받을 학생이 남지 않음 → 주인 없음 (돈 이동 없음)
      UPDATE public.auction_settlement_items
      SET disposition = 'UNASSIGNED',
          holder_student_id = NULL,
          updated_at = now()
      WHERE id = v_item.id;

      INSERT INTO public.auction_settlement_events (
        classroom_id, auction_id, settlement_item_id, category, event_type,
        from_student_id, payload, actor_user_id
      ) VALUES (
        v_a.classroom_id, v_a.id, v_item.id, p_category, 'NO_RECIPIENT',
        v_item.holder_student_id,
        jsonb_build_object('item_name', v_item.item_name, 'origin', v_item.origin), auth.uid()
      );

      v_draw := v_draw || jsonb_build_array(jsonb_build_object(
        'settlement_item_id', v_item.id, 'item_name', v_item.item_name,
        'origin', v_item.origin, 'recipient_student_id', null
      ));
      CONTINUE;
    END IF;

    v_used := v_used || v_recipient;
    v_label := CASE WHEN v_item.origin = 'SOLD' THEN '낙찰품 강제 분배' ELSE '유찰품 랜덤 분배' END;

    -- (3-a) 받은 학생 → 운영국 : 가격 징수 (부족분 미납)
    v_charge := public._auction_settlement_collect_gold(
      v_recipient,
      v_item.base_price::bigint,
      v_item.auction_item_id::bigint,
      format('[%s] %s — %s GOLD', v_label, v_item.item_name, v_item.base_price),
      format('%s회차 경매 %s %s 대금 미납', v_a.round_number, v_item.item_name, v_label)
    );

    -- (3-b) 운영국 → 최초 낙찰자 : 수수료 50% (낙찰품만, 소득세 없음)
    v_fee := 0;
    v_fee_tx := NULL;
    v_fee_student := NULL;
    IF v_item.origin = 'SOLD'
       AND v_item.original_winner_student_id IS NOT NULL
       AND v_item.base_price > 0
       AND EXISTS (SELECT 1 FROM public.students s
                   WHERE s.id = v_item.original_winner_student_id AND s.transferred_at IS NULL) THEN
      v_fee := floor(v_item.base_price * 0.5)::bigint;
      IF v_fee > 0 THEN
        v_fee_student := v_item.original_winner_student_id;
        v_fee_tx := public.create_transaction(
          v_fee_student,
          'GOLD'::public.value_token_type,
          v_fee,
          'AUCTION_REFUND'::public.transaction_source_type,
          v_item.auction_item_id::bigint,
          0,
          format('[강제 분배 수수료] %s — %s GOLD (낙찰가의 50%%)', v_item.item_name, v_fee)
        );
      END IF;
    END IF;

    UPDATE public.auction_settlement_items
    SET disposition = CASE WHEN v_item.origin = 'SOLD' THEN 'FORCED_ASSIGNED' ELSE 'UNSOLD_ASSIGNED' END,
        holder_student_id = v_recipient,
        charge_amount = v_item.base_price,
        charge_collected = coalesce((v_charge->>'collected_amount')::bigint, 0),
        charge_outstanding = coalesce((v_charge->>'outstanding_amount')::bigint, 0),
        charge_transaction_id = (v_charge->>'transaction_id')::bigint,
        arrear_id = (v_charge->>'arrear_id')::bigint,
        fee_student_id = v_fee_student,
        fee_amount = v_fee,
        fee_transaction_id = v_fee_tx,
        assigned_at = now(),
        updated_at = now()
    WHERE id = v_item.id;

    INSERT INTO public.auction_settlement_events (
      classroom_id, auction_id, settlement_item_id, category, event_type,
      from_student_id, to_student_id, payload, actor_user_id
    ) VALUES (
      v_a.classroom_id, v_a.id, v_item.id, p_category,
      CASE WHEN v_item.origin = 'SOLD' THEN 'FORCED_ASSIGN' ELSE 'UNSOLD_ASSIGN' END,
      v_item.holder_student_id, v_recipient,
      jsonb_build_object(
        'item_name', v_item.item_name,
        'price', v_item.base_price,
        'price_source', v_item.price_source,
        'collected', coalesce((v_charge->>'collected_amount')::bigint, 0),
        'outstanding', coalesce((v_charge->>'outstanding_amount')::bigint, 0),
        'fee_student_id', v_fee_student,
        'fee_amount', v_fee
      ),
      auth.uid()
    );

    v_draw := v_draw || jsonb_build_array(jsonb_build_object(
      'settlement_item_id', v_item.id,
      'item_name', v_item.item_name,
      'origin', v_item.origin,
      'recipient_student_id', v_recipient,
      'price', v_item.base_price,
      'collected', coalesce((v_charge->>'collected_amount')::bigint, 0),
      'outstanding', coalesce((v_charge->>'outstanding_amount')::bigint, 0),
      'fee_student_id', v_fee_student,
      'fee_amount', v_fee
    ));
  END LOOP;

  UPDATE public.auction_settlement_categories
  SET status = 'FINALIZED',
      finalized_at = now(),
      finalized_by = auth.uid(),
      updated_at = now()
  WHERE id = v_c.id;

  INSERT INTO public.auction_settlement_events (
    classroom_id, auction_id, category, event_type, payload, actor_user_id
  ) VALUES (
    v_a.classroom_id, v_a.id, p_category, 'CATEGORY_FINALIZED',
    jsonb_build_object('pool', to_jsonb(v_pool), 'draw', v_draw), auth.uid()
  );

  v_state := public._auction_settlement_build_state(v_a.id);
  RETURN v_state || jsonb_build_object('draw_results', v_draw, 'finalized_category', p_category);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. 실행 권한 (기본 ACL이 anon/authenticated에 열어주므로 명시적으로 정리)
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._auction_settlement_assert_auction(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._auction_settlement_ensure_initialized(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._auction_settlement_lock_open_category(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._auction_settlement_is_roster_student(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._auction_settlement_collect_gold(integer, bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._auction_settlement_build_state(integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.teacher_auction_settlement_state(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_auction_settlement_transfer(bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_auction_settlement_mark_forced(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_auction_settlement_undo(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_auction_settlement_finalize(integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_auction_settlement_state(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_auction_settlement_transfer(bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_auction_settlement_mark_forced(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_auction_settlement_undo(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_auction_settlement_finalize(integer, text) TO authenticated;

COMMIT;

-- =====================================================================
-- POSTCHECK (SQL Editor에서 실행해도 안전한 구조 확인)
-- =====================================================================
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('auction_settlement_categories','auction_settlement_items','auction_settlement_events');
-- SELECT proname, proacl FROM pg_proc WHERE proname ILIKE '%auction_settlement%' ORDER BY proname;
