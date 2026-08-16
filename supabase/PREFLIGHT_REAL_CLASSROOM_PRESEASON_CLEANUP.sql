-- =============================================================================
-- ONE-TIME real classroom pre-Season-2 cleanup — production read-only preflight
--
-- This is NOT cleanup SQL. It never deletes or changes data.
--
-- It discovers the actual production classroom identity, operational tables,
-- row-count evidence, foreign-key order, triggers, RLS/ACLs, and the exact
-- Guild 2 / Guild 3 / Arcade refresh contracts needed before a one-time reset.
--
-- Run the entire file once in Supabase SQL Editor. It returns all sections in
-- one result set, rather than producing many result tabs.
-- =============================================================================

WITH public_relations AS (
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
), direct_classroom_relations AS (
  SELECT relation.*
  FROM public_relations relation
  WHERE EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    WHERE attribute.attrelid = relation.relation_oid
      AND attribute.attname = 'classroom_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  )
), operational_relations AS (
  SELECT relation.*
  FROM public_relations relation
  WHERE relation.relation_name ILIKE ANY (ARRAY[
    'guild%', 'arcade%', 'ranking%', 'mission%', 'peer%'
  ])
     OR relation.relation_name IN (
       'classrooms', 'students', 'wallets', 'transactions',
       'auction_items', 'auction_bids', 'auction_results', 'auctions'
     )
), classroom_rows AS (
  SELECT to_jsonb(classroom_row) AS classroom_json
  FROM public.classrooms classroom_row
), report AS (
  SELECT 1 AS section_no,
         'Actual classroom candidates — choose the exact REAL target before cleanup'::text AS section_name,
         coalesce((
           SELECT jsonb_agg(classroom_json ORDER BY classroom_json ->> 'id')
           FROM classroom_rows
         ), '[]'::jsonb) AS result_json
  UNION ALL
  SELECT 2,
         'Preserved identity/baseline contracts',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.ordinal_position)
           FROM (
             SELECT column_data.table_name,
                    column_data.ordinal_position,
                    column_data.column_name,
                    column_data.data_type,
                    column_data.udt_schema,
                    column_data.udt_name,
                    column_data.is_nullable,
                    column_data.column_default
             FROM information_schema.columns column_data
             WHERE column_data.table_schema = 'public'
               AND column_data.table_name IN (
                 'classrooms', 'students', 'guilds', 'guild_seasons',
                 'guild_members', 'guild_membership_events'
               )
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 3,
         'Operational/reset candidate relations and estimated current rows',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
           FROM (
             SELECT relation.relation_name,
                    relation.relation_kind,
                    relation.rls_enabled,
                    relation.rls_forced,
                    relation.comment,
                    (direct.relation_oid IS NOT NULL) AS has_direct_classroom_id,
                    coalesce(statistics.n_live_tup, 0)::bigint AS estimated_live_rows,
                    coalesce(statistics.n_dead_tup, 0)::bigint AS estimated_dead_rows
             FROM operational_relations relation
             LEFT JOIN direct_classroom_relations direct ON direct.relation_oid = relation.relation_oid
             LEFT JOIN pg_stat_user_tables statistics ON statistics.relid = relation.relation_oid
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 4,
         'Exact per-classroom counts for direct classroom-scoped operational tables',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
           FROM (
             SELECT relation.relation_name,
                    xmlserialize(
                      content query_to_xml(
                        format(
                          'SELECT classroom_id, count(*) AS row_count FROM %I.%I GROUP BY classroom_id ORDER BY classroom_id',
                          relation.schema_name,
                          relation.relation_name
                        ),
                        true,
                        true,
                        ''
                      ) AS text
                    ) AS counts_by_classroom_xml
             FROM operational_relations relation
             JOIN direct_classroom_relations direct ON direct.relation_oid = relation.relation_oid
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 5,
         'Foreign-key dependencies and reset ordering evidence',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.dependent_relation, row_data.constraint_name)
           FROM (
             SELECT dependent_relation.relname AS dependent_relation,
                    constraint_data.conname AS constraint_name,
                    referenced_namespace.nspname AS referenced_schema,
                    referenced_relation.relname AS referenced_relation,
                    pg_get_constraintdef(constraint_data.oid, true) AS definition
             FROM pg_constraint constraint_data
             JOIN pg_class dependent_relation ON dependent_relation.oid = constraint_data.conrelid
             JOIN pg_namespace dependent_namespace ON dependent_namespace.oid = dependent_relation.relnamespace
             JOIN pg_class referenced_relation ON referenced_relation.oid = constraint_data.confrelid
             JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
             WHERE dependent_namespace.nspname = 'public'
               AND constraint_data.contype = 'f'
               AND (
                 dependent_relation.relname IN (SELECT relation_name FROM operational_relations)
                 OR referenced_relation.relname IN (SELECT relation_name FROM operational_relations)
               )
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 6,
         'RLS policies, direct grants, and triggers on operational relations',
         coalesce((
           SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.entry_kind, row_data.entry_name)
           FROM (
             SELECT policy_data.tablename AS relation_name,
                    'POLICY' AS entry_kind,
                    policy_data.policyname AS entry_name,
                    jsonb_build_object(
                      'roles', policy_data.roles,
                      'command', policy_data.cmd,
                      'using_expression', policy_data.qual,
                      'with_check_expression', policy_data.with_check
                    ) AS detail
             FROM pg_policies policy_data
             JOIN operational_relations relation
               ON relation.schema_name = policy_data.schemaname
              AND relation.relation_name = policy_data.tablename
             UNION ALL
             SELECT grant_data.table_name AS relation_name,
                    'GRANT' AS entry_kind,
                    grant_data.grantee || ':' || grant_data.privilege_type AS entry_name,
                    jsonb_build_object('is_grantable', grant_data.is_grantable) AS detail
             FROM information_schema.role_table_grants grant_data
             JOIN operational_relations relation
               ON relation.schema_name = grant_data.table_schema
              AND relation.relation_name = grant_data.table_name
             UNION ALL
             SELECT relation.relation_name,
                    'TRIGGER' AS entry_kind,
                    trigger_data.tgname AS entry_name,
                    to_jsonb(pg_get_triggerdef(trigger_data.oid, true)) AS detail
             FROM operational_relations relation
             JOIN pg_trigger trigger_data
               ON trigger_data.tgrelid = relation.relation_oid
              AND NOT trigger_data.tgisinternal
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 7,
         'Exact current identity, authorization, link, and Guild refresh functions',
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
                 '%link%student%auth%', '%auth%user%', '%guild2%refresh%',
                 '%guild3%mission%', '%arcade%final%'
               ])
           ) row_data
         ), '[]'::jsonb)
  UNION ALL
  SELECT 8,
         'Existing auth-link and fixture identity evidence',
         jsonb_build_array(
           jsonb_build_object(
             'student_count', (SELECT count(*) FROM public.students),
             'students_with_user_id', (
               SELECT count(*)
               FROM public.students student_row
               WHERE nullif(to_jsonb(student_row) ->> 'user_id', '') IS NOT NULL
             ),
             'students_without_user_id', (
               SELECT count(*)
               FROM public.students student_row
               WHERE nullif(to_jsonb(student_row) ->> 'user_id', '') IS NULL
             )
           ),
           jsonb_build_object(
             'existing_test_like_classrooms', coalesce((
               SELECT jsonb_agg(classroom_json ORDER BY classroom_json ->> 'id')
               FROM classroom_rows
               WHERE classroom_json ->> 'name' ILIKE '%TEST%'
                  OR classroom_json ->> 'display_name' ILIKE '%TEST%'
                  OR classroom_json ->> 'code' ILIKE '%TEST%'
             ), '[]'::jsonb)
           ),
           jsonb_build_object(
             'existing_test_like_students', coalesce((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', to_jsonb(student_row) ->> 'id',
                   'classroom_id', to_jsonb(student_row) ->> 'classroom_id',
                   'name', to_jsonb(student_row) ->> 'name',
                   'role', to_jsonb(student_row) ->> 'role',
                   'has_auth_link', nullif(to_jsonb(student_row) ->> 'user_id', '') IS NOT NULL
                 )
                 ORDER BY to_jsonb(student_row) ->> 'classroom_id', to_jsonb(student_row) ->> 'name'
               )
               FROM public.students student_row
               WHERE to_jsonb(student_row) ->> 'role' = 'TEST'
                  OR to_jsonb(student_row) ->> 'name' ~* '^TEST0[1-5]$'
             ), '[]'::jsonb)
           )
         )
  UNION ALL
  SELECT 9,
         'Migration/feature presence relevant to this one-time cleanup',
         jsonb_build_array(
           jsonb_build_object(
             'guild2_contributions', to_regclass('public.guild2_individual_contributions') IS NOT NULL,
             'guild2_gs_events', to_regclass('public.guild2_gs_events') IS NOT NULL,
             'guild2_monthly_summaries', to_regclass('public.guild2_monthly_gs_summaries') IS NOT NULL,
             'guild3_missions', to_regclass('public.guild3_missions') IS NOT NULL,
             'guild3_peer_openings', to_regclass('public.guild3_peer_review_openings') IS NOT NULL,
             'arcade_runs', to_regclass('public.arcade_runs') IS NOT NULL,
             'arcade_monthly_finalizations', to_regclass('public.arcade_monthly_finalizations') IS NOT NULL,
             'guild4_named_relations', coalesce((
               SELECT jsonb_agg(relation_name ORDER BY relation_name)
               FROM public_relations
               WHERE relation_name ILIKE '%peer_review%'
             ), '[]'::jsonb)
           )
         )
)
SELECT section_no,
       section_name,
       jsonb_array_length(result_json) AS row_count,
       result_json
FROM report
ORDER BY section_no;
