-- B.R.A.N.D 2.0 C-class nameplate effects.
-- Safe to run more than once. Existing ownership and purchase history are preserved.

begin;

insert into public.cosmetic_items
  (item_uid, category, name, description, resource_url, is_active)
values
  ('NAMEFX_CORONATION_2026', 'nameplate_effect', '황금 대관식', '빛기둥을 타고 강림하고 금빛 잔불을 남기는 이름 등장 효과.', 'namefx:coronation', true),
  ('NAMEFX_CONSTELLATION_2026', 'nameplate_effect', '별자리 완성', '별의 선이 이름표를 직조하고 미세 별빛을 남기는 이름 등장 효과.', 'namefx:constellation', true),
  ('NAMEFX_SHARD_ASSEMBLY_2026', 'nameplate_effect', '편린 대조립', '흩어진 여덟 편린이 결합하고 비취빛 조각을 남기는 이름 등장 효과.', 'namefx:shard-assembly', true),
  ('NAMEFX_ROYAL_OPENING_2026', 'nameplate_effect', '황실 개막', '황실 커튼과 접힌 카드가 열리고 왕관과 금박을 남기는 이름 등장 효과.', 'namefx:royal-opening', true)
on conflict (item_uid) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description,
    resource_url = excluded.resource_url,
    is_active = true,
    updated_at = now();

insert into public.cosmetic_item_pricings
  (item_id, value_token, price, condition_type, is_active)
select ci.id, 'GOLD', 500, 'NONE', true
from public.cosmetic_items ci
where ci.item_uid in (
  'NAMEFX_CORONATION_2026',
  'NAMEFX_CONSTELLATION_2026',
  'NAMEFX_SHARD_ASSEMBLY_2026',
  'NAMEFX_ROYAL_OPENING_2026'
)
and not exists (
  select 1
  from public.cosmetic_item_pricings cp
  where cp.item_id = ci.id
    and cp.value_token = 'GOLD'
    and cp.price = 500
);

insert into public.seasonal_items
  (item_id, season_name, available_from, available_until, is_active)
select ci.id,
       '원정 명품관 C클래스 첫 개방',
       '2026-10-11 00:00:00+09'::timestamptz,
       '2026-11-10 00:00:00+09'::timestamptz,
       true
from public.cosmetic_items ci
where ci.item_uid in (
  'NAMEFX_CORONATION_2026',
  'NAMEFX_CONSTELLATION_2026',
  'NAMEFX_SHARD_ASSEMBLY_2026',
  'NAMEFX_ROYAL_OPENING_2026'
)
on conflict (item_id) do update
set season_name = excluded.season_name,
    available_from = excluded.available_from,
    available_until = excluded.available_until,
    is_active = true;

insert into public.expedition_luxury_catalog
  (cosmetic_item_id, luxury_group, required_effect_level, presentation_kind, is_active, metadata)
select ci.id,
       'C',
       3,
       'NAMEPLATE_EFFECT',
       true,
       '{"trial_open":true,"trial_until":"2026-11-10T00:00:00+09:00"}'::jsonb
from public.cosmetic_items ci
where ci.item_uid in (
  'NAMEFX_CORONATION_2026',
  'NAMEFX_CONSTELLATION_2026',
  'NAMEFX_SHARD_ASSEMBLY_2026',
  'NAMEFX_ROYAL_OPENING_2026'
)
on conflict (cosmetic_item_id) do update
set luxury_group = excluded.luxury_group,
    required_effect_level = excluded.required_effect_level,
    presentation_kind = excluded.presentation_kind,
    is_active = true,
    metadata = excluded.metadata;

commit;

select
  ci.item_uid,
  ci.name,
  ci.category,
  lc.luxury_group,
  lc.required_effect_level,
  lc.presentation_kind,
  cp.value_token,
  cp.price,
  si.available_from,
  si.available_until
from public.cosmetic_items ci
join public.expedition_luxury_catalog lc on lc.cosmetic_item_id = ci.id
left join public.cosmetic_item_pricings cp on cp.item_id = ci.id and cp.is_active = true
left join public.seasonal_items si on si.item_id = ci.id and si.is_active = true
where ci.item_uid in (
  'NAMEFX_CORONATION_2026',
  'NAMEFX_CONSTELLATION_2026',
  'NAMEFX_SHARD_ASSEMBLY_2026',
  'NAMEFX_ROYAL_OPENING_2026'
)
order by ci.item_uid;
