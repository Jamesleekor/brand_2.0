-- =============================================================================
-- B.R.A.N.D 2.0 — Guild5 territory auction economy preview + immutable snapshot
-- 2026-10-07 incremental migration
--
-- Territory slot/category mapping (world map contract):
--   slot 1 = 1인1역 (left mountain stronghold)
--   slot 2 = 자리     (central royal castle)
--   slot 3 = 급식순서 (right coastal stronghold)
--
-- This migration only CALCULATES/DISPLAYS projected territory revenue.
-- It does not collect, deduct, or pay GOLD automatically.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.guild5_territory_economy_snapshots (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  year_month text NOT NULL,
  slot_no smallint NOT NULL CHECK (slot_no BETWEEN 1 AND 3),
  territory_id bigint,
  territory_name_snapshot text,
  territory_description_snapshot text,
  tax_rate_percent_snapshot numeric(5,2) NOT NULL CHECK (tax_rate_percent_snapshot BETWEEN 0 AND 100),
  auction_category text NOT NULL CHECK (auction_category IN ('자리','1인1역','급식순서')),
  auction_id integer,
  auction_round_number integer,
  auction_school_year integer,
  auction_ended_at timestamptz,
  settled_item_count integer NOT NULL DEFAULT 0 CHECK (settled_item_count >= 0),
  gross_spend bigint NOT NULL DEFAULT 0 CHECK (gross_spend >= 0),
  projected_revenue numeric(20,2) NOT NULL DEFAULT 0 CHECK (projected_revenue >= 0),
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id, slot_no)
);

ALTER TABLE public.guild5_territory_economy_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guild5_territory_economy_snapshots FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS ix_guild5_territory_economy_snapshot_version
  ON public.guild5_territory_economy_snapshots(version_id, slot_no);

