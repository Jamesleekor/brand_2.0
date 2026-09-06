create or replace function public.teacher_get_analytics_dashboard(
  p_classroom_id integer,
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
  v_e jsonb;
  v_a jsonb;
  v_x jsonb;
  v_t jsonb;
  v_g jsonb;
  v_r jsonb;
  v_v jsonb;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_e := public.teacher_get_statistics_economy(p_classroom_id,p_include_test);
  v_a := public.teacher_get_statistics_achievements(p_classroom_id,p_include_test);
  v_x := public.teacher_get_statistics_assets(p_classroom_id,p_include_test);
  v_t := public.teacher_get_statistics_attendance(p_classroom_id,p_include_test);
  v_g := public.teacher_get_guild_statistics(p_classroom_id,p_guild_season_id,p_year_month,p_include_test);
  v_r := public.teacher_get_arcade_statistics(p_classroom_id,p_guild_season_id,p_year_month,p_include_test);
  v_v := public.teacher_get_data_validation_report(p_classroom_id,p_include_test);

  select jsonb_build_object(
    'generated_at',clock_timestamp(),
    'classroom_id',p_classroom_id,
    'scope',jsonb_build_object('guild',v_g->'scope','arcade',v_r->'scope','include_test',p_include_test),
    'headline',jsonb_build_object(
      'official_student_count',(select count(*) from public.students s where s.classroom_id=p_classroom_id and s.transferred_at is null and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and (p_include_test or not coalesce(s.is_test_account,false))),
      'current_gold',v_e->'class_summary'->'current_gold',
      'current_bv',v_e->'class_summary'->'current_bv',
      'donation_total',v_e->'class_summary'->'donation_total',
      'pure_tax_total',v_e->'class_summary'->'pure_tax_total',
      'balance_development_burden_total',v_e->'class_summary'->'balance_development_burden_total',
      'active_achievement_count',v_a->'active_catalog_count',
      'character_catalog_count',jsonb_array_length(coalesce(v_x->'characters'->'catalog','[]'::jsonb)),
      'collection_catalog_count',jsonb_array_length(coalesce(v_x->'collections'->'catalog','[]'::jsonb)),
      'item_catalog_count',jsonb_array_length(coalesce(v_x->'items'->'catalog','[]'::jsonb)),
      'guild_count',jsonb_array_length(coalesce(v_g->'guild_rows','[]'::jsonb)),
      'arcade_game_count',jsonb_array_length(coalesce(v_r->'games','[]'::jsonb))
    ),
    'economy_summary',v_e->'class_summary',
    'attendance_summary',v_t->'class_summary',
    'guild_summary',jsonb_build_object('official_finalized_month_count',v_g->'data_quality'->'official_finalized_month_count','finalized_mission_instance_count',v_g->'data_quality'->'finalized_mission_instance_count','live_guilds',v_g->'guild_rows'),
    'arcade_summary',jsonb_build_object('period',v_r->'scope','games',v_r->'games','current_period_rank_count',v_r->'data_quality'->'current_period_rank_count','official_finalization_count',v_r->'data_quality'->'official_finalization_count'),
    'achievement_summary',jsonb_build_object('active_catalog_count',v_a->'active_catalog_count','first_transcendent',v_a->'transcendent'->'first_achiever','transcendent_max_owners',v_a->'transcendent'->'max_owners'),
    'candidate_queue',jsonb_build_object(
      'total_count',(select count(*) from public.records_candidates c where c.classroom_id=p_classroom_id),
      'status_counts',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.records_candidates where classroom_id=p_classroom_id group by status) q),'{}'::jsonb),
      'needs_action_count',(select count(*) from public.records_candidates c where c.classroom_id=p_classroom_id and c.status in ('PENDING','NEEDS_REVIEW')),
      'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc nulls last,x.id desc) from (
        select c.id,c.candidate_type,c.student_id,c.student_name_snapshot,c.brand_name_snapshot,c.guild_id,c.guild_name_snapshot,c.value_numeric,c.value_text,c.occurred_at,c.status,c.coverage,c.record_title,c.record_hall_key
        from public.records_candidates c where c.classroom_id=p_classroom_id and c.status in ('PENDING','NEEDS_REVIEW') order by c.occurred_at desc nulls last,c.id desc limit 12
      ) x),'[]'::jsonb)
    ),
    'validation',jsonb_build_object('summary',v_v->'summary','issues',v_v->'issues'),
    'records_room',jsonb_build_object('active_historical_entries',(select count(*) from public.records_historical_entries r where r.status='ACTIVE'),'monthly_mvp_entries',(select count(*) from public.records_monthly_mvp_archive m)),
    'coverage',jsonb_build_object('economy',v_e->'coverage','assets',v_x->'coverage','guild',v_g->'definitions','arcade',v_r->'definitions')
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.teacher_get_analytics_dashboard(integer,integer,text,boolean) from public,anon;
grant execute on function public.teacher_get_analytics_dashboard(integer,integer,text,boolean) to authenticated,service_role;