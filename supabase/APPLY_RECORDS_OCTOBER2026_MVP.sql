-- B.R.A.N.D 2.0 · 2026-10 MVP and requested Hall updates
-- Incremental patch. No score transactions, snapshots, or historical finalist arrays rewritten.
-- Applied through Supabase migration; retained for reproducibility. Do not reapply old migrations.

BEGIN;

-- Explicit October MVP registration. Idempotent; resolve current identity by year and official name.
DO $october$
DECLARE
  v_student_id integer;
  v_matches integer;
  v_sequence regclass;
  v_max_id bigint;
BEGIN
  -- Legacy manual imports can leave the identity sequence behind existing IDs.
  -- Lock just this archive while bringing the sequence forward; never rewind it.
  LOCK TABLE public.records_monthly_mvp_archive IN SHARE ROW EXCLUSIVE MODE;
  v_sequence := pg_get_serial_sequence('public.records_monthly_mvp_archive','id')::regclass;
  SELECT max(id) INTO v_max_id FROM public.records_monthly_mvp_archive;
  IF v_sequence IS NULL THEN
    RAISE EXCEPTION 'Monthly MVP archive identity sequence is missing';
  END IF;
  IF v_max_id IS NOT NULL AND coalesce(pg_sequence_last_value(v_sequence),0) < v_max_id THEN
    PERFORM setval(v_sequence,v_max_id,true);
  END IF;
  SELECT count(*), min(s.id) INTO v_matches, v_student_id
  FROM public.students s JOIN public.classrooms c ON c.id=s.classroom_id
  WHERE c.school_year=2026 AND s.name='이준혁' AND public.is_official_participant(s.id);
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'October MVP requires exactly one official 2026 student named 이준혁';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.records_monthly_mvp_archive
    WHERE period_key='2026-10' AND (
      winner_display_name <> '이준혁' OR school_year <> 2026 OR month_no <> 10
      OR (winner_student_id IS NOT NULL AND winner_student_id <> v_student_id)
    )
  ) THEN
    RAISE EXCEPTION 'Conflicting October MVP record; refusing to overwrite';
  END IF;

  INSERT INTO public.records_monthly_mvp_archive (
    period_key,school_year,month_no,period_label,winner_display_name,winner_student_id,
    finalists,source_kind,source_ref,metadata,status
  ) VALUES (
    '2026-10',2026,10,'2026년 10월','이준혁',v_student_id,
    '["이준혁","김서영","류은우","한서현"]'::jsonb,
    'CURATED','OCTOBER_2026_MVP_CONFIRMED',
    jsonb_build_object(
      'finalist_count',4,
      'incarnation_title','신뢰를 증명하는 자',
      'incarnation_theme','PROVEN_TRUST',
      'portrait_url','https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/mvp/All-Time-MVP-Winners/2026-October-MVP.webp',
      'rival_order',jsonb_build_array('김서영','류은우','한서현')
    ),'ACTIVE'
  )
  ON CONFLICT (period_key) DO UPDATE SET
    period_label=excluded.period_label,
    winner_student_id=excluded.winner_student_id,
    finalists=excluded.finalists,
    metadata=records_monthly_mvp_archive.metadata || excluded.metadata,
    status=excluded.status,
    updated_at=now();
END;
$october$;

-- Preserve the existing RPC signature and identity/classroom guards.
CREATE OR REPLACE FUNCTION public.student_get_records_mvp_finalist_top3()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_school_year integer;
  v_entries jsonb;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS] authenticated classroom member context is required.' using errcode='P0930';
  end if;

  select c.school_year
    into v_school_year
  from public.classrooms c
  where c.id = v_classroom_id;

  if v_school_year is null then
    raise exception '[RECORDS] classroom school year is required.' using errcode='P0931';
  end if;

  with finalist_occurrences as (
    select
      a.school_year,
      trim(f.name) as display_name
    from public.records_monthly_mvp_archive a
    cross join lateral jsonb_array_elements_text(a.finalists) as f(name)
    where a.status = 'ACTIVE'
      and jsonb_typeof(a.finalists) = 'array'
  ),
  resolved as (
    select
      f.school_year,
      f.display_name,
      case
        when f.school_year = v_school_year and s.id is not null
          then 'CLASSROOM:' || v_classroom_id || ':STUDENT:' || s.id
        else 'CURATED:' || f.school_year || ':' || f.display_name
      end as identity_key,
      s.id as student_id,
      s.brand_name
    from finalist_occurrences f
    left join lateral (
      select st.id, st.brand_name
      from public.students st
      where f.school_year = v_school_year
        and st.classroom_id = v_classroom_id
        and st.name = f.display_name
        and public.is_official_participant(st.id)
      order by st.id
      limit 1
    ) s on true
  ),
  counts as (
    select
      r.identity_key,
      r.school_year,
      r.display_name,
      max(r.student_id) as student_id,
      max(r.brand_name) as brand_name,
      count(*)::integer as finalist_count
    from resolved r
    group by r.identity_key, r.school_year, r.display_name
  ),
  ranked as (
    select
      c.*,
      dense_rank() over (order by c.finalist_count desc) as computed_rank
    from counts c
  ),
  podium as (
    select
      (-1700000 - row_number() over (order by r.computed_rank, r.school_year, r.display_name))::bigint as id,
      ('MVP_FINALIST_TOP3:' || r.identity_key)::text as record_key,
      'REPEATED_CROWNS'::text as hall_key,
      'MOST_MVP_FINALS'::text as record_type,
      '역대 최다 월간 MVP 후보 선정'::text as title,
      '공식 월간 MVP 후보 선정 누적 · TOP 4 순위까지 전시'::text as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      case when r.school_year = 2023 and r.display_name = '이준혁' then '이준혁(2023)' else r.display_name end as subject_display_name,
      r.brand_name as subject_brand_name,
      r.school_year,
      null::text as season_label,
      (r.school_year || '년')::text as period_label,
      null::date as occurred_on,
      r.computed_rank::integer as rank_position,
      r.finalist_count::numeric as value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      '회'::text as unit,
      r.finalist_count::numeric as comparison_value,
      'PRODUCTION_DERIVED'::text as source_kind,
      jsonb_build_object(
        'identity_key', r.identity_key,
        'student_id', r.student_id,
        'school_year', r.school_year,
        'tie_at_rank', (select count(*) from ranked x where x.computed_rank = r.computed_rank) > 1,
        'derivation', 'records_monthly_mvp_archive.finalists grouped by year-scoped identity'
      ) as metadata,
      (30 + r.computed_rank)::integer as sort_order
    from ranked r
    where r.computed_rank <= 4
  )
  select coalesce(
    jsonb_agg(to_jsonb(p) order by p.rank_position, p.school_year, p.subject_display_name),
    '[]'::jsonb
  )
  into v_entries
  from podium p;

  return jsonb_build_object('entries', v_entries);
end;
$function$;

REVOKE ALL ON FUNCTION public.student_get_records_mvp_finalist_top3() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_get_records_mvp_finalist_top3() TO authenticated;

-- Monthly contribution honors are displayed in points: compare points, not rates.
CREATE OR REPLACE FUNCTION public.student_get_records_guild_hall()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      '역대 최고 월간 개인 기여도'::text title,fm.year_month::text subtitle,null::text description,
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
    select c.*,rank() over(order by c.value_primary desc nulls last)::integer new_rank
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
      sum(s.final_contribution)::numeric raw_total,count(*)::integer total_months,
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
$function$;

REVOKE ALL ON FUNCTION public.student_get_records_guild_hall() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_get_records_guild_hall() TO authenticated;

COMMIT;
