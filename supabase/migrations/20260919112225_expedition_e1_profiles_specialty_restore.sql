-- B.R.A.N.D 2.0 Fragment Expedition E1
-- Profiles / specialty / fixed restore-cost seed
-- Source: v1.4 FINAL implementation spec + 79-character specialty seed
-- Production compatibility: requires existing E1-A character_element_profiles.
-- IMPORTANT: do not recreate or rewrite E1-A elemental profiles.

do $e1_preflight$
declare
  v_active_characters integer;
  v_element_profiles integer;
begin
  if to_regclass('public.character_element_profiles') is null then
    raise exception 'EXPEDITION_E1_REQUIRES_CHARACTER_ELEMENT_PROFILES'
      using errcode = 'P0E10';
  end if;

  select count(*) into v_active_characters
  from public.characters
  where is_active = true;

  select count(*) into v_element_profiles
  from public.character_element_profiles cep
  join public.characters c on c.id = cep.character_id
  where c.is_active = true;

  if v_active_characters <> 79 then
    raise exception 'EXPEDITION_E1_EXPECTED_79_ACTIVE_CHARACTERS_FOUND_%', v_active_characters
      using errcode = 'P0E11';
  end if;

  if v_element_profiles <> v_active_characters then
    raise exception 'EXPEDITION_E1_ELEMENT_PROFILE_COVERAGE_MISMATCH active=% profiles=%',
      v_active_characters, v_element_profiles
      using errcode = 'P0E12';
  end if;
end
$e1_preflight$;

create table if not exists public.expedition_specialties (
  specialty_code text primary key,
  label_ko text not null,
  sort_order smallint not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expedition_specialties_code_chk
    check (specialty_code in ('RUINS','NATURE','SANCTUARY')),
  constraint expedition_specialties_label_chk
    check (btrim(label_ko) <> ''),
  constraint expedition_specialties_sort_chk
    check (sort_order between 1 and 3)
);

comment on table public.expedition_specialties is
  'Fragment Expedition specialty master. Exactly RUINS/NATURE/SANCTUARY for v1.4.';
comment on column public.expedition_specialties.specialty_code is
  'Stable internal code. Student UI uses Korean label.';
comment on column public.expedition_specialties.label_ko is
  'Student-facing Korean specialty label.';

alter table public.expedition_specialties enable row level security;

revoke all on table public.expedition_specialties from public, anon, authenticated;
grant select on table public.expedition_specialties to authenticated;
grant all on table public.expedition_specialties to service_role;

drop policy if exists expedition_specialties_select_authenticated
  on public.expedition_specialties;
create policy expedition_specialties_select_authenticated
  on public.expedition_specialties
  for select
  to authenticated
  using (is_active = true or public.is_teacher_or_admin());

create table if not exists public.character_expedition_profiles (
  character_id bigint primary key
    references public.characters(id) on delete restrict,
  specialty_code text not null
    references public.expedition_specialties(specialty_code)
    on update cascade on delete restrict,
  fragment_restore_cost smallint null,
  profile_status text not null default 'ACTIVE',
  profile_version text not null default 'EXPEDITION_PROFILE_V1_4',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_expedition_profiles_restore_cost_chk
    check (fragment_restore_cost is null or fragment_restore_cost in (12,18,28,36,48)),
  constraint character_expedition_profiles_status_chk
    check (profile_status in ('DRAFT','ACTIVE','INACTIVE')),
  constraint character_expedition_profiles_version_chk
    check (btrim(profile_version) <> '')
);

comment on table public.character_expedition_profiles is
  'Expedition-only character extension. Elements remain exclusively in character_element_profiles.';
comment on column public.character_expedition_profiles.specialty_code is
  'Exactly one expedition specialty per character.';
comment on column public.character_expedition_profiles.fragment_restore_cost is
  'Fixed fragment restore cost seeded by v1.4; NULL means not restorable.';
comment on column public.character_expedition_profiles.profile_status is
  'DRAFT/ACTIVE/INACTIVE. Student reads ACTIVE only.';

create index if not exists idx_character_expedition_profiles_specialty
  on public.character_expedition_profiles(specialty_code, character_id);
create index if not exists idx_character_expedition_profiles_restore
  on public.character_expedition_profiles(fragment_restore_cost, character_id)
  where fragment_restore_cost is not null;
