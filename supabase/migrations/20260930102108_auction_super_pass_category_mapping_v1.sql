-- ============================================================================
-- B.R.A.N.D 2.0 — Auction SUPER PASS category mapping v1
-- Applied to production: 2026-09-30
--
-- Purpose
-- * Map the three auction pass catalog items to their matching auction category.
-- * Student live state reports the correct pass quantity for the current item.
-- * apply_auction_super_pass reserves the correct pass instead of assuming a
--   classroom has exactly one AUCTION_SUPER_PASS item.
-- * Special/other auction categories have no pass in multi-pass classrooms.
-- * Preserve legacy/test classrooms that still have exactly one generic pass.
-- ============================================================================

BEGIN;

UPDATE public.market_items
SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{auction_category}', to_jsonb('자리'::text), true),
    updated_at = now()
WHERE use_mode::text = 'AUCTION_SUPER_PASS'
  AND item_type::text = 'AUCTION_PASS'
  AND name = '[경매형] 자리 슈퍼패스(1회권)';

UPDATE public.market_items
SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{auction_category}', to_jsonb('급식순서'::text), true),
    updated_at = now()
WHERE use_mode::text = 'AUCTION_SUPER_PASS'
  AND item_type::text = 'AUCTION_PASS'
  AND name = '[경매형] 급식 슈퍼패스(1회권)';

UPDATE public.market_items
SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{auction_category}', to_jsonb('1인1역'::text), true),
    updated_at = now()
WHERE use_mode::text = 'AUCTION_SUPER_PASS'
  AND item_type::text = 'AUCTION_PASS'
  AND name = '[경매형] 1인1역 슈퍼패스(1회권)';

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.market_items
    WHERE use_mode::text = 'AUCTION_SUPER_PASS'
      AND item_type::text = 'AUCTION_PASS'
      AND is_active = true
      AND is_usable = true
      AND coalesce(is_archived, false) = false
      AND metadata->>'auction_category' IN ('자리','1인1역','급식순서')
    GROUP BY classroom_id, metadata->>'auction_category'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SUPER PASS category mapping postcheck failed: duplicate active mapping';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION public._auction_super_pass_catalog_item(
  p_classroom_id integer,
  p_auction_category text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer := 0;
  v_item_id bigint := NULL;
  v_total_count integer := 0;
  v_total_item_id bigint := NULL;
BEGIN
  IF p_classroom_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_auction_category IN ('자리','1인1역','급식순서') THEN
    SELECT count(*), min(id)::bigint
      INTO v_count, v_item_id
    FROM public.market_items
    WHERE classroom_id = p_classroom_id
      AND use_mode::text = 'AUCTION_SUPER_PASS'
      AND item_type::text = 'AUCTION_PASS'
      AND is_active = true
      AND is_usable = true
      AND coalesce(is_archived, false) = false
      AND metadata->>'auction_category' = p_auction_category;

    IF v_count = 1 THEN
      RETURN v_item_id;
    END IF;

    IF v_count > 1 THEN
      RAISE EXCEPTION '경매 카테고리(%)에 매핑된 사용 가능한 SUPER PASS 상품이 둘 이상입니다.', p_auction_category
        USING ERRCODE = 'P0891';
    END IF;
  END IF;

  -- Legacy/test compatibility: if a classroom still has exactly one active
  -- generic pass, preserve the previous single-pass behavior.
  SELECT count(*), min(id)::bigint
    INTO v_total_count, v_total_item_id
  FROM public.market_items
  WHERE classroom_id = p_classroom_id
    AND use_mode::text = 'AUCTION_SUPER_PASS'
    AND item_type::text = 'AUCTION_PASS'
    AND is_active = true
    AND is_usable = true
    AND coalesce(is_archived, false) = false;

  IF v_total_count = 1 THEN
    RETURN v_total_item_id;
  END IF;

  -- Multi-pass classrooms intentionally expose no pass for unsupported types.
  IF p_auction_category NOT IN ('자리','1인1역','급식순서') OR p_auction_category IS NULL THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION '경매 카테고리(%)에 매핑된 사용 가능한 SUPER PASS 상품이 없습니다.', p_auction_category
    USING ERRCODE = 'P0890';
END;
$function$;

REVOKE ALL ON FUNCTION public._auction_super_pass_catalog_item(integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._auction_super_pass_catalog_item(integer,text) FROM anon;
REVOKE ALL ON FUNCTION public._auction_super_pass_catalog_item(integer,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._auction_super_pass_catalog_item(integer,text) TO service_role;

-- Patch the authoritative student apply RPC while retaining all existing
-- settlement/reservation semantics from the deployed function.
DO $patch_apply$
DECLARE
  v_def text;
  v_old text := 'v_pass_item_id := public._auction_super_pass_catalog_item(v_auction.classroom_id);';
  v_new text := E'v_pass_item_id := public._auction_super_pass_catalog_item(v_auction.classroom_id, v_item.category);\n\n  IF v_pass_item_id IS NULL THEN\n    RAISE EXCEPTION ''현재 경매 카테고리(%)에는 사용할 수 있는 SUPER PASS가 없습니다.'', v_item.category USING ERRCODE = ''P0890'';\n  END IF;';
BEGIN
  v_def := pg_get_functiondef('public.apply_auction_super_pass(integer)'::regprocedure);
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Patch anchor not found: apply_auction_super_pass catalog helper';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_apply$;

-- Patch live state so the existing frontend automatically displays the pass
-- quantity belonging to the current auction item category.
DO $patch_state$
DECLARE
  v_def text;
  v_old text := E'  SELECT min(id)::bigint INTO v_pass_item_id\n  FROM public.market_items\n  WHERE classroom_id = p_classroom_id\n    AND use_mode::text = ''AUCTION_SUPER_PASS''\n    AND item_type::text = ''AUCTION_PASS''\n    AND is_active = true\n    AND is_usable = true\n    AND coalesce(is_archived, false) = false;\n\n  IF v_auction.current_item_id IS NOT NULL THEN';
  v_new text := E'  v_pass_item_id := NULL;\n\n  IF v_auction.current_item_id IS NOT NULL THEN\n    SELECT public._auction_super_pass_catalog_item(p_classroom_id, ci.category)\n      INTO v_pass_item_id\n    FROM public.auction_items ci\n    WHERE ci.id = v_auction.current_item_id;';
BEGIN
  v_def := replace(pg_get_functiondef('public.get_live_auction_state(integer,boolean)'::regprocedure), E'\r\n', E'\n');
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Patch anchor not found: get_live_auction_state pass selector';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_state$;

COMMIT;
