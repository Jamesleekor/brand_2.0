-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 10 Special CG + Content Health
-- Requires Wave 1~9.
-- Prepared: 2026-09-15
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Teacher content extras: relationship milestone CGs + readiness metrics.
-- ---------------------------------------------------------------------
create or replace function public.teacher_get_dimensional_gate_content_extras(
  p_character_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_scope text;
  v_profile_ready boolean:=false;
  v_memories integer:=0;
  v_rewards integer:=0;
  v_episodes integer:=0;
  v_cuts integer:=0;
  v_story_cgs integer:=0;
  v_special_cgs integer:=0;
  v_special jsonb;
  v_min integer;
  v_max integer;
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  if not exists(select 1 from public.characters c where c.id=p_character_id) then raise exception 'Character not found' using errcode='P0202'; end if;

  select p.story_scope,
         (p.is_active and nullif(btrim(coalesce(p.system_prompt,'')),'') is not null and nullif(btrim(coalesce(p.speaking_style,'')),'') is not null)
  into v_scope,v_profile_ready
  from public.dimensional_gate_character_profiles p where p.character_id=p_character_id;
  v_scope:=coalesce(v_scope,'STANDARD');
  v_profile_ready:=coalesce(v_profile_ready,false);
  v_min:=case when v_scope='MAJOR' then 4 else 2 end;
  v_max:=case when v_scope='MAJOR' then 6 else 3 end;

  select count(*)::integer into v_memories from public.dimensional_gate_memories m where m.character_id=p_character_id and m.is_active=true;
  select count(*)::integer into v_rewards from public.dimensional_gate_reward_rules r where r.character_id=p_character_id and r.is_active=true and r.affinity_threshold in(40,70,100);
  select count(*)::integer into v_episodes from public.dimensional_gate_story_episodes e where e.character_id=p_character_id and e.is_active=true;
  select count(*)::integer into v_cuts from public.dimensional_gate_story_cuts c join public.dimensional_gate_story_episodes e on e.id=c.episode_id where e.character_id=p_character_id and e.is_active=true;
  select count(*)::integer into v_story_cgs from public.dimensional_gate_gallery_assets g where g.character_id=p_character_id and g.asset_type='STORY_CG' and g.is_active=true;
  select count(*)::integer into v_special_cgs from public.dimensional_gate_gallery_assets g where g.character_id=p_character_id and g.asset_type='SPECIAL_CG' and g.is_active=true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'gallery_asset_id',g.id,'unlock_affinity',g.unlock_affinity,'title',g.title,
    'image_url',g.image_url,'home_background_allowed',g.home_background_allowed,
    'cosmetic_item_id',g.cosmetic_item_id,'is_active',g.is_active
  ) order by g.unlock_affinity,g.id),'[]'::jsonb)
  into v_special
  from public.dimensional_gate_gallery_assets g
  where g.character_id=p_character_id and g.asset_type='SPECIAL_CG';

  return jsonb_build_object(
    'special_cgs',v_special,
    'health',jsonb_build_object(
      'story_scope',v_scope,'profile_ready',v_profile_ready,
      'active_memory_count',v_memories,'active_reward_count',v_rewards,
      'active_episode_count',v_episodes,'recommended_episode_min',v_min,'recommended_episode_max',v_max,
      'total_cut_count',v_cuts,'active_story_cg_count',v_story_cgs,'active_special_cg_count',v_special_cgs,
      'ready_for_release',(v_profile_ready and v_memories=3 and v_rewards=3 and v_episodes>=v_min)
    )
  );
end;
$function$;

