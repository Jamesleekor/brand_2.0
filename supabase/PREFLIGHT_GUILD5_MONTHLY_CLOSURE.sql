-- B.R.A.N.D 2.0 Guild5 — consolidated read-only preflight
WITH checks AS (
  SELECT 10 AS check_order, 'required_helpers'::text AS check_name,
    CASE WHEN
      to_regprocedure('public.ensure_teacher_role()') IS NOT NULL AND
      to_regprocedure('public.current_classroom_id()') IS NOT NULL AND
      to_regprocedure('public.current_student_id()') IS NOT NULL AND
      to_regprocedure('public.guild2_resolve_season_for_month(integer,text)') IS NOT NULL AND
      to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NOT NULL AND
      to_regprocedure('public.guild3_mission_month_is_ready(integer,integer,text)') IS NOT NULL AND
      to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)') IS NOT NULL AND
      to_regprocedure('public.arcade_monthly_finalization_is_complete(integer,text)') IS NOT NULL AND
      to_regprocedure('public.teacher_create_guild(text,text,text,text,boolean)') IS NOT NULL AND
      to_regprocedure('public.guild3_write_audit_event(bigint,bigint,bigint,integer,text,text,jsonb,jsonb)') IS NOT NULL AND
      to_regprocedure('public.teacher_reset_test_classroom_fixture()') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'guild2_refresh',to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)'),
      'guild3_ready',to_regprocedure('public.guild3_mission_month_is_ready(integer,integer,text)'),
      'guild4_ready',to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)'),
      'arcade_ready',to_regprocedure('public.arcade_monthly_finalization_is_complete(integer,text)'),
      'teacher_create_guild',to_regprocedure('public.teacher_create_guild(text,text,text,text,boolean)'),
      'guild3_audit',to_regprocedure('public.guild3_write_audit_event(bigint,bigint,bigint,integer,text,text,jsonb,jsonb)'),
      'test_reset',to_regprocedure('public.teacher_reset_test_classroom_fixture()')
    ) AS detail
  UNION ALL
  SELECT 20,'required_source_tables',
    CASE WHEN
      to_regclass('public.guild2_individual_contributions') IS NOT NULL AND
      to_regclass('public.guild2_monthly_gs_summaries') IS NOT NULL AND
      to_regclass('public.guild2_compensation_configs') IS NOT NULL AND
      to_regclass('public.guild3_missions') IS NOT NULL AND
      to_regclass('public.guild3_mission_instances') IS NOT NULL AND
      to_regclass('public.guild3_mission_participants') IS NOT NULL AND
      to_regclass('public.guild3_mission_submissions') IS NOT NULL AND
      to_regclass('public.guild3_mission_activity_records') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_rounds') IS NOT NULL AND
      to_regclass('public.wallets') IS NOT NULL AND
      to_regclass('public.guilds') IS NOT NULL AND
      to_regclass('public.guild_seasons') IS NOT NULL AND
      to_regclass('public.test_classroom_fixtures') IS NOT NULL AND
      to_regclass('public.hall_of_fame_entries') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'guild2_contributions',to_regclass('public.guild2_individual_contributions'),
      'guild2_summaries',to_regclass('public.guild2_monthly_gs_summaries'),
      'guild3_missions',to_regclass('public.guild3_missions'),
      'guild4_rounds',to_regclass('public.guild4_peer_review_rounds'),
      'wallets',to_regclass('public.wallets'),
      'test_fixture',to_regclass('public.test_classroom_fixtures'),
      'hall_of_fame_optional',to_regclass('public.hall_of_fame_entries')
    )
  UNION ALL
  SELECT 30,'guild5_objects_before_first_apply',
    CASE WHEN (
      (CASE WHEN to_regclass('public.guild5_month_closures') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_closure_versions') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_student_snapshots') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_guild_snapshots') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_territories') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_conquest_turns') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_audit_events') IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN to_regclass('public.guild5_season_locks') IS NOT NULL THEN 1 ELSE 0 END)
    )=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'month_closures',to_regclass('public.guild5_month_closures'),
      'versions',to_regclass('public.guild5_closure_versions'),
      'student_snapshots',to_regclass('public.guild5_student_snapshots'),
      'guild_snapshots',to_regclass('public.guild5_guild_snapshots'),
      'territories',to_regclass('public.guild5_territories'),
      'conquest_turns',to_regclass('public.guild5_conquest_turns'),
      'audit',to_regclass('public.guild5_audit_events'),
      'season_locks',to_regclass('public.guild5_season_locks')
    )
  UNION ALL
  SELECT 40,'guild5_functions_before_first_apply',
    CASE WHEN NOT EXISTS(
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.proname LIKE 'guild5_%' OR p.proname LIKE 'teacher_%guild5%' OR p.proname LIKE 'student_%guild5%')
    ) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('existing',coalesce((
      SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.proname LIKE 'guild5_%' OR p.proname LIKE 'teacher_%guild5%' OR p.proname LIKE 'student_%guild5%')
    ),'[]'::jsonb))
  UNION ALL
  SELECT 50,'source_month_state','INFO',
    jsonb_build_object(
      'monthly_summary_scopes',coalesce((SELECT jsonb_agg(x ORDER BY x.classroom_id,x.season_id,x.year_month) FROM (
        SELECT classroom_id,season_id,year_month,count(*) AS guild_summary_count,
               sum(scoring_roster_count) AS roster_count,sum(draft_gs_total) AS total_draft_gs
        FROM public.guild2_monthly_gs_summaries GROUP BY classroom_id,season_id,year_month ORDER BY year_month DESC LIMIT 12
      ) x),'[]'::jsonb),
      'contribution_scopes',coalesce((SELECT jsonb_agg(x ORDER BY x.classroom_id,x.season_id,x.year_month) FROM (
        SELECT classroom_id,season_id,year_month,count(*) AS contribution_count,
               count(*) FILTER(WHERE guild_context_status<>'RESOLVED') AS unresolved_count
        FROM public.guild2_individual_contributions GROUP BY classroom_id,season_id,year_month ORDER BY year_month DESC LIMIT 12
      ) x),'[]'::jsonb)
    )
  UNION ALL
  SELECT 60,'active_guild_state','INFO',
    jsonb_build_object('scopes',coalesce((SELECT jsonb_agg(x ORDER BY x.classroom_id,x.season_id) FROM (
      SELECT g.classroom_id,g.season_id,count(*) AS active_guild_count,
             count(*) FILTER(WHERE NOT EXISTS(
               SELECT 1 FROM public.guild_members gm JOIN public.students s ON s.id=gm.student_id
               WHERE gm.guild_id=g.id AND gm.left_at IS NULL AND s.transferred_at IS NULL
                 AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
             )) AS empty_active_guild_count
      FROM public.guilds g WHERE coalesce(g.is_active,true) GROUP BY g.classroom_id,g.season_id
    ) x),'[]'::jsonb))
  UNION ALL
  SELECT 70,'test_fixture_state','INFO',
    jsonb_build_object('fixtures',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'fixture_code',f.fixture_code,'classroom_id',f.classroom_id,'season_id',f.season_id,
      'active_guild_count',(SELECT count(*) FROM public.guilds g WHERE g.classroom_id=f.classroom_id AND g.season_id=f.season_id AND coalesce(g.is_active,true))
    )) FROM public.test_classroom_fixtures f WHERE f.fixture_code='BRAND_TEST_V1'),'[]'::jsonb))
)
SELECT check_order,check_name,status,detail FROM checks ORDER BY check_order;
