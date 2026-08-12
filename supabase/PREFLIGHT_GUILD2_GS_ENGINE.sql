-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 2 GS Engine production preflight / introspection
-- Date: 2026-08-12
--
-- Run this entire file in the production Supabase SQL Editor and return every
-- result set to Codex before applying any Guild 2 migration.
--
-- Safety:
--   * Read-only catalog inspection only: no DDL, DML, RPC invocation, or
--     transaction-state changes.
--   * Safe in SQL Editor: it does not call auth/JWT-dependent helpers such as
--     ensure_teacher_role().
--   * Its purpose is to discover production reality; local migrations are not
--     treated as schema truth.
-- =============================================================================

-- 1) Relevant relations currently present, including legacy GS/contribution
--    tables and Guild 1 session snapshot tables.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'f' THEN 'foreign table'
    ELSE c.relkind::text
  END AS relation_kind,
  pg_get_userbyid(c.relowner) AS owner,
  c.relpersistence AS persistence,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (
    c.relname LIKE 'guild%'
    OR c.relname IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY relation_name;

-- 2) Full column contract. This must cover the listed Guild 2 legacy tables
--    even when one of them is absent, as well as the Guild 1 source tables.
SELECT
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.udt_schema,
  c.udt_name,
  c.data_type,
  c.is_nullable,
  c.column_default,
  c.is_identity,
  c.identity_generation,
  c.is_generated,
  c.generation_expression,
  pgd.description AS comment
FROM information_schema.columns c
LEFT JOIN pg_catalog.pg_statio_all_tables st
  ON st.schemaname = c.table_schema AND st.relname = c.table_name
LEFT JOIN pg_catalog.pg_description pgd
  ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
WHERE c.table_schema = 'public'
  AND (
    c.table_name LIKE 'guild%'
    OR c.table_name IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY c.table_name, c.ordinal_position;

-- 3) Primary keys, foreign keys, checks, unique constraints, exclusion
--    constraints, and their validated/deferrable state.
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
JOIN pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
  AND (
    tbl.relname LIKE 'guild%'
    OR tbl.relname IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY tbl.relname, constraint_type, con.conname;

-- 4) All non-constraint indexes, including partial/unique expression indexes
--    that affect historical membership and monthly score idempotency.
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
JOIN pg_namespace n ON n.oid = tbl.relnamespace
LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
WHERE n.nspname = 'public'
  AND (
    tbl.relname LIKE 'guild%'
    OR tbl.relname IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY tbl.relname, idx.relname;

-- 5) RLS policies on all relevant relations. A missing row for a table with
--    RLS enabled is significant, so compare this result with section 1.
SELECT
  p.tablename AS table_name,
  p.policyname AS policy_name,
  p.permissive,
  p.roles,
  p.cmd AS command,
  p.qual AS using_expression,
  p.with_check AS with_check_expression
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (
    p.tablename LIKE 'guild%'
    OR p.tablename IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY p.tablename, p.policyname;

-- 6) Explicit table/view ACLs. This exposes broad PUBLIC/anon/authenticated
--    grants that can override a narrow-looking RLS policy.
SELECT
  tbl.relname AS relation_name,
  CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class tbl
JOIN pg_namespace n ON n.oid = tbl.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(tbl.relacl, acldefault('r', tbl.relowner))) AS acl
WHERE n.nspname = 'public'
  AND tbl.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (
    tbl.relname LIKE 'guild%'
    OR tbl.relname IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY relation_name, grantee, acl.privilege_type;

-- 7) Every public enum, not only enums whose name says "guild". Legacy score
--    columns can reference generic-looking enum names, so omitting them would
--    hide an incompatible type contract.
SELECT
  ns.nspname AS schema_name,
  typ.typname AS enum_name,
  enum.enumlabel AS enum_label,
  enum.enumsortorder
FROM pg_type typ
JOIN pg_namespace ns ON ns.oid = typ.typnamespace
JOIN pg_enum enum ON enum.enumtypid = typ.oid
WHERE ns.nspname = 'public'
ORDER BY enum_name, enum.enumsortorder;

