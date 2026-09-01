-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 3 Mission production preflight (single-result edition)
-- Date: 2026-08-15
--
-- Run this WHOLE FILE once in the production Supabase SQL Editor.
--
-- It returns one result table with 14 rows:
--   section_no | section_name | row_count | result_json
--
-- Each result_json cell contains the complete result for that section. This
-- avoids Supabase SQL Editor showing only the last SELECT result.
--
-- Safety: catalog/statistics inspection only. No DDL, DML, RPC invocation,
-- transaction control, or auth/JWT-dependent helper call is present.
-- =============================================================================

WITH
relevant_relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relowner, c.relpersistence,
         c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      c.relname LIKE 'guild%'
      OR c.relname LIKE 'arcade%'
      OR c.relname IN ('students', 'classrooms')
      OR c.relname ~ '(^|_)(mission|peer|monthly|closure|finalization|period|snapshot)(_|$)'
    )
),
candidate_functions AS (
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname ILIKE 'guild%'
      OR p.proname ILIKE '%mission%'
      OR p.proname ILIKE '%peer%'
      OR p.proname ILIKE '%monthly%'
      OR p.proname ILIKE '%closure%'
      OR p.proname ILIKE '%reopen%'
      OR p.proname ILIKE '%finali%'
      OR p.proname IN (
        'ensure_teacher_role', 'current_classroom_id', 'current_student_id',
        'is_teacher_or_admin', 'calculate_individual_contribution',
        'calculate_monthly_guild_gs', 'evaluate_guild_mission_log',
        'record_guild_activity'
      )
      OR p.prosrc ILIKE '%guild2_%'
      OR p.prosrc ILIKE '%guild_mission%'
      OR p.prosrc ILIKE '%guild_peer%'
    )
),

-- 1) Existing relations that Guild 3 must reuse or avoid duplicating.
section_1_rows AS (
  SELECT
    'public'::text AS schema_name,
    rel.relname AS relation_name,
    CASE rel.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized view'
      WHEN 'f' THEN 'foreign table'
      ELSE rel.relkind::text
    END AS relation_kind,
    pg_get_userbyid(rel.relowner) AS owner,
    rel.relpersistence AS persistence,
    rel.relrowsecurity AS rls_enabled,
    rel.relforcerowsecurity AS rls_forced,
    obj_description(rel.oid, 'pg_class') AS comment
  FROM relevant_relations rel
),

-- 2) Exact columns, data types, defaults, and generated expressions.
section_2_rows AS (
  SELECT
    cols.table_name,
    cols.ordinal_position,
    cols.column_name,
    cols.udt_schema,
    cols.udt_name,
    cols.data_type,
    cols.is_nullable,
    cols.column_default,
    cols.is_identity,
    cols.identity_generation,
    cols.is_generated,
    cols.generation_expression,
    description.description AS comment
  FROM information_schema.columns cols
  JOIN relevant_relations rel ON rel.relname = cols.table_name
  LEFT JOIN pg_description description
    ON description.objoid = rel.oid
   AND description.objsubid = cols.ordinal_position
  WHERE cols.table_schema = 'public'
),

-- 3) PK/FK/UNIQUE/CHECK/EXCLUSION constraints and validation state.
section_3_rows AS (
  SELECT
    tbl.relname AS table_name,
    con.conname AS constraint_name,
    CASE con.contype
      WHEN 'p' THEN 'PRIMARY KEY'
      WHEN 'f' THEN 'FOREIGN KEY'
      WHEN 'u' THEN 'UNIQUE'
      WHEN 'c' THEN 'CHECK'
      WHEN 'x' THEN 'EXCLUSION'
      ELSE con.contype::text
    END AS constraint_type,
    con.condeferrable,
    con.condeferred,
    con.convalidated,
    pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_constraint con
  JOIN pg_class tbl ON tbl.oid = con.conrelid
  JOIN relevant_relations rel ON rel.oid = tbl.oid
),

