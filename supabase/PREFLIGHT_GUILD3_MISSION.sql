-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 3 Mission production preflight / introspection
-- Date: 2026-08-15
--
-- Run this file in the production Supabase SQL Editor BEFORE applying any
-- Guild 3 migration. Return each Section 1~14 result to Codex.
--
-- Safety:
--   * Read-only catalog/statistics inspection only.
--   * No DDL, DML, RPC execution, transaction control, or data mutation.
--   * Safe in SQL Editor: this file does not invoke auth/JWT-dependent
--     helpers such as ensure_teacher_role().
--   * Production is the source of truth. Local migrations are not treated as
--     a substitute for these results.
--
-- Note: Supabase SQL Editor usually displays only the final SELECT result when
-- the entire file is run at once. If that happens, run Sections 1~14 one at a
-- time and return the result of each section.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Section 1) Relevant relations, including legacy mission tables, Guild 1
-- snapshots, Guild 2 draft caches/ledger, and any existing close/finalization
-- candidates. A relation that is absent here must not be assumed by migration.
-- -----------------------------------------------------------------------------
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
    OR c.relname LIKE 'arcade%'
    OR c.relname IN ('students', 'classrooms')
    OR c.relname ~ '(^|_)(mission|peer|monthly|closure|finalization|period|snapshot)(_|$)'
  )
ORDER BY relation_name;

-- -----------------------------------------------------------------------------
-- Section 2) Full column contracts for every relation in Section 1.
-- This checks exact data types, defaults, generated columns, and comments.
-- -----------------------------------------------------------------------------
WITH relevant_relations AS (
  SELECT c.oid, c.relname
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
)
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
ORDER BY cols.table_name, cols.ordinal_position;

-- -----------------------------------------------------------------------------
-- Section 3) All PK/FK/UNIQUE/CHECK/EXCLUSION constraints. This is essential
-- for participant snapshots, immutable revision history, and G2 adapter keys.
-- -----------------------------------------------------------------------------
WITH relevant_relations AS (
  SELECT c.oid
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
)
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
ORDER BY tbl.relname, constraint_type, con.conname;

-- -----------------------------------------------------------------------------
-- Section 4) Indexes, including partial/expression indexes that can affect
-- historical membership, submission revision numbering, and score idempotency.
-- -----------------------------------------------------------------------------
WITH relevant_relations AS (
  SELECT c.oid
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
)
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
ORDER BY tbl.relname, idx.relname;

-- -----------------------------------------------------------------------------
-- Section 5) RLS policies. Compare missing policies with Section 1 RLS flags.
-- In particular, this checks that unpublished mission details cannot leak.
-- -----------------------------------------------------------------------------
WITH relevant_names AS (
  SELECT c.relname
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
)
SELECT
  p.tablename AS table_name,
  p.policyname AS policy_name,
  p.permissive,
  p.roles,
  p.cmd AS command,
  p.qual AS using_expression,
  p.with_check AS with_check_expression
FROM pg_policies p
JOIN relevant_names rel ON rel.relname = p.tablename
WHERE p.schemaname = 'public'
ORDER BY p.tablename, p.policyname;

-- -----------------------------------------------------------------------------
-- Section 6) Explicit relation ACLs. This identifies broad PUBLIC/anon/
-- authenticated grants that may bypass the intended RPC boundary.
-- -----------------------------------------------------------------------------
WITH relevant_relations AS (
  SELECT c.oid
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
)
SELECT
  tbl.relname AS relation_name,
  CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class tbl
JOIN relevant_relations rel ON rel.oid = tbl.oid
CROSS JOIN LATERAL aclexplode(coalesce(tbl.relacl, acldefault('r', tbl.relowner))) AS acl
ORDER BY relation_name, grantee, acl.privilege_type;

-- -----------------------------------------------------------------------------
-- Section 7) All public enum labels. Guild 3 must not guess an existing enum
-- contract or silently reuse an incompatible legacy mission status type.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Section 8) Exact contracts and complete bodies for Guild/Mission/Peer/G2
-- routines plus shared identity helpers. This detects overloads/defaults,
-- SECURITY DEFINER configuration, and existing legacy writers.
-- -----------------------------------------------------------------------------
WITH candidate_functions AS (
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
  p.provolatile AS volatility,
  p.proconfig AS function_config,
  pg_get_functiondef(p.oid) AS complete_definition
FROM candidate_functions cf
JOIN pg_proc p ON p.oid = cf.oid
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- -----------------------------------------------------------------------------
-- Section 9) EXECUTE ACLs for the identical routine set. Exact identity
-- arguments keep overloaded RPC permissions unambiguous.
-- -----------------------------------------------------------------------------
WITH candidate_functions AS (
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

-- -----------------------------------------------------------------------------
-- Section 10) Non-internal triggers and their complete trigger-function bodies.
-- A trigger may create/mutate a score or history row outside visible RPC code.
-- -----------------------------------------------------------------------------
WITH relevant_relations AS (
  SELECT c.oid
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
)
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
ORDER BY tbl.relname, trg.tgname;

-- -----------------------------------------------------------------------------
-- Section 11) Correct catalog dependency inspection for legacy/current source
-- relations. pg_depend object IDs are joined only with the catalog named by
-- classid/refclassid. View dependencies reside on pg_rewrite; routine
-- dependencies reside on pg_proc. Source scans in Section 8 remain necessary
-- because dynamic SQL is not guaranteed to appear in pg_depend.
-- -----------------------------------------------------------------------------
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
  SELECT target.relname AS referenced_relation, d.classid, d.objid, d.deptype
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
ORDER BY referenced_relation, dependent_schema, dependent_kind, dependent_name;

-- -----------------------------------------------------------------------------
-- Section 12) Lightweight relation statistics. These estimates identify
-- historical data that must not be deleted/re-written by Guild 3.
-- -----------------------------------------------------------------------------
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
ORDER BY relname;

-- -----------------------------------------------------------------------------
-- Section 13) Existing month/finalization/reopen data contracts anywhere in
-- public. Guild 3 must integrate with Guild 5's future lock if it already
-- exists; it must not invent a competing monthly-close system.
-- -----------------------------------------------------------------------------
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
ORDER BY cols.table_name;

-- -----------------------------------------------------------------------------
-- Section 14) Potential monthly close/finalization/reopen routines, including
-- complete definitions. An empty result confirms that Guild 5's DB lock
-- interface has not been implemented yet; it must not be guessed by Guild 3.
-- -----------------------------------------------------------------------------
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
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);
