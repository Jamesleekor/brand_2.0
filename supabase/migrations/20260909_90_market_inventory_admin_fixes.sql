-- B.R.A.N.D. 2.0 — market/inventory admin fixes
-- 2026-09-09
-- 1) teacher grant consumes market stock, with explicit override when stock is insufficient
-- 2) teacher can revoke/delete student inventory with optional stock restoration
-- 3) ticket use mode SNACK_EXCHANGE exchanges 1:1 for in-stock snack items

alter table public.market_items drop constraint if exists market_items_use_mode_check;
alter table public.market_items
  add constraint market_items_use_mode_check
  check (use_mode = any (array[
    'BAKERY_FULFILLMENT'::text,
    'IMMEDIATE'::text,
    'AUCTION_SUPER_PASS'::text,
    'SNACK_EXCHANGE'::text,
    'MANUAL'::text,
    'NONE'::text
  ]));

-- Existing class item: convert the active ticket named "간식 쿠폰" to the generalized snack-exchange mode.
update public.market_items
   set use_mode = 'SNACK_EXCHANGE',
       is_usable = true,
       updated_at = now()
 where item_type = 'TICKET'
   and name = '간식 쿠폰'
   and is_archived = false;

create or replace function public.teacher_grant_inventory_item_v2(
  p_classroom_id integer,
  p_student_id integer,
  p_item_id bigint,
  p_quantity integer,
  p_note text default null,
  p_allow_stock_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.market_items%rowtype;
  v_lot_id bigint;
  v_owned integer;
  v_stock_before integer;
  v_stock_deducted integer;
  v_stock_after integer;
  v_shortage integer;
  v_quote_after bigint;
begin
  perform public.ensure_teacher_role();
  if public.current_classroom_id() is distinct from p_classroom_id then
    raise exception '다른 학급의 인벤토리를 관리할 수 없습니다.' using errcode = 'P0900';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000 then
    raise exception '지급 수량은 1~1000 범위여야 합니다.' using errcode = 'P0901';
  end if;
  if length(coalesce(p_note,'')) > 500 then
    raise exception '지급 메모는 500자 이하로 입력해주세요.' using errcode = 'P0905';
  end if;
  if not exists(
    select 1 from public.students
    where id = p_student_id and classroom_id = p_classroom_id and transferred_at is null
  ) then
    raise exception '해당 학급의 활성 학생이 아닙니다.' using errcode = 'P0902';
  end if;

  select * into v_item
  from public.market_items
  where id = p_item_id and classroom_id = p_classroom_id
  for update;

  if v_item.id is null then
    raise exception '해당 학급의 아이템이 아닙니다.' using errcode = 'P0903';
  end if;

  v_stock_before := v_item.current_stock;
  if v_stock_before < p_quantity and not coalesce(p_allow_stock_override,false) then
    raise exception '재고가 부족합니다. (현재 재고: %개, 지급 요청: %개)', v_stock_before, p_quantity using errcode = 'P0904';
  end if;

  v_stock_deducted := least(v_stock_before, p_quantity);
  v_stock_after := v_stock_before - v_stock_deducted;
  v_shortage := p_quantity - v_stock_deducted;

  update public.market_items
     set current_stock = v_stock_after,
         updated_at = now()
   where id = p_item_id;

  insert into public.student_inventory(classroom_id,student_id,item_id,owned_quantity,reserved_quantity)
  values(p_classroom_id,p_student_id,p_item_id,p_quantity,0)
  on conflict(student_id,item_id) do update
    set owned_quantity = public.student_inventory.owned_quantity + excluded.owned_quantity,
        classroom_id = excluded.classroom_id,
        updated_at = now()
  returning owned_quantity into v_owned;

  insert into public.inventory_purchase_lots(
    classroom_id,student_id,item_id,acquisition_source,
    original_quantity,remaining_quantity,reserved_quantity,
    unit_paid_gold,resale_eligible,source_ref_type,metadata
  ) values(
    p_classroom_id,p_student_id,p_item_id,'TEACHER_GRANT',
    p_quantity,p_quantity,0,
    null,false,'TEACHER_GRANT',jsonb_build_object(
      'note',p_note,
      'teacher_user_id',auth.uid(),
      'stock_before',v_stock_before,
      'stock_after',v_stock_after,
      'stock_deducted',v_stock_deducted,
      'stock_shortage_quantity',v_shortage,
      'stock_override',coalesce(p_allow_stock_override,false)
    )
  ) returning id into v_lot_id;

  insert into public.inventory_events(
    classroom_id,student_id,item_id,event_type,quantity_delta,reserved_delta,purchase_lot_id,metadata
  ) values(
    p_classroom_id,p_student_id,p_item_id,'TEACHER_GRANT',p_quantity,0,v_lot_id,
    jsonb_build_object(
      'note',p_note,
      'teacher_user_id',auth.uid(),
      'stock_before',v_stock_before,
      'stock_after',v_stock_after,
      'stock_deducted',v_stock_deducted,
      'stock_shortage_quantity',v_shortage,
      'stock_override',coalesce(p_allow_stock_override,false)
    )
  );

  v_quote_after := public.market_item_price_gold(null,p_item_id);
  insert into public.market_price_history(
    classroom_id,item_id,price_gold,stock_quantity,reason,source_ref_id,metadata
  ) values(
    p_classroom_id,p_item_id,v_quote_after,v_stock_after,'TEACHER_GRANT',v_lot_id,
    jsonb_build_object(
      'student_id',p_student_id,
      'quantity',p_quantity,
      'stock_deducted',v_stock_deducted,
      'stock_shortage_quantity',v_shortage,
      'stock_override',coalesce(p_allow_stock_override,false)
    )
  );

  perform public.i1a_sync_market_to_legacy(p_item_id);

  return jsonb_build_object(
    'success',true,
    'lot_id',v_lot_id,
    'owned_quantity',v_owned,
    'stock_before',v_stock_before,
    'stock_deducted',v_stock_deducted,
    'stock_after',v_stock_after,
    'stock_shortage_quantity',v_shortage,
    'stock_override',coalesce(p_allow_stock_override,false),
    'market_quote_after_gold',v_quote_after
  );
end;
$$;

-- Keep the old RPC name safe for any existing callers: it now consumes stock and never silently overrides shortages.
create or replace function public.teacher_grant_inventory_item(
  p_classroom_id integer,
  p_student_id integer,
  p_item_id bigint,
  p_quantity integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.teacher_grant_inventory_item_v2(
    p_classroom_id,p_student_id,p_item_id,p_quantity,p_note,false
  );
end;
$$;

create or replace function public.teacher_revoke_inventory_item_v2(
  p_classroom_id integer,
  p_student_id integer,
  p_item_id bigint,
  p_quantity integer,
  p_note text default null,
  p_restore_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.student_inventory%rowtype;
  v_item public.market_items%rowtype;
  v_needed integer;
  v_take integer;
  v_allocations jsonb := '[]'::jsonb;
  v_stock_before integer;
  v_stock_after integer;
  v_quote_after bigint;
  r record;
begin
  perform public.ensure_teacher_role();
  if public.current_classroom_id() is distinct from p_classroom_id then
    raise exception '다른 학급의 인벤토리를 관리할 수 없습니다.' using errcode = 'P0910';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000 then
    raise exception '회수 수량은 1~1000 범위여야 합니다.' using errcode = 'P0911';
  end if;
  if length(coalesce(p_note,'')) > 500 then
    raise exception '회수 메모는 500자 이하로 입력해주세요.' using errcode = 'P0914';
  end if;

  select * into v_item
  from public.market_items
  where id = p_item_id and classroom_id = p_classroom_id
  for update;
  if v_item.id is null then
    raise exception '해당 학급의 아이템이 아닙니다.' using errcode = 'P0915';
  end if;

  select * into v_inv
  from public.student_inventory
  where student_id = p_student_id and item_id = p_item_id and classroom_id = p_classroom_id
  for update;

  if v_inv.id is null or (v_inv.owned_quantity-v_inv.reserved_quantity) < p_quantity then
    raise exception '회수 가능한 수량이 부족합니다. (사용 가능: %개)', greatest(coalesce(v_inv.owned_quantity,0)-coalesce(v_inv.reserved_quantity,0),0) using errcode = 'P0912';
  end if;

  v_needed := p_quantity;
  for r in
    select id,remaining_quantity,reserved_quantity,resale_eligible,acquisition_source,acquired_at
    from public.inventory_purchase_lots
    where student_id = p_student_id
      and item_id = p_item_id
      and remaining_quantity > reserved_quantity
    order by
      case when acquisition_source = 'TEACHER_GRANT' then 0 else 1 end,
      resale_eligible asc,
      acquired_at desc,
      id desc
    for update
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed,r.remaining_quantity-r.reserved_quantity);
    if v_take <= 0 then continue; end if;
    update public.inventory_purchase_lots
       set remaining_quantity = remaining_quantity-v_take,
           updated_at = now()
     where id = r.id;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'lot_id',r.id,'quantity',v_take,'acquisition_source',r.acquisition_source
    ));
    v_needed := v_needed-v_take;
  end loop;

  if v_needed <> 0 then
    raise exception '회수 Lot 할당에 실패했습니다.' using errcode='P0913';
  end if;

  update public.student_inventory
     set owned_quantity = owned_quantity-p_quantity,
         updated_at = now()
   where id = v_inv.id;

  v_stock_before := v_item.current_stock;
  if coalesce(p_restore_stock,false) then
    update public.market_items
       set current_stock = current_stock+p_quantity,
           updated_at = now()
     where id = p_item_id
     returning current_stock into v_stock_after;
  else
    v_stock_after := v_stock_before;
  end if;

  insert into public.inventory_events(
    classroom_id,student_id,item_id,event_type,quantity_delta,reserved_delta,metadata
  ) values(
    p_classroom_id,p_student_id,p_item_id,'TEACHER_REVOKE',-p_quantity,0,
    jsonb_build_object(
      'note',p_note,
      'teacher_user_id',auth.uid(),
      'lot_allocations',v_allocations,
      'restore_stock',coalesce(p_restore_stock,false),
      'stock_before',v_stock_before,
      'stock_after',v_stock_after
    )
  );

  if coalesce(p_restore_stock,false) then
    v_quote_after := public.market_item_price_gold(null,p_item_id);
    insert into public.market_price_history(
      classroom_id,item_id,price_gold,stock_quantity,reason,metadata
    ) values(
      p_classroom_id,p_item_id,v_quote_after,v_stock_after,'TEACHER_REVOKE',
      jsonb_build_object('student_id',p_student_id,'quantity',p_quantity,'restore_stock',true)
    );
    perform public.i1a_sync_market_to_legacy(p_item_id);
  else
    v_quote_after := public.market_item_price_gold(null,p_item_id);
  end if;

  return jsonb_build_object(
    'success',true,
    'revoked_quantity',p_quantity,
    'restore_stock',coalesce(p_restore_stock,false),
    'stock_before',v_stock_before,
    'stock_after',v_stock_after,
    'market_quote_after_gold',v_quote_after
  );
