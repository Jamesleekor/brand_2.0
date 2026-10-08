-- SQL Editor-safe: structural checks + table constraints; never call authenticated teacher RPCs here.
begin;
create temporary table combat_checks (label text, passed boolean) on commit drop;
do $test$
declare
  v_id bigint;
  v_budget integer;
  v_specialty text;
  v_case jsonb;
  v_definition text;
begin
  select id into v_id from public.characters where character_uid='CHAR-081';
  if v_id is null then raise exception 'Test character CHAR-081 missing'; end if;
  select pg_get_functiondef('public.teacher_update_character_combat_profile(bigint,bigint,integer,jsonb,text)'::regprocedure)
    into v_definition;
  insert into combat_checks values
    ('update guard before first write', position('perform public.ensure_teacher_role()' in v_definition) < position('for update' in v_definition)),
    ('fixed search path', position('SET search_path TO' in v_definition)>0),
    ('one atomic RPC uses existing stat validation', position('perform public.teacher_update_character_raid_stats' in v_definition)>0),
    ('anon cannot update', not has_function_privilege('anon','public.teacher_update_character_combat_profile(bigint,bigint,integer,jsonb,text)','execute')),
    ('anon cannot list', not has_function_privilege('anon','public.teacher_get_character_combat_profiles()','execute')),
    ('authenticated endpoint available', has_function_privilege('authenticated','public.teacher_update_character_combat_profile(bigint,bigint,integer,jsonb,text)','execute'));
  select pg_get_functiondef('public.teacher_get_character_combat_profiles()'::regprocedure) into v_definition;
  insert into combat_checks values ('list requires teacher role', position('perform public.ensure_teacher_role()' in v_definition)>0);
  for v_budget in 8..10 loop
    insert into public.character_element_profiles(character_id,element_budget,primary_element,primary_points,secondary_element,secondary_points)
      values(v_id,v_budget,'WIND',v_budget,null,0)
      on conflict(character_id) do update set element_budget=excluded.element_budget,primary_element=excluded.primary_element,
        primary_points=excluded.primary_points,secondary_element=excluded.secondary_element,secondary_points=excluded.secondary_points;
    insert into combat_checks values ('single element '||v_budget, exists(select 1 from public.character_element_profiles where character_id=v_id and primary_points=v_budget and secondary_element is null));
    update public.character_element_profiles set primary_points=v_budget-3,secondary_element='DARK',secondary_points=3 where character_id=v_id;
    insert into combat_checks values ('dual element '||v_budget, exists(select 1 from public.character_element_profiles where character_id=v_id and primary_points+secondary_points=v_budget));
  end loop;
  for v_case in select value from jsonb_array_elements('[
    {"label":"budget 7 rejected","budget":7,"primary":"WIND","pp":4,"secondary":"DARK","sp":3},
    {"label":"budget 11 rejected","budget":11,"primary":"WIND","pp":8,"secondary":"DARK","sp":3},
    {"label":"sum mismatch rejected","budget":10,"primary":"WIND","pp":6,"secondary":"DARK","sp":3},
    {"label":"duplicate element rejected","budget":10,"primary":"WIND","pp":7,"secondary":"WIND","sp":3},
    {"label":"unknown element rejected","budget":10,"primary":"UNKNOWN","pp":7,"secondary":"DARK","sp":3},
    {"label":"empty primary rejected","budget":10,"primary":null,"pp":7,"secondary":"DARK","sp":3},
    {"label":"secondary null with points rejected","budget":10,"primary":"WIND","pp":7,"secondary":null,"sp":3},
    {"label":"secondary with zero rejected","budget":10,"primary":"WIND","pp":10,"secondary":"DARK","sp":0},
    {"label":"primary zero rejected","budget":10,"primary":"WIND","pp":0,"secondary":"DARK","sp":10}
  ]'::jsonb) loop
    begin
      update public.character_element_profiles set element_budget=(v_case->>'budget')::smallint,
        primary_element=v_case->>'primary',primary_points=(v_case->>'pp')::smallint,
        secondary_element=v_case->>'secondary',secondary_points=(v_case->>'sp')::smallint where character_id=v_id;
      insert into combat_checks values(v_case->>'label',false);
    exception when check_violation or not_null_violation then
      insert into combat_checks values(v_case->>'label',true);
    end;
  end loop;
  foreach v_specialty in array array['RUINS','NATURE','SANCTUARY'] loop
    insert into public.character_expedition_profiles(character_id,specialty_code) values(v_id,v_specialty)
      on conflict(character_id) do update set specialty_code=excluded.specialty_code;
    insert into combat_checks values('specialty '||v_specialty,exists(select 1 from public.character_expedition_profiles where character_id=v_id and specialty_code=v_specialty));
  end loop;
  if exists(select 1 from combat_checks where not passed or passed is null) then
    raise exception 'Combat profile structural/constraint check failed';
  end if;
end;
$test$;
select count(*) total, count(*) filter(where passed) passed from combat_checks;
rollback;
