-- B.R.A.N.D 2.0 Fragment Expedition
-- 1) Add idempotent Monday AUTO_GRANT for unclaimed LIVE personal rewards.
-- 2) Keep AUTO_GRANT_REWARDS separate from SETTLE_WORLD.
-- 3) Treat dedicated TEST fixture classroom students as expedition test participants
--    without relaxing the global one-live-test-agent-per-classroom invariant.
-- Production migration version: 20261009065117

alter table public.expedition_week_operations
  drop constraint if exists expedition_week_operations_code_chk;

alter table public.expedition_week_operations
  add constraint expedition_week_operations_code_chk
  check (operation_code = any (array[
    'SAT_RECONCILE'::text,
    'SETTLE_WORLD'::text,
    'AUTO_GRANT_REWARDS'::text,
    'SUPPLY_GRANT'::text
  ]));

create or replace function public._expedition_is_test_student(p_student_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select
      s.is_test_account
      or exists (
        select 1
        from public.test_classroom_fixtures f
        where f.classroom_id = s.classroom_id
      )
    from public.students s
    where s.id = p_student_id
      and s.transferred_at is null
  ), false);
$$;

revoke all on function public._expedition_is_test_student(integer)
  from public, anon, authenticated;
grant execute on function public._expedition_is_test_student(integer)
  to service_role;

create or replace function public._expedition_force_test_run_exclusion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._expedition_is_test_student(new.student_id) then
    new.counts_for_world := false;
  end if;
  return new;
end;
$$;

revoke all on function public._expedition_force_test_run_exclusion()
  from public, anon, authenticated;
grant execute on function public._expedition_force_test_run_exclusion()
  to service_role;

drop trigger if exists expedition_force_test_run_exclusion_trg
  on public.expedition_runs;

create trigger expedition_force_test_run_exclusion_trg
before insert on public.expedition_runs
for each row
execute function public._expedition_force_test_run_exclusion();