end;
$$;

-- Legacy caller keeps delete-only semantics; the new UI calls v2 explicitly with the chosen mode.
create or replace function public.teacher_revoke_inventory_item(
  p_classroom_id integer,
  p_student_id integer,
  p_item_id bigint,
  p_quantity integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.teacher_revoke_inventory_item_v2(
    p_classroom_id,p_student_id,p_item_id,p_quantity,p_note,false
  );
end;
$$;

create or replace function public.teacher_get_student_inventory(
  p_classroom_id integer,
  p_student_id integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student jsonb;
  v_rows jsonb;
begin
  perform public.ensure_teacher_role();
  if public.current_classroom_id() is distinct from p_classroom_id then
    raise exception '다른 학급의 인벤토리를 조회할 수 없습니다.' using errcode='P0920';
  end if;

  select jsonb_build_object('id',s.id,'name',s.name,'brand_name',s.brand_name)
    into v_student
  from public.students s
  where s.id=p_student_id and s.classroom_id=p_classroom_id and s.transferred_at is null;

  if v_student is null then
    raise exception '해당 학급의 활성 학생이 아닙니다.' using errcode='P0921';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id',mi.id,
    'name',mi.name,
    'description',mi.description,
    'image_url',mi.image_url,
    'item_type',mi.item_type,
    'use_mode',mi.use_mode,
    'is_active',mi.is_active,
    'is_archived',mi.is_archived,
    'current_stock',mi.current_stock,
    'owned_quantity',si.owned_quantity,
    'reserved_quantity',si.reserved_quantity,
    'available_quantity',si.owned_quantity-si.reserved_quantity
  ) order by mi.name,mi.id),'[]'::jsonb)
  into v_rows
  from public.student_inventory si
  join public.market_items mi on mi.id=si.item_id
  where si.classroom_id=p_classroom_id
    and si.student_id=p_student_id
    and si.owned_quantity>0;

  return jsonb_build_object(
    'classroom_id',p_classroom_id,
    'student',v_student,
    'items',v_rows
  );
