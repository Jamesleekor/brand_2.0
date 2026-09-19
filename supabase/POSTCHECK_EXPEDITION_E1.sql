-- B.R.A.N.D 2.0 Fragment Expedition E1 structural postcheck
-- SQL Editor safe: no authenticated teacher JWT required.

select
  count(*) as total_profiles,
  count(*) filter (where profile_status='ACTIVE') as active_profiles,
  count(*) filter (where specialty_code='RUINS' and profile_status='ACTIVE') as ruins,
  count(*) filter (where specialty_code='NATURE' and profile_status='ACTIVE') as nature,
  count(*) filter (where specialty_code='SANCTUARY' and profile_status='ACTIVE') as sanctuary,
  count(*) filter (where fragment_restore_cost is not null) as restore_eligible,
  count(*) filter (where fragment_restore_cost is null) as restore_excluded
from public.character_expedition_profiles;

select fragment_restore_cost,count(*) as character_count
from public.character_expedition_profiles
where fragment_restore_cost is not null
group by fragment_restore_cost
order by fragment_restore_cost;

select c.character_uid,c.name,cep.specialty_code,cep.fragment_restore_cost
from public.character_expedition_profiles cep
join public.characters c on c.id=cep.character_id
where cep.fragment_restore_cost is null
order by c.character_uid;

select
  count(*) filter(where c.is_active) as active_characters,
  count(*) filter(where c.is_active and cep.character_id is not null) as active_with_expedition_profile,
  count(*) filter(where c.is_active and cep.character_id is null) as active_missing_expedition_profile,
  count(*) filter(where c.is_active and e.character_id is null) as active_missing_element_profile
from public.characters c
left join public.character_expedition_profiles cep on cep.character_id=c.id
left join public.character_element_profiles e on e.character_id=c.id;

select c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('expedition_specialties','character_expedition_profiles')
order by c.relname;

select table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('expedition_specialties','character_expedition_profiles')
  and grantee in ('anon','authenticated','service_role')
order by table_name,grantee,privilege_type;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proacl,','),'') as acl,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='teacher_validate_expedition_profiles';

-- Expected:
-- profiles 79 / active 79
-- RUINS 26 / NATURE 26 / SANCTUARY 27
-- restore eligible 72 / excluded 7
-- costs: 12=32, 18=8, 28=12, 36=12, 48=8
-- excluded: CHAR-001,002,003,058,077,078,079
-- authenticated grants: SELECT only