revoke all on function public.teacher_get_dimensional_gate_content_extras(bigint) from public, anon;
grant execute on function public.teacher_get_dimensional_gate_content_extras(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Teacher save special affinity CGs. One managed CG per 40/70/100 milestone.
-- IDs are preserved; removal deactivates rather than deletes.
-- ---------------------------------------------------------------------
create or replace function public.teacher_save_dimensional_gate_special_cgs(
  p_character_id bigint,
  p_assets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_character_uid text; v_character_name text;
  item jsonb; v_threshold integer; v_title text; v_url text; v_home boolean; v_active boolean;
  v_asset_id bigint; v_cosmetic_id integer; v_cosmetic_uid text; v_saved integer:=0;
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_assets,'[]'::jsonb))<>'array' then raise exception 'assets must be an array' using errcode='PDGC0'; end if;
  select c.character_uid,c.name into v_character_uid,v_character_name from public.characters c where c.id=p_character_id;
  if v_character_uid is null then raise exception 'Character not found' using errcode='P0202'; end if;

  for item in select value from jsonb_array_elements(coalesce(p_assets,'[]'::jsonb)) loop
    begin v_threshold:=(item->>'unlock_affinity')::integer; exception when others then v_threshold:=0; end;
    if v_threshold not in(40,70,100) then raise exception 'Special CG unlock_affinity must be 40/70/100' using errcode='PDGC1'; end if;
    v_title:=nullif(btrim(coalesce(item->>'title','')),'');
    v_url:=nullif(btrim(coalesce(item->>'image_url','')),'');
    begin v_home:=coalesce((item->>'home_background_allowed')::boolean,false); exception when others then v_home:=false; end;
    begin v_active:=coalesce((item->>'is_active')::boolean,v_url is not null); exception when others then v_active:=v_url is not null; end;
    if v_active and v_url is null then raise exception 'Active special CG requires image_url at %',v_threshold using errcode='PDGC2'; end if;

    select g.id,g.cosmetic_item_id into v_asset_id,v_cosmetic_id
    from public.dimensional_gate_gallery_assets g
    where g.character_id=p_character_id and g.asset_type='SPECIAL_CG' and g.unlock_affinity=v_threshold
    order by g.id limit 1;

    v_cosmetic_uid:='DG_SPECIAL_'||regexp_replace(upper(v_character_uid),'[^A-Z0-9]+','_','g')||'_A'||v_threshold::text;
    if v_url is null then
      if v_asset_id is not null then
        update public.dimensional_gate_gallery_assets set is_active=false,home_background_allowed=false,updated_at=now() where id=v_asset_id;
        update public.dimensional_gate_reward_rules set gallery_asset_id=null,updated_at=now()
          where character_id=p_character_id and affinity_threshold=v_threshold and gallery_asset_id=v_asset_id;
      end if;
      update public.cosmetic_items set is_active=false,updated_at=now() where item_uid=v_cosmetic_uid;
    else
      if v_asset_id is null then
        insert into public.dimensional_gate_gallery_assets(
          character_id,episode_id,asset_type,title,image_url,unlock_affinity,home_background_allowed,cosmetic_item_id,
          sort_order,metadata,created_at,updated_at,source_cut_order,is_active
        ) values(p_character_id,null,'SPECIAL_CG',v_title,v_url,v_threshold,v_home,null,v_threshold,
          jsonb_build_object('managed_by','DIMENSIONAL_GATE_CONTENT_ADMIN'),now(),now(),null,v_active)
        returning id,cosmetic_item_id into v_asset_id,v_cosmetic_id;
      else
        update public.dimensional_gate_gallery_assets set title=v_title,image_url=v_url,unlock_affinity=v_threshold,
          home_background_allowed=v_home,sort_order=v_threshold,is_active=v_active,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('managed_by','DIMENSIONAL_GATE_CONTENT_ADMIN'),updated_at=now()
        where id=v_asset_id;
        update public.dimensional_gate_gallery_assets set is_active=false,updated_at=now()
          where character_id=p_character_id and asset_type='SPECIAL_CG' and unlock_affinity=v_threshold and id<>v_asset_id;
      end if;

      if v_home and v_active then
        insert into public.cosmetic_items(item_uid,classroom_id,category,name,description,resource_url,is_active,created_at,updated_at)
        values(v_cosmetic_uid,null,'background',coalesce(v_title,v_character_name||' · 관계 기억 '||v_threshold),'차원관문 관계 보상으로 획득하는 홈 배경',v_url,true,now(),now())
        on conflict(item_uid) do update set category='background',name=excluded.name,description=excluded.description,resource_url=excluded.resource_url,is_active=true,updated_at=now()
        returning id into v_cosmetic_id;
        update public.dimensional_gate_gallery_assets set cosmetic_item_id=v_cosmetic_id where id=v_asset_id;
      else
        update public.cosmetic_items set is_active=false,updated_at=now() where item_uid=v_cosmetic_uid;
      end if;

      update public.dimensional_gate_reward_rules set gallery_asset_id=case when v_active then v_asset_id else null end,updated_at=now()
        where character_id=p_character_id and affinity_threshold=v_threshold;
      v_saved:=v_saved+1;
    end if;
  end loop;

  return jsonb_build_object('saved',v_saved);
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_special_cgs(bigint,jsonb) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_special_cgs(bigint,jsonb) to authenticated, service_role;

