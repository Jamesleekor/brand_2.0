alter table public.character_recruitment_offers
  add column if not exists discount_rate integer not null default 0,
  add column if not exists discount_start_at timestamptz,
  add column if not exists discount_end_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.character_recruitment_offers'::regclass
      and conname='character_recruitment_offer_discount_rate_range'
  ) then
    alter table public.character_recruitment_offers
      add constraint character_recruitment_offer_discount_rate_range
      check (discount_rate between 0 and 99);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.character_recruitment_offers'::regclass
      and conname='character_recruitment_offer_discount_window'
  ) then
    alter table public.character_recruitment_offers
      add constraint character_recruitment_offer_discount_window
      check (
        discount_rate = 0
        or (
          acquisition_mode = 'CRYSTAL'
          and discount_start_at is not null
          and discount_end_at is not null
          and discount_start_at < discount_end_at
        )
      );
  end if;
end;
$$;

comment on column public.character_recruitment_offers.discount_rate is
  'Period promotion discount percent, integer 0-99. 0 means no promotion.';
comment on column public.character_recruitment_offers.discount_start_at is
  'Promotion start timestamp. Preserved after natural expiration.';
comment on column public.character_recruitment_offers.discount_end_at is
  'Promotion end timestamp (exclusive). Preserved after natural expiration.';

create or replace function public.character_recruitment_price_crystal(
  p_student_id integer,
  p_offer_id bigint
)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base_price bigint;
  v_offer_discount_rate integer;
  v_promotional_price bigint;
  v_collection_discount_pp numeric;
begin
  if p_student_id is null or p_offer_id is null then
    return null;
  end if;

  select
    o.base_price_crystal,
    case
      when o.acquisition_mode='CRYSTAL'
       and o.discount_rate between 1 and 99
       and o.discount_start_at is not null
       and o.discount_end_at is not null
       and now() >= o.discount_start_at
       and now() < o.discount_end_at
      then o.discount_rate
      else 0
    end
  into v_base_price, v_offer_discount_rate
  from public.character_recruitment_offers o
  where o.id=p_offer_id;

  if v_base_price is null then
    return null;
  end if;

  if v_base_price <= 0 then
    return 0;
  end if;

  v_promotional_price := greatest(
    1::bigint,
    floor(
      v_base_price::numeric
      * (100::numeric-v_offer_discount_rate::numeric)
      / 100::numeric
    )::bigint
  );

  v_collection_discount_pp := least(
    100::numeric,
    greatest(
      0::numeric,
      coalesce(
        public.collection_buff_value(p_student_id,'SHOP_DISCOUNT_PP'),
        0::numeric
      )
    )
  );

  return greatest(
    1::bigint,
    floor(
      v_promotional_price::numeric
      * (100::numeric-v_collection_discount_pp)
      / 100::numeric
    )::bigint
  );
end;
$function$;

revoke execute on function public.character_recruitment_price_crystal(integer,bigint)
  from public, anon, authenticated;
grant execute on function public.character_recruitment_price_crystal(integer,bigint)
  to service_role;

