create or replace function public.teacher_get_guild_statistics(
  p_classroom_id integer,
  p_season_id integer default null,
  p_year_month text default null,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_season_id integer;
  v_year_month text;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  select coalesce(p_season_id,
    (select gs.id from public.guild_seasons gs
     where gs.classroom_id=p_classroom_id and gs.is_active=true
     order by gs.id desc limit 1))
    into v_season_id;

  if v_season_id is null then
    raise exception 'No guild season found for classroom' using errcode='P0601';
  end if;

  if not exists (
    select 1 from public.guild_seasons gs
    where gs.id=v_season_id and gs.classroom_id=p_classroom_id
  ) then
    raise exception 'Guild season does not belong to classroom' using errcode='P0602';
  end if;

  v_year_month := coalesce(p_year_month, to_char(timezone('Asia/Seoul', clock_timestamp()), 'YYYY-MM'));
  if v_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid year month: %', v_year_month using errcode='22023';
  end if;

  with
  eligible_students as (
    select s.id, s.name, s.brand_name, s.is_test_account
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.transferred_at is null
      and (p_include_test or not coalesce(s.is_test_account,false))
  ),
  selected_season as (
    select gs.id, gs.name, gs.display_name,
           coalesce(gs.starts_on,gs.start_date) as starts_on,
           coalesce(gs.ends_on,gs.end_date) as ends_on,
           gs.is_active, gs.lifecycle_status
    from public.guild_seasons gs where gs.id=v_season_id
  ),
  live_student as (
    select c.student_id,c.scoring_guild_id,c.year_month,c.final_total,c.basic_total,
           c.peer_points,c.mission_points,c.session_points,c.teacher_observation_points,
           c.arcade_raw_total,c.arcade_applied,c.formula_version,c.calculated_at
    from public.guild2_individual_contributions c
    join eligible_students es on es.id=c.student_id
    where c.classroom_id=p_classroom_id and c.season_id=v_season_id and c.year_month=v_year_month
  ),
  live_guild as (
    select s.guild_id,s.year_month,s.draft_gs_total,s.draft_rank,s.individual_subtotal,
           s.mission_gs_subtotal,s.compensation_amount,s.manual_adjustment_total,
           s.scoring_roster_count,s.formula_version,s.calculated_at
    from public.guild2_monthly_gs_summaries s
    where s.classroom_id=p_classroom_id and s.season_id=v_season_id and s.year_month=v_year_month
  ),
  official_closures as (
    select c.id as closure_id,c.season_id,c.year_month,c.current_version_id,
           v.finalized_at,v.version_no,v.closure_formula_version
    from public.guild5_month_closures c
    join public.guild5_closure_versions v on v.id=c.current_version_id and v.closure_id=c.id
    where c.classroom_id=p_classroom_id
      and c.lifecycle_state='FINALIZED'
      and c.current_version_id is not null
  ),
  official_student as (
    select oc.season_id,oc.year_month,oc.finalized_at,ss.student_id,ss.student_name_at_close,
           ss.guild_id,ss.guild_name_at_close,ss.final_contribution,
           ss.peer_points,ss.mission_points,ss.session_points,ss.observation_points,
           ss.arcade_raw_total,ss.arcade_applied
    from official_closures oc
    join public.guild5_student_snapshots ss on ss.version_id=oc.current_version_id
    left join public.students cur on cur.id=ss.student_id
    where p_include_test or not coalesce(cur.is_test_account,false)
  ),
  official_guild as (
    select oc.season_id,oc.year_month,oc.finalized_at,gs.guild_id,gs.guild_name_at_close,
           gs.total_gs,gs.rank_position,gs.roster_count,gs.roster_bv_sum,
           gs.individual_subtotal,gs.official_mission_gs,gs.compensation_amount,
           gs.manual_adjustment_total,gs.monthly_max_gs,gs.monthly_gs_rate
    from official_closures oc
    join public.guild5_guild_snapshots gs on gs.version_id=oc.current_version_id
  ),
  student_official_agg as (
    select os.student_id,
      sum(os.final_contribution) as lifetime_official_contribution,
      sum(os.final_contribution) filter (where os.season_id=v_season_id) as season_official_contribution,
      count(*) as finalized_month_count,
      max(os.final_contribution) as best_monthly_contribution
    from official_student os group by os.student_id
  ),
  student_best_month as (
    select distinct on (os.student_id) os.student_id,os.year_month,os.final_contribution
    from official_student os
    order by os.student_id,os.final_contribution desc,os.year_month asc
  ),
  mission_finalized as (
    select i.id as instance_id,i.mission_id,i.guild_id,i.season_id,i.current_guild_result,i.finalized_at,
           m.contribution_year_month,m.title
    from public.guild3_mission_instances i
    join public.guild3_missions m on m.id=i.mission_id
    where i.classroom_id=p_classroom_id and i.finalized_at is not null
  ),
  mission_participant as (
    select distinct p.mission_instance_id,p.student_id,p.guild_id
    from public.guild3_mission_participants p
    join mission_finalized mf on mf.instance_id=p.mission_instance_id
    left join public.students s on s.id=p.student_id
    where p.classroom_id=p_classroom_id
      and (p_include_test or not coalesce(s.is_test_account,false))
  ),
  mission_documented as (
    select distinct x.mission_instance_id,x.student_id,x.guild_id
    from (
      select ar.mission_instance_id,ar.student_id,ar.guild_id
      from public.guild3_mission_activity_records ar
      join mission_finalized mf on mf.instance_id=ar.mission_instance_id
      where ar.classroom_id=p_classroom_id
      union
      select ms.mission_instance_id,ms.submitted_by_student_id,ms.guild_id
      from public.guild3_mission_submissions ms
      join mission_finalized mf on mf.instance_id=ms.mission_instance_id
      where ms.classroom_id=p_classroom_id
    ) x
    left join public.students s on s.id=x.student_id
    where p_include_test or not coalesce(s.is_test_account,false)
  ),
  student_mission_agg as (
    select mp.student_id,
      count(distinct mp.mission_instance_id) as mission_snapshot_participation_count,
      count(distinct md.mission_instance_id) as mission_documented_participation_count
    from mission_participant mp
    left join mission_documented md on md.student_id=mp.student_id and md.mission_instance_id=mp.mission_instance_id
    group by mp.student_id
  ),
  membership_json as (
    select e.student_id,
      jsonb_agg(jsonb_build_object(
        'event_type',e.event_type,'from_guild_id',e.from_guild_id,'from_guild_name',e.from_guild_name,
        'to_guild_id',e.to_guild_id,'to_guild_name',e.to_guild_name,
        'element_before',e.element_before,'element_after',e.element_after,
        'reason',e.reason,'effective_at',e.effective_at
      ) order by e.effective_at,e.id) as history
    from public.guild_membership_events e
    join eligible_students es on es.id=e.student_id
    where e.classroom_id=p_classroom_id
    group by e.student_id
  ),
  student_rows as (
    select es.id as student_id,es.name as student_name,es.brand_name,es.is_test_account,
      ls.scoring_guild_id,g.name as live_guild_name,
      coalesce(ls.final_total,0) as live_month_contribution,
      ls.basic_total as live_basic_total,ls.peer_points as live_peer_points,ls.mission_points as live_mission_points,
      ls.session_points as live_session_points,ls.teacher_observation_points as live_observation_points,
      ls.arcade_applied as live_arcade_applied,ls.calculated_at as live_calculated_at,
      coalesce(soa.season_official_contribution,0) as season_official_contribution,
      coalesce(soa.lifetime_official_contribution,0) as lifetime_official_contribution,
      coalesce(soa.finalized_month_count,0) as finalized_month_count,
      soa.best_monthly_contribution,sbm.year_month as best_monthly_year_month,
      coalesce(sma.mission_snapshot_participation_count,0) as mission_participation_count,
      coalesce(sma.mission_documented_participation_count,0) as mission_documented_participation_count,
      coalesce(mj.history,'[]'::jsonb) as membership_history
    from eligible_students es
    left join live_student ls on ls.student_id=es.id
    left join public.guilds g on g.id=ls.scoring_guild_id
    left join student_official_agg soa on soa.student_id=es.id
    left join student_best_month sbm on sbm.student_id=es.id
    left join student_mission_agg sma on sma.student_id=es.id
    left join membership_json mj on mj.student_id=es.id
  ),
  guild_official_agg as (
    select og.guild_id,
      sum(og.total_gs) filter (where og.season_id=v_season_id) as season_official_score,
      count(*) filter (where og.rank_position=1) as monthly_first_count,
      count(*) filter (where og.rank_position between 1 and 3) as monthly_top3_count,
      max(og.total_gs) as max_monthly_score
    from official_guild og group by og.guild_id
  ),
  guild_best_month as (
    select distinct on (og.guild_id) og.guild_id,og.year_month,og.total_gs,og.rank_position
    from official_guild og
    order by og.guild_id,og.total_gs desc,og.year_month asc
  ),
  season_rank as (
    select x.guild_id,x.season_official_score,
      rank() over(order by x.season_official_score desc,x.guild_id asc)::integer as season_rank
    from (
      select og.guild_id,sum(og.total_gs) as season_official_score
      from official_guild og where og.season_id=v_season_id group by og.guild_id
    ) x
  ),
  mission_guild_agg as (
    select mf.guild_id,
      count(*) as finalized_mission_count,
      count(*) filter (where mf.current_guild_result='CLEARED') as cleared_mission_count
    from mission_finalized mf where mf.season_id=v_season_id group by mf.guild_id
  ),
  mission_participant_guild as (
    select mp.guild_id,count(*) as participant_slots,
      count(*) filter (where md.student_id is not null) as documented_slots
    from mission_participant mp
    left join mission_documented md on md.guild_id=mp.guild_id and md.student_id=mp.student_id and md.mission_instance_id=mp.mission_instance_id
    join mission_finalized mf on mf.instance_id=mp.mission_instance_id and mf.season_id=v_season_id
    group by mp.guild_id
  ),
  guild_rows as (
    select g.id as guild_id,g.name,g.logo_url,g.is_active,
      lg.draft_gs_total as live_month_score,lg.draft_rank as live_month_rank,
      lg.individual_subtotal as live_individual_subtotal,lg.mission_gs_subtotal as live_mission_gs,
      lg.scoring_roster_count as live_roster_count,lg.calculated_at as live_calculated_at,
      coalesce(goa.season_official_score,0) as season_official_score,sr.season_rank as season_official_rank,
      coalesce(goa.monthly_first_count,0) as monthly_first_count,
      coalesce(goa.monthly_top3_count,0) as monthly_top3_count,
      goa.max_monthly_score,gbm.year_month as max_monthly_score_year_month,
      coalesce(mga.finalized_mission_count,0) as finalized_mission_count,
      coalesce(mga.cleared_mission_count,0) as cleared_mission_count,
      case when coalesce(mga.finalized_mission_count,0)=0 then null
           else round((mga.cleared_mission_count::numeric/mga.finalized_mission_count)*100,2) end as mission_success_rate_pct,
      coalesce(mpg.participant_slots,0) as mission_participant_snapshot_slots,
      coalesce(mpg.documented_slots,0) as mission_documented_slots,
      case when coalesce(mpg.participant_slots,0)=0 then null
           else round((mpg.documented_slots::numeric/mpg.participant_slots)*100,2) end as mission_documented_participation_rate_pct
    from public.guilds g
    left join live_guild lg on lg.guild_id=g.id
    left join guild_official_agg goa on goa.guild_id=g.id
    left join guild_best_month gbm on gbm.guild_id=g.id
    left join season_rank sr on sr.guild_id=g.id
    left join mission_guild_agg mga on mga.guild_id=g.id
    left join mission_participant_guild mpg on mpg.guild_id=g.id
    where g.classroom_id=p_classroom_id and g.season_id=v_season_id
  ),
  official_months as (
    select oc.year_month,oc.season_id,oc.finalized_at,
      jsonb_agg(jsonb_build_object('guild_id',og.guild_id,'guild_name',og.guild_name_at_close,'score',og.total_gs,'rank',og.rank_position) order by og.rank_position nulls last,og.guild_id) as rankings
    from official_closures oc
    join official_guild og on og.season_id=oc.season_id and og.year_month=oc.year_month
    where oc.season_id=v_season_id
    group by oc.year_month,oc.season_id,oc.finalized_at
  )
  select jsonb_build_object(
    'scope',jsonb_build_object('classroom_id',p_classroom_id,'season',(select to_jsonb(ss) from selected_season ss),'year_month',v_year_month,'include_test',p_include_test),
    'definitions',jsonb_build_object(
      'live_current_month','guild2 calculated values; never official history',
      'official_history','guild5 FINALIZED current_version snapshots only',
      'season_official_score','sum of FINALIZED monthly guild5 snapshots for selected season',
      'season_rank_coverage',case when exists(select 1 from public.guild5_season_locks sl where sl.classroom_id=p_classroom_id and sl.season_id=v_season_id) then 'SEASON_LOCKED' else 'FINALIZED_MONTHS_ONLY' end,
      'mission_participation_count','count of finalized mission participant snapshots containing the student',
      'mission_documented_participation_rate','activity record or submission author / participant snapshot slots; not equivalent to physical participation'
    ),
    'student_rows',coalesce((select jsonb_agg(to_jsonb(sr) order by sr.student_name,sr.student_id) from student_rows sr),'[]'::jsonb),
    'guild_rows',coalesce((select jsonb_agg(to_jsonb(gr) order by gr.guild_id) from guild_rows gr),'[]'::jsonb),
    'official_months',coalesce((select jsonb_agg(to_jsonb(om) order by om.year_month) from official_months om),'[]'::jsonb),
    'data_quality',jsonb_build_object(
      'finalized_closure_without_current_version',(select count(*) from public.guild5_month_closures c where c.classroom_id=p_classroom_id and c.lifecycle_state='FINALIZED' and c.current_version_id is null),
      'finalized_version_without_guild_snapshots',(select count(*) from official_closures oc where not exists(select 1 from public.guild5_guild_snapshots x where x.version_id=oc.current_version_id)),
      'finalized_version_without_student_snapshots',(select count(*) from official_closures oc where not exists(select 1 from public.guild5_student_snapshots x where x.version_id=oc.current_version_id)),
      'test_students_in_official_snapshots',(select count(*) from official_student os join public.students s on s.id=os.student_id where coalesce(s.is_test_account,false)),
      'live_student_count',(select count(*) from live_student),
      'live_guild_count',(select count(*) from live_guild),
      'official_finalized_month_count',(select count(*) from official_closures where season_id=v_season_id),
      'finalized_mission_instance_count',(select count(*) from mission_finalized where season_id=v_season_id)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.teacher_get_guild_statistics(integer,integer,text,boolean) from public,anon;
grant execute on function public.teacher_get_guild_statistics(integer,integer,text,boolean) to authenticated,service_role;