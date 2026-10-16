begin;
create temp table test_fit_sites as select * from public.expedition_week_sites where false;
create temp table test_fit_profiles as select * from public.expedition_week_character_profiles where false;
create temp table test_fit_weeks as select * from public.expedition_weeks where false;
insert into test_fit_weeks(id,fit_formula_version) values(1,'ELEM_70_30_COUNTER_V2');
insert into test_fit_sites(id,week_id,saturday_major_element,saturday_minor_element,sunday_major_element,sunday_minor_element,specialty_code_snapshot)
values(1,1,'WATER','FIRE','FIRE','WIND','SANCTUARY');
insert into test_fit_profiles(week_id,character_id,character_uid_snapshot,character_name_snapshot,element_budget,primary_element,primary_points,secondary_element,secondary_points,specialty_code)
select 1,x,'TEST_'||x,'Fixture '||x,8,'EARTH',6,null,0,'RUINS' from generate_series(1,3) x;
do $fixture$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public._expedition_compute_fit_v1(bigint,text,bigint[])'::regprocedure);
  v_definition := replace(v_definition,'public._expedition_compute_fit_v1(','pg_temp.test_expedition_fit(');
  v_definition := replace(v_definition,'from public.expedition_week_sites','from pg_temp.test_fit_sites');
  v_definition := replace(v_definition,'from public.expedition_week_character_profiles','from pg_temp.test_fit_profiles');
  v_definition := replace(v_definition,'from public.expedition_weeks w','from pg_temp.test_fit_weeks w');
  execute v_definition;
end;
$fixture$;
do $$
declare
  e text;
  target text;
  f jsonb;
  checks integer:=0;
begin
  foreach e in array array['WATER','FIRE','WIND','EARTH','LIGHT','DARK'] loop
    target:=case e when 'WATER' then 'EARTH' when 'FIRE' then 'WATER' when 'WIND' then 'FIRE' when 'EARTH' then 'WIND' when 'LIGHT' then 'DARK' when 'DARK' then 'LIGHT' end;
    update test_fit_sites set saturday_major_element=e,saturday_minor_element=case when e='FIRE' then 'WIND' else 'FIRE' end;
    update test_fit_profiles set primary_element=target,primary_points=6,secondary_element=null,secondary_points=0;
    f:=pg_temp.test_expedition_fit(1,'SAT',array[1,2,3]::bigint[]);
    assert (f->>'major_sum')::integer=18, 'Counter must contribute to major sum: '||e;
    assert f->>'major_counter_element'=target, 'Wrong counter mapping: '||e;
    checks:=checks+2;
    update test_fit_profiles set primary_element=e;
    f:=pg_temp.test_expedition_fit(1,'SAT',array[1,2,3]::bigint[]);
    assert (f->>'major_sum')::integer=0, 'Same element must not count as counter: '||e;
    checks:=checks+1;
  end loop;
  update test_fit_sites set saturday_major_element='WATER',saturday_minor_element='FIRE';
  update test_fit_profiles set primary_element='EARTH',primary_points=6,secondary_element='WATER',secondary_points=2;
  f:=pg_temp.test_expedition_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'fit_percent')::integer=107, '70/30 fit or rounding changed';
  assert (f->>'major_sum')::integer=18 and (f->>'minor_sum')::integer=6, 'Secondary points missing';
  checks:=checks+2;
  f:=pg_temp.test_expedition_fit(1,'SUN',array[1,2,3]::bigint[]);
  assert f->>'major_counter_element'='WATER' and f->>'minor_counter_element'='FIRE', 'Sunday environment ignored';
  assert (f->>'major_sum')::integer=6 and (f->>'minor_sum')::integer=0, 'Sunday points incorrect';
  checks:=checks+2;
  update test_fit_profiles set specialty_code='SANCTUARY';
  f:=pg_temp.test_expedition_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'specialty_bonus')::integer=10, 'Specialty cap changed';
  checks:=checks+1;
  update test_fit_profiles set secondary_points=4,element_budget=10;
  f:=pg_temp.test_expedition_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'fit_percent')::integer=130 and f->>'fit_grade'='STRONG', 'Maximum fit or grade changed';
  checks:=checks+1;
  update test_fit_profiles set secondary_points=2,element_budget=8;
  update test_fit_weeks set fit_formula_version='ELEM_70_30_V1';
  f:=pg_temp.test_expedition_fit(1,'SAT',array[1,2,3]::bigint[]);
  assert (f->>'major_sum')::integer=6 and (f->>'minor_sum')::integer=0, 'Historical V1 changed';
  assert f->>'element_match_rule'='SAME_ELEMENT', 'Historical version not preserved';
  checks:=checks+2;
  raise notice 'Passed % expedition counter-fit assertions',checks;
end $$;
select 'PASS: 26 assertions (six counters, phases, weights, cap, historical V1)' result;
rollback;
