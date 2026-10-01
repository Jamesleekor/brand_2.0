-- B.R.A.N.D 2.0 Monthly MVP incarnation theme metadata
-- 2026-10-01
-- UI has source-code fallbacks, so this migration is safe to apply independently.

update public.records_monthly_mvp_archive
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'incarnation_title', case period_key
        when '2026-03' then '새벽을 부르는 자'
        when '2026-04' then '불을 건네는 자'
        when '2026-05' then '가능성을 피우는 자'
        when '2026-06' then '길을 여는 자'
        when '2026-07' then '대열을 잇는 자'
        when '2026-09' then '딛고 일어서는 자'
      end,
      'incarnation_theme', case period_key
        when '2026-03' then 'DAWN_CALLER'
        when '2026-04' then 'EMBER_CORE'
        when '2026-05' then 'BLOOM_POTENTIAL'
        when '2026-06' then 'PATHFINDER_TIDE'
        when '2026-07' then 'PROCESSION_LINK'
        when '2026-09' then 'AURORA_REBIRTH'
      end
    ),
    updated_at = now()
where period_key in ('2026-03','2026-04','2026-05','2026-06','2026-07','2026-09');
