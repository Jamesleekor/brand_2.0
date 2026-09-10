-- B.R.A.N.D. 2.0
-- Character home-showcase visual variants (max 3 images)
-- 2026-09-10
--
-- Scope is intentionally narrow:
--   * characters keeps the existing primary/full/card/avatar images unchanged.
--   * optional showcase_image_url_2 / showcase_image_url_3 are presentation-only.
--   * student_home_showcase_slots stores which visual (1..3) is selected.
--   * ownership / collections / achievements / expeditions remain character_id based.

alter table public.characters
  add column if not exists showcase_image_url_2 text,
  add column if not exists showcase_image_url_3 text;

alter table public.student_home_showcase_slots
  add column if not exists visual_variant_no smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.student_home_showcase_slots'::regclass
      and conname = 'student_home_showcase_slots_visual_variant_no_check'
  ) then
    alter table public.student_home_showcase_slots
      add constraint student_home_showcase_slots_visual_variant_no_check
      check (visual_variant_no between 1 and 3);
  end if;
end
$$;

comment on column public.characters.showcase_image_url_2 is
  'Optional second image used only for student home showcase visual selection.';
comment on column public.characters.showcase_image_url_3 is
  'Optional third image used only for student home showcase visual selection.';
comment on column public.student_home_showcase_slots.visual_variant_no is
  'Selected home showcase visual: 1=existing primary image, 2/3=optional showcase image URLs.';

-- ---------------------------------------------------------------------
-- Teacher: update only presentation variants without changing the
-- existing Character Master RPC signatures.
-- ---------------------------------------------------------------------
create or replace function public.teacher_set_character_showcase_variants(
  p_character_id bigint,
  p_showcase_image_url_2 text default null,
  p_showcase_image_url_3 text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_url_2 text := nullif(btrim(p_showcase_image_url_2), '');
  v_url_3 text := nullif(btrim(p_showcase_image_url_3), '');
begin
  if not public.is_teacher_or_admin() then
    raise exception 'Teacher/admin only' using errcode='42501';
  end if;

  if not exists (select 1 from public.characters c where c.id = p_character_id) then
    raise exception 'Character not found' using errcode='P0202';
  end if;

  if v_url_3 is not null and v_url_2 is null then
    raise exception 'Showcase image 2 is required before image 3' using errcode='P0H27';
  end if;

  update public.characters
  set showcase_image_url_2 = v_url_2,
      showcase_image_url_3 = v_url_3,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_showcase_variant_edit_via', 'C3_TEACHER_UI',
        'last_showcase_variant_edit_by', auth.uid()
      )
  where id = p_character_id;

  -- If a teacher removes an image that students had selected, immediately
  -- normalize those displays back to the primary image instead of leaving
  -- stale variant numbers behind.
  if v_url_2 is null then
    update public.student_home_showcase_slots
    set visual_variant_no = 1,
        updated_at = now()
    where character_id = p_character_id
      and visual_variant_no in (2, 3);
  elsif v_url_3 is null then
    update public.student_home_showcase_slots
    set visual_variant_no = 1,
        updated_at = now()
    where character_id = p_character_id
      and visual_variant_no = 3;
  end if;
end;
$function$;

