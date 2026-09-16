-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 9 Story Package Admin
-- Requires Wave 1~3 and Wave 8.
-- Purpose: safe, data-driven story import/edit without per-character code.
-- Prepared: 2026-09-15
-- =====================================================================

begin;

alter table public.dimensional_gate_gallery_assets
  add column if not exists is_active boolean not null default true;

create index if not exists dimensional_gate_gallery_assets_episode_cut_idx
  on public.dimensional_gate_gallery_assets(episode_id, source_cut_order, id)
  where asset_type='STORY_CG';

-- ---------------------------------------------------------------------
-- Teacher: export one episode as an editable JSON package.
-- ---------------------------------------------------------------------
create or replace function public.teacher_get_dimensional_gate_story_package(
  p_episode_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_character_id bigint;
  v_result jsonb;
begin
  if not public.is_teacher_or_admin() then
    raise exception 'Teacher/admin only' using errcode='42501';
  end if;

  select e.character_id into v_character_id
  from public.dimensional_gate_story_episodes e
  where e.id=p_episode_id;
  if v_character_id is null then
    raise exception 'Story episode not found' using errcode='PDGA0';
  end if;

  select jsonb_build_object(
    'episode', jsonb_build_object(
      'episode_no',e.episode_no,
      'title',e.title,
      'required_affinity',e.required_affinity,
      'default_bgm_url',e.default_bgm_url,
      'estimated_minutes',e.estimated_minutes,
      'headphone_recommended',e.headphone_recommended,
      'sort_order',e.sort_order,
      'is_active',e.is_active,
      'metadata',e.metadata
    ),
    'cuts', coalesce((
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'cut_order',c.cut_order,
          'cut_type',c.cut_type,
          'speaker',c.speaker,
          'content',c.content,
          'background_url',c.background_url,
          'sprite_url',c.sprite_url,
          'bgm_url',c.bgm_url,
          'sfx_url',c.sfx_url,
          'effects',c.effects,
          'choices',c.choices,
          'jump_to_order',c.jump_to_order,
          'metadata',c.metadata,
          'gallery', case when ga.id is null then null else jsonb_build_object(
            'title',ga.title,
            'image_url',ga.image_url,
            'home_background_allowed',ga.home_background_allowed,
            'is_active',ga.is_active,
            'metadata',ga.metadata
          ) end
        )) order by c.cut_order
      )
      from public.dimensional_gate_story_cuts c
      left join lateral (
        select g.*
        from public.dimensional_gate_gallery_assets g
        where g.episode_id=e.id
          and g.asset_type='STORY_CG'
          and g.source_cut_order=c.cut_order
        order by g.is_active desc,g.id
        limit 1
      ) ga on true
      where c.episode_id=e.id
    ),'[]'::jsonb)
  ) into v_result
  from public.dimensional_gate_story_episodes e
  where e.id=p_episode_id;

  return v_result;
end;
$function$;

