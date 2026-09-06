-- B.R.A.N.D 2.0 — Analytics & Records: Economy foundation
-- 2026-09-06
-- Additive-only analytics catalogs + teacher read RPC.

create table public.analytics_gold_threshold_catalog (
  threshold_gold bigint primary key check (threshold_gold > 0),
  label text not null,
  sort_order integer not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.analytics_gold_threshold_catalog(threshold_gold,label,sort_order) values
  (10000,'10,000 GOLD',1),
  (25000,'25,000 GOLD',2),
  (50000,'50,000 GOLD',3),
  (100000,'100,000 GOLD',4),
  (250000,'250,000 GOLD',5),
  (500000,'500,000 GOLD',6);

create table public.analytics_tier_catalog (
  tier_order integer primary key check (tier_order between 1 and 22),
  tier_name text not null unique,
  min_bv bigint not null unique check (min_bv >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.analytics_tier_catalog(tier_order,tier_name,min_bv) values
  (1,'새싹',0),(2,'브론즈',5000),(3,'빛나는 브론즈',7500),(4,'거친 실버',10000),
  (5,'성장한 실버',12500),(6,'진화한 실버',15000),(7,'은빛 극점',17500),(8,'금 광석',20000),
  (9,'제련된 골드',22500),(10,'정련된 골드',25000),(11,'태양의 황금',27500),(12,'루비 원석',30000),
  (13,'연마된 루비',35000),(14,'각성한 루비',40000),(15,'홍염의 정점',45000),(16,'다이아 원석',50000),
  (17,'세공된 다이아',55000),(18,'무결 다이아',60000),(19,'영원의 결정',65000),(20,'마스터',75000),
  (21,'천상의 마스터',85000),(22,'그랜드마스터',100000);

create table public.analytics_legacy_event_classifications (
  id bigint generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  source_table text not null check (source_table in ('legacy_asset_history')),
  migration_key text not null,
  source_row integer not null,
  classification text not null check (classification in ('DONATION')),
  note text,
  created_at timestamptz not null default now(),
  unique(source_table,migration_key,source_row,classification)
);

insert into public.analytics_legacy_event_classifications(
  classroom_id,source_table,migration_key,source_row,classification,note
)
select l.classroom_id,'legacy_asset_history',l.migration_key,l.source_row,'DONATION',
       '2026-08-12 전 재산 기부 — financial migration baseline reconciliation exception'
from public.legacy_asset_history l
where l.migration_key='FINAL_STUDENT_MIGRATION_20260901'
  and l.source_row=5791
  and l.memo='[기부] 전 재산 기부'
  and l.gold_delta=-1340;

alter table public.analytics_gold_threshold_catalog enable row level security;
alter table public.analytics_tier_catalog enable row level security;
alter table public.analytics_legacy_event_classifications enable row level security;
revoke all on table public.analytics_gold_threshold_catalog from public,anon,authenticated;
revoke all on table public.analytics_tier_catalog from public,anon,authenticated;
revoke all on table public.analytics_legacy_event_classifications from public,anon,authenticated;
revoke all on sequence public.analytics_legacy_event_classifications_id_seq from public,anon,authenticated;
grant select on table public.analytics_gold_threshold_catalog to service_role;
grant select on table public.analytics_tier_catalog to service_role;
grant select on table public.analytics_legacy_event_classifications to service_role;

create or replace function public.analytics_migration_cutover_at(p_classroom_id integer)
returns timestamptz
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select max(r.created_at)
  from public.final_student_migration_runs r
  where r.classroom_id=p_classroom_id
$$;
revoke all on function public.analytics_migration_cutover_at(integer) from public,anon,authenticated;
grant execute on function public.analytics_migration_cutover_at(integer) to service_role;

create or replace function public.teacher_get_statistics_economy(
  p_classroom_id integer,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_cutover_at timestamptz;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_cutover_at := public.analytics_migration_cutover_at(p_classroom_id);

  with students_scope as (
    select s.id as student_id,s.name as student_name,s.brand_name,s.cached_tier,s.is_test_account,
           (s.transferred_at is null) as is_active
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')
      and (p_include_test or not s.is_test_account)
  ),
  asset_events as (
    select l.student_id,'GOLD'::text as token,l.gold_delta::bigint as delta,l.balance_after_gold::bigint as balance_after,
           coalesce(l.occurred_at,l.event_date::timestamp at time zone 'Asia/Seoul') as occurred_at,
           'LEGACY_ASSET'::text as source_kind,l.id::bigint as source_id
    from public.legacy_asset_history l join students_scope s on s.student_id=l.student_id
    where l.classroom_id=p_classroom_id
    union all
    select l.student_id,'BV',l.bv_delta::bigint,l.balance_after_bv::bigint,
           coalesce(l.occurred_at,l.event_date::timestamp at time zone 'Asia/Seoul'),
           'LEGACY_ASSET',l.id::bigint
    from public.legacy_asset_history l join students_scope s on s.student_id=l.student_id
    where l.classroom_id=p_classroom_id
    union all
    select t.student_id,t.value_token::text,t.amount::bigint,t.balance_after::bigint,t.created_at,
           'TRANSACTION',t.id::bigint
    from public.transactions t join students_scope s on s.student_id=t.student_id
    where t.classroom_id=p_classroom_id
      and not t.is_reversed
      and t.value_token::text in ('GOLD','BV')
      and (v_cutover_at is null or t.created_at>v_cutover_at)
  ),
  asset_candidates as (
    select * from asset_events
    union all
    select w.student_id,'GOLD',0::bigint,w.gold::bigint,w.updated_at,'WALLET_CURRENT',w.id::bigint
    from public.wallets w join students_scope s on s.student_id=w.student_id
    union all
    select w.student_id,'BV',0::bigint,w.bv::bigint,w.updated_at,'WALLET_CURRENT',w.id::bigint
    from public.wallets w join students_scope s on s.student_id=w.student_id
  ),
  asset_agg as (
    select student_id,token,
      coalesce(sum(delta) filter(where delta>0),0)::bigint as cumulative_increase,
      coalesce(sum(-delta) filter(where delta<0),0)::bigint as cumulative_decrease,
      count(*) filter(where delta<>0)::bigint as event_count,
      coalesce(max(delta) filter(where delta>0),0)::bigint as max_single_increase,
      coalesce(max(-delta) filter(where delta<0),0)::bigint as max_single_decrease
    from asset_events group by student_id,token
  ),
  asset_peak as (
    select distinct on(student_id,token)
      student_id,token,balance_after,occurred_at,source_kind,source_id
    from asset_candidates
    order by student_id,token,balance_after desc,occurred_at asc nulls last,
             case source_kind when 'LEGACY_ASSET' then 10 when 'TRANSACTION' then 20 else 30 end,source_id
  ),
  asset_low as (
    select distinct on(student_id,token)
      student_id,token,balance_after,occurred_at,source_kind,source_id
    from asset_candidates
    order by student_id,token,balance_after asc,occurred_at asc nulls last,
             case source_kind when 'LEGACY_ASSET' then 10 when 'TRANSACTION' then 20 else 30 end,source_id
  ),
  threshold_reaches as (
    select s.student_id,g.threshold_gold,g.label,min(e.occurred_at) as first_reached_at
    from students_scope s
    cross join public.analytics_gold_threshold_catalog g
    join asset_events e on e.student_id=s.student_id and e.token='GOLD' and e.balance_after>=g.threshold_gold
    where g.is_active
    group by s.student_id,g.threshold_gold,g.label
  ),
  tier_reaches as (
    select s.student_id,c.tier_order,c.tier_name,c.min_bv,min(e.occurred_at) as first_reached_at
    from students_scope s
    cross join public.analytics_tier_catalog c
    join asset_events e on e.student_id=s.student_id and e.token='BV' and e.balance_after>=c.min_bv
    where c.is_active
    group by s.student_id,c.tier_order,c.tier_name,c.min_bv
  ),
  legacy_donation_events as (
    select l.student_id,(-l.gold_delta)::bigint as amount,
           coalesce(l.occurred_at,l.event_date::timestamp at time zone 'Asia/Seoul') as occurred_at,
           'LEGACY_ASSET'::text as source_kind,l.id::bigint as source_id
    from public.legacy_asset_history l
    join students_scope s on s.student_id=l.student_id
    where l.classroom_id=p_classroom_id and l.gold_delta<0
      and (
        l.memo like '[복지 기금 기부]%'
        or exists(
          select 1 from public.analytics_legacy_event_classifications x
          where x.classroom_id=p_classroom_id
            and x.source_table='legacy_asset_history'
            and x.migration_key=l.migration_key and x.source_row=l.source_row
            and x.classification='DONATION'
        )
      )
  ),
  donation_events as (
    select * from legacy_donation_events
    union all
    select t.student_id,(-t.amount)::bigint,t.created_at,'TRANSACTION',t.id::bigint
    from public.transactions t join students_scope s on s.student_id=t.student_id
    where t.classroom_id=p_classroom_id and not t.is_reversed
      and t.value_token::text='GOLD' and t.source_type::text='DONATION' and t.amount<0
      and (v_cutover_at is null or t.created_at>v_cutover_at)
  ),
  donation_agg as (
    select student_id,sum(amount)::bigint as donation_total,max(amount)::bigint as max_single_donation,
           min(occurred_at) as first_donation_at,max(occurred_at) as recent_donation_at,count(*)::bigint as donation_count
    from donation_events group by student_id
  ),
  burden as (
    select l.student_id,coalesce(sum(-l.gold_delta),0)::bigint as balance_development_burden
    from public.legacy_asset_history l join students_scope s on s.student_id=l.student_id
    where l.classroom_id=p_classroom_id and l.gold_delta<0 and l.memo ilike '균형발전 분담금%'
    group by l.student_id
  ),
  post_tax as (
    select t.student_id,coalesce(sum(t.tax_amount),0)::bigint as post_cutover_tax
    from public.transactions t join students_scope s on s.student_id=t.student_id
    where t.classroom_id=p_classroom_id and not t.is_reversed and t.tax_amount>0
      and (v_cutover_at is null or t.created_at>v_cutover_at)
    group by t.student_id
  ),
  financial as (
    select s.student_id,
      (coalesce(b.tax_paid_baseline,0)-coalesce(x.balance_development_burden,0)+coalesce(pt.post_cutover_tax,0))::bigint as pure_tax_total,
      coalesce(x.balance_development_burden,0)::bigint as balance_development_burden,
      coalesce(d.donation_total,0)::bigint as donation_total,
      coalesce(d.max_single_donation,0)::bigint as max_single_donation,
      d.first_donation_at,d.recent_donation_at,coalesce(d.donation_count,0)::bigint as donation_count,
      coalesce(b.tax_paid_baseline,0)::bigint as migration_tax_baseline_including_burden,
      coalesce(pt.post_cutover_tax,0)::bigint as post_cutover_tax
    from students_scope s
    left join public.student_financial_migration_baselines b on b.student_id=s.student_id
    left join burden x on x.student_id=s.student_id
    left join post_tax pt on pt.student_id=s.student_id
    left join donation_agg d on d.student_id=s.student_id
  ),
  legacy_shop as (
    select h.student_id,'SHOP_PURCHASE'::text as trade_type,h.price_gold::bigint as amount,h.purchased_at as occurred_at,
           'LEGACY_SHOP'::text as source_kind,h.id::bigint as source_id
    from public.legacy_shop_purchase_history h join students_scope s on s.student_id=h.student_id
    where h.classroom_id=p_classroom_id and h.price_gold>0
  ),
  new_shop as (
    select e.student_id,'SHOP_PURCHASE'::text,coalesce(e.total_gold,0)::bigint,e.created_at,
           'INVENTORY_EVENT'::text,e.id::bigint
    from public.inventory_events e join students_scope s on s.student_id=e.student_id
    where e.classroom_id=p_classroom_id and e.event_type='PURCHASE' and coalesce(e.total_gold,0)>0
      and (v_cutover_at is null or e.created_at>v_cutover_at)
  ),
  legacy_auction as (
    select l.student_id,'AUCTION_PURCHASE'::text,(-l.gold_delta)::bigint,
           coalesce(l.occurred_at,l.event_date::timestamp at time zone 'Asia/Seoul'),
           'LEGACY_ASSET'::text,l.id::bigint
    from public.legacy_asset_history l join students_scope s on s.student_id=l.student_id
    where l.classroom_id=p_classroom_id and l.gold_delta<0
      and (l.memo like '[경매낙찰]%' or l.memo like '[물품구매] [경매형]%')
  ),
  new_auction as (
    select t.student_id,'AUCTION_PURCHASE'::text,(-t.amount)::bigint,t.created_at,'TRANSACTION',t.id::bigint
    from public.transactions t join students_scope s on s.student_id=t.student_id
    where t.classroom_id=p_classroom_id and not t.is_reversed and t.value_token::text='GOLD'
      and t.source_type::text='AUCTION_PAYMENT' and t.amount<0
      and (v_cutover_at is null or t.created_at>v_cutover_at)
  ),
  legacy_p2p as (
    select l.student_id,
      case when l.memo like '[P2P송금→%' then 'P2P_SEND' else 'P2P_RECEIVE' end::text as trade_type,
      abs(l.gold_delta)::bigint as amount,
      coalesce(l.occurred_at,l.event_date::timestamp at time zone 'Asia/Seoul') as occurred_at,
      'LEGACY_ASSET'::text as source_kind,l.id::bigint as source_id
    from public.legacy_asset_history l join students_scope s on s.student_id=l.student_id
    where l.classroom_id=p_classroom_id and (
      (l.memo like '[P2P송금→%' and l.gold_delta<0)
      or (l.memo like '[P2P수령←%' and l.gold_delta>0)
    )
  ),
  new_p2p as (
    select t.student_id,t.source_type::text as trade_type,abs(t.amount)::bigint,t.created_at,'TRANSACTION',t.id::bigint
    from public.transactions t join students_scope s on s.student_id=t.student_id
    where t.classroom_id=p_classroom_id and not t.is_reversed and t.value_token::text='GOLD'
      and t.source_type::text in ('P2P_SEND','P2P_RECEIVE') and t.amount<>0
      and (v_cutover_at is null or t.created_at>v_cutover_at)
  ),
  trade_events as (
    select * from legacy_shop union all select * from new_shop
    union all select * from legacy_auction union all select * from new_auction
    union all select * from legacy_p2p union all select * from new_p2p
  ),
  trade_agg as (
    select student_id,trade_type,sum(amount)::bigint as total_amount,count(*)::bigint as trade_count,
           max(amount)::bigint as max_single_amount,max(occurred_at) as recent_at
    from trade_events group by student_id,trade_type
  ),
  monthly_tax as (
    select date_trunc('month',t.created_at at time zone 'Asia/Seoul')::date as month_start,
           sum(t.tax_amount)::bigint as amount
    from public.transactions t join students_scope s on s.student_id=t.student_id
    where t.classroom_id=p_classroom_id and not t.is_reversed and t.tax_amount>0
      and (v_cutover_at is null or t.created_at>v_cutover_at)
    group by 1
  ),
  donation_student_month as (
    select student_id,date_trunc('month',occurred_at at time zone 'Asia/Seoul')::date as month_start,sum(amount)::bigint amount
    from donation_events group by student_id,2
  ),
  donation_month_total as (
    select month_start,sum(amount)::bigint total_amount from donation_student_month group by month_start
  ),
  current_season as (
    select gs.id,gs.name,coalesce(gs.display_name,gs.name) as display_name,
           coalesce(gs.starts_on,gs.start_date) as starts_on,coalesce(gs.ends_on,gs.end_date) as ends_on
    from public.guild_seasons gs
    where gs.classroom_id=p_classroom_id and (gs.is_active or gs.lifecycle_status='ACTIVE')
    order by coalesce(gs.starts_on,gs.start_date) desc,gs.id desc limit 1
  ),
  season_donation as (
    select d.student_id,sum(d.amount)::bigint amount
    from donation_events d cross join current_season cs
    where (d.occurred_at at time zone 'Asia/Seoul')::date between cs.starts_on and cs.ends_on
    group by d.student_id
  ),
  season_donation_total as (
    select coalesce(sum(amount),0)::bigint total_amount from season_donation
  ),
  donation_rank as (
    select f.student_id,f.donation_total,
           dense_rank() over(order by f.donation_total desc) as rank_position
    from financial f
  ),
  student_rows as (
    select s.student_id,s.student_name,s.brand_name,s.is_test_account,s.is_active,
      w.gold::bigint as current_gold,w.bv::bigint as current_bv,
      coalesce(s.cached_tier,public.calculate_tier_from_bv(coalesce(w.bv,0))) as current_tier,
      jsonb_build_object(
        'historical_max',coalesce(gp.balance_after,w.gold,0),'historical_max_at',gp.occurred_at,
        'historical_min',coalesce(gl.balance_after,w.gold,0),'historical_min_at',gl.occurred_at,
        'cumulative_earned',coalesce(ga.cumulative_increase,0),'cumulative_spent',coalesce(ga.cumulative_decrease,0),
        'transaction_count',coalesce(ga.event_count,0),'max_single_income',coalesce(ga.max_single_increase,0),
        'max_single_expense',coalesce(ga.max_single_decrease,0),
        'thresholds',(
          select coalesce(jsonb_agg(jsonb_build_object('threshold_gold',r.threshold_gold,'label',r.label,'first_reached_at',r.first_reached_at) order by r.threshold_gold),'[]'::jsonb)
          from threshold_reaches r where r.student_id=s.student_id
        )
      ) as gold,
      jsonb_build_object(
        'historical_max',coalesce(bp.balance_after,w.bv,0),'historical_max_at',bp.occurred_at,
        'cumulative_increase',coalesce(ba.cumulative_increase,0),'cumulative_decrease',coalesce(ba.cumulative_decrease,0),
        'highest_tier',public.calculate_tier_from_bv(coalesce(bp.balance_after,w.bv,0)),
        'tier_first_reaches',(
          select coalesce(jsonb_agg(jsonb_build_object('tier_order',r.tier_order,'tier_name',r.tier_name,'min_bv',r.min_bv,'first_reached_at',r.first_reached_at) order by r.tier_order),'[]'::jsonb)
          from tier_reaches r where r.student_id=s.student_id
        )
      ) as bv,
      jsonb_build_object(
        'pure_tax_total',coalesce(f.pure_tax_total,0),
        'balance_development_burden',coalesce(f.balance_development_burden,0),
        'donation_total',coalesce(f.donation_total,0),
        'max_single_donation',coalesce(f.max_single_donation,0),
        'first_donation_at',f.first_donation_at,'recent_donation_at',f.recent_donation_at,
        'donation_count',coalesce(f.donation_count,0),
        'season_donation',coalesce(sd.amount,0),
        'season_donation_share_percent',case when sdt.total_amount>0 then round(coalesce(sd.amount,0)::numeric*100/sdt.total_amount,2) else null end,
        'monthly_donation_shares',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'month',to_char(sm.month_start,'YYYY-MM'),'amount',sm.amount,'class_total',mt.total_amount,
            'share_percent',case when mt.total_amount>0 then round(sm.amount::numeric*100/mt.total_amount,2) else null end
          ) order by sm.month_start),'[]'::jsonb)
          from donation_student_month sm join donation_month_total mt using(month_start)
          where sm.student_id=s.student_id
        )
      ) as tax_donation,
      coalesce((
        select jsonb_object_agg(a.trade_type,jsonb_build_object(
          'total_amount',a.total_amount,'count',a.trade_count,'max_single',a.max_single_amount,'recent_at',a.recent_at
        )) from trade_agg a where a.student_id=s.student_id
      ),'{}'::jsonb) as trades
    from students_scope s
    left join public.wallets w on w.student_id=s.student_id
    left join asset_agg ga on ga.student_id=s.student_id and ga.token='GOLD'
    left join asset_agg ba on ba.student_id=s.student_id and ba.token='BV'
    left join asset_peak gp on gp.student_id=s.student_id and gp.token='GOLD'
    left join asset_low gl on gl.student_id=s.student_id and gl.token='GOLD'
    left join asset_peak bp on bp.student_id=s.student_id and bp.token='BV'
    left join financial f on f.student_id=s.student_id
    left join season_donation sd on sd.student_id=s.student_id
    cross join season_donation_total sdt
  )
  select jsonb_build_object(
    'migration_cutover_at',v_cutover_at,
    'timezone','Asia/Seoul',
    'coverage',jsonb_build_object(
      'gold_bv','legacy_asset_history + post-migration transactions',
      'donation','classified legacy donation events + post-migration DONATION transactions',
      'monthly_tax',case when v_cutover_at is null then '2.0 transactions only' else 'exact from migration cutover forward; legacy monthly tax unavailable' end,
      'pure_tax','migration baseline minus legacy balance-development burden plus post-migration tax_amount'
    ),
    'class_summary',jsonb_build_object(
      'current_gold',coalesce((select sum(coalesce(sr.current_gold,0)) from student_rows sr where sr.is_active),0),
      'current_bv',coalesce((select sum(coalesce(sr.current_bv,0)) from student_rows sr where sr.is_active),0),
      'pure_tax_total',coalesce((select sum((sr.tax_donation->>'pure_tax_total')::bigint) from student_rows sr),0),
      'balance_development_burden_total',coalesce((select sum((sr.tax_donation->>'balance_development_burden')::bigint) from student_rows sr),0),
      'donation_total',coalesce((select sum((sr.tax_donation->>'donation_total')::bigint) from student_rows sr),0),
      'current_season',(select to_jsonb(cs) from current_season cs),
      'current_season_donation_total',(select total_amount from season_donation_total),
      'monthly_tax',(
        select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),'amount',m.amount,'coverage','POST_MIGRATION_EXACT') order by m.month_start),'[]'::jsonb) from monthly_tax m
      ),
      'monthly_donation',(
        select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),'amount',m.total_amount) order by m.month_start),'[]'::jsonb) from donation_month_total m
      ),
      'lifetime_donation_top3',(
        select coalesce(jsonb_agg(jsonb_build_object('rank',r.rank_position,'student_id',r.student_id,'student_name',s.student_name,'amount',r.donation_total) order by r.rank_position,s.student_name),'[]'::jsonb)
        from donation_rank r join students_scope s on s.student_id=r.student_id where r.rank_position<=3
      )
    ),
    'data_quality',jsonb_build_object(
      'legacy_donation_baseline_mismatch_count',(
        select count(*) from (
          select s.student_id,coalesce(b.donation_total_baseline,0) baseline,coalesce(sum(ld.amount),0)::bigint reconstructed
          from students_scope s left join public.student_financial_migration_baselines b on b.student_id=s.student_id
          left join legacy_donation_events ld on ld.student_id=s.student_id
          group by s.student_id,b.donation_total_baseline
          having coalesce(b.donation_total_baseline,0)<>coalesce(sum(ld.amount),0)
        ) q
      ),
      'negative_pure_tax_count',(select count(*) from financial f where f.pure_tax_total<0),
      'tier_catalog_mismatch_count',(
        select count(*) from public.analytics_tier_catalog c where c.is_active and public.calculate_tier_from_bv(c.min_bv)<>c.tier_name
      )
    ),
    'students',(select coalesce(jsonb_agg(to_jsonb(sr) order by sr.student_name,sr.student_id),'[]'::jsonb) from student_rows sr)
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb);
end;
$function$;

revoke all on function public.teacher_get_statistics_economy(integer,boolean) from public,anon;
grant execute on function public.teacher_get_statistics_economy(integer,boolean) to authenticated,service_role;
