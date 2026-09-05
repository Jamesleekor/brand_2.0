-- B.R.A.N.D 2.0 Records / Guild5 FINALIZED -> Hall of Glory
-- 2026-09-05
--
-- Goals
-- - Monthly Hall records use only guild5_month_closures.lifecycle_state='FINALIZED'
--   and the current closure version.
-- - Season Hall records use only CLOSED seasons that have an explicit Guild5 season lock.
-- - The 2026 V2 monthly GS denominator is snapshotted at close time so later config edits
--   cannot rewrite historical percentages.
-- - Historical curated Season 1 records remain immutable and are merged with live-derived rows.

alter table public.guild5_guild_snapshots
  add column if not exists formula_version_at_close text,
  add column if not exists monthly_max_gs numeric,
  add column if not exists monthly_gs_rate numeric;

comment on column public.guild5_guild_snapshots.monthly_max_gs is
  'Nominal maximum GS for this guild/month under the formula/config active at FINALIZE time.';
comment on column public.guild5_guild_snapshots.monthly_gs_rate is
  'total_gs / monthly_max_gs * 100 snapshotted at FINALIZE time.';

create or replace function public.records_guild5_snapshot_metrics()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_classroom_id integer;
  v_season_id integer;
  v_year_month text;
  v_formula text;
  v_comp_enabled boolean := false;
  v_comp_factor numeric := 0;
  v_comp_max numeric := 0;
  v_max numeric := null;
begin
  select c.classroom_id,c.season_id,c.year_month
    into v_classroom_id,v_season_id,v_year_month
  from public.guild5_closure_versions v
  join public.guild5_month_closures c on c.id=v.closure_id
  where v.id=new.version_id;

  select s.formula_version
    into v_formula
  from public.guild2_monthly_gs_summaries s
  where s.classroom_id=v_classroom_id
    and s.season_id=v_season_id
    and s.year_month=v_year_month
    and s.guild_id=new.guild_id;

  new.formula_version_at_close := v_formula;

  if v_formula='GUILD_CONTRIBUTION_V2_2026' then
    select coalesce(cc.enabled,false),coalesce(cc.factor,0)
      into v_comp_enabled,v_comp_factor
    from public.guild2_compensation_configs cc
    where cc.classroom_id=v_classroom_id
      and cc.season_id=v_season_id
      and cc.guild_id=new.guild_id;

    if not found then
      v_comp_enabled := false;
      v_comp_factor := 0;
    end if;

    -- V2: individual max = 300 peer + 300 mission + 150 session
    -- + 150 observation + 90 Arcade = 990.
    -- Guild official mission GS is normalized to a monthly maximum of 5,000.
    -- Optional manual four-member compensation is BASIC-only, max basic average 900.
    if v_comp_enabled then
      v_comp_max := round((900::numeric * v_comp_factor) / 10) * 10;
    end if;

    v_max := (new.roster_count::numeric * 990::numeric) + 5000::numeric + v_comp_max;
    new.monthly_max_gs := v_max;
    new.monthly_gs_rate := case when v_max>0 then round((new.total_gs / v_max) * 100,8) else null end;
  else
    new.monthly_max_gs := null;
    new.monthly_gs_rate := null;
  end if;

  return new;
end;
$$;

revoke all on function public.records_guild5_snapshot_metrics() from public,anon,authenticated;

drop trigger if exists trg_records_guild5_snapshot_metrics on public.guild5_guild_snapshots;
create trigger trg_records_guild5_snapshot_metrics
before insert or update of version_id,guild_id,roster_count,total_gs
on public.guild5_guild_snapshots
for each row execute function public.records_guild5_snapshot_metrics();