revoke all on function public.teacher_set_character_showcase_variants(bigint,text,text) from public;
grant execute on function public.teacher_set_character_showcase_variants(bigint,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Student read: keep the existing RPC signature and add presentation data
-- inside the returned JSON only.
-- ---------------------------------------------------------------------
create or replace function public.student_get_home_personalization()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_background jsonb;
  v_slots jsonb;
begin
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();

  if v_student_id is null or v_classroom_id is null then
    raise exception 'Student context not found'
      using errcode='P0H20';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = v_student_id
      and s.classroom_id = v_classroom_id
      and s.role::text = 'STUDENT'
      and s.transferred_at is null
  ) then
    raise exception 'Student role required'
      using errcode='P0H25';
  end if;

  select jsonb_build_object(
    'item_id', ci.id,
    'ownership_id', sco.id,
    'name', ci.name,
    'resource_url', ci.resource_url
  )
  into v_background
  from public.student_cosmetic_ownerships sco
  join public.cosmetic_items ci
    on ci.id = sco.item_id
  where sco.student_id = v_student_id
    and sco.is_equipped = true
    and lower(ci.category::text) = 'background'
    and ci.is_active = true
    and (ci.classroom_id is null or ci.classroom_id = v_classroom_id)
  order by sco.purchased_at desc, sco.id desc
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slot_no', g.slot_no,
        'character_id', c.id,
        'character_uid', c.character_uid,
        'name', c.name,
        'epithet', c.epithet,
        'resource_kind', c.resource_kind,
        'resource_url', c.resource_url,
        'emoji', c.emoji,
        'full_image_url', c.full_image_url,
        'card_image_url', c.card_image_url,
        'avatar_image_url', c.avatar_image_url,
        'showcase_image_url_2', c.showcase_image_url_2,
        'showcase_image_url_3', c.showcase_image_url_3,
        'visual_variant_no', coalesce(hs.visual_variant_no, 1)
      )
      order by g.slot_no
    ),
    '[]'::jsonb
  )
  into v_slots
  from generate_series(1,3) as g(slot_no)
  left join public.student_home_showcase_slots hs
    on hs.student_id = v_student_id
   and hs.slot_no = g.slot_no
  left join public.characters c
    on c.id = hs.character_id
   and c.is_active = true;

  return jsonb_build_object(
    'background', v_background,
    'showcase_slots', v_slots
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- Compatibility: legacy clients still call the original setter. Ensure
-- they always reset to visual 1 so an old client cannot accidentally carry
-- a previous character's visual selection into a new character.
-- ---------------------------------------------------------------------
create or replace function public.student_set_home_showcase_slot(
  p_slot_no integer,
  p_character_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
begin
  v_student_id := public.current_student_id();

  if v_student_id is null then
    raise exception 'Student session not found'
      using errcode='P0H22';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = v_student_id
      and s.role::text = 'STUDENT'
      and s.transferred_at is null
  ) then
    raise exception 'Student role required'
      using errcode='P0H25';
  end if;

  if p_slot_no is null or p_slot_no < 1 or p_slot_no > 3 then
    raise exception 'Showcase slot must be between 1 and 3'
      using errcode='P0H23';
  end if;

  if p_character_id is null then
    delete from public.student_home_showcase_slots
    where student_id = v_student_id
      and slot_no = p_slot_no;

    return public.student_get_home_personalization();
  end if;

  if not exists (
    select 1
    from public.student_characters sc
    join public.characters c
      on c.id = sc.character_id
    where sc.student_id = v_student_id
      and sc.character_id = p_character_id
      and sc.is_owned = true
      and c.is_active = true
  ) then
    raise exception 'Character not owned or inactive'
      using errcode='P0H24';
  end if;

  delete from public.student_home_showcase_slots
  where student_id = v_student_id
    and character_id = p_character_id
    and slot_no <> p_slot_no;

  insert into public.student_home_showcase_slots(
    student_id,
    slot_no,
    character_id,
    visual_variant_no,
    created_at,
    updated_at
  )
  values (
    v_student_id,
    p_slot_no::smallint,
    p_character_id,
    1,
    now(),
    now()
  )
  on conflict (student_id, slot_no)
  do update
     set character_id = excluded.character_id,
         visual_variant_no = 1,
         updated_at = now();

  return public.student_get_home_personalization();
end;
$function$;

-- ---------------------------------------------------------------------
-- New combined setter: validates ownership and that the selected variant
-- actually has a registered URL, then writes character + visual atomically.
-- ---------------------------------------------------------------------
create or replace function public.student_set_home_showcase_slot_visual(
  p_slot_no integer,
  p_character_id bigint,
  p_visual_variant_no integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_variant smallint;
  v_url_2 text;
  v_url_3 text;
begin
  v_student_id := public.current_student_id();

  if v_student_id is null then
    raise exception 'Student session not found'
      using errcode='P0H22';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = v_student_id
      and s.role::text = 'STUDENT'
      and s.transferred_at is null
  ) then
    raise exception 'Student role required'
      using errcode='P0H25';
  end if;

  if p_slot_no is null or p_slot_no < 1 or p_slot_no > 3 then
    raise exception 'Showcase slot must be between 1 and 3'
      using errcode='P0H23';
  end if;

  if p_character_id is null then
    delete from public.student_home_showcase_slots
    where student_id = v_student_id
      and slot_no = p_slot_no;

    return public.student_get_home_personalization();
  end if;

  if coalesce(p_visual_variant_no, 1) < 1 or coalesce(p_visual_variant_no, 1) > 3 then
    raise exception 'Visual variant must be between 1 and 3'
      using errcode='P0H26';
  end if;
  v_variant := coalesce(p_visual_variant_no, 1)::smallint;

  select c.showcase_image_url_2, c.showcase_image_url_3
    into v_url_2, v_url_3
  from public.student_characters sc
  join public.characters c
    on c.id = sc.character_id
  where sc.student_id = v_student_id
    and sc.character_id = p_character_id
    and sc.is_owned = true
    and c.is_active = true;

  if not found then
    raise exception 'Character not owned or inactive'
      using errcode='P0H24';
  end if;

  if v_variant = 2 and nullif(btrim(v_url_2), '') is null then
    raise exception 'Showcase image 2 is not available'
      using errcode='P0H26';
  end if;

  if v_variant = 3 and nullif(btrim(v_url_3), '') is null then
    raise exception 'Showcase image 3 is not available'
      using errcode='P0H26';
  end if;

  delete from public.student_home_showcase_slots
  where student_id = v_student_id
    and character_id = p_character_id
    and slot_no <> p_slot_no;

  insert into public.student_home_showcase_slots(
    student_id,
    slot_no,
    character_id,
    visual_variant_no,
    created_at,
    updated_at
  )
  values (
    v_student_id,
    p_slot_no::smallint,
    p_character_id,
    v_variant,
    now(),
    now()
  )
  on conflict (student_id, slot_no)
  do update
     set character_id = excluded.character_id,
         visual_variant_no = excluded.visual_variant_no,
         updated_at = now();

  return public.student_get_home_personalization();
end;
$function$;

revoke all on function public.student_set_home_showcase_slot_visual(integer,bigint,integer) from public;
grant execute on function public.student_set_home_showcase_slot_visual(integer,bigint,integer) to authenticated, service_role;
