-- Fix independent 1:N joins that multiplied collection/item/character aggregate counts.
-- Keeps the original analytics function as an internal raw source and overlays
-- independently verified aggregates.

create or replace function public.analytics_collection_completion_history(
  p_classroom_id integer,
  p_include_test boolean default false
)
returns table(
  student_id integer,
  collection_id bigint,
  first_completed_at timestamptz,
  current_complete boolean
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with students_scope as (
  select s.id student_id
  from public.students s
  where s.classroom_id=p_classroom_id
    and s.transferred_at is null
    and (
      s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      or (p_include_test and s.role::text='TEST')
    )
    and (p_include_test or not coalesce(s.is_test_account,false))
),
collection_defs as (
  select cc.id collection_id,
    greatest(cc.created_at,coalesce(max(m.updated_at),cc.created_at)) effective_at,
    count(*) filter(where m.is_active)::int required_count
  from public.character_collections cc
  left join public.character_collection_members m on m.collection_id=cc.id
  where cc.classroom_id=p_classroom_id and cc.is_active
  group by cc.id,cc.created_at
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
    select 1
    from public.character_collection_members m
    where m.collection_id=q.collection_id and m.is_active
      and coalesce((
        select e.event_type
        from public.character_acquisition_events e
        where e.classroom_id=p_classroom_id
          and e.student_id=q.student_id
          and e.character_id=m.character_id
          and e.created_at<=q.candidate_at
        order by e.created_at desc,e.id desc
        limit 1
      ),'NONE') not in ('RECRUIT','TEACHER_GRANT','RESTORE')
  )
),
first_completion as (
  select q.student_id,q.collection_id,min(q.candidate_at) first_completed_at
  from complete_candidates q
  group by q.student_id,q.collection_id
),
current_completion as (
  select s.student_id,c.collection_id,
    (c.required_count>0 and c.required_count=(
      select count(*)
      from public.character_collection_members m
      join public.student_characters sc
        on sc.character_id=m.character_id
       and sc.student_id=s.student_id
       and sc.classroom_id=p_classroom_id
       and sc.is_owned
      where m.collection_id=c.collection_id and m.is_active
    )) as current_complete
  from students_scope s cross join collection_defs c
)
select cur.student_id,cur.collection_id,f.first_completed_at,cur.current_complete
from current_completion cur
left join first_completion f on f.student_id=cur.student_id and f.collection_id=cur.collection_id;
$$;

revoke all on function public.analytics_collection_completion_history(integer,boolean) from public,anon,authenticated;
grant execute on function public.analytics_collection_completion_history(integer,boolean) to service_role;

alter function public.teacher_get_statistics_assets(integer,boolean)
  rename to _analytics_assets_statistics_raw_v1;
revoke all on function public._analytics_assets_statistics_raw_v1(integer,boolean) from public,anon,authenticated;
grant execute on function public._analytics_assets_statistics_raw_v1(integer,boolean) to service_role;

