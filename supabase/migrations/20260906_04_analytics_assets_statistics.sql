-- B.R.A.N.D 2.0 — Analytics & Records: characters/fragments, collections, items
-- 2026-09-06

create or replace function public.teacher_get_statistics_assets(
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
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  with students_scope as (
    select s.id student_id,s.name student_name,s.brand_name,s.is_test_account,(s.transferred_at is null) is_active
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')
      and (p_include_test or not s.is_test_account)
  ),
  character_catalog as (
    select c.* from public.characters c
  ),
  char_positive_events as (
    select e.student_id,e.character_id,e.created_at as occurred_at,
           e.event_type as source_kind,e.id as source_id
    from public.character_acquisition_events e
    join students_scope s on s.student_id=e.student_id
    where e.classroom_id=p_classroom_id
      and e.event_type in ('RECRUIT','TEACHER_GRANT','RESTORE')
  ),
  legacy_char_purchases as (
    select h.student_id,c.id as character_id,h.purchased_at as occurred_at,
           'LEGACY_SHOP_PURCHASE'::text as source_kind,h.id as source_id
    from public.legacy_shop_purchase_history h
    join students_scope s on s.student_id=h.student_id
    join character_catalog c on c.character_uid=h.item_uid
    where h.classroom_id=p_classroom_id and h.domain_hint='CHARACTER'
  ),
  known_char_acquisitions as (
    select * from legacy_char_purchases
    union all
    select * from char_positive_events
  ),
  char_first_known as (
    select distinct on(student_id,character_id)
      student_id,character_id,occurred_at,source_kind,source_id
    from known_char_acquisitions
    order by student_id,character_id,occurred_at asc,source_id asc
  ),
  char_current as (
    select sc.student_id,sc.character_id
    from public.student_characters sc join students_scope s on s.student_id=sc.student_id
    where sc.classroom_id=p_classroom_id and sc.is_owned
  ),
  char_first_global as (
    select distinct on(character_id) character_id,student_id,occurred_at,source_kind
    from char_first_known
    order by character_id,occurred_at asc,student_id asc
  ),
  char_season_counts as (
    select f.character_id,gs.id season_id,coalesce(gs.display_name,gs.name) season_name,count(*)::bigint achiever_count
    from char_first_known f
    join public.guild_seasons gs on gs.classroom_id=p_classroom_id
      and (f.occurred_at at time zone 'Asia/Seoul')::date between coalesce(gs.starts_on,gs.start_date) and coalesce(gs.ends_on,gs.end_date)
    group by f.character_id,gs.id,coalesce(gs.display_name,gs.name)
  ),
  char_student_rows as (
    select s.student_id,s.student_name,s.brand_name,s.is_test_account,s.is_active,
      count(distinct cc.character_id)::bigint as current_owned_count,
      count(distinct fk.character_id)::bigint as lifetime_known_distinct_acquired,
      count(pe.source_id)::bigint as positive_2_0_event_count,
      count(lp.source_id)::bigint as legacy_purchase_count,
      min(fk.occurred_at) as first_known_character_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'character_id',x.character_id,'character_uid',c.character_uid,'character_name',c.name,
        'first_known_at',x.occurred_at,'source_kind',x.source_kind
      ) order by x.occurred_at,c.character_uid),'[]'::jsonb)
       from char_first_known x join character_catalog c on c.id=x.character_id where x.student_id=s.student_id) as first_by_character
    from students_scope s
    left join char_current cc on cc.student_id=s.student_id
    left join char_first_known fk on fk.student_id=s.student_id
    left join char_positive_events pe on pe.student_id=s.student_id
    left join legacy_char_purchases lp on lp.student_id=s.student_id
    group by s.student_id,s.student_name,s.brand_name,s.is_test_account,s.is_active
  ),
  char_rows as (
    select c.id character_id,c.character_uid,c.name,c.epithet,c.is_active,
      count(distinct fk.student_id)::bigint as total_known_acquirers,
      count(distinct cur.student_id)::bigint as current_owners,
      case when fg.student_id is null then null else jsonb_build_object(
        'student_id',fg.student_id,'student_name',s.student_name,'brand_name',s.brand_name,
        'first_known_at',fg.occurred_at,'source_kind',fg.source_kind,
        'quality',case when fg.source_kind='LEGACY_SHOP_PURCHASE' then 'EXACT_KNOWN_PURCHASE' else 'PARTIAL_BACKFILL' end
      ) end as first_known_acquirer,
      (select coalesce(jsonb_agg(jsonb_build_object('season_id',sc.season_id,'season_name',sc.season_name,'achiever_count',sc.achiever_count) order by sc.season_id),'[]'::jsonb)
       from char_season_counts sc where sc.character_id=c.id) as season_counts
    from character_catalog c
    left join char_first_known fk on fk.character_id=c.id
    left join char_current cur on cur.character_id=c.id
    left join char_first_global fg on fg.character_id=c.id
    left join students_scope s on s.student_id=fg.student_id
    group by c.id,c.character_uid,c.name,c.epithet,c.is_active,fg.student_id,fg.occurred_at,fg.source_kind,s.student_name,s.brand_name
  ),
  collection_defs as (
    select cc.id collection_id,cc.collection_uid,cc.name collection_name,cc.collection_class,cc.is_visible,cc.sort_order,
      greatest(cc.created_at,coalesce(max(m.updated_at),cc.created_at)) effective_at,
      count(*) filter(where m.is_active)::int required_count
    from public.character_collections cc
    left join public.character_collection_members m on m.collection_id=cc.id
    where cc.classroom_id=p_classroom_id and cc.is_active
    group by cc.id,cc.collection_uid,cc.name,cc.collection_class,cc.is_visible,cc.sort_order,cc.created_at
  ),
  collection_candidates as (
    select s.student_id,c.collection_id,c.effective_at candidate_at
    from students_scope s cross join collection_defs c
    union
    select s.student_id,c.collection_id,e.created_at
    from students_scope s
    join public.character_acquisition_events e on e.student_id=s.student_id and e.classroom_id=p_classroom_id
    join public.character_collection_members m on m.character_id=e.character_id and m.is_active
    join collection_defs c on c.collection_id=m.collection_id and e.created_at>=c.effective_at
    where e.event_type in ('RECRUIT','TEACHER_GRANT','RESTORE')
  ),
  complete_candidates as (
    select q.student_id,q.collection_id,q.candidate_at
    from collection_candidates q
    where not exists (
      select 1 from public.character_collection_members m
      where m.collection_id=q.collection_id and m.is_active
        and coalesce((
          select e.event_type
          from public.character_acquisition_events e
          where e.classroom_id=p_classroom_id and e.student_id=q.student_id and e.character_id=m.character_id
            and e.created_at<=q.candidate_at
          order by e.created_at desc,e.id desc limit 1
        ),'NONE') not in ('RECRUIT','TEACHER_GRANT','RESTORE')
    )
  ),
  first_completion as (
    select student_id,collection_id,min(candidate_at) first_completed_at
    from complete_candidates group by student_id,collection_id
  ),
  current_collection_completion as (
    select s.student_id,c.collection_id,
      (c.required_count>0 and c.required_count=(
        select count(*) from public.character_collection_members m
        join public.student_characters sc on sc.character_id=m.character_id and sc.student_id=s.student_id
          and sc.classroom_id=p_classroom_id and sc.is_owned
        where m.collection_id=c.collection_id and m.is_active
      )) as is_complete
    from students_scope s cross join collection_defs c
  ),
  collection_first_global as (
    select distinct on(collection_id) collection_id,student_id,first_completed_at
    from first_completion order by collection_id,first_completed_at asc,student_id asc
  ),
  collection_season_counts as (
    select f.collection_id,gs.id season_id,coalesce(gs.display_name,gs.name) season_name,count(*)::bigint completer_count
    from first_completion f
    join public.guild_seasons gs on gs.classroom_id=p_classroom_id
      and (f.first_completed_at at time zone 'Asia/Seoul')::date between coalesce(gs.starts_on,gs.start_date) and coalesce(gs.ends_on,gs.end_date)
    group by f.collection_id,gs.id,coalesce(gs.display_name,gs.name)
  ),
  collection_rows as (
    select c.collection_id,c.collection_uid,c.collection_name,c.collection_class,c.is_visible,c.sort_order,c.required_count,c.effective_at,
      count(f.student_id)::bigint as total_ever_completers,
      count(cur.student_id) filter(where cur.is_complete)::bigint as current_completers,
      case when fg.student_id is null then null else jsonb_build_object(
        'student_id',fg.student_id,'student_name',s.student_name,'brand_name',s.brand_name,'completed_at',fg.first_completed_at
      ) end as first_completer,
      (select coalesce(jsonb_agg(jsonb_build_object('season_id',sc.season_id,'season_name',sc.season_name,'completer_count',sc.completer_count) order by sc.season_id),'[]'::jsonb)
       from collection_season_counts sc where sc.collection_id=c.collection_id) as season_counts
    from collection_defs c
    left join first_completion f on f.collection_id=c.collection_id
    left join current_collection_completion cur on cur.collection_id=c.collection_id
    left join collection_first_global fg on fg.collection_id=c.collection_id
    left join students_scope s on s.student_id=fg.student_id
    group by c.collection_id,c.collection_uid,c.collection_name,c.collection_class,c.is_visible,c.sort_order,c.required_count,c.effective_at,
             fg.student_id,fg.first_completed_at,s.student_name,s.brand_name
  ),
  collection_student_rows as (
    select s.student_id,s.student_name,
      count(*) filter(where cur.is_complete)::bigint as current_completed_count,
      count(f.collection_id)::bigint as total_ever_completed_count,
      case when count(*)>0 then round(count(*) filter(where cur.is_complete)::numeric*100/count(*),2) else 0 end as completion_percent
    from students_scope s
    cross join collection_defs c
    left join current_collection_completion cur on cur.student_id=s.student_id and cur.collection_id=c.collection_id
    left join first_completion f on f.student_id=s.student_id and f.collection_id=c.collection_id
    group by s.student_id,s.student_name
  ),
  inventory_events_scope as (
    select e.* from public.inventory_events e join students_scope s on s.student_id=e.student_id
    where e.classroom_id=p_classroom_id
  ),
  item_student_rows as (
    select s.student_id,s.student_name,
      coalesce(sum(e.quantity_delta) filter(where e.quantity_delta>0),0)::bigint as cumulative_acquired_quantity,
      coalesce(sum(-e.quantity_delta) filter(where e.event_type in ('USE','CONSUME_RESERVED') and e.quantity_delta<0),0)::bigint as cumulative_used_quantity,
      count(distinct e.item_id) filter(where e.quantity_delta>0)::bigint as distinct_items_ever_acquired,
      min(e.created_at) filter(where e.quantity_delta>0) as first_item_acquired_at
    from students_scope s left join inventory_events_scope e on e.student_id=s.student_id
    group by s.student_id,s.student_name
  ),
  item_first as (
    select distinct on(item_id) item_id,student_id,created_at,event_type
    from inventory_events_scope where quantity_delta>0
    order by item_id,created_at asc,id asc
  ),
  item_rows as (
    select i.id item_id,i.name,i.item_type,i.is_active,i.is_archived,
      coalesce(sum(e.quantity_delta) filter(where e.quantity_delta>0),0)::bigint as total_issued_quantity,
      coalesce(sum(-e.quantity_delta) filter(where e.event_type in ('USE','CONSUME_RESERVED') and e.quantity_delta<0),0)::bigint as total_consumed_quantity,
      count(distinct e.student_id) filter(where e.quantity_delta>0)::bigint as total_recipients,
      count(distinct inv.student_id) filter(where inv.owned_quantity>0)::bigint as current_holders,
      case when f.student_id is null then null else jsonb_build_object(
        'student_id',f.student_id,'student_name',s.student_name,'brand_name',s.brand_name,
        'acquired_at',f.created_at,'event_type',f.event_type
      ) end as first_recipient,
      (i.item_type='SPECIAL') as is_special
    from public.market_items i
    left join inventory_events_scope e on e.item_id=i.id
    left join public.student_inventory inv on inv.item_id=i.id and inv.classroom_id=p_classroom_id
      and exists(select 1 from students_scope ss where ss.student_id=inv.student_id)
    left join item_first f on f.item_id=i.id
    left join students_scope s on s.student_id=f.student_id
    where i.classroom_id=p_classroom_id
    group by i.id,i.name,i.item_type,i.is_active,i.is_archived,f.student_id,f.created_at,f.event_type,s.student_name,s.brand_name
  ),
  inventory_event_balance as (
    select e.student_id,e.item_id,sum(e.quantity_delta)::bigint event_qty
    from inventory_events_scope e group by e.student_id,e.item_id
  ),
  inventory_mismatch as (
    select coalesce(inv.student_id,e.student_id) student_id,coalesce(inv.item_id,e.item_id) item_id,
      coalesce(inv.owned_quantity,0)::bigint owned_qty,coalesce(e.event_qty,0)::bigint event_qty
    from public.student_inventory inv
    full join inventory_event_balance e on e.student_id=inv.student_id and e.item_id=inv.item_id
    where (inv.classroom_id=p_classroom_id or inv.classroom_id is null)
      and exists(select 1 from students_scope ss where ss.student_id=coalesce(inv.student_id,e.student_id))
  )
  select jsonb_build_object(
    'coverage',jsonb_build_object(
      'characters','Current ownership and B.R.A.N.D 2.0 events are exact; legacy shop purchases backfill known earlier acquisition dates, but non-shop legacy grants may be earlier than restored TEACHER_GRANT events.',
      'collections','Current collection definition completion is reconstructed from definition effective time plus B.R.A.N.D 2.0 ownership event replay.',
      'items','inventory_events is authoritative; MIGRATION events preserve historical acquisition timestamps.'
    ),
    'characters',jsonb_build_object(
      'students',(select coalesce(jsonb_agg(to_jsonb(x) order by x.student_name,x.student_id),'[]'::jsonb) from char_student_rows x),
      'catalog',(select coalesce(jsonb_agg(to_jsonb(x) order by x.is_active desc,x.character_uid),'[]'::jsonb) from char_rows x)
    ),
    'collections',jsonb_build_object(
      'students',(select coalesce(jsonb_agg(to_jsonb(x) order by x.student_name,x.student_id),'[]'::jsonb) from collection_student_rows x),
      'catalog',(select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.collection_id),'[]'::jsonb) from collection_rows x)
    ),
    'items',jsonb_build_object(
      'students',(select coalesce(jsonb_agg(to_jsonb(x) order by x.student_name,x.student_id),'[]'::jsonb) from item_student_rows x),
      'catalog',(select coalesce(jsonb_agg(to_jsonb(x) order by x.is_active desc,x.item_type,x.name,x.item_id),'[]'::jsonb) from item_rows x),
      'special_first_recipients',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.item_id),'[]'::jsonb) from item_rows x where x.is_special)
    ),
    'data_quality',jsonb_build_object(
      'current_owned_character_without_positive_event',(
        select count(*) from char_current c where not exists(
          select 1 from char_positive_events e where e.student_id=c.student_id and e.character_id=c.character_id
        )
      ),
      'current_collection_complete_without_reconstructed_first',(
        select count(*) from current_collection_completion c
        where c.is_complete and not exists(select 1 from first_completion f where f.student_id=c.student_id and f.collection_id=c.collection_id)
      ),
      'inventory_quantity_mismatch_pairs',(select count(*) from inventory_mismatch x where x.owned_qty<>x.event_qty)
    )
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb);
end;
$function$;

revoke all on function public.teacher_get_statistics_assets(integer,boolean) from public,anon;
grant execute on function public.teacher_get_statistics_assets(integer,boolean) to authenticated,service_role;