create or replace function public._expedition_auto_grant_unclaimed_rewards_for_week(
  p_week_id bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_week public.expedition_weeks%rowtype;
  v_settings public.expedition_settings%rowtype;
  v_existing jsonb;
  v_reward record;
  v_request_id uuid;
  v_asset_result jsonb;
  v_transaction_id bigint;
  v_box_count integer;
  v_box_item_id bigint;
  v_granted integer := 0;
  v_already integer := 0;
  v_errors integer := 0;
  v_error_runs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select * into v_week
  from public.expedition_weeks
  where id = p_week_id
  for update;

  if not found then
    raise exception 'EXPEDITION_WEEK_NOT_FOUND' using errcode='P0E39';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('EXPEDITION_WEEK_OP|' || p_week_id::text, 0)
  );

  select result_snapshot into v_existing
  from public.expedition_week_operations
  where week_id = p_week_id
    and operation_code = 'AUTO_GRANT_REWARDS';

  if found then
    return v_existing || jsonb_build_object('idempotent_replay', true);
  end if;

  if v_week.reward_mode <> 'LIVE' then
    return jsonb_build_object(
      'week_id', p_week_id,
      'reward_mode', v_week.reward_mode,
      'skipped', true,
      'reason', 'NOT_LIVE',
      'idempotent_replay', false
    );
  end if;

  if clock_timestamp() < v_week.settle_at then
    raise exception 'EXPEDITION_AUTO_GRANT_TOO_EARLY'
      using errcode='P0EB1';
  end if;

  select * into v_settings
  from public.expedition_settings
  where classroom_id = v_week.classroom_id;

  if not found
     or not coalesce(v_settings.is_core_enabled, false)
     or not coalesce(v_settings.is_reward_grant_enabled, false) then
    raise exception 'EXPEDITION_LIVE_REWARD_GRANT_DISABLED'
      using errcode='P0E58';
  end if;

  for v_reward in
    select
      r.id as run_id,
      r.classroom_id,
      r.student_id,
      r.week_id,
      rw.reward_tier,
      rw.reward_kind,
      rw.reward_code,
      rw.quantity
    from public.expedition_runs r
    join public.expedition_run_rewards rw on rw.run_id = r.id
    where r.week_id = p_week_id
      and rw.reward_mode = 'LIVE'
      and not exists (
        select 1
        from public.expedition_reward_claims c
        where c.run_id = r.id
      )
    order by r.id
  loop
    begin
      perform pg_advisory_xact_lock(
        hashtextextended('EXPEDITION_CLAIM|' || v_reward.run_id::text, 0)
      );

      if exists (
        select 1
        from public.expedition_reward_claims c
        where c.run_id = v_reward.run_id
      ) then
        v_already := v_already + 1;
        continue;
      end if;

      v_request_id := md5(
        'EXPEDITION_AUTO_CLAIM|' || v_reward.run_id::text
      )::uuid;
      v_asset_result := '{}'::jsonb;

      if v_reward.reward_kind = 'FRAGMENT' then
        v_asset_result := public._expedition_adjust_fragments(
          v_reward.student_id,
          v_reward.quantity,
          'REWARD',
          v_reward.run_id,
          null,
          v_request_id,
          p_actor_user_id,
          jsonb_build_object(
            'reward_tier', v_reward.reward_tier,
            'reward_code', v_reward.reward_code,
            'claim_method', 'AUTO'
          )
        );

      elsif v_reward.reward_kind = 'GOLD' then
        v_transaction_id := public.create_transaction(
          v_reward.student_id,
          'GOLD'::public.value_token_type,
          v_reward.quantity,
          'EXPEDITION_REWARD'::public.transaction_source_type,
          v_reward.run_id,
          0,
          format('[편린 원정 자동정산] %s GOLD', v_reward.quantity)
        );
        v_asset_result := jsonb_build_object(
          'transaction_id', v_transaction_id,
          'gold_granted', v_reward.quantity
        );

      elsif v_reward.reward_kind = 'EXPEDITION_BOX' then
        select count(*), min(id)
          into v_box_count, v_box_item_id
        from public.market_items
        where classroom_id = v_reward.classroom_id
          and is_active = true
          and is_archived = false
          and metadata->>'expedition_reward_key' = v_reward.reward_code
          and metadata->>'special_action' = 'EXPEDITION_BOX';

        if v_box_count <> 1 then
          raise exception 'EXPEDITION_BOX_MASTER_MAPPING_INVALID code=% count=%',
            v_reward.reward_code, v_box_count using errcode='P0E83';
        end if;

        v_asset_result := public._expedition_grant_inventory_item(
          v_reward.student_id,
          v_box_item_id,
          1,
          'EXPEDITION_RUN',
          v_reward.run_id,
          jsonb_build_object(
            'reward_tier', v_reward.reward_tier,
            'reward_code', v_reward.reward_code,
            'claim_request_id', v_request_id,
            'claim_method', 'AUTO'
          )
        );
      else
        raise exception 'EXPEDITION_REWARD_KIND_UNSUPPORTED kind=%',
          v_reward.reward_kind using errcode='P0E84';
      end if;

      insert into public.expedition_reward_claims(
        run_id, classroom_id, student_id, week_id, claim_request_id,
        claim_method, claim_status, claimed_at, metadata
      )
      values(
        v_reward.run_id,
        v_reward.classroom_id,
        v_reward.student_id,
        v_reward.week_id,
        v_request_id,
        'AUTO',
        'GRANTED',
        clock_timestamp(),
        jsonb_build_object(
          'dry_run', false,
          'asset_write_performed', true,
          'reward_code', v_reward.reward_code,
          'reward_kind', v_reward.reward_kind,
          'quantity', v_reward.quantity,
          'asset_result', v_asset_result
        )
      );

      v_granted := v_granted + 1;
    exception when others then
      v_errors := v_errors + 1;
      v_error_runs := v_error_runs || jsonb_build_array(
        jsonb_build_object(
          'run_id', v_reward.run_id,
          'sqlstate', sqlstate,
          'error', sqlerrm
        )
      );
    end;
  end loop;

  v_result := jsonb_build_object(
    'week_id', p_week_id,
    'reward_mode', v_week.reward_mode,
    'granted', v_granted,
    'already_claimed', v_already,
    'errors', v_errors,
    'error_runs', v_error_runs,
    'completed_at', clock_timestamp()
  );

  if v_errors = 0 then
    insert into public.expedition_week_operations(
      classroom_id, week_id, operation_code, actor_user_id,
      result_snapshot, completed_at
    )
    values(
      v_week.classroom_id,
      p_week_id,
      'AUTO_GRANT_REWARDS',
      p_actor_user_id,
      v_result,
      clock_timestamp()
    );
  end if;

  return v_result || jsonb_build_object(
    'idempotent_replay', false,
    'completed', v_errors = 0
  );
end
$$;

revoke all on function public._expedition_auto_grant_unclaimed_rewards_for_week(bigint, uuid)
  from public, anon, authenticated;
grant execute on function public._expedition_auto_grant_unclaimed_rewards_for_week(bigint, uuid)
  to service_role;

