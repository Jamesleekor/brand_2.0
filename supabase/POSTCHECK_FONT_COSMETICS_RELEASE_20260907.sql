-- READ ONLY postcheck for 2026-09-07 font cosmetics release.
SELECT
  count(*) AS total_fonts,
  count(*) FILTER (WHERE ci.is_active) AS active_fonts,
  count(*) FILTER (
    WHERE cip.is_active
      AND cip.value_token = 'CRYSTAL'::public.value_token_type
      AND cip.price = 300
  ) AS correctly_priced_fonts
FROM public.cosmetic_items ci
LEFT JOIN public.cosmetic_item_pricings cip ON cip.item_id = ci.id
WHERE ci.item_uid LIKE 'FONT_%';

SELECT
  ci.item_uid,
  ci.name,
  ci.is_active,
  count(cip.id) FILTER (WHERE cip.is_active) AS active_pricing_count,
  max(cip.value_token::text) FILTER (WHERE cip.is_active) AS value_token,
  max(cip.price) FILTER (WHERE cip.is_active) AS price
FROM public.cosmetic_items ci
LEFT JOIN public.cosmetic_item_pricings cip ON cip.item_id = ci.id
WHERE ci.item_uid LIKE 'FONT_%'
GROUP BY ci.id, ci.item_uid, ci.name, ci.is_active
ORDER BY ci.item_uid;
