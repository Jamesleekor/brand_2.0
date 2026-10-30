-- 2026-10-30: Immutable queue snapshot for completed auction territory funds.
-- Round 8 is pinned here so the next Guild5 monthly FINAL cannot accidentally consume a later auction.

create table if not exists public.guild5_auction_fund_snapshots (
  id bigserial primary key,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  auction_id integer not null references public.auctions(id) on delete cascade,
  auction_round_number integer,
  auction_school_year integer,
  auction_ended_at timestamptz,
  auction_category text not null check (auction_category in ('자리','1인1역','급식순서')),
  settled_item_count integer not null default 0,
  auction_gold_spend bigint not null default 0,
  super_pass_consumed_count integer not null default 0,
  super_pass_equivalent_value bigint not null default 0,
  territory_fund bigint not null default 0,
  captured_at timestamptz not null default now(),
  unique(auction_id, auction_category)
);

create index if not exists ix_guild5_auction_fund_snapshots_queue
  on public.guild5_auction_fund_snapshots(classroom_id, auction_id, auction_category);

alter table public.guild5_auction_fund_snapshots enable row level security;

create or replace function public.guild5_capture_auction_fund_snapshot(p_auction_id integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_auction public.auctions%rowtype;
  v_result jsonb;
begin
  select * into v_auction from public.auctions where id=p_auction_id;
  if v_auction.id is null then
    raise exception '[G5 ECON] auction not found: %', p_auction_id;
  end if;
  if v_auction.status::text <> 'COMPLETED' then
    raise exception '[G5 ECON] only COMPLETED auction can be snapshotted: %', p_auction_id;
  end if;

  insert into public.guild5_auction_fund_snapshots(
    classroom_id,auction_id,auction_round_number,auction_school_year,auction_ended_at,
    auction_category,settled_item_count,auction_gold_spend,
    super_pass_consumed_count,super_pass_equivalent_value,territory_fund
  )
  select
    v_auction.classroom_id,v_auction.id,v_auction.round_number,v_auction.school_year,v_auction.ended_at,
    s.category,
    coalesce(g.settled_item_count,0),
    coalesce(g.auction_gold_spend,0),
    coalesce(p.super_pass_consumed_count,0),
    coalesce(p.super_pass_consumed_count,0)::bigint * public.guild5_super_pass_unit_value(s.category),
    coalesce(g.auction_gold_spend,0)
      + coalesce(p.super_pass_consumed_count,0)::bigint * public.guild5_super_pass_unit_value(s.category)
  from (values ('자리'::text),('1인1역'::text),('급식순서'::text)) s(category)
  left join lateral (
    select count(r.id)::integer as settled_item_count,
           coalesce(sum(r.final_price),0)::bigint as auction_gold_spend
    from public.auction_items i
    join public.auction_results r on r.auction_item_id=i.id
    join public.transactions tx on tx.id=r.transaction_id
    where i.auction_id=v_auction.id
      and i.category=s.category
      and tx.value_token='GOLD'
      and tx.amount<0
      and not tx.is_reversed
  ) g on true
  left join lateral (
    select count(e.id)::integer as super_pass_consumed_count
    from public.auction_super_pass_entries e
    join public.auction_items i on i.id=e.auction_item_id
    where i.auction_id=v_auction.id
      and i.category=s.category
      and e.status='WINNER_CONSUMED'
  ) p on true
  on conflict(auction_id,auction_category) do nothing;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
  into v_result
  from public.guild5_auction_fund_snapshots x
  where x.auction_id=v_auction.id;
  return v_result;
end;
$function$;

-- guild5_build_territory_auction_economy was updated in production by this migration
-- to consume the oldest unclaimed immutable snapshot first, with legacy live-auction fallback.
-- See the database migration history version 20261030035210 for the authoritative deployed body.

select public.guild5_capture_auction_fund_snapshot(43);
