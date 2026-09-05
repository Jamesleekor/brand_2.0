-- B.R.A.N.D 2.0 Records / Hall 02 achievement score throne
-- 2026-09-05
-- Adds a supplemental live-derived throne for cumulative achievement score.
-- Historical 2023-2025 achievement scoring was not measured, so this is a current-era official record.

create or replace function public.student_get_records_achievement_score_throne()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
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

  with official_students as (
    select s.id, s.name, s.brand_name
    from public.students s
    where s.classroom_id = v_classroom_id
      and public.is_official_participant(s.id)
  ),
  score_stats as (
    select
      o.id,
      o.name,
      o.brand_name,
      count(sa.id) filter (where not sa.is_revoked)::numeric as valid_count,
      coalesce(sum(a.achievement_score) filter (where not sa.is_revoked), 0)::numeric as total_score
    from official_students o
    left join public.student_achievements sa
      on sa.student_id = o.id
     and sa.classroom_id = v_classroom_id
    left join public.achievements a
      on a.id = sa.achievement_id
    group by o.id, o.name, o.brand_name
  ),
  ranked as (
    select s.*, rank() over (order by s.total_score desc) as computed_rank
    from score_stats s
  ),
  entries as (
    select
      (-1600000 - r.id)::bigint as id,
      ('LIVE_THRONE_ACHIEVEMENT_SCORE_' || r.id)::text as record_key,
      'THRONE'::text as hall_key,
      'HIGHEST_ACHIEVEMENT_SCORE'::text as record_type,
      '역대 최고 누적 업적 점수'::text as title,
      '회수되지 않은 공식 업적의 누적 점수 기준'::text as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      r.name as subject_display_name,
      r.brand_name as subject_brand_name,
      v_school_year as school_year,
      null::text as season_label,
      (v_school_year || '년')::text as period_label,
      null::date as occurred_on,
      r.computed_rank::integer as rank_position,
      r.total_score as value_primary,
      r.valid_count as value_secondary,
      null::numeric as denominator,
      '점'::text as unit,
      r.total_score as comparison_value,
      'PRODUCTION_DERIVED'::text as source_kind,
      jsonb_build_object(
        'derivation', 'sum achievements.achievement_score where student_achievements.is_revoked=false',
        'student_id', r.id,
        'official_participant', true,
        'valid_achievement_count', r.valid_count,
        'historical_note', '2023-2025 achievement system not measured'
      ) as metadata,
      40::integer as sort_order
    from ranked r
    where r.computed_rank = 1
      and r.total_score > 0
  )
  select coalesce(
    jsonb_agg(to_jsonb(e) order by e.rank_position, e.id),
    '[]'::jsonb
  )
  into v_entries
  from entries e;

  return jsonb_build_object('entries', v_entries);
end;
$$;

revoke all on function public.student_get_records_achievement_score_throne() from public;
revoke all on function public.student_get_records_achievement_score_throne() from anon;
grant execute on function public.student_get_records_achievement_score_throne() to authenticated;
