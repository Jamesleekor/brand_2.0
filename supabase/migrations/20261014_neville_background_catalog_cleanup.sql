-- The old and current Seren entries share an image. Keep the old record
-- inactive for historical ownership, and retire its unused price.
do $$
begin
  if not exists (
    select 1 from public.cosmetic_items
    where id = 30 and item_uid = 'DG_BG_CHAR_081_E01_C0103'
  ) or not exists (
    select 1 from public.cosmetic_items
    where id = 31 and item_uid = 'DG_BG_CHAR_081_E01_C0186'
  ) or not exists (
    select 1 from public.cosmetic_items
    where id = 32 and item_uid = 'DG_BG_CHAR_081_E01_C0278'
  ) or not exists (
    select 1 from public.cosmetic_items
    where id = 33 and item_uid = 'DG_BG_CHAR_081_E01_C0472'
  ) then
    raise exception 'Neville background catalog differs from expected snapshot';
  end if;
end;
$$;

update public.cosmetic_item_pricings
set is_active = false
where id = 52 and item_id = 30;

-- The old CG and the newer sky-boundary background are distinct assets.
-- Restore the CG as a grantable/usable cosmetic without changing the
-- current story gallery's active scene list.
update public.cosmetic_items
set is_active = true, is_market_visible = false, updated_at = now()
where id = 31 and item_uid = 'DG_BG_CHAR_081_E01_C0186';

update public.cosmetic_items
set name = '하늘의 경계', updated_at = now()
where id = 33 and item_uid = 'DG_BG_CHAR_081_E01_C0472';

update public.dimensional_gate_gallery_assets
set title = '하늘의 경계', updated_at = now()
where id = 251 and cosmetic_item_id = 33;
