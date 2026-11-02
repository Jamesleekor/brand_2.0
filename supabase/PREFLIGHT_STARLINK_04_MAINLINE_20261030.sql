-- =============================================================================
-- PREFLIGHT (READ-ONLY) — run in Supabase SQL Editor right before applying
-- 20261030_10 .. 20261030_13. SELECT only. Every row must say OK.
-- If any row says STOP, do not apply: production changed since 2026-10-30 and
-- the migrations must be re-reviewed against the new definitions.
-- =============================================================================
WITH expected(sig, md5) AS (VALUES
  ('student_create_arcade_run(p_game_code text)','e73cd5430569680c5e22b07010dcd294'),
  ('student_begin_arcade_run(p_run_id bigint)','448299e94f3db87a9611ec6c201e0d55'),
  ('student_create_arcade_verification_run(p_session_id bigint, p_idempotency_key uuid)','4194864d7a318aaec9c5a2beee1e87bd'),
  ('arcade_capture_verification_attempt(p_run_id bigint)','1410cae607bf5aa8c636f19dbfea4985'),
  ('arcade_finalize_verification_session(p_session_id bigint)','131500c2d6c5cf362d070061f513e1d3'),
  ('arcade_refresh_verification_readiness(p_classroom_id integer, p_period_id bigint)','14e07fba3d37f34e341e886efd98b748'),
  ('arcade_resolve_period_student_ranks(p_classroom_id integer, p_period_id bigint, p_game_id bigint)','56a9fe1743efe9c9651ffe9fc9c00598'),
  ('teacher_freeze_arcade_monthly_period(p_period_id bigint)','d27115ffa39726bee561e4f1f0793149'),
  ('teacher_force_close_arcade_game_verification(p_period_id bigint, p_game_code text, p_reason text)','e228d42887b910c9eed790581755395f'),
  ('teacher_finalize_arcade_monthly_snapshot(p_period_id bigint)','cd45f68dba4dd945c7be9e91d023b453'),
  ('teacher_force_finalize_arcade_month_for_guild5(p_year_month text, p_reason text)','a300ffbb6a4383ac31b44bdb6278ef60'),
  ('teacher_end_arcade_ranking_period_now(p_period_id bigint)','a147af45cc41d486f95480d7e6b2c876'),
  ('teacher_cancel_arcade_verification_run(p_run_id bigint, p_reason text)','44d04d76dfd268e0dde13d3dd58be530'),
  ('arcade_generate_run_seed()','2ef00c0bb4d2ddf0d77be3e4a59a7d68'),
  ('arcade_xorshift32_next(p_state bigint)','06d533833df63244430e3cda49eb113a')
), live AS (
  SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(pg_get_functiondef(p.oid)) AS md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
)
SELECT 'function '||e.sig AS item, CASE WHEN l.md5=e.md5 THEN 'OK' WHEN l.md5 IS NULL THEN 'STOP (missing)' ELSE 'STOP (changed: '||l.md5||')' END AS result
FROM expected e LEFT JOIN live l ON l.sig=e.sig
UNION ALL
SELECT 'starlink objects not yet present',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'arcade_starlink_04_%' OR proname IN ('teacher_force_finalize_arcade_period','teacher_get_arcade_force_finalize_preview'))
        AND to_regclass('public.arcade_starlink_04_run_bindings') IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.arcade_games WHERE code='starlink_04')
  THEN 'OK' ELSE 'CHECK (already partially applied — compare with POSTCHECK before continuing)' END
UNION ALL
SELECT 'tikatuka CANCELLED status allowed',
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tikatuka_official_session_status_check' AND pg_get_constraintdef(oid) LIKE '%CANCELLED%') THEN 'OK' ELSE 'STOP' END
UNION ALL
SELECT 'arcade_runs.schedule_seed exists',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='schedule_seed') THEN 'OK' ELSE 'STOP' END
UNION ALL
SELECT 'no verification run in PLAYING right now (apply during a quiet moment)',
  CASE WHEN (SELECT count(*) FROM public.arcade_runs WHERE run_context='VERIFICATION' AND status='PLAYING')=0 THEN 'OK' ELSE 'WAIT (a student is mid verification)' END;

-- Data fingerprint BEFORE (save the output; POSTCHECK must reproduce it exactly).
SELECT
 (SELECT md5(string_agg(id||':'||status||':'||coalesce(official_score::text,'-'),',' ORDER BY id)) FROM public.arcade_runs) AS runs_md5,
 (SELECT md5(string_agg(id||':'||period_id||':'||game_id||':'||student_id||':'||decision_kind||':'||coalesce(source_run_id::text,'-')||':'||coalesce(official_score::text,'-'),',' ORDER BY id)) FROM public.arcade_verification_official_results) AS official_md5,
 (SELECT md5(string_agg(e.id||':'||e.snapshot_id||':'||e.student_id||':'||e.rank||':'||e.official_score,',' ORDER BY e.id)) FROM public.arcade_monthly_snapshot_entries e) AS snapshot_entries_md5,
 (SELECT md5(string_agg(id||':'||status,',' ORDER BY id)) FROM public.arcade_verification_sessions) AS sessions_md5,
 (SELECT md5(string_agg(id||':'||status||':'||points,',' ORDER BY id)) FROM public.tikatuka_official_sessions) AS tikatuka_sessions_md5,
 (SELECT md5(string_agg(id||':'||status,',' ORDER BY id)) FROM public.arcade_ranking_periods) AS periods_md5;
