-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 8
-- Teacher content authoring: AI profile, memories, reward rules.
-- Story engine remains data-driven and can be populated separately.
-- =====================================================================

begin;

create or replace function public.teacher_get_dimensional_gate_content(p_character_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_character public.characters%rowtype;
  v_profile jsonb;
  v_memories jsonb;
  v_rewards jsonb;
  v_episodes jsonb;
  v_gallery_count integer:=0;
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  select * into v_character from public.characters c where c.id=p_character_id;
  if not found then raise exception 'Character not found' using errcode='P0202'; end if;

  select to_jsonb(p) into v_profile from public.dimensional_gate_character_profiles p where p.character_id=p_character_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'memory_no',m.memory_no,'unlock_affinity',m.unlock_affinity,'title',m.title,
    'content',m.content,'is_active',m.is_active
  ) order by m.memory_no),'[]'::jsonb)
  into v_memories
  from public.dimensional_gate_memories m where m.character_id=p_character_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'affinity_threshold',r.affinity_threshold,'reward_gold',r.reward_gold,
    'reward_crystal',r.reward_crystal,'reward_bv',r.reward_bv,
    'gallery_asset_id',r.gallery_asset_id,'trust_visual_variant_no',r.trust_visual_variant_no,
    'is_active',r.is_active
  ) order by r.affinity_threshold),'[]'::jsonb)
  into v_rewards
  from public.dimensional_gate_reward_rules r
  where r.character_id=p_character_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'episode_id',e.id,'episode_no',e.episode_no,'title',e.title,
    'required_affinity',e.required_affinity,'estimated_minutes',e.estimated_minutes,
    'headphone_recommended',e.headphone_recommended,'is_active',e.is_active,
    'cut_count',(select count(*) from public.dimensional_gate_story_cuts c where c.episode_id=e.id)
  ) order by e.sort_order,e.episode_no),'[]'::jsonb)
  into v_episodes
  from public.dimensional_gate_story_episodes e where e.character_id=p_character_id;

  select count(*)::integer into v_gallery_count
  from public.dimensional_gate_gallery_assets g where g.character_id=p_character_id;

  return jsonb_build_object(
    'character',jsonb_build_object(
      'id',v_character.id,'character_uid',v_character.character_uid,'name',v_character.name,
      'showcase_image_url_2',v_character.showcase_image_url_2,'showcase_image_url_3',v_character.showcase_image_url_3
    ),
    'profile',v_profile,
    'memories',v_memories,
    'rewards',v_rewards,
    'episodes',v_episodes,
    'gallery_count',v_gallery_count
  );
end;
$function$;

revoke all on function public.teacher_get_dimensional_gate_content(bigint) from public, anon;
grant execute on function public.teacher_get_dimensional_gate_content(bigint) to authenticated, service_role;