create or replace function public.get_my_character_recruitment_store_v2()
returns table(
  character_id bigint,
  acquisition_mode text,
  base_price_crystal bigint,
  promotion_price_crystal bigint,
  effective_price_crystal bigint,
  discount_rate integer,
  discount_start_at timestamptz,
  discount_end_at timestamptz,
  discount_status text,
  offer_active boolean,
  is_eligible boolean,
  can_self_recruit boolean,
  availability_code text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with student_context as (
    select s.classroom_id
    from public.students s
    where s.id=public.current_student_id()
      and s.transferred_at is null
      and s.role::text='STUDENT'
    limit 1
  )
  select
    base.character_id,
    base.acquisition_mode,
    base.base_price_crystal,
    case
      when o.id is null then null::bigint
      when o.base_price_crystal <= 0 then 0::bigint
      when o.acquisition_mode='CRYSTAL'
       and o.discount_rate between 1 and 99
       and o.discount_start_at is not null
       and o.discount_end_at is not null
       and now() >= o.discount_start_at
       and now() < o.discount_end_at
      then greatest(
        1::bigint,
        floor(
          o.base_price_crystal::numeric
          * (100::numeric-o.discount_rate::numeric)
          / 100::numeric
        )::bigint
      )
      else o.base_price_crystal
    end as promotion_price_crystal,
    base.effective_price_crystal,
    coalesce(o.discount_rate,0) as discount_rate,
    o.discount_start_at,
    o.discount_end_at,
    case
      when o.id is null or coalesce(o.discount_rate,0)=0 then 'NONE'
      when o.discount_start_at is null or o.discount_end_at is null then 'NONE'
      when now() < o.discount_start_at then 'SCHEDULED'
      when now() >= o.discount_end_at then 'ENDED'
      else 'ACTIVE'
    end as discount_status,
    base.offer_active,
    base.is_eligible,
    base.can_self_recruit,
    base.availability_code
  from public.get_my_character_recruitment_store() base
  left join student_context sc on true
  left join public.character_recruitment_offers o
    on o.classroom_id=sc.classroom_id
   and o.character_id=base.character_id;
$function$;

revoke execute on function public.get_my_character_recruitment_store_v2()
  from public, anon;
grant execute on function public.get_my_character_recruitment_store_v2()
  to authenticated, service_role;

create or replace function public.teacher_get_character_recruitment_store_board_v2(
  p_classroom_id integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_board jsonb;
  v_characters jsonb;
begin
  v_board := public.teacher_get_character_recruitment_store_board(p_classroom_id);

  select coalesce(
    jsonb_agg(
      case
        when item.value->'offer' = 'null'::jsonb then item.value
        else jsonb_set(
          item.value,
          '{offer}',
          (item.value->'offer') || jsonb_build_object(
            'promotion_price_crystal',
              case
                when o.base_price_crystal <= 0 then 0::bigint
                when o.acquisition_mode='CRYSTAL'
                 and o.discount_rate between 1 and 99
                 and o.discount_start_at is not null
                 and o.discount_end_at is not null
                 and now() >= o.discount_start_at
                 and now() < o.discount_end_at
                then greatest(
                  1::bigint,
                  floor(
                    o.base_price_crystal::numeric
                    * (100::numeric-o.discount_rate::numeric)
                    / 100::numeric
                  )::bigint
                )
                else o.base_price_crystal
              end,
            'discount_rate',o.discount_rate,
            'discount_start_at',o.discount_start_at,
            'discount_end_at',o.discount_end_at,
            'discount_status',
              case
                when coalesce(o.discount_rate,0)=0 then 'NONE'
                when o.discount_start_at is null or o.discount_end_at is null then 'NONE'
                when now() < o.discount_start_at then 'SCHEDULED'
                when now() >= o.discount_end_at then 'ENDED'
                else 'ACTIVE'
              end
          ),
          true
        )
      end
      order by item.ord
    ),
    '[]'::jsonb
  )
  into v_characters
  from jsonb_array_elements(v_board->'characters') with ordinality as item(value,ord)
  left join public.character_recruitment_offers o
    on o.classroom_id=p_classroom_id
   and o.character_id=(item.value->>'character_id')::bigint;

  return jsonb_set(v_board,'{characters}',v_characters,true);
end;
$function$;

revoke execute on function public.teacher_get_character_recruitment_store_board_v2(integer)
  from public, anon;
grant execute on function public.teacher_get_character_recruitment_store_board_v2(integer)
  to authenticated, service_role;

create or replace function public.teacher_set_character_recruitment_offer_v2(
  p_classroom_id integer,
  p_character_id bigint,
  p_acquisition_mode text,
  p_base_price_crystal bigint,
  p_is_active boolean,
  p_notes text,
  p_discount_rate integer,
  p_discount_start_at timestamptz,
  p_discount_end_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_offer_id bigint;
begin
  p_discount_rate := coalesce(p_discount_rate,0);

  if p_discount_rate < 0 or p_discount_rate > 99 then
    raise exception '할인율은 0~99%% 사이여야 합니다.' using errcode='P0918';
  end if;

  if p_discount_rate > 0 then
    if upper(btrim(coalesce(p_acquisition_mode,''))) <> 'CRYSTAL' then
      raise exception '기간 할인은 크리스탈 영입에만 설정할 수 있습니다.' using errcode='P0919';
    end if;
    if p_discount_start_at is null or p_discount_end_at is null then
      raise exception '할인 시작일시와 종료일시를 모두 입력해주세요.' using errcode='P0920';
    end if;
    if p_discount_start_at >= p_discount_end_at then
      raise exception '할인 종료일시는 시작일시보다 늦어야 합니다.' using errcode='P0921';
    end if;
  else
    p_discount_start_at := null;
    p_discount_end_at := null;
  end if;

  v_offer_id := public.teacher_set_character_recruitment_offer(
    p_classroom_id,
    p_character_id,
    p_acquisition_mode,
    p_base_price_crystal,
    p_is_active,
    p_notes
  );

  update public.character_recruitment_offers o
  set discount_rate=p_discount_rate,
      discount_start_at=p_discount_start_at,
      discount_end_at=p_discount_end_at,
      updated_at=now()
  where o.id=v_offer_id;

  return v_offer_id;
end;
$function$;

revoke execute on function public.teacher_set_character_recruitment_offer_v2(
  integer,bigint,text,bigint,boolean,text,integer,timestamptz,timestamptz
) from public, anon;
grant execute on function public.teacher_set_character_recruitment_offer_v2(
  integer,bigint,text,bigint,boolean,text,integer,timestamptz,timestamptz
) to authenticated, service_role;
