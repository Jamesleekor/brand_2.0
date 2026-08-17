-- =============================================================================
-- B.R.A.N.D 2.0 — Guild5 Conquest Map Marker / Territory Tax Snapshot
-- 2026-08-17 incremental migration
--
-- Adds:
--   * configurable territory tax_rate_percent (default 5%)
--   * territory slot/tax snapshot on conquest assignment
--   * guild logo snapshot for FINAL ranking markers
--   * richer student Guild5 history RPC for interactive conquest map UI
--
-- NOTE:
--   tax_rate_percent is conquest metadata only in this migration.
--   It does NOT create automatic economy tax collection.
-- =============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild5_territories') IS NULL
     OR to_regclass('public.guild5_conquest_turns') IS NULL
     OR to_regclass('public.guild5_guild_snapshots') IS NULL
     OR to_regprocedure('public.student_get_guild5_monthly_history()') IS NULL THEN
    RAISE EXCEPTION '[G5 MAP] Guild5 base migration must be applied first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Territory tax config + immutable conquest assignment snapshots.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild5_territories
  ADD COLUMN IF NOT EXISTS tax_rate_percent numeric(5,2);

UPDATE public.guild5_territories
SET tax_rate_percent = 5.00
WHERE tax_rate_percent IS NULL;

ALTER TABLE public.guild5_territories
  ALTER COLUMN tax_rate_percent SET DEFAULT 5.00,
  ALTER COLUMN tax_rate_percent SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid='public.guild5_territories'::regclass
      AND conname='guild5_territory_tax_rate_check'
  ) THEN
    ALTER TABLE public.guild5_territories
      ADD CONSTRAINT guild5_territory_tax_rate_check
      CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100);
  END IF;
END $$;

ALTER TABLE public.guild5_conquest_turns
  ADD COLUMN IF NOT EXISTS territory_slot_no_snapshot smallint,
  ADD COLUMN IF NOT EXISTS territory_tax_rate_snapshot numeric(5,2),
  ADD COLUMN IF NOT EXISTS territory_description_snapshot text;

UPDATE public.guild5_conquest_turns ct
SET territory_slot_no_snapshot = t.slot_no,
    territory_tax_rate_snapshot = t.tax_rate_percent,
    territory_description_snapshot = t.description
FROM public.guild5_territories t
WHERE ct.territory_id=t.id
  AND (
    ct.territory_slot_no_snapshot IS NULL
    OR ct.territory_tax_rate_snapshot IS NULL
    OR ct.territory_description_snapshot IS NULL
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.guild5_conquest_turns'::regclass
      AND conname='guild5_turn_territory_slot_snapshot_check'
  ) THEN
    ALTER TABLE public.guild5_conquest_turns
      ADD CONSTRAINT guild5_turn_territory_slot_snapshot_check
      CHECK (territory_slot_no_snapshot IS NULL OR territory_slot_no_snapshot BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.guild5_conquest_turns'::regclass
      AND conname='guild5_turn_territory_tax_snapshot_check'
  ) THEN
    ALTER TABLE public.guild5_conquest_turns
      ADD CONSTRAINT guild5_turn_territory_tax_snapshot_check
      CHECK (territory_tax_rate_snapshot IS NULL OR (territory_tax_rate_snapshot >= 0 AND territory_tax_rate_snapshot <= 100));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guild5_capture_conquest_territory_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_territory public.guild5_territories%ROWTYPE;
  v_capture boolean:=false;