end;
$$;

create or replace function public.student_get_snack_exchange_options(
  p_ticket_item_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer := public.current_student_id();
  v_classroom_id integer;
  v_ticket public.market_items%rowtype;
  v_available integer := 0;
  v_rows jsonb;
begin
  if auth.uid() is null or v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='P0930';
  end if;

  select classroom_id into v_classroom_id
  from public.students
  where id=v_student_id and transferred_at is null;

  select * into v_ticket
  from public.market_items
  where id=p_ticket_item_id;

  if v_ticket.id is null or v_ticket.classroom_id<>v_classroom_id
     or v_ticket.item_type<>'TICKET' or v_ticket.use_mode<>'SNACK_EXCHANGE' then
    raise exception '간식 교환권을 찾을 수 없습니다.' using errcode='P0931';
  end if;

  select greatest(coalesce(si.owned_quantity,0)-coalesce(si.reserved_quantity,0),0)
    into v_available
  from public.student_inventory si
  where si.student_id=v_student_id and si.item_id=p_ticket_item_id;
  v_available := coalesce(v_available,0);

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id',mi.id,
    'name',mi.name,
    'description',mi.description,
    'image_url',mi.image_url,
    'current_stock',mi.current_stock
  ) order by mi.name,mi.id),'[]'::jsonb)
  into v_rows
  from public.market_items mi
  where mi.classroom_id=v_classroom_id
    and mi.item_type='SNACK'
    and mi.is_active=true
    and mi.is_archived=false
    and mi.current_stock>0;

  return jsonb_build_object(
    'ticket_item_id',p_ticket_item_id,
    'available_ticket_quantity',v_available,
    'items',v_rows
  );
