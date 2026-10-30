-- =============================================================================
-- POSTCHECK (SQL-Editor safe, no auth-context RPC calls, no data writes)
-- after applying 20261030_10..13. Every row must say OK.
-- Then compare the fingerprint query at the bottom with the PREFLIGHT output:
-- all six md5 values must be identical (existing records untouched).
-- =============================================================================
SELECT 'engine/replay functions present (19)' AS item,
  CASE WHEN (SELECT count(*) FROM pg_proc WHERE proname LIKE 'arcade_starlink_04_%')>=19 THEN 'OK' ELSE 'FAIL' END AS result
UNION ALL SELECT 'internal helpers closed to students',
  CASE WHEN NOT has_function_privilege('authenticated','public.arcade_starlink_04_replay(bigint,jsonb,integer)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.arcade_starlink_04_ensure_seed_pack(integer,bigint)','EXECUTE')
        AND NOT has_function_privilege('authenticated','public.arcade_force_finalize_session_plan(integer,bigint)','EXECUTE')
        AND NOT has_function_privilege('anon','public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer)','EXECUTE')
        AND NOT has_function_privilege('anon','public.teacher_force_finalize_arcade_period(bigint,text,boolean)','EXECUTE')
  THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'student/teacher RPCs open to authenticated',
  CASE WHEN has_function_privilege('authenticated','public.student_begin_starlink_04_run(bigint)','EXECUTE')
        AND has_function_privilege('authenticated','public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer)','EXECUTE')
        AND has_function_privilege('authenticated','public.teacher_get_arcade_force_finalize_preview(bigint)','EXECUTE')
        AND has_function_privilege('authenticated','public.teacher_force_finalize_arcade_period(bigint,text,boolean)','EXECUTE')
        AND has_function_privilege('authenticated','public.teacher_force_finalize_arcade_month_for_guild5(text,text)','EXECUTE')
  THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'seed tables RLS on, no student grants',
  CASE WHEN (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('arcade_starlink_04_seed_packs','arcade_starlink_04_seed_pack_slots','arcade_starlink_04_seed_orders','arcade_starlink_04_run_bindings'))
        AND NOT has_table_privilege('authenticated','public.arcade_starlink_04_run_bindings','SELECT')
        AND NOT has_table_privilege('authenticated','public.arcade_starlink_04_seed_pack_slots','SELECT')
  THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'binding trigger installed on arcade_runs',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='arcade_starlink_04_bind_on_playing' AND NOT tgisinternal) THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'starlink registered HIDDEN (available_from 2099-12-31, verification enabled 80%/3/Top10)',
  CASE WHEN EXISTS (SELECT 1 FROM public.arcade_games g JOIN public.arcade_verification_game_configs c ON c.game_id=g.id
                    JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id AND rv.is_active
                    WHERE g.code='starlink_04' AND g.is_active AND g.available_from=DATE '2099-12-31'
                      AND c.is_enabled AND c.threshold_percent=80 AND c.max_attempts=3 AND c.target_rank_count=10
                      AND rv.config->>'game_code'='starlink_04' AND (rv.config->>'countdown_ms')::int=5000)
  THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'GAME1/GAME2 untouched (still active, verification enabled)',
  CASE WHEN (SELECT count(*) FROM public.arcade_games g JOIN public.arcade_verification_game_configs c ON c.game_id=g.id
             WHERE g.code IN ('focus_reaction_01','pure_reaction_02') AND g.is_active AND c.is_enabled)=2 THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'server replay golden: seed 6059 → 457',
  CASE WHEN (public.arcade_starlink_04_replay(6059,'[{"type":"PATH_START","elapsed_ms":100,"cell":22},{"type":"CELL_ENTER","elapsed_ms":150,"cell":29},{"type":"CELL_ENTER","elapsed_ms":200,"cell":30},{"type":"CELL_ENTER","elapsed_ms":220,"cell":36},{"type":"PATH_RELEASE","elapsed_ms":250},{"type":"PATH_START","elapsed_ms":450,"cell":3},{"type":"CELL_ENTER","elapsed_ms":470,"cell":9},{"type":"CELL_ENTER","elapsed_ms":490,"cell":10},{"type":"PATH_RELEASE","elapsed_ms":500}]'::jsonb,60000)->>'official_score')::int=457
  THEN 'OK' ELSE 'FAIL' END
UNION ALL SELECT 'no starlink runs yet (expected before pre-release testing)',
  CASE WHEN (SELECT count(*) FROM public.arcade_runs r JOIN public.arcade_games g ON g.id=r.game_id WHERE g.code='starlink_04')=0 THEN 'OK' ELSE 'INFO (test runs exist)' END
UNION ALL SELECT 'guild5 wrapper now delegates',
  CASE WHEN pg_get_functiondef('public.teacher_force_finalize_arcade_month_for_guild5(text,text)'::regprocedure) LIKE '%teacher_force_finalize_arcade_period%' THEN 'OK' ELSE 'FAIL' END;

-- Data fingerprint AFTER (must equal PREFLIGHT output).
SELECT
 (SELECT md5(string_agg(id||':'||status||':'||coalesce(official_score::text,'-'),',' ORDER BY id)) FROM public.arcade_runs) AS runs_md5,
 (SELECT md5(string_agg(id||':'||period_id||':'||game_id||':'||student_id||':'||decision_kind||':'||coalesce(source_run_id::text,'-')||':'||coalesce(official_score::text,'-'),',' ORDER BY id)) FROM public.arcade_verification_official_results) AS official_md5,
 (SELECT md5(string_agg(e.id||':'||e.snapshot_id||':'||e.student_id||':'||e.rank||':'||e.official_score,',' ORDER BY e.id)) FROM public.arcade_monthly_snapshot_entries e) AS snapshot_entries_md5,
 (SELECT md5(string_agg(id||':'||status,',' ORDER BY id)) FROM public.arcade_verification_sessions) AS sessions_md5,
 (SELECT md5(string_agg(id||':'||status||':'||points,',' ORDER BY id)) FROM public.tikatuka_official_sessions) AS tikatuka_sessions_md5,
 (SELECT md5(string_agg(id||':'||status,',' ORDER BY id)) FROM public.arcade_ranking_periods) AS periods_md5;
