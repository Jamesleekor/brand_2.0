-- B.R.A.N.D. 2.0 — Cosmetic RPC execute hardening
-- External clients must use the self-scoped wrappers only.

REVOKE EXECUTE ON FUNCTION public.purchase_cosmetic_item(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.equip_cosmetic_item(integer, bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.student_purchase_cosmetic(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_set_cosmetic_selection(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_purchase_cosmetic(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_set_cosmetic_selection(text, bigint) TO authenticated;

ALTER FUNCTION public.student_purchase_cosmetic(integer, integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.student_set_cosmetic_selection(text, bigint)
  SET search_path = public, pg_temp;