create or replace function public.teacher_auto_grant_expedition_rewards(
  p_week_id bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
begin
  select classroom_id into v_classroom_id
  from public.expedition_weeks
  where id = p_week_id;

  if v_classroom_id is null then
    raise exception 'EXPEDITION_WEEK_NOT_FOUND' using errcode='P0E39';
  end if;

  if not public._expedition_teacher_can_manage_classroom(v_classroom_id) then
    raise exception 'EXPEDITION_TEACHER_CLASSROOM_ACCESS_DENIED'
      using errcode='42501';
  end if;

  return public._expedition_auto_grant_unclaimed_rewards_for_week(
    p_week_id,
    auth.uid()
  );
end
$$;

revoke all on function public.teacher_auto_grant_expedition_rewards(bigint)
  from public, anon;
grant execute on function public.teacher_auto_grant_expedition_rewards(bigint)
  to authenticated, service_role;

create or replace function public.process_expedition_lifecycle_cron()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  a record;
  s record;
  v_auto_result jsonb;
  v_sat integer := 0;
  v_settle integer := 0;
  v_auto integer := 0;
  v_supply integer := 0;
  v_errors integer := 0;
begin
  for r in
    select w.id, w.sun_open_at, w.settle_at
    from public.expedition_weeks w
    join public.expedition_settings st on st.classroom_id = w.classroom_id
    where w.status = 'PUBLISHED'
      and st.is_core_enabled = true
      and st.is_scheduler_enabled = true
      and clock_timestamp() >= w.sun_open_at
    order by w.week_start_date, w.id
  loop
    begin
      if not exists(
        select 1
        from public.expedition_week_operations
        where week_id = r.id
          and operation_code = 'SAT_RECONCILE'
      ) then
        perform public._expedition_reconcile_saturday(r.id, null);
        v_sat := v_sat + 1;
      end if;

      if clock_timestamp() >= r.settle_at
         and not exists(
           select 1
           from public.expedition_week_operations
           where week_id = r.id
             and operation_code = 'SETTLE_WORLD'
         ) then
        perform public._expedition_settle_world(r.id, null);
        v_settle := v_settle + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning '[EXPEDITION CRON] week % lifecycle failed: %', r.id, sqlerrm;
    end;
  end loop;

  for a in
    select w.id
    from public.expedition_weeks w
    join public.expedition_settings st on st.classroom_id = w.classroom_id
    where w.status = 'SETTLED'
      and w.reward_mode = 'LIVE'
      and st.is_core_enabled = true
      and st.is_scheduler_enabled = true
      and st.is_reward_grant_enabled = true
      and clock_timestamp() >= w.settle_at
      and not exists(
        select 1
        from public.expedition_week_operations op
        where op.week_id = w.id
          and op.operation_code = 'AUTO_GRANT_REWARDS'
      )
    order by w.week_start_date, w.id
  loop
    begin
      v_auto_result := public._expedition_auto_grant_unclaimed_rewards_for_week(
        a.id,
        null
      );
      if coalesce((v_auto_result->>'errors')::integer, 0) = 0 then
        v_auto := v_auto + 1;
      else
        v_errors := v_errors + coalesce((v_auto_result->>'errors')::integer, 0);
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning '[EXPEDITION CRON] week % auto-grant failed: %', a.id, sqlerrm;
    end;
  end loop;

  for s in
    select w.id
    from public.expedition_weeks w
    join public.expedition_settings st on st.classroom_id = w.classroom_id
    join public.expedition_world_effect_instances e on e.week_id = w.id
    where w.status = 'SETTLED'
      and w.reward_mode = 'LIVE'
      and st.is_core_enabled = true
      and st.is_scheduler_enabled = true
      and e.effect_code = 'SUPPLY'
      and clock_timestamp() >= e.starts_at
      and not exists(
        select 1
        from public.expedition_week_operations op
        where op.week_id = w.id
          and op.operation_code = 'SUPPLY_GRANT'
      )
    order by w.week_start_date, w.id
  loop
    begin
      perform public._expedition_grant_supply_for_week(s.id, null);
      v_supply := v_supply + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning '[EXPEDITION CRON] week % supply failed: %', s.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'saturday_reconciled', v_sat,
    'world_settled', v_settle,
    'auto_grant_processed', v_auto,
    'supply_processed', v_supply,
    'errors', v_errors,
    'processed_at', clock_timestamp()
  );
end
$$;

revoke all on function public.process_expedition_lifecycle_cron()
  from public, anon, authenticated;
grant execute on function public.process_expedition_lifecycle_cron()
  to service_role;
