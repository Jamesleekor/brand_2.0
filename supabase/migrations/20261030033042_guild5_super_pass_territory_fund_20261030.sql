-- Guild5 territory fund: include only actually consumed SUPER PASS value.
-- SUPER PASS equivalents:
--   자리 2000G / 1인1역 2500G / 급식순서 1500G
-- Important: territory tax remains based on actual GOLD auction spend only.

alter table public.guild5_territory_economy_snapshots
  add column if not exists auction_gold_spend bigint not null default 0,
  add column if not exists super_pass_consumed_count integer not null default 0,
  add column if not exists super_pass_equivalent_value bigint not null default 0;

comment on column public.guild5_territory_economy_snapshots.auction_gold_spend
  is 'Actual GOLD paid in settled auction results. Territory tax remains based on this amount.';
comment on column public.guild5_territory_economy_snapshots.super_pass_consumed_count
  is 'Count of auction SUPER PASS entries with WINNER_CONSUMED for this category/auction.';
comment on column public.guild5_territory_economy_snapshots.super_pass_equivalent_value
  is 'Territory-fund equivalent value of actually consumed SUPER PASS items. Seat 2000, primary job 2500, lunch order 1500 GOLD-equivalent.';

create or replace function public.guild5_super_pass_unit_value(p_category text)
returns bigint
language sql
immutable
as $function$
  select case p_category
    when '자리' then 2000::bigint
    when '1인1역' then 2500::bigint
    when '급식순서' then 1500::bigint
    else 0::bigint
  end;
$function$;

create or replace function public.guild5_build_territory_auction_economy(
  p_classroom_id integer,
  p_season_id integer
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_auction public.auctions%rowtype;
  v_result jsonb;
begin
  select a.* into v_auction
  from public.auctions a
  where a.classroom_id=p_classroom_id
    and a.status='COMPLETED'
    and not exists (
      select 1
      from public.guild5_territory_economy_snapshots es
      where es.classroom_id=p_classroom_id
        and es.auction_id=a.id
    )
    and 3 = (
      select count(distinct i.category)::integer
      from public.auction_items i
      join public.auction_results r on r.auction_item_id=i.id
      join public.transactions tx on tx.id=r.transaction_id
      where i.auction_id=a.id
        and i.category in ('자리','1인1역','급식순서')
        and tx.value_token='GOLD'
        and tx.amount<0
        and not tx.is_reversed
    )
  order by coalesce(a.ended_at,a.started_at,a.created_at) desc,a.id desc
  limit 1;

  with slots(slot_no,auction_category,pass_unit_value) as (
    values
      (1::smallint,'1인1역'::text,2500::bigint),
      (2::smallint,'자리'::text,2000::bigint),
      (3::smallint,'급식순서'::text,1500::bigint)
  ),
  totals as (
    select i.category::text as auction_category,
           count(r.id)::integer as settled_item_count,
           coalesce(sum(r.final_price),0)::bigint as auction_gold_spend
    from public.auction_items i
    join public.auction_results r on r.auction_item_id=i.id
    join public.transactions tx on tx.id=r.transaction_id
    where v_auction.id is not null
      and i.auction_id=v_auction.id
      and i.category in ('자리','1인1역','급식순서')
      and tx.value_token='GOLD'
      and tx.amount<0
      and not tx.is_reversed
    group by i.category
  ),
  passes as (
    select i.category::text as auction_category,
           count(e.id)::integer as super_pass_consumed_count
    from public.auction_super_pass_entries e
    join public.auction_items i on i.id=e.auction_item_id
    where v_auction.id is not null
      and i.auction_id=v_auction.id
      and i.category in ('자리','1인1역','급식순서')
      and e.status='WINNER_CONSUMED'
    group by i.category
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'slot_no',s.slot_no,
      'territory_id',t.id,
      'territory_name',t.territory_name,
      'territory_description',t.description,
      'tax_rate_percent',t.tax_rate_percent,
      'auction_category',s.auction_category,
      'auction_id',v_auction.id,
      'auction_round_number',v_auction.round_number,
      'auction_school_year',v_auction.school_year,
      'auction_ended_at',v_auction.ended_at,
      'settled_item_count',coalesce(x.settled_item_count,0),
      'auction_gold_spend',coalesce(x.auction_gold_spend,0),
      'super_pass_consumed_count',coalesce(p.super_pass_consumed_count,0),
      'super_pass_equivalent_value',coalesce(p.super_pass_consumed_count,0)::bigint*s.pass_unit_value,
      'gross_spend',coalesce(x.auction_gold_spend,0)
        + coalesce(p.super_pass_consumed_count,0)::bigint*s.pass_unit_value,
      'projected_revenue',round(
        coalesce(x.auction_gold_spend,0)::numeric
        * coalesce(t.tax_rate_percent,0)::numeric / 100, 2
      )
    )
    order by s.slot_no
  ),'[]'::jsonb)
  into v_result
  from slots s
  left join public.guild5_territories t
    on t.classroom_id=p_classroom_id
   and t.season_id=p_season_id
   and t.slot_no=s.slot_no
  left join totals x on x.auction_category=s.auction_category
  left join passes p on p.auction_category=s.auction_category;

  return v_result;
