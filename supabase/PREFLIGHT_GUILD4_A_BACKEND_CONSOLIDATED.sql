-- =============================================================================
-- B.R.A.N.D 2.0 — Guild4-A Backend PRE-FLIGHT (CONSOLIDATED / READ ONLY)
-- Baseline: Guild3 COMPLETE v13 / checkpoint 897bdd7
-- Purpose: Supabase SQL Editor may display only the final result set. This
-- version returns every important preflight check in ONE result table.
-- =============================================================================

WITH
helper_check AS (
  SELECT
    (to_regprocedure('public.ensure_teacher_role()') IS NOT NULL
     AND to_regprocedure('public.current_classroom_id()') IS NOT NULL
     AND to_regprocedure('public.current_student_id()') IS NOT NULL
     AND to_regprocedure('public.is_teacher_or_admin()') IS NOT NULL
     AND to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') IS NOT NULL
     AND to_regprocedure('public.reverse_transaction(bigint,text)') IS NOT NULL
     AND to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NOT NULL) AS ok,
    jsonb_build_object(
      'ensure_teacher_role',to_regprocedure('public.ensure_teacher_role()')::text,
      'current_classroom_id',to_regprocedure('public.current_classroom_id()')::text,
      'current_student_id',to_regprocedure('public.current_student_id()')::text,
      'is_teacher_or_admin',to_regprocedure('public.is_teacher_or_admin()')::text,
      'create_transaction',to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)')::text,
      'reverse_transaction',to_regprocedure('public.reverse_transaction(bigint,text)')::text,
      'guild2_refresh_monthly_scores',to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)')::text
    ) AS detail
),
table_check AS (
  SELECT
    (to_regclass('public.guild3_missions') IS NOT NULL
     AND to_regclass('public.guild3_mission_instances') IS NOT NULL
     AND to_regclass('public.guild3_mission_participants') IS NOT NULL
     AND to_regclass('public.guild3_peer_review_openings') IS NOT NULL
     AND to_regclass('public.wallets') IS NOT NULL
     AND to_regclass('public.transactions') IS NOT NULL
     AND to_regclass('public.guild2_individual_contributions') IS NOT NULL
     AND to_regclass('public.test_classroom_fixtures') IS NOT NULL) AS ok,
    jsonb_build_object(
      'guild3_missions',to_regclass('public.guild3_missions')::text,
      'guild3_mission_instances',to_regclass('public.guild3_mission_instances')::text,
      'guild3_mission_participants',to_regclass('public.guild3_mission_participants')::text,
      'guild3_peer_review_openings',to_regclass('public.guild3_peer_review_openings')::text,
      'wallets',to_regclass('public.wallets')::text,
      'transactions',to_regclass('public.transactions')::text,
      'guild2_individual_contributions',to_regclass('public.guild2_individual_contributions')::text,
      'test_classroom_fixtures',to_regclass('public.test_classroom_fixtures')::text
    ) AS detail
),
enum_check AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname='value_token_type' AND e.enumlabel='GOLD'
    )
    AND EXISTS (
      SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname='transaction_source_type' AND e.enumlabel='TEACHER_DEDUCT'
    ) AS ok,
    jsonb_build_object(
      'has_GOLD', EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND t.typname='value_token_type' AND e.enumlabel='GOLD'
      ),
      'has_TEACHER_DEDUCT', EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND t.typname='transaction_source_type' AND e.enumlabel='TEACHER_DEDUCT'
      )
    ) AS detail
),
invalid_openings AS (
  SELECT count(*)::int AS cnt
  FROM public.guild3_peer_review_openings o
  JOIN public.guild3_missions m ON m.id=o.mission_id
  JOIN public.guild3_mission_instances i ON i.id=o.mission_instance_id
  WHERE o.mission_id IS DISTINCT FROM i.mission_id
     OR o.classroom_id IS DISTINCT FROM m.classroom_id
     OR o.classroom_id IS DISTINCT FROM i.classroom_id
     OR o.guild_id IS DISTINCT FROM i.guild_id
     OR (o.opening_status='OPENABLE' AND (
          m.lifecycle_state<>'FINALIZED'
          OR m.peer_review_required IS DISTINCT FROM true
          OR m.finalized_at IS NULL
        ))
),
duplicate_participants AS (
  SELECT count(*)::int AS cnt
  FROM (
    SELECT mission_instance_id,student_id
    FROM public.guild3_mission_participants
    GROUP BY mission_instance_id,student_id
    HAVING count(*)>1
  ) d
),
source_summary AS (
  SELECT
    count(*)::int AS opening_count,
    count(*) FILTER (WHERE o.opening_status='OPENABLE')::int AS openable_count,
    count(*) FILTER (WHERE m.lifecycle_state='FINALIZED' AND m.peer_review_required=true AND o.opening_status='OPENABLE')::int AS valid_openable_count,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'opening_id',o.id,
        'mission_id',o.mission_id,
        'mission_instance_id',o.mission_instance_id,
        'guild_id',o.guild_id,
        'opening_status',o.opening_status,
        'mission_state',m.lifecycle_state,
        'peer_required',m.peer_review_required,
        'participant_count',(SELECT count(*) FROM public.guild3_mission_participants p WHERE p.mission_instance_id=o.mission_instance_id)
      ) ORDER BY o.id
    ),'[]'::jsonb) AS openings
  FROM public.guild3_peer_review_openings o
  JOIN public.guild3_missions m ON m.id=o.mission_id
),
g4_table_collision AS (
  SELECT
    num_nonnull(
      to_regclass('public.guild4_peer_review_rounds'),
      to_regclass('public.guild4_peer_review_participants'),
      to_regclass('public.guild4_peer_review_obligations'),
      to_regclass('public.guild4_peer_review_revisions'),
      to_regclass('public.guild4_peer_review_exception_events'),
      to_regclass('public.guild4_peer_review_penalties'),
      to_regclass('public.guild4_peer_review_score_rollups'),
      to_regclass('public.guild4_peer_review_audit_events')
    )::int AS cnt,
    jsonb_build_object(
      'rounds',to_regclass('public.guild4_peer_review_rounds')::text,
      'participants',to_regclass('public.guild4_peer_review_participants')::text,
      'obligations',to_regclass('public.guild4_peer_review_obligations')::text,
      'revisions',to_regclass('public.guild4_peer_review_revisions')::text,
      'exception_events',to_regclass('public.guild4_peer_review_exception_events')::text,
      'penalties',to_regclass('public.guild4_peer_review_penalties')::text,
      'score_rollups',to_regclass('public.guild4_peer_review_score_rollups')::text,
      'audit_events',to_regclass('public.guild4_peer_review_audit_events')::text
    ) AS detail
),
g4_function_collision AS (
  SELECT count(*)::int AS cnt,
         coalesce(jsonb_agg(jsonb_build_object('name',proname,'args',pg_get_function_identity_arguments(p.oid)) ORDER BY proname),'[]'::jsonb) AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND proname LIKE '%guild4%'
)
SELECT check_order,check_name,status,detail
FROM (
  SELECT 10 AS check_order,'required_helpers'::text AS check_name,CASE WHEN h.ok THEN 'PASS' ELSE 'FAIL' END AS status,h.detail FROM helper_check h
  UNION ALL
  SELECT 20,'required_source_tables',CASE WHEN t.ok THEN 'PASS' ELSE 'FAIL' END,t.detail FROM table_check t
  UNION ALL
  SELECT 30,'required_economy_enums',CASE WHEN e.ok THEN 'PASS' ELSE 'FAIL' END,e.detail FROM enum_check e
  UNION ALL
  SELECT 40,'invalid_guild3_opening_contract',CASE WHEN i.cnt=0 THEN 'PASS' ELSE 'FAIL' END,jsonb_build_object('invalid_count',i.cnt) FROM invalid_openings i
  UNION ALL
  SELECT 50,'duplicate_guild3_participants',CASE WHEN d.cnt=0 THEN 'PASS' ELSE 'FAIL' END,jsonb_build_object('duplicate_groups',d.cnt) FROM duplicate_participants d
  UNION ALL
  SELECT 60,'guild3_peer_opening_source','INFO',jsonb_build_object('opening_count',s.opening_count,'openable_count',s.openable_count,'valid_openable_count',s.valid_openable_count,'openings',s.openings) FROM source_summary s
  UNION ALL
  SELECT 70,'existing_guild4_tables_before_first_apply',CASE WHEN c.cnt=0 THEN 'PASS' ELSE 'FAIL' END,jsonb_build_object('existing_count',c.cnt,'objects',c.detail) FROM g4_table_collision c
  UNION ALL
  SELECT 80,'existing_guild4_functions_before_first_apply',CASE WHEN f.cnt=0 THEN 'PASS' ELSE 'FAIL' END,jsonb_build_object('existing_count',f.cnt,'functions',f.detail) FROM g4_function_collision f
) q
ORDER BY check_order;
