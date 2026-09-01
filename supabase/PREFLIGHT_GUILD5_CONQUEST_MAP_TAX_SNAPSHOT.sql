-- Guild5 conquest map/tax incremental PRE-FLIGHT (read-only)
WITH checks AS (
  SELECT 10 AS check_order,'dependencies' AS check_name,
         CASE WHEN to_regclass('public.guild5_territories') IS NOT NULL
                   AND to_regclass('public.guild5_conquest_turns') IS NOT NULL
                   AND to_regclass('public.guild5_guild_snapshots') IS NOT NULL
                   AND to_regprocedure('public.student_get_guild5_monthly_history()') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object(
           'territories',to_regclass('public.guild5_territories'),
           'conquest_turns',to_regclass('public.guild5_conquest_turns'),
           'guild_snapshots',to_regclass('public.guild5_guild_snapshots'),
           'student_history',to_regprocedure('public.student_get_guild5_monthly_history()')
         ) AS detail
  UNION ALL
  SELECT 20,'new_columns_before_apply',
         CASE WHEN NOT EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='guild5_territories' AND column_name='tax_rate_percent'
         ) AND NOT EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_tax_rate_snapshot'
         ) THEN 'PASS' ELSE 'INFO' END,
         jsonb_build_object(
           'territory_tax_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_territories' AND column_name='tax_rate_percent'),
           'turn_tax_snapshot_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_tax_rate_snapshot'),
           'guild_logo_snapshot_column',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_guild_snapshots' AND column_name='guild_logo_url_at_close')
         )
  UNION ALL
  SELECT 30,'current_conquest_state','INFO',
         jsonb_build_object(
           'territories',(SELECT count(*) FROM public.guild5_territories),
           'assigned_turns',(SELECT count(*) FROM public.guild5_conquest_turns WHERE turn_status IN ('ASSIGNED','AUTO_ASSIGNED')),
           'final_versions',(SELECT count(*) FROM public.guild5_closure_versions WHERE finalized_at IS NOT NULL)
         )
)
SELECT * FROM checks ORDER BY check_order;
