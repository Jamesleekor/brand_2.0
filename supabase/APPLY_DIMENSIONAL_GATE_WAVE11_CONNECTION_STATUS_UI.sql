-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 11
-- Connection status SSOT + curated student roster + publish safeguard
-- Prepared: 2026-09-17
-- Requires Wave 1~10.
-- =====================================================================

begin;

alter table public.dimensional_gate_character_profiles
  add column if not exists gate_status text not null default 'OUT_OF_RANGE';

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.dimensional_gate_character_profiles'::regclass
      and conname='dimensional_gate_character_profiles_gate_status_check'
  ) then
    alter table public.dimensional_gate_character_profiles
      add constraint dimensional_gate_character_profiles_gate_status_check
      check (gate_status in ('CONNECTED','CONNECTING','OUT_OF_RANGE'));
  end if;
end
$do$;

create index if not exists dimensional_gate_character_profiles_gate_status_idx
  on public.dimensional_gate_character_profiles(gate_status, is_active);

comment on column public.dimensional_gate_character_profiles.gate_status is
  'Student-facing curation state: CONNECTED, CONNECTING, OUT_OF_RANGE. Independent from content publication (is_active).';

-- Only Astell and Lumi begin in the connected curation bucket.
-- They are not automatically published: 2.0 content must pass readiness first.
update public.dimensional_gate_character_profiles p
set gate_status='OUT_OF_RANGE', is_active=false, updated_at=now()
where p.character_id not in (
  select c.id from public.characters c where c.name in ('아스텔','루미')
);

insert into public.dimensional_gate_character_profiles(
  character_id, gate_status, is_active, ai_enabled, story_scope, metadata, created_at, updated_at
)
select c.id, 'CONNECTED', false, false, 'STANDARD',
       jsonb_build_object('gate_status_seed','2026-09-17'), now(), now()
from public.characters c
where c.name in ('아스텔','루미')
on conflict(character_id) do update set
  gate_status='CONNECTED',
  metadata=coalesce(public.dimensional_gate_character_profiles.metadata,'{}'::jsonb)
           || jsonb_build_object('gate_status_seed','2026-09-17'),
  updated_at=now();

-- Content completeness, independent of whether the teacher has published it.
create or replace function public.dimensional_gate_content_complete(p_character_id bigint)
returns boolean
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_scope text;
  v_profile_ready boolean:=false;
  v_memories integer:=0;
  v_rewards integer:=0;
  v_episodes integer:=0;
  v_min integer:=2;
begin
  select p.story_scope,
         (nullif(btrim(coalesce(p.system_prompt,'')),'') is not null
          and nullif(btrim(coalesce(p.speaking_style,'')),'') is not null)
  into v_scope, v_profile_ready
  from public.dimensional_gate_character_profiles p
  where p.character_id=p_character_id;

  if not found then return false; end if;
  v_min:=case when coalesce(v_scope,'STANDARD')='MAJOR' then 4 else 2 end;

  select count(*)::integer into v_memories
  from public.dimensional_gate_memories m
  where m.character_id=p_character_id and m.is_active=true;

  select count(*)::integer into v_rewards
  from public.dimensional_gate_reward_rules r
  where r.character_id=p_character_id and r.is_active=true and r.affinity_threshold in(40,70,100);

  select count(*)::integer into v_episodes
  from public.dimensional_gate_story_episodes e
  where e.character_id=p_character_id and e.is_active=true;

  return coalesce(v_profile_ready,false) and v_memories=3 and v_rewards=3 and v_episodes>=v_min;
end;
$function$;

revoke all on function public.dimensional_gate_content_complete(bigint) from public, anon, authenticated;
grant execute on function public.dimensional_gate_content_complete(bigint) to service_role;

