-- =============================================================================
-- B.R.A.N.D 2.0 TEST classroom fixture — production read-only preflight
--
-- Purpose
--   Inspect the actual production contracts before adding a TEST-only classroom,
--   five real student accounts, and a tightly scoped reset operation.
--
-- Safety
--   Read-only catalog and count inspection only.
--   No DDL, DML, auth user creation, password change, or RPC call is performed.
--   Run the whole file once in Supabase SQL Editor. It returns every section in
--   one result table, so the editor does not hide earlier results.
-- =============================================================================

WITH classroom_scoped_relations AS (
  SELECT namespace.nspname AS schema_name,
         relation.relname AS relation_name,
         relation.oid AS relation_oid,
         relation.relkind AS relation_kind,
         relation.relrowsecurity AS rls_enabled,
         relation.relforcerowsecurity AS rls_forced,
         obj_description(relation.oid, 'pg_class') AS comment
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p', 'v', 'm')
    AND (
      EXISTS (
        SELECT 1
        FROM pg_attribute attribute
        WHERE attribute.attrelid = relation.oid
          AND attribute.attname = 'classroom_id'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      )
      OR relation.relname IN (
        'classrooms', 'students', 'guilds', 'guild_seasons', 'guild_members',
        'guild_membership_events', 'guild_session_participants',
        'guild3_missions', 'guild3_mission_instances', 'guild3_mission_participants',
        'guild3_mission_submissions', 'guild3_mission_activity_records',
        'guild3_mission_grade_events', 'guild3_mission_judgment_events',
        'guild3_mission_audit_events', 'guild3_peer_review_openings',
        'guild2_individual_contributions', 'guild2_gs_events', 'guild2_monthly_gs_summaries',
        'guild2_observation_events', 'guild2_compensation_configs',
        'arcade_runs', 'arcade_run_submissions', 'arcade_run_moderation_events',
        'arcade_ranking_periods', 'arcade_monthly_finalizations',
        'arcade_monthly_snapshots', 'arcade_monthly_snapshot_entries',
        'arcade_monthly_snapshot_student_ranks', 'arcade_prerelease_test_access'
      )
    )
), classroom_rows AS (
  SELECT to_jsonb(classroom_row) AS classroom_json
  FROM public.classrooms classroom_row
), test_classroom_candidates AS (
  SELECT classroom_json
  FROM classroom_rows
  WHERE classroom_json ->> 'name' = 'B.R.A.N.D TEST'
     OR classroom_json ->> 'display_name' = 'B.R.A.N.D TEST'
     OR classroom_json ->> 'code' = 'BRAND_TEST'
), student_rows AS (
  SELECT to_jsonb(student_row) AS student_json
  FROM public.students student_row
), report AS (
  SELECT 1 AS section_no,
         'Classroom and student contracts'::text AS section_name,
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.ordinal_position)
           FROM (
             SELECT column_data.table_name AS relation_name,
                    column_data.ordinal_position,
                    column_data.column_name,
                    column_data.data_type,
                    column_data.udt_schema,
                    column_data.udt_name,
                    column_data.is_nullable,
                    column_data.column_default
             FROM information_schema.columns column_data
             WHERE column_data.table_schema = 'public'
               AND column_data.table_name IN ('classrooms', 'students', 'guilds', 'guild_seasons', 'guild_members')
           ) row_data
         ), '[]'::jsonb) AS result_json
  UNION ALL
  SELECT 2,
         'Potentially resettable classroom-scoped relations',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
           FROM (
             SELECT relation_name, relation_kind, rls_enabled, rls_forced, comment
             FROM classroom_scoped_relations
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 3,
         'Constraints and indexes for fixture identity tables',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.constraint_name)
           FROM (
             SELECT class_relation.relname AS table_name,
                    constraint_data.conname AS constraint_name,
                    constraint_data.contype AS constraint_type,
                    pg_get_constraintdef(constraint_data.oid, true) AS definition
             FROM pg_constraint constraint_data
             JOIN pg_class class_relation ON class_relation.oid = constraint_data.conrelid
             JOIN pg_namespace namespace ON namespace.oid = class_relation.relnamespace
             WHERE namespace.nspname = 'public'
               AND class_relation.relname IN ('classrooms', 'students', 'guilds', 'guild_seasons', 'guild_members')
             UNION ALL
             SELECT index_relation.relname AS table_name,
                    index_relation.relname AS constraint_name,
                    'INDEX' AS constraint_type,
                    pg_get_indexdef(index_data.indexrelid) AS definition
             FROM pg_index index_data
             JOIN pg_class table_relation ON table_relation.oid = index_data.indrelid
             JOIN pg_class index_relation ON index_relation.oid = index_data.indexrelid
             JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
             WHERE namespace.nspname = 'public'
               AND table_relation.relname IN ('classrooms', 'students', 'guilds', 'guild_seasons', 'guild_members')
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 4,
         'RLS policies and relation grants',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.policy_or_grant, row_data.subject)
           FROM (
             SELECT policy_data.tablename AS relation_name,
                    'POLICY' AS entry_kind,
                    policy_data.policyname AS policy_or_grant,
                    array_to_string(policy_data.roles, ',') AS subject,
                    jsonb_build_object(
                      'command', policy_data.cmd,
                      'using_expression', policy_data.qual,
                      'with_check_expression', policy_data.with_check
                    ) AS detail
             FROM pg_policies policy_data
             JOIN classroom_scoped_relations relation
               ON relation.schema_name = policy_data.schemaname
              AND relation.relation_name = policy_data.tablename
             UNION ALL
             SELECT grant_data.table_name AS relation_name,
                    'GRANT' AS entry_kind,
                    grant_data.privilege_type AS policy_or_grant,
                    grant_data.grantee AS subject,
                    jsonb_build_object('is_grantable', grant_data.is_grantable) AS detail
             FROM information_schema.role_table_grants grant_data
             JOIN classroom_scoped_relations relation
               ON relation.schema_name = grant_data.table_schema
              AND relation.relation_name = grant_data.table_name
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 5,
         'Identity, classroom-scope, and auth-link functions',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.function_name, row_data.identity_arguments)
           FROM (
             SELECT procedure_data.oid::text AS function_oid,
                    procedure_data.proname AS function_name,
                    pg_get_function_identity_arguments(procedure_data.oid) AS identity_arguments,
                    procedure_data.prosecdef AS security_definer,
                    procedure_data.proconfig AS function_config,
                    pg_get_functiondef(procedure_data.oid) AS complete_definition
             FROM pg_proc procedure_data
             JOIN pg_namespace namespace ON namespace.oid = procedure_data.pronamespace
             WHERE namespace.nspname = 'public'
               AND procedure_data.prokind IN ('f', 'p')
               AND procedure_data.proname ILIKE ANY (ARRAY[
                 '%current%classroom%', '%current%student%', '%user%context%',
                 '%teacher%role%', '%teacher%admin%', '%classroom%member%',
                 '%link%student%auth%', '%auth%user%', '%create%student%'
               ])
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 6,
         'Auth link health and existing TEST-like fixture candidates',
         jsonb_build_array(
           jsonb_build_object(
             'test_classroom_candidates', coalesce((
               SELECT jsonb_agg(classroom_json ORDER BY classroom_json ->> 'id')
               FROM test_classroom_candidates
             ), '[]'::jsonb)
           ),
           jsonb_build_object(
             'test_like_students', coalesce((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'student_id', student_json ->> 'id',
                   'classroom_id', student_json ->> 'classroom_id',
                   'name', student_json ->> 'name',
                   'brand_name', student_json ->> 'brand_name',
                   'role', student_json ->> 'role',
                   'has_user_id', nullif(student_json ->> 'user_id', '') IS NOT NULL
                 )
                 ORDER BY student_json ->> 'classroom_id', student_json ->> 'name'
               )
               FROM student_rows
               WHERE student_json ->> 'role' = 'TEST'
                  OR student_json ->> 'name' ~* '^TEST0[1-5]$'
                  OR student_json ->> 'brand_name' ~* '^TEST0[1-5]$'
             ), '[]'::jsonb)
           ),
           jsonb_build_object(
             'students_with_auth_user_id', (
               SELECT count(*) FROM student_rows WHERE nullif(student_json ->> 'user_id', '') IS NOT NULL
             ),
             'students_without_auth_user_id', (
               SELECT count(*) FROM student_rows WHERE nullif(student_json ->> 'user_id', '') IS NULL
             )
           )
         )
  UNION ALL
  SELECT 7,
         'Known Guild 2 / Guild 3 / Arcade reset-contract tables',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
           FROM (
             SELECT relation.relation_name,
                    relation.relation_kind,
                    relation.rls_enabled,
                    relation.comment,
                    coalesce(statistics.n_live_tup, 0)::bigint AS estimated_live_rows,
                    coalesce(statistics.n_dead_tup, 0)::bigint AS estimated_dead_rows
             FROM classroom_scoped_relations relation
             LEFT JOIN pg_stat_user_tables statistics ON statistics.relid = relation.relation_oid
             WHERE relation.relation_name ILIKE ANY (ARRAY['guild2%', 'guild3%', 'arcade%'])
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 8,
         'Trigger and dependency clues for reset ordering',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.entry_name)
           FROM (
             SELECT relation.relation_name,
                    trigger_data.tgname AS entry_name,
                    'TRIGGER' AS entry_kind,
                    pg_get_triggerdef(trigger_data.oid, true) AS detail
             FROM classroom_scoped_relations relation
             JOIN pg_trigger trigger_data
               ON trigger_data.tgrelid = relation.relation_oid
              AND NOT trigger_data.tgisinternal
             UNION ALL
             SELECT dependent_relation.relname AS relation_name,
                    referenced_relation.relname AS entry_name,
                    'FOREIGN_KEY' AS entry_kind,
                    pg_get_constraintdef(constraint_data.oid, true) AS detail
             FROM pg_constraint constraint_data
             JOIN pg_class dependent_relation ON dependent_relation.oid = constraint_data.conrelid
             JOIN pg_class referenced_relation ON referenced_relation.oid = constraint_data.confrelid
             JOIN pg_namespace namespace ON namespace.oid = dependent_relation.relnamespace
             WHERE namespace.nspname = 'public'
               AND dependent_relation.relname IN (SELECT relation_name FROM classroom_scoped_relations)
           ) row_data
         ), '[]'::jsonb)
)
SELECT section_no,
       section_name,
       jsonb_array_length(result_json) AS row_count,
       result_json
FROM report
ORDER BY section_no;
