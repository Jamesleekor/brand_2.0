-- B.R.A.N.D 2.0 — Arcade immediate-end POSTCHECK (SQL Editor safe)
WITH fn AS (
  SELECT to_regprocedure('public.teacher_end_arcade_ranking_period_now(bigint)') AS proc
), acl AS (
  SELECT
    has_function_privilege('anon', 'public.teacher_end_arcade_ranking_period_now(bigint)', 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', 'public.teacher_end_arcade_ranking_period_now(bigint)', 'EXECUTE') AS authenticated_exec
)
SELECT 10 AS check_order,
       'required_rpc'::text AS check_name,
       CASE WHEN fn.proc IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
       jsonb_build_object('end_now',fn.proc) AS detail
FROM fn
UNION ALL
SELECT 20,'rpc_grants',
       CASE WHEN NOT acl.anon_exec AND acl.authenticated_exec THEN 'PASS' ELSE 'FAIL' END,
       jsonb_build_object('anon',acl.anon_exec,'authenticated',acl.authenticated_exec)
FROM acl
UNION ALL
SELECT 30,'current_period_state','INFO',
       jsonb_build_object(
         'active_count',count(*) FILTER (WHERE status='ACTIVE'),
         'active_not_ended_count',count(*) FILTER (WHERE status='ACTIVE' AND ends_at_exclusive>clock_timestamp()),
         'ended_active_count',count(*) FILTER (WHERE status='ACTIVE' AND ends_at_exclusive<=clock_timestamp()),
         'finalized_count',count(*) FILTER (WHERE status='FINALIZED')
       )
FROM public.arcade_ranking_periods
ORDER BY check_order;
