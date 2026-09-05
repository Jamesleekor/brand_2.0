-- B.R.A.N.D 2.0 Records / Hall of Glory live-derived records
-- 2026-09-05
--
-- Purpose
-- - Keep curated cross-season history immutable.
-- - Derive current official 2026 records from authoritative Production ledgers at read time.
-- - Automatically let a current-class record enter/replace an all-time throne when it exceeds
--   the curated historical record.
--
-- Sources
-- - BV/GOLD historical maxima: legacy_asset_history + non-reversed transactions + current wallets
-- - Donation totals: student_financial_migration_baselines + post-cutover non-reversed DONATION transactions
-- - Achievement records: non-revoked student_achievements + achievements catalog
--
-- IMPORTANT: apply only after READ-ONLY preflight -> guard -> rollback rehearsal -> one-time apply -> strict postcheck.

create or replace function public.student_get_records_hall_of_glory()
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
  asset_candidates as (
    select
      l.student_id,
      'BV'::text as value_token,
      l.balance_after_bv::numeric as balance_after,
      coalesce(l.occurred_at, l.event_date::timestamp at time zone 'Asia/Seoul') as occurred_at,
      l.event_date as occurred_on,
      10 as source_priority
    from public.legacy_asset_history l
    join official_students o on o.id = l.student_id
    where l.classroom_id = v_classroom_id

    union all

    select
      l.student_id,
      'GOLD'::text,
      l.balance_after_gold::numeric,
      coalesce(l.occurred_at, l.event_date::timestamp at time zone 'Asia/Seoul'),
      l.event_date,
      10
    from public.legacy_asset_history l
    join official_students o on o.id = l.student_id
    where l.classroom_id = v_classroom_id

    union all

    select
      t.student_id,
      t.value_token::text,
      t.balance_after::numeric,
      t.created_at,
      (t.created_at at time zone 'Asia/Seoul')::date,
      20
    from public.transactions t
    join official_students o on o.id = t.student_id
    where t.value_token in ('BV','GOLD')
      and not t.is_reversed

    union all

    select
      w.student_id,
      'BV'::text,
      w.bv::numeric,
      w.updated_at,
      (w.updated_at at time zone 'Asia/Seoul')::date,
      30
    from public.wallets w
    join official_students o on o.id = w.student_id

    union all

    select
      w.student_id,
      'GOLD'::text,
      w.gold::numeric,
      w.updated_at,
      (w.updated_at at time zone 'Asia/Seoul')::date,
      30
    from public.wallets w
    join official_students o on o.id = w.student_id
  ),
  student_asset_max as (
    select distinct on (a.student_id, a.value_token)
      a.student_id,
      a.value_token,
      a.balance_after,
      a.occurred_at,
      a.occurred_on
    from asset_candidates a
    order by
      a.student_id,
      a.value_token,
      a.balance_after desc,
      a.occurred_at asc nulls last,
      a.source_priority asc
  ),
  donation_totals as (
    select
      o.id as student_id,
      coalesce(b.donation_total_baseline, 0)::numeric
        + coalesce(sum(
            case
              when t.source_type = 'DONATION'
               and t.value_token = 'GOLD'
               and not t.is_reversed
               and t.id > coalesce(b.cutover_transaction_id, 0)
              then (-least(t.amount, 0))::numeric
              else 0::numeric
            end
          ), 0::numeric) as total_donation
    from official_students o
    left join public.student_financial_migration_baselines b
      on b.student_id = o.id
     and b.classroom_id = v_classroom_id
    left join public.transactions t
      on t.student_id = o.id
    group by o.id, b.donation_total_baseline, b.cutover_transaction_id
  ),
  achievement_stats as (
    select
      o.id as student_id,
      count(sa.id) filter (where not sa.is_revoked)::numeric as valid_count,
      count(sa.id) filter (where not sa.is_revoked and a.grade = '유일')::numeric as unique_count,
      count(sa.id) filter (where not sa.is_revoked and a.grade = '초월')::numeric as transcend_count
    from official_students o
    left join public.student_achievements sa
      on sa.student_id = o.id
     and sa.classroom_id = v_classroom_id
    left join public.achievements a
      on a.id = sa.achievement_id
    group by o.id
  ),
  base_entries as (
    select
      h.id,
      h.record_key,
      h.hall_key,
      h.record_type,
      h.title,
      h.subtitle,
      h.description,
      h.subject_kind,
      h.subject_display_name,
      h.subject_brand_name,
      h.school_year,
      h.season_label,
      h.period_label,
      h.occurred_on,
      h.rank_position,
      h.value_primary,
      h.value_secondary,
      h.denominator,
      h.unit,
      h.comparison_value,
      h.source_kind,
      h.metadata,
      h.sort_order
    from public.records_historical_entries h
    where h.status = 'ACTIVE'
      and not (
        (h.hall_key = 'THRONE' and h.record_type in ('ALL_TIME_BV','ALL_TIME_GOLD_BALANCE'))
        or (h.hall_key = 'GOLDEN_CHRONICLE' and h.record_type = 'LIFETIME_DONATION')
      )
  ),
  bv_candidates as (
    select
      h.id,
      h.record_key,
      h.subject_kind,
      h.subject_display_name,
      h.subject_brand_name,
      h.school_year,
      h.period_label,
      h.occurred_on,
      h.value_primary,
      coalesce(h.comparison_value, h.value_primary) as comparison_value,
      h.source_kind,
      h.metadata
    from public.records_historical_entries h
    where h.status = 'ACTIVE'
      and h.hall_key = 'THRONE'
      and h.record_type = 'ALL_TIME_BV'

    union all

    select
      (-1000000 - o.id)::bigint,
      ('LIVE_THRONE_BV_' || o.id)::text,
      'STUDENT'::text,
      o.name,
      o.brand_name,
      v_school_year,
      (extract(year from m.occurred_on)::int || '년 ' || extract(month from m.occurred_on)::int || '월')::text,
      m.occurred_on,
      m.balance_after,
      m.balance_after,
      'PRODUCTION_DERIVED'::text,
      jsonb_build_object(
        'derivation', 'legacy_asset_history + non_reversed_transactions + current_wallet',
        'student_id', o.id,
        'official_participant', true
      )
    from student_asset_max m
    join official_students o on o.id = m.student_id
    where m.value_token = 'BV'
  ),
  bv_ranked as (
    select b.*, rank() over (order by b.comparison_value desc) as computed_rank
    from bv_candidates b
  ),
  bv_entries as (
    select
      b.id,
      b.record_key,
      'THRONE'::text as hall_key,
      'ALL_TIME_BV'::text as record_type,
      '역대 최고 BV'::text as title,
      case when b.source_kind = 'PRODUCTION_DERIVED' then '현재 공식 원장에서 자동 산정'::text else null::text end as subtitle,
      null::text as description,
      b.subject_kind,
      b.subject_display_name,
      b.subject_brand_name,
      b.school_year,
      null::text as season_label,
      b.period_label,
      b.occurred_on,
      b.computed_rank::integer as rank_position,
      b.value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      'BV'::text as unit,
      b.comparison_value,
      b.source_kind,
      b.metadata,
      10::integer as sort_order
    from bv_ranked b
    where b.computed_rank = 1
  ),
  gold_candidates as (
    select
      h.id,
      h.record_key,
      h.subject_kind,
      h.subject_display_name,
      h.subject_brand_name,
      h.school_year,
      h.period_label,
      h.occurred_on,
      h.value_primary,
      coalesce(h.comparison_value, h.value_primary) as comparison_value,
      h.source_kind,
      h.metadata
    from public.records_historical_entries h
    where h.status = 'ACTIVE'
      and h.hall_key = 'THRONE'
      and h.record_type = 'ALL_TIME_GOLD_BALANCE'

    union all

    select
      (-1100000 - o.id)::bigint,
      ('LIVE_THRONE_GOLD_' || o.id)::text,
      'STUDENT'::text,
      o.name,
      o.brand_name,
      v_school_year,
      (extract(year from m.occurred_on)::int || '년 ' || extract(month from m.occurred_on)::int || '월')::text,
      m.occurred_on,
      m.balance_after,
      m.balance_after,
      'PRODUCTION_DERIVED'::text,
      jsonb_build_object(
        'derivation', 'legacy_asset_history + non_reversed_transactions + current_wallet',
        'student_id', o.id,
        'official_participant', true
      )
    from student_asset_max m
    join official_students o on o.id = m.student_id
    where m.value_token = 'GOLD'
  ),
  gold_ranked as (
    select g.*, rank() over (order by g.comparison_value desc) as computed_rank
    from gold_candidates g
  ),
  gold_entries as (
    select
      g.id,
      g.record_key,
      'THRONE'::text as hall_key,
      'ALL_TIME_GOLD_BALANCE'::text as record_type,
      '역대 최고 보유 GOLD'::text as title,
      case when g.source_kind = 'PRODUCTION_DERIVED' then '현재 공식 원장에서 자동 산정'::text else null::text end as subtitle,
      null::text as description,
      g.subject_kind,
      g.subject_display_name,
      g.subject_brand_name,
      g.school_year,
      null::text as season_label,
      g.period_label,
      g.occurred_on,
      g.computed_rank::integer as rank_position,
      g.value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      'GOLD'::text as unit,
      g.comparison_value,
      g.source_kind,
      g.metadata,
      (20 + g.computed_rank)::integer as sort_order
    from gold_ranked g
    where g.computed_rank <= 5
  ),
  achievement_count_ranked as (
    select
      o.id,
      o.name,
      o.brand_name,
      a.valid_count,
      rank() over (order by a.valid_count desc) as computed_rank
    from achievement_stats a
    join official_students o on o.id = a.student_id
  ),
  achievement_count_entries as (
    select
      (-1200000 - a.id)::bigint as id,
      ('LIVE_THRONE_ACHIEVEMENT_COUNT_' || a.id)::text as record_key,
      'THRONE'::text as hall_key,
      'MOST_VALID_ACHIEVEMENTS'::text as record_type,
      '역대 최다 유효 업적'::text as title,
      '회수되지 않은 공식 업적 기준'::text as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      a.name as subject_display_name,
      a.brand_name as subject_brand_name,
      v_school_year as school_year,
      null::text as season_label,
      (v_school_year || '년')::text as period_label,
      null::date as occurred_on,
      a.computed_rank::integer as rank_position,
      a.valid_count as value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      '개'::text as unit,
      a.valid_count as comparison_value,
      'PRODUCTION_DERIVED'::text as source_kind,
      jsonb_build_object(
        'derivation', 'student_achievements where is_revoked=false',
        'student_id', a.id,
        'official_participant', true,
        'historical_note', '2023-2025 achievement system not measured'
      ) as metadata,
      30::integer as sort_order
    from achievement_count_ranked a
    where a.computed_rank = 1
      and a.valid_count > 0
  ),
  donation_candidates as (
    select
      h.id,
      h.record_key,
      h.subject_kind,
      h.subject_display_name,
      h.subject_brand_name,
      h.school_year,
      h.period_label,
      h.value_primary,
      coalesce(h.comparison_value, h.value_primary) as comparison_value,
      h.source_kind,
      h.metadata
    from public.records_historical_entries h
    where h.status = 'ACTIVE'
      and h.hall_key = 'GOLDEN_CHRONICLE'
      and h.record_type = 'LIFETIME_DONATION'

    union all

    select
      (-1300000 - o.id)::bigint,
      ('LIVE_DONATION_' || o.id)::text,
      'STUDENT'::text,
      o.name,
      o.brand_name,
      v_school_year,
      (v_school_year || '년 누적')::text,
      d.total_donation,
      d.total_donation,
      'PRODUCTION_DERIVED'::text,
      jsonb_build_object(
        'derivation', 'migration_baseline + post_cutover_non_reversed_donation',
        'student_id', o.id,
        'official_participant', true
      )
    from donation_totals d
    join official_students o on o.id = d.student_id
    where d.total_donation > 0
  ),
  donation_ranked as (
    select d.*, rank() over (order by d.comparison_value desc) as computed_rank
    from donation_candidates d
  ),
  donation_entries as (
    select
      d.id,
      d.record_key,
      'GOLDEN_CHRONICLE'::text as hall_key,
      'LIFETIME_DONATION'::text as record_type,
      '역대 최고 누적 기부'::text as title,
      case when d.source_kind = 'PRODUCTION_DERIVED' then '마이그레이션 기준값과 이후 공식 기부 원장을 합산'::text else null::text end as subtitle,
      null::text as description,
      d.subject_kind,
      d.subject_display_name,
      d.subject_brand_name,
      d.school_year,
      null::text as season_label,
      d.period_label,
      null::date as occurred_on,
      d.computed_rank::integer as rank_position,
      d.value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      'GOLD'::text as unit,
      d.comparison_value,
      d.source_kind,
      d.metadata,
      (10 + d.computed_rank)::integer as sort_order
    from donation_ranked d
    where d.computed_rank <= 3
  ),
  unique_ranked as (
    select
      o.id,
      o.name,
      o.brand_name,
      a.unique_count,
      rank() over (order by a.unique_count desc) as computed_rank
    from achievement_stats a
    join official_students o on o.id = a.student_id
  ),
  unique_entries as (
    select
      (-1400000 - u.id)::bigint as id,
      ('LIVE_CONSTELLATION_UNIQUE_' || u.id)::text as record_key,
      'CONSTELLATION'::text as hall_key,
      'MOST_UNIQUE_ACHIEVEMENTS'::text as record_type,
      '역대 최다 유일 업적'::text as title,
      '현재 유효한 유일 등급 업적 기준'::text as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      u.name as subject_display_name,
      u.brand_name as subject_brand_name,
      v_school_year as school_year,
      null::text as season_label,
      (v_school_year || '년')::text as period_label,
      null::date as occurred_on,
      u.computed_rank::integer as rank_position,
      u.unique_count as value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      '개'::text as unit,
      u.unique_count as comparison_value,
      'PRODUCTION_DERIVED'::text as source_kind,
      jsonb_build_object('derivation','valid achievement grade=유일','student_id',u.id,'official_participant',true) as metadata,
      20::integer as sort_order
    from unique_ranked u
    where u.computed_rank = 1
      and u.unique_count > 0
  ),
  transcend_ranked as (
    select
      o.id,
      o.name,
      o.brand_name,
      a.transcend_count,
      rank() over (order by a.transcend_count desc) as computed_rank
    from achievement_stats a
    join official_students o on o.id = a.student_id
  ),
  transcend_entries as (
    select
      (-1500000 - t.id)::bigint as id,
      ('LIVE_CONSTELLATION_TRANSCEND_' || t.id)::text as record_key,
      'CONSTELLATION'::text as hall_key,
      'MOST_TRANSCENDENT_ACHIEVEMENTS'::text as record_type,
      '역대 최다 초월 업적'::text as title,
      '현재 유효한 초월 등급 업적 기준'::text as subtitle,
      null::text as description,
      'STUDENT'::text as subject_kind,
      t.name as subject_display_name,
      t.brand_name as subject_brand_name,
      v_school_year as school_year,
      null::text as season_label,
      (v_school_year || '년')::text as period_label,
      null::date as occurred_on,
      t.computed_rank::integer as rank_position,
      t.transcend_count as value_primary,
      null::numeric as value_secondary,
      null::numeric as denominator,
      '개'::text as unit,
      t.transcend_count as comparison_value,
      'PRODUCTION_DERIVED'::text as source_kind,
      jsonb_build_object('derivation','valid achievement grade=초월','student_id',t.id,'official_participant',true) as metadata,
      30::integer as sort_order
    from transcend_ranked t
    where t.computed_rank = 1
      and t.transcend_count > 0
  ),
  all_entries as (
    select * from base_entries
    union all select * from bv_entries
    union all select * from gold_entries
    union all select * from achievement_count_entries
    union all select * from donation_entries
    union all select * from unique_entries
    union all select * from transcend_entries
  )
  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.hall_key, q.sort_order, q.rank_position nulls last, q.id),
    '[]'::jsonb
  )
  into v_entries
  from all_entries q;

  return jsonb_build_object(
    'entries', v_entries,
    'gap_eras', jsonb_build_array(
      jsonb_build_object(
        'start_year', 2024,
        'end_year', 2025,
        'title', '공백의 2년',
        'subtitle', '기록이 침묵한 시대'
      )
    )
  );
end;
$$;

revoke all on function public.student_get_records_hall_of_glory() from public;
revoke all on function public.student_get_records_hall_of_glory() from anon;
grant execute on function public.student_get_records_hall_of_glory() to authenticated;
