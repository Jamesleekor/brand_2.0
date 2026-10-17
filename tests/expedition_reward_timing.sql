begin;
create temp table timing_students as select * from public.students where id=36;
create temp table timing_runs as select * from public.expedition_runs where id=47;
create temp table timing_rewards as select * from public.expedition_run_rewards where run_id=47;
create temp table timing_claims (like public.expedition_reward_claims including defaults);
create temp table timing_weeks as select * from public.expedition_weeks where id=21;
update timing_rewards set reward_mode='DRY_RUN';
do $test$
declare d text; tab text; result jsonb; tests integer:=0;
begin
  d:=pg_get_functiondef('public.student_claim_expedition_reward(bigint,uuid)'::regprocedure);
  d:=replace(d,'public.student_claim_expedition_reward(', 'pg_temp.timing_claim(');
  foreach tab in array array['students','expedition_runs','expedition_run_rewards','expedition_reward_claims','expedition_weeks'] loop
    d:=replace(d,'public.'||tab, 'pg_temp.'||case tab
      when 'students' then 'timing_students'
      when 'expedition_runs' then 'timing_runs'
      when 'expedition_run_rewards' then 'timing_rewards'
      when 'expedition_reward_claims' then 'timing_claims'
      else 'timing_weeks' end);
  end loop;
  d:=replace(d,'auth.uid()', '(select user_id from pg_temp.timing_students limit 1)');
  execute d;
  update timing_students set is_test_account=false;
  update timing_weeks set sun_open_at=clock_timestamp()+interval '1 day', sun_close_at=clock_timestamp()+interval '2 days';
  begin
    perform pg_temp.timing_claim(47,gen_random_uuid());
    raise exception 'FAIL: ordinary SAT early claim allowed';
  exception when sqlstate 'P0EC1' then tests:=tests+1;
  end;
  update timing_runs set phase='SUN';
  begin
    perform pg_temp.timing_claim(47,gen_random_uuid());
    raise exception 'FAIL: ordinary SUN early claim allowed';
  exception when sqlstate 'P0EC1' then tests:=tests+1;
  end;
  update timing_students set is_test_account=true;
  result:=pg_temp.timing_claim(47,gen_random_uuid());
  if result->>'claim_status'<>'SIMULATED' then raise exception 'FAIL: test bypass'; end if;
  tests:=tests+1;
  delete from timing_claims;
  update timing_students set is_test_account=false;
  update timing_weeks set sun_open_at=clock_timestamp()-interval '1 second',sun_close_at=clock_timestamp()+interval '1 day';
  update timing_runs set phase='SAT';
  result:=pg_temp.timing_claim(47,gen_random_uuid());
  if result->>'claim_status'<>'SIMULATED' then raise exception 'FAIL: SAT unlock'; end if;
  tests:=tests+1;
  delete from timing_claims;
  update timing_runs set phase='SUN';
  begin
    perform pg_temp.timing_claim(47,gen_random_uuid());
    raise exception 'FAIL: SUN must remain locked on Sunday';
  exception when sqlstate 'P0EC1' then tests:=tests+1;
  end;
  update timing_weeks set sun_close_at=clock_timestamp()-interval '1 second';
  result:=pg_temp.timing_claim(47,gen_random_uuid());
  if result->>'claim_status'<>'SIMULATED' then raise exception 'FAIL: SUN unlock'; end if;
  tests:=tests+1;
  result:=pg_temp.timing_claim(47,gen_random_uuid());
  if result->>'already_claimed'<>'true' then raise exception 'FAIL: idempotence'; end if;
  raise notice 'PASS: % timing checks plus idempotence; only temporary fixtures written',tests;
end;
$test$;
rollback;