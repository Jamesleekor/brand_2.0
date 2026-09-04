-- Records v1 / REC-R2D
-- Student-safe, period-scoped Arcade history reader.
-- Production applied once on 2026-09-04 after rollback rehearsal and postcheck.

create function public.student_get_my_arcade_history(
  p_period_id bigint,
  p_limit integer default 50,
  p_offset integer default 0,
  p_game_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_classroom_id integer;
  v_student_id integer;
  v_period public.arcade_ranking_periods%rowtype;
  v_game_id bigint;
  v_result jsonb;
begin
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  if v_classroom_id is null or v_student_id is null then
    raise exception '[ARCADE] authenticated student context is required.' using errcode = 'P0195';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception '[ARCADE] history limit must be between 1 and 100.' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception '[ARCADE] history offset must be zero or greater.' using errcode = '22023';
  end if;

  select * into v_period
  from public.arcade_ranking_periods
  where id = p_period_id
    and classroom_id = v_classroom_id
    and status in ('ACTIVE', 'FINALIZED');
  if not found then
    raise exception '[ARCADE] active or finalized ranking period was not found.' using errcode = 'P0205';
  end if;

  if p_game_code is not null then
    select id into v_game_id from public.arcade_games where code = p_game_code;
    if v_game_id is null then
      raise exception '[ARCADE] game was not found.' using errcode = 'P0206';
    end if;
  end if;

  with filtered as (
    select
      r.id as run_id,
      g.code as game_code,
      g.internal_name as game_name,
      r.status,
      r.official_score,
      r.official_duration_ms,
      r.game_over_at,
      r.submitted_at,
      coalesce(r.game_over_at, r.submitted_at, r.created_at) as occurred_at,
      r.rejection_code,
      r.rejection_reason,
      (inv.created_at is not null) as is_invalidated,
      inv.reason as invalidation_reason,
      inv.created_at as invalidated_at
    from public.arcade_runs r
    join public.arcade_games g on g.id = r.game_id
    left join lateral (
      select m.reason, m.created_at
      from public.arcade_run_moderation_events m
      where m.run_id = r.id and m.event_kind = 'INVALIDATE'
      order by m.id desc
      limit 1
    ) inv on true
    where r.classroom_id = v_classroom_id
      and r.student_id = v_student_id
      and r.status in ('VERIFIED', 'REJECTED')
      and not r.is_prerelease_test
      and coalesce(r.game_over_at, r.submitted_at, r.created_at) >= v_period.starts_at
      and coalesce(r.game_over_at, r.submitted_at, r.created_at) < v_period.ends_at_exclusive
      and (v_game_id is null or r.game_id = v_game_id)
  ), page as (
    select * from filtered
    order by occurred_at desc, run_id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'display_name', v_period.display_name,
    'period_status', v_period.status,
    'total_count', (select count(*) from filtered),
    'limit', p_limit,
    'offset', p_offset,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'run_id', page.run_id,
        'game_code', page.game_code,
        'game_name', page.game_name,
        'status', page.status,
        'official_score', page.official_score,
        'official_duration_ms', page.official_duration_ms,
        'game_over_at', page.game_over_at,
        'submitted_at', page.submitted_at,
        'occurred_at', page.occurred_at,
        'rejection_code', page.rejection_code,
        'rejection_reason', page.rejection_reason,
        'is_invalidated', page.is_invalidated,
        'invalidation_reason', page.invalidation_reason,
        'invalidated_at', page.invalidated_at
      ) order by page.occurred_at desc, page.run_id desc)
      from page
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.student_get_my_arcade_history(bigint, integer, integer, text) from public;
revoke all on function public.student_get_my_arcade_history(bigint, integer, integer, text) from anon;
grant execute on function public.student_get_my_arcade_history(bigint, integer, integer, text) to authenticated;