end;
$$;

create or replace function public.exchange_snack_ticket(
  p_ticket_item_id bigint,
  p_snack_item_id bigint,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer := public.current_student_id();
  v_classroom_id integer;
  v_ticket public.market_items%rowtype;
  v_snack public.market_items%rowtype;
  v_inv public.student_inventory%rowtype;
  v_needed integer;
  v_take integer;
  v_allocations jsonb := '[]'::jsonb;
  v_lot_id bigint;
  v_snack_owned integer;
  v_ticket_event_id bigint;
  v_snack_event_id bigint;
  v_stock_before integer;
  v_stock_after integer;
  v_quote_after bigint;
  r record;
begin
  if auth.uid() is null or v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='P0940';
  end if;
  if p_quantity is null or p_quantity<1 or p_quantity>100 then
    raise exception '교환 수량은 1~100개여야 합니다.' using errcode='P0941';
  end if;
  if p_ticket_item_id=p_snack_item_id then
    raise exception '교환 대상 상품을 확인해주세요.' using errcode='P0942';
  end if;

  if not pg_try_advisory_xact_lock(28102,v_student_id) then
    raise exception '현재 다른 인벤토리 처리가 진행 중입니다. 잠시 후 다시 시도해주세요.' using errcode='P0943';
  end if;

  select classroom_id into v_classroom_id
  from public.students
  where id=v_student_id and transferred_at is null;
  if v_classroom_id is null then
    raise exception '활성 학생 정보를 찾을 수 없습니다.' using errcode='P0944';
  end if;

  perform 1
  from public.market_items
  where id in (p_ticket_item_id,p_snack_item_id)
  order by id
  for update;

  select * into v_ticket from public.market_items where id=p_ticket_item_id;
  select * into v_snack from public.market_items where id=p_snack_item_id;

  if v_ticket.id is null or v_ticket.classroom_id<>v_classroom_id
     or v_ticket.item_type<>'TICKET' or v_ticket.use_mode<>'SNACK_EXCHANGE' then
    raise exception '사용 가능한 간식 교환권이 아닙니다.' using errcode='P0945';
  end if;
  if v_snack.id is null or v_snack.classroom_id<>v_classroom_id
     or v_snack.item_type<>'SNACK' or v_snack.is_archived or not v_snack.is_active then
    raise exception '교환할 수 없는 간식 상품입니다.' using errcode='P0946';
  end if;
  if v_snack.current_stock<p_quantity then
    raise exception '선택한 간식의 재고가 부족합니다. (현재 재고: %개)',v_snack.current_stock using errcode='P0947';
  end if;

  select * into v_inv
  from public.student_inventory
  where student_id=v_student_id and item_id=p_ticket_item_id
  for update;
  if v_inv.id is null or (v_inv.owned_quantity-v_inv.reserved_quantity)<p_quantity then
    raise exception '간식 교환권 수량이 부족합니다.' using errcode='P0948';
  end if;

  v_needed := p_quantity;
  for r in
    select id,remaining_quantity,reserved_quantity,resale_eligible,acquired_at
    from public.inventory_purchase_lots
    where student_id=v_student_id
      and item_id=p_ticket_item_id
      and remaining_quantity>reserved_quantity
    order by resale_eligible asc, acquired_at, id
    for update
  loop
    exit when v_needed<=0;
    v_take:=least(v_needed,r.remaining_quantity-r.reserved_quantity);
    if v_take<=0 then continue; end if;
    update public.inventory_purchase_lots
       set remaining_quantity=remaining_quantity-v_take,
           updated_at=now()
     where id=r.id;
    v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('lot_id',r.id,'quantity',v_take));
    v_needed:=v_needed-v_take;
  end loop;
  if v_needed<>0 then
    raise exception '교환권 Lot 할당에 실패했습니다.' using errcode='P0949';
  end if;

  update public.student_inventory
     set owned_quantity=owned_quantity-p_quantity,
         updated_at=now()
   where id=v_inv.id;

  v_stock_before:=v_snack.current_stock;
  update public.market_items
     set current_stock=current_stock-p_quantity,
         updated_at=now()
   where id=p_snack_item_id
   returning current_stock into v_stock_after;

  insert into public.student_inventory(classroom_id,student_id,item_id,owned_quantity,reserved_quantity)
  values(v_classroom_id,v_student_id,p_snack_item_id,p_quantity,0)
  on conflict(student_id,item_id) do update
    set owned_quantity=public.student_inventory.owned_quantity+excluded.owned_quantity,
        classroom_id=excluded.classroom_id,
        updated_at=now()
  returning owned_quantity into v_snack_owned;

  insert into public.inventory_purchase_lots(
    classroom_id,student_id,item_id,acquisition_source,
    original_quantity,remaining_quantity,reserved_quantity,
    unit_paid_gold,resale_eligible,source_ref_type,source_ref_id,metadata
  ) values(
    v_classroom_id,v_student_id,p_snack_item_id,'TICKET_EXCHANGE',
    p_quantity,p_quantity,0,
    null,false,'SNACK_EXCHANGE',p_ticket_item_id,
    jsonb_build_object('ticket_item_id',p_ticket_item_id,'ticket_name',v_ticket.name)
  ) returning id into v_lot_id;

  insert into public.inventory_events(
    classroom_id,student_id,item_id,event_type,quantity_delta,reserved_delta,metadata
  ) values(
    v_classroom_id,v_student_id,p_ticket_item_id,'USE',-p_quantity,0,
    jsonb_build_object(
      'use_mode','SNACK_EXCHANGE',
      'target_item_id',p_snack_item_id,
      'target_item_name',v_snack.name,
      'lot_allocations',v_allocations
    )
  ) returning id into v_ticket_event_id;

  insert into public.inventory_events(
    classroom_id,student_id,item_id,event_type,quantity_delta,reserved_delta,purchase_lot_id,metadata
  ) values(
    v_classroom_id,v_student_id,p_snack_item_id,'TICKET_EXCHANGE',p_quantity,0,v_lot_id,
    jsonb_build_object(
      'ticket_item_id',p_ticket_item_id,
      'ticket_name',v_ticket.name,
      'ticket_event_id',v_ticket_event_id
    )
  ) returning id into v_snack_event_id;

  v_quote_after:=public.market_item_price_gold(null,p_snack_item_id);
  insert into public.market_price_history(
    classroom_id,item_id,price_gold,stock_quantity,reason,source_ref_id,metadata
  ) values(
    v_classroom_id,p_snack_item_id,v_quote_after,v_stock_after,'TICKET_EXCHANGE',v_snack_event_id,
    jsonb_build_object('student_id',v_student_id,'ticket_item_id',p_ticket_item_id,'quantity',p_quantity)
  );

  perform public.i1a_sync_market_to_legacy(p_snack_item_id);

  return jsonb_build_object(
    'success',true,
    'ticket_item_id',p_ticket_item_id,
    'snack_item_id',p_snack_item_id,
    'snack_name',v_snack.name,
    'quantity',p_quantity,
    'snack_owned_quantity',v_snack_owned,
    'stock_before',v_stock_before,
    'stock_after',v_stock_after,
    'market_quote_after_gold',v_quote_after
  );
end;
$$;

revoke all on function public.teacher_grant_inventory_item_v2(integer,integer,bigint,integer,text,boolean) from public;
revoke all on function public.teacher_revoke_inventory_item_v2(integer,integer,bigint,integer,text,boolean) from public;
revoke all on function public.teacher_get_student_inventory(integer,integer) from public;
revoke all on function public.student_get_snack_exchange_options(bigint) from public;
revoke all on function public.exchange_snack_ticket(bigint,bigint,integer) from public;

grant execute on function public.teacher_grant_inventory_item_v2(integer,integer,bigint,integer,text,boolean) to authenticated;
grant execute on function public.teacher_revoke_inventory_item_v2(integer,integer,bigint,integer,text,boolean) to authenticated;
grant execute on function public.teacher_get_student_inventory(integer,integer) to authenticated;
grant execute on function public.student_get_snack_exchange_options(bigint) to authenticated;
grant execute on function public.exchange_snack_ticket(bigint,bigint,integer) to authenticated;