-- 4) Indexes, including partial/expression indexes and uniqueness proof.
section_4_rows AS (
  SELECT
    tbl.relname AS table_name,
    idx.relname AS index_name,
    i.indisprimary AS is_primary,
    i.indisunique AS is_unique,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN relevant_relations rel ON rel.oid = tbl.oid
),

-- 5) RLS policies. Missing rows matter when Section 1 says RLS is enabled.
section_5_rows AS (
  SELECT
    p.tablename AS table_name,
    p.policyname AS policy_name,
    p.permissive,
    p.roles,
    p.cmd AS command,
    p.qual AS using_expression,
    p.with_check AS with_check_expression
  FROM pg_policies p
  JOIN relevant_relations rel ON rel.relname = p.tablename
  WHERE p.schemaname = 'public'
),

-- 6) Explicit relation ACLs. Broad grants can undermine the RPC boundary.
section_6_rows AS (
  SELECT
    tbl.relname AS relation_name,
    CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_class tbl
  JOIN relevant_relations rel ON rel.oid = tbl.oid
  CROSS JOIN LATERAL aclexplode(coalesce(tbl.relacl, acldefault('r', tbl.relowner))) AS acl
),

-- 7) Every public enum label. No legacy enum is assumed compatible.
section_7_rows AS (
  SELECT
    ns.nspname AS schema_name,
    typ.typname AS enum_name,
    enum.enumlabel AS enum_label,
    enum.enumsortorder
  FROM pg_type typ
  JOIN pg_namespace ns ON ns.oid = typ.typnamespace
  JOIN pg_enum enum ON enum.enumtypid = typ.oid
  WHERE ns.nspname = 'public'
),

-- 8) Exact functions, defaults, security configuration, and full bodies.
section_8_rows AS (
  SELECT
    p.oid AS function_oid,
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_arguments(p.oid) AS arguments_with_defaults,
    pg_get_function_result(p.oid) AS returns,
    l.lanname AS language,
    p.prosecdef AS security_definer,
    p.provolatile AS volatility,
    p.proconfig AS function_config,
    pg_get_functiondef(p.oid) AS complete_definition
  FROM candidate_functions cf
  JOIN pg_proc p ON p.oid = cf.oid
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
),

-- 9) EXECUTE ACLs for the exact same routine set.
section_9_rows AS (
  SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM candidate_functions cf
  JOIN pg_proc p ON p.oid = cf.oid
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
),

-- 10) Triggers and their complete trigger-function bodies.
section_10_rows AS (
  SELECT
    tbl.relname AS table_name,
    trg.tgname AS trigger_name,
    pg_get_triggerdef(trg.oid, true) AS trigger_definition,
    fn.proname AS trigger_function_name,
    pg_get_function_identity_arguments(fn.oid) AS trigger_function_identity_arguments,
    pg_get_functiondef(fn.oid) AS trigger_function_definition
  FROM pg_trigger trg
  JOIN relevant_relations rel ON rel.oid = trg.tgrelid
  JOIN pg_class tbl ON tbl.oid = trg.tgrelid
  JOIN pg_proc fn ON fn.oid = trg.tgfoid
  WHERE NOT trg.tgisinternal
),