BEGIN
  IF NEW.territory_id IS NULL THEN
    NEW.territory_slot_no_snapshot:=NULL;
    NEW.territory_tax_rate_snapshot:=NULL;
    NEW.territory_description_snapshot:=NULL;
    RETURN NEW;
  END IF;

  IF TG_OP='INSERT' THEN
    v_capture:=true;
  ELSE
    v_capture:=
      NEW.territory_slot_no_snapshot IS NULL
      OR NEW.territory_tax_rate_snapshot IS NULL
      OR (
        NEW.territory_description_snapshot IS NULL
        AND EXISTS(
          SELECT 1
          FROM public.guild5_territories t0
          WHERE t0.id=NEW.territory_id
            AND t0.description IS NOT NULL
        )
      )
      OR NEW.territory_id IS DISTINCT FROM OLD.territory_id;
  END IF;

  IF v_capture THEN
    SELECT * INTO v_territory
    FROM public.guild5_territories
    WHERE id=NEW.territory_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[G5 MAP] territory not found for conquest snapshot.';
    END IF;

    NEW.territory_slot_no_snapshot:=v_territory.slot_no;
    NEW.territory_tax_rate_snapshot:=v_territory.tax_rate_percent;
    NEW.territory_description_snapshot:=v_territory.description;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guild5_capture_conquest_territory_snapshot ON public.guild5_conquest_turns;
CREATE TRIGGER trg_guild5_capture_conquest_territory_snapshot
BEFORE INSERT OR UPDATE OF territory_id ON public.guild5_conquest_turns
FOR EACH ROW
EXECUTE FUNCTION public.guild5_capture_conquest_territory_snapshot();

REVOKE ALL ON FUNCTION public.guild5_capture_conquest_territory_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild5_capture_conquest_territory_snapshot() TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Guild logo snapshot for historical FINAL ranking markers.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild5_guild_snapshots
  ADD COLUMN IF NOT EXISTS guild_logo_url_at_close text;

UPDATE public.guild5_guild_snapshots s
SET guild_logo_url_at_close=g.logo_url
FROM public.guilds g
WHERE g.id=s.guild_id
  AND s.guild_logo_url_at_close IS NULL
  AND g.logo_url IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guild5_capture_guild_logo_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF NEW.guild_logo_url_at_close IS NULL THEN
    SELECT g.logo_url INTO NEW.guild_logo_url_at_close
    FROM public.guilds g
    WHERE g.id=NEW.guild_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guild5_capture_guild_logo_snapshot ON public.guild5_guild_snapshots;
CREATE TRIGGER trg_guild5_capture_guild_logo_snapshot
BEFORE INSERT ON public.guild5_guild_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guild5_capture_guild_logo_snapshot();

REVOKE ALL ON FUNCTION public.guild5_capture_guild_logo_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild5_capture_guild_logo_snapshot() TO service_role;

-- -----------------------------------------------------------------------------
-- 3. New combined teacher territory config RPC. Keep old RPC for compatibility.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_set_guild5_territory_v2(
  p_season_id integer,
  p_slot_no integer,
  p_territory_name text,
  p_description text DEFAULT NULL,
  p_tax_rate_percent numeric DEFAULT 5.00
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_class integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  IF p_slot_no NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION '[G5] territory slot must be 1..3.' USING ERRCODE='P0506';
  END IF;
  IF char_length(btrim(coalesce(p_territory_name,''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '[G5] territory name is required.' USING ERRCODE='P0507';
  END IF;
  IF p_tax_rate_percent IS NULL OR p_tax_rate_percent < 0 OR p_tax_rate_percent > 100 THEN
    RAISE EXCEPTION '[G5] territory tax rate must be between 0 and 100.' USING ERRCODE='P0509';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.guild_seasons s
    WHERE s.id=p_season_id AND s.classroom_id=v_class
  ) THEN
    RAISE EXCEPTION '[G5] season mismatch.' USING ERRCODE='P0508';
  END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=p_season_id) THEN
    RAISE EXCEPTION '[G5] season is locked.' USING ERRCODE='P0504';
  END IF;

  INSERT INTO public.guild5_territories(
    classroom_id,season_id,slot_no,territory_name,description,tax_rate_percent,updated_by_user_id,updated_at
  )
  VALUES(
    v_class,p_season_id,p_slot_no,btrim(p_territory_name),
    nullif(btrim(coalesce(p_description,'')),''),
    p_tax_rate_percent,auth.uid(),now()
  )
  ON CONFLICT(season_id,slot_no) DO UPDATE
  SET territory_name=EXCLUDED.territory_name,
      description=EXCLUDED.description,
      tax_rate_percent=EXCLUDED.tax_rate_percent,
      updated_by_user_id=auth.uid(),
      updated_at=now();

  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',id,
        'slot_no',slot_no,
        'territory_name',territory_name,
        'description',description,
        'tax_rate_percent',tax_rate_percent
      )
      ORDER BY slot_no
    )
    FROM public.guild5_territories
    WHERE classroom_id=v_class AND season_id=p_season_id
  );
