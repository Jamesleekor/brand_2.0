-- Keep pricing history while removing purchase options from both shops.
create or replace function public.teacher_reset_cosmetic_price(
  p_classroom_id integer,
  p_item_id integer,
  p_pricing_id integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.cosmetic_items%rowtype;
  v_count integer;
  v_visible boolean;
begin
  perform public.character_teacher_require_classroom(p_classroom_id);

  select * into v_item
  from public.cosmetic_items ci
  where ci.id = p_item_id
    and (ci.classroom_id is null or ci.classroom_id = p_classroom_id)
    and (lower(ci.category) = 'background' or exists (
      select 1 from public.expedition_luxury_catalog lc
      where lc.cosmetic_item_id = ci.id
    ))
  for update;

  if v_item.id is null then
    raise exception '이 학급에서 가격을 초기화할 수 없는 아이템입니다.' using errcode = '42501';
  end if;

  if p_pricing_id is not null and not exists (
    select 1 from public.cosmetic_item_pricings cp
    where cp.id = p_pricing_id and cp.item_id = p_item_id and cp.is_active
  ) then
    raise exception '활성 가격 옵션을 찾을 수 없습니다.' using errcode = '22023';
  end if;

  update public.cosmetic_item_pricings cp
  set is_active = false
  where cp.item_id = p_item_id and cp.is_active
    and (p_pricing_id is null or cp.id = p_pricing_id);
  get diagnostics v_count = row_count;

  -- An unpriced background must not remain listed in the student market.
  if lower(v_item.category) = 'background' and not exists (
    select 1 from public.cosmetic_item_pricings cp
    where cp.item_id = p_item_id and cp.is_active
  ) then
    update public.cosmetic_items ci
    set is_market_visible = false, updated_at = now()
    where ci.id = p_item_id;
  end if;

  select ci.is_market_visible into v_visible
  from public.cosmetic_items ci where ci.id = p_item_id;

  return jsonb_build_object(
    'item_id', p_item_id,
    'deactivated_count', v_count,
    'is_market_visible', v_visible
  );
end;
$$;

revoke all on function public.teacher_reset_cosmetic_price(integer,integer,integer) from public, anon;
grant execute on function public.teacher_reset_cosmetic_price(integer,integer,integer) to authenticated;
