-- Read-only postcheck for Guild3 finalization undo / VOID restore.
WITH checks AS (
  SELECT 10 AS check_order, 'required_rpcs'::text AS check_name,
    CASE WHEN to_regprocedure('public.teacher_unfinalize_guild3_mission(bigint,text)') IS NOT NULL
              AND to_regprocedure('public.teacher_restore_voided_guild3_mission(bigint,text)') IS NOT NULL
         THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object(
      'unfinalize', to_regprocedure('public.teacher_unfinalize_guild3_mission(bigint,text)'),
      'restore_void', to_regprocedure('public.teacher_restore_voided_guild3_mission(bigint,text)')
    ) AS detail
  UNION ALL
  SELECT 20, 'rpc_grants',
    CASE WHEN has_function_privilege('authenticated','public.teacher_unfinalize_guild3_mission(bigint,text)','EXECUTE')
              AND has_function_privilege('authenticated','public.teacher_restore_voided_guild3_mission(bigint,text)','EXECUTE')
              AND NOT has_function_privilege('anon','public.teacher_unfinalize_guild3_mission(bigint,text)','EXECUTE')
              AND NOT has_function_privilege('anon','public.teacher_restore_voided_guild3_mission(bigint,text)','EXECUTE')
         THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'authenticated_unfinalize', has_function_privilege('authenticated','public.teacher_unfinalize_guild3_mission(bigint,text)','EXECUTE'),
      'authenticated_restore_void', has_function_privilege('authenticated','public.teacher_restore_voided_guild3_mission(bigint,text)','EXECUTE'),
      'anon_unfinalize', has_function_privilege('anon','public.teacher_unfinalize_guild3_mission(bigint,text)','EXECUTE'),
      'anon_restore_void', has_function_privilege('anon','public.teacher_restore_voided_guild3_mission(bigint,text)','EXECUTE')
    )
  UNION ALL
  SELECT 30, 'current_recovery_candidates', 'INFO',
    jsonb_build_object(
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
)
SELECT * FROM checks ORDER BY check_order;
