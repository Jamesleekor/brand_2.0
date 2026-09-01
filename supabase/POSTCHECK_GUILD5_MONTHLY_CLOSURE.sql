-- B.R.A.N.D 2.0 Guild5 — consolidated postcheck
WITH checks AS (
  SELECT 10 AS check_order,'guild5_tables'::text AS check_name,
    CASE WHEN
      to_regclass('public.guild5_month_closures') IS NOT NULL AND
      to_regclass('public.guild5_closure_versions') IS NOT NULL AND
      to_regclass('public.guild5_student_snapshots') IS NOT NULL AND
      to_regclass('public.guild5_guild_snapshots') IS NOT NULL AND
      to_regclass('public.guild5_territories') IS NOT NULL AND
      to_regclass('public.guild5_conquest_turns') IS NOT NULL AND
      to_regclass('public.guild5_audit_events') IS NOT NULL AND
      to_regclass('public.guild5_season_locks') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'closures',to_regclass('public.guild5_month_closures'),'versions',to_regclass('public.guild5_closure_versions'),
      'student_snapshots',to_regclass('public.guild5_student_snapshots'),'guild_snapshots',to_regclass('public.guild5_guild_snapshots'),
      'territories',to_regclass('public.guild5_territories'),'conquest',to_regclass('public.guild5_conquest_turns'),
      'audit',to_regclass('public.guild5_audit_events'),'season_locks',to_regclass('public.guild5_season_locks')
    ) AS detail
  UNION ALL
  SELECT 20,'required_rpcs',
    CASE WHEN
      to_regprocedure('public.teacher_get_guild5_close_preview(text)') IS NOT NULL AND
      to_regprocedure('public.teacher_set_guild5_override(text,text,boolean,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_set_guild5_territory(integer,integer,text,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_finalize_guild5_month(text)') IS NOT NULL AND
      to_regprocedure('public.teacher_reopen_guild5_month(text,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_process_guild5_due_conquest(bigint)') IS NOT NULL AND
      to_regprocedure('public.teacher_choose_guild5_territory(bigint,bigint)') IS NOT NULL AND
      to_regprocedure('public.teacher_start_guild5_reconquest(bigint,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_lock_guild5_season(integer,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_get_guild5_dashboard(text)') IS NOT NULL AND
      to_regprocedure('public.teacher_prepare_guild5_test_guilds()') IS NOT NULL AND
      to_regprocedure('public.teacher_force_guild5_test_turn_due(bigint)') IS NOT NULL AND
      to_regprocedure('public.student_get_guild5_monthly_history()') IS NOT NULL AND
      to_regprocedure('public.teacher_reset_test_classroom_fixture()') IS NOT NULL AND
      to_regprocedure('public.guild5_preexisting_teacher_reset_test_classroom_fixture()') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'preview',to_regprocedure('public.teacher_get_guild5_close_preview(text)'),
      'finalize',to_regprocedure('public.teacher_finalize_guild5_month(text)'),
      'reopen',to_regprocedure('public.teacher_reopen_guild5_month(text,text)'),
      'choose_territory',to_regprocedure('public.teacher_choose_guild5_territory(bigint,bigint)'),
      'reconquest',to_regprocedure('public.teacher_start_guild5_reconquest(bigint,text)'),
      'dashboard',to_regprocedure('public.teacher_get_guild5_dashboard(text)'),
      'student_history',to_regprocedure('public.student_get_guild5_monthly_history()'),
      'test_force_due',to_regprocedure('public.teacher_force_guild5_test_turn_due(bigint)'),
      'test_reset_wrapper',to_regprocedure('public.teacher_reset_test_classroom_fixture()')
    )
  UNION ALL
  SELECT 30,'security_boundary',
    CASE WHEN
      NOT has_function_privilege('anon','public.teacher_finalize_guild5_month(text)','EXECUTE') AND
      has_function_privilege('authenticated','public.teacher_finalize_guild5_month(text)','EXECUTE') AND
      NOT has_function_privilege('anon','public.student_get_guild5_monthly_history()','EXECUTE') AND
      has_function_privilege('authenticated','public.student_get_guild5_monthly_history()','EXECUTE') AND
      NOT has_function_privilege('authenticated','public.guild5_build_close_preview(integer,integer,text)','EXECUTE') AND
      NOT has_function_privilege('authenticated','public.guild5_process_due_conquest_internal(bigint)','EXECUTE') AND
      NOT has_function_privilege('authenticated','public.guild5_preexisting_teacher_reset_test_classroom_fixture()','EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'anon_finalize',has_function_privilege('anon','public.teacher_finalize_guild5_month(text)','EXECUTE'),
      'authenticated_finalize',has_function_privilege('authenticated','public.teacher_finalize_guild5_month(text)','EXECUTE'),
      'authenticated_student_history',has_function_privilege('authenticated','public.student_get_guild5_monthly_history()','EXECUTE'),
      'internal_preview_hidden',NOT has_function_privilege('authenticated','public.guild5_build_close_preview(integer,integer,text)','EXECUTE'),
      'internal_auto_hidden',NOT has_function_privilege('authenticated','public.guild5_process_due_conquest_internal(bigint)','EXECUTE'),
      'legacy_reset_hidden',NOT has_function_privilege('authenticated','public.guild5_preexisting_teacher_reset_test_classroom_fixture()','EXECUTE')
    )
  UNION ALL
  SELECT 40,'direct_table_grants',
    CASE WHEN NOT EXISTS(
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name LIKE 'guild5_%' AND grantee IN ('anon','authenticated')
    ) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('unexpected_grants',coalesce((SELECT jsonb_agg(jsonb_build_object('table',table_name,'grantee',grantee,'privilege',privilege_type))
      FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name LIKE 'guild5_%' AND grantee IN ('anon','authenticated')),'[]'::jsonb))
  UNION ALL
  SELECT 50,'rls_enabled',
    CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'guild5_%' AND c.relkind='r')=8
      AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'guild5_%' AND c.relkind='r' AND NOT c.relrowsecurity)
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('tables',coalesce((SELECT jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity) ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'guild5_%' AND c.relkind='r'),'[]'::jsonb))
  UNION ALL
  SELECT 60,'guild3_empty_guild_hardening',
    CASE WHEN position('EXISTS' IN upper(pg_get_functiondef(to_regprocedure('public.teacher_publish_guild3_mission(bigint)'))))>0
      AND position('GUILD_MEMBERS' IN upper(pg_get_functiondef(to_regprocedure('public.teacher_publish_guild3_mission(bigint)'))))>0
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('publish_rpc',to_regprocedure('public.teacher_publish_guild3_mission(bigint)'))
  UNION ALL
  SELECT 70,'freeze_guards',
    CASE WHEN to_regprocedure('public.guild5_month_is_frozen(integer,integer,text)') IS NOT NULL
      AND (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'trg_g5_freeze_%')=13
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('trigger_count',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname LIKE 'trg_g5_freeze_%'),
      'month_freeze',to_regprocedure('public.guild5_month_is_frozen(integer,integer,text)'))
  UNION ALL
  SELECT 80,'current_state','INFO',jsonb_build_object(
    'closures',(SELECT count(*) FROM public.guild5_month_closures),
    'versions',(SELECT count(*) FROM public.guild5_closure_versions),
    'student_snapshots',(SELECT count(*) FROM public.guild5_student_snapshots),
    'guild_snapshots',(SELECT count(*) FROM public.guild5_guild_snapshots),
    'territories',(SELECT count(*) FROM public.guild5_territories),
    'conquest_turns',(SELECT count(*) FROM public.guild5_conquest_turns),
    'audit_events',(SELECT count(*) FROM public.guild5_audit_events),
    'season_locks',(SELECT count(*) FROM public.guild5_season_locks)
  )
)
SELECT check_order,check_name,status,detail FROM checks ORDER BY check_order;
