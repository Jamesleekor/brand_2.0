-- B.R.A.N.D. 2.0 — Rankings V2
-- Student-safe classroom rankings for BV / total GOLD assets / achievements / collection.
-- Exact other-student BV and financial balances are intentionally never returned.

create or replace function public.get_classroom_ranking_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_self_student_id integer := public.current_student_id();
  v_cutoff timestamptz := now() - interval '7 days';
  v_limited_total integer := 0;
  v_result jsonb;
begin
  if v_classroom_id is null then
    raise exception '학급 정보를 확인할 수 없습니다.' using errcode='PRV01';
  end if;

  -- Student callers may only receive an exact value for themselves. Teacher callers
  -- have no self student id, so the same ranking surface remains privacy-safe.
  if v_self_student_id is not null and not exists (
    select 1
    from public.students s
    where s.id=v_self_student_id
      and s.classroom_id=v_classroom_id
      and s.transferred_at is null
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      and not coalesce(s.is_test_account,false)
  ) then
    v_self_student_id := null;
  end if;

  select count(distinct o.character_id)::integer
    into v_limited_total
  from public.character_recruitment_offers o
  where o.classroom_id=v_classroom_id
    and o.acquisition_mode='EVENT_ONLY';

  with
  student_scope as (
    select
      s.id as student_id,
      s.name,
      s.brand_name,
      s.cached_tier,
      s.enrolled_at,
      coalesce(w.bv,0)::bigint as current_bv,
      coalesce(w.gold,0)::bigint as current_cash_gold
    from public.students s
    left join public.wallets w on w.student_id=s.id
    where s.classroom_id=v_classroom_id
      and s.transferred_at is null
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      and not coalesce(s.is_test_account,false)
  ),
  bv_history as (
    select
      ss.*,
      coalesce(
        (
          select t.balance_after::bigint
          from public.transactions t
          where t.student_id=ss.student_id
            and t.value_token='BV'
            and t.created_at<=v_cutoff
          order by t.created_at desc,t.id desc
          limit 1
        ),
        ss.current_bv - coalesce((
          select sum(t.amount)::bigint
          from public.transactions t
          where t.student_id=ss.student_id
            and t.value_token='BV'
            and t.created_at>v_cutoff
        ),0)
      )::bigint as past_bv
    from student_scope ss
  ),
  bv_ordered as (
    select
      bh.*,
      row_number() over(order by bh.current_bv desc,bh.name,bh.student_id)::integer as rank_position,
      (bh.current_bv-bh.past_bv)::bigint as weekly_delta,
      lag(bh.current_bv) over(order by bh.current_bv desc,bh.name,bh.student_id) as previous_bv
    from bv_history bh
  ),
  bv_marked as (
    select
      bo.*,
      case
        when bo.previous_bv is null then 1
        when abs(bo.previous_bv-bo.current_bv)<=999 then 0
        else 1
      end as battle_break
    from bv_ordered bo
  ),
  bv_grouped as (
    select
      bm.*,
      sum(bm.battle_break) over(order by bm.rank_position rows unbounded preceding)::integer as battle_group_id
    from bv_marked bm
  ),
  battle_groups as (
    select
      bg.battle_group_id,
      min(bg.rank_position)::integer as start_rank,
      max(bg.rank_position)::integer as end_rank,
      count(*)::integer as member_count,
      jsonb_agg(jsonb_build_object(
        'student_id',bg.student_id,
        'name',bg.name,
        'rank',bg.rank_position
      ) order by bg.rank_position) as members
    from bv_grouped bg
    group by bg.battle_group_id
    having count(*)>=2
  ),
  current_assets as (
    select
      ss.*,
      coalesce((
        select sum(sd.principal)::bigint
        from public.student_deposits sd
        where sd.student_id=ss.student_id
          and sd.classroom_id=v_classroom_id
          and sd.status='ACTIVE'
      ),0)::bigint as deposit_principal,
      coalesce((
        select sum(si.actual_principal)::bigint
        from public.student_installment_savings si
        where si.student_id=ss.student_id
          and si.classroom_id=v_classroom_id
          and si.status='ACTIVE'
      ),0)::bigint as installment_principal
    from student_scope ss
  ),
  historical_assets as (
    select
      ca.*,
      coalesce(
        (
          select t.balance_after::bigint
          from public.transactions t
          where t.student_id=ca.student_id
            and t.value_token='GOLD'
            and t.created_at<=v_cutoff
          order by t.created_at desc,t.id desc
          limit 1
        ),
        ca.current_cash_gold - coalesce((
          select sum(t.amount)::bigint
          from public.transactions t
          where t.student_id=ca.student_id
            and t.value_token='GOLD'
            and t.created_at>v_cutoff
        ),0)
      )::bigint as past_cash_gold,
      coalesce((
        select sum(sd.principal)::bigint
        from public.student_deposits sd
        where sd.student_id=ca.student_id
          and sd.classroom_id=v_classroom_id
          and sd.created_at<=v_cutoff
          and (sd.processed_at is null or sd.processed_at>v_cutoff)
      ),0)::bigint as past_deposit_principal,
      coalesce((
        select sum(r.paid_amount)::bigint
        from public.student_installment_savings si
        join public.installment_savings_rounds r on r.contract_id=si.id
        where si.student_id=ca.student_id
          and si.classroom_id=v_classroom_id
          and si.created_at<=v_cutoff
          and (si.processed_at is null or si.processed_at>v_cutoff)
          and r.status='PAID'
          and r.processed_at is not null
          and r.processed_at<=v_cutoff
      ),0)::bigint as past_installment_principal
    from current_assets ca
  ),
  asset_values as (
    select
      ha.*,
      (ha.current_cash_gold+ha.deposit_principal+ha.installment_principal)::bigint as current_total_asset,
      (ha.past_cash_gold+ha.past_deposit_principal+ha.past_installment_principal)::bigint as past_total_asset
    from historical_assets ha
  ),
  current_asset_rank as (
    select
      av.*,
      row_number() over(order by av.current_total_asset desc,av.name,av.student_id)::integer as current_rank
    from asset_values av
  ),
  past_asset_rank as (
    select
      av.student_id,
      row_number() over(order by av.past_total_asset desc,av.name,av.student_id)::integer as past_rank
    from asset_values av
  ),
  asset_ranked as (
    select
      car.*,
      par.past_rank,
      case
        when car.current_total_asset<=0 then 'NONE'
        when car.current_cash_gold*2>=car.current_total_asset
          and car.current_cash_gold>car.deposit_principal
          and car.current_cash_gold>car.installment_principal then 'CASH'
        when car.deposit_principal*2>=car.current_total_asset
          and car.deposit_principal>car.current_cash_gold
          and car.deposit_principal>car.installment_principal then 'DEPOSIT'
        when car.installment_principal*2>=car.current_total_asset
          and car.installment_principal>car.current_cash_gold
          and car.installment_principal>car.deposit_principal then 'INSTALLMENT'
        else 'BALANCED'
      end as asset_style
    from current_asset_rank car
    join past_asset_rank par on par.student_id=car.student_id
  ),
  achievement_counts as (
    select
      ss.student_id,
      count(sa.id) filter(where coalesce(sa.is_revoked,false)=false)::integer as achievement_count
    from student_scope ss
    left join public.student_achievements sa on sa.student_id=ss.student_id
    group by ss.student_id
  ),
  achievement_ranked as (
    select
      ss.*,
      coalesce(ac.achievement_count,0)::integer as achievement_count,
      row_number() over(
        order by coalesce(ac.achievement_count,0) desc,ss.name,ss.student_id
      )::integer as rank_position
    from student_scope ss
    left join achievement_counts ac on ac.student_id=ss.student_id
  ),
  owned_shards as (
    select
      ss.student_id,
      sc.character_id,
      c.name as character_name,
      coalesce(o.acquisition_mode,'UNAVAILABLE') as acquisition_mode,
      coalesce(o.base_price_crystal,0)::bigint as base_price_crystal
    from student_scope ss
    join public.student_characters sc
      on sc.student_id=ss.student_id
     and sc.classroom_id=v_classroom_id
     and sc.is_owned=true
    join public.characters c on c.id=sc.character_id
    left join lateral (
      select ro.acquisition_mode,ro.base_price_crystal
      from public.character_recruitment_offers ro
      where ro.classroom_id=v_classroom_id
        and ro.character_id=sc.character_id
      order by ro.id desc
      limit 1
    ) o on true
  ),
  shard_summary as (
    select
      ss.student_id,
      count(os.character_id)::integer as owned_count,
      count(os.character_id) filter(where os.acquisition_mode='EVENT_ONLY')::integer as limited_count,
      coalesce(sum(case when os.acquisition_mode='CRYSTAL' then os.base_price_crystal else 0 end),0)::bigint as collection_value
    from student_scope ss
    left join owned_shards os on os.student_id=ss.student_id
    group by ss.student_id
  ),
  shard_ranked as (
    select
      ss.*,
      coalesce(sh.owned_count,0)::integer as owned_count,
      coalesce(sh.limited_count,0)::integer as limited_count,
      coalesce(sh.collection_value,0)::bigint as collection_value,
      row_number() over(
        order by coalesce(sh.owned_count,0) desc,coalesce(sh.limited_count,0) desc,coalesce(sh.collection_value,0) desc,ss.name,ss.student_id
      )::integer as rank_position
    from student_scope ss
    left join shard_summary sh on sh.student_id=ss.student_id
  ),
  completed_collection_rows as (
    select
      ss.student_id,
      cc.id as collection_id,
      cc.collection_uid,
      cc.name as collection_name,
      cc.description,
      cc.collection_class,
      cc.sort_order,
      (
        select max(sc.acquired_at)
        from public.character_collection_members m
        join public.student_characters sc
          on sc.student_id=ss.student_id
         and sc.classroom_id=v_classroom_id
         and sc.character_id=m.character_id
         and sc.is_owned=true
        where m.collection_id=cc.id
          and m.is_active=true
      ) as completed_at,
      (
        select count(*)::integer
        from public.character_collection_members m
        where m.collection_id=cc.id and m.is_active=true
      ) as required_count
    from student_scope ss
    cross join public.character_collections cc
    where cc.classroom_id=v_classroom_id
      and cc.is_active=true
      and cc.is_visible=true
      and exists(
        select 1 from public.character_collection_members m
        where m.collection_id=cc.id and m.is_active=true
      )
      and not exists(
        select 1
        from public.character_collection_members m
        where m.collection_id=cc.id
          and m.is_active=true
          and not exists(
            select 1
            from public.student_characters sc
            where sc.student_id=ss.student_id
              and sc.classroom_id=v_classroom_id
              and sc.character_id=m.character_id
              and sc.is_owned=true
          )
      )
  ),
  collection_summary as (
    select
      ss.student_id,
      count(ccr.collection_id)::integer as completed_count,
      (
        select c2.collection_name
        from completed_collection_rows c2
        where c2.student_id=ss.student_id
        order by c2.completed_at desc nulls last,c2.sort_order,c2.collection_uid
        limit 1
      ) as recent_collection_name,
      (
        select c2.completed_at
        from completed_collection_rows c2
        where c2.student_id=ss.student_id
        order by c2.completed_at desc nulls last,c2.sort_order,c2.collection_uid
        limit 1
      ) as recent_completed_at
    from student_scope ss
    left join completed_collection_rows ccr on ccr.student_id=ss.student_id
    group by ss.student_id
  ),
  collection_ranked as (
    select
      ss.*,
      coalesce(cs.completed_count,0)::integer as completed_count,
      cs.recent_collection_name,
      cs.recent_completed_at,
      row_number() over(
        order by coalesce(cs.completed_count,0) desc,cs.recent_completed_at desc nulls last,ss.name,ss.student_id
      )::integer as rank_position
    from student_scope ss
    left join collection_summary cs on cs.student_id=ss.student_id
  )
  select jsonb_build_object(
    'classroom_id',v_classroom_id,
    'self_student_id',v_self_student_id,
    'comparison_cutoff',v_cutoff,
    'limited_character_total',v_limited_total,
    'bv_battle_groups',coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id',b.battle_group_id,
        'start_rank',b.start_rank,
        'end_rank',b.end_rank,
        'member_count',b.member_count,
        'members',b.members
      ) order by b.start_rank)
      from battle_groups b
    ),'[]'::jsonb),
    'bv_ranks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank',bg.rank_position,
        'student_id',bg.student_id,
        'name',bg.name,
        'brand_name',bg.brand_name,
        'tier',bg.cached_tier,
        'weekly_delta',bg.weekly_delta,
        'battle_group_id',case when b.battle_group_id is null then null else bg.battle_group_id end,
        'exact_bv',case when bg.student_id=v_self_student_id then bg.current_bv else null end,
        'is_me',bg.student_id=v_self_student_id
      ) order by bg.rank_position)
      from bv_grouped bg
      left join battle_groups b on b.battle_group_id=bg.battle_group_id
    ),'[]'::jsonb),
    'asset_distribution',jsonb_build_array(
      jsonb_build_object('key','0_10000','min',0,'max',10000,'count',(select count(*) from asset_values a where a.current_total_asset between 0 and 10000)),
      jsonb_build_object('key','10001_20000','min',10001,'max',20000,'count',(select count(*) from asset_values a where a.current_total_asset between 10001 and 20000)),
      jsonb_build_object('key','20001_30000','min',20001,'max',30000,'count',(select count(*) from asset_values a where a.current_total_asset between 20001 and 30000)),
      jsonb_build_object('key','30001_40000','min',30001,'max',40000,'count',(select count(*) from asset_values a where a.current_total_asset between 30001 and 40000)),
      jsonb_build_object('key','40001_50000','min',40001,'max',50000,'count',(select count(*) from asset_values a where a.current_total_asset between 40001 and 50000)),
      jsonb_build_object('key','50001_plus','min',50001,'max',null,'count',(select count(*) from asset_values a where a.current_total_asset>=50001))
    ),
    'asset_ranks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank',ar.current_rank,
        'student_id',ar.student_id,
        'name',ar.name,
        'brand_name',ar.brand_name,
        'tier',ar.cached_tier,
        'rank_delta',case
          when ar.enrolled_at is not null and ar.enrolled_at>(v_cutoff at time zone 'Asia/Seoul')::date then null
          else ar.past_rank-ar.current_rank
        end,
        'asset_style',ar.asset_style,
        'exact_total_asset',case when ar.student_id=v_self_student_id then ar.current_total_asset else null end,
        'exact_cash_gold',case when ar.student_id=v_self_student_id then ar.current_cash_gold else null end,
        'exact_deposit_principal',case when ar.student_id=v_self_student_id then ar.deposit_principal else null end,
        'exact_installment_principal',case when ar.student_id=v_self_student_id then ar.installment_principal else null end,
        'is_me',ar.student_id=v_self_student_id
      ) order by ar.current_rank)
      from asset_ranked ar
    ),'[]'::jsonb),
    'achievement_ranks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank',ar.rank_position,
        'student_id',ar.student_id,
        'name',ar.name,
        'brand_name',ar.brand_name,
        'tier',ar.cached_tier,
        'achievement_count',ar.achievement_count,
        'is_me',ar.student_id=v_self_student_id
      ) order by ar.rank_position)
      from achievement_ranked ar
    ),'[]'::jsonb),
    'shard_ranks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank',sr.rank_position,
        'student_id',sr.student_id,
        'name',sr.name,
        'brand_name',sr.brand_name,
        'tier',sr.cached_tier,
        'owned_count',sr.owned_count,
        'limited_count',sr.limited_count,
        'collection_value',sr.collection_value,
        'is_me',sr.student_id=v_self_student_id
      ) order by sr.rank_position)
      from shard_ranked sr
    ),'[]'::jsonb),
    'collection_ranks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank',cr.rank_position,
        'student_id',cr.student_id,
        'name',cr.name,
        'brand_name',cr.brand_name,
        'tier',cr.cached_tier,
        'completed_count',cr.completed_count,
        'recent_collection_name',cr.recent_collection_name,
        'recent_completed_at',cr.recent_completed_at,
        'is_me',cr.student_id=v_self_student_id
      ) order by cr.rank_position)
      from collection_ranked cr
    ),'[]'::jsonb)
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.get_classroom_ranking_v2_collection_detail(p_student_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_limited_total integer := 0;
  v_result jsonb;
begin
  if v_classroom_id is null then
    raise exception '학급 정보를 확인할 수 없습니다.' using errcode='PRV11';
  end if;
  if p_student_id is null or not exists(
    select 1
    from public.students s
    where s.id=p_student_id
      and s.classroom_id=v_classroom_id
      and s.transferred_at is null
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      and not coalesce(s.is_test_account,false)
  ) then
    raise exception '현재 학급의 학생을 찾을 수 없습니다.' using errcode='PRV12';
  end if;

  select count(distinct o.character_id)::integer
    into v_limited_total
  from public.character_recruitment_offers o
  where o.classroom_id=v_classroom_id
    and o.acquisition_mode='EVENT_ONLY';

  with owned_characters as (
    select
      c.id as character_id,
      c.character_uid,
      c.name,
      c.epithet,
      c.resource_kind,
      c.resource_url,
      c.emoji,
      c.full_image_url,
      c.card_image_url,
      c.avatar_image_url,
      coalesce(o.acquisition_mode,'UNAVAILABLE') as acquisition_mode,
      coalesce(o.base_price_crystal,0)::bigint as base_price_crystal,
      sc.acquired_at,
      case when o.acquisition_mode='EVENT_ONLY' then true else false end as is_limited,
      case when o.acquisition_mode='CRYSTAL' then coalesce(o.base_price_crystal,0)::bigint else 0::bigint end as collection_value
    from public.student_characters sc
    join public.characters c on c.id=sc.character_id
    left join lateral (
      select ro.acquisition_mode,ro.base_price_crystal
      from public.character_recruitment_offers ro
      where ro.classroom_id=v_classroom_id
        and ro.character_id=sc.character_id
      order by ro.id desc
      limit 1
    ) o on true
    where sc.student_id=p_student_id
      and sc.classroom_id=v_classroom_id
      and sc.is_owned=true
  ),
  completed_collections as (
    select
      cc.id as collection_id,
      cc.collection_uid,
      cc.name,
      cc.description,
      cc.collection_class,
      cc.sort_order,
      (
        select count(*)::integer
        from public.character_collection_members m
        where m.collection_id=cc.id and m.is_active=true
      ) as required_count,
      (
        select max(sc.acquired_at)
        from public.character_collection_members m
        join public.student_characters sc
          on sc.student_id=p_student_id
         and sc.classroom_id=v_classroom_id
         and sc.character_id=m.character_id
         and sc.is_owned=true
        where m.collection_id=cc.id
          and m.is_active=true
      ) as completed_at
    from public.character_collections cc
    where cc.classroom_id=v_classroom_id
      and cc.is_active=true
      and cc.is_visible=true
      and exists(
        select 1 from public.character_collection_members m
        where m.collection_id=cc.id and m.is_active=true
      )
      and not exists(
        select 1
        from public.character_collection_members m
        where m.collection_id=cc.id
          and m.is_active=true
          and not exists(
            select 1
            from public.student_characters sc
            where sc.student_id=p_student_id
              and sc.classroom_id=v_classroom_id
              and sc.character_id=m.character_id
              and sc.is_owned=true
          )
      )
  )
  select jsonb_build_object(
    'student',(select jsonb_build_object('student_id',s.id,'name',s.name,'brand_name',s.brand_name) from public.students s where s.id=p_student_id),
    'summary',jsonb_build_object(
      'owned_count',(select count(*) from owned_characters),
      'limited_count',(select count(*) from owned_characters where is_limited),
      'limited_total',v_limited_total,
      'collection_value',(select coalesce(sum(collection_value),0) from owned_characters),
      'completed_collection_count',(select count(*) from completed_collections)
    ),
    'characters',coalesce((
      select jsonb_agg(jsonb_build_object(
        'character_id',oc.character_id,
        'character_uid',oc.character_uid,
        'name',oc.name,
        'epithet',oc.epithet,
        'resource_kind',oc.resource_kind,
        'resource_url',oc.resource_url,
        'emoji',oc.emoji,
        'full_image_url',oc.full_image_url,
        'card_image_url',oc.card_image_url,
        'avatar_image_url',oc.avatar_image_url,
        'is_limited',oc.is_limited,
        'collection_value',oc.collection_value,
        'acquired_at',oc.acquired_at
      ) order by oc.is_limited desc,oc.collection_value desc,oc.name,oc.character_uid)
      from owned_characters oc
    ),'[]'::jsonb),
    'collections',coalesce((
      select jsonb_agg(jsonb_build_object(
        'collection_id',cc.collection_id,
        'collection_uid',cc.collection_uid,
        'name',cc.name,
        'description',cc.description,
        'collection_class',cc.collection_class,
        'required_count',cc.required_count,
        'completed_at',cc.completed_at
      ) order by cc.completed_at desc nulls last,cc.sort_order,cc.collection_uid)
      from completed_collections cc
    ),'[]'::jsonb)
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

revoke all on function public.get_classroom_ranking_v2() from public, anon;
revoke all on function public.get_classroom_ranking_v2_collection_detail(integer) from public, anon;
grant execute on function public.get_classroom_ranking_v2() to authenticated;
grant execute on function public.get_classroom_ranking_v2_collection_detail(integer) to authenticated;
