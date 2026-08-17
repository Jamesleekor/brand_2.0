-- B.R.A.N.D 2.0 — Guild5 TEST synthetic Draft GS seed PRE-FLIGHT (read-only)
WITH checks AS (
  SELECT 10 AS check_order,'dependencies'::text AS check_name,
    CASE WHEN
      to_regclass('public.test_classroom_fixtures') IS NOT NULL AND
      to_regclass('public.guild2_gs_events') IS NOT NULL AND
      to_regclass('public.guild2_monthly_gs_summaries') IS NOT NULL AND
      to_regprocedure('public.ensure_teacher_role()') IS NOT NULL AND
      to_regprocedure('public.guild2_resolve_season_for_month(integer,text)') IS NOT NULL AND
      to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NOT NULL AND
      to_regprocedure('public.guild5_month_is_frozen(integer,integer,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_create_guild(text,text,text,text,boolean)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'test_fixture',to_regclass('public.test_classroom_fixtures'),
      'gs_events',to_regclass('public.guild2_gs_events'),
      'summaries',to_regclass('public.guild2_monthly_gs_summaries'),
      'refresh',to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)'),
      'freeze',to_regprocedure('public.guild5_month_is_frozen(integer,integer,text)'),
      'create_guild',to_regprocedure('public.teacher_create_guild(text,text,text,text,boolean)')
    ) AS detail
  UNION ALL
  SELECT 20,'new_rpc_before_apply',
    CASE WHEN to_regprocedure('public.teacher_prepare_guild5_test_guilds_for_month(text)') IS NULL THEN 'PASS' ELSE 'INFO' END,
    jsonb_build_object('rpc',to_regprocedure('public.teacher_prepare_guild5_test_guilds_for_month(text)'))
  UNION ALL
  SELECT 30,'test_fixture_state','INFO',
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'classroom_id',f.classroom_id,'season_id',f.season_id,'fixture_code',f.fixture_code,
      'active_guild_count',(SELECT count(*) FROM public.guilds g WHERE g.classroom_id=f.classroom_id AND g.season_id=f.season_id AND coalesce(g.is_active,true))
    )) FROM public.test_classroom_fixtures f WHERE f.fixture_code='BRAND_TEST_V1'),'[]'::jsonb)
  UNION ALL
  SELECT 40,'existing_test_seed_events','INFO',
    jsonb_build_object('active_seed_count',(
      SELECT count(*) FROM public.guild2_gs_events e
      WHERE e.source_type='MANUAL_ADJUSTMENT'
        AND e.event_kind='POST'
        AND coalesce((e.metadata->>'g5_test_seed')::boolean,false)=true
        AND NOT EXISTS(SELECT 1 FROM public.guild2_gs_events r WHERE r.reversal_of=e.id AND r.event_kind='REVERSAL')
    ))
)
SELECT * FROM checks ORDER BY check_order;
