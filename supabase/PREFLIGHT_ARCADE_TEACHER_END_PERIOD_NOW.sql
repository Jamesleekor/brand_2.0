-- B.R.A.N.D 2.0 — Arcade immediate-end PRE-FLIGHT (read only)
WITH checks AS (
  SELECT 10 AS check_order,
         'dependencies'::text AS check_name,
         CASE WHEN
           to_regclass('public.arcade_ranking_periods') IS NOT NULL AND
           to_regprocedure('public.ensure_teacher_role()') IS NOT NULL AND
           to_regprocedure('public.current_classroom_id()') IS NOT NULL AND
           to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)') IS NOT NULL
         THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object(
           'periods',to_regclass('public.arcade_ranking_periods'),
           'teacher_role',to_regprocedure('public.ensure_teacher_role()'),
           'classroom',to_regprocedure('public.current_classroom_id()'),
           'finalize',to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)')
         ) AS detail
  UNION ALL
  SELECT 20,'new_rpc_before_apply',
         CASE WHEN to_regprocedure('public.teacher_end_arcade_ranking_period_now(bigint)') IS NULL THEN 'PASS' ELSE 'INFO' END,
         jsonb_build_object('end_now',to_regprocedure('public.teacher_end_arcade_ranking_period_now(bigint)'))
  UNION ALL
  SELECT 30,'active_period_candidates','INFO',
         jsonb_build_object(
           'active_count',count(*) FILTER (WHERE status='ACTIVE'),
           'active_not_ended_count',count(*) FILTER (WHERE status='ACTIVE' AND ends_at_exclusive>clock_timestamp()),
           'monthly_active_not_ended_count',count(*) FILTER (WHERE period_kind='MONTHLY' AND status='ACTIVE' AND ends_at_exclusive>clock_timestamp())
         )
  FROM public.arcade_ranking_periods
)
SELECT * FROM checks ORDER BY check_order;