-- Student roster now exposes curation state. Missing profile = OUT_OF_RANGE.
create or replace function public.student_get_dimensional_gate_roster()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_result jsonb;
begin
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();

  if v_student_id is null or v_classroom_id is null then
    raise exception 'Student context not found' using errcode='PDG20';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = v_student_id
      and s.classroom_id = v_classroom_id
      and s.role::text = 'STUDENT'
      and s.transferred_at is null
  ) then
    raise exception 'Student role required' using errcode='PDG21';
  end if;

  select coalesce(jsonb_agg(row_json order by sort_order, character_id), '[]'::jsonb)
  into v_result
  from (
    select
      c.sort_order,
      c.id as character_id,
      jsonb_build_object(
        'character_id', c.id,
        'character_uid', c.character_uid,
        'name', c.name,
        'epithet', c.epithet,
        'description', c.description,
        'resource_kind', c.resource_kind,
        'resource_url', c.resource_url,
        'full_image_url', c.full_image_url,
        'card_image_url', c.card_image_url,
        'avatar_image_url', c.avatar_image_url,
        'is_owned', coalesce(sc.is_owned, false),
        'relationship_exists', (rel.id is not null),
        'affinity', case when coalesce(sc.is_owned, false) then coalesce(rel.affinity, dgp.start_affinity, 0) else 0 end,
        'relation_stage', case when coalesce(sc.is_owned, false)
          then public.dimensional_gate_relation_stage(coalesce(rel.affinity, dgp.start_affinity, 0))
          else 'LOCKED'
        end,
        'status', case when coalesce(sc.is_owned, false) then coalesce(rel.status, 'NORMAL') else 'LOCKED' end,
        'daily_chat_limit', case when coalesce(sc.is_owned, false) then coalesce(dgp.daily_chat_limit, 3) else 0 end,
        'chat_count', case
          when coalesce(sc.is_owned, false) and rel.chat_date = current_date then coalesce(rel.chat_count, 0)
          else 0
        end,
        'remaining_chat_count', case
          when not coalesce(sc.is_owned, false) then 0
          when rel.chat_date = current_date then greatest(coalesce(dgp.daily_chat_limit, 3) - coalesce(rel.chat_count, 0), 0)
          else coalesce(dgp.daily_chat_limit, 3)
        end,
        'story_scope', coalesce(dgp.story_scope, 'STANDARD'),
        'gate_status', coalesce(dgp.gate_status, 'OUT_OF_RANGE'),
        'publication_ready', public.dimensional_gate_content_complete(c.id),
        'gate_enabled', (
          coalesce(dgp.gate_status, 'OUT_OF_RANGE')='CONNECTED'
          and coalesce(dgp.is_active,false)=true
          and public.dimensional_gate_content_complete(c.id)
        )
      ) as row_json
    from public.characters c
    left join public.dimensional_gate_character_profiles dgp
      on dgp.character_id = c.id
    left join public.student_characters sc
      on sc.student_id = v_student_id
     and sc.character_id = c.id
     and sc.is_owned = true
    left join public.dimensional_gate_relationships rel
      on rel.student_id = v_student_id
     and rel.character_id = c.id
    where c.is_active = true
  ) q;

  return v_result;
end;
$function$;

revoke all on function public.student_get_dimensional_gate_roster() from public, anon;
grant execute on function public.student_get_dimensional_gate_roster() to authenticated, service_role;

-- Health now measures readiness independently from publication, avoiding a circular state.
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
  v_gate_status text:='OUT_OF_RANGE';
  v_published boolean:=false;
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

  select p.story_scope, p.gate_status, p.is_active,
         (nullif(btrim(coalesce(p.system_prompt,'')),'') is not null and nullif(btrim(coalesce(p.speaking_style,'')),'') is not null)
  into v_scope,v_gate_status,v_published,v_profile_ready
  from public.dimensional_gate_character_profiles p where p.character_id=p_character_id;
  v_scope:=coalesce(v_scope,'STANDARD');
  v_gate_status:=coalesce(v_gate_status,'OUT_OF_RANGE');
  v_published:=coalesce(v_published,false);
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
      'story_scope',v_scope,'gate_status',v_gate_status,'published',v_published,
      'profile_ready',v_profile_ready,
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

