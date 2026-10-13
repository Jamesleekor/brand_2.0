-- Keep availability of owned cosmetics separate from public market listing.
alter table public.cosmetic_items
  add column if not exists is_market_visible boolean not null default true;

-- Story/CG rewards have no sale price yet. Luxury items use their own gated shop.
update public.cosmetic_items ci
set is_market_visible = false
where (lower(ci.category) = 'background'
       and not exists (
         select 1 from public.cosmetic_item_pricings cp
         where cp.item_id = ci.id and cp.is_active
       ))
   or exists (
     select 1 from public.expedition_luxury_catalog lc
     where lc.cosmetic_item_id = ci.id
   );

-- Newly added CGs need an explicit price and publication decision.
alter table public.cosmetic_items alter column is_market_visible set default false;

create or replace function public._cosmetic_market_purchase_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.obtained_via = 'PURCHASE'::public.cosmetic_obtained_via
     and not exists (
       select 1 from public.cosmetic_items ci
       where ci.id = new.item_id
         and (ci.is_market_visible or exists (
           select 1 from public.expedition_luxury_catalog lc
           where lc.cosmetic_item_id = ci.id and lc.is_active
         ))
     ) then
    raise exception '현재 상점에 공개되지 않은 아이템입니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists cosmetic_market_purchase_guard on public.student_cosmetic_ownerships;
create trigger cosmetic_market_purchase_guard
before insert on public.student_cosmetic_ownerships
for each row execute function public._cosmetic_market_purchase_guard();

