-- B.R.A.N.D 2.0 — Feature 4.1 stabilization post-check
-- Run AFTER 20260808_01_feature4_1_stabilization.sql.
-- Read-only verification. Does not mutate classroom/student data.

WITH checks AS (
  SELECT 'quest_request_table' AS check_name,
         (to_regclass('public.emergency_quest_requests') IS NOT NULL) AS ok
  UNION ALL SELECT 'quest_request_rpc',
         (to_regprocedure('public.request_emergency_quest_completion(integer,bigint)') IS NOT NULL)
  UNION ALL SELECT 'quest_review_rpc',
         (to_regprocedure('public.teacher_review_emergency_quest_request(bigint,boolean,text)') IS NOT NULL)
  UNION ALL SELECT 'student_direct_completion_revoked',
         NOT has_function_privilege('authenticated','public.complete_emergency_quest(integer,bigint)','EXECUTE')
  UNION ALL SELECT 'historical_attendance_edit_rpc',
         (to_regprocedure('public.teacher_correct_attendance(bigint,attendance_status,text)') IS NOT NULL)
  UNION ALL SELECT 'f41_health_rpc',
         (to_regprocedure('public.teacher_feature4_1_health_check()') IS NOT NULL)
  UNION ALL SELECT 'assignments_realtime',
         EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='assignments')
  UNION ALL SELECT 'quest_requests_realtime',
         EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='emergency_quest_requests')
)
SELECT check_name, ok, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY check_name;

-- pg_cron is optional at migration time. If enabled, this should return one row with schedule 59 14 * * *.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE NOTICE 'pg_cron enabled: verify brand_feature4_daily_records_2359_kst at 59 14 * * * (14:59 UTC = 23:59 KST).';
  ELSE
    RAISE NOTICE 'pg_cron is not enabled: automatic 23:59 KST records snapshot was not scheduled.';
  END IF;
END $$;