create index if not exists idx_character_expedition_profiles_status
  on public.character_expedition_profiles(profile_status, character_id);

alter table public.character_expedition_profiles enable row level security;

revoke all on table public.character_expedition_profiles from public, anon, authenticated;
grant select on table public.character_expedition_profiles to authenticated;
grant all on table public.character_expedition_profiles to service_role;

drop policy if exists character_expedition_profiles_select_authenticated
  on public.character_expedition_profiles;
create policy character_expedition_profiles_select_authenticated
  on public.character_expedition_profiles
  for select
  to authenticated
  using (profile_status = 'ACTIVE' or public.is_teacher_or_admin());

insert into public.expedition_specialties(
  specialty_code, label_ko, sort_order, is_active, updated_at
)
values
  ('RUINS','유적',1,true,now()),
  ('NATURE','자연',2,true,now()),
  ('SANCTUARY','성소',3,true,now())
on conflict (specialty_code) do update
set label_ko = excluded.label_ko,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

create temporary table expedition_e1_profile_seed (
  character_uid text primary key,
  specialty_code text not null,
  fragment_restore_cost smallint null
) on commit drop;

insert into expedition_e1_profile_seed(character_uid, specialty_code, fragment_restore_cost)
values
  ('CHAR-001'::text, 'NATURE'::text, NULL::smallint),
  ('CHAR-002'::text, 'RUINS'::text, NULL::smallint),
  ('CHAR-003'::text, 'NATURE'::text, NULL::smallint),
  ('CHAR-004'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-005'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-006'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-007'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-008'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-009'::text, 'SANCTUARY'::text, 18::smallint),
  ('CHAR-010'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-011'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-012'::text, 'NATURE'::text, 18::smallint),
  ('CHAR-013'::text, 'NATURE'::text, 18::smallint),
  ('CHAR-014'::text, 'RUINS'::text, 18::smallint),
  ('CHAR-015'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-016'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-017'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-018'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-019'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-020'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-021'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-022'::text, 'SANCTUARY'::text, 18::smallint),
  ('CHAR-023'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-024'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-025'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-026'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-027'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-028'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-029'::text, 'SANCTUARY'::text, 18::smallint),
  ('CHAR-031'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-032'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-033'::text, 'NATURE'::text, 18::smallint),
  ('CHAR-034'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-035'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-036'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-037'::text, 'RUINS'::text, 12::smallint),
  ('CHAR-038'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-039'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-040'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-041'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-042'::text, 'NATURE'::text, 12::smallint),
  ('CHAR-043'::text, 'SANCTUARY'::text, 12::smallint),
  ('CHAR-044'::text, 'NATURE'::text, 28::smallint),
  ('CHAR-045'::text, 'RUINS'::text, 28::smallint),
  ('CHAR-046'::text, 'NATURE'::text, 36::smallint),
  ('CHAR-047'::text, 'RUINS'::text, 28::smallint),
  ('CHAR-048'::text, 'SANCTUARY'::text, 28::smallint),
  ('CHAR-049'::text, 'SANCTUARY'::text, 36::smallint),
  ('CHAR-050'::text, 'NATURE'::text, 36::smallint),
  ('CHAR-051'::text, 'RUINS'::text, 36::smallint),
  ('CHAR-052'::text, 'NATURE'::text, 48::smallint),
  ('CHAR-053'::text, 'NATURE'::text, 36::smallint),
  ('CHAR-054'::text, 'NATURE'::text, 28::smallint),
  ('CHAR-055'::text, 'RUINS'::text, 28::smallint),
  ('CHAR-056'::text, 'RUINS'::text, 36::smallint),
  ('CHAR-057'::text, 'RUINS'::text, 48::smallint),
  ('CHAR-058'::text, 'SANCTUARY'::text, NULL::smallint),
  ('CHAR-059'::text, 'RUINS'::text, 36::smallint),
  ('CHAR-060'::text, 'RUINS'::text, 48::smallint),
  ('CHAR-061'::text, 'SANCTUARY'::text, 28::smallint),
  ('CHAR-062'::text, 'SANCTUARY'::text, 48::smallint),
  ('CHAR-063'::text, 'SANCTUARY'::text, 36::smallint),
  ('CHAR-064'::text, 'RUINS'::text, 48::smallint),
  ('CHAR-065'::text, 'RUINS'::text, 28::smallint),
  ('CHAR-066'::text, 'NATURE'::text, 28::smallint),
  ('CHAR-067'::text, 'NATURE'::text, 28::smallint),
  ('CHAR-068'::text, 'SANCTUARY'::text, 36::smallint),
  ('CHAR-069'::text, 'RUINS'::text, 36::smallint),
  ('CHAR-070'::text, 'NATURE'::text, 36::smallint),
  ('CHAR-071'::text, 'SANCTUARY'::text, 36::smallint),
  ('CHAR-072'::text, 'RUINS'::text, 28::smallint),
  ('CHAR-073'::text, 'RUINS'::text, 28::smallint),
  ('CHAR-074'::text, 'RUINS'::text, 48::smallint),
  ('CHAR-075'::text, 'SANCTUARY'::text, 48::smallint),
  ('CHAR-076'::text, 'SANCTUARY'::text, 48::smallint),
  ('CHAR-077'::text, 'RUINS'::text, NULL::smallint),
  ('CHAR-078'::text, 'SANCTUARY'::text, NULL::smallint),
  ('CHAR-079'::text, 'NATURE'::text, NULL::smallint),
  ('CHAR-080'::text, 'SANCTUARY'::text, 18::smallint);

do $e1_seed_preflight$
declare
  v_seed_count integer;
  v_missing_character_count integer;
  v_extra_active_count integer;
  v_ruins integer;
  v_nature integer;
  v_sanctuary integer;
  v_restore_count integer;
  v_excluded_count integer;
begin
  select count(*) into v_seed_count from expedition_e1_profile_seed;
  if v_seed_count <> 79 then
    raise exception 'EXPEDITION_E1_SEED_EXPECTED_79_FOUND_%', v_seed_count
      using errcode = 'P0E13';
  end if;

  select count(*) into v_missing_character_count
  from expedition_e1_profile_seed s
  left join public.characters c on c.character_uid = s.character_uid
  where c.id is null;

  if v_missing_character_count <> 0 then
    raise exception 'EXPEDITION_E1_SEED_HAS_%_UNKNOWN_CHARACTER_UIDS', v_missing_character_count
      using errcode = 'P0E14';
  end if;

  select count(*) into v_extra_active_count
  from public.characters c
  left join expedition_e1_profile_seed s on s.character_uid = c.character_uid
  where c.is_active = true
    and s.character_uid is null;

  if v_extra_active_count <> 0 then
    raise exception 'EXPEDITION_E1_ACTIVE_CHARACTERS_MISSING_FROM_SEED_%', v_extra_active_count
      using errcode = 'P0E15';
  end if;

  select
    count(*) filter (where specialty_code='RUINS'),
    count(*) filter (where specialty_code='NATURE'),
    count(*) filter (where specialty_code='SANCTUARY'),
    count(*) filter (where fragment_restore_cost is not null),
    count(*) filter (where fragment_restore_cost is null)
  into v_ruins,v_nature,v_sanctuary,v_restore_count,v_excluded_count
  from expedition_e1_profile_seed;

  if (v_ruins,v_nature,v_sanctuary) <> (26,26,27) then
    raise exception 'EXPEDITION_E1_SPECIALTY_DISTRIBUTION_INVALID ruins=% nature=% sanctuary=%',
      v_ruins,v_nature,v_sanctuary
      using errcode = 'P0E16';
  end if;

  if v_restore_count <> 72 or v_excluded_count <> 7 then
    raise exception 'EXPEDITION_E1_RESTORE_DISTRIBUTION_INVALID eligible=% excluded=%',
      v_restore_count,v_excluded_count
      using errcode = 'P0E17';
  end if;

  if exists (
    select 1 from expedition_e1_profile_seed
    where character_uid in ('CHAR-001','CHAR-002','CHAR-003','CHAR-058','CHAR-077','CHAR-078','CHAR-079')
      and fragment_restore_cost is not null
  ) then
    raise exception 'EXPEDITION_E1_EXCLUDED_CHARACTER_HAS_RESTORE_COST'
      using errcode = 'P0E18';
  end if;

  if exists (
    select 1 from expedition_e1_profile_seed
    where character_uid not in ('CHAR-001','CHAR-002','CHAR-003','CHAR-058','CHAR-077','CHAR-078','CHAR-079')
      and fragment_restore_cost is null
  ) then
    raise exception 'EXPEDITION_E1_RESTORABLE_CHARACTER_MISSING_COST'
      using errcode = 'P0E19';
  end if;
end
$e1_seed_preflight$;

insert into public.character_expedition_profiles(
  character_id,
  specialty_code,
  fragment_restore_cost,
  profile_status,
  profile_version,
  metadata,
  updated_at
)
select
  c.id,
  s.specialty_code,
  s.fragment_restore_cost,
  'ACTIVE',
  'EXPEDITION_PROFILE_V1_4',
  jsonb_build_object(
    'seed_version','E1_V1_4_20260919',
    'character_uid',c.character_uid,
    'restore_eligibility',
      case when s.fragment_restore_cost is null then 'EXCLUDED' else 'ELIGIBLE' end
  ),
  now()
from expedition_e1_profile_seed s
join public.characters c on c.character_uid = s.character_uid
on conflict (character_id) do update
set specialty_code = excluded.specialty_code,
    fragment_restore_cost = excluded.fragment_restore_cost,
    profile_status = excluded.profile_status,
    profile_version = excluded.profile_version,
    metadata = coalesce(public.character_expedition_profiles.metadata,'{}'::jsonb)
      || excluded.metadata,
    updated_at = now();

create or replace function public.teacher_validate_expedition_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
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
      c.active_character_count = 79
      and c.profile_count = 79
      and c.active_profile_count = 79
      and c.missing_profile_count = 0
      and c.missing_element_profile_count = 0
      and c.invalid_specialty_count = 0
      and c.restore_eligible_count = 72
      and c.restore_excluded_count = 7
      and sc.ruins = 26
      and sc.nature = 26
      and sc.sanctuary = 27
      and ex.excluded_uids = '["CHAR-001","CHAR-002","CHAR-003","CHAR-058","CHAR-077","CHAR-078","CHAR-079"]'::jsonb,
    'profile_version','EXPEDITION_PROFILE_V1_4',
    'active_character_count',c.active_character_count,
    'profile_count',c.profile_count,
    'active_profile_count',c.active_profile_count,
    'missing_profile_count',c.missing_profile_count,
    'missing_profile_uids',m.missing_uids,
    'missing_element_profile_count',c.missing_element_profile_count,
    'invalid_specialty_count',c.invalid_specialty_count,
    'specialty_counts',jsonb_build_object(
      'RUINS',sc.ruins,'NATURE',sc.nature,'SANCTUARY',sc.sanctuary
    ),
    'restore_eligible_count',c.restore_eligible_count,
    'restore_excluded_count',c.restore_excluded_count,
    'restore_excluded_uids',ex.excluded_uids
  )
  into v_result
  from counts c
  cross join specialty_counts sc
  cross join excluded ex
  cross join missing m;

  return v_result;
end
$function$;

comment on function public.teacher_validate_expedition_profiles() is
  'Read-only E1 validation for the 79-character v1.4 expedition profile baseline.';

revoke all on function public.teacher_validate_expedition_profiles()
  from public, anon, authenticated;
grant execute on function public.teacher_validate_expedition_profiles()
  to authenticated, service_role;

do $e1_post_seed_assert$
declare
  v_profiles integer;
  v_restore integer;
begin
  select count(*) into v_profiles
  from public.character_expedition_profiles cep
  join public.characters c on c.id=cep.character_id
  where c.is_active=true and cep.profile_status='ACTIVE';

  select count(*) into v_restore
  from public.character_expedition_profiles
  where fragment_restore_cost is not null
    and profile_version='EXPEDITION_PROFILE_V1_4';

  if v_profiles <> 79 then
    raise exception 'EXPEDITION_E1_POSTCHECK_PROFILE_COUNT_%',v_profiles
      using errcode='P0E1A';
  end if;

  if v_restore <> 72 then
    raise exception 'EXPEDITION_E1_POSTCHECK_RESTORE_COUNT_%',v_restore
      using errcode='P0E1B';
  end if;
end
$e1_post_seed_assert$;
