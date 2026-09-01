-- =============================================================================
-- B.R.A.N.D 2.0 — Guild4-A Backend CONSOLIDATED POSTCHECK (READ ONLY)
-- 2026-08-16
-- Returns one result set so Supabase SQL Editor does not hide earlier checks.
-- =============================================================================

WITH checks AS (
  SELECT 10 AS check_order,'guild4_tables'::text AS check_name,
    CASE WHEN
      to_regclass('public.guild4_peer_review_rounds') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_participants') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_obligations') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_revisions') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_exception_events') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_penalties') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_score_rollups') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_audit_events') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'rounds',to_regclass('public.guild4_peer_review_rounds'),
      'participants',to_regclass('public.guild4_peer_review_participants'),
      'obligations',to_regclass('public.guild4_peer_review_obligations'),
      'revisions',to_regclass('public.guild4_peer_review_revisions'),
      'exceptions',to_regclass('public.guild4_peer_review_exception_events'),
      'penalties',to_regclass('public.guild4_peer_review_penalties'),
      'score_rollups',to_regclass('public.guild4_peer_review_score_rollups'),
      'audit',to_regclass('public.guild4_peer_review_audit_events')
    ) AS detail

  UNION ALL
  SELECT 20,'required_rpcs',
    CASE WHEN
      to_regprocedure('public.teacher_sync_guild4_peer_review_rounds()') IS NOT NULL AND
      to_regprocedure('public.teacher_list_guild4_peer_review_rounds()') IS NOT NULL AND
      to_regprocedure('public.teacher_get_guild4_peer_review_round_detail(bigint)') IS NOT NULL AND
      to_regprocedure('public.teacher_update_guild4_peer_review_deadline(bigint,timestamptz,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_set_guild4_peer_review_excused(bigint,boolean,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_close_guild4_peer_review_round(bigint,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_finalize_guild4_peer_review_round(bigint,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_retry_guild4_peer_review_penalty(bigint)') IS NOT NULL AND
      to_regprocedure('public.teacher_waive_guild4_peer_review_penalty(bigint,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_correct_guild4_peer_review(bigint,integer,text,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_correct_guild4_peer_review_exception(bigint,boolean,text)') IS NOT NULL AND
      to_regprocedure('public.student_get_guild4_peer_review_rounds()') IS NOT NULL AND
      to_regprocedure('public.student_get_guild4_peer_monthly_summary()') IS NOT NULL AND
      to_regprocedure('public.student_submit_guild4_peer_review(bigint,integer,text)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'sync',to_regprocedure('public.teacher_sync_guild4_peer_review_rounds()'),
      'finalize',to_regprocedure('public.teacher_finalize_guild4_peer_review_round(bigint,text)'),
      'correct_review',to_regprocedure('public.teacher_correct_guild4_peer_review(bigint,integer,text,text)'),
      'correct_exception',to_regprocedure('public.teacher_correct_guild4_peer_review_exception(bigint,boolean,text)'),
      'student_list',to_regprocedure('public.student_get_guild4_peer_review_rounds()'),
      'student_monthly',to_regprocedure('public.student_get_guild4_peer_monthly_summary()'),
      'student_submit',to_regprocedure('public.student_submit_guild4_peer_review(bigint,integer,text)')
    )

  UNION ALL
  SELECT 30,'monthly_peer_adapter',
    CASE WHEN
      to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)') IS NOT NULL AND
      to_regprocedure('public.guild4_peer_component_rollup(integer,integer,text)') IS NOT NULL AND
      position('guild4_peer_component_rollup' in pg_get_functiondef(to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)'))) > 0
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'readiness',to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)'),
      'rollup',to_regprocedure('public.guild4_peer_component_rollup(integer,integer,text)'),
      'guild2_refresh_uses_peer',position('guild4_peer_component_rollup' in pg_get_functiondef(to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)'))) > 0,
      'aggregation','GUILD3_MISSION_WEIGHTED_AVERAGE'
    )

  UNION ALL
  SELECT 40,'security_boundary',
    CASE WHEN
      has_function_privilege('authenticated','public.teacher_finalize_guild4_peer_review_round(bigint,text)','EXECUTE') AND
      has_function_privilege('authenticated','public.student_get_guild4_peer_review_rounds()','EXECUTE') AND
      has_function_privilege('authenticated','public.student_submit_guild4_peer_review(bigint,integer,text)','EXECUTE') AND
      NOT has_function_privilege('authenticated','public.guild4_calculate_peer_review_round_scores(bigint)','EXECUTE') AND
      NOT has_function_privilege('authenticated','public.guild4_evaluate_peer_review_penalties(bigint)','EXECUTE') AND
      NOT has_function_privilege('authenticated','public.guild4_materialize_round_from_opening(bigint)','EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'teacher_finalize_authenticated',has_function_privilege('authenticated','public.teacher_finalize_guild4_peer_review_round(bigint,text)','EXECUTE'),
      'student_list_authenticated',has_function_privilege('authenticated','public.student_get_guild4_peer_review_rounds()','EXECUTE'),
      'student_submit_authenticated',has_function_privilege('authenticated','public.student_submit_guild4_peer_review(bigint,integer,text)','EXECUTE'),
      'scoring_helper_hidden',NOT has_function_privilege('authenticated','public.guild4_calculate_peer_review_round_scores(bigint)','EXECUTE'),
      'penalty_helper_hidden',NOT has_function_privilege('authenticated','public.guild4_evaluate_peer_review_penalties(bigint)','EXECUTE'),
      'materializer_hidden',NOT has_function_privilege('authenticated','public.guild4_materialize_round_from_opening(bigint)','EXECUTE')
    )

  UNION ALL
  SELECT 50,'direct_table_grants',
    CASE WHEN NOT EXISTS(
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name LIKE 'guild4_peer_review_%' AND grantee IN ('anon','authenticated')
    ) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('unexpected_grants',coalesce((
      SELECT jsonb_agg(jsonb_build_object('grantee',grantee,'table',table_name,'privilege',privilege_type))
      FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name LIKE 'guild4_peer_review_%' AND grantee IN ('anon','authenticated')
    ),'[]'::jsonb))

  UNION ALL
  SELECT 60,'rls_enabled',
    CASE WHEN NOT EXISTS(
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname LIKE 'guild4_peer_review_%' AND c.relkind='r' AND NOT c.relrowsecurity
    ) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('tables',coalesce((
      SELECT jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity) ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname LIKE 'guild4_peer_review_%' AND c.relkind='r'
    ),'[]'::jsonb))

  UNION ALL
  SELECT 70,'source_void_trigger',
    CASE WHEN EXISTS(
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='guild3_peer_review_openings' AND NOT t.tgisinternal AND t.tgname='guild4_reconcile_source_void_on_opening'
    ) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('exists',EXISTS(
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='guild3_peer_review_openings' AND NOT t.tgisinternal AND t.tgname='guild4_reconcile_source_void_on_opening'
    ))

  UNION ALL
  SELECT 80,'invalid_self_review',
    CASE WHEN NOT EXISTS(SELECT 1 FROM public.guild4_peer_review_obligations WHERE reviewer_student_id=target_student_id) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('invalid_count',(SELECT count(*) FROM public.guild4_peer_review_obligations WHERE reviewer_student_id=target_student_id))

  UNION ALL
  SELECT 90,'current_state','INFO',
    jsonb_build_object(
      'source_openings',(SELECT count(*) FROM public.guild3_peer_review_openings WHERE opening_status='OPENABLE'),
      'rounds',(SELECT count(*) FROM public.guild4_peer_review_rounds),
      'participants',(SELECT count(*) FROM public.guild4_peer_review_participants),
      'obligations',(SELECT count(*) FROM public.guild4_peer_review_obligations),
      'revisions',(SELECT count(*) FROM public.guild4_peer_review_revisions),
      'penalties',(SELECT count(*) FROM public.guild4_peer_review_penalties),
      'score_rollups',(SELECT count(*) FROM public.guild4_peer_review_score_rollups)
    )
)
SELECT check_order,check_name,status,detail FROM checks ORDER BY check_order;
