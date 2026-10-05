-- B.R.A.N.D 2.0 Fragment Expedition — Teacher Operations Console
-- Production migration version: 20261003184037
-- IMPORTANT: production already has this migration. This file is for repository history.

create or replace function public.teacher_get_expedition_admin_board(
  p_classroom_id integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_monday date;
  v_suggested date;
  v_settings public.expedition_settings%rowtype;
  v_season public.expedition_seasons%rowtype;
  v_week public.expedition_weeks%rowtype;
  v_release jsonb;
begin
  if not public._expedition_teacher_can_manage_classroom(p_classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  select * into v_settings
  from public.expedition_settings
  where classroom_id=p_classroom_id;

  if not found then
    raise exception 'EXPEDITION_SETTINGS_NOT_FOUND'
      using errcode='P0E35';
  end if;

  select * into v_season
  from public.expedition_seasons
  where classroom_id=p_classroom_id
    and status='ACTIVE'
  order by id desc
  limit 1;

  v_monday:=v_today-(extract(isodow from v_today)::integer-1);
  if v_season.id is not null then
    v_suggested:=greatest(v_monday,v_season.starts_on);
    while exists(
      select 1 from public.expedition_weeks
      where classroom_id=p_classroom_id
        and week_start_date=v_suggested
    ) loop
      v_suggested:=v_suggested+7;
    end loop;
    if v_suggested>v_season.ends_on then
      v_suggested:=null;
    end if;
  end if;

  select * into v_week
  from public.expedition_weeks
  where classroom_id=p_classroom_id
  order by
    case status
      when 'PUBLISHED' then 0
      when 'DRAFT' then 1
      when 'SETTLED' then 2
      else 3
    end,
    week_start_date desc,
    id desc
  limit 1;

  v_release:=public.teacher_validate_expedition_release(p_classroom_id);

  return jsonb_build_object(
    'server_now',v_now,
    'classroom_id',p_classroom_id,
    'season',case when v_season.id is null then null else jsonb_build_object(
      'id',v_season.id,
      'season_code',v_season.season_code,
      'name',v_season.name_ko,
      'starts_on',v_season.starts_on,
      'ends_on',v_season.ends_on,
      'status',v_season.status
    ) end,
    'settings',jsonb_build_object(
      'schema_version',v_settings.schema_version,
      'core_enabled',v_settings.is_core_enabled,
      'student_ui_enabled',v_settings.is_student_ui_enabled,
      'scheduler_enabled',v_settings.is_scheduler_enabled,
      'reward_grant_enabled',v_settings.is_reward_grant_enabled,
      'publish_weekday',v_settings.publish_weekday,
      'publish_time_kst',v_settings.publish_time_kst::text,
      'sat_open_time_kst',v_settings.sat_open_time_kst::text,
      'sun_open_time_kst',v_settings.sun_open_time_kst::text,
      'settle_time_kst',v_settings.settle_time_kst::text,
      'world_effect_start_time_kst',v_settings.world_effect_start_time_kst::text,
      'world_effect_duration_hours',v_settings.world_effect_duration_hours
    ),
    'suggested_week_start',v_suggested,
    'release_validation',v_release,
    'active_world_effect',public._expedition_active_world_effect(p_classroom_id,v_now),
    'week',case when v_week.id is null then null else jsonb_build_object(
      'id',v_week.id,
      'week_index',v_week.week_index,
      'week_start_date',v_week.week_start_date,
      'status',v_week.status,
      'reward_mode',v_week.reward_mode,
      'phase',public._expedition_current_phase(v_week.id,v_now),
      'publish_at',v_week.publish_at,
      'sat_open_at',v_week.sat_open_at,
      'sun_open_at',v_week.sun_open_at,
      'sun_close_at',v_week.sun_close_at,
      'settle_at',v_week.settle_at,
      'published_at',v_week.published_at,
      'resolved_at',v_week.resolved_at,
      'world_effect_level',v_week.world_effect_level,
      'dominant_week_site_id',v_week.dominant_week_site_id,
      'sites',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',ws.id,
            'slot',ws.slot,
            'site_id',ws.site_id,
            'site_code',ws.site_code_snapshot,
            'site_name',ws.site_name_snapshot,
            'specialty_code',ws.specialty_code_snapshot,
            'core_reward_code',ws.core_reward_code_snapshot,
            'world_effect_code',ws.world_effect_code_snapshot,
            'environment_label',ws.environment_label_snapshot,
            'saturday_major_element',ws.saturday_major_element,
            'saturday_minor_element',ws.saturday_minor_element,
            'sunday_major_element',ws.sunday_major_element,
            'sunday_minor_element',ws.sunday_minor_element,
            'sunday_event_applied',ws.sunday_event_applied,
            'sunday_event_title',ws.sunday_event_title,
            'saturday_trace',coalesce((
              select sum(r.trace_contribution)
              from public.expedition_runs r
              where r.week_id=v_week.id
                and r.week_site_id=ws.id
                and r.phase='SAT'
                and r.counts_for_world=true
            ),0),
            'saturday_participants',coalesce((
              select count(distinct r.student_id)
              from public.expedition_runs r
              where r.week_id=v_week.id
                and r.week_site_id=ws.id
                and r.phase='SAT'
                and r.counts_for_world=true
            ),0),
            'sunday_trace',coalesce((
              select sum(r.trace_contribution)
              from public.expedition_runs r
              where r.week_id=v_week.id
                and r.week_site_id=ws.id
                and r.phase='SUN'
                and r.counts_for_world=true
            ),0),
            'sunday_participants',coalesce((
              select count(distinct r.student_id)
              from public.expedition_runs r
              where r.week_id=v_week.id
                and r.week_site_id=ws.id
                and r.phase='SUN'
                and r.counts_for_world=true
            ),0),
            'total_trace',coalesce((
              select sum(r.trace_contribution)
              from public.expedition_runs r
              where r.week_id=v_week.id
                and r.week_site_id=ws.id
                and r.counts_for_world=true
            ),0),
            'total_participants',coalesce((
              select count(distinct r.student_id)
              from public.expedition_runs r
              where r.week_id=v_week.id
                and r.week_site_id=ws.id
                and r.counts_for_world=true
            ),0),
            'final_level',ws.final_level,
            'mastery_advanced',ws.mastery_advanced,
            'cumulative_trace',coalesce(pr.cumulative_trace,0),
            'story_stage',coalesce(pr.highest_story_stage,0),
            'mastery_level',coalesce(ma.mastery_level,0),
            'is_dominant',(v_week.dominant_week_site_id=ws.id)
          )
          order by ws.slot
        )
        from public.expedition_week_sites ws
        left join public.expedition_site_progress pr
          on pr.season_id=v_week.season_id and pr.site_id=ws.site_id
        left join public.expedition_site_mastery ma
          on ma.season_id=v_week.season_id and ma.site_id=ws.site_id
        where ws.week_id=v_week.id
      ),'[]'::jsonb),
      'students',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'student_id',s.id,
            'name',s.name,
            'brand_name',s.brand_name,
            'is_test_account',s.is_test_account,
            'sat',case when sat.id is null then null else jsonb_build_object(
              'run_id',sat.id,
              'week_site_id',sat.week_site_id,
              'site_name',sat_ws.site_name_snapshot,
              'fit_percent',sat.fit_percent,
              'fit_grade',sat.fit_grade,
              'trace',sat.trace_contribution,
              'submitted_at',sat.submitted_at,
              'members',coalesce((
                select jsonb_agg(m.character_name_snapshot order by m.slot)
                from public.expedition_run_members m where m.run_id=sat.id
              ),'[]'::jsonb),
              'reward',case when sat_rw.run_id is null then null else jsonb_build_object(
                'tier',sat_rw.reward_tier,
                'kind',sat_rw.reward_kind,
                'quantity',sat_rw.quantity,
                'claim_status',coalesce(sat_cl.claim_status,'UNCLAIMED')
              ) end
            ) end,
            'sun',case when sun.id is null then null else jsonb_build_object(
              'run_id',sun.id,
              'week_site_id',sun.week_site_id,
              'site_name',sun_ws.site_name_snapshot,
              'fit_percent',sun.fit_percent,
              'fit_grade',sun.fit_grade,
              'trace',sun.trace_contribution,
              'submitted_at',sun.submitted_at,
              'members',coalesce((
                select jsonb_agg(m.character_name_snapshot order by m.slot)
                from public.expedition_run_members m where m.run_id=sun.id
              ),'[]'::jsonb),
              'reward',case when sun_rw.run_id is null then null else jsonb_build_object(
                'tier',sun_rw.reward_tier,
                'kind',sun_rw.reward_kind,
                'quantity',sun_rw.quantity,
                'claim_status',coalesce(sun_cl.claim_status,'UNCLAIMED')
              ) end
            ) end
          )
          order by s.is_test_account,s.name,s.id
        )
        from public.students s
        left join public.expedition_runs sat
          on sat.student_id=s.id and sat.week_id=v_week.id and sat.phase='SAT'
        left join public.expedition_week_sites sat_ws on sat_ws.id=sat.week_site_id
        left join public.expedition_run_rewards sat_rw on sat_rw.run_id=sat.id
        left join public.expedition_reward_claims sat_cl on sat_cl.run_id=sat.id
        left join public.expedition_runs sun
          on sun.student_id=s.id and sun.week_id=v_week.id and sun.phase='SUN'
        left join public.expedition_week_sites sun_ws on sun_ws.id=sun.week_site_id
        left join public.expedition_run_rewards sun_rw on sun_rw.run_id=sun.id
        left join public.expedition_reward_claims sun_cl on sun_cl.run_id=sun.id
        where s.classroom_id=p_classroom_id
          and s.role::text='STUDENT'
          and s.transferred_at is null
      ),'[]'::jsonb),
      'operations',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'code',op.operation_code,
            'completed_at',op.completed_at,
            'result',op.result_snapshot
          )
          order by op.completed_at,op.id
        )
        from public.expedition_week_operations op
        where op.week_id=v_week.id
      ),'[]'::jsonb),
      'world_effect',(
        select jsonb_build_object(
          'id',e.id,
          'effect_code',e.effect_code,
          'effect_level',e.effect_level,
          'starts_at',e.starts_at,
          'ends_at',e.ends_at
        )
        from public.expedition_world_effect_instances e
        where e.week_id=v_week.id
        limit 1
      )
    ) end
  );
