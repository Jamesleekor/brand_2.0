-- Guild5 conquest map/tax incremental POSTCHECK
WITH checks AS (
  SELECT 10 AS check_order,'columns' AS check_name,
         CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_territories' AND column_name='tax_rate_percent')
                   AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_slot_no_snapshot')
                   AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_tax_rate_snapshot')
                   AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_description_snapshot')
                   AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_guild_snapshots' AND column_name='guild_logo_url_at_close')
              THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object(
           'territory_tax',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_territories' AND column_name='tax_rate_percent'),
           'turn_slot_snapshot',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_slot_no_snapshot'),
           'turn_tax_snapshot',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_tax_rate_snapshot'),
           'turn_description_snapshot',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_conquest_turns' AND column_name='territory_description_snapshot'),
           'guild_logo_snapshot',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild5_guild_snapshots' AND column_name='guild_logo_url_at_close')
         ) AS detail
  UNION ALL
  SELECT 20,'functions',
         CASE WHEN to_regprocedure('public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric)') IS NOT NULL
                   AND to_regprocedure('public.guild5_capture_conquest_territory_snapshot()') IS NOT NULL
                   AND to_regprocedure('public.guild5_capture_guild_logo_snapshot()') IS NOT NULL
                   AND to_regprocedure('public.student_get_guild5_monthly_history()') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object(
           'territory_v2',to_regprocedure('public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric)'),
           'territory_snapshot_trigger_fn',to_regprocedure('public.guild5_capture_conquest_territory_snapshot()'),
           'logo_snapshot_trigger_fn',to_regprocedure('public.guild5_capture_guild_logo_snapshot()'),
           'student_history',to_regprocedure('public.student_get_guild5_monthly_history()')
         )
  UNION ALL
  SELECT 30,'snapshot_backfill',
         CASE WHEN NOT EXISTS(
           SELECT 1 FROM public.guild5_conquest_turns
           WHERE territory_id IS NOT NULL
             AND (territory_slot_no_snapshot IS NULL OR territory_tax_rate_snapshot IS NULL)
         ) THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object(
           'assigned_missing_snapshot',(SELECT count(*) FROM public.guild5_conquest_turns WHERE territory_id IS NOT NULL AND (territory_slot_no_snapshot IS NULL OR territory_tax_rate_snapshot IS NULL)),
           'territory_tax_rates',(SELECT coalesce(jsonb_agg(jsonb_build_object('slot',slot_no,'name',territory_name,'tax_rate_percent',tax_rate_percent) ORDER BY slot_no),'[]'::jsonb) FROM public.guild5_territories)
         )
  UNION ALL
  SELECT 40,'rpc_grants',
         CASE WHEN has_function_privilege('authenticated','public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric)','EXECUTE')
                   AND has_function_privilege('authenticated','public.student_get_guild5_monthly_history()','EXECUTE')
                   AND NOT has_function_privilege('anon','public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric)','EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object(
           'authenticated_territory_v2',has_function_privilege('authenticated','public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric)','EXECUTE'),
           'authenticated_history',has_function_privilege('authenticated','public.student_get_guild5_monthly_history()','EXECUTE'),
           'anon_territory_v2',has_function_privilege('anon','public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric)','EXECUTE')
         )
)
SELECT * FROM checks ORDER BY check_order;
