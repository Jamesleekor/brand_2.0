-- B.R.A.N.D 2.0
-- Public profile equipped-character visual variants
-- 2026-11-02
--
-- Keeps character ownership/equipment SSOT unchanged while allowing a student
-- to choose an entitled hidden-shard image for classroom-visible profiles.

begin;

alter table public.student_character_profiles
  add column if not exists visual_variant_no smallint not null default 1;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.student_character_profiles'::regclass
      and conname = 'student_character_profiles_visual_variant_no_check'
  ) then
    alter table public.student_character_profiles
      add constraint student_character_profiles_visual_variant_no_check
      check (visual_variant_no between 1 and 3);
  end if;
end;
$constraint$;

comment on column public.student_character_profiles.visual_variant_no is
  'Classroom-visible equipped character visual: 1=base, 2/3=entitled showcase image.';

-- Legacy callers (raid lobby and older clients) remain valid. Equipping a
-- different character resets to the base image; re-equipping the same one
-- preserves its selected visual.
create or replace function public.equip_character(p_character_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'Student session not found' using errcode='P0200';
  end if;

  select s.classroom_id
    into v_classroom_id
  from public.students s
  where s.id = v_student_id
    and s.transferred_at is null;

  if not found then
    raise exception 'Active student not found' using errcode='P0200';
  end if;

  if p_character_id is not null and not exists (
    select 1
    from public.student_characters sc
    join public.characters c on c.id = sc.character_id
    where sc.student_id = v_student_id
      and sc.character_id = p_character_id
      and sc.is_owned = true
      and c.is_active = true
  ) then
    raise exception 'Character not owned or inactive' using errcode='P0201';
  end if;

  insert into public.student_character_profiles(
    student_id,
    classroom_id,
    equipped_character_id,
    visual_variant_no,
    updated_at,
    updated_by
  )
  values (
    v_student_id,
    v_classroom_id,
    p_character_id,
    1,
    now(),
    auth.uid()
  )
  on conflict (student_id) do update
    set classroom_id = excluded.classroom_id,
        visual_variant_no = case
          when public.student_character_profiles.equipped_character_id is not distinct from excluded.equipped_character_id
            then public.student_character_profiles.visual_variant_no
          else 1
        end,
        equipped_character_id = excluded.equipped_character_id,
        updated_at = now(),
        updated_by = auth.uid();
end;
$function$;

revoke all on function public.equip_character(bigint) from public, anon;
grant execute on function public.equip_character(bigint) to authenticated, service_role;

create or replace function public.student_equip_character_visual(
  p_character_id bigint,
  p_visual_variant_no integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_variant smallint := coalesce(p_visual_variant_no, 1)::smallint;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'Student session not found' using errcode='P0200';
  end if;

  select s.classroom_id
    into v_classroom_id
  from public.students s
  where s.id = v_student_id
    and s.transferred_at is null;

  if not found then
    raise exception 'Active student not found' using errcode='P0200';
  end if;

  if v_variant not between 1 and 3 then
    raise exception 'Visual variant must be between 1 and 3' using errcode='P0H26';
  end if;

  if p_character_id is null then
    v_variant := 1;
  elsif not exists (
    select 1
    from public.student_characters sc
    join public.characters c on c.id = sc.character_id
    where sc.student_id = v_student_id
      and sc.character_id = p_character_id
      and sc.is_owned = true
      and c.is_active = true
  ) then
    raise exception 'Character not owned or inactive' using errcode='P0201';
  elsif not public._character_showcase_visual_allowed(v_student_id, p_character_id, v_variant) then
    raise exception '아직 사용할 수 없는 프로필 이미지입니다. 명품관 구매 또는 해금 조건을 확인해 주세요.'
      using errcode='P0H27';
  end if;

  insert into public.student_character_profiles(
    student_id,
    classroom_id,
    equipped_character_id,
    visual_variant_no,
    updated_at,
    updated_by
  )
  values (
    v_student_id,
    v_classroom_id,
    p_character_id,
    v_variant,
    now(),
    auth.uid()
  )
  on conflict (student_id) do update
    set classroom_id = excluded.classroom_id,
        equipped_character_id = excluded.equipped_character_id,
        visual_variant_no = excluded.visual_variant_no,
        updated_at = now(),
        updated_by = auth.uid();
end;
$function$;

revoke all on function public.student_equip_character_visual(bigint,integer) from public, anon;
grant execute on function public.student_equip_character_visual(bigint,integer) to authenticated, service_role;

comment on function public.student_equip_character_visual(bigint,integer) is
  'Atomically equips an owned character and an entitled public-profile visual.';

notify pgrst, 'reload schema';

commit;