-- New profile save overload with explicit curation state and publish safeguard.
create or replace function public.teacher_save_dimensional_gate_profile(
  p_character_id bigint,
  p_gate_status text,
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
declare
  v_scope text:=upper(btrim(coalesce(p_story_scope,'STANDARD')));
  v_status text:=upper(btrim(coalesce(p_gate_status,'OUT_OF_RANGE')));
  v_publish boolean:=coalesce(p_is_active,false);
  v_memories integer:=0;
  v_rewards integer:=0;
  v_episodes integer:=0;
  v_min integer:=2;
begin
  if not public.is_teacher_or_admin() then raise exception 'Teacher/admin only' using errcode='42501'; end if;
  if not exists(select 1 from public.characters c where c.id=p_character_id) then raise exception 'Character not found' using errcode='P0202'; end if;
  if v_scope not in ('STANDARD','MAJOR') then raise exception 'story_scope must be STANDARD or MAJOR' using errcode='PDG90'; end if;
  if v_status not in ('CONNECTED','CONNECTING','OUT_OF_RANGE') then raise exception 'gate_status is invalid' using errcode='PDGB0'; end if;
  if coalesce(p_daily_chat_limit,3)<0 or coalesce(p_daily_chat_limit,3)>20 then raise exception 'daily_chat_limit must be 0..20' using errcode='PDG91'; end if;
  if coalesce(p_start_affinity,0)<0 or coalesce(p_start_affinity,0)>100 then raise exception 'start_affinity must be 0..100' using errcode='PDG92'; end if;

  -- A non-connected fragment can be authored, but can never be student-published.
  if v_status<>'CONNECTED' then v_publish:=false; end if;

  if v_publish and (nullif(btrim(coalesce(p_system_prompt,'')),'') is null or nullif(btrim(coalesce(p_speaking_style,'')),'') is null) then
    raise exception 'Publishing requires system prompt and speaking style' using errcode='PDGB1';
  end if;

  if v_publish then
    v_min:=case when v_scope='MAJOR' then 4 else 2 end;
    select count(*)::integer into v_memories from public.dimensional_gate_memories m where m.character_id=p_character_id and m.is_active=true;
    select count(*)::integer into v_rewards from public.dimensional_gate_reward_rules r where r.character_id=p_character_id and r.is_active=true and r.affinity_threshold in(40,70,100);
    select count(*)::integer into v_episodes from public.dimensional_gate_story_episodes e where e.character_id=p_character_id and e.is_active=true;
    if v_memories<>3 or v_rewards<>3 or v_episodes<v_min then
      raise exception 'Publishing requires 3 memories, 3 milestone rewards, and at least % active episodes',v_min using errcode='PDGB2';
    end if;
  end if;

  insert into public.dimensional_gate_character_profiles(
    character_id,gate_status,daily_chat_limit,start_affinity,ai_enabled,system_prompt,speaking_style,
    expertise,deflect_rules,imagery_rules,warning_line_1,warning_line_2,lock_line,
    story_scope,is_active,metadata,created_at,updated_at
  ) values(
    p_character_id,v_status,coalesce(p_daily_chat_limit,3),coalesce(p_start_affinity,0),coalesce(p_ai_enabled,true),
    nullif(btrim(coalesce(p_system_prompt,'')),''),nullif(btrim(coalesce(p_speaking_style,'')),''),
    coalesce(p_expertise,'[]'::jsonb),nullif(btrim(coalesce(p_deflect_rules,'')),''),nullif(btrim(coalesce(p_imagery_rules,'')),''),
    nullif(btrim(coalesce(p_warning_line_1,'')),''),nullif(btrim(coalesce(p_warning_line_2,'')),''),nullif(btrim(coalesce(p_lock_line,'')),''),
    v_scope,v_publish,jsonb_build_object('last_content_edit_by',auth.uid()),now(),now()
  )
  on conflict(character_id) do update set
    gate_status=excluded.gate_status,
    daily_chat_limit=excluded.daily_chat_limit,start_affinity=excluded.start_affinity,ai_enabled=excluded.ai_enabled,
    system_prompt=excluded.system_prompt,speaking_style=excluded.speaking_style,expertise=excluded.expertise,
    deflect_rules=excluded.deflect_rules,imagery_rules=excluded.imagery_rules,
    warning_line_1=excluded.warning_line_1,warning_line_2=excluded.warning_line_2,lock_line=excluded.lock_line,
    story_scope=excluded.story_scope,is_active=excluded.is_active,
    metadata=coalesce(public.dimensional_gate_character_profiles.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now();
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_profile(bigint,text,boolean,text,integer,integer,boolean,text,text,jsonb,text,text,text,text,text) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_profile(bigint,text,boolean,text,integer,integer,boolean,text,text,jsonb,text,text,text,text,text) to authenticated, service_role;

-- Backward-compatible wrapper for clients from before Wave 11.
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
declare v_status text;
begin
  select p.gate_status into v_status from public.dimensional_gate_character_profiles p where p.character_id=p_character_id;
  perform public.teacher_save_dimensional_gate_profile(
    p_character_id,coalesce(v_status,'OUT_OF_RANGE'),p_is_active,p_story_scope,p_daily_chat_limit,p_start_affinity,p_ai_enabled,
    p_system_prompt,p_speaking_style,p_expertise,p_deflect_rules,p_imagery_rules,p_warning_line_1,p_warning_line_2,p_lock_line
  );
end;
$function$;

revoke all on function public.teacher_save_dimensional_gate_profile(bigint,boolean,text,integer,integer,boolean,text,text,jsonb,text,text,text,text,text) from public, anon;
grant execute on function public.teacher_save_dimensional_gate_profile(bigint,boolean,text,integer,integer,boolean,text,text,jsonb,text,text,text,text,text) to authenticated, service_role;

commit;
