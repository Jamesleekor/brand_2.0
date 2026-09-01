-- =============================================================================
-- B.R.A.N.D 2.0 — Guild4-A3 Monthly Peer Adapter PRE-FLIGHT (READ ONLY)
-- 2026-08-16
-- Run before APPLY_GUILD4_A3_MONTHLY_ADAPTER.sql
-- =============================================================================

WITH checks AS (
  SELECT 10 AS check_order,'g4_a1_a2_dependencies'::text AS check_name,
    CASE WHEN
      to_regclass('public.guild4_peer_review_rounds') IS NOT NULL AND
      to_regclass('public.guild4_peer_review_score_rollups') IS NOT NULL AND
      to_regprocedure('public.guild4_calculate_peer_review_round_scores(bigint)') IS NOT NULL AND
      to_regprocedure('public.guild4_evaluate_peer_review_penalties(bigint)') IS NOT NULL AND
      to_regprocedure('public.teacher_finalize_guild4_peer_review_round(bigint,text)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'rounds',to_regclass('public.guild4_peer_review_rounds'),
      'score_rollups',to_regclass('public.guild4_peer_review_score_rollups'),
      'score_helper',to_regprocedure('public.guild4_calculate_peer_review_round_scores(bigint)'),
      'penalty_helper',to_regprocedure('public.guild4_evaluate_peer_review_penalties(bigint)'),
      'finalize',to_regprocedure('public.teacher_finalize_guild4_peer_review_round(bigint,text)')
    ) AS detail

  UNION ALL
  SELECT 20,'guild2_dependencies',
    CASE WHEN
      to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NOT NULL AND
      to_regclass('public.guild2_individual_contributions') IS NOT NULL AND
      to_regprocedure('public.guild2_refresh_monthly_gs_summary(integer,text,integer)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'refresh',to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)'),
      'contributions',to_regclass('public.guild2_individual_contributions'),
      'summary_refresh',to_regprocedure('public.guild2_refresh_monthly_gs_summary(integer,text,integer)')
    )

  UNION ALL
  SELECT 30,'a3_current_state',
    CASE WHEN
      to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)') IS NULL AND
      to_regprocedure('public.guild4_peer_component_rollup(integer,integer,text)') IS NULL AND
      to_regprocedure('public.student_get_guild4_peer_monthly_summary()') IS NULL AND
      to_regprocedure('public.teacher_correct_guild4_peer_review(bigint,integer,text,text)') IS NULL AND
      to_regprocedure('public.teacher_correct_guild4_peer_review_exception(bigint,boolean,text)') IS NULL
    THEN 'PASS' ELSE 'INFO' END,
    jsonb_build_object(
      'readiness',to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)'),
      'rollup',to_regprocedure('public.guild4_peer_component_rollup(integer,integer,text)'),
      'student_monthly',to_regprocedure('public.student_get_guild4_peer_monthly_summary()'),
      'correct_review',to_regprocedure('public.teacher_correct_guild4_peer_review(bigint,integer,text,text)'),
      'correct_exception',to_regprocedure('public.teacher_correct_guild4_peer_review_exception(bigint,boolean,text)')
    )

  UNION ALL
  SELECT 40,'guild2_peer_adapter_before_apply','INFO',
    jsonb_build_object(
      'uses_guild4_peer_component_rollup',
      CASE WHEN to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL THEN false
           ELSE position('guild4_peer_component_rollup' in pg_get_functiondef(to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)'))) > 0 END,
      'aggregation','GUILD3_MISSION_WEIGHTED_AVERAGE'
    )

  UNION ALL
  SELECT 50,'source_state','INFO',
    jsonb_build_object(
      'openable_guild3_sources',(SELECT count(*) FROM public.guild3_peer_review_openings WHERE opening_status='OPENABLE'),
      'guild4_rounds',(SELECT count(*) FROM public.guild4_peer_review_rounds),
      'finalized_guild4_rounds',(SELECT count(*) FROM public.guild4_peer_review_rounds WHERE lifecycle_state='FINALIZED')
    )
)
SELECT check_order,check_name,status,detail FROM checks ORDER BY check_order;
