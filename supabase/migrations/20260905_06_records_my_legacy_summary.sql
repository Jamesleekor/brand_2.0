-- Records: student-facing personal legacy summary.
-- This is a compact historical summary for the top of "나의 발자취".
-- Detailed ledgers remain in the existing domain panels.

create or replace function public.student_get_my_records_legacy_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_school_year integer;
  v_result jsonb;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS] authenticated student context is required.' using errcode='P0935';
  end if;

  select c.school_year into v_school_year
  from public.classrooms c
  where c.id = v_classroom_id;

  with me as (
    select s.id, s.classroom_id, s.name, s.brand_name, s.cached_tier, s.enrolled_at
    from public.students s
    where s.id = v_student_id and s.classroom_id = v_classroom_id
  ),
  current_wallet as (
    select coalesce(w.bv,0)::numeric as bv,
           coalesce(w.gold,0)::numeric as gold,
           coalesce(w.crystal,0)::numeric as crystal,
           w.updated_at
    from public.wallets w
    where w.student_id = v_student_id
  ),
  asset_candidates as (
    select 'BV'::text as token, l.balance_after_bv::numeric as value,
           coalesce(l.occurred_at, l.event_date::timestamp at time zone 'Asia/Seoul') as occurred_at,
           10 as source_priority, l.id::bigint as source_id
    from public.legacy_asset_history l
    where l.classroom_id=v_classroom_id and l.student_id=v_student_id
    union all
    select 'GOLD', l.balance_after_gold::numeric,
           coalesce(l.occurred_at, l.event_date::timestamp at time zone 'Asia/Seoul'),
           10, l.id::bigint
    from public.legacy_asset_history l
    where l.classroom_id=v_classroom_id and l.student_id=v_student_id
    union all
    select t.value_token::text, t.balance_after::numeric, t.created_at, 20, t.id
    from public.transactions t
    where t.classroom_id=v_classroom_id and t.student_id=v_student_id
      and t.value_token in ('BV','GOLD') and not t.is_reversed
    union all
    select 'BV', w.bv::numeric, w.updated_at, 30, w.id::bigint
    from public.wallets w where w.student_id=v_student_id
    union all
    select 'GOLD', w.gold::numeric, w.updated_at, 30, w.id::bigint
    from public.wallets w where w.student_id=v_student_id
  ),
  asset_peaks as (
    select distinct on (token) token, value, occurred_at
    from asset_candidates
    order by token, value desc, occurred_at asc nulls last, source_priority asc, source_id asc
  ),
  achievement_summary as (
    select count(sa.id) filter(where not sa.is_revoked)::integer as valid_count,
           count(sa.id) filter(where not sa.is_revoked and a.is_active)::integer as active_valid_count,
           count(sa.id) filter(where not sa.is_revoked and a.grade='유일')::integer as unique_count,
           count(sa.id) filter(where not sa.is_revoked and a.grade='초월')::integer as transcend_count
    from public.student_achievements sa
    join public.achievements a on a.id=sa.achievement_id
    where sa.classroom_id=v_classroom_id and sa.student_id=v_student_id
  ),
  achievement_catalog as (
    select count(*) filter(where a.is_active)::integer as active_catalog_count
    from public.achievements a
    where a.classroom_id=v_classroom_id
  ),
  my_identity as (
    select format('CLASSROOM:%s:STUDENT:%s',v_classroom_id,v_student_id) as identity_key
  ),
  mvp_rows as (
    select m.period_key,m.school_year,m.month_no
    from public.records_monthly_mvp_archive m, my_identity i
    where m.status='ACTIVE'
      and m.metadata->>'winner_identity_key'=i.identity_key
  ),
  mvp_summary as (
    select count(*)::integer as win_count,
           min(period_key) as first_win_period,
           max(period_key) as latest_win_period
    from mvp_rows
  ),
  guild_rows as (
    select c.year_month,
           ss.final_contribution::numeric as contribution,
           gs.rank_position::integer as guild_rank
    from public.guild5_month_closures c
    join public.guild5_closure_versions v on v.id=c.current_version_id
    join public.guild5_student_snapshots ss on ss.version_id=v.id and ss.student_id=v_student_id
    join public.guild5_guild_snapshots gs on gs.version_id=v.id and gs.guild_id=ss.guild_id
    where c.classroom_id=v_classroom_id and c.lifecycle_state='FINALIZED'
  ),
  guild_summary as (
    select count(*)::integer as finalized_months,
           count(*) filter(where guild_rank=1)::integer as win_months,
           min(guild_rank)::integer as best_guild_rank,
           max(contribution)::numeric as best_contribution
    from guild_rows
  ),
  guild_best_period as (
    select year_month
    from guild_rows
    order by contribution desc, year_month asc
    limit 1
  ),
  arcade_rows as (
    select s.contribution_year_month, s.game_id, r.rank
    from public.arcade_monthly_snapshot_student_ranks r
    join public.arcade_monthly_snapshots s on s.id=r.snapshot_id
    join public.arcade_monthly_finalizations f on f.id=s.finalization_id
    where f.classroom_id=v_classroom_id and r.student_id=v_student_id
  ),
  arcade_summary as (
    select count(*)::integer as finalized_game_entries,
           count(*) filter(where rank=1)::integer as win_count,
           count(*) filter(where rank<=3)::integer as top3_count,
           count(distinct game_id) filter(where rank=1)::integer as distinct_games_won,
           min(rank)::integer as best_rank
    from arcade_rows
  ),
  attendance_summary as (
    select count(*) filter(where a.status in ('PRESENT','LATE'))::integer as attended_days,
           coalesce(max(a.streak_days),0)::integer as best_streak
    from public.attendances a
    where a.classroom_id=v_classroom_id and a.student_id=v_student_id
  ),
  first_dates as (
    select min(d)::date as first_recorded_on
    from (
      select min(l.event_date)::date as d from public.legacy_asset_history l where l.classroom_id=v_classroom_id and l.student_id=v_student_id
      union all
      select min((t.created_at at time zone 'Asia/Seoul')::date) from public.transactions t where t.classroom_id=v_classroom_id and t.student_id=v_student_id and not t.is_reversed
      union all
      select min((sa.achieved_at at time zone 'Asia/Seoul')::date) from public.student_achievements sa where sa.classroom_id=v_classroom_id and sa.student_id=v_student_id and not sa.is_revoked
      union all
      select min(a.attendance_date) from public.attendances a where a.classroom_id=v_classroom_id and a.student_id=v_student_id
    ) x
    where d is not null
  )
  select jsonb_build_object(
    'school_year',v_school_year,
    'first_recorded_on',coalesce(fd.first_recorded_on,m.enrolled_at),
    'current',jsonb_build_object(
      'tier',m.cached_tier,
      'bv',coalesce(w.bv,0),
      'gold',coalesce(w.gold,0),
      'crystal',coalesce(w.crystal,0)
    ),
    'peaks',jsonb_build_object(
      'bv',jsonb_build_object(
        'value',coalesce((select p.value from asset_peaks p where p.token='BV'),0),
        'occurred_on',(select (p.occurred_at at time zone 'Asia/Seoul')::date from asset_peaks p where p.token='BV')
      ),
      'gold',jsonb_build_object(
        'value',coalesce((select p.value from asset_peaks p where p.token='GOLD'),0),
        'occurred_on',(select (p.occurred_at at time zone 'Asia/Seoul')::date from asset_peaks p where p.token='GOLD')
      )
    ),
    'achievements',jsonb_build_object(
      'valid_count',coalesce(a.valid_count,0),
      'active_valid_count',coalesce(a.active_valid_count,0),
      'active_catalog_count',coalesce(ac.active_catalog_count,0),
      'completion_percent',case when coalesce(ac.active_catalog_count,0)>0 then round(coalesce(a.active_valid_count,0)::numeric*100/ac.active_catalog_count,2) else 0 end,
      'unique_count',coalesce(a.unique_count,0),
      'transcend_count',coalesce(a.transcend_count,0)
    ),
    'mvp',jsonb_build_object(
      'win_count',coalesce(mv.win_count,0),
      'first_win_period',mv.first_win_period,
      'latest_win_period',mv.latest_win_period
    ),
    'guild',jsonb_build_object(
      'finalized_months',coalesce(g.finalized_months,0),
      'win_months',coalesce(g.win_months,0),
      'best_guild_rank',g.best_guild_rank,
      'best_contribution',coalesce(g.best_contribution,0),
      'best_contribution_period',gb.year_month
    ),
    'arcade',jsonb_build_object(
      'finalized_game_entries',coalesce(ar.finalized_game_entries,0),
      'win_count',coalesce(ar.win_count,0),
      'top3_count',coalesce(ar.top3_count,0),
      'distinct_games_won',coalesce(ar.distinct_games_won,0),
      'best_rank',ar.best_rank
    ),
    'attendance',jsonb_build_object(
      'attended_days',coalesce(att.attended_days,0),
      'best_streak',coalesce(att.best_streak,0)
    )
  ) into v_result
  from me m
  left join current_wallet w on true
  left join achievement_summary a on true
  left join achievement_catalog ac on true
  left join mvp_summary mv on true
  left join guild_summary g on true
  left join guild_best_period gb on true
  left join arcade_summary ar on true
  left join attendance_summary att on true
  left join first_dates fd on true;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

revoke all on function public.student_get_my_records_legacy_summary() from public, anon;
grant execute on function public.student_get_my_records_legacy_summary() to authenticated;
