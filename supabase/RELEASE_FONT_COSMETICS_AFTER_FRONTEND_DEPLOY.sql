-- B.R.A.N.D. 2.0 — Final font-cosmetic release gate.
-- RUN ONLY AFTER the matching frontend and /public/fonts WOFF2 assets are deployed.

DO $$
DECLARE
  v_items integer;
  v_prices integer;
  v_uids text[] := ARRAY[
    'FONT_CHOSUN100','FONT_CHOSUNKM','FONT_CHOSUNLO','FONT_CHOSUNNM',
    'FONT_DALSEO_D','FONT_DALSEO_H','FONT_DANJO','FONT_DNF_BITBIT',
    'FONT_FUNFLOW','FONT_GHANA','FONT_MONGTORI','FONT_HEIRLIGHT',
    'FONT_KOPUB_B','FONT_KOPUB_D','FONT_LAUNDRY','FONT_MAPLE',
    'FONT_NXFOOTBALL','FONT_NXLV1','FONT_ONE_MOBILE','FONT_PINKFONG',
    'FONT_RIDI','FONT_SHILLA','FONT_TWAY_FLY','FONT_TWAY_SKY',
    'FONT_WARHAVEN','FONT_YPAIRING','FONT_YES24'
  ]::text[];
BEGIN
  SELECT count(*) INTO v_items
  FROM public.cosmetic_items
  WHERE item_uid = ANY (v_uids);

  SELECT count(*) INTO v_prices
  FROM public.cosmetic_items ci
  JOIN public.cosmetic_item_pricings cip ON cip.item_id = ci.id
  WHERE ci.item_uid = ANY (v_uids)
    AND cip.is_active = true
    AND cip.value_token = 'CRYSTAL'::public.value_token_type
    AND cip.price = 300;

  IF v_items <> 27 OR v_prices <> 27 THEN
    RAISE EXCEPTION 'Font release aborted: items=% prices=% (expected 27/27)', v_items, v_prices;
  END IF;

  UPDATE public.cosmetic_items
  SET is_active = true,
      updated_at = now()
  WHERE item_uid = ANY (v_uids);
END $$;