create or replace function public.teacher_set_cosmetic_price(
  p_classroom_id integer, p_item_id integer, p_value_token text, p_price integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.value_token_type;
  v_pricing_id integer;
begin
  perform public.character_teacher_require_classroom(p_classroom_id);
  if p_price is null or p_price < 1 or p_price > 100000000 then
    raise exception '가격은 1~100,000,000 사이여야 합니다.' using errcode = '22023';
  end if;
  if p_value_token not in ('GOLD', 'BV', 'CRYSTAL') then
    raise exception '지원하지 않는 화폐입니다.' using errcode = '22023';
  end if;
  v_token := p_value_token::public.value_token_type;
  perform 1 from public.cosmetic_items ci
  where ci.id = p_item_id
    and (ci.classroom_id is null or ci.classroom_id = p_classroom_id)
    and (lower(ci.category) = 'background' or exists (
      select 1 from public.expedition_luxury_catalog lc
      where lc.cosmetic_item_id = ci.id
    ))
  for update;
  if not found then
    raise exception '이 학급에서 가격을 설정할 수 없는 아이템입니다.' using errcode = '42501';
  end if;

  select cp.id into v_pricing_id
  from public.cosmetic_item_pricings cp
  where cp.item_id = p_item_id and cp.value_token = v_token
    and cp.condition_type = 'NONE'::public.cosmetic_condition_type
    and coalesce(cp.secondary_condition_type, 'NONE'::public.cosmetic_condition_type) = 'NONE'::public.cosmetic_condition_type
  order by cp.is_active desc, cp.id
  limit 1 for update;

  if v_pricing_id is null then
    insert into public.cosmetic_item_pricings(item_id, value_token, price, is_active)
    values (p_item_id, v_token, p_price, true)
    returning id into v_pricing_id;
  else
    update public.cosmetic_item_pricings
    set price = p_price, is_active = true
    where id = v_pricing_id;
  end if;
  return jsonb_build_object('pricing_id', v_pricing_id, 'item_id', p_item_id,
                            'value_token', v_token, 'price', p_price);
end;
$$;

create or replace function public.teacher_set_cosmetic_market_visibility(
  p_classroom_id integer, p_item_id integer, p_visible boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.character_teacher_require_classroom(p_classroom_id);
  if p_visible is null then
    raise exception '공개 상태를 선택하세요.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cosmetic_items ci
    where ci.id = p_item_id and lower(ci.category) = 'background'
      and (ci.classroom_id is null or ci.classroom_id = p_classroom_id)
  ) then
    raise exception '이 학급에서 상점 공개를 설정할 수 없는 배경이 아닙니다.' using errcode = '42501';
  end if;
  if p_visible and not exists (
    select 1 from public.cosmetic_items ci
    join public.cosmetic_item_pricings cp on cp.item_id = ci.id
    where ci.id = p_item_id and ci.is_active and cp.is_active
  ) then
    raise exception '판매 가격을 먼저 설정하세요.' using errcode = '22023';
  end if;
  update public.cosmetic_items
  set is_market_visible = p_visible, updated_at = now()
  where id = p_item_id;
  return jsonb_build_object('item_id', p_item_id, 'is_market_visible', p_visible);
end;
$$;

create or replace function public.teacher_get_expedition_luxury_admin_board(
  p_classroom_id integer
) returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.character_teacher_require_classroom(p_classroom_id);
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', ci.id, 'name', ci.name, 'item_uid', ci.item_uid,
        'category', ci.category, 'luxury_group', lc.luxury_group,
        'is_active', ci.is_active and lc.is_active,
        'pricings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', cp.id, 'value_token', cp.value_token, 'price', cp.price
          ) order by cp.id)
          from public.cosmetic_item_pricings cp
          where cp.item_id = ci.id and cp.is_active
        ), '[]'::jsonb)
      ) order by lc.required_effect_level, ci.name, ci.id)
      from public.expedition_luxury_catalog lc
      join public.cosmetic_items ci on ci.id = lc.cosmetic_item_id
      where ci.classroom_id is null or ci.classroom_id = p_classroom_id
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.name, 'brand_name', s.brand_name
      ) order by s.name, s.id)
      from public.students s
      where s.classroom_id = p_classroom_id and s.transferred_at is null
        and s.role in ('STUDENT','STUDENT_LEADER','GUARD')
    ), '[]'::jsonb),
    'ownerships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', sco.student_id, 'item_id', sco.item_id,
        'obtained_via', sco.obtained_via::text
      ) order by sco.student_id, sco.item_id)
      from public.student_cosmetic_ownerships sco
      join public.students s on s.id = sco.student_id
      join public.expedition_luxury_catalog lc on lc.cosmetic_item_id = sco.item_id
      join public.cosmetic_items ci on ci.id = sco.item_id
      where s.classroom_id = p_classroom_id and s.transferred_at is null
        and (ci.classroom_id is null or ci.classroom_id = p_classroom_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.teacher_grant_expedition_luxury_item(
  p_classroom_id integer, p_student_id integer, p_item_id integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ownership_id bigint;
  v_inserted boolean := false;
begin
  perform public.character_teacher_require_classroom(p_classroom_id);
  if not exists (
    select 1 from public.students s where s.id = p_student_id
      and s.classroom_id = p_classroom_id and s.transferred_at is null
      and s.role in ('STUDENT','STUDENT_LEADER','GUARD')
  ) then
    raise exception '이 학급의 재학 학생이 아닙니다.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.expedition_luxury_catalog lc
    join public.cosmetic_items ci on ci.id = lc.cosmetic_item_id
    where ci.id = p_item_id
      and (ci.classroom_id is null or ci.classroom_id = p_classroom_id)
  ) then
    raise exception '명품관 아이템을 찾을 수 없습니다.' using errcode = '42501';
  end if;
  insert into public.student_cosmetic_ownerships(
    student_id, item_id, obtained_via, is_equipped
  ) values (
    p_student_id, p_item_id, 'TEACHER_GRANT'::public.cosmetic_obtained_via, false
  ) on conflict (student_id, item_id) do nothing
  returning id into v_ownership_id;
  v_inserted := v_ownership_id is not null;
  if not v_inserted then
    select id into v_ownership_id from public.student_cosmetic_ownerships
    where student_id = p_student_id and item_id = p_item_id;
  end if;
  return jsonb_build_object('ownership_id', v_ownership_id,
    'already_owned', not v_inserted, 'student_id', p_student_id, 'item_id', p_item_id);
end;
$$;

revoke all on function public._cosmetic_market_purchase_guard() from public, anon, authenticated;
revoke all on function public.teacher_set_cosmetic_price(integer,integer,text,integer) from public, anon;
revoke all on function public.teacher_set_cosmetic_market_visibility(integer,integer,boolean) from public, anon;
revoke all on function public.teacher_get_expedition_luxury_admin_board(integer) from public, anon;
revoke all on function public.teacher_grant_expedition_luxury_item(integer,integer,integer) from public, anon;
grant execute on function public.teacher_set_cosmetic_price(integer,integer,text,integer) to authenticated;
grant execute on function public.teacher_set_cosmetic_market_visibility(integer,integer,boolean) to authenticated;
grant execute on function public.teacher_get_expedition_luxury_admin_board(integer) to authenticated;
grant execute on function public.teacher_grant_expedition_luxury_item(integer,integer,integer) to authenticated;