END $$;

REVOKE ALL ON FUNCTION public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild5_territory_v2(integer,integer,text,text,numeric) TO authenticated,service_role;

-- -----------------------------------------------------------------------------
-- 4. Rich student history payload for map markers / popovers / compact ranking.
--    Territory tax/slot are read from conquest snapshots, never live config.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_guild5_monthly_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student integer;
  v_class integer;
  v_result jsonb;
BEGIN
  v_student:=public.current_student_id();
  v_class:=public.current_classroom_id();

  IF v_student IS NULL OR v_class IS NULL THEN
    RAISE EXCEPTION '[G5] student context missing.' USING ERRCODE='P0540';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'year_month' DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'year_month',c.year_month,
      'version_no',v.version_no,
      'finalized_at',v.finalized_at,
      'my_contribution',to_jsonb(ss),
      'my_guild',to_jsonb(gs) || jsonb_build_object(
        'cumulative_final_gs',(
          SELECT coalesce(sum(gs2.total_gs),0)
          FROM public.guild5_month_closures c2
          JOIN public.guild5_guild_snapshots gs2 ON gs2.version_id=c2.current_version_id
          WHERE c2.classroom_id=v_class
            AND c2.lifecycle_state='FINALIZED'
            AND gs2.guild_id=ss.guild_id
        )
      ),
      'territory',(
        SELECT to_jsonb(ct) || jsonb_build_object(
          'territory_slot_no',ct.territory_slot_no_snapshot,
          'tax_rate_percent',ct.territory_tax_rate_snapshot,
          'territory_description',ct.territory_description_snapshot
        )
        FROM public.guild5_conquest_turns ct
        WHERE ct.version_id=v.id
          AND ct.guild_id=ss.guild_id
          AND ct.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
      ),
      'rankings',(
        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'guild_id',r.guild_id,
              'guild_name_at_close',r.guild_name_at_close,
              'guild_logo_url_at_close',r.guild_logo_url_at_close,
              'rank_position',r.rank_position,
              'total_gs',r.total_gs,
              'territory',ct2.territory_name_snapshot,
              'territory_id',ct2.territory_id,
              'territory_slot_no',ct2.territory_slot_no_snapshot,
              'tax_rate_percent',ct2.territory_tax_rate_snapshot,
              'territory_description',ct2.territory_description_snapshot
            )
            ORDER BY r.rank_position
          ),
          '[]'::jsonb
        )
        FROM public.guild5_guild_snapshots r
        LEFT JOIN public.guild5_conquest_turns ct2
          ON ct2.version_id=v.id
         AND ct2.guild_id=r.guild_id
         AND ct2.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
        WHERE r.version_id=v.id
      )
    ) AS item
    FROM public.guild5_month_closures c
    JOIN public.guild5_closure_versions v ON v.id=c.current_version_id
    JOIN public.guild5_student_snapshots ss ON ss.version_id=v.id AND ss.student_id=v_student
    JOIN public.guild5_guild_snapshots gs ON gs.version_id=v.id AND gs.guild_id=ss.guild_id
    WHERE c.classroom_id=v_class
      AND c.lifecycle_state='FINALIZED'
  ) q;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.student_get_guild5_monthly_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild5_monthly_history() TO authenticated,service_role;

COMMIT;