-- Curated records that were already confirmed in the handoff but did not yet have
-- their own record_type in the cross-season archive.
insert into public.records_historical_entries (
  record_key,hall_key,record_type,title,subtitle,subject_kind,subject_display_name,
  school_year,season_label,period_label,rank_position,value_primary,denominator,unit,
  comparison_value,source_kind,metadata,sort_order
) values
  ('GUILD_SEASON1_TOTAL_2026_RUBY','GUILD_HEGEMONY','SEASON_TOTAL_GS',
   '역대 최고 시즌 누적 GS','2026 시즌1','GUILD','Ruby',2026,'2026 시즌1','2026 시즌1',1,
   26826,null,'GS',26826,'CURATED','{"normalization":"none"}'::jsonb,45),
  ('GUILD_SEASON1_BEST_SEASON_CONTRIB_RATE_2026_HANSEOHYEON','GUILD_HEGEMONY','BEST_SEASON_CONTRIBUTION_RATE',
   '역대 최고 시즌 개인 기여율','2026 시즌1','STUDENT','한서현',2026,'2026 시즌1','2026 시즌1',1,
   1860,2300,'점',80.87,'CURATED','{"normalization":"none","rate_percent":80.87}'::jsonb,46)
on conflict (record_key) do update set
  title=excluded.title,
  subtitle=excluded.subtitle,
  subject_display_name=excluded.subject_display_name,
  school_year=excluded.school_year,
  season_label=excluded.season_label,
  period_label=excluded.period_label,
  rank_position=excluded.rank_position,
  value_primary=excluded.value_primary,
  denominator=excluded.denominator,
  unit=excluded.unit,
  comparison_value=excluded.comparison_value,
  metadata=excluded.metadata,
  sort_order=excluded.sort_order,
  updated_at=now();

