-- B.R.A.N.D 2.0 — Guild3 finalize/publish notification PRE-FLIGHT (READ ONLY)

SELECT 'guild3_missions table' AS check_name, to_regclass('public.guild3_missions') IS NOT NULL AS ok;
SELECT 'global_alerts table' AS check_name, to_regclass('public.global_alerts') IS NOT NULL AS ok;
SELECT 'finalize RPC' AS check_name, to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)') IS NOT NULL AS ok;
SELECT 'teacher alert RPC' AS check_name, to_regprocedure('public.teacher_broadcast_alert(integer,text,character varying,integer)') IS NOT NULL AS ok;

SELECT
  'old activity-deadline finalize blocker present' AS check_name,
  position('finalization is available after the personal activity-record deadline' in pg_get_functiondef(to_regprocedure('public.teacher_finalize_guild3_mission(bigint,text)'))) > 0 AS blocker_present;

SELECT
  'publish alert trigger already exists' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.guild3_missions'::regclass
      AND tgname='trg_guild3_mission_publish_alert'
      AND NOT tgisinternal
  ) AS already_exists;

SELECT
  'global_alerts realtime publication' AS check_name,
  CASE WHEN EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
       THEN EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='global_alerts')
       ELSE false END AS ok;

SELECT lifecycle_state, count(*) AS mission_count
FROM public.guild3_missions
GROUP BY lifecycle_state
ORDER BY lifecycle_state;
