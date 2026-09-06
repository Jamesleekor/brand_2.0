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
  v_e jsonb;
  v_a jsonb;
  v_x jsonb;
  v_t jsonb;
  v_g jsonb;
  v_r jsonb;
  v_issues jsonb;
  v_error_count integer;
  v_warning_count integer;
  v_info_count integer;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_e := public.teacher_get_statistics_economy(p_classroom_id,p_include_test);
  v_a := public.teacher_get_statistics_achievements(p_classroom_id,p_include_test);
  v_x := public.teacher_get_statistics_assets(p_classroom_id,p_include_test);
  v_t := public.teacher_get_statistics_attendance(p_classroom_id,p_include_test);
  v_g := public.teacher_get_guild_statistics(p_classroom_id,null,null,p_include_test);
  v_r := public.teacher_get_arcade_statistics(p_classroom_id,null,null,p_include_test);

  with checks as (
    select 'ERROR' severity,'ECONOMY_LEGACY_DONATION_BASELINE_MISMATCH' code,
           coalesce((v_e->'data_quality'->>'legacy_donation_baseline_mismatch_count')::int,0) count_value,
           'Legacy donation reconstruction does not match migration baseline.' message
    union all select 'ERROR','ECONOMY_NEGATIVE_PURE_TAX',coalesce((v_e->'data_quality'->>'negative_pure_tax_count')::int,0),'Pure tax becomes negative after separating balance-development burden.'
    union all select 'ERROR','ECONOMY_TIER_CATALOG_MISMATCH',coalesce((v_e->'data_quality'->>'tier_catalog_mismatch_count')::int,0),'Analytics tier catalog disagrees with calculate_tier_from_bv().'
    union all select 'ERROR','ACHIEVEMENT_DUPLICATE_ACTIVE_GRANT',coalesce((v_a->'data_quality'->>'duplicate_active_grant_pairs')::int,0),'A student has duplicate active grants for the same achievement.'
    union all select 'INFO','ACHIEVEMENT_CATALOG_WITHOUT_GALAXY',coalesce((v_a->'data_quality'->>'catalog_without_galaxy')::int,0),'Achievements are not assigned to a galaxy/category; this is allowed but category analytics are incomplete.'
    union all select 'ERROR','ITEM_INVENTORY_LEDGER_MISMATCH',coalesce((v_x->'data_quality'->>'inventory_quantity_mismatch_pairs')::int,0),'Inventory event ledger does not reconcile to current inventory.'
    union all select 'ERROR','CHARACTER_OWNED_WITHOUT_POSITIVE_EVENT',coalesce((v_x->'data_quality'->>'current_owned_character_without_positive_event')::int,0),'Owned fragment/character has no positive acquisition event.'
    union all select 'WARNING','COLLECTION_COMPLETE_WITHOUT_RECONSTRUCTED_FIRST',coalesce((v_x->'data_quality'->>'current_collection_complete_without_reconstructed_first')::int,0),'Current collection completion cannot be reconstructed from the event stream.'
    union all select 'ERROR','ATTENDANCE_DUPLICATE_STUDENT_DATE',coalesce((v_t->'data_quality'->>'duplicate_student_date_rows')::int,0),'More than one attendance row exists for the same student/date.'
    union all select 'ERROR','ATTENDANCE_NEGATIVE_STREAK',coalesce((v_t->'data_quality'->>'negative_streak_rows')::int,0),'Attendance streak_days contains a negative value.'
    union all select 'ERROR','GUILD_FINALIZED_WITHOUT_CURRENT_VERSION',coalesce((v_g->'data_quality'->>'finalized_closure_without_current_version')::int,0),'A finalized guild month has no current immutable version.'
    union all select 'ERROR','GUILD_FINALIZED_WITHOUT_GUILD_SNAPSHOT',coalesce((v_g->'data_quality'->>'finalized_version_without_guild_snapshots')::int,0),'A finalized guild version has no guild snapshots.'
    union all select 'ERROR','GUILD_FINALIZED_WITHOUT_STUDENT_SNAPSHOT',coalesce((v_g->'data_quality'->>'finalized_version_without_student_snapshots')::int,0),'A finalized guild version has no student snapshots.'
    union all select 'ERROR','GUILD_TEST_IN_OFFICIAL_SNAPSHOT',coalesce((v_g->'data_quality'->>'test_students_in_official_snapshots')::int,0),'A TEST account appears in an official guild snapshot.'
    union all select 'ERROR','ARCADE_ACTIVE_GAME_WITHOUT_SEMANTICS',coalesce((v_r->'data_quality'->>'active_game_without_semantics')::int,0),'An active Arcade game has no analytics ranking semantics.'
    union all select 'ERROR','ARCADE_VERIFIED_WITHOUT_SCORE',coalesce((v_r->'data_quality'->>'verified_run_without_score')::int,0),'A VERIFIED Arcade run has no official score.'
    union all select 'ERROR','ARCADE_VERIFIED_WITHOUT_GAME_OVER',coalesce((v_r->'data_quality'->>'verified_run_without_game_over_at')::int,0),'A VERIFIED Arcade run has no game_over_at.'
    union all select 'ERROR','ARCADE_FINALIZED_WITHOUT_FINALIZATION',coalesce((v_r->'data_quality'->>'finalized_monthly_period_without_finalization')::int,0),'A FINALIZED monthly Arcade period has no finalization parent.'
    union all select 'ERROR','ARCADE_TEST_IN_OFFICIAL_SNAPSHOT',coalesce((v_r->'data_quality'->>'snapshot_test_student_rows')::int,0),'A TEST account appears in an official Arcade snapshot.'
    union all select 'ERROR','ARCADE_SNAPSHOT_NONVERIFIED_SOURCE',coalesce((v_r->'data_quality'->>'snapshot_nonverified_source_runs')::int,0),'An official Arcade snapshot points to a non-VERIFIED run.'
    union all select 'ERROR','ARCADE_SNAPSHOT_INVALIDATED_SOURCE',(
      select count(*)::int
      from public.arcade_monthly_snapshot_student_ranks sr
      join public.arcade_monthly_snapshots sn on sn.id=sr.snapshot_id
      where sn.classroom_id=p_classroom_id
        and exists(select 1 from public.arcade_run_moderation_events m where m.run_id=sr.source_run_id and m.event_kind='INVALIDATE')
    ),'An official Arcade snapshot points to an invalidated run.'
    union all select 'ERROR','LOGIN_DUPLICATE_SESSION_EVENT',(
      select count(*)::int from (
        select h.session_id,h.event_type from public.auth_login_history h
        where h.classroom_id=p_classroom_id and h.session_id is not null
        group by h.session_id,h.event_type having count(*)>1
      ) q
    ),'Duplicate login events exist for the same session/event type.'
    union all select 'ERROR','LOGIN_STUDENT_EVENT_WITHOUT_STUDENT',(
      select count(*)::int from public.auth_login_history h
      where h.classroom_id=p_classroom_id and h.actor_kind='STUDENT' and h.student_id is null
    ),'A student login-history event has lost its student reference.'
  ), issue_rows as (
    select severity,code,count_value,message
    from checks where count_value>0
  )
  select coalesce(jsonb_agg(jsonb_build_object('severity',severity,'code',code,'count',count_value,'message',message)
                            order by case severity when 'ERROR' then 1 when 'WARNING' then 2 else 3 end,code),'[]'::jsonb),
         count(*) filter (where severity='ERROR')::int,
         count(*) filter (where severity='WARNING')::int,
         count(*) filter (where severity='INFO')::int
    into v_issues,v_error_count,v_warning_count,v_info_count
  from issue_rows;

  return jsonb_build_object(
    'generated_at',clock_timestamp(),
    'classroom_id',p_classroom_id,
    'summary',jsonb_build_object(
      'status',case when coalesce(v_error_count,0)>0 then 'ERROR' when coalesce(v_warning_count,0)>0 then 'WARNING' else 'OK' end,
      'error_issue_types',coalesce(v_error_count,0),
      'warning_issue_types',coalesce(v_warning_count,0),
      'info_issue_types',coalesce(v_info_count,0)
    ),
    'issues',v_issues,
    'sections',jsonb_build_object(
      'economy',v_e->'data_quality',
      'achievements',v_a->'data_quality',
      'assets',v_x->'data_quality',
      'attendance',v_t->'data_quality',
      'guild',v_g->'data_quality',
      'arcade',v_r->'data_quality'
    )
  );
end;
$$;

revoke all on function public.teacher_get_data_validation_report(integer,boolean) from public,anon;
grant execute on function public.teacher_get_data_validation_report(integer,boolean) to authenticated,service_role;