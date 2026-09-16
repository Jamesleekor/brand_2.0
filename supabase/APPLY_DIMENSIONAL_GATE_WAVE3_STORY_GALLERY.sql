-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 3 Story / BrandVN / Gallery
-- Requires Wave 1 + Wave 2
-- Prepared: 2026-09-15
-- =====================================================================

begin;

alter table public.dimensional_gate_gallery_assets
  add column if not exists source_cut_order integer;

create index if not exists dimensional_gate_story_episodes_character_idx
  on public.dimensional_gate_story_episodes(character_id, sort_order, episode_no);
create index if not exists dimensional_gate_story_cuts_episode_idx
  on public.dimensional_gate_story_cuts(episode_id, cut_order);
create index if not exists dimensional_gate_story_progress_student_idx
  on public.dimensional_gate_story_progress(student_id, episode_id);
create index if not exists dimensional_gate_gallery_assets_character_idx
  on public.dimensional_gate_gallery_assets(character_id, sort_order, id);
create index if not exists dimensional_gate_gallery_unlocks_student_idx
  on public.dimensional_gate_gallery_unlocks(student_id, gallery_asset_id);

-- ---------------------------------------------------------------------
-- Student episode list. NEW means unlocked and never opened.
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_stories(p_character_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_affinity integer;
  v_start_affinity integer;
  v_result jsonb;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'Student context not found' using errcode='PDG20';
  end if;

  if not exists (
    select 1 from public.student_characters sc
    where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true
  ) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select coalesce(p.start_affinity, 0)
  into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id=p_character_id and p.is_active=true;

  if not found then
    raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23';
  end if;

  select coalesce(r.affinity, v_start_affinity, 0)
  into v_affinity
  from (select 1) seed
  left join public.dimensional_gate_relationships r
    on r.student_id=v_student_id and r.character_id=p_character_id;

  select coalesce(jsonb_agg(item order by sort_order, episode_no), '[]'::jsonb)
  into v_result
  from (
    select e.sort_order, e.episode_no,
      jsonb_build_object(
        'episode_id', e.id,
        'episode_no', e.episode_no,
        'title', e.title,
        'required_affinity', e.required_affinity,
        'unlocked', v_affinity >= e.required_affinity,
        'opened', sp.opened_at is not null,
        'completed', sp.completed_at is not null,
        'is_new', (v_affinity >= e.required_affinity and sp.opened_at is null),
        'estimated_minutes', e.estimated_minutes,
        'headphone_recommended', e.headphone_recommended
      ) as item
    from public.dimensional_gate_story_episodes e
    left join public.dimensional_gate_story_progress sp
      on sp.student_id=v_student_id and sp.episode_id=e.id
    where e.character_id=p_character_id and e.is_active=true
  ) q;

  return jsonb_build_object('affinity', v_affinity, 'stories', v_result);
end;
$function$;

revoke all on function public.student_get_dimensional_gate_stories(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_stories(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Story script. Returns only an owned + currently unlocked episode.
-- A STORY_CG asset may declare source_cut_order. The matching gallery asset id
-- is attached to the cut so the client can report CGs actually reached.
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_story(p_episode_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_character_id bigint;
  v_required_affinity integer;
  v_affinity integer;
  v_start_affinity integer;
  v_result jsonb;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'Student context not found' using errcode='PDG20';
  end if;

  select e.character_id, e.required_affinity
  into v_character_id, v_required_affinity
  from public.dimensional_gate_story_episodes e
  where e.id=p_episode_id and e.is_active=true;

  if not found then
    raise exception 'Story episode not found' using errcode='PDG40';
  end if;

  if not exists (
    select 1 from public.student_characters sc
    where sc.student_id=v_student_id and sc.character_id=v_character_id and sc.is_owned=true
  ) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select p.start_affinity into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id=v_character_id and p.is_active=true;

  if not found then
    raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23';
  end if;

  select coalesce(r.affinity, v_start_affinity, 0)
  into v_affinity
  from (select 1) seed
  left join public.dimensional_gate_relationships r
    on r.student_id=v_student_id and r.character_id=v_character_id;

  if v_affinity < v_required_affinity then
    raise exception 'Story is locked' using errcode='PDG41';
  end if;

  select jsonb_build_object(
    'episode_id', e.id,
    'character_id', e.character_id,
    'episode_no', e.episode_no,
    'title', e.title,
    'required_affinity', e.required_affinity,
    'default_bgm_url', e.default_bgm_url,
    'estimated_minutes', e.estimated_minutes,
    'headphone_recommended', e.headphone_recommended,
    'cuts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'cut_order', c.cut_order,
          'cut_type', c.cut_type,
          'speaker', c.speaker,
          'content', c.content,
          'background_url', c.background_url,
          'sprite_url', c.sprite_url,
          'bgm_url', c.bgm_url,
          'sfx_url', c.sfx_url,
          'effects', c.effects,
          'choices', c.choices,
          'jump_to_order', c.jump_to_order,
          'gallery_asset_id', ga.id,
          'metadata', c.metadata
        ) order by c.cut_order
      )
      from public.dimensional_gate_story_cuts c
      left join public.dimensional_gate_gallery_assets ga
        on ga.episode_id=e.id
       and ga.asset_type='STORY_CG'
       and ga.source_cut_order=c.cut_order
      where c.episode_id=e.id
    ), '[]'::jsonb)
  ) into v_result
  from public.dimensional_gate_story_episodes e
  where e.id=p_episode_id;

  return v_result;
end;
$function$;

