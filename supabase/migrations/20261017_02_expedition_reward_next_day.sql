-- Reward collection opens on the day after each expedition; test accounts bypass waiting.
do $migration$
declare
  definition text;
  anchor text;
begin
  definition := pg_get_functiondef('public.student_claim_expedition_reward(bigint,uuid)'::regprocedure);
  anchor := '  if v_reward.reward_mode=''DRY_RUN'' then';
  if position(anchor in definition)=0 or position('EXPEDITION_REWARD_NOT_READY' in definition)>0 then
    raise exception 'Unexpected claim function snapshot';
  end if;
  definition := replace(definition, anchor, $gate$
  -- Keep existing claims idempotent. Enforce waiting before every new asset write.
  if not coalesce(v_student.is_test_account,false) and exists (
    select 1 from public.expedition_weeks w
    where w.id=v_run.week_id
      and clock_timestamp() < case v_run.phase
        when 'SAT' then w.sun_open_at
        when 'SUN' then w.sun_close_at
        else 'infinity'::timestamptz
      end
  ) then
    raise exception 'EXPEDITION_REWARD_NOT_READY' using errcode='P0EC1';
  end if;

  if v_reward.reward_mode='DRY_RUN' then$gate$);
  execute definition;

  definition := pg_get_functiondef('public._expedition_run_result_json(bigint)'::regprocedure);
  anchor := '      ''claimed_at'',cl.claimed_at,';
  if position(anchor in definition)=0 then raise exception 'Unexpected result function snapshot'; end if;
  definition := replace(definition, anchor, $fields$
      'claim_available_at',case when coalesce(student.is_test_account,false) then null
        when r.phase='SAT' then week.sun_open_at else week.sun_close_at end,
      'can_claim_now',coalesce(student.is_test_account,false) or
        now() >= case when r.phase='SAT' then week.sun_open_at else week.sun_close_at end,
      'claimed_at',cl.claimed_at,$fields$);
  anchor := '  join public.expedition_week_sites ws on ws.id=r.week_site_id';
  if position(anchor in definition)=0 then raise exception 'Unexpected result joins'; end if;
  definition := replace(definition,anchor,anchor||E'\n  join public.expedition_weeks week on week.id=r.week_id\n  join public.students student on student.id=r.student_id');
  execute definition;
end;
$migration$;
-- CREATE OR REPLACE preserves the existing restrictive ACLs.
revoke all on function public._expedition_run_result_json(bigint) from public,anon,authenticated;
revoke all on function public.student_claim_expedition_reward(bigint,uuid) from public,anon;
grant execute on function public.student_claim_expedition_reward(bigint,uuid) to authenticated,service_role;