create or replace function public.teacher_save_dimensional_gate_profile(
  p_character_id bigint,
  p_is_active boolean,
  p_story_scope text,
  p_daily_chat_limit integer,
  p_start_affinity integer,
  p_ai_enabled boolean,
  p_system_prompt text,
  p_speaking_style text,
  p_expertise jsonb,
  p_deflect_rules text,
  p_imagery_rules text,
  p_warning_line_1 text,
  p_warning_line_2 text,
  p_lock_line text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_scope text:=upper(btrim(coalesce(p_story_scope,'STANDARD')));
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  if not exists(select 1 from public.characters c where c.id=p_character_id) then raise exception 'Character not found' using errcode='P0202'; end if;
  if v_scope not in ('STANDARD','MAJOR') then raise exception 'story_scope must be STANDARD or MAJOR' using errcode='PDG90'; end if;
  if coalesce(p_daily_chat_limit,3)<0 or coalesce(p_daily_chat_limit,3)>20 then raise exception 'daily_chat_limit must be 0..20' using errcode='PDG91'; end if;
  if coalesce(p_start_affinity,0)<0 or coalesce(p_start_affinity,0)>100 then raise exception 'start_affinity must be 0..100' using errcode='PDG92'; end if;
  if p_is_active and (nullif(btrim(coalesce(p_system_prompt,'')),'') is null or nullif(btrim(coalesce(p_speaking_style,'')),'') is null) then
    raise exception 'Active profile requires system prompt and speaking style' using errcode='PDG93';
  end if;

  insert into public.dimensional_gate_character_profiles(
    character_id,daily_chat_limit,start_affinity,ai_enabled,system_prompt,speaking_style,
    expertise,deflect_rules,imagery_rules,warning_line_1,warning_line_2,lock_line,
    story_scope,is_active,metadata,created_at,updated_at
  ) values(
    p_character_id,coalesce(p_daily_chat_limit,3),coalesce(p_start_affinity,0),coalesce(p_ai_enabled,true),
    nullif(btrim(coalesce(p_system_prompt,'')),''),nullif(btrim(coalesce(p_speaking_style,'')),''),
    coalesce(p_expertise,'[]'::jsonb),nullif(btrim(coalesce(p_deflect_rules,'')),''),nullif(btrim(coalesce(p_imagery_rules,'')),''),
    nullif(btrim(coalesce(p_warning_line_1,'')),''),nullif(btrim(coalesce(p_warning_line_2,'')),''),nullif(btrim(coalesce(p_lock_line,'')),''),
    v_scope,coalesce(p_is_active,false),jsonb_build_object('last_content_edit_by',auth.uid()),now(),now()
  )
  on conflict(character_id) do update set
    daily_chat_limit=excluded.daily_chat_limit,start_affinity=excluded.start_affinity,ai_enabled=excluded.ai_enabled,
    system_prompt=excluded.system_prompt,speaking_style=excluded.speaking_style,expertise=excluded.expertise,
    deflect_rules=excluded.deflect_rules,imagery_rules=excluded.imagery_rules,
    warning_line_1=excluded.warning_line_1,warning_line_2=excluded.warning_line_2,lock_line=excluded.lock_line,
    story_scope=excluded.story_scope,is_active=excluded.is_active,
    metadata=coalesce(public.dimensional_gate_character_profiles.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now();
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_profile(bigint,boolean,text,integer,integer,boolean,text,text,jsonb,text,text,text,text,text) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_profile(bigint,boolean,text,integer,integer,boolean,text,text,jsonb,text,text,text,text,text) to authenticated, service_role;

create or replace function public.teacher_save_dimensional_gate_memories(
  p_character_id bigint,
  p_memories jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare item jsonb; v_no integer; v_title text; v_content text; v_enabled boolean; v_threshold integer;
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_memories,'[]'::jsonb))<>'array' then raise exception 'memories must be an array' using errcode='PDG94'; end if;

  for item in select value from jsonb_array_elements(coalesce(p_memories,'[]'::jsonb)) loop
    v_no:=coalesce((item->>'memory_no')::integer,0);
    if v_no not in (1,2,3) then raise exception 'memory_no must be 1..3' using errcode='PDG95'; end if;
    v_threshold:=case v_no when 1 then 40 when 2 then 70 else 100 end;
    v_title:=btrim(coalesce(item->>'title',''));
    v_content:=btrim(coalesce(item->>'content',''));
    v_enabled:=coalesce((item->>'is_active')::boolean,(v_title<>'' and v_content<>''));
    if v_enabled and (v_title='' or v_content='') then raise exception 'Active memory requires title and content' using errcode='PDG96'; end if;

    insert into public.dimensional_gate_memories(character_id,memory_no,unlock_affinity,title,content,sort_order,is_active,created_at,updated_at)
    values(p_character_id,v_no,v_threshold,v_title,v_content,v_no,v_enabled,now(),now())
    on conflict(character_id,memory_no) do update set
      unlock_affinity=excluded.unlock_affinity,title=excluded.title,content=excluded.content,
      sort_order=excluded.sort_order,is_active=excluded.is_active,updated_at=now();
  end loop;
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_memories(bigint,jsonb) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_memories(bigint,jsonb) to authenticated, service_role;

create or replace function public.teacher_save_dimensional_gate_rewards(
  p_character_id bigint,
  p_rewards jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare item jsonb; v_threshold integer; v_variant integer; v_gallery bigint; v_active boolean;
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_rewards,'[]'::jsonb))<>'array' then raise exception 'rewards must be an array' using errcode='PDG97'; end if;

  for item in select value from jsonb_array_elements(coalesce(p_rewards,'[]'::jsonb)) loop
    v_threshold:=coalesce((item->>'affinity_threshold')::integer,0);
    if v_threshold not in (40,70,100) then raise exception 'Reward threshold must be 40/70/100' using errcode='PDG98'; end if;
    v_variant:=nullif(item->>'trust_visual_variant_no','')::integer;
    if v_variant is not null and (v_threshold<>100 or v_variant not in (2,3)) then raise exception 'Trust visual is only valid at 100 and must be variant 2 or 3' using errcode='PDG99'; end if;
    v_gallery:=nullif(item->>'gallery_asset_id','')::bigint;
    v_active:=coalesce((item->>'is_active')::boolean,true);

    insert into public.dimensional_gate_reward_rules(
      character_id,affinity_threshold,reward_gold,reward_crystal,reward_bv,gallery_asset_id,trust_visual_variant_no,is_active,metadata,created_at,updated_at
    ) values(
      p_character_id,v_threshold,
      greatest(coalesce((item->>'reward_gold')::bigint,0),0),
      greatest(coalesce((item->>'reward_crystal')::bigint,0),0),
      greatest(coalesce((item->>'reward_bv')::bigint,0),0),
      v_gallery,v_variant,v_active,jsonb_build_object('last_content_edit_by',auth.uid()),now(),now()
    )
    on conflict(character_id,affinity_threshold) where character_id is not null do update set
      reward_gold=excluded.reward_gold,reward_crystal=excluded.reward_crystal,reward_bv=excluded.reward_bv,
      gallery_asset_id=excluded.gallery_asset_id,trust_visual_variant_no=excluded.trust_visual_variant_no,
      is_active=excluded.is_active,metadata=coalesce(public.dimensional_gate_reward_rules.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now();
  end loop;
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_rewards(bigint,jsonb) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_rewards(bigint,jsonb) to authenticated, service_role;

commit;
