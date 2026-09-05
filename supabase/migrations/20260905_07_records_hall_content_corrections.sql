-- Records Hall of Glory content corrections and student-facing enrichment.
-- 2026-09-05
--
-- This migration intentionally separates historical calculation values from
-- student-facing presentation data. Hidden tier thresholds are removed from
-- the student-visible archive, while exact raw comparison values such as the
-- closest-season margin remain intact for future ranking logic.

-- ---------------------------------------------------------------------------
-- HALL 1 · B.R.A.N.D의 개척자
-- ---------------------------------------------------------------------------

-- Tier thresholds are intentionally undisclosed to students.
update public.records_historical_entries
set value_primary = null,
    comparison_value = null,
    unit = null,
    metadata = coalesce(metadata, '{}'::jsonb) - 'threshold_bv',
    updated_at = now()
where record_key in (
  'PIONEER_MASTER_2023_KIMSEUNGHYUN',
  'PIONEER_CELESTIAL_MASTER_2023_KIMSEUNGHYUN',
  'PIONEER_GRANDMASTER_2023_KIMSEUNGHYUN'
)
  and status = 'ACTIVE';

-- Correct first GOLD 50,000 achiever and exact date. The title already carries
-- the threshold, so no redundant RECORD value is exposed.
update public.records_historical_entries
set subject_display_name = '이혜준',
    period_label = '2023년 8월 22일',
    occurred_on = date '2023-08-22',
    value_primary = null,
    comparison_value = null,
    unit = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'corrected_achiever', true,
      'milestone_date', '2023-08-22'
    ),
    updated_at = now()
where record_key = 'PIONEER_FIRST_GOLD_50000_2023_CHOIMINJAE'
  and status = 'ACTIVE';

-- Single-occurrence milestones do not need a redundant "1회/1개" RECORD.
update public.records_historical_entries
set value_primary = null,
    comparison_value = null,
    unit = null,
    updated_at = now()
where record_key = 'PIONEER_FIRST_MONTHLY_MVP_2023_03_KIMSEUNGHYUN'
  and status = 'ACTIVE';

update public.records_historical_entries
set subtitle = '랭크 브레이커C',
    period_label = '2026년 3월 31일',
    occurred_on = date '2026-03-31',
    value_primary = null,
    comparison_value = null,
    unit = null,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'achievement_name', '랭크 브레이커C',
        'display_achievement_name', '랭크 브레이커C'
      ),
    updated_at = now()
where record_key = 'PIONEER_FIRST_UNIQUE_2026_KIMSEOYOUNG'
  and status = 'ACTIVE';

update public.records_historical_entries
set subtitle = '마스터피스',
    period_label = '2026년 4월 17일',
    occurred_on = date '2026-04-17',
    value_primary = null,
    comparison_value = null,
    unit = null,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('achievement_name', '마스터피스'),
    updated_at = now()
where record_key = 'PIONEER_FIRST_TRANSCENDENT_2026_PARKSEOEUN'
  and status = 'ACTIVE';

-- All six confirmed 2023 Grandmasters belong to the December 2023 roll.
update public.records_historical_entries
set period_label = '2023년 12월',
    updated_at = now()
where record_type = 'GRANDMASTER_ROLL'
  and hall_key = 'PIONEERS'
  and school_year = 2023
  and status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- HALL 6 · 길드 패권사
-- ---------------------------------------------------------------------------

-- Season 1 champion display rate: 26,826 / 30,000 = 89.42% (UI rounds to 89.4%).
update public.records_historical_entries
set comparison_value = round((26826::numeric / 30000::numeric) * 100, 2),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('rate_percent', round((26826::numeric / 30000::numeric) * 100, 2)),
    updated_at = now()
where record_key = 'GUILD_SEASON1_CHAMPION_RUBY'
  and status = 'ACTIVE';

-- Keep raw 0.0447 comparison value for future closest-season ranking, but store
-- the complete matchup in the student-facing subtitle/metadata.
update public.records_historical_entries
set subtitle = 'Ruby (26,826) vs 빛나는 은하수 (26,814) · 차이 0.04%',
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'winner', 'Ruby',
        'winner_gs', 26826,
        'runner_up', '빛나는 은하수',
        'runner_up_gs', 26814,
        'display_margin_percent', 0.04,
        'raw_margin_percent', 0.0447
      ),
    updated_at = now()
where record_key = 'GUILD_CLOSEST_WIN_2026_S1_RUBY'
  and status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- HALL 9 · 제왕의 증명
-- ---------------------------------------------------------------------------

-- "시즌의 황제" is itself the distinction; "1달성" is redundant.
update public.records_historical_entries
set value_primary = null,
    comparison_value = null,
    unit = null,
    updated_at = now()
where hall_key = 'SOVEREIGN_PROOF'
  and record_type = 'SEASON_EMPEROR'
  and status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- HALL 8 · 위업의 성좌 enrichment
-- ---------------------------------------------------------------------------

-- Keep the existing base Hall RPC intact and add an enriched student-facing
-- wrapper. It adds the exact currently-valid achievement names for the
-- live-derived unique/transcendent records without changing ranking logic.
create or replace function public.student_get_records_hall_of_glory_enriched()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_base jsonb;
  v_entries jsonb;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS] authenticated classroom member context is required.' using errcode='P0930';
  end if;

  v_base := public.student_get_records_hall_of_glory();

  select coalesce(
    jsonb_agg(
      case
        when e.entry->>'hall_key' = 'CONSTELLATION'
         and e.entry->>'record_type' in ('MOST_UNIQUE_ACHIEVEMENTS','MOST_TRANSCENDENT_ACHIEVEMENTS')
         and nullif(e.entry->'metadata'->>'student_id','') is not null
        then jsonb_set(
          e.entry,
          '{metadata}',
          coalesce(e.entry->'metadata', '{}'::jsonb)
          || jsonb_build_object(
            'achievement_names', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'name', a.name,
                  'achieved_on', (sa.achieved_at at time zone 'Asia/Seoul')::date
                )
                order by sa.achieved_at, a.name
              )
              from public.student_achievements sa
              join public.achievements a on a.id = sa.achievement_id
              where sa.classroom_id = v_classroom_id
                and sa.student_id = (e.entry->'metadata'->>'student_id')::integer
                and not sa.is_revoked
                and a.grade = case
                  when e.entry->>'record_type' = 'MOST_UNIQUE_ACHIEVEMENTS' then '유일'::public.achievement_grade
                  else '초월'::public.achievement_grade
                end
            ), '[]'::jsonb)
          ),
          true
        )
        else e.entry
      end
      order by e.ord
    ),
    '[]'::jsonb
  )
  into v_entries
  from jsonb_array_elements(coalesce(v_base->'entries', '[]'::jsonb)) with ordinality as e(entry, ord);

  return jsonb_set(v_base, '{entries}', v_entries, true);
end;
$$;

revoke all on function public.student_get_records_hall_of_glory_enriched() from public, anon;
grant execute on function public.student_get_records_hall_of_glory_enriched() to authenticated;
