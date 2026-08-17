-- B.R.A.N.D 2.0 — Guild5 TEST synthetic Draft GS seed POSTCHECK
WITH checks AS (
  SELECT 10 AS check_order,'required_rpc'::text AS check_name,
    CASE WHEN to_regprocedure('public.teacher_prepare_guild5_test_guilds_for_month(text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object('rpc',to_regprocedure('public.teacher_prepare_guild5_test_guilds_for_month(text)')) AS detail
  UNION ALL
  SELECT 20,'rpc_grants',
    CASE WHEN
      NOT has_function_privilege('anon','public.teacher_prepare_guild5_test_guilds_for_month(text)','EXECUTE') AND
      has_function_privilege('authenticated','public.teacher_prepare_guild5_test_guilds_for_month(text)','EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'anon_execute',has_function_privilege('anon','public.teacher_prepare_guild5_test_guilds_for_month(text)','EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated','public.teacher_prepare_guild5_test_guilds_for_month(text)','EXECUTE')
    )
  UNION ALL
  SELECT 30,'current_seed_state','INFO',
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'year_month',e.year_month,'guild_id',e.guild_id,'guild_name',g.name,'points',e.points
      ) ORDER BY e.year_month DESC,e.points DESC)
      FROM public.guild2_gs_events e
      JOIN public.guilds g ON g.id=e.guild_id
      WHERE e.source_type='MANUAL_ADJUSTMENT'
        AND e.event_kind='POST'
        AND coalesce((e.metadata->>'g5_test_seed')::boolean,false)=true
        AND NOT EXISTS(SELECT 1 FROM public.guild2_gs_events r WHERE r.reversal_of=e.id AND r.event_kind='REVERSAL')
    ),'[]'::jsonb)
)
SELECT * FROM checks ORDER BY check_order;
