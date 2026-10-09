-- B.R.A.N.D 2.0 Fragment Expedition
-- TEST classroom week 19 fast-cycle QA override.
-- Production migration version: 20261009121739
--
-- Dedicated TEST fixture students normally do not count toward world progression.
-- This week-specific override lets classroom 3 / week 19 exercise Saturday/Sunday
-- leader and world-effect flows without changing real-class behavior.

create or replace function public._expedition_force_test_run_exclusion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allow_fixture_world_counts boolean := false;
begin
  if new.week_id is not null then
    select coalesce(
      (w.config_snapshot->>'test_counts_for_world_override')::boolean,
      false
    )
    into v_allow_fixture_world_counts
    from public.expedition_weeks w
    where w.id=new.week_id;
  end if;

  if public._expedition_is_test_student(new.student_id)
     and not v_allow_fixture_world_counts then
    new.counts_for_world := false;
  end if;

  return new;
end;
$$;

revoke all on function public._expedition_force_test_run_exclusion()
  from public, anon, authenticated;
grant execute on function public._expedition_force_test_run_exclusion()
  to service_role;

update public.expedition_weeks
set config_snapshot = coalesce(config_snapshot,'{}'::jsonb)
  || jsonb_build_object(
       'test_counts_for_world_override', true,
       'test_force_world_effect_min_level', 1,
       'test_fast_cycle', true
     ),
    updated_at=clock_timestamp()
where id=19
  and classroom_id=3
  and status='PUBLISHED'
  and reward_mode='DRY_RUN';