revoke all on function public.teacher_get_dimensional_gate_story_package(bigint) from public, anon;
grant execute on function public.teacher_get_dimensional_gate_story_package(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Teacher: upsert an episode package.
-- Episode identity is (character_id, episode_no), so student progress survives edits.
-- Cuts are replaceable because progress references episode, not cut rows.
-- STORY_CG assets are updated by source_cut_order and never deleted, preserving
-- student gallery unlock foreign keys. Omitted old assets become inactive.
-- ---------------------------------------------------------------------
create or replace function public.teacher_save_dimensional_gate_story_package(
  p_character_id bigint,
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ep jsonb;
  v_cuts jsonb;
  v_episode_id bigint;
  v_episode_no integer;
  v_title text;
  v_required integer;
  v_estimated integer;
  v_sort integer;
  v_active boolean;
  v_headphones boolean;
  v_default_bgm text;
  v_ep_metadata jsonb;
  v_character_uid text;
  v_character_name text;
  item jsonb;
  gallery jsonb;
  v_order integer;
  v_type text;
  v_effects jsonb;
  v_choices jsonb;
  v_jump integer;
  v_asset_id bigint;
  v_image_url text;
  v_gallery_title text;
  v_home boolean;
  v_gallery_active boolean;
  v_cosmetic_id integer;
  v_cosmetic_uid text;
  v_seen_orders integer[] := '{}'::integer[];
  v_cut_count integer := 0;
  v_gallery_count integer := 0;
begin
  if not public.is_teacher_or_admin() then
    raise exception 'Teacher/admin only' using errcode='42501';
  end if;
  if jsonb_typeof(coalesce(p_package,'{}'::jsonb))<>'object' then
    raise exception 'Story package must be a JSON object' using errcode='PDGA1';
  end if;

  select c.character_uid,c.name into v_character_uid,v_character_name
  from public.characters c where c.id=p_character_id;
  if v_character_uid is null then
    raise exception 'Character not found' using errcode='P0202';
  end if;

  v_ep:=p_package->'episode';
  v_cuts:=coalesce(p_package->'cuts','[]'::jsonb);
  if jsonb_typeof(v_ep)<>'object' then raise exception 'package.episode is required' using errcode='PDGA2'; end if;
  if jsonb_typeof(v_cuts)<>'array' then raise exception 'package.cuts must be an array' using errcode='PDGA3'; end if;

  begin v_episode_no:=(v_ep->>'episode_no')::integer; exception when others then v_episode_no:=0; end;
  v_title:=btrim(coalesce(v_ep->>'title',''));
  begin v_required:=coalesce((v_ep->>'required_affinity')::integer,0); exception when others then v_required:=-1; end;
  begin v_estimated:=nullif(v_ep->>'estimated_minutes','')::integer; exception when others then v_estimated:=-1; end;
  begin v_sort:=coalesce((v_ep->>'sort_order')::integer,v_episode_no); exception when others then v_sort:=v_episode_no; end;
  begin v_active:=coalesce((v_ep->>'is_active')::boolean,true); exception when others then v_active:=true; end;
  begin v_headphones:=coalesce((v_ep->>'headphone_recommended')::boolean,false); exception when others then v_headphones:=false; end;
  v_default_bgm:=nullif(btrim(coalesce(v_ep->>'default_bgm_url','')),'');
  v_ep_metadata:=case when jsonb_typeof(v_ep->'metadata')='object' then v_ep->'metadata' else '{}'::jsonb end;

  if v_episode_no<1 or v_episode_no>99 then raise exception 'episode_no must be 1..99' using errcode='PDGA4'; end if;
  if v_title='' then raise exception 'Episode title is required' using errcode='PDGA5'; end if;
  if v_required<0 or v_required>100 then raise exception 'required_affinity must be 0..100' using errcode='PDGA6'; end if;
  if v_estimated is not null and (v_estimated<0 or v_estimated>180) then raise exception 'estimated_minutes must be 0..180' using errcode='PDGA7'; end if;
  if jsonb_array_length(v_cuts)>600 then raise exception 'Too many cuts (max 600)' using errcode='PDGA8'; end if;

  insert into public.dimensional_gate_story_episodes(
    character_id,episode_no,title,required_affinity,default_bgm_url,estimated_minutes,
    headphone_recommended,sort_order,is_active,metadata,created_at,updated_at
  ) values(
    p_character_id,v_episode_no,v_title,v_required,v_default_bgm,v_estimated,
    v_headphones,v_sort,v_active,v_ep_metadata||jsonb_build_object('last_story_edit_by',auth.uid()),now(),now()
  )
  on conflict(character_id,episode_no) do update set
    title=excluded.title,required_affinity=excluded.required_affinity,
    default_bgm_url=excluded.default_bgm_url,estimated_minutes=excluded.estimated_minutes,
    headphone_recommended=excluded.headphone_recommended,sort_order=excluded.sort_order,
    is_active=excluded.is_active,
    metadata=coalesce(public.dimensional_gate_story_episodes.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now()
  returning id into v_episode_id;

  -- Deactivate old managed story CGs first. Matching CG cuts below reactivate/update them.
  -- Auto-created home background cosmetics are also disabled first, then current CGs reactivate them.
  update public.cosmetic_items ci
  set is_active=false,updated_at=now()
  from public.dimensional_gate_gallery_assets ga
  where ga.episode_id=v_episode_id and ga.asset_type='STORY_CG'
    and ga.cosmetic_item_id=ci.id and ci.item_uid like 'DG_BG_%';

  update public.dimensional_gate_gallery_assets
  set is_active=false,updated_at=now()
  where episode_id=v_episode_id and asset_type='STORY_CG';

  -- Cut rows have no student-owned FK, so replace them transactionally.
  delete from public.dimensional_gate_story_cuts where episode_id=v_episode_id;

  for item in select value from jsonb_array_elements(v_cuts) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Every cut must be an object' using errcode='PDGA9'; end if;
    begin v_order:=(item->>'cut_order')::integer; exception when others then v_order:=0; end;
    v_type:=upper(btrim(coalesce(item->>'cut_type','LINE')));
    if v_order<1 then raise exception 'cut_order must be >= 1' using errcode='PDGAA'; end if;
    if v_order=any(v_seen_orders) then raise exception 'Duplicate cut_order: %',v_order using errcode='PDGAB'; end if;
    v_seen_orders:=array_append(v_seen_orders,v_order);
    if v_type not in ('TITLE','NARRATION','LINE','CHOICE','CG') then raise exception 'Invalid cut_type at %: %',v_order,v_type using errcode='PDGAC'; end if;

    v_effects:=coalesce(item->'effects','[]'::jsonb);
    if jsonb_typeof(v_effects)<>'array' then raise exception 'effects must be an array at cut %',v_order using errcode='PDGAD'; end if;
    v_choices:=item->'choices';
    if v_choices is not null and jsonb_typeof(v_choices)<>'array' then raise exception 'choices must be an array at cut %',v_order using errcode='PDGAE'; end if;
    if v_type='CHOICE' and (v_choices is null or jsonb_array_length(v_choices)=0) then raise exception 'CHOICE cut requires choices at cut %',v_order using errcode='PDGAF'; end if;
    begin v_jump:=nullif(item->>'jump_to_order','')::integer; exception when others then raise exception 'Invalid jump_to_order at cut %',v_order using errcode='PDGB0'; end;

    insert into public.dimensional_gate_story_cuts(
      episode_id,cut_order,cut_type,speaker,content,background_url,sprite_url,bgm_url,sfx_url,
      effects,choices,jump_to_order,metadata,created_at,updated_at
    ) values(
      v_episode_id,v_order,v_type,
      nullif(btrim(coalesce(item->>'speaker','')),''),nullif(coalesce(item->>'content',''),''),
      nullif(btrim(coalesce(item->>'background_url','')),''),nullif(btrim(coalesce(item->>'sprite_url','')),''),
      nullif(btrim(coalesce(item->>'bgm_url','')),''),nullif(btrim(coalesce(item->>'sfx_url','')),''),
      v_effects,v_choices,v_jump,
      case when jsonb_typeof(item->'metadata')='object' then item->'metadata' else '{}'::jsonb end,
      now(),now()
    );
    v_cut_count:=v_cut_count+1;

    gallery:=item->'gallery';
    if gallery is not null then
      if v_type<>'CG' then raise exception 'gallery is only valid on CG cuts (cut %)',v_order using errcode='PDGB1'; end if;
      if jsonb_typeof(gallery)<>'object' then raise exception 'gallery must be an object at cut %',v_order using errcode='PDGB2'; end if;
      v_image_url:=nullif(btrim(coalesce(gallery->>'image_url',item->>'background_url','')),'');
      if v_image_url is null then raise exception 'Gallery CG requires image_url/background_url at cut %',v_order using errcode='PDGB3'; end if;
      v_gallery_title:=nullif(btrim(coalesce(gallery->>'title','')),'');
      begin v_home:=coalesce((gallery->>'home_background_allowed')::boolean,false); exception when others then v_home:=false; end;
      begin v_gallery_active:=coalesce((gallery->>'is_active')::boolean,true); exception when others then v_gallery_active:=true; end;

      select g.id,g.cosmetic_item_id into v_asset_id,v_cosmetic_id
      from public.dimensional_gate_gallery_assets g
      where g.episode_id=v_episode_id and g.asset_type='STORY_CG' and g.source_cut_order=v_order
      order by g.id limit 1;

      if v_asset_id is null then
        insert into public.dimensional_gate_gallery_assets(
          character_id,episode_id,asset_type,title,image_url,unlock_affinity,home_background_allowed,
          cosmetic_item_id,sort_order,metadata,created_at,updated_at,source_cut_order,is_active
        ) values(
          p_character_id,v_episode_id,'STORY_CG',v_gallery_title,v_image_url,null,v_home,null,
          v_order,case when jsonb_typeof(gallery->'metadata')='object' then gallery->'metadata' else '{}'::jsonb end,
          now(),now(),v_order,v_gallery_active
        ) returning id,cosmetic_item_id into v_asset_id,v_cosmetic_id;
      else
        update public.dimensional_gate_gallery_assets set
          character_id=p_character_id,title=v_gallery_title,image_url=v_image_url,unlock_affinity=null,
          home_background_allowed=v_home,sort_order=v_order,
          metadata=coalesce(metadata,'{}'::jsonb)||(case when jsonb_typeof(gallery->'metadata')='object' then gallery->'metadata' else '{}'::jsonb end),
          is_active=v_gallery_active,updated_at=now()
        where id=v_asset_id;
        -- Defensive: old accidental duplicates never participate again.
        update public.dimensional_gate_gallery_assets set is_active=false,updated_at=now()
        where episode_id=v_episode_id and asset_type='STORY_CG' and source_cut_order=v_order and id<>v_asset_id;
      end if;

      v_cosmetic_uid:='DG_BG_'||regexp_replace(upper(v_character_uid),'[^A-Z0-9]+','_','g')||'_E'||lpad(v_episode_no::text,2,'0')||'_C'||lpad(v_order::text,4,'0');
      if v_home and v_gallery_active then
        insert into public.cosmetic_items(item_uid,classroom_id,category,name,description,resource_url,is_active,created_at,updated_at)
        values(v_cosmetic_uid,null,'background',coalesce(v_gallery_title,v_character_name||' · '||v_episode_no||'편 장면'),'차원관문 화첩에서 획득하는 홈 배경',v_image_url,true,now(),now())
        on conflict(item_uid) do update set
          category='background',name=excluded.name,description=excluded.description,resource_url=excluded.resource_url,is_active=true,updated_at=now()
        returning id into v_cosmetic_id;
        update public.dimensional_gate_gallery_assets set cosmetic_item_id=v_cosmetic_id where id=v_asset_id;
      else
        -- Preserve the cosmetic row/id for existing ownership history, but make it unusable.
        update public.cosmetic_items set is_active=false,updated_at=now() where item_uid=v_cosmetic_uid;
      end if;
      v_gallery_count:=v_gallery_count+1;
    end if;
  end loop;

  return jsonb_build_object(
    'episode_id',v_episode_id,'episode_no',v_episode_no,'cut_count',v_cut_count,
    'active_gallery_count',v_gallery_count
  );
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_story_package(bigint,jsonb) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_story_package(bigint,jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Student story reader: only active gallery assets can attach to a CG cut.
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_story(p_episode_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer; v_character_id bigint; v_required_affinity integer;
  v_affinity integer; v_start_affinity integer; v_result jsonb;
begin
  v_student_id:=public.current_student_id(); if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  select e.character_id,e.required_affinity into v_character_id,v_required_affinity from public.dimensional_gate_story_episodes e where e.id=p_episode_id and e.is_active=true;
  if not found then raise exception 'Story episode not found' using errcode='PDG40'; end if;
  if not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=v_character_id and sc.is_owned=true) then raise exception 'Character not owned' using errcode='PDG22'; end if;
  select p.start_affinity into v_start_affinity from public.dimensional_gate_character_profiles p where p.character_id=v_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;
  select coalesce(r.affinity,v_start_affinity,0) into v_affinity from (select 1) seed left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=v_character_id;
  if v_affinity<v_required_affinity then raise exception 'Story is locked' using errcode='PDG41'; end if;

  select jsonb_build_object(
    'episode_id',e.id,'character_id',e.character_id,'episode_no',e.episode_no,'title',e.title,
    'required_affinity',e.required_affinity,'default_bgm_url',e.default_bgm_url,
    'estimated_minutes',e.estimated_minutes,'headphone_recommended',e.headphone_recommended,
    'cuts',coalesce((select jsonb_agg(jsonb_build_object(
      'cut_order',c.cut_order,'cut_type',c.cut_type,'speaker',c.speaker,'content',c.content,
      'background_url',c.background_url,'sprite_url',c.sprite_url,'bgm_url',c.bgm_url,'sfx_url',c.sfx_url,
      'effects',c.effects,'choices',c.choices,'jump_to_order',c.jump_to_order,'gallery_asset_id',ga.id,'metadata',c.metadata
    ) order by c.cut_order)
      from public.dimensional_gate_story_cuts c
      left join lateral (
        select g.id from public.dimensional_gate_gallery_assets g
        where g.episode_id=e.id and g.asset_type='STORY_CG' and g.source_cut_order=c.cut_order and g.is_active=true
        order by g.id limit 1
      ) ga on true where c.episode_id=e.id),'[]'::jsonb)
  ) into v_result from public.dimensional_gate_story_episodes e where e.id=p_episode_id;
  return v_result;
end;
$function$;

revoke all on function public.student_get_dimensional_gate_story(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_story(bigint) to authenticated, service_role;

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
  v_student_id integer; v_character_id bigint; v_required_affinity integer;
  v_affinity integer; v_start_affinity integer; v_unlocked_count integer:=0; v_asset record;
begin
  v_student_id:=public.current_student_id(); if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  select e.character_id,e.required_affinity into v_character_id,v_required_affinity from public.dimensional_gate_story_episodes e where e.id=p_episode_id and e.is_active=true;
  if not found then raise exception 'Story episode not found' using errcode='PDG40'; end if;
  if not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=v_character_id and sc.is_owned=true) then raise exception 'Character not owned' using errcode='PDG22'; end if;
  select p.start_affinity into v_start_affinity from public.dimensional_gate_character_profiles p where p.character_id=v_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;
  select coalesce(r.affinity,v_start_affinity,0) into v_affinity from (select 1) seed left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=v_character_id;
  if v_affinity<v_required_affinity then raise exception 'Story is locked' using errcode='PDG41'; end if;

  insert into public.dimensional_gate_story_progress(student_id,episode_id,opened_at,completed_at,updated_at)
  values(v_student_id,p_episode_id,now(),now(),now())
  on conflict(student_id,episode_id) do update set opened_at=coalesce(public.dimensional_gate_story_progress.opened_at,excluded.opened_at),completed_at=coalesce(public.dimensional_gate_story_progress.completed_at,excluded.completed_at),updated_at=now();

  for v_asset in select ga.id from public.dimensional_gate_gallery_assets ga
    where ga.episode_id=p_episode_id and ga.asset_type='STORY_CG' and ga.is_active=true
      and ga.id=any(coalesce(p_gallery_asset_ids,'{}'::bigint[]))
  loop
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(v_student_id,v_asset.id,'STORY_COMPLETION',now()) on conflict(student_id,gallery_asset_id) do nothing;
    if found then v_unlocked_count:=v_unlocked_count+1; end if;
    perform public.dimensional_gate_grant_gallery_background(v_student_id,v_asset.id);
  end loop;
  return jsonb_build_object('completed',true,'new_gallery_unlocks',v_unlocked_count);
end;
$function$;

revoke all on function public.student_complete_dimensional_gate_story(bigint,bigint[]) from public, anon;
grant execute on function public.student_complete_dimensional_gate_story(bigint,bigint[]) to authenticated, service_role;

create or replace function public.student_get_dimensional_gate_gallery(p_character_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer; v_affinity integer; v_start_affinity integer; v_assets jsonb;
begin
  v_student_id:=public.current_student_id(); if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  if not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true) then raise exception 'Character not owned' using errcode='PDG22'; end if;
  select p.start_affinity into v_start_affinity from public.dimensional_gate_character_profiles p where p.character_id=p_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;
  select coalesce(r.affinity,v_start_affinity,0) into v_affinity from (select 1) seed left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=p_character_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'gallery_asset_id',ga.id,'asset_type',ga.asset_type,'title',ga.title,
    'image_url',case when (gu.id is not null or (ga.asset_type='SPECIAL_CG' and ga.unlock_affinity is not null and v_affinity>=ga.unlock_affinity)) then ga.image_url else null end,
    'unlock_affinity',ga.unlock_affinity,
    'unlocked',(gu.id is not null or (ga.asset_type='SPECIAL_CG' and ga.unlock_affinity is not null and v_affinity>=ga.unlock_affinity)),
    'episode_id',ga.episode_id,'home_background_allowed',ga.home_background_allowed,'cosmetic_item_id',ga.cosmetic_item_id,
    'ownership_id',case when (gu.id is not null or (ga.asset_type='SPECIAL_CG' and ga.unlock_affinity is not null and v_affinity>=ga.unlock_affinity)) then sco.id else null end
  ) order by ga.sort_order,ga.id),'[]'::jsonb)
  into v_assets
  from public.dimensional_gate_gallery_assets ga
  left join public.dimensional_gate_gallery_unlocks gu on gu.student_id=v_student_id and gu.gallery_asset_id=ga.id
  left join public.student_cosmetic_ownerships sco on sco.student_id=v_student_id and sco.item_id=ga.cosmetic_item_id
  where ga.character_id=p_character_id and ga.is_active=true;
  return jsonb_build_object('affinity',v_affinity,'assets',v_assets);
end;
$function$;

revoke all on function public.student_get_dimensional_gate_gallery(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_gallery(bigint) to authenticated, service_role;

commit;