revoke all on function public.student_get_dimensional_gate_story(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_story(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Opening an episode is separate from completing it.
-- ---------------------------------------------------------------------
create or replace function public.student_start_dimensional_gate_story(p_episode_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_character_id bigint;
  v_required_affinity integer;
  v_affinity integer;
  v_start_affinity integer;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'Student context not found' using errcode='PDG20';
  end if;

  select e.character_id, e.required_affinity into v_character_id, v_required_affinity
  from public.dimensional_gate_story_episodes e
  where e.id=p_episode_id and e.is_active=true;
  if not found then raise exception 'Story episode not found' using errcode='PDG40'; end if;

  if not exists (select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=v_character_id and sc.is_owned=true) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select p.start_affinity into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id=v_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;

  select coalesce(r.affinity, v_start_affinity, 0) into v_affinity
  from (select 1) seed
  left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=v_character_id;
  if v_affinity < v_required_affinity then raise exception 'Story is locked' using errcode='PDG41'; end if;

  insert into public.dimensional_gate_story_progress(student_id, episode_id, opened_at, updated_at)
  values(v_student_id, p_episode_id, now(), now())
  on conflict(student_id, episode_id) do update
    set opened_at=coalesce(public.dimensional_gate_story_progress.opened_at, excluded.opened_at),
        updated_at=now();
end;
$function$;

revoke all on function public.student_start_dimensional_gate_story(bigint) from public, anon;
grant execute on function public.student_start_dimensional_gate_story(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Completion marks the episode complete and unlocks only STORY_CG ids the
-- client reports as actually encountered. Server validates episode ownership.
-- ---------------------------------------------------------------------
create or replace function public.student_complete_dimensional_gate_story(
  p_episode_id bigint,
  p_gallery_asset_ids bigint[] default '{}'::bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_character_id bigint;
  v_required_affinity integer;
  v_affinity integer;
  v_start_affinity integer;
  v_unlocked_count integer := 0;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;

  select e.character_id, e.required_affinity into v_character_id, v_required_affinity
  from public.dimensional_gate_story_episodes e
  where e.id=p_episode_id and e.is_active=true;
  if not found then raise exception 'Story episode not found' using errcode='PDG40'; end if;

  if not exists (select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=v_character_id and sc.is_owned=true) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select p.start_affinity into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id=v_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;

  select coalesce(r.affinity, v_start_affinity, 0) into v_affinity
  from (select 1) seed
  left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=v_character_id;
  if v_affinity < v_required_affinity then raise exception 'Story is locked' using errcode='PDG41'; end if;

  insert into public.dimensional_gate_story_progress(student_id, episode_id, opened_at, completed_at, updated_at)
  values(v_student_id, p_episode_id, now(), now(), now())
  on conflict(student_id, episode_id) do update
    set opened_at=coalesce(public.dimensional_gate_story_progress.opened_at, excluded.opened_at),
        completed_at=coalesce(public.dimensional_gate_story_progress.completed_at, excluded.completed_at),
        updated_at=now();

  with ins as (
    insert into public.dimensional_gate_gallery_unlocks(student_id, gallery_asset_id, source, unlocked_at)
    select v_student_id, ga.id, 'STORY_COMPLETION', now()
    from public.dimensional_gate_gallery_assets ga
    where ga.episode_id=p_episode_id
      and ga.asset_type='STORY_CG'
      and ga.id=any(coalesce(p_gallery_asset_ids, '{}'::bigint[]))
    on conflict(student_id, gallery_asset_id) do nothing
    returning 1
  ) select count(*) into v_unlocked_count from ins;

  return jsonb_build_object('completed', true, 'new_gallery_unlocks', v_unlocked_count);
end;
$function$;

revoke all on function public.student_complete_dimensional_gate_story(bigint,bigint[]) from public, anon;
grant execute on function public.student_complete_dimensional_gate_story(bigint,bigint[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Gallery read. STORY_CG requires a recorded unlock. SPECIAL_CG may also be
-- visible at its affinity threshold; Wave 4 will make milestone unlocks +
-- home-background ownership fully persistent/atomic.
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_gallery(p_character_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_affinity integer;
  v_start_affinity integer;
  v_assets jsonb;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;

  if not exists (select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select p.start_affinity into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id=p_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;

  select coalesce(r.affinity, v_start_affinity, 0) into v_affinity
  from (select 1) seed
  left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=p_character_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'gallery_asset_id', ga.id,
      'asset_type', ga.asset_type,
      'title', ga.title,
      'image_url', case when (gu.id is not null or (ga.asset_type='SPECIAL_CG' and ga.unlock_affinity is not null and v_affinity>=ga.unlock_affinity)) then ga.image_url else null end,
      'unlock_affinity', ga.unlock_affinity,
      'unlocked', (gu.id is not null or (ga.asset_type='SPECIAL_CG' and ga.unlock_affinity is not null and v_affinity>=ga.unlock_affinity)),
      'episode_id', ga.episode_id,
      'home_background_allowed', ga.home_background_allowed,
      'cosmetic_item_id', ga.cosmetic_item_id,
      'ownership_id', case when (gu.id is not null or (ga.asset_type='SPECIAL_CG' and ga.unlock_affinity is not null and v_affinity>=ga.unlock_affinity)) then sco.id else null end
    ) order by ga.sort_order, ga.id
  ), '[]'::jsonb)
  into v_assets
  from public.dimensional_gate_gallery_assets ga
  left join public.dimensional_gate_gallery_unlocks gu
    on gu.student_id=v_student_id and gu.gallery_asset_id=ga.id
  left join public.student_cosmetic_ownerships sco
    on sco.student_id=v_student_id and sco.item_id=ga.cosmetic_item_id
  where ga.character_id=p_character_id;

  return jsonb_build_object('affinity', v_affinity, 'assets', v_assets);
end;
$function$;

revoke all on function public.student_get_dimensional_gate_gallery(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_gallery(bigint) to authenticated, service_role;

commit;
