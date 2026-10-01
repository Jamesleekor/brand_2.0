-- B.R.A.N.D 2.0
-- Login/dashboard performance hotfix (2026-10-01)
-- 1) Make peer-review enforcement status a lightweight aggregate instead of
--    materializing the full peer-review JSON payload (including obligations/reviews).
-- Client-side companion changes reduce polling from 15s to 5m, remove per-home
-- emergency finalization, and use the daily credit_scores snapshot on Home.

begin;

create or replace function public.student_get_peer_review_enforcement_status()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_now timestamptz := now();
  v_rounds jsonb := '[]'::jsonb;
  v_required integer := 0;
  v_submitted integer := 0;
  v_missing integer := 0;
  v_row public.student_policy_enforcement_state%rowtype;
  v_elapsed_seconds bigint := 0;
  v_expected_count integer := 0;
  v_penalty_idx integer;
  v_cycle_hours integer := 12;
  v_penalty_bv integer := 1000;
  v_penalty_gold integer := 1000;
  v_next_penalty_at timestamptz;
  v_asset_freeze boolean := false;
  v_snapshot jsonb;
begin
  if v_student_id is null or v_classroom_id is null then
    raise exception '[PR-ENFORCE] student context is missing.' using errcode='P4E01';
  end if;

  -- Hot path: aggregate only the fields enforcement actually consumes.
  -- Do NOT call student_get_guild4_peer_review_rounds(): that function builds
  -- every obligation/revision/comment as JSON and is intended for the review UI.
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'round_id', q.round_id,
          'mission_title', q.mission_title,
          'guild_name', q.guild_name,
          'required_count', q.required_count,
          'submitted_required_count', q.submitted_required_count
        )
        order by q.round_id desc
      ),
      '[]'::jsonb
    ),
    coalesce(sum(q.required_count), 0)::integer,
    coalesce(sum(q.submitted_required_count), 0)::integer,
    coalesce(sum(q.required_count - q.submitted_required_count), 0)::integer
  into v_rounds, v_required, v_submitted, v_missing
  from (
    select
      r.id as round_id,
      m.title as mission_title,
      p.guild_name_at_snapshot as guild_name,
      count(o.id)::integer as required_count,
      count(o.id) filter (where o.latest_review_revision_id is not null)::integer as submitted_required_count
    from public.guild4_peer_review_participants p
    join public.guild4_peer_review_rounds r
      on r.id = p.round_id
     and r.classroom_id = v_classroom_id
     and r.lifecycle_state = 'OPEN'
     and coalesce(r.monthly_eligible, true) = true
     and coalesce(r.deadline_at, 'infinity'::timestamptz) >= v_now
    join public.guild3_missions m
      on m.id = r.mission_id
    join public.guild4_peer_review_obligations o
      on o.round_id = r.id
     and o.reviewer_student_id = v_student_id
     and o.obligation_status = 'REQUIRED'
    where p.student_id = v_student_id
      and p.classroom_id = v_classroom_id
    group by r.id, m.title, p.guild_name_at_snapshot
    having count(o.id) > count(o.id) filter (where o.latest_review_revision_id is not null)
  ) q;

  if v_missing <= 0 then
    -- Avoid a write on every harmless status poll when already clear.
    update public.student_policy_enforcement_state
       set active = false,
           resolved_at = v_now,
           updated_at = v_now,
           last_snapshot = jsonb_build_object(
             'active', false,
             'reason', 'peer_review_cleared',
             'resolved_at', v_now
           )
     where student_id = v_student_id
       and policy_key = 'PEER_REVIEW_OVERDUE'
       and active = true;

    return jsonb_build_object(
      'active', false,
      'rounds', '[]'::jsonb,
      'required_count', 0,
      'submitted_count', 0,
      'missing_count', 0,
      'current_penalty_count', 0,
      'penalty_cycle_hours', v_cycle_hours,
      'penalty_amount_bv', v_penalty_bv,
      'penalty_amount_gold', v_penalty_gold,
      'total_bv_penalty', 0,
      'total_gold_penalty', 0,
      'asset_freeze_active', false,
      'enforcement_started_at', null,
      'next_penalty_at', null
    );
  end if;

  select * into v_row
  from public.student_policy_enforcement_state
  where student_id = v_student_id
    and policy_key = 'PEER_REVIEW_OVERDUE'
  for update;

  if not found then
    insert into public.student_policy_enforcement_state(
      student_id, classroom_id, policy_key, active, first_seen_at, resolved_at,
      last_penalty_count, last_penalty_at, updated_at, last_snapshot
    ) values (
      v_student_id, v_classroom_id, 'PEER_REVIEW_OVERDUE', true, v_now, null,
      0, null, v_now,
      jsonb_build_object('active', true, 'created_at', v_now)
    )
    returning * into v_row;
  elsif not coalesce(v_row.active, false) then
    update public.student_policy_enforcement_state
       set classroom_id = v_classroom_id,
           active = true,
           first_seen_at = v_now,
           resolved_at = null,
           last_penalty_count = 0,
           last_penalty_at = null,
           updated_at = v_now,
           last_snapshot = jsonb_build_object('active', true, 'reactivated_at', v_now)
     where student_id = v_student_id
       and policy_key = 'PEER_REVIEW_OVERDUE'
     returning * into v_row;
  end if;

  v_elapsed_seconds := greatest(0, floor(extract(epoch from (v_now - v_row.first_seen_at)))::bigint);
  v_expected_count := floor(v_elapsed_seconds::numeric / 43200.0)::integer;

  if v_expected_count > coalesce(v_row.last_penalty_count, 0) then
    for v_penalty_idx in (coalesce(v_row.last_penalty_count, 0) + 1)..v_expected_count loop
      perform public._teacher_apply_asset_deduction(
        v_student_id,
        'BV'::public.value_token_type,
        v_penalty_bv,
        format('[운영 제한] 동료평가 미완료 누적 페널티 %s회차 · 최초 경고 후 %s시간 경과', v_penalty_idx, v_penalty_idx * v_cycle_hours)
      );

      perform public._teacher_apply_asset_deduction(
        v_student_id,
        'GOLD'::public.value_token_type,
        v_penalty_gold,
        format('[운영 제한] 동료평가 미완료 누적 페널티 %s회차 · 최초 경고 후 %s시간 경과', v_penalty_idx, v_penalty_idx * v_cycle_hours)
      );
    end loop;

    update public.student_policy_enforcement_state
       set last_penalty_count = v_expected_count,
           last_penalty_at = v_now,
           updated_at = v_now
     where student_id = v_student_id
       and policy_key = 'PEER_REVIEW_OVERDUE'
     returning * into v_row;
  end if;

  v_asset_freeze := v_expected_count >= 1;
  v_next_penalty_at := v_row.first_seen_at + make_interval(hours => v_cycle_hours * (coalesce(v_row.last_penalty_count, 0) + 1));

  v_snapshot := jsonb_build_object(
    'active', true,
    'rounds', v_rounds,
    'required_count', v_required,
    'submitted_count', v_submitted,
    'missing_count', v_missing,
    'enforcement_started_at', v_row.first_seen_at,
    'next_penalty_at', v_next_penalty_at,
    'current_penalty_count', coalesce(v_row.last_penalty_count, 0),
    'penalty_cycle_hours', v_cycle_hours,
    'penalty_amount_bv', v_penalty_bv,
    'penalty_amount_gold', v_penalty_gold,
    'total_bv_penalty', coalesce(v_row.last_penalty_count, 0) * v_penalty_bv,
    'total_gold_penalty', coalesce(v_row.last_penalty_count, 0) * v_penalty_gold,
    'asset_freeze_active', v_asset_freeze
  );

  -- Polling a blocked account should normally be read-only. Persist only when
  -- the snapshot actually changed (completion counts / penalty cycle / etc.).
  if v_row.classroom_id is distinct from v_classroom_id
     or v_row.active is distinct from true
     or v_row.last_snapshot is distinct from v_snapshot then
    update public.student_policy_enforcement_state
       set classroom_id = v_classroom_id,
           active = true,
           updated_at = v_now,
           last_snapshot = v_snapshot
     where student_id = v_student_id
       and policy_key = 'PEER_REVIEW_OVERDUE';
  end if;

  return v_snapshot;
end;
$function$;

revoke all on function public.student_get_peer_review_enforcement_status() from public, anon;
grant execute on function public.student_get_peer_review_enforcement_status() to authenticated, service_role;

commit;
