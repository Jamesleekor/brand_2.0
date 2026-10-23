begin;
create temp table test_roles_sites as select * from public.expedition_week_sites where false;
create temp table test_roles_profiles as select * from public.expedition_week_character_profiles where false;
create temp table test_roles_weeks as select * from public.expedition_weeks where false;
create temp table test_roles_results(party bigint[], result jsonb);
insert into test_roles_weeks(id,fit_formula_version) values(1,'ELEM_70_30_ROLES_V3');
insert into test_roles_sites(id,week_id,saturday_major_element,saturday_minor_element,sunday_major_element,sunday_minor_element,specialty_code_snapshot)
values(1,1,'FIRE','LIGHT','WATER','FIRE','RUINS');
insert into test_roles_profiles(week_id,character_id,character_uid_snapshot,character_name_snapshot,element_budget,primary_element,primary_points,secondary_element,secondary_points,specialty_code)
values(1,1,'A','A',8,'WATER',6,'EARTH',2,'NATURE'),
      (1,2,'B','B',8,'WATER',4,'DARK',4,'RUINS'),
      (1,3,'C','C',8,'DARK',4,'EARTH',4,'NATURE');
do $fixture$
declare src text;
begin
  src:=pg_get_functiondef('public._expedition_compute_fit_v1(bigint,text,bigint[])'::regprocedure);
  src:=replace(src,'public._expedition_compute_fit_v1(','pg_temp.test_roles_fit(');
  src:=replace(src,'from public.expedition_week_sites','from pg_temp.test_roles_sites');
  src:=replace(src,'from public.expedition_week_character_profiles','from pg_temp.test_roles_profiles');
  src:=replace(src,'from public.expedition_weeks w','from pg_temp.test_roles_weeks w');
  execute src;
end $fixture$;
do $checks$
declare
  r record; f jsonb; expected integer; version text; generated jsonb; published jsonb; wid bigint;
begin
  for r in select array[a,b,c]::bigint[] ids from generate_series(1,3) a cross join generate_series(1,3) b cross join generate_series(1,3) c where a<>b and b<>c and a<>c loop
    f:=pg_temp.test_roles_fit(1,'SAT',r.ids);
    expected:=case when r.ids[1]=1 then case when r.ids[2]=2 then 96 else 91 end
                   when r.ids[1]=2 then 92
                   else case when r.ids[2]=2 then 93 else 88 end end;
    assert (f->>'fit_percent')::integer=expected,'Wrong ordered fit: '||r.ids::text;
    assert (f->>'base_fit_percent')::integer=85,'Baseline changed';
    assert (f->>'base_fit_percent')::integer+(f->>'captain_bonus_percent')::integer+(f->>'vice_bonus_percent')::integer=expected,'Breakdown does not sum';
    assert f->'members'->0->>'role'='CAPTAIN' and f->'members'->1->>'role'='VICE_CAPTAIN','Role labels missing';
    assert (f->'members'->0->>'character_id')::bigint=r.ids[1],'Party order not preserved';
    insert into test_roles_results values(r.ids,f);
  end loop;
  foreach version in array array['ELEM_70_30_COUNTER_V2','ELEM_70_30_V1'] loop
    update test_roles_weeks set fit_formula_version=version;
    for r in select party from test_roles_results loop
      f:=pg_temp.test_roles_fit(1,'SAT',r.party);
      assert (f->>'fit_percent')::integer=case when version='ELEM_70_30_V1' then 5 else 85 end,'Historical version changed';
      assert (f->>'role_bonus_enabled')::boolean=false,'Role bonus leaked to old version';
    end loop;
  end loop;
  update test_roles_weeks set fit_formula_version='ELEM_70_30_ROLES_V3';
  update test_roles_profiles set specialty_code='RUINS';
  f:=pg_temp.test_roles_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'specialty_bonus')::integer=10 and (f->>'vice_bonus_percent')::integer=5,'Vice bonus must apply beyond ordinary specialty cap';
  update test_roles_profiles set element_budget=10,primary_element='WATER',primary_points=6,secondary_element='DARK',secondary_points=4;
  f:=pg_temp.test_roles_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'fit_percent')::integer=130 and (f->>'vice_bonus_percent')::integer=0 and (f->>'vice_bonus_eligible')::integer=5,'Fit cap not enforced';
  f:=pg_temp.test_roles_fit(1,'SUN',array[1,2,3]::bigint[]);
  assert f->>'major_counter_element'='EARTH' and f->>'minor_counter_element'='WATER','Second round environment ignored';
  update test_roles_profiles set element_budget=8,primary_element='EARTH',primary_points=8,secondary_element=null,secondary_points=0,specialty_code='NATURE';
  f:=pg_temp.test_roles_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'fit_percent')::integer=0,'Non-counter elements gained points';
  begin
    perform pg_temp.test_roles_fit(1,'SAT',array[1,1,3]::bigint[]);
    raise exception 'Duplicate party was accepted';
  exception when sqlstate 'P0E31' then null;
  end;
  begin
    perform pg_temp.test_roles_fit(1,'SAT',array[1,2]::bigint[]);
    raise exception 'Incomplete party was accepted';
  exception when sqlstate 'P0E31' then null;
  end;
  -- Postgres-only scheduler path; no teacher JWT impersonation.
  generated:=brand_expedition_scheduler.generate_week(1,date '2026-10-26');
  assert (generated->>'created')::boolean,'Future test week already exists; choose an unused date';
  wid:=(generated->>'week_id')::bigint;
  assert (select fit_formula_version from public.expedition_weeks where id=wid)='ELEM_70_30_ROLES_V3','Scheduler still generates V2';
  published:=brand_expedition_scheduler.publish_week(wid);
  assert (published->>'published')::boolean,'Future week publish failed';
  assert (select config_snapshot->>'role_bonus_enabled' from public.expedition_weeks where id=wid)='true','Published role snapshot missing';
  assert (select config_snapshot->>'element_match_rule' from public.expedition_weeks where id=wid)='COUNTER_ELEMENT','Published counter rule wrong';
  assert (select fit_formula_version from public.expedition_weeks where id=22)='ELEM_70_30_COUNTER_V2','Current week version changed';
end $checks$;
select jsonb_build_object('status','PASS','permutations',jsonb_agg(jsonb_build_object('party',party,'fit',result->'fit_percent','base',result->'base_fit_percent','captain',result->'captain_bonus_percent','vice',result->'vice_bonus_percent') order by party),'legacy_versions','unchanged','scheduler_and_snapshot','V3 from next week','writes','rolled back') as result from test_roles_results;
rollback;