CREATE OR REPLACE FUNCTION public.guild5_build_territory_auction_economy(
  p_classroom_id integer,
  p_season_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT a.*
  INTO v_auction
  FROM public.auctions a
  WHERE a.classroom_id=p_classroom_id
    AND a.status='COMPLETED'
    AND 3 = (
      SELECT count(DISTINCT i.category)::integer
      FROM public.auction_items i
      JOIN public.auction_results r ON r.auction_item_id=i.id
      JOIN public.transactions tx ON tx.id=r.transaction_id
      WHERE i.auction_id=a.id
        AND i.category IN ('자리','1인1역','급식순서')
        AND tx.value_token='GOLD'
        AND tx.amount < 0
        AND NOT tx.is_reversed
    )
  ORDER BY coalesce(a.ended_at,a.started_at,a.created_at) DESC, a.id DESC
  LIMIT 1;

  WITH slots(slot_no, auction_category) AS (
    VALUES
      (1::smallint, '1인1역'::text),
      (2::smallint, '자리'::text),
      (3::smallint, '급식순서'::text)
  ), totals AS (
    SELECT
      i.category::text AS auction_category,
      count(r.id)::integer AS settled_item_count,
      coalesce(sum(r.final_price),0)::bigint AS gross_spend
    FROM public.auction_items i
    JOIN public.auction_results r ON r.auction_item_id=i.id
    JOIN public.transactions tx ON tx.id=r.transaction_id
    WHERE v_auction.id IS NOT NULL
      AND i.auction_id=v_auction.id
      AND i.category IN ('자리','1인1역','급식순서')
      AND tx.value_token='GOLD'
      AND tx.amount < 0
      AND NOT tx.is_reversed
    GROUP BY i.category
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'slot_no',s.slot_no,
      'territory_id',t.id,
      'territory_name',t.territory_name,
      'territory_description',t.description,
      'tax_rate_percent',t.tax_rate_percent,
      'auction_category',s.auction_category,
      'auction_id',v_auction.id,
      'auction_round_number',v_auction.round_number,
      'auction_school_year',v_auction.school_year,
      'auction_ended_at',v_auction.ended_at,
      'settled_item_count',coalesce(x.settled_item_count,0),
      'gross_spend',coalesce(x.gross_spend,0),
      'projected_revenue',round(
        coalesce(x.gross_spend,0)::numeric * coalesce(t.tax_rate_percent,0)::numeric / 100,
        2
      )
    )
    ORDER BY s.slot_no
  ),'[]'::jsonb)
  INTO v_result
  FROM slots s
  LEFT JOIN public.guild5_territories t
    ON t.classroom_id=p_classroom_id
   AND t.season_id=p_season_id
   AND t.slot_no=s.slot_no
  LEFT JOIN totals x ON x.auction_category=s.auction_category;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.guild5_build_territory_auction_economy(integer,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guild5_capture_territory_auction_economy_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_closure public.guild5_month_closures%ROWTYPE;
  v_item jsonb;
BEGIN
  SELECT * INTO v_closure
  FROM public.guild5_month_closures c
  WHERE c.id=NEW.closure_id;

  IF v_closure.id IS NULL THEN
    RAISE EXCEPTION '[G5 ECON] closure not found for version %.',NEW.id;
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(
      public.guild5_build_territory_auction_economy(v_closure.classroom_id,v_closure.season_id)
    )
  LOOP
    INSERT INTO public.guild5_territory_economy_snapshots(
      version_id,classroom_id,season_id,year_month,slot_no,
      territory_id,territory_name_snapshot,territory_description_snapshot,
      tax_rate_percent_snapshot,auction_category,
      auction_id,auction_round_number,auction_school_year,auction_ended_at,
      settled_item_count,gross_spend,projected_revenue
    )
    VALUES(
      NEW.id,
      v_closure.classroom_id,
      v_closure.season_id,
      v_closure.year_month,
      (v_item->>'slot_no')::smallint,
      nullif(v_item->>'territory_id','')::bigint,
      v_item->>'territory_name',
      v_item->>'territory_description',
      coalesce((v_item->>'tax_rate_percent')::numeric,0),
      v_item->>'auction_category',
      nullif(v_item->>'auction_id','')::integer,
      nullif(v_item->>'auction_round_number','')::integer,
      nullif(v_item->>'auction_school_year','')::integer,
      nullif(v_item->>'auction_ended_at','')::timestamptz,
      coalesce((v_item->>'settled_item_count')::integer,0),
      coalesce((v_item->>'gross_spend')::bigint,0),
      coalesce((v_item->>'projected_revenue')::numeric,0)
    )
    ON CONFLICT(version_id,slot_no) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guild5_capture_territory_auction_economy_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guild5_capture_territory_auction_economy_snapshot
  ON public.guild5_closure_versions;
CREATE TRIGGER trg_guild5_capture_territory_auction_economy_snapshot
AFTER INSERT ON public.guild5_closure_versions
FOR EACH ROW
EXECUTE FUNCTION public.guild5_capture_territory_auction_economy_snapshot();

CREATE OR REPLACE FUNCTION public.teacher_get_guild5_dashboard(p_year_month text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_season integer;
  v_preview jsonb;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_current bigint;
  v_result jsonb;
  v_territory_economy jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  PERFORM public.guild2_refresh_monthly_scores(v_class,p_year_month);
  v_preview:=public.guild5_build_close_preview(v_class,v_season,p_year_month);

  SELECT * INTO v_closure
  FROM public.guild5_month_closures
  WHERE classroom_id=v_class AND season_id=v_season AND year_month=p_year_month;

  v_current:=v_closure.current_version_id;
  IF v_current IS NOT NULL AND v_closure.lifecycle_state='FINALIZED' THEN
    PERFORM public.guild5_process_due_conquest_internal(v_current);
  END IF;

  IF v_current IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'slot_no',e.slot_no,
      'territory_id',e.territory_id,
      'territory_name',e.territory_name_snapshot,
      'territory_description',e.territory_description_snapshot,
      'tax_rate_percent',e.tax_rate_percent_snapshot,
      'auction_category',e.auction_category,
      'auction_id',e.auction_id,
      'auction_round_number',e.auction_round_number,
      'auction_school_year',e.auction_school_year,
      'auction_ended_at',e.auction_ended_at,
      'settled_item_count',e.settled_item_count,
      'gross_spend',e.gross_spend,
      'projected_revenue',e.projected_revenue,
      'snapshot',true
    ) ORDER BY e.slot_no),'[]'::jsonb)
    INTO v_territory_economy
    FROM public.guild5_territory_economy_snapshots e
    WHERE e.version_id=v_current;
  END IF;

  IF v_territory_economy IS NULL OR jsonb_array_length(v_territory_economy)=0 THEN
    v_territory_economy:=public.guild5_build_territory_auction_economy(v_class,v_season);
  END IF;

  SELECT jsonb_build_object(
    'preview',v_preview,
    'season',(SELECT to_jsonb(s) FROM (SELECT id,display_name,school_year,starts_on,ends_on,lifecycle_status FROM public.guild_seasons WHERE id=v_season) s),
    'season_lock',(SELECT to_jsonb(sl) FROM public.guild5_season_locks sl WHERE sl.season_id=v_season),
    'is_test_fixture',EXISTS(SELECT 1 FROM public.test_classroom_fixtures f WHERE f.classroom_id=v_class AND f.fixture_code='BRAND_TEST_V1'),
    'territories',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY slot_no) FROM public.guild5_territories t WHERE t.classroom_id=v_class AND t.season_id=v_season),'[]'::jsonb),
    'territory_economy',coalesce(v_territory_economy,'[]'::jsonb),
    'closure',CASE WHEN v_closure.id IS NULL THEN NULL ELSE to_jsonb(v_closure) END,
    'versions',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no DESC) FROM public.guild5_closure_versions v WHERE v.closure_id=v_closure.id),'[]'::jsonb),
    'guild_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(gs) ORDER BY rank_position) FROM public.guild5_guild_snapshots gs WHERE gs.version_id=v_current),'[]'::jsonb),
    'student_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(ss) ORDER BY guild_id,student_id) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_current),'[]'::jsonb),
    'conquest_turns',coalesce((SELECT jsonb_agg(to_jsonb(ct) ORDER BY rank_position) FROM public.guild5_conquest_turns ct WHERE ct.version_id=v_current),'[]'::jsonb),
    'audit',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY occurred_at DESC,id DESC) FROM public.guild5_audit_events a WHERE a.closure_id=v_closure.id),'[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_get_guild5_monthly_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
      'territory_economy',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'slot_no',e.slot_no,
          'territory_id',e.territory_id,
          'territory_name',e.territory_name_snapshot,
          'territory_description',e.territory_description_snapshot,
          'tax_rate_percent',e.tax_rate_percent_snapshot,
          'auction_category',e.auction_category,
          'auction_id',e.auction_id,
          'auction_round_number',e.auction_round_number,
          'auction_school_year',e.auction_school_year,
          'auction_ended_at',e.auction_ended_at,
          'settled_item_count',e.settled_item_count,
          'gross_spend',e.gross_spend,
          'projected_revenue',e.projected_revenue,
          'snapshot',true
        ) ORDER BY e.slot_no),'[]'::jsonb)
        FROM public.guild5_territory_economy_snapshots e
        WHERE e.version_id=v.id
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
END;
$function$;

COMMIT;