create or replace function public.teacher_get_statistics_assets(
  p_classroom_id integer,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_raw jsonb;
  v_char_students jsonb;
  v_collection_students jsonb;
  v_collection_catalog jsonb;
  v_item_catalog jsonb;
  v_special_items jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_raw := public._analytics_assets_statistics_raw_v1(p_classroom_id,p_include_test);

  with eligible as (
    select s.id
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.transferred_at is null
      and (s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') or (p_include_test and s.role::text='TEST'))
      and (p_include_test or not coalesce(s.is_test_account,false))
  )
  select coalesce(jsonb_agg(
    e || jsonb_build_object(
      'positive_2_0_event_count',(
        select count(*) from public.character_acquisition_events cae
        where cae.classroom_id=p_classroom_id
          and cae.student_id=(e->>'student_id')::integer
          and cae.event_type in ('RECRUIT','TEACHER_GRANT','RESTORE')
      ),
      'legacy_purchase_count',(
        select count(*) from public.legacy_shop_purchase_history lp
        where lp.classroom_id=p_classroom_id
          and lp.student_id=(e->>'student_id')::integer
          and lp.domain_hint='CHARACTER'
      )
    ) order by e->>'student_name',(e->>'student_id')::integer
  ),'[]'::jsonb)
  into v_char_students
  from jsonb_array_elements(coalesce(v_raw->'characters'->'students','[]'::jsonb)) e
  join eligible x on x.id=(e->>'student_id')::integer;

  with eligible as (
    select s.id,s.name
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.transferred_at is null
      and (s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') or (p_include_test and s.role::text='TEST'))
      and (p_include_test or not coalesce(s.is_test_account,false))
  ), h as (
    select * from public.analytics_collection_completion_history(p_classroom_id,p_include_test)
  ), totals as (
    select count(*)::numeric as collection_count
    from public.character_collections cc
    where cc.classroom_id=p_classroom_id and cc.is_active
  ), student_agg as (
    select e.id student_id,e.name student_name,t.collection_count,
           count(*) filter(where h.current_complete)::bigint current_completed_count,
           count(*) filter(where h.first_completed_at is not null)::bigint total_ever_completed_count
    from eligible e
    cross join totals t
    left join h on h.student_id=e.id
    group by e.id,e.name,t.collection_count
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',a.student_id,
    'student_name',a.student_name,
    'current_completed_count',a.current_completed_count,
    'total_ever_completed_count',a.total_ever_completed_count,
    'completion_percent',case when a.collection_count>0 then round(a.current_completed_count::numeric*100/a.collection_count,2) else 0 end
  ) order by a.student_name,a.student_id),'[]'::jsonb)
  into v_collection_students
  from student_agg a;

  with h as (
    select * from public.analytics_collection_completion_history(p_classroom_id,p_include_test)
  )
  select coalesce(jsonb_agg(
    c || jsonb_build_object(
      'total_ever_completers',(
        select count(*) from h where h.collection_id=(c->>'collection_id')::bigint and h.first_completed_at is not null
      ),
      'current_completers',(
        select count(*) from h where h.collection_id=(c->>'collection_id')::bigint and h.current_complete
      ),
      'first_completer',(
        select jsonb_build_object(
          'student_id',q.student_id,'student_name',s.name,'brand_name',s.brand_name,'completed_at',q.first_completed_at
        )
        from h q join public.students s on s.id=q.student_id
        where q.collection_id=(c->>'collection_id')::bigint and q.first_completed_at is not null
        order by q.first_completed_at,q.student_id limit 1
      )
    ) order by (c->>'sort_order')::integer,(c->>'collection_id')::bigint
  ),'[]'::jsonb)
  into v_collection_catalog
  from jsonb_array_elements(coalesce(v_raw->'collections'->'catalog','[]'::jsonb)) c;

  with eligible as (
    select s.id
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.transferred_at is null
      and (s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') or (p_include_test and s.role::text='TEST'))
      and (p_include_test or not coalesce(s.is_test_account,false))
  )
  select coalesce(jsonb_agg(
    i || jsonb_build_object(
      'total_issued_quantity',(
        select coalesce(sum(e.quantity_delta) filter(where e.quantity_delta>0),0)
        from public.inventory_events e join eligible es on es.id=e.student_id
        where e.classroom_id=p_classroom_id and e.item_id=(i->>'item_id')::bigint
      ),
      'total_consumed_quantity',(
        select coalesce(sum(-e.quantity_delta) filter(where e.event_type in ('USE','CONSUME_RESERVED') and e.quantity_delta<0),0)
        from public.inventory_events e join eligible es on es.id=e.student_id
        where e.classroom_id=p_classroom_id and e.item_id=(i->>'item_id')::bigint
      ),
      'total_recipients',(
        select count(distinct e.student_id)
        from public.inventory_events e join eligible es on es.id=e.student_id
        where e.classroom_id=p_classroom_id and e.item_id=(i->>'item_id')::bigint and e.quantity_delta>0
      ),
      'current_holders',(
        select count(distinct inv.student_id)
        from public.student_inventory inv join eligible es on es.id=inv.student_id
        where inv.classroom_id=p_classroom_id and inv.item_id=(i->>'item_id')::bigint and inv.owned_quantity>0
      )
    ) order by coalesce((i->>'is_active')::boolean,false) desc,i->>'item_type',i->>'name',(i->>'item_id')::bigint
  ),'[]'::jsonb)
  into v_item_catalog
  from jsonb_array_elements(coalesce(v_raw->'items'->'catalog','[]'::jsonb)) i;

  select coalesce(jsonb_agg(i order by i->>'name',(i->>'item_id')::bigint),'[]'::jsonb)
  into v_special_items
  from jsonb_array_elements(v_item_catalog) i
  where coalesce((i->>'is_special')::boolean,false);

  v_raw := jsonb_set(v_raw,'{characters,students}',v_char_students,true);
  v_raw := jsonb_set(v_raw,'{collections,students}',v_collection_students,true);
  v_raw := jsonb_set(v_raw,'{collections,catalog}',v_collection_catalog,true);
  v_raw := jsonb_set(v_raw,'{items,catalog}',v_item_catalog,true);
  v_raw := jsonb_set(v_raw,'{items,special_first_recipients}',v_special_items,true);

  return v_raw;
end;
$$;

revoke all on function public.teacher_get_statistics_assets(integer,boolean) from public,anon;
grant execute on function public.teacher_get_statistics_assets(integer,boolean) to authenticated,service_role;