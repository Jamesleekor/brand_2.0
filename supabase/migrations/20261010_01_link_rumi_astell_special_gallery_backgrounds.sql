-- Link the four already-eligible Rumi/Astell special gallery images to home backgrounds.
-- Safe to rerun: fixed gallery IDs and item UIDs, checked before touching ownership.
do $migration$
declare
  v record;
  v_asset public.dimensional_gate_gallery_assets%rowtype;
  v_item public.cosmetic_items%rowtype;
begin
  for v in
    select * from (values
      (243::bigint, 22::bigint, '아스텔 특별 CG 1'::text, 'DG_BG_GALLERY_243'::text),
      (244::bigint, 22::bigint, '아스텔 특별 CG 2'::text, 'DG_BG_GALLERY_244'::text),
      (245::bigint, 12::bigint, '루미 특별 CG 1'::text, 'DG_BG_GALLERY_245'::text),
      (246::bigint, 12::bigint, '루미 특별 CG 2'::text, 'DG_BG_GALLERY_246'::text)
    ) as target(gallery_id, character_id, title, item_uid)
  loop
    select * into v_asset
    from public.dimensional_gate_gallery_assets
    where id = v.gallery_id for update;

    if not found or v_asset.character_id <> v.character_id
       or v_asset.asset_type <> 'SPECIAL_CG'
       or v_asset.title <> v.title
       or v_asset.home_background_allowed is distinct from true
       or v_asset.is_active is distinct from true
       or nullif(btrim(v_asset.image_url), '') is null then
      raise exception 'Gallery background preflight failed for asset %', v.gallery_id;
    end if;

    select * into v_item
    from public.cosmetic_items
    where item_uid = v.item_uid;

    if found then
      if v_item.category <> 'background'
         or v_item.name <> v.title
         or v_item.resource_url <> v_asset.image_url
         or v_item.is_active is distinct from true
         or v_item.classroom_id is not null then
        raise exception 'Cosmetic item UID conflict for asset %', v.gallery_id;
      end if;
    else
      insert into public.cosmetic_items
        (item_uid, category, name, description, resource_url, is_active)
      values
        (v.item_uid, 'background', v.title,
         '차원관문 특별 화첩에서 획득하는 홈 배경', v_asset.image_url, true)
      returning * into v_item;
    end if;

    if v_asset.cosmetic_item_id is not null and v_asset.cosmetic_item_id <> v_item.id then
      raise exception 'Gallery asset % already linked to a different item', v.gallery_id;
    end if;

    update public.dimensional_gate_gallery_assets
    set cosmetic_item_id = v_item.id
    where id = v.gallery_id and cosmetic_item_id is distinct from v_item.id;

    insert into public.student_cosmetic_ownerships
      (student_id, item_id, obtained_via, is_equipped, purchased_at)
    select u.student_id, v_item.id, 'STORY_REWARD'::public.cosmetic_obtained_via,
           false, u.unlocked_at
    from public.dimensional_gate_gallery_unlocks u
    where u.gallery_asset_id = v.gallery_id
    on conflict (student_id, item_id) do nothing;
  end loop;
end
$migration$;
