-- B.R.A.N.D 2.0
-- 2026-09 Guild Hegemony monthly commander record correction
-- Live production DB was already corrected on 2026-10-08.
-- This file is kept in-repo as an idempotent reproducibility/reference patch.

begin;

update public.records_historical_entries
set
  record_key = 'GUILD_MONTH_CONTRIB_2026_09_RYUEUNWOO',
  title = '역대 최고 월간 기여도 달성률',
  subtitle = '2026년 9월 · 슈퍼노바',
  subject_display_name = '류은우',
  subject_brand_name = '탕쫀쿠',
  subject_student_id = 7,
  school_year = 2026,
  period_label = '2026-09',
  occurred_on = date '2026-09-30',
  value_primary = 752.22,
  unit = '점',
  source_kind = 'CURATED',
  source_ref = 'guild5:classroom:1:season:4:2026-09:version:6:student:7',
  metadata = jsonb_build_object(
    'guild', '슈퍼노바',
    'guild_id', 12,
    'rate_percent', 83.58,
    'final_contribution', 752.22,
    'guild5_version_id', 6
  ),
  updated_at = now()
where hall_key = 'GUILD_HEGEMONY'
  and record_type = 'BEST_MONTHLY_CONTRIBUTION_RATE'
  and (
    record_key = 'GUILD_MONTH_CONTRIB_2026_05_JEONGMINJUN'
    or record_key = 'GUILD_MONTH_CONTRIB_2026_09_RYUEUNWOO'
  );

commit;

select
  record_key,
  subject_display_name,
  subject_student_id,
  period_label,
  value_primary,
  unit,
  metadata
from public.records_historical_entries
where hall_key='GUILD_HEGEMONY'
  and record_type='BEST_MONTHLY_CONTRIBUTION_RATE'
order by value_primary desc
limit 1;
