-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 5 transactional AI chat core
-- Requires Wave 1~4.
-- AI provider runs in a JWT-protected Edge Function; DB owns relationship state.
-- =====================================================================

begin;

create table if not exists public.dimensional_gate_settings (
  classroom_id integer primary key references public.classrooms(id) on delete cascade,
  normal_gain smallint not null default 3 check (normal_gain between 0 and 20),
  mild_penalty smallint not null default 10 check (mild_penalty between 0 and 100),
  severe_penalty smallint not null default 30 check (severe_penalty between 0 and 100),
  lock_warning_count smallint not null default 3 check (lock_warning_count between 1 and 20),
  max_student_message_chars integer not null default 600 check (max_student_message_chars between 50 and 4000),
  recent_history_limit smallint not null default 10 check (recent_history_limit between 0 and 30),
  updated_at timestamptz not null default now()
);

alter table public.dimensional_gate_settings enable row level security;
revoke all on table public.dimensional_gate_settings from anon, authenticated;

alter table public.dimensional_gate_chat_messages
  add column if not exists moderation_severity text not null default 'none'
    check (moderation_severity in ('none','mild','severe')),
  add column if not exists affinity_delta smallint not null default 0,
  add column if not exists is_aborted boolean not null default false;

create unique index if not exists dimensional_gate_chat_request_role_unique
  on public.dimensional_gate_chat_messages(student_id,character_id,request_id,role)
  where request_id is not null;

-- ---------------------------------------------------------------------
-- Begin one chat request.
-- Reserves one daily turn before the external AI call and records the student
-- message. The Edge Function must finalize or abort this request.
-- ---------------------------------------------------------------------
create or replace function public.student_begin_dimensional_gate_chat(
  p_character_id bigint,
  p_request_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_student public.students%rowtype;
  v_wallet public.wallets%rowtype;
  v_character public.characters%rowtype;
  v_profile public.dimensional_gate_character_profiles%rowtype;
  v_rel public.dimensional_gate_relationships%rowtype;
  v_settings public.dimensional_gate_settings%rowtype;
  v_message_id bigint;
  v_history jsonb;
  v_memories jsonb;
  v_existing_reply text;
  v_limit integer;
begin
  v_student_id:=public.current_student_id();
  v_classroom_id:=public.current_classroom_id();
  if v_student_id is null or v_classroom_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  if p_request_id is null then raise exception 'Request id is required' using errcode='PDG60'; end if;

  select * into v_student from public.students s
  where s.id=v_student_id and s.classroom_id=v_classroom_id and s.role::text='STUDENT' and s.transferred_at is null;
  if not found then raise exception 'Active student required' using errcode='PDG61'; end if;

  select * into v_profile from public.dimensional_gate_character_profiles p
  where p.character_id=p_character_id and p.is_active=true and p.ai_enabled=true;
  if not found then raise exception 'AI conversation is not enabled for this character' using errcode='PDG62'; end if;

  select * into v_character from public.characters c
  where c.id=p_character_id and c.is_active=true;
  if not found or not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true) then
    raise exception 'Character not owned or inactive' using errcode='PDG22';
  end if;

  select * into v_settings from public.dimensional_gate_settings s where s.classroom_id=v_classroom_id;
  v_limit:=coalesce(v_settings.max_student_message_chars,600);
  p_message:=btrim(coalesce(p_message,''));
  if p_message='' then raise exception 'Message is required' using errcode='PDG63'; end if;
  if char_length(p_message)>v_limit then raise exception 'Message is too long' using errcode='PDG64'; end if;

  -- UUID retry idempotency. Completed retries return the saved reply without a new turn.
  select cm.content into v_existing_reply
  from public.dimensional_gate_chat_messages cm
  where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id
    and cm.role='CHARACTER' and cm.is_aborted=false
  order by cm.id desc limit 1;
  if found then
    return jsonb_build_object('duplicate',true,'completed',true,'existing_reply',v_existing_reply);
  end if;
  if exists(select 1 from public.dimensional_gate_chat_messages cm where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id and cm.role='STUDENT' and cm.is_aborted=false) then
    return jsonb_build_object('duplicate',true,'completed',false,'existing_reply',null);
  end if;

  insert into public.dimensional_gate_relationships(classroom_id,student_id,character_id,affinity,status,warning_count,chat_date,chat_count,created_at,updated_at)
  values(v_classroom_id,v_student_id,p_character_id,v_profile.start_affinity,'NORMAL',0,current_date,0,now(),now())
  on conflict(student_id,character_id) do nothing;

  select * into v_rel from public.dimensional_gate_relationships r
  where r.student_id=v_student_id and r.character_id=p_character_id
  for update;

  if v_rel.status='LOCKED' then raise exception 'Relationship is locked' using errcode='PDG65'; end if;

  if v_rel.chat_date is distinct from current_date then
    update public.dimensional_gate_relationships
    set chat_date=current_date,chat_count=0,updated_at=now()
    where id=v_rel.id
    returning * into v_rel;
  end if;

  if v_rel.chat_count>=v_profile.daily_chat_limit then raise exception 'Daily conversation limit reached' using errcode='PDG66'; end if;

  -- Permanently backfill any milestone content before building context.
  perform public.dimensional_gate_sync_milestone_unlocks(v_student_id,p_character_id,v_rel.affinity);

  update public.dimensional_gate_relationships
  set chat_count=chat_count+1,last_interacted_at=now(),updated_at=now()
  where id=v_rel.id
  returning * into v_rel;

  insert into public.dimensional_gate_chat_messages(classroom_id,student_id,character_id,role,content,request_id,created_at)
  values(v_classroom_id,v_student_id,p_character_id,'STUDENT',p_message,p_request_id,now())
  returning id into v_message_id;

  select * into v_wallet from public.wallets w where w.student_id=v_student_id;

  select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_history
  from (
    select cm.id,jsonb_build_object('role',case when cm.role='STUDENT' then 'user' else 'assistant' end,'content',cm.content) item
    from public.dimensional_gate_chat_messages cm
    where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.id<v_message_id and cm.is_aborted=false
    order by cm.id desc
    limit coalesce(v_settings.recent_history_limit,10)
  ) h;

  select coalesce(jsonb_agg(jsonb_build_object('memory_no',m.memory_no,'title',m.title,'content',m.content) order by m.memory_no),'[]'::jsonb)
  into v_memories
  from public.dimensional_gate_memories m
  where m.character_id=p_character_id and m.is_active=true
    and exists(select 1 from public.dimensional_gate_memory_unlocks mu where mu.student_id=v_student_id and mu.character_id=p_character_id and mu.memory_no=m.memory_no);

  return jsonb_build_object(
    'duplicate',false,
    'request_id',p_request_id,
    'character',jsonb_build_object('id',v_character.id,'uid',v_character.character_uid,'name',v_character.name,'epithet',v_character.epithet,'description',v_character.description),
    'profile',jsonb_build_object(
      'system_prompt',v_profile.system_prompt,
      'speaking_style',v_profile.speaking_style,
      'expertise',v_profile.expertise,
      'deflect_rules',v_profile.deflect_rules,
      'imagery_rules',v_profile.imagery_rules,
      'warning_line_1',v_profile.warning_line_1,
      'warning_line_2',v_profile.warning_line_2,
      'lock_line',v_profile.lock_line
    ),
    'relationship',jsonb_build_object(
      'affinity',v_rel.affinity,
      'relation_stage',public.dimensional_gate_relation_stage(v_rel.affinity),
      'warning_count',v_rel.warning_count,
      'remaining_chat_count',greatest(v_profile.daily_chat_limit-v_rel.chat_count,0)
    ),
    'memories',v_memories,
    'student_snapshot',jsonb_build_object(
      'name',v_student.name,'brand_name',v_student.brand_name,'tier',v_student.cached_tier,
      'gold',v_wallet.gold,'crystal',v_wallet.crystal,'bv',v_wallet.bv
    ),
    'recent_history',v_history,
    'activity_events','[]'::jsonb
  );
