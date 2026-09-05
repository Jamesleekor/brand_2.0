-- Records Hall of Glory: exact pioneer milestone dates and 2023 Grandmaster lineage.
-- 2026-09-05
--
-- Grandmaster Roll is a lineage, not a ranking. We preserve chronological order
-- through sort_order / attained_order and intentionally expose no BV value or rank.

update public.records_historical_entries
set occurred_on = date '2023-10-19',
    period_label = '2023년 10월 19일',
    updated_at = now()
where record_key = 'PIONEER_MASTER_2023_KIMSEUNGHYUN'
  and status = 'ACTIVE';

update public.records_historical_entries
set occurred_on = date '2023-11-10',
    period_label = '2023년 11월 10일',
    updated_at = now()
where record_key = 'PIONEER_CELESTIAL_MASTER_2023_KIMSEUNGHYUN'
  and status = 'ACTIVE';

-- Latest confirmed chronology supersedes the earlier provisional 2023-12-12 date.
update public.records_historical_entries
set occurred_on = date '2023-11-21',
    period_label = '2023년 11월 21일',
    updated_at = now()
where record_key = 'PIONEER_GRANDMASTER_2023_KIMSEUNGHYUN'
  and status = 'ACTIVE';

with lineage(record_key, attained_on, attained_order, new_sort_order) as (
  values
    ('GRANDMASTER_ROLL_2023_KIMSEUNGHYUN'::text, date '2023-11-21', 1, 120),
    ('GRANDMASTER_ROLL_2023_CHOIMINJAE'::text,     date '2023-12-06', 2, 121),
    ('GRANDMASTER_ROLL_2023_LEEJUNHYUK'::text,     date '2023-12-12', 3, 122),
    ('GRANDMASTER_ROLL_2023_GONGYESEONG'::text,    date '2023-12-19', 4, 123),
    ('GRANDMASTER_ROLL_2023_MINSEOHONG'::text,     date '2023-12-20', 5, 124),
    ('GRANDMASTER_ROLL_2023_LEEHYEJUN'::text,      date '2023-12-22', 6, 125)
)
update public.records_historical_entries h
set occurred_on = l.attained_on,
    period_label = to_char(l.attained_on, 'YYYY"년" FMMM"월" FMDD"일"'),
    rank_position = null,
    value_primary = null,
    comparison_value = null,
    unit = null,
    metadata = (coalesce(h.metadata, '{}'::jsonb) - 'raw_bv' - 'adjustment' - 'display_bv')
      || jsonb_build_object(
        'attained_order', l.attained_order,
        'attained_on', to_char(l.attained_on, 'YYYY-MM-DD'),
        'lineage_not_ranking', true
      ),
    sort_order = l.new_sort_order,
    updated_at = now()
from lineage l
where h.record_key = l.record_key
  and h.status = 'ACTIVE';