-- Active-only background grant.
create or replace function public.dimensional_gate_grant_gallery_background(
  p_student_id integer,
  p_gallery_asset_id bigint
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_item_id integer; v_ownership_id bigint;
begin
  select ga.cosmetic_item_id into v_item_id from public.dimensional_gate_gallery_assets ga
  where ga.id=p_gallery_asset_id and ga.is_active=true and ga.home_background_allowed=true and ga.cosmetic_item_id is not null;
  if v_item_id is null then return null; end if;
  select sco.id into v_ownership_id from public.student_cosmetic_ownerships sco where sco.student_id=p_student_id and sco.item_id=v_item_id limit 1;
  if v_ownership_id is not null then return v_ownership_id; end if;
  insert into public.student_cosmetic_ownerships(student_id,item_id,obtained_via,is_equipped,purchased_at)
  values(p_student_id,v_item_id,'STORY_REWARD'::public.cosmetic_obtained_via,false,now()) on conflict do nothing returning id into v_ownership_id;
  if v_ownership_id is null then select sco.id into v_ownership_id from public.student_cosmetic_ownerships sco where sco.student_id=p_student_id and sco.item_id=v_item_id limit 1; end if;
  return v_ownership_id;
end;
$function$;

revoke all on function public.dimensional_gate_grant_gallery_background(integer,bigint) from public, anon, authenticated;
grant execute on function public.dimensional_gate_grant_gallery_background(integer,bigint) to service_role;

-- Milestone sync must ignore deactivated old CG definitions.
create or replace function public.dimensional_gate_sync_milestone_unlocks(
  p_student_id integer,
  p_character_id bigint,
  p_affinity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_affinity integer:=greatest(0,least(coalesce(p_affinity,0),100));
  v_asset record; v_rule public.dimensional_gate_reward_rules%rowtype;
begin
  if p_student_id is null or p_character_id is null then raise exception 'Student and character are required' using errcode='PDG30'; end if;
  insert into public.dimensional_gate_memory_unlocks(student_id,character_id,memory_no,unlocked_at,source)
  select p_student_id,m.character_id,m.memory_no,now(),'AFFINITY_MILESTONE' from public.dimensional_gate_memories m
  where m.character_id=p_character_id and m.is_active=true and m.unlock_affinity<=v_affinity
  on conflict(student_id,character_id,memory_no) do nothing;

  for v_asset in select ga.id from public.dimensional_gate_gallery_assets ga
    where ga.character_id=p_character_id and ga.asset_type='SPECIAL_CG' and ga.is_active=true
      and ga.unlock_affinity is not null and ga.unlock_affinity<=v_affinity
  loop
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(p_student_id,v_asset.id,'AFFINITY_MILESTONE',now()) on conflict(student_id,gallery_asset_id) do nothing;
    perform public.dimensional_gate_grant_gallery_background(p_student_id,v_asset.id);
  end loop;

  if v_affinity>=100 then
    select * into v_rule from public.dimensional_gate_resolved_reward_rule(p_character_id,100);
    if found and v_rule.trust_visual_variant_no is not null then
      insert into public.dimensional_gate_visual_unlocks(student_id,character_id,visual_variant_no,unlock_type,unlocked_at)
      values(p_student_id,p_character_id,v_rule.trust_visual_variant_no,'TRUST_100',now())
      on conflict(student_id,character_id,visual_variant_no) do nothing;
    end if;
  end if;
end;
$function$;

revoke all on function public.dimensional_gate_sync_milestone_unlocks(integer,bigint,integer) from public, anon, authenticated;
grant execute on function public.dimensional_gate_sync_milestone_unlocks(integer,bigint,integer) to service_role;

commit;