-- 11) Correct pg_depend lookup. Object IDs are always joined with classid.
section_11_rows AS (
  WITH target_relations AS (
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'students', 'guilds', 'guild_members', 'guild_membership_events',
        'guild_seasons', 'guild_sessions', 'guild_session_participants',
        'guild_missions', 'guild_mission_logs', 'guild_peer_reviews',
        'guild_activity_logs', 'guild2_individual_contributions',
        'guild2_gs_events', 'guild2_monthly_gs_summaries'
      )
  ), dependency_rows AS (
    SELECT target.relname AS referenced_relation, d.classid, d.objid
    FROM pg_depend d
    JOIN target_relations target
      ON d.refclassid = 'pg_class'::regclass
     AND d.refobjid = target.oid
  ), dependent_relations AS (
    SELECT
      n.nspname AS dependent_schema,
      CASE relation.relkind
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'f' THEN 'foreign table'
        WHEN 'S' THEN 'sequence'
        WHEN 'i' THEN 'index'
        WHEN 'I' THEN 'partitioned index'
        ELSE relation.relkind::text
      END AS dependent_kind,
      relation.relname AS dependent_name,
      d.referenced_relation
    FROM dependency_rows d
    JOIN pg_class relation
      ON d.classid = 'pg_class'::regclass
     AND relation.oid = d.objid
    JOIN pg_namespace n ON n.oid = relation.relnamespace
  ), dependent_views AS (
    SELECT
      n.nspname AS dependent_schema,
      CASE view_relation.relkind
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        ELSE view_relation.relkind::text
      END AS dependent_kind,
      view_relation.relname AS dependent_name,
      d.referenced_relation
    FROM dependency_rows d
    JOIN pg_rewrite rewrite_rule
      ON d.classid = 'pg_rewrite'::regclass
     AND rewrite_rule.oid = d.objid
    JOIN pg_class view_relation
      ON view_relation.oid = rewrite_rule.ev_class
     AND view_relation.relkind IN ('v', 'm')
    JOIN pg_namespace n ON n.oid = view_relation.relnamespace
  ), dependent_routines AS (
    SELECT
      n.nspname AS dependent_schema,
      CASE routine.prokind
        WHEN 'f' THEN 'function'
        WHEN 'p' THEN 'procedure'
        WHEN 'a' THEN 'aggregate'
        WHEN 'w' THEN 'window function'
        ELSE routine.prokind::text
      END AS dependent_kind,
      format('%I(%s)', routine.proname, pg_get_function_identity_arguments(routine.oid)) AS dependent_name,
      d.referenced_relation
    FROM dependency_rows d
    JOIN pg_proc routine
      ON d.classid = 'pg_proc'::regclass
     AND routine.oid = d.objid
    JOIN pg_namespace n ON n.oid = routine.pronamespace
  )
  SELECT DISTINCT
    dependent_schema,
    dependent_kind,
    dependent_name,
    referenced_relation
  FROM (
    SELECT * FROM dependent_relations
    UNION ALL
    SELECT * FROM dependent_views
    UNION ALL
    SELECT * FROM dependent_routines
  ) dependencies
),

-- 12) Read-only row estimates. These flag history that must remain untouched.
section_12_rows AS (
  SELECT
    relname AS table_name,
    n_live_tup AS estimated_live_rows,
    n_dead_tup AS estimated_dead_rows,
    last_analyze,
    last_autoanalyze,
    last_vacuum,
    last_autovacuum
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
    AND (
      relname LIKE 'guild%'
      OR relname LIKE 'arcade%'
      OR relname IN ('students', 'classrooms')
      OR relname ~ '(^|_)(mission|peer|monthly|closure|finalization|period|snapshot)(_|$)'
    )
),

-- 13) Existing close/finalization data contracts anywhere in public.
section_13_rows AS (
  SELECT
    cols.table_name,
    string_agg(
      format('%s:%s%s', cols.column_name, cols.udt_name,
        CASE WHEN cols.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END),
      ', ' ORDER BY cols.ordinal_position
    ) AS relevant_columns
  FROM information_schema.columns cols
  WHERE cols.table_schema = 'public'
    AND (
      cols.table_name ~ '(^|_)(month|monthly|period|closure|finalization|final|reopen)(_|$)'
      OR cols.column_name IN (
        'year_month', 'contribution_year_month', 'finalized_at', 'closed_at',
        'reopened_at', 'status', 'starts_at', 'ends_at_exclusive'
      )
    )
  GROUP BY cols.table_name
),

