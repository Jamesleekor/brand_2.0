-- Extend the editor without changing existing RPC signatures or historical expedition snapshots.
create or replace function public.teacher_get_character_combat_profiles()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.ensure_teacher_role();
  return coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
    'specialty_code', xp.specialty_code) order by s.sort_order, s.character_uid)
    from public.teacher_get_character_raid_stats() s
    left join public.character_expedition_profiles xp on xp.character_id=s.character_id), '[]'::jsonb);
end;
$function$;

create or replace function public.teacher_update_character_combat_profile(
  p_character_id bigint,
  p_raid_power bigint,
  p_raid_crit_bonus_bp integer,
  p_element_profile jsonb default null,
  p_specialty_code text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_budget integer;
  v_primary text;
  v_secondary text;
  v_primary_points integer;
  v_secondary_points integer;
begin
  perform public.ensure_teacher_role();
  -- Serialize edits for a character; all three writes are one transaction.
  perform 1 from public.characters where id=p_character_id for update;
  if not found then raise exception '편린을 찾을 수 없습니다.' using errcode='P0202'; end if;
  if p_raid_power is null or p_raid_power<0 or p_raid_power>9007199254740991 then
    raise exception '공명력은 0 이상의 안전한 정수로 입력해주세요.' using errcode='22023';
  end if;
  if p_element_profile is not null then
    if jsonb_typeof(p_element_profile) <> 'object'
      or not (p_element_profile ?& array['element_budget','primary_element','primary_points','secondary_points'])
      or jsonb_typeof(p_element_profile->'element_budget') is distinct from 'number'
      or jsonb_typeof(p_element_profile->'primary_points') is distinct from 'number'
      or jsonb_typeof(p_element_profile->'secondary_points') is distinct from 'number'
      or coalesce(p_element_profile->>'element_budget','') !~ '^[0-9]{1,2}$'
      or coalesce(p_element_profile->>'primary_points','') !~ '^[0-9]{1,2}$'
      or coalesce(p_element_profile->>'secondary_points','') !~ '^[0-9]{1,2}$' then
      raise exception '속성 배분은 정수로 입력해주세요.' using errcode='22023';
    end if;
    v_budget := (p_element_profile->>'element_budget')::integer;
    v_primary_points := (p_element_profile->>'primary_points')::integer;
    v_secondary_points := (p_element_profile->>'secondary_points')::integer;
    v_primary := p_element_profile->>'primary_element';
    v_secondary := nullif(p_element_profile->>'secondary_element','');
    if v_budget not in (8,9,10) or v_primary_points not between 1 and 10
      or v_secondary_points not between 0 and 10
      or v_primary_points+v_secondary_points<>v_budget
      or v_primary is null or v_primary not in ('FIRE','WATER','WIND','EARTH','LIGHT','DARK')
      or (v_secondary is not null and v_secondary not in ('FIRE','WATER','WIND','EARTH','LIGHT','DARK'))
      or (v_secondary is null and v_secondary_points<>0)
      or (v_secondary is not null and (v_secondary_points=0 or v_secondary=v_primary)) then
      raise exception '속성 합계는 8·9·10이며, 주·부 속성은 달라야 합니다. 부 속성 없음은 0점입니다.' using errcode='22023';
    end if;
  end if;
  if p_specialty_code is not null and not exists (
    select 1 from public.expedition_specialties where specialty_code=p_specialty_code
      and is_active and specialty_code in ('RUINS','NATURE','SANCTUARY')
  ) then
    raise exception '원정 특기는 유적·자연·성소 중에서 선택해주세요.' using errcode='22023';
  end if;
  perform public.teacher_update_character_raid_stats(p_character_id,p_raid_power,p_raid_crit_bonus_bp,'COMBAT_PROFILE_UI');
  if p_element_profile is not null then
    insert into public.character_element_profiles (character_id,element_budget,primary_element,primary_points,secondary_element,secondary_points)
    values (p_character_id,v_budget,v_primary,v_primary_points,v_secondary,v_secondary_points)
    on conflict (character_id) do update set element_budget=excluded.element_budget,
      primary_element=excluded.primary_element,primary_points=excluded.primary_points,
      secondary_element=excluded.secondary_element,secondary_points=excluded.secondary_points,updated_at=now();
  end if;
  if p_specialty_code is not null then
    insert into public.character_expedition_profiles (character_id,specialty_code,metadata)
    values (p_character_id,p_specialty_code,jsonb_build_object('last_profile_edit_by',auth.uid(),'last_profile_edit_at',clock_timestamp()))
    on conflict (character_id) do update set specialty_code=excluded.specialty_code,updated_at=now(),
      metadata=character_expedition_profiles.metadata || excluded.metadata;
  end if;
  return jsonb_build_object('character_id',p_character_id);
end;
$function$;

revoke all on function public.teacher_get_character_combat_profiles() from public, anon;
revoke all on function public.teacher_update_character_combat_profile(bigint,bigint,integer,jsonb,text) from public, anon;
grant execute on function public.teacher_get_character_combat_profiles() to authenticated, service_role;
grant execute on function public.teacher_update_character_combat_profile(bigint,bigint,integer,jsonb,text) to authenticated, service_role;
notify pgrst, 'reload schema';
