create table public.arcade_analytics_game_semantics (
  game_id bigint primary key references public.arcade_games(id) on delete cascade,
  comparison_mode text not null check (comparison_mode in ('HIGHER_SCORE_BETTER','LOWER_SCORE_BETTER','CUSTOM')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.arcade_analytics_game_semantics enable row level security;
revoke all on table public.arcade_analytics_game_semantics from public,anon,authenticated;
grant select,insert,update,delete on table public.arcade_analytics_game_semantics to service_role;

insert into public.arcade_analytics_game_semantics(game_id,comparison_mode,notes)
select g.id,'HIGHER_SCORE_BETTER','Current operational resolver ranks official_score DESC, achieved_at ASC.'
from public.arcade_games g
where g.code='focus_reaction_01'
on conflict (game_id) do update
set comparison_mode=excluded.comparison_mode,notes=excluded.notes,updated_at=now();

create or replace function public.teacher_get_arcade_statistics(
  p_classroom_id integer,
  p_guild_season_id integer default null,
  p_year_month text default null,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_season_id integer;
  v_year_month text;
  v_period_id bigint;
  v_period_status text;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  select coalesce(p_guild_season_id,
    (select gs.id from public.guild_seasons gs where gs.classroom_id=p_classroom_id and gs.is_active=true order by gs.id desc limit 1))
    into v_season_id;

  if v_season_id is null then
    raise exception 'No active guild season found' using errcode='P0610';
  end if;

  if not exists(select 1 from public.guild_seasons gs where gs.id=v_season_id and gs.classroom_id=p_classroom_id) then
    raise exception 'Guild season does not belong to classroom' using errcode='P0611';
  end if;

  v_year_month := coalesce(p_year_month,to_char(timezone('Asia/Seoul',clock_timestamp()),'YYYY-MM'));
  if v_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid year month: %',v_year_month using errcode='22023';
  end if;

  select p.id,p.status into v_period_id,v_period_status
  from public.arcade_ranking_periods p
  where p.classroom_id=p_classroom_id
    and p.period_kind='MONTHLY'
    and p.guild_season_id=v_season_id
    and p.contribution_year_month=v_year_month
    and p.status in ('ACTIVE','FINALIZED')
  order by case p.status when 'ACTIVE' then 0 else 1 end,p.id desc
  limit 1;

  with
  eligible_students as (
    select s.id,s.name,s.brand_name,s.is_test_account
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.transferred_at is null
      and (
        s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
        or (p_include_test and s.role::text='TEST')
      )
      and (p_include_test or not coalesce(s.is_test_account,false))
  ),
  games as (
    select g.id,g.code,g.internal_name,g.is_active,g.available_from,g.available_until,
           sem.comparison_mode,sem.notes as semantics_notes
    from public.arcade_games g
    left join public.arcade_analytics_game_semantics sem on sem.game_id=g.id
  ),
  run_scope as (
    select r.*
    from public.arcade_runs r
    join eligible_students es on es.id=r.student_id
    where r.classroom_id=p_classroom_id
      and not r.is_prerelease_test
      and not exists(
        select 1 from public.arcade_run_moderation_events m
        where m.run_id=r.id and m.event_kind='INVALIDATE'
      )
  ),
  run_agg as (
    select r.student_id,r.game_id,
      count(*) filter (where r.play_started_at is not null) as play_count,
      count(*) filter (where r.submitted_at is not null or exists(select 1 from public.arcade_run_submissions rs where rs.run_id=r.id)) as submission_count,
      count(*) filter (where r.status='VERIFIED') as verification_success_count,
      count(*) filter (where r.status='REJECTED') as verification_failure_count,
      min(r.play_started_at) filter (where r.play_started_at is not null) as first_play_at,
      max(r.play_started_at) filter (where r.play_started_at is not null) as latest_play_at
    from run_scope r group by r.student_id,r.game_id
  ),
  alltime_pb as (
    select distinct on (r.student_id,r.game_id)
      r.student_id,r.game_id,r.id as run_id,r.official_score,r.game_over_at,r.rule_version_id,r.official_duration_ms,r.stats
    from run_scope r
    join games g on g.id=r.game_id and g.comparison_mode='HIGHER_SCORE_BETTER'
    where r.status='VERIFIED' and r.official_score is not null
    order by r.student_id,r.game_id,r.official_score desc,r.game_over_at asc,r.id asc
  ),
  live_period_rank as (
    select g.id as game_id,x.source_run_id,x.student_id,x.official_score,x.achieved_at,x.rank
    from games g
    cross join lateral public.arcade_resolve_period_student_ranks(p_classroom_id,v_period_id,g.id) x
    where v_period_id is not null and v_period_status='ACTIVE'
  ),
  finalized_period_rank as (
    select s.game_id,r.source_run_id,r.student_id,r.official_score,r.achieved_at,r.rank
    from public.arcade_monthly_snapshots s
    join public.arcade_monthly_snapshot_student_ranks r on r.snapshot_id=s.id
    join eligible_students es on es.id=r.student_id
    where v_period_id is not null and v_period_status='FINALIZED'
      and s.classroom_id=p_classroom_id and s.period_id=v_period_id
  ),
  current_period_rank as (
    select * from live_period_rank
    union all
    select * from finalized_period_rank
  ),
  official_ranks as (
    select sn.game_id,sn.contribution_year_month,p.guild_season_id,
           sr.student_id,sr.source_run_id,sr.rank,sr.official_score,sr.achieved_at
    from public.arcade_monthly_snapshots sn
    join public.arcade_monthly_finalizations f on f.id=sn.finalization_id
    join public.arcade_ranking_periods p on p.id=sn.period_id and p.status='FINALIZED' and p.period_kind='MONTHLY'
    join public.arcade_monthly_snapshot_student_ranks sr on sr.snapshot_id=sn.id
    join eligible_students es on es.id=sr.student_id
    where sn.classroom_id=p_classroom_id
  ),
  official_agg as (
    select o.student_id,o.game_id,
      min(o.rank) as monthly_best_rank_all_time,
      min(o.rank) filter (where o.guild_season_id=v_season_id) as season_best_rank,
      count(*) filter (where o.rank=1) as monthly_win_count,
      count(*) filter (where o.rank<=3) as monthly_top3_count,
      count(*) filter (where o.rank<=10) as monthly_top10_count
    from official_ranks o group by o.student_id,o.game_id
  ),
  top10_months as (
    select o.student_id,o.game_id,o.contribution_year_month,
      (substring(o.contribution_year_month,1,4)::integer*12 + substring(o.contribution_year_month,6,2)::integer) as month_index,
      row_number() over(partition by o.student_id,o.game_id order by o.contribution_year_month) as rn
    from official_ranks o where o.rank<=10
  ),
  top10_groups as (
    select t.*,t.month_index-t.rn::integer as grp
    from top10_months t
  ),
  top10_streaks as (
    select student_id,game_id,grp,count(*)::integer as streak_len,min(month_index) as start_idx,max(month_index) as end_idx
    from top10_groups group by student_id,game_id,grp
  ),
  latest_game_month as (
    select o.game_id,max(substring(o.contribution_year_month,1,4)::integer*12 + substring(o.contribution_year_month,6,2)::integer) as latest_idx
    from official_ranks o group by o.game_id
  ),
  streak_agg as (
    select s.student_id,s.game_id,max(s.streak_len) as max_consecutive_top10,
      coalesce(max(s.streak_len) filter (where s.end_idx=lg.latest_idx),0) as current_consecutive_top10
    from top10_streaks s join latest_game_month lg on lg.game_id=s.game_id
    group by s.student_id,s.game_id
  ),
  student_game as (
    select es.id as student_id,es.name as student_name,es.brand_name,es.is_test_account,
           g.id as game_id,g.code as game_code,g.internal_name as game_name,g.comparison_mode,
           coalesce(ra.play_count,0) as play_count,
           coalesce(ra.submission_count,0) as official_submission_count,
           coalesce(ra.verification_success_count,0) as verification_success_count,
           coalesce(ra.verification_failure_count,0) as verification_failure_count,
           ra.first_play_at,ra.latest_play_at,
           pb.official_score as all_time_pb,pb.game_over_at as all_time_pb_at,pb.run_id as all_time_pb_run_id,
           rv.version_code as all_time_pb_rule_version,pb.official_duration_ms as all_time_pb_duration_ms,pb.stats as all_time_pb_stats,
           cpr.official_score as current_period_pb,cpr.rank as current_period_rank,cpr.achieved_at as current_period_pb_at,
           oa.monthly_best_rank_all_time,oa.season_best_rank,
           coalesce(oa.monthly_win_count,0) as monthly_win_count,
           coalesce(oa.monthly_top3_count,0) as monthly_top3_count,
           coalesce(oa.monthly_top10_count,0) as monthly_top10_count,
           coalesce(sa.current_consecutive_top10,0) as current_consecutive_top10,
           coalesce(sa.max_consecutive_top10,0) as max_consecutive_top10
    from eligible_students es
    cross join games g
    left join run_agg ra on ra.student_id=es.id and ra.game_id=g.id
    left join alltime_pb pb on pb.student_id=es.id and pb.game_id=g.id
    left join public.arcade_game_rule_versions rv on rv.id=pb.rule_version_id
    left join current_period_rank cpr on cpr.student_id=es.id and cpr.game_id=g.id
    left join official_agg oa on oa.student_id=es.id and oa.game_id=g.id
    left join streak_agg sa on sa.student_id=es.id and sa.game_id=g.id
  ),
  student_summary as (
    select es.id as student_id,es.name as student_name,
      count(distinct r.game_id) filter (where r.play_started_at is not null) as different_games_played,
      count(distinct o.game_id) filter (where o.rank=1) as different_games_won
    from eligible_students es
    left join run_scope r on r.student_id=es.id
    left join official_ranks o on o.student_id=es.id
    group by es.id,es.name
  ),
  game_summary as (
    select g.id as game_id,g.code as game_code,g.internal_name as game_name,g.is_active,g.comparison_mode,g.semantics_notes,
      (select coalesce(jsonb_agg(jsonb_build_object('id',rv.id,'version_code',rv.version_code,'is_active',rv.is_active,'created_at',rv.created_at) order by rv.id),'[]'::jsonb)
       from public.arcade_game_rule_versions rv where rv.game_id=g.id) as rule_versions,
      count(r.id) filter (where r.play_started_at is not null) as play_count,
      count(r.id) filter (where r.status='VERIFIED') as verified_count,
      count(r.id) filter (where r.status='REJECTED') as rejected_count,
      min(r.created_at) as tracking_start_at
    from games g left join run_scope r on r.game_id=g.id
    group by g.id,g.code,g.internal_name,g.is_active,g.comparison_mode,g.semantics_notes
  )
  select jsonb_build_object(
    'scope',jsonb_build_object(
      'classroom_id',p_classroom_id,
      'guild_season_id',v_season_id,
      'year_month',v_year_month,
      'monthly_period_id',v_period_id,
      'monthly_period_status',v_period_status,
      'include_test',p_include_test
    ),
    'definitions',jsonb_build_object(
      'plays','run rows with play_started_at, excluding prerelease and invalidated runs',
      'official_submissions','submitted run or run submission payload exists',
      'current_period_rank','ACTIVE uses existing arcade_resolve_period_student_ranks; FINALIZED uses immutable monthly snapshot',
      'official_history','FINALIZED monthly snapshots only',
      'season_best_rank','best rank among FINALIZED monthly snapshots linked to selected guild season',
      'pb_semantics','all-time PB is calculated only when arcade_analytics_game_semantics is HIGHER_SCORE_BETTER; CUSTOM games require explicit analytics support',
      'rank1_hold_history','candidate phase should reconstruct only for games with supported semantics; no invented backfill'
    ),
    'games',coalesce((select jsonb_agg(to_jsonb(gs) order by gs.game_id) from game_summary gs),'[]'::jsonb),
    'student_game_rows',coalesce((select jsonb_agg(to_jsonb(sg) order by sg.student_name,sg.student_id,sg.game_id) from student_game sg),'[]'::jsonb),
    'student_summaries',coalesce((select jsonb_agg(to_jsonb(ss) order by ss.student_name,ss.student_id) from student_summary ss),'[]'::jsonb),
    'data_quality',jsonb_build_object(
      'eligible_student_count',(select count(*) from eligible_students),
      'game_count',(select count(*) from games),
      'active_game_without_semantics',(select count(*) from games where is_active and comparison_mode is null),
      'verified_run_without_score',(select count(*) from run_scope where status='VERIFIED' and official_score is null),
      'verified_run_without_game_over_at',(select count(*) from run_scope where status='VERIFIED' and game_over_at is null),
      'finalized_monthly_period_without_finalization',(
        select count(*) from public.arcade_ranking_periods p
        where p.classroom_id=p_classroom_id and p.period_kind='MONTHLY' and p.status='FINALIZED'
          and not exists(select 1 from public.arcade_monthly_finalizations f where f.period_id=p.id)
      ),
      'snapshot_test_student_rows',(
        select count(*) from public.arcade_monthly_snapshot_student_ranks sr
        join public.arcade_monthly_snapshots sn on sn.id=sr.snapshot_id
        join public.students s on s.id=sr.student_id
        where sn.classroom_id=p_classroom_id and coalesce(s.is_test_account,false)
      ),
      'snapshot_nonverified_source_runs',(
        select count(*) from public.arcade_monthly_snapshot_student_ranks sr
        join public.arcade_monthly_snapshots sn on sn.id=sr.snapshot_id
        join public.arcade_runs r on r.id=sr.source_run_id
        where sn.classroom_id=p_classroom_id and r.status<>'VERIFIED'
      ),
      'invalidated_verified_runs',(
        select count(*) from public.arcade_runs r
        where r.classroom_id=p_classroom_id and r.status='VERIFIED'
          and exists(select 1 from public.arcade_run_moderation_events m where m.run_id=r.id and m.event_kind='INVALIDATE')
      ),
      'official_finalization_count',(select count(*) from public.arcade_monthly_finalizations f where f.classroom_id=p_classroom_id),
      'current_period_rank_count',(select count(*) from current_period_rank)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.teacher_get_arcade_statistics(integer,integer,text,boolean) from public,anon;
grant execute on function public.teacher_get_arcade_statistics(integer,integer,text,boolean) to authenticated,service_role;