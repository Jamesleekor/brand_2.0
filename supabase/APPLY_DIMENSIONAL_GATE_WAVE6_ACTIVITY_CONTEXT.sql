-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 6 Verified Activity Context
-- Deterministic source adapters. No AI preprocessing is used.
-- Current adapters: achievements, arcade official results, guild mission grades,
-- economy transactions, character acquisitions.
-- =====================================================================

begin;

alter table public.dimensional_gate_settings
  add column if not exists activity_lookback_days smallint not null default 45
    check (activity_lookback_days between 1 and 365),
  add column if not exists activity_event_limit smallint not null default 5
    check (activity_event_limit between 1 and 8);

create or replace function public.dimensional_gate_activity_context(
  p_student_id integer,
  p_message text,
  p_limit integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_message text:=lower(coalesce(p_message,''));
  v_topics text[]:='{}'::text[];
  v_limit integer:=greatest(1,least(coalesce(p_limit,5),8));
  v_lookback integer:=45;
  v_result jsonb;
begin
  if p_student_id is null then return '[]'::jsonb; end if;

  select coalesce(s.activity_lookback_days,45)
    into v_lookback
  from public.dimensional_gate_settings s
  join public.students st on st.classroom_id=s.classroom_id
  where st.id=p_student_id
  limit 1;
  v_lookback:=coalesce(v_lookback,45);

  if v_message ~ '(아케이드|게임|점수|기록|인증|반응|타카|라카)' then v_topics:=array_append(v_topics,'arcade'); end if;
  if v_message ~ '(길드|미션|동료|팀|협동|기여|평가)' then v_topics:=array_append(v_topics,'guild'); end if;
  if v_message ~ '(업적|칭호|배지|뱃지|달성)' then v_topics:=array_append(v_topics,'achievement'); end if;
  if v_message ~ '(골드|돈|자산|크리스탈|브랜드가치|bv|소비|저축|예금|경제|경매|거래)' then v_topics:=array_append(v_topics,'economy'); end if;
  if v_message ~ '(편린|영입|캐릭터|콜렉션|수집)' then v_topics:=array_append(v_topics,'character'); end if;
  if v_message ~ '(원정|원정대|탐험)' then v_topics:=array_append(v_topics,'expedition'); end if;

  with candidates as (
    select
      'achievement'::text category,
      'ACHIEVEMENT_EARNED'::text event_type,
      sa.achieved_at occurred_at,
      ('업적 달성 · '||a.name)::text title,
      ('업적 「'||a.name||'」을 달성함')::text summary,
      'student_achievements'::text source_table,
      sa.id::bigint source_id,
      jsonb_build_object('achievement_name',a.name,'grade',a.grade::text,'achievement_uid',a.achievement_uid) data,
      1::integer base_priority
    from public.student_achievements sa
    join public.achievements a on a.id=sa.achievement_id
    where sa.student_id=p_student_id
      and sa.is_revoked=false
      and a.is_active=true

    union all

    select
      'arcade',
      'ARCADE_OFFICIAL_RESULT',
      coalesce(r.achieved_at,r.decided_at,r.updated_at),
      ('아케이드 공식 기록 · '||coalesce(g.internal_name,g.code,'게임')),
      (coalesce(g.internal_name,g.code,'게임')||'에서 공식 점수 '||coalesce(r.official_score,0)::text||'점을 기록함'),
      'arcade_verification_official_results',
      r.id,
      jsonb_build_object(
        'game_code',g.code,
        'game_name',coalesce(g.internal_name,g.code),
        'official_score',r.official_score,
        'official_duration_ms',r.official_duration_ms,
        'decision_kind',r.decision_kind,
        'ranking_eligible',r.ranking_eligible
      ),
      1
    from public.arcade_verification_official_results r
    join public.arcade_games g on g.id=r.game_id
    where r.student_id=p_student_id
      and r.ranking_eligible=true
      and r.official_score is not null

    union all

    select
      'guild',
      'GUILD_MISSION_GRADE',
      ge.graded_at,
      ('길드 미션 평가 · '||m.title),
      ('길드 미션 「'||m.title||'」 개인 등급 '||ge.grade||'을 받음'),
      'guild3_mission_grade_events',
      ge.id,
      jsonb_build_object('mission_id',m.id,'mission_title',m.title,'grade',ge.grade),
      1
    from public.guild3_mission_grade_events ge
    join public.guild3_missions m on m.id=ge.mission_id
    where ge.student_id=p_student_id
      and ge.grade is not null
      and not exists (
        select 1 from public.guild3_mission_grade_events newer
        where newer.supersedes_grade_event_id=ge.id
      )

    union all

    select
      'economy',
      'ECONOMY_TRANSACTION',
      t.created_at,
      ('경제 기록 · '||t.value_token::text),
      (t.value_token::text||'가 '||case when t.amount>=0 then '+' else '' end||t.amount::text||' 변동됨'),
      'transactions',
      t.id,
      jsonb_build_object('token',t.value_token::text,'amount',t.amount,'balance_after',t.balance_after,'source_type',t.source_type::text),
      4
    from public.transactions t
    where t.student_id=p_student_id
      and t.is_reversed=false
      and t.source_type::text not in ('INITIAL_BALANCE','CORRECTION','REVERSAL')

    union all

    select
      'character',
      'CHARACTER_ACQUIRED',
      sc.acquired_at,
      ('편린 영입 · '||c.name),
      ('편린 「'||c.name||'」을 영입함'),
      'student_characters',
      sc.id,
      jsonb_build_object('character_id',c.id,'character_uid',c.character_uid,'character_name',c.name,'acquired_via',sc.acquired_via),
      3
    from public.student_characters sc
    join public.characters c on c.id=sc.character_id
    where sc.student_id=p_student_id
      and sc.is_owned=true
      and sc.acquired_at is not null
  ), filtered as (
    select c.*
    from candidates c
    where c.occurred_at is not null
      and c.occurred_at >= now() - make_interval(days=>v_lookback)
      and (
        coalesce(array_length(v_topics,1),0)=0
        or c.category=any(v_topics)
      )
  ), ranked as (
    select f.*,
      row_number() over(partition by f.category order by f.occurred_at desc,f.source_id desc) as category_rank,
      (extract(epoch from (now()-f.occurred_at))/86400.0 + f.base_priority*3.0) as relevance_score
    from filtered f
  ), picked as (
    select *
    from ranked
    where coalesce(array_length(v_topics,1),0)>0 or category_rank<=2
    order by
      case when coalesce(array_length(v_topics,1),0)>0 then 0 else relevance_score end asc,
      occurred_at desc,source_id desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type',event_type,
        'category',category,
        'occurred_at',occurred_at,
        'title',title,
        'summary',summary,
        'source',jsonb_build_object('table',source_table,'id',source_id),
        'data',data,
        'verified',true
      ) order by occurred_at desc, base_priority asc
    ),
    '[]'::jsonb
  ) into v_result
  from picked;

  return coalesce(v_result,'[]'::jsonb);
end;
$function$;

-- Internal helper. Students receive it only through the chat-begin context.
revoke all on function public.dimensional_gate_activity_context(integer,text,integer) from public, anon, authenticated;
grant execute on function public.dimensional_gate_activity_context(integer,text,integer) to service_role;

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
  v_activities jsonb;
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

  v_activities:=public.dimensional_gate_activity_context(v_student_id,p_message,coalesce(v_settings.activity_event_limit,5));

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
    'activity_events',coalesce(v_activities,'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.student_begin_dimensional_gate_chat(bigint,uuid,text) from public, anon;
grant execute on function public.student_begin_dimensional_gate_chat(bigint,uuid,text) to authenticated, service_role;


commit;
