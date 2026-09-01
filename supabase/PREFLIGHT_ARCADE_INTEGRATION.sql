-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade production integration preflight
-- Date: 2026-08-14
--
-- Run this entire file once in the production Supabase SQL Editor and return
-- every result set before applying any Arcade migration.
--
-- Safety: catalog/statistics inspection only. It contains no DDL, DML, RPC
-- invocation, transaction command, or auth/JWT-dependent helper call.
-- =============================================================================

-- 1) Existing public relations that Arcade must reuse or avoid duplicating.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
                      WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                      ELSE c.relkind::text END AS relation_kind,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p','v','m')
  AND (
    c.relname IN ('students','classrooms','guilds','guild_seasons','guild_members',
                  'guild_membership_events','guild2_individual_contributions',
                  'guild2_gs_events','guild2_monthly_gs_summaries')
    OR c.relname ILIKE '%arcade%'
    OR c.relname ILIKE '%leaderboard%'
    OR c.relname ILIKE '%ranking%'
    OR c.relname ILIKE '%period%'
    OR c.relname ILIKE '%season%'
    OR c.relname ILIKE '%snapshot%'
  )
ORDER BY relation_name;

-- 2) Full column contracts, including the actual student/auth mapping and
-- Guild 2 Arcade-ready aggregate columns.
SELECT c.table_name, c.ordinal_position, c.column_name, c.udt_schema,
       c.udt_name, c.data_type, c.is_nullable, c.column_default,
       c.is_identity, c.is_generated, c.generation_expression
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
    c.table_name IN ('students','classrooms','guilds','guild_seasons','guild_members',
                     'guild_membership_events','guild2_individual_contributions',
                     'guild2_gs_events','guild2_monthly_gs_summaries')
    OR c.table_name ILIKE '%arcade%'
    OR c.table_name ILIKE '%leaderboard%'
    OR c.table_name ILIKE '%ranking%'
    OR c.table_name ILIKE '%period%'
    OR c.table_name ILIKE '%snapshot%'
  )
ORDER BY c.table_name, c.ordinal_position;

-- 3) PK/FK/UNIQUE/CHECK/EXCLUSION constraints. Foreign keys reveal the real
-- production identity and season relationships without reading student data.
SELECT tbl.relname AS table_name, con.conname AS constraint_name,
       CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY'
                        WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK'
                        WHEN 'x' THEN 'EXCLUSION' ELSE con.contype::text END AS constraint_type,
       con.condeferrable, con.condeferred, con.convalidated,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class tbl ON tbl.oid = con.conrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
  AND (
    tbl.relname IN ('students','classrooms','guilds','guild_seasons','guild_members',
                    'guild_membership_events','guild2_individual_contributions',
                    'guild2_gs_events','guild2_monthly_gs_summaries')
    OR tbl.relname ILIKE '%arcade%'
    OR tbl.relname ILIKE '%leaderboard%'
    OR tbl.relname ILIKE '%ranking%'
    OR tbl.relname ILIKE '%period%'
    OR tbl.relname ILIKE '%snapshot%'
  )
ORDER BY table_name, constraint_type, constraint_name;

-- 4) Existing indexes, including any former Arcade or ranking uniqueness rule.
SELECT tbl.relname AS table_name, idx.relname AS index_name,
       i.indisprimary AS is_primary, i.indisunique AS is_unique,
       i.indisvalid AS is_valid, i.indisready AS is_ready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class tbl ON tbl.oid = i.indrelid
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
  AND (
    tbl.relname IN ('students','classrooms','guilds','guild_seasons','guild_members',
                    'guild2_individual_contributions','guild2_gs_events','guild2_monthly_gs_summaries')
    OR tbl.relname ILIKE '%arcade%'
    OR tbl.relname ILIKE '%leaderboard%'
    OR tbl.relname ILIKE '%ranking%'
    OR tbl.relname ILIKE '%period%'
    OR tbl.relname ILIKE '%snapshot%'
  )
ORDER BY table_name, index_name;

-- 5) RLS policies and 6) relation ACLs must both be read: broad grants can
-- undermine a narrow-looking policy.
SELECT p.tablename AS table_name, p.policyname AS policy_name, p.permissive,
       p.roles, p.cmd AS command, p.qual AS using_expression,
       p.with_check AS with_check_expression
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (
    p.tablename IN ('students','classrooms','guilds','guild_seasons','guild_members',
                    'guild2_individual_contributions','guild2_gs_events','guild2_monthly_gs_summaries')
    OR p.tablename ILIKE '%arcade%'
    OR p.tablename ILIKE '%leaderboard%'
    OR p.tablename ILIKE '%ranking%'
    OR p.tablename ILIKE '%period%'
    OR p.tablename ILIKE '%snapshot%'
  )
ORDER BY table_name, policy_name;

SELECT tbl.relname AS relation_name,
       CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type, acl.is_grantable
FROM pg_class tbl
JOIN pg_namespace n ON n.oid = tbl.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(tbl.relacl, acldefault('r', tbl.relowner))) AS acl
WHERE n.nspname = 'public'
  AND tbl.relkind IN ('r','p','v','m')
  AND (
    tbl.relname IN ('students','classrooms','guilds','guild_seasons','guild_members',
                    'guild2_individual_contributions','guild2_gs_events','guild2_monthly_gs_summaries')
    OR tbl.relname ILIKE '%arcade%'
    OR tbl.relname ILIKE '%leaderboard%'
    OR tbl.relname ILIKE '%ranking%'
    OR tbl.relname ILIKE '%period%'
    OR tbl.relname ILIKE '%snapshot%'
  )
ORDER BY relation_name, grantee, acl.privilege_type;

