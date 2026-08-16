-- =============================================================================
-- Guild 3 essential notification integration — production read-only preflight
--
-- Why this exists
-- Guild 3 must notify students when a mission is published, finalized, or
-- cancelled/materially corrected. This script first discovers the production
-- notification/alert contract so Guild 3 does not invent a duplicate table or
-- call a guessed RPC.
--
-- Safety
-- Read-only catalog/data inspection only. No DDL, DML, or RPC is executed.
-- Run the entire file once in Supabase SQL Editor. It returns one compact
-- result set with every section, avoiding the editor's last-result-only view.
-- =============================================================================

WITH matching_relations AS (
  SELECT n.nspname AS schema_name,
         c.relname AS relation_name,
         c.oid AS relation_oid,
         c.relkind AS relation_kind,
         c.relrowsecurity AS rls_enabled,
         obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'v', 'm', 'p')
    AND (
      c.relname ILIKE ANY (ARRAY['%notification%', '%alert%', '%announcement%', '%message%', '%feed%'])
      OR coalesce(obj_description(c.oid, 'pg_class'), '') ILIKE ANY (ARRAY['%알림%', '%공지%', '%notification%', '%alert%'])
    )
), report AS (
  SELECT 1 AS section_no,
         'Notification-like public relations'::text AS section_name,
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
                   FROM (
                     SELECT schema_name, relation_name, relation_kind, rls_enabled, comment
                     FROM matching_relations
                   ) row_data), '[]'::jsonb) AS result_json
  UNION ALL
  SELECT 2,
         'Column contracts',
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.ordinal_position)
                   FROM (
                     SELECT relation.relation_name,
                            column_data.ordinal_position,
                            column_data.column_name,
                            column_data.data_type,
                            column_data.udt_schema,
                            column_data.udt_name,
                            column_data.is_nullable,
                            column_data.column_default
                     FROM matching_relations relation
                     JOIN information_schema.columns column_data
                       ON column_data.table_schema = relation.schema_name
                      AND column_data.table_name = relation.relation_name
                   ) row_data), '[]'::jsonb)
  UNION ALL
  SELECT 3,
         'RLS policies',
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.policy_name)
                   FROM (
                     SELECT relation.relation_name,
                            policy.policyname AS policy_name,
                            policy.cmd AS command,
                            policy.roles,
                            policy.qual AS using_expression,
                            policy.with_check AS with_check_expression
                     FROM matching_relations relation
                     JOIN pg_policies policy
                       ON policy.schemaname = relation.schema_name
                      AND policy.tablename = relation.relation_name
                   ) row_data), '[]'::jsonb)
  UNION ALL
  SELECT 4,
         'Relation grants',
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.grantee, row_data.privilege_type)
                   FROM (
                     SELECT relation.relation_name,
                            privilege.grantee,
                            privilege.privilege_type,
                            privilege.is_grantable
                     FROM matching_relations relation
                     JOIN information_schema.role_table_grants privilege
                       ON privilege.table_schema = relation.schema_name
                      AND privilege.table_name = relation.relation_name
                   ) row_data), '[]'::jsonb)
  UNION ALL
  SELECT 5,
         'Notification-like functions and EXECUTE grants',
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.function_name, row_data.identity_arguments, row_data.grantee)
                   FROM (
                     SELECT routine.proname AS function_name,
                            pg_get_function_identity_arguments(routine.oid) AS identity_arguments,
                            routine.prosecdef AS security_definer,
                            routine.proconfig AS function_config,
                            privilege.grantee,
                            privilege.privilege_type
                     FROM pg_proc routine
                     JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
                     LEFT JOIN information_schema.routine_privileges privilege
                       ON privilege.specific_schema = namespace.nspname
                      AND privilege.routine_name = routine.proname
                     WHERE namespace.nspname = 'public'
                       AND routine.prokind = 'f'
                       AND routine.proname ILIKE ANY (ARRAY['%notification%', '%alert%', '%announce%', '%message%'])
                   ) row_data), '[]'::jsonb)
  UNION ALL
  SELECT 6,
         'Triggers on notification-like relations',
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.trigger_name)
                   FROM (
                     SELECT relation.relation_name,
                            trigger_data.tgname AS trigger_name,
                            pg_get_triggerdef(trigger_data.oid, true) AS trigger_definition,
                            procedure_data.proname AS trigger_function_name
                     FROM matching_relations relation
                     JOIN pg_trigger trigger_data
                       ON trigger_data.tgrelid = relation.relation_oid
                      AND NOT trigger_data.tgisinternal
                     JOIN pg_proc procedure_data ON procedure_data.oid = trigger_data.tgfoid
                   ) row_data), '[]'::jsonb)
  UNION ALL
  SELECT 7,
         'Approximate current row counts',
         coalesce((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
                   FROM (
                     SELECT relation.relation_name,
                            class_data.reltuples::bigint AS estimated_live_rows,
                            class_data.n_dead_tup AS estimated_dead_rows
                     FROM matching_relations relation
                     JOIN pg_stat_user_tables class_data
                       ON class_data.relid = relation.relation_oid
                   ) row_data), '[]'::jsonb)
)
SELECT section_no,
       section_name,
       jsonb_array_length(result_json) AS row_count,
       result_json
FROM report
ORDER BY section_no;
