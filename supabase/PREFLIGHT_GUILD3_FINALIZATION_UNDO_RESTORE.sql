-- Read-only preflight for Guild3 finalization undo / VOID restore.
WITH checks AS (
  SELECT 10 AS check_order, 'dependencies'::text AS check_name,
    CASE WHEN to_regclass('public.guild3_missions') IS NOT NULL
           AND to_regclass('public.guild3_peer_review_openings') IS NOT NULL
           AND to_regclass('public.guild4_peer_review_rounds') IS NOT NULL
           AND to_regprocedure('public.teacher_void_guild3_mission(bigint,text)') IS NOT NULL
           AND to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NOT NULL
         THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'guild3_missions', to_regclass('public.guild3_missions'),
      'guild3_openings', to_regclass('public.guild3_peer_review_openings'),
      'guild4_rounds', to_regclass('public.guild4_peer_review_rounds'),
      'void_rpc', to_regprocedure('public.teacher_void_guild3_mission(bigint,text)'),
      'guild2_refresh', to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)')
    ) AS detail
  UNION ALL
  SELECT 20, 'new_rpc_before_apply',
    CASE WHEN to_regprocedure('public.teacher_unfinalize_guild3_mission(bigint,text)') IS NULL
              AND to_regprocedure('public.teacher_restore_voided_guild3_mission(bigint,text)') IS NULL
         THEN 'PASS' ELSE 'INFO' END,
    jsonb_build_object(
      'unfinalize', to_regprocedure('public.teacher_unfinalize_guild3_mission(bigint,text)'),
      'restore_void', to_regprocedure('public.teacher_restore_voided_guild3_mission(bigint,text)')
    )
  UNION ALL
  SELECT 30, 'current_finalized_voided_state', 'INFO',
    jsonb_build_object(
      'finalized_missions', (SELECT count(*) FROM public.guild3_missions WHERE lifecycle_state='FINALIZED'),
      'voided_missions', (SELECT count(*) FROM public.guild3_missions WHERE lifecycle_state='VOIDED'),
      'finalized_without_g4_round', (
        SELECT count(*) FROM public.guild3_missions m
        WHERE m.lifecycle_state='FINALIZED'
          AND NOT EXISTS (SELECT 1 FROM public.guild4_peer_review_rounds r WHERE r.mission_id=m.id)
      ),
      'voided_without_g4_round_restorable', (
        SELECT count(*) FROM public.guild3_missions m
        WHERE m.lifecycle_state='VOIDED'
          AND NOT EXISTS (SELECT 1 FROM public.guild4_peer_review_rounds r WHERE r.mission_id=m.id)
      )
    )
  UNION ALL
  SELECT 40, 'voided_mission_candidates', 'INFO',
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'mission_id', m.id,
        'title', m.title,
        'year_month', m.contribution_year_month,
        'g4_round_count', (SELECT count(*) FROM public.guild4_peer_review_rounds r WHERE r.mission_id=m.id),
        'opening_count', (SELECT count(*) FROM public.guild3_peer_review_openings o WHERE o.mission_id=m.id)
      ) ORDER BY m.id DESC)
      FROM public.guild3_missions m
      WHERE m.lifecycle_state='VOIDED'
    ), '[]'::jsonb)
)
SELECT * FROM checks ORDER BY check_order;
