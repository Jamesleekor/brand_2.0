-- B.R.A.N.D. 2.0 — Font cosmetics release
-- 27 font families, fixed price: 300 CRYSTAL
-- Safe/idempotent release migration. Does not touch non-font cosmetics.

BEGIN;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM public.cosmetic_items
  WHERE item_uid = ANY (ARRAY[
    'FONT_CHOSUN100','FONT_CHOSUNKM','FONT_CHOSUNLO','FONT_CHOSUNNM',
    'FONT_DALSEO_D','FONT_DALSEO_H','FONT_DANJO','FONT_DNF_BITBIT',
    'FONT_FUNFLOW','FONT_GHANA','FONT_MONGTORI','FONT_HEIRLIGHT',
    'FONT_KOPUB_B','FONT_KOPUB_D','FONT_LAUNDRY','FONT_MAPLE',
    'FONT_NXFOOTBALL','FONT_NXLV1','FONT_ONE_MOBILE','FONT_PINKFONG',
    'FONT_RIDI','FONT_SHILLA','FONT_TWAY_FLY','FONT_TWAY_SKY',
    'FONT_WARHAVEN','FONT_YPAIRING','FONT_YES24'
  ]::text[]);

  IF v_count <> 27 THEN
    RAISE EXCEPTION 'Font release aborted: expected 27 catalog items, found %', v_count;
  END IF;
END $$;

UPDATE public.cosmetic_items
SET
  is_active = true,
  description = '홈 화면에 적용할 수 있는 테마 폰트입니다. 구매 전 상점에서 실제 글꼴을 미리 볼 수 있습니다.',
  updated_at = now()
WHERE item_uid = ANY (ARRAY[
  'FONT_CHOSUN100','FONT_CHOSUNKM','FONT_CHOSUNLO','FONT_CHOSUNNM',
  'FONT_DALSEO_D','FONT_DALSEO_H','FONT_DANJO','FONT_DNF_BITBIT',
  'FONT_FUNFLOW','FONT_GHANA','FONT_MONGTORI','FONT_HEIRLIGHT',
  'FONT_KOPUB_B','FONT_KOPUB_D','FONT_LAUNDRY','FONT_MAPLE',
  'FONT_NXFOOTBALL','FONT_NXLV1','FONT_ONE_MOBILE','FONT_PINKFONG',
  'FONT_RIDI','FONT_SHILLA','FONT_TWAY_FLY','FONT_TWAY_SKY',
  'FONT_WARHAVEN','FONT_YPAIRING','FONT_YES24'
]::text[]);

DO $$
DECLARE
  v_item record;
  v_pricing_id integer;
BEGIN
  FOR v_item IN
    SELECT id, item_uid
    FROM public.cosmetic_items
    WHERE item_uid = ANY (ARRAY[
      'FONT_CHOSUN100','FONT_CHOSUNKM','FONT_CHOSUNLO','FONT_CHOSUNNM',
      'FONT_DALSEO_D','FONT_DALSEO_H','FONT_DANJO','FONT_DNF_BITBIT',
      'FONT_FUNFLOW','FONT_GHANA','FONT_MONGTORI','FONT_HEIRLIGHT',
      'FONT_KOPUB_B','FONT_KOPUB_D','FONT_LAUNDRY','FONT_MAPLE',
      'FONT_NXFOOTBALL','FONT_NXLV1','FONT_ONE_MOBILE','FONT_PINKFONG',
      'FONT_RIDI','FONT_SHILLA','FONT_TWAY_FLY','FONT_TWAY_SKY',
      'FONT_WARHAVEN','FONT_YPAIRING','FONT_YES24'
    ]::text[])
    ORDER BY id
  LOOP
    -- The release policy is exactly one active purchase option per font.
    UPDATE public.cosmetic_item_pricings
    SET is_active = false
    WHERE item_id = v_item.id;

    SELECT min(id)
    INTO v_pricing_id
    FROM public.cosmetic_item_pricings
    WHERE item_id = v_item.id
      AND value_token = 'CRYSTAL'::public.value_token_type;

    IF v_pricing_id IS NULL THEN
      INSERT INTO public.cosmetic_item_pricings (
        item_id,
        value_token,
        price,
        condition_type,
        condition_value,
        condition_description,
        secondary_condition_type,
        secondary_condition_value,
        is_active
      ) VALUES (
        v_item.id,
        'CRYSTAL'::public.value_token_type,
        300,
        'NONE'::public.cosmetic_condition_type,
        NULL,
        NULL,
        'NONE'::public.cosmetic_condition_type,
        NULL,
        true
      )
      RETURNING id INTO v_pricing_id;
    ELSE
      UPDATE public.cosmetic_item_pricings
      SET
        value_token = 'CRYSTAL'::public.value_token_type,
        price = 300,
        condition_type = 'NONE'::public.cosmetic_condition_type,
        condition_value = NULL,
        condition_description = NULL,
        secondary_condition_type = 'NONE'::public.cosmetic_condition_type,
        secondary_condition_value = NULL,
        is_active = true
      WHERE id = v_pricing_id;
    END IF;
  END LOOP;
END $$;

COMMIT;
