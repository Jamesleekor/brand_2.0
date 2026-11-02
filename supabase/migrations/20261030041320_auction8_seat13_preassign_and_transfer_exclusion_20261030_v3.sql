-- 2026-10-30
-- Auction 8 seat settlement adjustments:
-- 1) Exclude transferred student 김나연 from random forced seat distribution.
-- 2) Add missing seat 13 as teacher-reserved and preassign it to 정우림 at no charge.
-- 3) Make the settlement finalizer honor per-auction/category exclusions.

create table if not exists public.auction_settlement_exclusions (
  id bigserial primary key,
  auction_id integer not null references public.auctions(id) on delete cascade,
  category varchar(50) not null,
  student_id integer not null references public.students(id),
  reason text,
  created_at timestamptz not null default now(),
  unique(auction_id,category,student_id)
);
alter table public.auction_settlement_exclusions enable row level security;

CREATE OR REPLACE FUNCTION public.teacher_auction_settlement_finalize(p_auction_id integer, p_category text)
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
      SELECT 1 FROM public.auction_settlement_exclusions ex
      WHERE ex.auction_id = v_a.id
        AND ex.category = p_category
        AND ex.student_id = s.id
    )
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
$function$
;

insert into public.auction_settlement_exclusions(auction_id,category,student_id,reason)
values (43,'자리',2,'전출 학생: 8회차 자리 강제분배 제외')
on conflict(auction_id,category,student_id) do update set reason=excluded.reason;

with ins as (
  insert into public.auction_items(
    auction_id,category,item_name,description,starting_price,display_order,current_attempt,
    final_status,emoji,current_price
  )
  select 43,'자리','자리 13번','교사 지정 자리',100,13,1,'FAILED_FINAL','💺',100
  where not exists (
    select 1 from public.auction_items
    where auction_id=43 and category='자리' and item_name='자리 13번'
  )
  returning id
),
seat as (
  select id from ins
  union all
  select id from public.auction_items
  where auction_id=43 and category='자리' and item_name='자리 13번'
  limit 1
)
insert into public.auction_settlement_items(
  classroom_id,auction_id,auction_item_id,category,origin,
  original_winner_student_id,base_price,price_source,
  holder_student_id,disposition,assigned_at
)
select 1,43,seat.id,'자리','UNSOLD',null,100,'STARTING_PRICE',21,'HOLD',now()
from seat
on conflict(auction_item_id) do update
set holder_student_id=21,
    disposition='HOLD',
    original_winner_student_id=null,
    forced_by_student_id=null,
    charge_amount=0,
    charge_collected=0,
    charge_outstanding=0,
    charge_transaction_id=null,
    arrear_id=null,
    fee_student_id=null,
    fee_amount=0,
    fee_transaction_id=null,
    assigned_at=now(),
    updated_at=now();