end;
$function$;

revoke all on function public.teacher_get_expedition_admin_board(integer)
  from public,anon;
grant execute on function public.teacher_get_expedition_admin_board(integer)
  to authenticated,service_role;

create or replace function public.teacher_set_expedition_flags(
  p_classroom_id integer,
  p_core_enabled boolean,
  p_student_ui_enabled boolean,
  p_scheduler_enabled boolean,
  p_reward_grant_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_release jsonb;
begin
  if not public._expedition_teacher_can_manage_classroom(p_classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  if not p_core_enabled and (
    p_student_ui_enabled or p_scheduler_enabled or p_reward_grant_enabled
  ) then
    raise exception 'EXPEDITION_CORE_REQUIRED_FOR_DEPENDENT_FLAGS'
      using errcode='P0EC0';
  end if;

  if p_reward_grant_enabled and not p_student_ui_enabled then
    raise exception 'EXPEDITION_STUDENT_UI_REQUIRED_FOR_REWARD_GRANT'
      using errcode='P0EC1';
  end if;

  if p_reward_grant_enabled then
    v_release:=public.teacher_validate_expedition_release(p_classroom_id);
    if coalesce((v_release->>'ok')::boolean,false) is not true then
      raise exception 'EXPEDITION_RELEASE_VALIDATION_FAILED'
        using errcode='P0EC2',
              detail=v_release::text;
    end if;
  end if;

  update public.expedition_settings
  set is_core_enabled=p_core_enabled,
      is_student_ui_enabled=p_student_ui_enabled,
      is_scheduler_enabled=p_scheduler_enabled,
      is_reward_grant_enabled=p_reward_grant_enabled,
      updated_at=clock_timestamp()
  where classroom_id=p_classroom_id;

  if not found then
    raise exception 'EXPEDITION_SETTINGS_NOT_FOUND'
      using errcode='P0E35';
  end if;

  return jsonb_build_object(
    'classroom_id',p_classroom_id,
    'core_enabled',p_core_enabled,
    'student_ui_enabled',p_student_ui_enabled,
    'scheduler_enabled',p_scheduler_enabled,
    'reward_grant_enabled',p_reward_grant_enabled,
    'updated_at',clock_timestamp()
  );
end;
$function$;

revoke all on function public.teacher_set_expedition_flags(integer,boolean,boolean,boolean,boolean)
  from public,anon;
grant execute on function public.teacher_set_expedition_flags(integer,boolean,boolean,boolean,boolean)
  to authenticated,service_role;

create or replace function public.teacher_set_expedition_week_mode(
  p_week_id bigint,
  p_reward_mode text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_week public.expedition_weeks%rowtype;
begin
  if p_reward_mode not in ('DRY_RUN','LIVE') then
    raise exception 'EXPEDITION_REWARD_MODE_INVALID'
      using errcode='P0EC3';
  end if;

  select * into v_week
  from public.expedition_weeks
  where id=p_week_id
  for update;

  if not found then
    raise exception 'EXPEDITION_WEEK_NOT_FOUND'
      using errcode='P0E39';
  end if;

  if not public._expedition_teacher_can_manage_classroom(v_week.classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  if v_week.status<>'DRAFT' then
    raise exception 'EXPEDITION_WEEK_MODE_ONLY_DRAFT'
      using errcode='P0EC4';
  end if;

  if exists(
    select 1 from public.expedition_runs where week_id=p_week_id
  ) then
    raise exception 'EXPEDITION_WEEK_MODE_HAS_RUNS'
      using errcode='P0EC5';
  end if;

  update public.expedition_weeks
  set reward_mode=p_reward_mode,
      updated_at=clock_timestamp()
  where id=p_week_id;

  return jsonb_build_object(
    'week_id',p_week_id,
    'reward_mode',p_reward_mode,
    'status','DRAFT'
  );
end;
$function$;

revoke all on function public.teacher_set_expedition_week_mode(bigint,text)
  from public,anon;
grant execute on function public.teacher_set_expedition_week_mode(bigint,text)
  to authenticated,service_role;

-- LIVE-aware publish function. DRY_RUN behavior is preserved.
create or replace function public.teacher_publish_expedition_week(p_week_id bigint)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_week public.expedition_weeks%rowtype;
  v_settings public.expedition_settings%rowtype;
  v_release jsonb;
  v_snapshot_count integer;
  v_site_count integer;
  v_specialty_count integer;
begin
  select * into v_week
  from public.expedition_weeks
  where id=p_week_id
  for update;

  if not found then
    raise exception 'EXPEDITION_WEEK_NOT_FOUND'
      using errcode='P0E39';
  end if;

  if not public._expedition_teacher_can_manage_classroom(v_week.classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  if v_week.status='PUBLISHED' then
    return jsonb_build_object(
      'published',false,
      'already_published',true,
      'week_id',v_week.id,
      'status',v_week.status,
      'reward_mode',v_week.reward_mode
    );
  end if;

  if v_week.status<>'DRAFT' then
    raise exception 'EXPEDITION_WEEK_NOT_DRAFT status=%',v_week.status
      using errcode='P0E3A';
  end if;

  select * into v_settings
  from public.expedition_settings
  where classroom_id=v_week.classroom_id;

  if v_week.reward_mode='LIVE' then
    if not (
      v_settings.is_core_enabled
      and v_settings.is_student_ui_enabled
      and v_settings.is_reward_grant_enabled
    ) then
      raise exception 'EXPEDITION_LIVE_PUBLISH_FLAGS_NOT_READY'
        using errcode='P0EC6';
    end if;

    v_release:=public.teacher_validate_expedition_release(v_week.classroom_id);
    if coalesce((v_release->>'ok')::boolean,false) is not true then
      raise exception 'EXPEDITION_RELEASE_VALIDATION_FAILED'
        using errcode='P0EC2',
              detail=v_release::text;
    end if;
  end if;

  select count(*),count(distinct specialty_code_snapshot)
    into v_site_count,v_specialty_count
  from public.expedition_week_sites
  where week_id=v_week.id;

  if v_site_count<>3 or v_specialty_count<>3 then
    raise exception 'EXPEDITION_WEEK_REQUIRES_3_SPECIALTIES sites=% specialties=%',
      v_site_count,v_specialty_count using errcode='P0E3C';
  end if;

  delete from public.expedition_week_character_profiles
  where week_id=v_week.id;

  insert into public.expedition_week_character_profiles(
    week_id,character_id,character_uid_snapshot,character_name_snapshot,
    element_budget,primary_element,primary_points,secondary_element,secondary_points,
    specialty_code,source_element_updated_at,source_expedition_updated_at,
    profile_version,snapshotted_at
  )
  select
    v_week.id,c.id,c.character_uid,c.name,
    ep.element_budget,ep.primary_element,ep.primary_points,ep.secondary_element,ep.secondary_points,
    xp.specialty_code,ep.updated_at,xp.updated_at,xp.profile_version,clock_timestamp()
  from public.characters c
  join public.character_element_profiles ep on ep.character_id=c.id
  join public.character_expedition_profiles xp on xp.character_id=c.id
  where c.is_active=true
    and xp.profile_status='ACTIVE'
  order by c.character_uid;

  select count(*) into v_snapshot_count
  from public.expedition_week_character_profiles
  where week_id=v_week.id;

  if v_snapshot_count<>79 then
    raise exception 'EXPEDITION_WEEK_PROFILE_SNAPSHOT_EXPECTED_79_FOUND_%',v_snapshot_count
      using errcode='P0E3D';
  end if;

  update public.expedition_weeks
  set status='PUBLISHED',
      published_at=clock_timestamp(),
      config_snapshot=jsonb_build_object(
        'schema_version',v_settings.schema_version,
        'fit_formula_version','ELEM_70_30_V1',
        'world_trace_thresholds',jsonb_build_array(
          v_settings.world_trace_lv1,v_settings.world_trace_lv2,v_settings.world_trace_lv3
        ),
        'map_mastery_threshold',v_settings.map_mastery_threshold,
        'story_trace_thresholds',jsonb_build_array(
          v_settings.story_trace_faint,
          v_settings.story_trace_discovery,
          v_settings.story_trace_active,
          v_settings.story_trace_breakthrough
        ),
        'world_effect_start_time_kst',v_settings.world_effect_start_time_kst::text,
        'world_effect_duration_hours',v_settings.world_effect_duration_hours,
        'sunday_recovery_rule','SATURDAY_MEMBERS_CANNOT_RUN_SUNDAY',
        'environment_config_version','ENV_V1'
      ),
      reward_pool_snapshot=jsonb_build_object(
        'stage','E9',
        'mode',v_week.reward_mode,
        'reward_formula_version','REWARD_SNAPSHOT_V1',
        'candidate_model',false,
        'reroll_model',false,
        'tier_odds',jsonb_build_object(
          'VULNERABLE',jsonb_build_object('COMMON',76,'INTERMEDIATE',21,'RARE',3),
          'NORMAL',jsonb_build_object('COMMON',70,'INTERMEDIATE',26,'RARE',4),
          'STABLE',jsonb_build_object('COMMON',60,'INTERMEDIATE',33,'RARE',7),
          'STRONG',jsonb_build_object('COMMON',48,'INTERMEDIATE',40,'RARE',12)
        ),
        'nature_gold',jsonb_build_object('COMMON',200,'INTERMEDIATE',400,'RARE',600),
        'sanctuary_fragments',jsonb_build_object(
          'COMMON',jsonb_build_array(3,4),
          'INTERMEDIATE',jsonb_build_array(5,7),
          'RARE',jsonb_build_array(8,11)
        ),
        'ruins_boxes',jsonb_build_object(
          'COMMON','EXPEDITION_BOX_COMMON',
          'INTERMEDIATE','EXPEDITION_BOX_INTERMEDIATE',
          'RARE','EXPEDITION_BOX_RARE'
        ),
        'grant_enabled',v_settings.is_reward_grant_enabled
      ),
      updated_at=clock_timestamp()
  where id=v_week.id;

  return jsonb_build_object(
    'published',true,
    'already_published',false,
    'week_id',v_week.id,
    'profile_snapshot_count',v_snapshot_count,
    'status','PUBLISHED',
    'reward_mode',v_week.reward_mode,
    'reward_formula_version','REWARD_SNAPSHOT_V1'
  );
end;
$function$;

revoke all on function public.teacher_publish_expedition_week(bigint)
  from public,anon;
grant execute on function public.teacher_publish_expedition_week(bigint)
  to authenticated,service_role;
