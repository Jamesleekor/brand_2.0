alter function public.teacher_get_data_validation_report(integer,boolean)
  rename to _analytics_data_validation_report_raw_v1;

revoke all on function public._analytics_data_validation_report_raw_v1(integer,boolean) from public,anon,authenticated;
grant execute on function public._analytics_data_validation_report_raw_v1(integer,boolean) to service_role;

create or replace function public.teacher_get_data_validation_report(
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
  v_assets jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_collection_mismatch integer := 0;
  v_item_mismatch integer := 0;
  v_character_event_mismatch integer := 0;
  v_extra_errors integer := 0;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_raw := public._analytics_data_validation_report_raw_v1(p_classroom_id,p_include_test);
  v_assets := public.teacher_get_statistics_assets(p_classroom_id,p_include_test);

  with h as (
    select * from public.analytics_collection_completion_history(p_classroom_id,p_include_test)
  ), direct as (
    select collection_id,
           count(*) filter(where current_complete)::bigint current_count,
           count(*) filter(where first_completed_at is not null)::bigint ever_count
    from h group by collection_id
  ), reported as (
    select (e->>'collection_id')::bigint collection_id,
           (e->>'current_completers')::bigint current_count,
           (e->>'total_ever_completers')::bigint ever_count
    from jsonb_array_elements(coalesce(v_assets->'collections'->'catalog','[]'::jsonb)) e
  )
  select count(*)::integer into v_collection_mismatch
  from reported r join direct d using(collection_id)
  where r.current_count<>d.current_count or r.ever_count<>d.ever_count;

  with eligible as (
    select s.id from public.students s
    where s.classroom_id=p_classroom_id and s.transferred_at is null
      and (s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') or (p_include_test and s.role::text='TEST'))
      and (p_include_test or not coalesce(s.is_test_account,false))
  ), reported as (
    select (e->>'item_id')::bigint item_id,
           (e->>'total_issued_quantity')::bigint issued,
           (e->>'total_consumed_quantity')::bigint consumed,
           (e->>'total_recipients')::bigint recipients,
           (e->>'current_holders')::bigint holders
    from jsonb_array_elements(coalesce(v_assets->'items'->'catalog','[]'::jsonb)) e
  ), direct as (
    select i.id item_id,
      coalesce(sum(ev.quantity_delta) filter(where ev.quantity_delta>0),0)::bigint issued,
      coalesce(sum(-ev.quantity_delta) filter(where ev.event_type in ('USE','CONSUME_RESERVED') and ev.quantity_delta<0),0)::bigint consumed,
      count(distinct ev.student_id) filter(where ev.quantity_delta>0)::bigint recipients,
      (select count(distinct inv.student_id)::bigint
       from public.student_inventory inv join eligible es on es.id=inv.student_id
       where inv.classroom_id=p_classroom_id and inv.item_id=i.id and inv.owned_quantity>0) holders
    from public.market_items i
    left join public.inventory_events ev on ev.item_id=i.id and ev.classroom_id=p_classroom_id and exists(select 1 from eligible es where es.id=ev.student_id)
    where i.classroom_id=p_classroom_id
    group by i.id
  )
  select count(*)::integer into v_item_mismatch
  from reported r join direct d using(item_id)
  where r.issued<>d.issued or r.consumed<>d.consumed or r.recipients<>d.recipients or r.holders<>d.holders;

  with eligible as (
    select s.id from public.students s
    where s.classroom_id=p_classroom_id and s.transferred_at is null
      and (s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') or (p_include_test and s.role::text='TEST'))
      and (p_include_test or not coalesce(s.is_test_account,false))
  ), reported as (
    select (e->>'student_id')::integer student_id,
           (e->>'positive_2_0_event_count')::bigint positive_count,
           (e->>'legacy_purchase_count')::bigint legacy_count
    from jsonb_array_elements(coalesce(v_assets->'characters'->'students','[]'::jsonb)) e
  ), direct as (
    select es.id student_id,
      (select count(*)::bigint from public.character_acquisition_events cae
       where cae.classroom_id=p_classroom_id and cae.student_id=es.id and cae.event_type in ('RECRUIT','TEACHER_GRANT','RESTORE')) positive_count,
      (select count(*)::bigint from public.legacy_shop_purchase_history lp
       where lp.classroom_id=p_classroom_id and lp.student_id=es.id and lp.domain_hint='CHARACTER') legacy_count
    from eligible es
  )
  select count(*)::integer into v_character_event_mismatch
  from reported r join direct d using(student_id)
  where r.positive_count<>d.positive_count or r.legacy_count<>d.legacy_count;

  if v_collection_mismatch>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('severity','ERROR','code','ASSET_COLLECTION_AGGREGATE_MISMATCH','count',v_collection_mismatch,'message','Collection aggregate output does not match independently reconstructed completion history.'));
    v_extra_errors := v_extra_errors+1;
  end if;
  if v_item_mismatch>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('severity','ERROR','code','ASSET_ITEM_AGGREGATE_MISMATCH','count',v_item_mismatch,'message','Item aggregate output does not match inventory event/current inventory direct totals.'));
    v_extra_errors := v_extra_errors+1;
  end if;
  if v_character_event_mismatch>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('severity','ERROR','code','ASSET_CHARACTER_EVENT_AGGREGATE_MISMATCH','count',v_character_event_mismatch,'message','Character acquisition event counters do not match direct source-event counts.'));
    v_extra_errors := v_extra_errors+1;
  end if;

  v_raw := jsonb_set(v_raw,'{issues}',coalesce(v_raw->'issues','[]'::jsonb)||v_extra,true);
  v_raw := jsonb_set(v_raw,'{sections,asset_aggregate_regression}',jsonb_build_object(
    'collection_catalog_mismatch_count',v_collection_mismatch,
    'item_catalog_mismatch_count',v_item_mismatch,
    'character_student_event_mismatch_count',v_character_event_mismatch
  ),true);
  v_raw := jsonb_set(v_raw,'{summary,error_issue_types}',to_jsonb(coalesce((v_raw->'summary'->>'error_issue_types')::integer,0)+v_extra_errors),true);
  if v_extra_errors>0 then
    v_raw := jsonb_set(v_raw,'{summary,status}',to_jsonb('ERROR'::text),true);
  end if;

  return v_raw;
end;
$$;

revoke all on function public.teacher_get_data_validation_report(integer,boolean) from public,anon;
grant execute on function public.teacher_get_data_validation_report(integer,boolean) to authenticated,service_role;