end;
$function$;

create or replace function public.guild5_capture_territory_auction_economy_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_closure public.guild5_month_closures%rowtype;
  v_item jsonb;
begin
  select * into v_closure
  from public.guild5_month_closures c
  where c.id=NEW.closure_id;

  if v_closure.id is null then
    raise exception '[G5 ECON] closure not found for version %.',NEW.id;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(
      public.guild5_build_territory_auction_economy(v_closure.classroom_id,v_closure.season_id)
    )
  loop
    insert into public.guild5_territory_economy_snapshots(
      version_id,classroom_id,season_id,year_month,slot_no,
      territory_id,territory_name_snapshot,territory_description_snapshot,
      tax_rate_percent_snapshot,auction_category,
      auction_id,auction_round_number,auction_school_year,auction_ended_at,
      settled_item_count,auction_gold_spend,super_pass_consumed_count,
      super_pass_equivalent_value,gross_spend,projected_revenue
    )
    values(
      NEW.id,v_closure.classroom_id,v_closure.season_id,v_closure.year_month,
      (v_item->>'slot_no')::smallint,
      nullif(v_item->>'territory_id','')::bigint,
      v_item->>'territory_name',
      v_item->>'territory_description',
      coalesce((v_item->>'tax_rate_percent')::numeric,0),
      v_item->>'auction_category',
      nullif(v_item->>'auction_id','')::integer,
      nullif(v_item->>'auction_round_number','')::integer,
      nullif(v_item->>'auction_school_year','')::integer,
      nullif(v_item->>'auction_ended_at','')::timestamptz,
      coalesce((v_item->>'settled_item_count')::integer,0),
      coalesce((v_item->>'auction_gold_spend')::bigint,0),
      coalesce((v_item->>'super_pass_consumed_count')::integer,0),
      coalesce((v_item->>'super_pass_equivalent_value')::bigint,0),
      coalesce((v_item->>'gross_spend')::bigint,0),
      coalesce((v_item->>'projected_revenue')::numeric,0)
    )
    on conflict(version_id,slot_no) do nothing;
  end loop;

  return NEW;
end;
$function$;

with pass_backfill as (
  select es.id as snapshot_id,
         count(e.id)::integer as pass_count,
         public.guild5_super_pass_unit_value(es.auction_category) as unit_value
  from public.guild5_territory_economy_snapshots es
  left join public.auction_items i
    on i.auction_id=es.auction_id
   and i.category=es.auction_category
  left join public.auction_super_pass_entries e
    on e.auction_item_id=i.id
   and e.status='WINNER_CONSUMED'
  group by es.id,es.auction_category
)
update public.guild5_territory_economy_snapshots es
set auction_gold_spend=es.gross_spend,
    super_pass_consumed_count=pb.pass_count,
    super_pass_equivalent_value=pb.pass_count::bigint*pb.unit_value,
    gross_spend=es.gross_spend + pb.pass_count::bigint*pb.unit_value
from pass_backfill pb
where pb.snapshot_id=es.id;