-- 7) Identity, Guild 2, and any existing Arcade/ranking routines. Complete
-- definitions expose exact signatures, SECURITY DEFINER, search_path, and
-- dependencies before any CREATE OR REPLACE is proposed.
WITH candidate_functions AS (
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname IN ('get_current_user_context','current_student_id','current_classroom_id',
                    'is_teacher_or_admin','ensure_teacher_role','link_student_to_auth_user',
                    'guild2_refresh_monthly_scores','guild2_refresh_monthly_gs_summary',
                    'teacher_recalculate_guild2_scores')
      OR p.proname ILIKE '%arcade%'
      OR p.proname ILIKE '%leaderboard%'
      OR p.proname ILIKE '%ranking%'
      OR p.proname ILIKE '%period%'
      OR p.prosrc ILIKE '%guild2_individual_contributions%'
      OR p.prosrc ILIKE '%arcade%'
      OR p.prosrc ILIKE '%leaderboard%'
    )
)
SELECT p.oid AS function_oid, n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_arguments(p.oid) AS arguments_with_defaults,
       pg_get_function_result(p.oid) AS returns, l.lanname AS language,
       p.prosecdef AS security_definer, p.provolatile AS volatility,
       p.proconfig AS function_config, pg_get_functiondef(p.oid) AS complete_definition
FROM candidate_functions cf
JOIN pg_proc p ON p.oid = cf.oid
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
ORDER BY function_name, identity_arguments;

-- 8) Execute ACLs for exactly the same routines.
WITH candidate_functions AS (
  SELECT p.oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname IN ('get_current_user_context','current_student_id','current_classroom_id',
                    'is_teacher_or_admin','ensure_teacher_role','link_student_to_auth_user',
                    'guild2_refresh_monthly_scores','guild2_refresh_monthly_gs_summary',
                    'teacher_recalculate_guild2_scores')
      OR p.proname ILIKE '%arcade%'
      OR p.proname ILIKE '%leaderboard%'
      OR p.proname ILIKE '%ranking%'
      OR p.proname ILIKE '%period%'
      OR p.prosrc ILIKE '%guild2_individual_contributions%'
      OR p.prosrc ILIKE '%arcade%'
      OR p.prosrc ILIKE '%leaderboard%'
    )
)
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       CASE acl.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type, acl.is_grantable
FROM candidate_functions cf
JOIN pg_proc p ON p.oid = cf.oid
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
ORDER BY function_name, identity_arguments, grantee, acl.privilege_type;

-- 9) Triggers could create related records or mutate a score outside the RPC
-- body, so inspect targets and trigger functions as well.
SELECT tbl.relname AS table_name, trg.tgname AS trigger_name,
       pg_get_triggerdef(trg.oid, true) AS trigger_definition,
       fn.proname AS trigger_function_name,
       pg_get_function_identity_arguments(fn.oid) AS trigger_function_identity_arguments,
       pg_get_functiondef(fn.oid) AS trigger_function_definition
FROM pg_trigger trg
JOIN pg_class tbl ON tbl.oid = trg.tgrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
JOIN pg_proc fn ON fn.oid = trg.tgfoid
WHERE NOT trg.tgisinternal AND n.nspname = 'public'
  AND (
    tbl.relname IN ('students','guild_seasons','guild_members',
                    'guild2_individual_contributions','guild2_gs_events','guild2_monthly_gs_summaries')
    OR tbl.relname ILIKE '%arcade%'
    OR tbl.relname ILIKE '%leaderboard%'
    OR tbl.relname ILIKE '%ranking%'
    OR tbl.relname ILIKE '%period%'
    OR tbl.relname ILIKE '%snapshot%'
  )
ORDER BY table_name, trigger_name;

-- 10) Enums that may constrain role, status, or an existing Arcade structure.
SELECT ns.nspname AS schema_name, typ.typname AS enum_name,
       enum.enumlabel AS enum_label, enum.enumsortorder
FROM pg_type typ
JOIN pg_namespace ns ON ns.oid = typ.typnamespace
JOIN pg_enum enum ON enum.enumtypid = typ.oid
WHERE ns.nspname = 'public'
  AND (typ.typname ILIKE '%role%' OR typ.typname ILIKE '%status%'
       OR typ.typname ILIKE '%arcade%' OR typ.typname ILIKE '%period%'
       OR typ.typname ILIKE '%season%' OR typ.typname ILIKE '%rank%')
ORDER BY enum_name, enum.enumsortorder;

-- 11) Realtime publication membership. A client subscription cannot receive
-- database changes if its table is not in the publication.
SELECT pubname AS publication_name, schemaname, tablename
FROM pg_publication_tables
WHERE schemaname = 'public'
  AND (tablename ILIKE '%arcade%' OR tablename IN ('guild2_individual_contributions',
      'guild2_monthly_gs_summaries'))
ORDER BY publication_name, tablename;

-- 12) Extensions relevant to safe range constraints and server-generated IDs.
SELECT extname AS extension_name, extversion AS extension_version
FROM pg_extension
WHERE extname IN ('btree_gist','pgcrypto','uuid-ossp')
ORDER BY extname;

-- 13) Non-invasive live row estimates: confirms whether a former Arcade
-- structure contains history that must be preserved rather than replaced.
SELECT relname AS table_name, n_live_tup AS estimated_live_rows,
       n_dead_tup AS estimated_dead_rows, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND (relname ILIKE '%arcade%' OR relname ILIKE '%leaderboard%'
       OR relname ILIKE '%ranking%' OR relname ILIKE '%period%'
       OR relname ILIKE '%snapshot%')
ORDER BY table_name;
