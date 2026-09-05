-- B.R.A.N.D 2.0 Records / Hall 03 MVP finalist TOP3 podium
-- 2026-09-05
--
-- Purpose
-- - Replace the single curated MOST_MVP_FINALS plaque with a derived TOP 3 rank podium.
-- - Preserve all ties at rank 3 rather than arbitrarily dropping equal records.
-- - Keep cross-era identity year-scoped; never merge people across eras by name alone.

create or replace function public.student_get_records_mvp_finalist_top3()
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
      '공식 월간 MVP 후보 선정 누적 · TOP 3 순위까지 전시'::text as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      r.display_name as subject_display_name,
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
    where r.computed_rank <= 3
  )
  select coalesce(
    jsonb_agg(to_jsonb(p) order by p.rank_position, p.school_year, p.subject_display_name),
    '[]'::jsonb
  )
  into v_entries
  from podium p;

  return jsonb_build_object('entries', v_entries);
end;
$$;

revoke all on function public.student_get_records_mvp_finalist_top3() from public;
revoke all on function public.student_get_records_mvp_finalist_top3() from anon;
grant execute on function public.student_get_records_mvp_finalist_top3() to authenticated;
