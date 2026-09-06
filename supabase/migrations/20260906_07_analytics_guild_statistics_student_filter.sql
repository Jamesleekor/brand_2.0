alter function public.teacher_get_guild_statistics(integer,integer,text,boolean)
  rename to _analytics_guild_statistics_raw;

revoke all on function public._analytics_guild_statistics_raw(integer,integer,text,boolean) from public,anon,authenticated;
grant execute on function public._analytics_guild_statistics_raw(integer,integer,text,boolean) to service_role;

create or replace function public.teacher_get_guild_statistics(
  p_classroom_id integer,
  p_season_id integer default null,
  p_year_month text default null,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw jsonb;
  v_students jsonb;
  v_eligible_count integer;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_raw := public._analytics_guild_statistics_raw(
    p_classroom_id,
    p_season_id,
    p_year_month,
    p_include_test
  );

  select coalesce(jsonb_agg(x.elem order by x.elem->>'student_name', (x.elem->>'student_id')::integer),'[]'::jsonb),
         count(*)::integer
    into v_students,v_eligible_count
  from jsonb_array_elements(coalesce(v_raw->'student_rows','[]'::jsonb)) x(elem)
  join public.students s on s.id=(x.elem->>'student_id')::integer
  where s.classroom_id=p_classroom_id
    and s.transferred_at is null
    and (
      s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      or (p_include_test and s.role::text='TEST')
    )
    and (p_include_test or not coalesce(s.is_test_account,false));

  v_raw := jsonb_set(v_raw,'{student_rows}',v_students,true);
  v_raw := jsonb_set(
    v_raw,
    '{data_quality}',
    coalesce(v_raw->'data_quality','{}'::jsonb)
      || jsonb_build_object('eligible_student_count',v_eligible_count),
    true
  );

  return v_raw;
end;
$$;

revoke all on function public.teacher_get_guild_statistics(integer,integer,text,boolean) from public,anon;
grant execute on function public.teacher_get_guild_statistics(integer,integer,text,boolean) to authenticated,service_role;