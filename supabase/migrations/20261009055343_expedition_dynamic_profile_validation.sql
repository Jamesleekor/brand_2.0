-- B.R.A.N.D 2.0 Fragment Expedition
-- Remove fixed 79-character assumptions from release/profile validation.
-- Production migration version: 20261009055343

create or replace function public.teacher_validate_expedition_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.ensure_teacher_role();

  with active_characters as (
    select c.id,c.character_uid
    from public.characters c
    where c.is_active = true
  ),
  profile_rows as (
    select
      ac.id,
      ac.character_uid,
      cep.specialty_code,
      cep.fragment_restore_cost,
      cep.profile_status,
      e.specialty_code as valid_specialty_code,
      ep.character_id as element_profile_character_id
    from active_characters ac
    left join public.character_expedition_profiles cep on cep.character_id = ac.id
    left join public.expedition_specialties e
      on e.specialty_code = cep.specialty_code and e.is_active = true
    left join public.character_element_profiles ep on ep.character_id = ac.id
  ),
  specialty_counts as (
    select
      count(*) filter (where specialty_code='RUINS' and profile_status='ACTIVE')::int as ruins,
      count(*) filter (where specialty_code='NATURE' and profile_status='ACTIVE')::int as nature,
      count(*) filter (where specialty_code='SANCTUARY' and profile_status='ACTIVE')::int as sanctuary
    from profile_rows
  ),
  counts as (
    select
      count(*)::int as active_character_count,
      count(*) filter (where specialty_code is not null)::int as profile_count,
      count(*) filter (where profile_status='ACTIVE')::int as active_profile_count,
      count(*) filter (where specialty_code is null)::int as missing_profile_count,
      count(*) filter (where element_profile_character_id is null)::int as missing_element_profile_count,
      count(*) filter (where valid_specialty_code is null)::int as invalid_specialty_count,
      count(*) filter (where fragment_restore_cost is not null)::int as restore_eligible_count,
      count(*) filter (where fragment_restore_cost is null)::int as restore_excluded_count
    from profile_rows
  ),
  global_counts as (
    select
      count(*) filter (
        where cep.profile_status='ACTIVE'
          and not exists (
            select 1
            from public.characters c
            where c.id=cep.character_id
              and c.is_active=true
          )
      )::int as orphan_active_profile_count
    from public.character_expedition_profiles cep
  ),
  excluded as (
    select coalesce(
      jsonb_agg(character_uid order by character_uid)
        filter (where fragment_restore_cost is null),
      '[]'::jsonb
    ) as excluded_uids
    from profile_rows
  ),
  missing as (
    select coalesce(
      jsonb_agg(character_uid order by character_uid)
        filter (where specialty_code is null),
      '[]'::jsonb
    ) as missing_uids
    from profile_rows
  )
  select jsonb_build_object(
    'ok',
      c.active_character_count > 0
      and c.profile_count = c.active_character_count
      and c.active_profile_count = c.active_character_count
      and c.missing_profile_count = 0
      and c.missing_element_profile_count = 0
      and c.invalid_specialty_count = 0
      and gc.orphan_active_profile_count = 0,
    'profile_version','EXPEDITION_PROFILE_V1_4',
    'active_character_count',c.active_character_count,
    'profile_count',c.profile_count,
    'active_profile_count',c.active_profile_count,
    'missing_profile_count',c.missing_profile_count,
    'missing_profile_uids',m.missing_uids,
    'missing_element_profile_count',c.missing_element_profile_count,
    'invalid_specialty_count',c.invalid_specialty_count,
    'orphan_active_profile_count',gc.orphan_active_profile_count,
    'specialty_counts',jsonb_build_object(
      'RUINS',sc.ruins,'NATURE',sc.nature,'SANCTUARY',sc.sanctuary
    ),
    'restore_eligible_count',c.restore_eligible_count,
    'restore_excluded_count',c.restore_excluded_count,
    'restore_excluded_uids',ex.excluded_uids
  )
  into v_result
  from counts c
  cross join global_counts gc
  cross join specialty_counts sc
  cross join excluded ex
  cross join missing m;

  return v_result;
end
$$;

