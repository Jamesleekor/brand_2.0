-- B.R.A.N.D. 2.0 — Stage font cosmetics until matching frontend/assets are deployed.
-- Pricing stays configured; items are hidden from student queries by is_active=false.

UPDATE public.cosmetic_items
SET is_active = false,
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