end;
$function$;

revoke all on function public.student_begin_dimensional_gate_chat(bigint,uuid,text) from public, anon;
grant execute on function public.student_begin_dimensional_gate_chat(bigint,uuid,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Finalize AI response. AI never chooses affinity numbers.
-- ---------------------------------------------------------------------
create or replace function public.student_finalize_dimensional_gate_chat(
  p_character_id bigint,
  p_request_id uuid,
  p_reply text,
  p_severity text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_rel public.dimensional_gate_relationships%rowtype;
  v_settings public.dimensional_gate_settings%rowtype;
  v_delta integer:=0;
  v_severity text:=lower(btrim(coalesce(p_severity,'none')));
  v_new_status text;
  v_new_warnings integer;
begin
  v_student_id:=public.current_student_id(); v_classroom_id:=public.current_classroom_id();
  if v_student_id is null or v_classroom_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  if v_severity not in ('none','mild','severe') then raise exception 'Invalid moderation severity' using errcode='PDG67'; end if;
  p_reply:=btrim(coalesce(p_reply,''));
  if p_reply='' or char_length(p_reply)>2400 then raise exception 'Invalid character reply' using errcode='PDG68'; end if;

  if not exists(select 1 from public.dimensional_gate_chat_messages cm where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id and cm.role='STUDENT' and cm.is_aborted=false) then
    raise exception 'Chat request not found' using errcode='PDG69';
  end if;

  if exists(select 1 from public.dimensional_gate_chat_messages cm where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id and cm.role='CHARACTER' and cm.is_aborted=false) then
    return (select jsonb_build_object('duplicate',true,'reply',cm.content,'affinity',r.affinity,'relation_stage',public.dimensional_gate_relation_stage(r.affinity),'status',r.status,'remaining_chat_count',greatest(p.daily_chat_limit-r.chat_count,0))
      from public.dimensional_gate_chat_messages cm
      join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=p_character_id
      join public.dimensional_gate_character_profiles p on p.character_id=p_character_id
      where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id and cm.role='CHARACTER' and cm.is_aborted=false order by cm.id desc limit 1);
  end if;

  select * into v_rel from public.dimensional_gate_relationships r where r.student_id=v_student_id and r.character_id=p_character_id for update;
  if not found then raise exception 'Relationship not found' using errcode='PDG70'; end if;
  select * into v_settings from public.dimensional_gate_settings s where s.classroom_id=v_classroom_id;

  if v_severity='none' then v_delta:=coalesce(v_settings.normal_gain,3);
  elsif v_severity='mild' then v_delta:=-coalesce(v_settings.mild_penalty,10);
  else v_delta:=-coalesce(v_settings.severe_penalty,30);
  end if;

  v_new_warnings:=v_rel.warning_count + case when v_severity='none' then 0 else 1 end;
  v_new_status:=case when v_severity='severe' or v_new_warnings>=coalesce(v_settings.lock_warning_count,3) then 'LOCKED' else 'NORMAL' end;

  update public.dimensional_gate_relationships
  set affinity=greatest(0,least(100,affinity+v_delta)),warning_count=v_new_warnings,status=v_new_status,last_interacted_at=now(),updated_at=now()
  where id=v_rel.id returning * into v_rel;

  insert into public.dimensional_gate_chat_messages(classroom_id,student_id,character_id,role,content,request_id,moderation_severity,affinity_delta,created_at)
  values(v_classroom_id,v_student_id,p_character_id,'CHARACTER',p_reply,p_request_id,v_severity,v_delta,now());

  perform public.dimensional_gate_sync_milestone_unlocks(v_student_id,p_character_id,v_rel.affinity);

  return jsonb_build_object(
    'duplicate',false,'reply',p_reply,'severity',v_severity,'affinity_delta',v_delta,
    'affinity',v_rel.affinity,'relation_stage',public.dimensional_gate_relation_stage(v_rel.affinity),
    'warning_count',v_rel.warning_count,'status',v_rel.status,
    'remaining_chat_count',(select greatest(p.daily_chat_limit-v_rel.chat_count,0) from public.dimensional_gate_character_profiles p where p.character_id=p_character_id)
  );
end;
$function$;

revoke all on function public.student_finalize_dimensional_gate_chat(bigint,uuid,text,text) from public, anon;
grant execute on function public.student_finalize_dimensional_gate_chat(bigint,uuid,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Abort a reserved request after provider/network/format failure.
-- Preserve an audit row but refund the daily turn once.
-- ---------------------------------------------------------------------
create or replace function public.student_abort_dimensional_gate_chat(
  p_character_id bigint,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_msg_id bigint;
  v_rel_id bigint;
begin
  v_student_id:=public.current_student_id(); if v_student_id is null then return; end if;
  if exists(select 1 from public.dimensional_gate_chat_messages cm where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id and cm.role='CHARACTER' and cm.is_aborted=false) then return; end if;

  select cm.id into v_msg_id from public.dimensional_gate_chat_messages cm
  where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.request_id=p_request_id and cm.role='STUDENT' and cm.is_aborted=false
  order by cm.id desc limit 1 for update;
  if not found then return; end if;

  update public.dimensional_gate_chat_messages set is_aborted=true where id=v_msg_id;
  select r.id into v_rel_id from public.dimensional_gate_relationships r where r.student_id=v_student_id and r.character_id=p_character_id for update;
  if v_rel_id is not null then
    update public.dimensional_gate_relationships set chat_count=case when chat_date=current_date then greatest(chat_count-1,0) else chat_count end,updated_at=now() where id=v_rel_id;
  end if;
end;
$function$;

revoke all on function public.student_abort_dimensional_gate_chat(bigint,uuid) from public, anon;
grant execute on function public.student_abort_dimensional_gate_chat(bigint,uuid) to authenticated, service_role;

create or replace function public.student_get_dimensional_gate_chat_history(
  p_character_id bigint,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_student_id integer; v_result jsonb;
begin
  v_student_id:=public.current_student_id(); if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  if not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true) then raise exception 'Character not owned' using errcode='PDG22'; end if;
  select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_result from (
    select cm.id,jsonb_build_object('id',cm.id,'role',cm.role,'content',cm.content,'created_at',cm.created_at,'severity',cm.moderation_severity,'affinity_delta',cm.affinity_delta) item
    from public.dimensional_gate_chat_messages cm
    where cm.student_id=v_student_id and cm.character_id=p_character_id and cm.is_aborted=false
    order by cm.id desc limit greatest(1,least(coalesce(p_limit,40),100))
  ) q;
  return v_result;
end;
$function$;

revoke all on function public.student_get_dimensional_gate_chat_history(bigint,integer) from public, anon;
grant execute on function public.student_get_dimensional_gate_chat_history(bigint,integer) to authenticated, service_role;

commit;
