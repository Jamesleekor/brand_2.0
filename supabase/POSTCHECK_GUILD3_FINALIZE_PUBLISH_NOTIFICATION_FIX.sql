-- B.R.A.N.D 2.0 — Guild3 finalize/publish notification POSTCHECK (READ ONLY)

SELECT
  'finalize RPC exists' AS check_name,
  to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)') IS NOT NULL AS ok;

SELECT
  'deadline blocker removed' AS check_name,
  position('finalization is available after the personal activity-record deadline' in pg_get_functiondef(to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)'))) = 0 AS ok;

SELECT
  'early-finalize audit flag installed' AS check_name,
  position('finalized_before_activity_deadline' in pg_get_functiondef(to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)'))) > 0 AS ok;

SELECT
  'publish alert trigger installed' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.guild3_missions'::regclass
      AND tgname='trg_guild3_mission_publish_alert'
      AND NOT tgisinternal
  ) AS ok;

SELECT
  'publish alert trigger function exists' AS check_name,
  to_regprocedure('public.guild3_emit_publish_alert()') IS NOT NULL AS ok;

SELECT
  'global_alerts realtime publication' AS check_name,
  CASE WHEN EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
       THEN EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='global_alerts')
       ELSE false END AS ok;

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema='public'
  AND routine_name='teacher_finalize_guild3_mission'
ORDER BY grantee, privilege_type;
