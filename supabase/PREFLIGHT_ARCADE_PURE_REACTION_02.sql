-- B.R.A.N.D 2.0 Game #02 — SQL Editor-safe preflight (read-only)
SELECT current_database() AS database_name, current_setting('server_version') AS postgres_version;

SELECT code,internal_name,is_active,available_from,available_until
FROM public.arcade_games
WHERE code IN('focus_reaction_01','pure_reaction_02')
ORDER BY id;

SELECT to_regprocedure('public.arcade_xorshift32_next(bigint)') AS xorshift32,
       to_regprocedure('public.arcade_capture_verification_attempt(bigint)') AS verification_capture,
       to_regprocedure('public.student_create_arcade_run(text)') AS create_run,
       to_regprocedure('public.student_begin_arcade_run(bigint)') AS begin_run,
       to_regprocedure('public.get_arcade_leaderboard(text,bigint)') AS leaderboard;

SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN('arcade_games','arcade_game_rule_versions','arcade_runs','arcade_run_submissions','arcade_verification_game_configs')
ORDER BY table_name,ordinal_position;

SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'arcade_%' OR n.nspname='public' AND p.proname LIKE 'student_%arcade%'
ORDER BY p.proname,args;
