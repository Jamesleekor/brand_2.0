-- Expedition roles: preserve current/historical weeks; activate for new weeks from 2026-10-26.
alter table public.expedition_weeks drop constraint expedition_weeks_formula_chk;
alter table public.expedition_weeks add constraint expedition_weeks_formula_chk
check(fit_formula_version in ('ELEM_70_30_V1','ELEM_70_30_COUNTER_V2','ELEM_70_30_ROLES_V3'));
alter table public.expedition_runs drop constraint expedition_runs_formula_chk;
alter table public.expedition_runs add constraint expedition_runs_formula_chk
check(fit_formula_version in ('ELEM_70_30_V1','ELEM_70_30_COUNTER_V2','ELEM_70_30_ROLES_V3'));
CREATE OR REPLACE FUNCTION public._expedition_compute_fit_v1(p_week_site_id bigint, p_phase text, p_character_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ws public.expedition_week_sites%rowtype;
  v_major text;
  v_minor text;
  v_major_target text;
  v_minor_target text;
  v_formula text;
  v_slot integer;
  v_character_id bigint;
  v_profile public.expedition_week_character_profiles%rowtype;
  v_major_points integer;
  v_minor_points integer;
  v_major_sum integer := 0;
  v_minor_sum integer := 0;
  v_match_count integer := 0;
  v_major_component numeric;
  v_minor_component numeric;
  v_specialty_bonus integer;
  v_fit integer;
  v_roles boolean := false;
  v_captain_major integer := 0;
  v_captain_minor integer := 0;
  v_base_fit integer;
  v_before_vice integer;
  v_captain_bonus integer := 0;
  v_vice_bonus integer := 0;
  v_vice_eligible integer := 0;
  v_effective_major numeric;
  v_effective_minor numeric;
  v_grade text;
  v_grade_ko text;
  v_trace integer;
  v_members jsonb := '[]'::jsonb;
begin
  if p_phase not in ('SAT','SUN') then
    raise exception 'EXPEDITION_INVALID_PHASE'
      using errcode='P0E30';
  end if;

  if coalesce(array_length(p_character_ids,1),0) <> 3
     or (select count(distinct x) from unnest(p_character_ids) x) <> 3
     or exists (select 1 from unnest(p_character_ids) x where x is null) then
    raise exception 'EXPEDITION_PARTY_MUST_HAVE_3_DISTINCT_CHARACTERS'
      using errcode='P0E31';
  end if;

  select * into v_ws
  from public.expedition_week_sites
  where id=p_week_site_id;

  if not found then
    raise exception 'EXPEDITION_WEEK_SITE_NOT_FOUND'
      using errcode='P0E32';
  end if;

  if p_phase='SAT' then
    v_major := v_ws.saturday_major_element;
    v_minor := v_ws.saturday_minor_element;
  else
    v_major := v_ws.sunday_major_element;
    v_minor := v_ws.sunday_minor_element;
  end if;

  select w.fit_formula_version into v_formula
  from public.expedition_weeks w where w.id=v_ws.week_id;

  v_roles := v_formula='ELEM_70_30_ROLES_V3';
  if v_formula in ('ELEM_70_30_COUNTER_V2','ELEM_70_30_ROLES_V3') then
    v_major_target := case v_major
      when 'WATER' then 'EARTH'
      when 'FIRE' then 'WATER'
      when 'WIND' then 'FIRE'
      when 'EARTH' then 'WIND'
      when 'LIGHT' then 'DARK'
      when 'DARK' then 'LIGHT'
    end;
    v_minor_target := case v_minor
      when 'WATER' then 'EARTH'
      when 'FIRE' then 'WATER'
      when 'WIND' then 'FIRE'
      when 'EARTH' then 'WIND'
      when 'LIGHT' then 'DARK'
      when 'DARK' then 'LIGHT'
    end;
  elsif v_formula='ELEM_70_30_V1' then
    -- Retain historical test-week calculations under their original version.
    v_major_target := v_major;
    v_minor_target := v_minor;
  else
    raise exception 'EXPEDITION_UNKNOWN_FIT_FORMULA %',v_formula using errcode='22023';
  end if;

  for v_slot in 1..3 loop
    v_character_id := p_character_ids[v_slot];

    select * into v_profile
    from public.expedition_week_character_profiles
    where week_id=v_ws.week_id
      and character_id=v_character_id;

    if not found then
      raise exception 'EXPEDITION_CHARACTER_PROFILE_NOT_IN_WEEK character_id=%',v_character_id
        using errcode='P0E33';
    end if;

    v_major_points :=
      case when v_profile.primary_element=v_major_target then v_profile.primary_points else 0 end
      + case when v_profile.secondary_element=v_major_target then v_profile.secondary_points else 0 end;

    v_minor_points :=
      case when v_profile.primary_element=v_minor_target then v_profile.primary_points else 0 end
      + case when v_profile.secondary_element=v_minor_target then v_profile.secondary_points else 0 end;

    if v_slot=1 then
      v_captain_major := v_major_points;
      v_captain_minor := v_minor_points;
    elsif v_slot=2 and v_roles and v_profile.specialty_code=v_ws.specialty_code_snapshot then
      v_vice_eligible := 5;
    end if;

    v_major_sum := v_major_sum + v_major_points;
    v_minor_sum := v_minor_sum + v_minor_points;

    if v_profile.specialty_code=v_ws.specialty_code_snapshot then
      v_match_count := v_match_count + 1;
    end if;

    v_members := v_members || jsonb_build_array(
      jsonb_build_object(
        'slot',v_slot,
        'character_id',v_profile.character_id,
        'character_uid',v_profile.character_uid_snapshot,
        'character_name',v_profile.character_name_snapshot,
        'element_budget',v_profile.element_budget,
        'primary_element',v_profile.primary_element,
        'primary_points',v_profile.primary_points,
        'secondary_element',v_profile.secondary_element,
        'secondary_points',v_profile.secondary_points,
        'specialty_code',v_profile.specialty_code,
        'specialty_matched',(v_profile.specialty_code=v_ws.specialty_code_snapshot),
        'role',case when v_roles then (array['CAPTAIN','VICE_CAPTAIN','MEMBER'])[v_slot] else 'MEMBER' end,
        'element_multiplier',case when v_roles and v_slot=1 then 1.2 else 1.0 end,
        'major_points',v_major_points,
        'minor_points',v_minor_points
      )
    );
  end loop;

  v_specialty_bonus := least(v_match_count * 5,10);
  v_base_fit := round(70.0 * least(v_major_sum::numeric / 14.0, 1.20)
                   + 30.0 * least(v_minor_sum::numeric / 8.0, 1.20)
                   + v_specialty_bonus)::integer;
  v_effective_major := v_major_sum + case when v_roles then v_captain_major * 0.2 else 0 end;
  v_effective_minor := v_minor_sum + case when v_roles then v_captain_minor * 0.2 else 0 end;
  v_major_component := 70.0 * least(v_effective_major / 14.0, 1.20);
  v_minor_component := 30.0 * least(v_effective_minor / 8.0, 1.20);
  v_before_vice := round(v_major_component + v_minor_component + v_specialty_bonus)::integer;
  v_fit := case when v_roles then least(130,v_before_vice+v_vice_eligible) else v_before_vice end;
  v_captain_bonus := v_before_vice-v_base_fit;
  v_vice_bonus := v_fit-v_before_vice;

  if v_fit <= 30 then
    v_grade := 'VULNERABLE'; v_grade_ko := '취약'; v_trace := 1;
  elsif v_fit <= 59 then
    v_grade := 'NORMAL'; v_grade_ko := '보통'; v_trace := 1;
  elsif v_fit <= 89 then
    v_grade := 'STABLE'; v_grade_ko := '안정'; v_trace := 2;
  else
    v_grade := 'STRONG'; v_grade_ko := '강인'; v_trace := 3;
  end if;

  return jsonb_build_object(
    'fit_formula_version',v_formula,
    'role_bonus_enabled',v_roles,
    'base_fit_percent',v_base_fit,
    'captain_bonus_percent',v_captain_bonus,
    'vice_bonus_percent',v_vice_bonus,
    'vice_bonus_eligible',v_vice_eligible,
    'captain_element_multiplier',case when v_roles then 1.2 else 1.0 end,
    'fit_cap',130,
    'element_match_rule',case when v_formula in ('ELEM_70_30_COUNTER_V2','ELEM_70_30_ROLES_V3') then 'COUNTER_ELEMENT' else 'SAME_ELEMENT' end,
    'major_counter_element',v_major_target,
    'minor_counter_element',v_minor_target,
    'week_id',v_ws.week_id,
    'week_site_id',v_ws.id,
    'phase',p_phase,
    'major_element',v_major,
    'minor_element',v_minor,
    'major_sum',v_effective_major,
    'base_major_sum',v_major_sum,
    'base_minor_sum',v_minor_sum,
    'minor_sum',v_effective_minor,
    'specialty_match_count',v_match_count,
    'major_component',round(v_major_component,2),
    'minor_component',round(v_minor_component,2),
    'specialty_bonus',v_specialty_bonus,
    'fit_percent',v_fit,
    'fit_grade',v_grade,
    'fit_grade_ko',v_grade_ko,
    'trace_contribution',v_trace,
    'members',v_members
  );
end;
$function$;
CREATE OR REPLACE FUNCTION brand_expedition_scheduler.generate_week(p_classroom_id integer, p_week_start_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_week_start date;
  v_settings public.expedition_settings%rowtype;
  v_season public.expedition_seasons%rowtype;
  v_existing public.expedition_weeks%rowtype;
  v_week_id bigint;
  v_week_index integer;
  v_seed text;
  v_publish_at timestamptz;
  v_sat_open_at timestamptz;
  v_sun_open_at timestamptz;
  v_sun_close_at timestamptz;
  v_settle_at timestamptz;
  v_slot integer := 0;
  v_specialty text;
  v_site public.expedition_sites%rowtype;
  v_env public.expedition_environment_templates%rowtype;
  v_used_env_ids bigint[] := '{}'::bigint[];
  v_sites jsonb := '[]'::jsonb;
begin

  v_week_start := coalesce(
    p_week_start_date,
    ((clock_timestamp() at time zone 'Asia/Seoul')::date
      - (extract(isodow from (clock_timestamp() at time zone 'Asia/Seoul')::date)::integer - 1))
  );

  if extract(isodow from v_week_start)::integer <> 1 then
    raise exception 'EXPEDITION_WEEK_START_MUST_BE_MONDAY'
      using errcode='P0E34';
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
    and v_week_start between starts_on and ends_on
  order by id desc
  limit 1;

  if not found then
    raise exception 'EXPEDITION_ACTIVE_SEASON_NOT_FOUND_FOR_WEEK'
      using errcode='P0E36';
  end if;

  select * into v_existing
  from public.expedition_weeks
  where classroom_id=p_classroom_id
    and week_start_date=v_week_start;

  if found then
    return jsonb_build_object(
      'created',false,
      'week_id',v_existing.id,
      'status',v_existing.status,
      'reward_mode',v_existing.reward_mode,
      'week_start_date',v_existing.week_start_date,
      'week_index',v_existing.week_index
    );
  end if;

  v_week_index := ((v_week_start - v_season.starts_on) / 7) + 1;
  v_seed := md5(
    'EXPEDITION_V1_4|'
    || p_classroom_id::text || '|'
    || v_week_start::text || '|1'
  );

  v_publish_at := ((v_week_start + (v_settings.publish_weekday-1)) + v_settings.publish_time_kst)
                    at time zone 'Asia/Seoul';
  v_sat_open_at := ((v_week_start + 4) + v_settings.sat_open_time_kst)
                    at time zone 'Asia/Seoul';
  v_sun_open_at := ((v_week_start + 5) + v_settings.sun_open_time_kst)
                    at time zone 'Asia/Seoul';
  v_sun_close_at := ((v_week_start + 6) + v_settings.sun_open_time_kst)
                    at time zone 'Asia/Seoul';
  v_settle_at := ((v_week_start + 6) + v_settings.settle_time_kst)
                    at time zone 'Asia/Seoul';

  insert into public.expedition_weeks(
    season_id,classroom_id,week_index,week_start_date,generation_no,week_seed,
    status,reward_mode,publish_at,sat_open_at,sun_open_at,sun_close_at,settle_at,
    fit_formula_version,config_snapshot,reward_pool_snapshot
  )
  values(
    v_season.id,p_classroom_id,v_week_index,v_week_start,1,v_seed,
    'DRAFT','DRY_RUN',v_publish_at,v_sat_open_at,v_sun_open_at,v_sun_close_at,v_settle_at,
    case when v_week_start>=date '2026-10-26' then 'ELEM_70_30_ROLES_V3' else 'ELEM_70_30_COUNTER_V2' end,'{}'::jsonb,'{}'::jsonb
  )
  returning id into v_week_id;

  foreach v_specialty in array array['RUINS','NATURE','SANCTUARY'] loop
    v_slot := v_slot + 1;

    select s.* into v_site
    from public.expedition_sites s
    where s.is_active=true
      and s.specialty_code=v_specialty
    order by
      case when (
        select max(w2.week_start_date)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.site_id=s.id
      ) = v_week_start - 7 then 1 else 0 end asc,
      case when coalesce((
        select max(w2.week_start_date)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.site_id=s.id
      ),date '1900-01-01') >= v_week_start - 28 then 1 else 0 end asc,
      (
        select count(*)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.site_id=s.id
      ) asc,
      (
        select count(*)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        join public.expedition_sites s2 on s2.id=ws2.site_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and s2.world_effect_code=s.world_effect_code
      ) asc,
      md5(v_seed || '|SITE|' || s.site_code) asc
    limit 1;

    if not found then
      raise exception 'EXPEDITION_SITE_SELECTION_FAILED specialty=%',v_specialty
        using errcode='P0E37';
    end if;

    select e.* into v_env
    from public.expedition_environment_templates e
    where e.is_active=true
      and not (e.id = any(v_used_env_ids))
    order by
      case when (
        select ws2.environment_template_id
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and ws2.site_id=v_site.id
          and w2.status <> 'CANCELLED'
        order by w2.week_start_date desc
        limit 1
      ) = e.id then 1 else 0 end asc,
      (
        select count(*)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.environment_template_id=e.id
      ) asc,
      md5(v_seed || '|ENV|' || v_slot::text || '|' || e.environment_code) asc
    limit 1;

    if not found then
      raise exception 'EXPEDITION_ENVIRONMENT_SELECTION_FAILED slot=%',v_slot
        using errcode='P0E38';
    end if;

    v_used_env_ids := array_append(v_used_env_ids,v_env.id);

    insert into public.expedition_week_sites(
      week_id,classroom_id,slot,site_id,
      site_code_snapshot,site_name_snapshot,specialty_code_snapshot,
      core_reward_code_snapshot,world_effect_code_snapshot,
      environment_template_id,environment_code_snapshot,environment_label_snapshot,
      environment_config_version,
      saturday_major_element,saturday_minor_element,
      sunday_major_element,sunday_minor_element
    )
    values(
      v_week_id,p_classroom_id,v_slot,v_site.id,
      v_site.site_code,v_site.name_ko,v_site.specialty_code,
      v_site.core_reward_code,v_site.world_effect_code,
      v_env.id,v_env.environment_code,v_env.label_ko,v_env.config_version,
      v_env.major_element,v_env.minor_element,
      v_env.major_element,v_env.minor_element
    );

    v_sites := v_sites || jsonb_build_array(
      jsonb_build_object(
        'slot',v_slot,
        'site_code',v_site.site_code,
        'site_name',v_site.name_ko,
        'specialty_code',v_site.specialty_code,
        'core_reward_code',v_site.core_reward_code,
        'world_effect_code',v_site.world_effect_code,
        'environment_code',v_env.environment_code,
        'environment_label',v_env.label_ko,
        'major_element',v_env.major_element,
        'minor_element',v_env.minor_element
      )
    );
  end loop;

  return jsonb_build_object(
    'created',true,
    'week_id',v_week_id,
    'status','DRAFT',
    'reward_mode','DRY_RUN',
    'week_start_date',v_week_start,
    'week_index',v_week_index,
    'week_seed',v_seed,
    'publish_at',v_publish_at,
    'sat_open_at',v_sat_open_at,
    'sun_open_at',v_sun_open_at,
    'sun_close_at',v_sun_close_at,
    'settle_at',v_settle_at,
    'sites',v_sites
  );
end;
$function$;
CREATE OR REPLACE FUNCTION brand_expedition_scheduler.publish_week(p_week_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    v_release:=brand_expedition_scheduler.validate_release(v_week.classroom_id);
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
        'fit_formula_version',v_week.fit_formula_version,
        'element_match_rule',case when v_week.fit_formula_version in ('ELEM_70_30_COUNTER_V2','ELEM_70_30_ROLES_V3') then 'COUNTER_ELEMENT' else 'SAME_ELEMENT' end,
        'role_bonus_enabled',v_week.fit_formula_version='ELEM_70_30_ROLES_V3',
        'captain_element_multiplier',case when v_week.fit_formula_version='ELEM_70_30_ROLES_V3' then 1.2 else 1.0 end,
        'vice_specialty_bonus',case when v_week.fit_formula_version='ELEM_70_30_ROLES_V3' then 5 else 0 end,
        'fit_cap',130,
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
$function$;
CREATE OR REPLACE FUNCTION public.teacher_generate_expedition_week(p_classroom_id integer, p_week_start_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_week_start date;
  v_settings public.expedition_settings%rowtype;
  v_season public.expedition_seasons%rowtype;
  v_existing public.expedition_weeks%rowtype;
  v_week_id bigint;
  v_week_index integer;
  v_seed text;
  v_publish_at timestamptz;
  v_sat_open_at timestamptz;
  v_sun_open_at timestamptz;
  v_sun_close_at timestamptz;
  v_settle_at timestamptz;
  v_slot integer := 0;
  v_specialty text;
  v_site public.expedition_sites%rowtype;
  v_env public.expedition_environment_templates%rowtype;
  v_used_env_ids bigint[] := '{}'::bigint[];
  v_sites jsonb := '[]'::jsonb;
begin
  if not public._expedition_teacher_can_manage_classroom(p_classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  v_week_start := coalesce(
    p_week_start_date,
    ((clock_timestamp() at time zone 'Asia/Seoul')::date
      - (extract(isodow from (clock_timestamp() at time zone 'Asia/Seoul')::date)::integer - 1))
  );

  if extract(isodow from v_week_start)::integer <> 1 then
    raise exception 'EXPEDITION_WEEK_START_MUST_BE_MONDAY'
      using errcode='P0E34';
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
    and v_week_start between starts_on and ends_on
  order by id desc
  limit 1;

  if not found then
    raise exception 'EXPEDITION_ACTIVE_SEASON_NOT_FOUND_FOR_WEEK'
      using errcode='P0E36';
  end if;

  select * into v_existing
  from public.expedition_weeks
  where classroom_id=p_classroom_id
    and week_start_date=v_week_start;

  if found then
    return jsonb_build_object(
      'created',false,
      'week_id',v_existing.id,
      'status',v_existing.status,
      'reward_mode',v_existing.reward_mode,
      'week_start_date',v_existing.week_start_date,
      'week_index',v_existing.week_index
    );
  end if;

  v_week_index := ((v_week_start - v_season.starts_on) / 7) + 1;
  v_seed := md5(
    'EXPEDITION_V1_4|'
    || p_classroom_id::text || '|'
    || v_week_start::text || '|1'
  );

  v_publish_at := ((v_week_start + (v_settings.publish_weekday-1)) + v_settings.publish_time_kst)
                    at time zone 'Asia/Seoul';
  v_sat_open_at := ((v_week_start + 4) + v_settings.sat_open_time_kst)
                    at time zone 'Asia/Seoul';
  v_sun_open_at := ((v_week_start + 5) + v_settings.sun_open_time_kst)
                    at time zone 'Asia/Seoul';
  v_sun_close_at := ((v_week_start + 6) + v_settings.sun_open_time_kst)
                    at time zone 'Asia/Seoul';
  v_settle_at := ((v_week_start + 6) + v_settings.settle_time_kst)
                    at time zone 'Asia/Seoul';

  insert into public.expedition_weeks(
    season_id,classroom_id,week_index,week_start_date,generation_no,week_seed,
    status,reward_mode,publish_at,sat_open_at,sun_open_at,sun_close_at,settle_at,
    fit_formula_version,config_snapshot,reward_pool_snapshot
  )
  values(
    v_season.id,p_classroom_id,v_week_index,v_week_start,1,v_seed,
    'DRAFT','DRY_RUN',v_publish_at,v_sat_open_at,v_sun_open_at,v_sun_close_at,v_settle_at,
    case when v_week_start>=date '2026-10-26' then 'ELEM_70_30_ROLES_V3' else 'ELEM_70_30_COUNTER_V2' end,'{}'::jsonb,'{}'::jsonb
  )
  returning id into v_week_id;

  foreach v_specialty in array array['RUINS','NATURE','SANCTUARY'] loop
    v_slot := v_slot + 1;

    select s.* into v_site
    from public.expedition_sites s
    where s.is_active=true
      and s.specialty_code=v_specialty
    order by
      case when (
        select max(w2.week_start_date)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.site_id=s.id
      ) = v_week_start - 7 then 1 else 0 end asc,
      case when coalesce((
        select max(w2.week_start_date)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.site_id=s.id
      ),date '1900-01-01') >= v_week_start - 28 then 1 else 0 end asc,
      (
        select count(*)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.site_id=s.id
      ) asc,
      (
        select count(*)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        join public.expedition_sites s2 on s2.id=ws2.site_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and s2.world_effect_code=s.world_effect_code
      ) asc,
      md5(v_seed || '|SITE|' || s.site_code) asc
    limit 1;

    if not found then
      raise exception 'EXPEDITION_SITE_SELECTION_FAILED specialty=%',v_specialty
        using errcode='P0E37';
    end if;

    select e.* into v_env
    from public.expedition_environment_templates e
    where e.is_active=true
      and not (e.id = any(v_used_env_ids))
    order by
      case when (
        select ws2.environment_template_id
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and ws2.site_id=v_site.id
          and w2.status <> 'CANCELLED'
        order by w2.week_start_date desc
        limit 1
      ) = e.id then 1 else 0 end asc,
      (
        select count(*)
        from public.expedition_week_sites ws2
        join public.expedition_weeks w2 on w2.id=ws2.week_id
        where w2.classroom_id=p_classroom_id
          and w2.week_start_date < v_week_start
          and w2.status <> 'CANCELLED'
          and ws2.environment_template_id=e.id
      ) asc,
      md5(v_seed || '|ENV|' || v_slot::text || '|' || e.environment_code) asc
    limit 1;

    if not found then
      raise exception 'EXPEDITION_ENVIRONMENT_SELECTION_FAILED slot=%',v_slot
        using errcode='P0E38';
    end if;

    v_used_env_ids := array_append(v_used_env_ids,v_env.id);

    insert into public.expedition_week_sites(
      week_id,classroom_id,slot,site_id,
      site_code_snapshot,site_name_snapshot,specialty_code_snapshot,
      core_reward_code_snapshot,world_effect_code_snapshot,
      environment_template_id,environment_code_snapshot,environment_label_snapshot,
      environment_config_version,
      saturday_major_element,saturday_minor_element,
      sunday_major_element,sunday_minor_element
    )
    values(
      v_week_id,p_classroom_id,v_slot,v_site.id,
      v_site.site_code,v_site.name_ko,v_site.specialty_code,
      v_site.core_reward_code,v_site.world_effect_code,
      v_env.id,v_env.environment_code,v_env.label_ko,v_env.config_version,
      v_env.major_element,v_env.minor_element,
      v_env.major_element,v_env.minor_element
    );

    v_sites := v_sites || jsonb_build_array(
      jsonb_build_object(
        'slot',v_slot,
        'site_code',v_site.site_code,
        'site_name',v_site.name_ko,
        'specialty_code',v_site.specialty_code,
        'core_reward_code',v_site.core_reward_code,
        'world_effect_code',v_site.world_effect_code,
        'environment_code',v_env.environment_code,
        'environment_label',v_env.label_ko,
        'major_element',v_env.major_element,
        'minor_element',v_env.minor_element
      )
    );
  end loop;

  return jsonb_build_object(
    'created',true,
    'week_id',v_week_id,
    'status','DRAFT',
    'reward_mode','DRY_RUN',
    'week_start_date',v_week_start,
    'week_index',v_week_index,
    'week_seed',v_seed,
    'publish_at',v_publish_at,
    'sat_open_at',v_sat_open_at,
    'sun_open_at',v_sun_open_at,
    'sun_close_at',v_sun_close_at,
    'settle_at',v_settle_at,
    'sites',v_sites
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.teacher_publish_expedition_week(p_week_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        'fit_formula_version',v_week.fit_formula_version,
        'element_match_rule',case when v_week.fit_formula_version in ('ELEM_70_30_COUNTER_V2','ELEM_70_30_ROLES_V3') then 'COUNTER_ELEMENT' else 'SAME_ELEMENT' end,
        'role_bonus_enabled',v_week.fit_formula_version='ELEM_70_30_ROLES_V3',
        'captain_element_multiplier',case when v_week.fit_formula_version='ELEM_70_30_ROLES_V3' then 1.2 else 1.0 end,
        'vice_specialty_bonus',case when v_week.fit_formula_version='ELEM_70_30_ROLES_V3' then 5 else 0 end,
        'fit_cap',130,
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
$function$;