-- 8) Exact signatures, default arguments, SECURITY DEFINER/search_path,
--    and complete bodies for legacy/current Guild and contribution routines.
--    The source scan catches PL/pgSQL routines that write score tables through
--    dynamic SQL, which pg_depend alone cannot reliably reveal.
WITH candidate_functions AS (
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname ILIKE '%guild%'
      OR p.proname ILIKE '%contribution%'
      OR p.proname IN ('calculate_individual_contribution', 'evaluate_guild_mission_log')
      OR p.prosrc ILIKE '%guild_gs%'
      OR p.prosrc ILIKE '%guild_individual_contributions%'
      OR p.prosrc ILIKE '%guild_activity_logs%'
      OR p.prosrc ILIKE '%guild_missions%'
      OR p.prosrc ILIKE '%guild_mission_logs%'
      OR p.prosrc ILIKE '%guild_peer_reviews%'
    )
)
SELECT
  p.oid AS function_oid,
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_arguments(p.oid) AS arguments_with_defaults,
  pg_get_function_result(p.oid) AS returns,
  l.lanname AS language,
  p.prosecdef AS security_definer,
  p.proleakproof AS leakproof,
  p.provolatile AS volatility,
  p.proconfig AS function_config,
  pg_get_functiondef(p.oid) AS complete_definition
FROM candidate_functions cf
JOIN pg_proc p ON p.oid = cf.oid
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 9) Execute grants for the exact same candidate routine set. PostgreSQL
--    permits overloaded functions, so the identity arguments are essential.
WITH candidate_functions AS (
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname ILIKE '%guild%'
      OR p.proname ILIKE '%contribution%'
      OR p.proname IN ('calculate_individual_contribution', 'evaluate_guild_mission_log')
      OR p.prosrc ILIKE '%guild_gs%'
      OR p.prosrc ILIKE '%guild_individual_contributions%'
      OR p.prosrc ILIKE '%guild_activity_logs%'
      OR p.prosrc ILIKE '%guild_missions%'
      OR p.prosrc ILIKE '%guild_mission_logs%'
      OR p.prosrc ILIKE '%guild_peer_reviews%'
    )
)
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM candidate_functions cf
JOIN pg_proc p ON p.oid = cf.oid
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
ORDER BY function_name, identity_arguments, grantee, acl.privilege_type;

-- 10) Triggers can create or mutate score data outside visible RPC bodies.
--     This includes the full trigger condition/definition and target function.
SELECT
  tbl.relname AS table_name,
  trg.tgname AS trigger_name,
  pg_get_triggerdef(trg.oid, true) AS trigger_definition,
  fn.proname AS trigger_function_name,
  pg_get_function_identity_arguments(fn.oid) AS trigger_function_identity_arguments,
  pg_get_functiondef(fn.oid) AS trigger_function_definition
FROM pg_trigger trg
JOIN pg_class tbl ON tbl.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
JOIN pg_proc fn ON fn.oid = trg.tgfoid
WHERE NOT trg.tgisinternal
  AND n.nspname = 'public'
  AND (
    tbl.relname LIKE 'guild%'
    OR tbl.relname IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY tbl.relname, trg.tgname;

-- 11) Direct catalog dependencies reveal views/routines that PostgreSQL has
--     recorded as referencing legacy GS/contribution relations. This is
--     supplementary to the routine-source scan above, not a replacement.
SELECT DISTINCT
  dep_ns.nspname AS dependent_schema,
  CASE dep.relkind
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    ELSE dep.relkind::text
  END AS dependent_kind,
  dep.relname AS dependent_name,
  ref.relname AS referenced_relation
FROM pg_depend d
JOIN pg_class dep ON dep.oid = d.objid
JOIN pg_namespace dep_ns ON dep_ns.oid = dep.relnamespace
JOIN pg_class ref ON ref.oid = d.refobjid
JOIN pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
WHERE ref_ns.nspname = 'public'
  AND ref.relname IN (
    'guild_gs',
    'guild_individual_contributions',
    'guild_activity_logs',
    'guild_missions',
    'guild_mission_logs',
    'guild_peer_reviews'
  )
ORDER BY referenced_relation, dependent_schema, dependent_name;

-- 12) Lightweight live-table statistics. These are estimates from PostgreSQL
--     statistics, not row reads, and help identify tables with historical data
--     that must never be rewritten or dropped.
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
    OR relname IN ('students', 'arcade_monthly_rankings', 'arcade_rankings')
  )
ORDER BY relname;