create or replace function public.student_get_records_guild_hall()
returns jsonb
language plpgsql
stable
security definer
set search_path='public','pg_temp'
as $$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_entries jsonb;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS] authenticated classroom member context is required.' using errcode='P0930';
  end if;

  with curated as (
    select
      h.id,h.record_key,h.hall_key,h.record_type,h.title,h.subtitle,h.description,
      h.subject_kind,h.subject_display_name,h.subject_brand_name,h.school_year,h.season_label,
      h.period_label,h.occurred_on,h.rank_position,h.value_primary,h.value_secondary,h.denominator,
      h.unit,h.comparison_value,h.source_kind,h.metadata,h.sort_order
    from public.records_historical_entries h
    where h.status='ACTIVE' and h.hall_key='GUILD_HEGEMONY'
  ),
  finalized_months as (
    select
      c.id closure_id,c.season_id,c.year_month,c.current_version_id version_id,
      v.version_no,v.finalized_at,
      gs.school_year,coalesce(gs.display_name,gs.name) season_label,
      greatest((c.year_month||'-01')::date,coalesce(gs.starts_on,gs.start_date)) period_start,
      least(((c.year_month||'-01')::date + interval '1 month - 1 day')::date,coalesce(gs.ends_on,gs.end_date)) period_end
    from public.guild5_month_closures c
    join public.guild5_closure_versions v on v.id=c.current_version_id
    join public.guild_seasons gs on gs.id=c.season_id
    where c.classroom_id=v_classroom_id
      and c.lifecycle_state='FINALIZED'
      and c.current_version_id is not null
  ),
  live_month_guild as (
    select
      (-1000000000000::bigint - fm.version_id*10000 - g.guild_id)::bigint id,
      format('G5_MONTH_RATE_%s_%s_V%s',fm.year_month,g.guild_id,fm.version_no) record_key,
      'GUILD_HEGEMONY'::text hall_key,'BEST_MONTHLY_GS_RATE'::text record_type,
      '역대 최고 단일 월 GS'::text title,
      fm.year_month::text subtitle,null::text description,
      'GUILD'::text subject_kind,g.guild_name_at_close::text subject_display_name,null::text subject_brand_name,
      fm.school_year,fm.season_label,fm.year_month::text period_label,
      (fm.finalized_at at time zone 'Asia/Seoul')::date occurred_on,
      null::integer rank_position,g.total_gs::numeric value_primary,null::numeric value_secondary,
      g.monthly_max_gs::numeric denominator,'GS'::text unit,g.monthly_gs_rate::numeric comparison_value,
      'PRODUCTION_DERIVED'::text source_kind,
      jsonb_build_object('source','GUILD5_FINALIZED','closure_id',fm.closure_id,'version_id',fm.version_id,
        'version_no',fm.version_no,'formula_version',g.formula_version_at_close,'rate_percent',g.monthly_gs_rate) metadata,
      20::integer sort_order
    from finalized_months fm
    join public.guild5_guild_snapshots g on g.version_id=fm.version_id
    where g.monthly_max_gs is not null and g.monthly_gs_rate is not null
  ),
  month_rate_candidates as (
    select * from curated where record_type='BEST_MONTHLY_GS_RATE'
    union all
    select * from live_month_guild
  ),
  month_rate_ranked as (
    select c.*,rank() over(order by c.comparison_value desc nulls last)::integer new_rank
    from month_rate_candidates c
  ),
  month_rate_best as (
    select id,record_key,hall_key,record_type,title,subtitle,description,subject_kind,subject_display_name,
      subject_brand_name,school_year,season_label,period_label,occurred_on,new_rank rank_position,
      value_primary,value_secondary,denominator,unit,comparison_value,source_kind,metadata,
      20 + new_rank - 1 sort_order
    from month_rate_ranked where new_rank<=5
  ),
  live_month_student as (
    select
      (-2000000000000::bigint - fm.version_id*100000 - s.student_id)::bigint id,
      format('G5_MONTH_CONTRIB_RATE_%s_%s_V%s',fm.year_month,s.student_id,fm.version_no) record_key,
      'GUILD_HEGEMONY'::text hall_key,'BEST_MONTHLY_CONTRIBUTION_RATE'::text record_type,
      '역대 최고 월간 기여도 달성률'::text title,fm.year_month::text subtitle,null::text description,
      'STUDENT'::text subject_kind,s.student_name_at_close::text subject_display_name,s.brand_name_at_close::text subject_brand_name,
      fm.school_year,fm.season_label,fm.year_month::text period_label,
      (fm.finalized_at at time zone 'Asia/Seoul')::date occurred_on,
      null::integer rank_position,s.final_contribution::numeric value_primary,null::numeric value_secondary,
      990::numeric denominator,'점'::text unit,round((s.final_contribution/990::numeric)*100,8) comparison_value,
      'PRODUCTION_DERIVED'::text source_kind,
      jsonb_build_object('source','GUILD5_FINALIZED','closure_id',fm.closure_id,'version_id',fm.version_id,
        'version_no',fm.version_no,'guild',s.guild_name_at_close,'rate_percent',round((s.final_contribution/990::numeric)*100,8)) metadata,
      30::integer sort_order
    from finalized_months fm
    join public.guild5_student_snapshots s on s.version_id=fm.version_id
    where s.source_flags->>'formula_version'='GUILD_CONTRIBUTION_V2_2026'
      and not exists (
        select 1
        from generate_series(fm.period_start,fm.period_end,interval '1 day') d(day)
        where not exists (
          select 1 from public.guild_members gm
          where gm.season_id=fm.season_id
            and gm.student_id=s.student_id
            and gm.joined_at::date<=d.day::date
            and (gm.left_at is null or gm.left_at::date>d.day::date)
        )
      )
  ),
  month_contrib_candidates as (
    select * from curated where record_type='BEST_MONTHLY_CONTRIBUTION_RATE'
    union all
    select * from live_month_student
  ),
  month_contrib_ranked as (
    select c.*,rank() over(order by c.comparison_value desc nulls last)::integer new_rank
    from month_contrib_candidates c
  ),
  month_contrib_best as (
    select id,record_key,hall_key,record_type,title,subtitle,description,subject_kind,subject_display_name,
      subject_brand_name,school_year,season_label,period_label,occurred_on,new_rank rank_position,
      value_primary,value_secondary,denominator,unit,comparison_value,source_kind,metadata,30::integer sort_order
    from month_contrib_ranked where new_rank=1
  ),
  locked_seasons as (
    select gs.id season_id,gs.school_year,coalesce(gs.display_name,gs.name) season_label,
      coalesce(gs.starts_on,gs.start_date) season_start,coalesce(gs.ends_on,gs.end_date) season_end
    from public.guild_seasons gs
    where gs.classroom_id=v_classroom_id
      and gs.lifecycle_status='CLOSED'
      and exists(select 1 from public.guild5_season_locks sl where sl.classroom_id=v_classroom_id and sl.season_id=gs.id)
  ),
  locked_months as (
    select ls.*,c.year_month,c.current_version_id version_id,v.finalized_at
    from locked_seasons ls
    join public.guild5_month_closures c on c.season_id=ls.season_id and c.classroom_id=v_classroom_id
    join public.guild5_closure_versions v on v.id=c.current_version_id
    where c.lifecycle_state='FINALIZED' and c.current_version_id is not null
  ),
  season_guild_totals as (
    select lm.season_id,lm.school_year,lm.season_label,g.guild_id,
      (array_agg(g.guild_name_at_close order by lm.year_month desc))[1] guild_name,
      sum(g.total_gs)::numeric season_total
    from locked_months lm
    join public.guild5_guild_snapshots g on g.version_id=lm.version_id
    group by lm.season_id,lm.school_year,lm.season_label,g.guild_id
  ),
  live_season_champion as (
    select * from (
      select
        (-3000000000000::bigint - sgt.season_id*10000 - sgt.guild_id)::bigint id,
        format('G5_SEASON_CHAMPION_%s_%s',sgt.season_id,sgt.guild_id) record_key,
        'GUILD_HEGEMONY'::text hall_key,'SEASON_CHAMPION'::text record_type,
        '시즌 최종 우승 길드'::text title,sgt.season_label::text subtitle,null::text description,
        'GUILD'::text subject_kind,sgt.guild_name::text subject_display_name,null::text subject_brand_name,
        sgt.school_year,sgt.season_label,sgt.season_label::text period_label,null::date occurred_on,
        rank() over(partition by sgt.season_id order by sgt.season_total desc)::integer rank_position,
        sgt.season_total value_primary,null::numeric value_secondary,null::numeric denominator,'GS'::text unit,
        sgt.season_total comparison_value,'PRODUCTION_DERIVED'::text source_kind,
        jsonb_build_object('source','GUILD5_LOCKED_SEASON','season_id',sgt.season_id,'normalization','none') metadata,
        10::integer sort_order
      from season_guild_totals sgt
    ) q where rank_position=1
  ),
  season_champion_lineage as (
    select * from curated where record_type='SEASON_CHAMPION'
    union all
    select * from live_season_champion
  ),
  season_total_candidates as (
    select * from curated where record_type='SEASON_TOTAL_GS'
    union all
    select
      (-3100000000000::bigint - sgt.season_id*10000 - sgt.guild_id)::bigint,
      format('G5_SEASON_TOTAL_%s_%s',sgt.season_id,sgt.guild_id),'GUILD_HEGEMONY','SEASON_TOTAL_GS',
      '역대 최고 시즌 누적 GS',sgt.season_label,null,'GUILD',sgt.guild_name,null,sgt.school_year,
      sgt.season_label,sgt.season_label,null,null,sgt.season_total,null,null,'GS',sgt.season_total,
      'PRODUCTION_DERIVED',jsonb_build_object('source','GUILD5_LOCKED_SEASON','season_id',sgt.season_id,'normalization','none'),45
    from season_guild_totals sgt
  ),
  season_total_ranked as (
    select c.*,rank() over(order by c.comparison_value desc nulls last)::integer new_rank from season_total_candidates c
  ),
  season_total_best as (
    select id,record_key,hall_key,record_type,title,subtitle,description,subject_kind,subject_display_name,
      subject_brand_name,school_year,season_label,period_label,occurred_on,new_rank rank_position,value_primary,
      value_secondary,denominator,unit,comparison_value,source_kind,metadata,45::integer sort_order
    from season_total_ranked where new_rank=1
  ),
  season_two as (
    select sgt.*,row_number() over(partition by sgt.season_id order by sgt.season_total desc,sgt.guild_id)::integer rn
    from season_guild_totals sgt
  ),
  live_closest as (
    select
      (-5000000000000::bigint - a.season_id)::bigint id,
      format('G5_CLOSEST_SEASON_%s',a.season_id) record_key,'GUILD_HEGEMONY'::text hall_key,
      'CLOSEST_SEASON_WIN'::text record_type,'가장 근소한 시즌 우승'::text title,a.season_label::text subtitle,
      null::text description,'GUILD'::text subject_kind,a.guild_name::text subject_display_name,null::text subject_brand_name,
      a.school_year,a.season_label,a.season_label::text period_label,null::date occurred_on,null::integer rank_position,
      (a.season_total-b.season_total)::numeric value_primary,b.season_total::numeric value_secondary,null::numeric denominator,
      'GS'::text unit,case when a.season_total>0 then round(((a.season_total-b.season_total)/a.season_total)*100,8) end comparison_value,
      'PRODUCTION_DERIVED'::text source_kind,
      jsonb_build_object('source','GUILD5_LOCKED_SEASON','season_id',a.season_id,'runner_up',b.guild_name,
        'runner_up_gs',b.season_total,'margin_percent',case when a.season_total>0 then round(((a.season_total-b.season_total)/a.season_total)*100,8) end) metadata,
      50::integer sort_order
    from season_two a join season_two b on b.season_id=a.season_id and b.rn=2
    where a.rn=1
  ),
  closest_candidates as (
    select * from curated where record_type='CLOSEST_SEASON_WIN'
    union all
    select * from live_closest where comparison_value is not null
  ),
  closest_ranked as (
    select c.*,rank() over(order by c.comparison_value asc nulls last)::integer new_rank from closest_candidates c
  ),
  closest_best as (
    select id,record_key,hall_key,record_type,title,subtitle,description,subject_kind,subject_display_name,
      subject_brand_name,school_year,season_label,period_label,occurred_on,new_rank rank_position,value_primary,
      value_secondary,denominator,unit,comparison_value,source_kind,metadata,50::integer sort_order
    from closest_ranked where new_rank=1
  ),
  season_student_totals as (
    select lm.season_id,lm.school_year,lm.season_label,lm.season_start,lm.season_end,s.student_id,
      (array_agg(s.student_name_at_close order by lm.year_month desc))[1] student_name,
      (array_agg(s.brand_name_at_close order by lm.year_month desc))[1] brand_name,
      sum(s.final_contribution)::numeric raw_total,
      count(*) filter(where s.source_flags->>'formula_version'='GUILD_CONTRIBUTION_V2_2026')::integer known_months,
      count(*)::integer total_months,
      bool_and(s.source_flags->>'formula_version'='GUILD_CONTRIBUTION_V2_2026') all_v2
    from locked_months lm
    join public.guild5_student_snapshots s on s.version_id=lm.version_id
    group by lm.season_id,lm.school_year,lm.season_label,lm.season_start,lm.season_end,s.student_id
  ),
  live_season_contrib_champion as (
    select * from (
      select
        (-4000000000000::bigint - sst.season_id*100000 - sst.student_id)::bigint id,
        format('G5_SEASON_CONTRIB_CHAMP_%s_%s',sst.season_id,sst.student_id) record_key,
        'GUILD_HEGEMONY'::text hall_key,'SEASON_CONTRIBUTION_CHAMPION'::text record_type,
        '시즌 개인 기여도 1위'::text title,sst.season_label::text subtitle,null::text description,
        'STUDENT'::text subject_kind,sst.student_name::text subject_display_name,sst.brand_name::text subject_brand_name,
        sst.school_year,sst.season_label,sst.season_label::text period_label,null::date occurred_on,
        rank() over(partition by sst.season_id order by sst.raw_total desc)::integer rank_position,
        sst.raw_total value_primary,null::numeric value_secondary,
        case when sst.all_v2 then sst.total_months*990::numeric else null end denominator,
        '점'::text unit,
        case when sst.all_v2 and sst.total_months>0 then round((sst.raw_total/(sst.total_months*990::numeric))*100,8) end comparison_value,
        'PRODUCTION_DERIVED'::text source_kind,
        jsonb_build_object('source','GUILD5_LOCKED_SEASON','season_id',sst.season_id,'normalization','none') metadata,
        40::integer sort_order
      from season_student_totals sst
    ) q where rank_position=1
  ),
  season_contrib_lineage as (
    select * from curated where record_type='SEASON_CONTRIBUTION_CHAMPION'
    union all
    select * from live_season_contrib_champion
  ),
  full_season_student as (
    select sst.*
    from season_student_totals sst
    where sst.all_v2
      and not exists (
        select 1 from generate_series(sst.season_start,sst.season_end,interval '1 day') d(day)
        where not exists (
          select 1 from public.guild_members gm
          where gm.season_id=sst.season_id and gm.student_id=sst.student_id
            and gm.joined_at::date<=d.day::date
            and (gm.left_at is null or gm.left_at::date>d.day::date)
        )
      )
  ),
  season_rate_candidates as (
    select * from curated where record_type='BEST_SEASON_CONTRIBUTION_RATE'
    union all
    select
      (-4100000000000::bigint - fss.season_id*100000 - fss.student_id)::bigint,
      format('G5_SEASON_CONTRIB_RATE_%s_%s',fss.season_id,fss.student_id),'GUILD_HEGEMONY','BEST_SEASON_CONTRIBUTION_RATE',
      '역대 최고 시즌 개인 기여율',fss.season_label,null,'STUDENT',fss.student_name,fss.brand_name,fss.school_year,
      fss.season_label,fss.season_label,null,null,fss.raw_total,null,(fss.total_months*990)::numeric,'점',
      round((fss.raw_total/(fss.total_months*990::numeric))*100,8),'PRODUCTION_DERIVED',
      jsonb_build_object('source','GUILD5_LOCKED_SEASON','season_id',fss.season_id,'normalization','none'),46
    from full_season_student fss where fss.total_months>0
  ),
  season_rate_ranked as (
    select c.*,rank() over(order by c.comparison_value desc nulls last)::integer new_rank from season_rate_candidates c
  ),
  season_rate_best as (
    select id,record_key,hall_key,record_type,title,subtitle,description,subject_kind,subject_display_name,
      subject_brand_name,school_year,season_label,period_label,occurred_on,new_rank rank_position,value_primary,
      value_secondary,denominator,unit,comparison_value,source_kind,metadata,46::integer sort_order
    from season_rate_ranked where new_rank=1
  ),
  passthrough as (
    select * from curated
    where record_type not in (
      'SEASON_CHAMPION','BEST_MONTHLY_GS_RATE','BEST_MONTHLY_CONTRIBUTION_RATE',
      'SEASON_CONTRIBUTION_CHAMPION','SEASON_TOTAL_GS','BEST_SEASON_CONTRIBUTION_RATE','CLOSEST_SEASON_WIN'
    )
  ),
  merged as (
    select * from passthrough
    union all select * from season_champion_lineage
    union all select * from month_rate_best
    union all select * from month_contrib_best
    union all select * from season_contrib_lineage
    union all select * from season_total_best
    union all select * from season_rate_best
    union all select * from closest_best
  )
  select coalesce(jsonb_agg(to_jsonb(m) order by m.sort_order,m.record_type,m.rank_position nulls last,m.id),'[]'::jsonb)
    into v_entries
  from merged m;

  return jsonb_build_object('entries',v_entries);
end;
$$;

revoke all on function public.student_get_records_guild_hall() from public;
revoke all on function public.student_get_records_guild_hall() from anon;
grant execute on function public.student_get_records_guild_hall() to authenticated;