-- 14) Potential Guild 5 close/finalization/reopen routines and their bodies.
section_14_rows AS (
  SELECT
    p.oid AS function_oid,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    p.prosecdef AS security_definer,
    p.proconfig AS function_config,
    pg_get_functiondef(p.oid) AS complete_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname ILIKE '%close%'
      OR p.proname ILIKE '%finali%'
      OR p.proname ILIKE '%reopen%'
      OR p.proname ILIKE '%monthly%'
      OR p.proname ILIKE '%conquest%'
      OR p.prosrc ILIKE '%guild5%'
      OR p.prosrc ILIKE '%finalized month%'
    )
)
SELECT
  guild3_preflight_results.section_no,
  guild3_preflight_results.section_name,
  guild3_preflight_results.row_count,
  guild3_preflight_results.result_json
FROM (
  SELECT
    1::integer AS section_no,
    'Relevant public relations'::text AS section_name,
    (SELECT count(*)::integer FROM section_1_rows) AS row_count,
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name), '[]'::jsonb)
     FROM section_1_rows row_data) AS result_json
  UNION ALL
  SELECT
    2,
    'Column contracts',
    (SELECT count(*)::integer FROM section_2_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.ordinal_position), '[]'::jsonb)
     FROM section_2_rows row_data)
  UNION ALL
  SELECT
    3,
    'Constraints',
    (SELECT count(*)::integer FROM section_3_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.constraint_type, row_data.constraint_name), '[]'::jsonb)
     FROM section_3_rows row_data)
  UNION ALL
  SELECT
    4,
    'Indexes',
    (SELECT count(*)::integer FROM section_4_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.index_name), '[]'::jsonb)
     FROM section_4_rows row_data)
  UNION ALL
  SELECT
    5,
    'RLS policies',
    (SELECT count(*)::integer FROM section_5_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.policy_name), '[]'::jsonb)
     FROM section_5_rows row_data)
  UNION ALL
  SELECT
    6,
    'Relation ACLs',
    (SELECT count(*)::integer FROM section_6_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.grantee, row_data.privilege_type), '[]'::jsonb)
     FROM section_6_rows row_data)
  UNION ALL
  SELECT
    7,
    'Public enums',
    (SELECT count(*)::integer FROM section_7_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.enum_name, row_data.enumsortorder), '[]'::jsonb)
     FROM section_7_rows row_data)
  UNION ALL
  SELECT
    8,
    'Guild/Mission/Peer/G2 functions',
    (SELECT count(*)::integer FROM section_8_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.function_name, row_data.identity_arguments), '[]'::jsonb)
     FROM section_8_rows row_data)
  UNION ALL
  SELECT
    9,
    'Function EXECUTE ACLs',
    (SELECT count(*)::integer FROM section_9_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.function_name, row_data.identity_arguments, row_data.grantee, row_data.privilege_type), '[]'::jsonb)
     FROM section_9_rows row_data)
  UNION ALL
  SELECT
    10,
    'Triggers',
    (SELECT count(*)::integer FROM section_10_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.trigger_name), '[]'::jsonb)
     FROM section_10_rows row_data)
  UNION ALL
  SELECT
    11,
    'Catalog dependencies',
    (SELECT count(*)::integer FROM section_11_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.referenced_relation, row_data.dependent_schema, row_data.dependent_kind, row_data.dependent_name), '[]'::jsonb)
     FROM section_11_rows row_data)
  UNION ALL
  SELECT
    12,
    'Relation statistics',
    (SELECT count(*)::integer FROM section_12_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name), '[]'::jsonb)
     FROM section_12_rows row_data)
  UNION ALL
  SELECT
    13,
    'Existing monthly-close data contracts',
    (SELECT count(*)::integer FROM section_13_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name), '[]'::jsonb)
     FROM section_13_rows row_data)
  UNION ALL
  SELECT
    14,
    'Potential close/finalization/reopen functions',
    (SELECT count(*)::integer FROM section_14_rows),
    (SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.function_name, row_data.identity_arguments), '[]'::jsonb)
     FROM section_14_rows row_data)
) AS guild3_preflight_results
ORDER BY guild3_preflight_results.section_no;
