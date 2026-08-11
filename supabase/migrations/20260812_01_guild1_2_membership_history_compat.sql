-- ============================================================================
-- B.R.A.N.D 2.0 — Guild 1.2 Membership History Compatibility Hotfix
-- 2026-08-12
--
-- Purpose
--   Guild 1 stores membership history as multiple rows per student within the
--   same season. Legacy UNIQUE(student_id, season_id) or
--   UNIQUE(guild_id, student_id[, season_id]) constraints prevent MOVE / REMOVE
--   -> REASSIGN / RETURN-TO-OLD-GUILD flows even after the old row is closed.
--
-- Safety
--   - Does NOT delete or rewrite membership rows.
--   - Drops only legacy non-PK UNIQUE constraints/indexes whose complete key is
--     one of the known history-blocking combinations below.
--   - Does NOT touch the Guild 1 partial unique index that enforces exactly one
--     active membership per student (WHERE left_at IS NULL).
--   - No CASCADE. If another object depends on a legacy UNIQUE, PostgreSQL will
--     stop and roll back instead of silently removing dependencies.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.guild_members') IS NULL THEN
    RAISE EXCEPTION '[G1.2] required table missing: public.guild_members';
  END IF;

  -- Constraint-backed UNIQUEs.
  FOR r IN
    SELECT c.conname,
           array_agg(a.attname ORDER BY a.attname)::text[] AS cols
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a
      ON a.attrelid=c.conrelid AND a.attnum=k.attnum AND NOT a.attisdropped
    WHERE c.conrelid='public.guild_members'::regclass
      AND c.contype='u'
    GROUP BY c.conname
    HAVING array_agg(a.attname ORDER BY a.attname)::text[] = ARRAY['season_id','student_id']::text[]
        OR array_agg(a.attname ORDER BY a.attname)::text[] = ARRAY['guild_id','student_id']::text[]
        OR array_agg(a.attname ORDER BY a.attname)::text[] = ARRAY['guild_id','season_id','student_id']::text[]
  LOOP
    RAISE NOTICE '[G1.2] dropping history-blocking UNIQUE constraint: % (%)', r.conname, array_to_string(r.cols, ',');
    EXECUTE format('ALTER TABLE public.guild_members DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- Standalone UNIQUE indexes not owned by a constraint. Partial indexes are
  -- intentionally excluded, so uq_guild_members_one_active_per_student stays.
  FOR r IN
    SELECT ci.relname AS index_name,
           array_agg(a.attname ORDER BY a.attname)::text[] AS cols
    FROM pg_index i
    JOIN pg_class ci ON ci.oid=i.indexrelid
    LEFT JOIN pg_constraint c ON c.conindid=i.indexrelid
    JOIN LATERAL unnest(i.indkey::int2[]) AS k(attnum) ON k.attnum <> 0
    JOIN pg_attribute a
      ON a.attrelid=i.indrelid AND a.attnum=k.attnum AND NOT a.attisdropped
    WHERE i.indrelid='public.guild_members'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND c.oid IS NULL
      AND i.indexprs IS NULL
      AND i.indpred IS NULL
    GROUP BY ci.relname
    HAVING array_agg(a.attname ORDER BY a.attname)::text[] = ARRAY['season_id','student_id']::text[]
        OR array_agg(a.attname ORDER BY a.attname)::text[] = ARRAY['guild_id','student_id']::text[]
        OR array_agg(a.attname ORDER BY a.attname)::text[] = ARRAY['guild_id','season_id','student_id']::text[]
  LOOP
    RAISE NOTICE '[G1.2] dropping history-blocking UNIQUE index: % (%)', r.index_name, array_to_string(r.cols, ',');
    EXECUTE format('DROP INDEX public.%I', r.index_name);
  END LOOP;
END $$;

-- Re-assert the only uniqueness rule Guild 1 actually needs: one ACTIVE row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_guild_members_one_active_per_student
  ON public.guild_members(student_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_guild_members_history_student
  ON public.guild_members(student_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS ix_guild_members_active_guild
  ON public.guild_members(guild_id, student_id)
  WHERE left_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- SQL Editor-safe postcheck: should return zero rows.
WITH unique_constraints AS (
  SELECT 'constraint'::text AS kind, c.conname AS name,
         array_agg(a.attname ORDER BY a.attname)::text[] AS cols
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum AND NOT a.attisdropped
  WHERE c.conrelid='public.guild_members'::regclass AND c.contype='u'
  GROUP BY c.conname
), standalone_unique_indexes AS (
  SELECT 'index'::text AS kind, ci.relname AS name,
         array_agg(a.attname ORDER BY a.attname)::text[] AS cols
  FROM pg_index i
  JOIN pg_class ci ON ci.oid=i.indexrelid
  LEFT JOIN pg_constraint c ON c.conindid=i.indexrelid
  JOIN LATERAL unnest(i.indkey::int2[]) AS k(attnum) ON k.attnum<>0
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum AND NOT a.attisdropped
  WHERE i.indrelid='public.guild_members'::regclass
    AND i.indisunique AND NOT i.indisprimary AND c.oid IS NULL
    AND i.indexprs IS NULL AND i.indpred IS NULL
  GROUP BY ci.relname
)
SELECT kind,name,cols
FROM (
  SELECT * FROM unique_constraints
  UNION ALL
  SELECT * FROM standalone_unique_indexes
) q
WHERE cols = ARRAY['season_id','student_id']::text[]
   OR cols = ARRAY['guild_id','student_id']::text[]
   OR cols = ARRAY['guild_id','season_id','student_id']::text[];