create or replace function public.teacher_validate_expedition_e2(p_classroom_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest_week_id bigint;
  v_active_characters integer;
  v_active_element_profiles integer;
  v_active_expedition_profiles integer;
  v_invalid_specialties integer;
begin
  if not public._expedition_teacher_can_manage_classroom(p_classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  select count(*) into v_active_characters
  from public.characters
  where is_active=true;

  select count(*) into v_active_element_profiles
  from public.characters c
  join public.character_element_profiles ep on ep.character_id=c.id
  where c.is_active=true;

  select count(*) into v_active_expedition_profiles
  from public.characters c
  join public.character_expedition_profiles xp on xp.character_id=c.id
  where c.is_active=true
    and xp.profile_status='ACTIVE';

  select count(*) into v_invalid_specialties
  from public.characters c
  join public.character_expedition_profiles xp on xp.character_id=c.id
  left join public.expedition_specialties es
    on es.specialty_code=xp.specialty_code
   and es.is_active=true
  where c.is_active=true
    and xp.profile_status='ACTIVE'
    and es.specialty_code is null;

  select id into v_latest_week_id
  from public.expedition_weeks
  where classroom_id=p_classroom_id
  order by week_start_date desc,id desc
  limit 1;

  return jsonb_build_object(
    'ok',
      (select count(*) from public.expedition_sites where is_active)=15
      and (select count(*) from public.expedition_environment_templates where is_active)=12
      and v_active_characters > 0
      and v_active_element_profiles=v_active_characters
      and v_active_expedition_profiles=v_active_characters
      and v_invalid_specialties=0,
    'classroom_id',p_classroom_id,
    'flags',(select jsonb_build_object(
      'core',is_core_enabled,
      'student_ui',is_student_ui_enabled,
      'scheduler',is_scheduler_enabled,
      'reward_grant',is_reward_grant_enabled
    ) from public.expedition_settings where classroom_id=p_classroom_id),
    'master_counts',jsonb_build_object(
      'sites',(select count(*) from public.expedition_sites where is_active),
      'environments',(select count(*) from public.expedition_environment_templates where is_active),
      'active_characters',v_active_characters,
      'element_profiles',v_active_element_profiles,
      'character_profiles',v_active_expedition_profiles,
      'invalid_specialties',v_invalid_specialties
    ),
    'latest_week_id',v_latest_week_id,
    'latest_week',(
      select case when w.id is null then null else jsonb_build_object(
        'id',w.id,
        'week_start_date',w.week_start_date,
        'week_index',w.week_index,
        'status',w.status,
        'reward_mode',w.reward_mode,
        'phase',public._expedition_current_phase(w.id,clock_timestamp()),
        'site_count',(select count(*) from public.expedition_week_sites ws where ws.week_id=w.id),
        'profile_snapshot_count',(select count(*) from public.expedition_week_character_profiles wp where wp.week_id=w.id),
        'run_count',(select count(*) from public.expedition_runs r where r.week_id=w.id)
      ) end
      from public.expedition_weeks w
      where w.id=v_latest_week_id
    )
  );
end
$$;

create or replace function public.teacher_validate_expedition_release(p_classroom_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_characters integer;
  v_active_element_profiles integer;
  v_char_profiles integer;
  v_invalid_specialties integer;
  v_orphan_active_profiles integer;
  v_restore_count integer;
  v_site_count integer;
  v_story_count integer;
  v_bad_box_tiers integer;
  v_bad_effect_windows integer;
  v_stale_objects integer;
  v_direct_browser_grants integer;
  v_cron_count integer;
  v_run_without_reward integer;
  v_run_without_record integer;
  v_settings public.expedition_settings%rowtype;
begin
  if not public._expedition_teacher_can_manage_classroom(p_classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  select * into v_settings
  from public.expedition_settings
  where classroom_id=p_classroom_id;

  select count(*) into v_active_characters
  from public.characters
  where is_active=true;

  select count(*) into v_active_element_profiles
  from public.characters c
  join public.character_element_profiles ep on ep.character_id=c.id
  where c.is_active=true;

  select count(*) into v_char_profiles
  from public.characters c
  join public.character_expedition_profiles xp on xp.character_id=c.id
  where c.is_active=true
    and xp.profile_status='ACTIVE';

  select count(*) into v_invalid_specialties
  from public.characters c
  join public.character_expedition_profiles xp on xp.character_id=c.id
  left join public.expedition_specialties es
    on es.specialty_code=xp.specialty_code
   and es.is_active=true
  where c.is_active=true
    and xp.profile_status='ACTIVE'
    and es.specialty_code is null;

  select count(*) into v_orphan_active_profiles
  from public.character_expedition_profiles xp
  where xp.profile_status='ACTIVE'
    and not exists (
      select 1
      from public.characters c
      where c.id=xp.character_id
        and c.is_active=true
    );

  select count(*) into v_restore_count
  from public.characters c
  join public.character_expedition_profiles xp on xp.character_id=c.id
  where c.is_active=true
    and xp.profile_status='ACTIVE'
    and xp.fragment_restore_cost is not null;

  select count(*) into v_site_count
  from public.expedition_sites
  where is_active=true;

  select count(*) into v_story_count
  from public.expedition_site_story_content;

  select count(*) into v_bad_box_tiers
  from (
    select box_tier
    from public.expedition_box_reward_catalog
    where is_active=true
    group by box_tier
    having sum(weight_bp)<>10000
  ) q;

  select count(*) into v_bad_effect_windows
  from public.expedition_world_effect_instances
  where ends_at-starts_at<>interval '168 hours';

  select count(*) into v_stale_objects
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and (
      c.relname ilike '%expedition%candidate%'
      or c.relname ilike '%expedition%reroll%'
    );

  select count(*) into v_direct_browser_grants
  from information_schema.role_table_grants g
  where g.table_schema='public'
    and g.grantee in ('anon','authenticated')
    and g.table_name in (
      'expedition_runs',
      'expedition_run_members',
      'expedition_run_rewards',
      'expedition_reward_claims',
      'expedition_fragment_balances',
      'expedition_fragment_ledger',
      'expedition_character_restorations',
      'expedition_box_reward_catalog',
      'expedition_box_openings',
      'expedition_site_progress',
      'expedition_site_mastery',
      'expedition_world_effect_instances',
      'expedition_week_operations',
      'expedition_run_records',
      'expedition_student_site_discoveries',
      'expedition_luxury_catalog',
      'expedition_supply_grants'
    );

  select count(*) into v_cron_count
  from cron.job
  where jobname='brand_fragment_expedition_lifecycle'
    and active=true;

  select count(*) into v_run_without_reward
  from public.expedition_runs r
  left join public.expedition_run_rewards rw on rw.run_id=r.id
  where r.classroom_id=p_classroom_id
    and rw.run_id is null;

  select count(*) into v_run_without_record
  from public.expedition_runs r
  left join public.expedition_run_records rr on rr.run_id=r.id
  where r.classroom_id=p_classroom_id
    and rr.run_id is null;

  return jsonb_build_object(
    'ok',
      v_settings.classroom_id is not null
      and v_active_characters > 0
      and v_active_element_profiles=v_active_characters
      and v_char_profiles=v_active_characters
      and v_invalid_specialties=0
      and v_orphan_active_profiles=0
      and v_site_count=15
      and v_story_count=15
      and v_bad_box_tiers=0
      and v_bad_effect_windows=0
      and v_stale_objects=0
      and v_direct_browser_grants=0
      and v_cron_count=1
      and v_run_without_reward=0
      and v_run_without_record=0,
    'classroom_id',p_classroom_id,
    'flags',case when v_settings.classroom_id is null then null else jsonb_build_object(
      'core',v_settings.is_core_enabled,
      'student_ui',v_settings.is_student_ui_enabled,
      'scheduler',v_settings.is_scheduler_enabled,
      'reward_grant',v_settings.is_reward_grant_enabled
    ) end,
    'catalog',jsonb_build_object(
      'active_characters',v_active_characters,
      'active_element_profiles',v_active_element_profiles,
      'active_character_profiles',v_char_profiles,
      'invalid_specialty_profiles',v_invalid_specialties,
      'orphan_active_profiles',v_orphan_active_profiles,
      'restorable_characters',v_restore_count,
      'active_sites',v_site_count,
      'story_sites',v_story_count,
      'luxury_items',(select count(*) from public.expedition_luxury_catalog where is_active=true),
      'luxury_assets_pending',not exists(
        select 1 from public.expedition_luxury_catalog where is_active=true
      )
    ),
    'integrity',jsonb_build_object(
      'bad_box_weight_tiers',v_bad_box_tiers,
      'bad_world_effect_windows',v_bad_effect_windows,
      'candidate_or_reroll_objects',v_stale_objects,
      'direct_browser_table_grants',v_direct_browser_grants,
      'active_lifecycle_cron_jobs',v_cron_count,
      'runs_without_reward_snapshot',v_run_without_reward,
      'runs_without_record_snapshot',v_run_without_record
    ),
    'runtime_counts',jsonb_build_object(
      'weeks',(select count(*) from public.expedition_weeks where classroom_id=p_classroom_id),
      'runs',(select count(*) from public.expedition_runs where classroom_id=p_classroom_id),
      'claims',(select count(*) from public.expedition_reward_claims where classroom_id=p_classroom_id),
      'discoveries',(select count(*) from public.expedition_student_site_discoveries where classroom_id=p_classroom_id),
      'restorations',(select count(*) from public.expedition_character_restorations where classroom_id=p_classroom_id),
      'box_openings',(select count(*) from public.expedition_box_openings where classroom_id=p_classroom_id),
      'supply_grants',(select count(*) from public.expedition_supply_grants where classroom_id=p_classroom_id)
    )
  );
end
$$;

create or replace function public.teacher_publish_expedition_week(p_week_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_week public.expedition_weeks%rowtype;
  v_settings public.expedition_settings%rowtype;
  v_release jsonb;
  v_expected_snapshot_count integer;
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

  select count(*) into v_expected_snapshot_count
  from public.characters
  where is_active=true;

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

  if v_snapshot_count<>v_expected_snapshot_count then
    raise exception 'EXPEDITION_WEEK_PROFILE_SNAPSHOT_EXPECTED_%_FOUND_%',
      v_expected_snapshot_count,v_snapshot_count
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
end
$$;
