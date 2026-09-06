create or replace function public.teacher_get_student_statistics(
  p_classroom_id integer,
  p_student_id integer,
  p_guild_season_id integer default null,
  p_year_month text default null,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_student public.students%rowtype;
  v_e jsonb;
  v_a jsonb;
  v_x jsonb;
  v_t jsonb;
  v_g jsonb;
  v_r jsonb;
  v_e_student jsonb;
  v_a_student jsonb;
  v_char_student jsonb;
  v_coll_student jsonb;
  v_item_student jsonb;
  v_att_student jsonb;
  v_guild_student jsonb;
  v_arcade_summary jsonb;
  v_arcade_games jsonb;
  v_login_count bigint:=0;
  v_login_days bigint:=0;
  v_last_login timestamptz;
  v_recent_activity timestamptz;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  select * into v_student from public.students s
  where s.id=p_student_id and s.classroom_id=p_classroom_id and s.transferred_at is null;
  if not found then
    raise exception 'Student not found in active classroom' using errcode='P0620';
  end if;

  if v_student.role::text not in ('STUDENT','STUDENT_LEADER','GUARD','TEST') then
    raise exception 'Selected account is not a student analytics subject' using errcode='P0621';
  end if;
  if (v_student.role::text='TEST' or coalesce(v_student.is_test_account,false)) and not p_include_test then
    raise exception 'Test account is excluded unless p_include_test=true' using errcode='P0622';
  end if;

  v_e := public.teacher_get_statistics_economy(p_classroom_id,p_include_test);
  v_a := public.teacher_get_statistics_achievements(p_classroom_id,p_include_test);
  v_x := public.teacher_get_statistics_assets(p_classroom_id,p_include_test);
  v_t := public.teacher_get_statistics_attendance(p_classroom_id,p_include_test);
  v_g := public.teacher_get_guild_statistics(p_classroom_id,p_guild_season_id,p_year_month,p_include_test);
  v_r := public.teacher_get_arcade_statistics(p_classroom_id,p_guild_season_id,p_year_month,p_include_test);

  select e into v_e_student from jsonb_array_elements(coalesce(v_e->'students','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_a_student from jsonb_array_elements(coalesce(v_a->'students','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_char_student from jsonb_array_elements(coalesce(v_x->'characters'->'students','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_coll_student from jsonb_array_elements(coalesce(v_x->'collections'->'students','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_item_student from jsonb_array_elements(coalesce(v_x->'items'->'students','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_att_student from jsonb_array_elements(coalesce(v_t->'students','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_guild_student from jsonb_array_elements(coalesce(v_g->'student_rows','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select e into v_arcade_summary from jsonb_array_elements(coalesce(v_r->'student_summaries','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id limit 1;
  select coalesce(jsonb_agg(e order by e->>'game_code'),'[]'::jsonb) into v_arcade_games
  from jsonb_array_elements(coalesce(v_r->'student_game_rows','[]'::jsonb)) e where (e->>'student_id')::integer=p_student_id;

  select count(*)::bigint,
         count(distinct (h.occurred_at at time zone 'Asia/Seoul')::date)::bigint,
         max(h.occurred_at)
    into v_login_count,v_login_days,v_last_login
  from public.auth_login_history h
  where h.classroom_id=p_classroom_id and h.student_id=p_student_id and h.event_type='LOGIN_SUCCESS';

  select max(ts) into v_recent_activity
  from (
    select max(h.occurred_at) as ts from public.auth_login_history h where h.student_id=p_student_id
    union all select max(t.created_at) from public.transactions t where t.student_id=p_student_id and coalesce(t.is_reversed,false)=false
    union all select max(sa.achieved_at) from public.student_achievements sa where sa.student_id=p_student_id
    union all select max(cae.created_at) from public.character_acquisition_events cae where cae.student_id=p_student_id
    union all select max(ie.created_at) from public.inventory_events ie where ie.student_id=p_student_id
    union all select max(a.attendance_date::timestamp at time zone 'Asia/Seoul') from public.attendances a where a.student_id=p_student_id
    union all select max(gme.effective_at) from public.guild_membership_events gme where gme.student_id=p_student_id
    union all select max(ar.created_at) from public.arcade_runs ar where ar.student_id=p_student_id and not ar.is_prerelease_test
  ) q;

  return jsonb_build_object(
    'student',jsonb_build_object(
      'student_id',v_student.id,'student_name',v_student.name,'brand_name',v_student.brand_name,
      'role',v_student.role::text,'is_test_account',coalesce(v_student.is_test_account,false)
    ),
    'activity',jsonb_build_object(
      'total_login_count',coalesce(v_login_count,0),
      'total_login_days',coalesce(v_login_days,0),
      'last_login_at',v_last_login,
      'recent_activity_at',v_recent_activity,
      'login_tracking_start_at',(select min(h.occurred_at) from public.auth_login_history h where h.classroom_id=p_classroom_id)
    ),
    'economy',coalesce(v_e_student,'{}'::jsonb),
    'achievements',coalesce(v_a_student,'{}'::jsonb),
    'characters',coalesce(v_char_student,'{}'::jsonb),
    'collections',coalesce(v_coll_student,'{}'::jsonb),
    'items',coalesce(v_item_student,'{}'::jsonb),
    'attendance',coalesce(v_att_student,'{}'::jsonb),
    'guild',coalesce(v_guild_student,'{}'::jsonb),
    'arcade',jsonb_build_object('summary',coalesce(v_arcade_summary,'{}'::jsonb),'games',v_arcade_games),
    'coverage',jsonb_build_object(
      'economy',v_e->'coverage','assets',v_x->'coverage','attendance_rules',v_t->'rules',
      'guild_definitions',v_g->'definitions','arcade_definitions',v_r->'definitions'
    ),
    'data_quality',jsonb_build_object(
      'missing_economy_row',v_e_student is null,
      'missing_achievement_row',v_a_student is null,
      'missing_character_row',v_char_student is null,
      'missing_collection_row',v_coll_student is null,
      'missing_item_row',v_item_student is null,
      'missing_attendance_row',v_att_student is null,
      'missing_guild_row',v_guild_student is null,
      'missing_arcade_summary',v_arcade_summary is null
    )
  );
end;
$$;

revoke all on function public.teacher_get_student_statistics(integer,integer,integer,text,boolean) from public,anon;
grant execute on function public.teacher_get_student_statistics(integer,integer,integer,text,boolean) to authenticated,service_role;