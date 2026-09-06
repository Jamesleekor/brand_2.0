-- B.R.A.N.D 2.0 — Record Room candidate staging workflow
-- Candidates never publish automatically. Refresh is blocked when analytics validation has ERRORs.

create table public.records_candidates (
  id bigint generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id) on delete cascade,
  candidate_key text not null,
  candidate_type text not null,
  student_id integer references public.students(id) on delete set null,
  student_name_snapshot text,
  brand_name_snapshot text,
  guild_id integer references public.guilds(id) on delete set null,
  guild_name_snapshot text,
  subject_type text not null check (subject_type in ('STUDENT','GUILD','SYSTEM')),
  subject_id text,
  value_numeric numeric,
  value_text text,
  occurred_at timestamptz,
  source_type text not null,
  source_id text,
  season_id integer references public.guild_seasons(id) on delete set null,
  period_id bigint,
  is_official boolean not null default false,
  coverage text not null default 'EXACT',
  status text not null default 'PENDING' check (status in ('PENDING','NEEDS_REVIEW','APPROVED','IGNORED','REJECTED')),
  record_hall_key text not null check (record_hall_key in ('PIONEERS','THRONE','REPEATED_CROWNS','ASCENT','GOLDEN_CHRONICLE','GUILD_HEGEMONY','ARCADE_RULERS','CONSTELLATION','SOVEREIGN_PROOF')),
  record_type text not null,
  record_title text not null,
  record_subtitle text,
  record_unit text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  reviewed_at timestamptz,
  reviewed_by uuid,
  decision_note text,
  published_entry_id bigint references public.records_historical_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(classroom_id,candidate_key)
);

create index records_candidates_queue_idx on public.records_candidates(classroom_id,status,occurred_at desc,id desc);
create index records_candidates_student_idx on public.records_candidates(student_id,occurred_at desc) where student_id is not null;
create index records_candidates_type_idx on public.records_candidates(classroom_id,candidate_type,status);

alter table public.records_candidates enable row level security;
revoke all on table public.records_candidates from public,anon,authenticated;
revoke all on sequence public.records_candidates_id_seq from public,anon,authenticated;
grant select,insert,update,delete on table public.records_candidates to service_role;
grant usage,select on sequence public.records_candidates_id_seq to service_role;

create or replace function public.teacher_refresh_record_candidates(p_classroom_id integer)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_validation jsonb;
  v_e jsonb;
  v_a jsonb;
  v_x jsonb;
  v_before bigint;
  v_after bigint;
  v_upserted bigint;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_validation := public.teacher_get_data_validation_report(p_classroom_id,false);
  if coalesce(v_validation->'summary'->>'status','ERROR')='ERROR' then
    raise exception 'Record candidate refresh blocked because analytics validation has ERROR issues.' using errcode='P0630';
  end if;

  v_e := public.teacher_get_statistics_economy(p_classroom_id,false);
  v_a := public.teacher_get_statistics_achievements(p_classroom_id,false);
  v_x := public.teacher_get_statistics_assets(p_classroom_id,false);

  select count(*) into v_before from public.records_candidates where classroom_id=p_classroom_id;

  with
  gold_events as (
    select (s->>'student_id')::integer student_id,s->>'student_name' student_name,s->>'brand_name' brand_name,
           (t->>'threshold_gold')::numeric threshold_gold,t->>'label' label,(t->>'first_reached_at')::timestamptz occurred_at,
           row_number() over(partition by (t->>'threshold_gold')::numeric order by (t->>'first_reached_at')::timestamptz,(s->>'student_id')::integer) rn
    from jsonb_array_elements(coalesce(v_e->'students','[]'::jsonb)) s
    cross join lateral jsonb_array_elements(coalesce(s->'gold'->'thresholds','[]'::jsonb)) t
    where t->>'first_reached_at' is not null
  ),
  tier_events as (
    select (s->>'student_id')::integer student_id,s->>'student_name' student_name,s->>'brand_name' brand_name,
           (t->>'tier_order')::integer tier_order,t->>'tier_name' tier_name,(t->>'min_bv')::numeric min_bv,
           (t->>'first_reached_at')::timestamptz occurred_at,
           row_number() over(partition by (t->>'tier_order')::integer order by (t->>'first_reached_at')::timestamptz,(s->>'student_id')::integer) rn
    from jsonb_array_elements(coalesce(v_e->'students','[]'::jsonb)) s
    cross join lateral jsonb_array_elements(coalesce(s->'bv'->'tier_first_reaches','[]'::jsonb)) t
    where t->>'first_reached_at' is not null
  ),
  achievement_first as (
    select a,(a->'first_valid_achiever'->>'student_id')::integer student_id,
           a->'first_valid_achiever'->>'student_name' student_name,
           a->'first_valid_achiever'->>'brand_name' brand_name,
           (a->'first_valid_achiever'->>'achieved_at')::timestamptz occurred_at
    from jsonb_array_elements(coalesce(v_a->'achievements','[]'::jsonb)) a
    where a->'first_valid_achiever' is not null and jsonb_typeof(a->'first_valid_achiever')='object'
      and a->'first_valid_achiever'->>'student_id' is not null
  ),
  transcendent_global as (
    select v_a->'transcendent'->'first_achiever' a
    where v_a->'transcendent'->'first_achiever' is not null
      and jsonb_typeof(v_a->'transcendent'->'first_achiever')='object'
  ),
  character_first as (
    select c,c->'first_known_acquirer' f
    from jsonb_array_elements(coalesce(v_x->'characters'->'catalog','[]'::jsonb)) c
    where c->'first_known_acquirer' is not null and jsonb_typeof(c->'first_known_acquirer')='object'
  ),
  collection_first as (
    select c,c->'first_completer' f
    from jsonb_array_elements(coalesce(v_x->'collections'->'catalog','[]'::jsonb)) c
    where c->'first_completer' is not null and jsonb_typeof(c->'first_completer')='object'
  ),
  special_item_first as (
    select i,i->'first_recipient' f
    from jsonb_array_elements(coalesce(v_x->'items'->'catalog','[]'::jsonb)) i
    where coalesce((i->>'is_special')::boolean,false)
      and i->'first_recipient' is not null and jsonb_typeof(i->'first_recipient')='object'
  ),
  guild_monthly_first as (
    select c.season_id,c.year_month,c.id closure_id,c.current_version_id,
           gs.guild_id,gs.guild_name_at_close,gs.total_gs,v.finalized_at
    from public.guild5_month_closures c
    join public.guild5_closure_versions v on v.id=c.current_version_id and v.closure_id=c.id
    join public.guild5_guild_snapshots gs on gs.version_id=c.current_version_id and gs.rank_position=1
    where c.classroom_id=p_classroom_id and c.lifecycle_state='FINALIZED' and c.current_version_id is not null
  ),
  arcade_monthly_first as (
    select p.guild_season_id season_id,p.id period_id,sn.id snapshot_id,sn.contribution_year_month,
           sn.game_id,coalesce(sn.game_name_at_close,g.internal_name) game_name,
           sr.student_id,coalesce(sr.student_name_at_close,st.name) student_name,
           coalesce(sr.brand_name_at_close,st.brand_name) brand_name,
           sr.official_score,sr.achieved_at
    from public.arcade_monthly_snapshots sn
    join public.arcade_monthly_finalizations f on f.id=sn.finalization_id
    join public.arcade_ranking_periods p on p.id=sn.period_id and p.status='FINALIZED' and p.period_kind='MONTHLY'
    join public.arcade_monthly_snapshot_student_ranks sr on sr.snapshot_id=sn.id and sr.rank=1
    join public.arcade_games g on g.id=sn.game_id
    left join public.students st on st.id=sr.student_id
    where sn.classroom_id=p_classroom_id and public.is_official_participant(sr.student_id)
  ),
  candidates as (
    select 'GOLD_THRESHOLD_FIRST:'||threshold_gold::text candidate_key,'GOLD_THRESHOLD_FIRST_REACHED' candidate_type,
      student_id,student_name student_name_snapshot,brand_name brand_name_snapshot,null::integer guild_id,null::text guild_name_snapshot,
      'STUDENT' subject_type,threshold_gold::text subject_id,threshold_gold value_numeric,label value_text,occurred_at,
      'ECONOMY_REPLAY' source_type,'gold_threshold:'||threshold_gold::text source_id,null::integer season_id,null::bigint period_id,
      true is_official,'EXACT_RECONSTRUCTED' coverage,'PENDING' status,'PIONEERS' record_hall_key,'FIRST_GOLD_THRESHOLD' record_type,
      '최초 '||label||' 보유자' record_title,null::text record_subtitle,'GOLD' record_unit,
      jsonb_build_object('threshold_gold',threshold_gold,'label',label,'rank',1) metadata
    from gold_events where rn=1
    union all
    select 'TIER_FIRST:'||tier_order::text,'TIER_FIRST_REACHED',student_id,student_name,brand_name,null,null,
      'STUDENT',tier_order::text,min_bv,tier_name,occurred_at,'ECONOMY_REPLAY','tier:'||tier_order::text,null,null,
      true,'EXACT_RECONSTRUCTED','PENDING','ASCENT','FIRST_TIER_REACHED','최초 '||tier_name||' 도달',null,'BV',
      jsonb_build_object('tier_order',tier_order,'tier_name',tier_name,'min_bv',min_bv,'rank',1)
    from tier_events where rn=1
    union all
    select 'ACHIEVEMENT_FIRST:'||(a->>'achievement_id'),
      case when a->>'grade'='유일' then 'UNIQUE_ACHIEVEMENT_FIRST_EARNED' else 'ACHIEVEMENT_FIRST_EARNED' end,
      student_id,student_name,brand_name,null,null,'STUDENT',a->>'achievement_id',null,a->>'name',occurred_at,
      'ACHIEVEMENT_HISTORY','achievement:'||(a->>'achievement_id'),null,null,true,'EXACT','PENDING','PIONEERS','FIRST_ACHIEVEMENT',
      '최초 업적 달성 · '||(a->>'name'),null,null,
      jsonb_build_object('achievement_id',(a->>'achievement_id')::integer,'achievement_uid',a->>'achievement_uid','achievement_name',a->>'name','grade',a->>'grade','rank',1)
    from achievement_first
    union all
    select 'TRANSCENDENT_FIRST:GLOBAL','FIRST_TRANSCENDENT_ACHIEVER',
      (a->>'student_id')::integer,a->>'student_name',a->>'brand_name',null,null,'STUDENT','GLOBAL',null,a->>'achievement_name',(a->>'achieved_at')::timestamptz,
      'ACHIEVEMENT_HISTORY','transcendent:first',null,null,true,'EXACT','PENDING','PIONEERS','FIRST_TRANSCENDENT_ACHIEVER',
      '최초 초월 업적 달성자',a->>'achievement_name',null,
      jsonb_build_object('achievement_id',(a->>'achievement_id')::integer,'achievement_name',a->>'achievement_name','rank',1)
    from transcendent_global
    union all
    select 'FRAGMENT_FIRST:'||(c->>'character_id'),'FRAGMENT_FIRST_ACQUIRED',
      (f->>'student_id')::integer,f->>'student_name',f->>'brand_name',null,null,'STUDENT',c->>'character_id',null,c->>'name',(f->>'first_known_at')::timestamptz,
      'CHARACTER_HISTORY','character:'||(c->>'character_id'),null,null,
      coalesce(f->>'quality','PARTIAL_BACKFILL')='EXACT_KNOWN_PURCHASE',coalesce(f->>'quality','PARTIAL_BACKFILL'),
      case when coalesce(f->>'quality','PARTIAL_BACKFILL')='EXACT_KNOWN_PURCHASE' then 'PENDING' else 'NEEDS_REVIEW' end,
      'PIONEERS','FIRST_FRAGMENT_ACQUIRED','최초 편린 획득 · '||(c->>'name'),null,null,
      jsonb_build_object('character_id',(c->>'character_id')::bigint,'character_uid',c->>'character_uid','character_name',c->>'name','source_kind',f->>'source_kind','quality',f->>'quality','rank',1)
    from character_first
    union all
    select 'COLLECTION_FIRST:'||(c->>'collection_id'),'COLLECTION_FIRST_COMPLETED',
      (f->>'student_id')::integer,f->>'student_name',f->>'brand_name',null,null,'STUDENT',c->>'collection_id',null,c->>'collection_name',(f->>'completed_at')::timestamptz,
      'COLLECTION_REPLAY','collection:'||(c->>'collection_id'),null,null,true,'EXACT_RECONSTRUCTED','PENDING',
      'PIONEERS','FIRST_COLLECTION_COMPLETED','최초 컬렉션 완성 · '||(c->>'collection_name'),null,null,
      jsonb_build_object('collection_id',(c->>'collection_id')::bigint,'collection_uid',c->>'collection_uid','collection_name',c->>'collection_name','rank',1)
    from collection_first
    union all
    select 'SPECIAL_ITEM_FIRST:'||(i->>'item_id'),'SPECIAL_ITEM_FIRST_ACQUIRED',
      (f->>'student_id')::integer,f->>'student_name',f->>'brand_name',null,null,'STUDENT',i->>'item_id',null,i->>'name',(f->>'acquired_at')::timestamptz,
      'INVENTORY_HISTORY','item:'||(i->>'item_id'),null,null,true,'EXACT','PENDING','PIONEERS','FIRST_SPECIAL_ITEM_ACQUIRED',
      '최초 특별 아이템 획득 · '||(i->>'name'),null,null,
      jsonb_build_object('item_id',(i->>'item_id')::bigint,'item_name',i->>'name','item_type',i->>'item_type','event_type',f->>'event_type','rank',1)
    from special_item_first
    union all
    select 'GUILD_MONTHLY_CHAMPION:'||season_id::text||':'||year_month||':'||guild_id::text,'GUILD_MONTHLY_CHAMPION',
      null,null,null,guild_id,guild_name_at_close,'GUILD',guild_id::text,total_gs,guild_name_at_close,finalized_at,
      'GUILD5_FINALIZED','version:'||current_version_id::text,season_id,closure_id,true,'FINALIZED_SNAPSHOT','PENDING',
      'GUILD_HEGEMONY','MONTHLY_GUILD_CHAMPION','월간 길드 1위 · '||year_month,year_month,'GS',
      jsonb_build_object('year_month',year_month,'rank',1,'closure_id',closure_id,'version_id',current_version_id)
    from guild_monthly_first
    union all
    select 'ARCADE_MONTHLY_CHAMPION:'||period_id::text||':'||game_id::text,'ARCADE_MONTHLY_CHAMPION',
      student_id,student_name,brand_name,null,null,'STUDENT',game_id::text,official_score,game_name,achieved_at,
      'ARCADE_FINALIZED','snapshot:'||snapshot_id::text,season_id,period_id,true,'FINALIZED_SNAPSHOT','PENDING',
      'ARCADE_RULERS','ARCADE_MONTHLY_CHAMPION','Arcade 월간 1위 · '||game_name,contribution_year_month,'점',
      jsonb_build_object('year_month',contribution_year_month,'game_id',game_id,'game_name',game_name,'rank',1,'snapshot_id',snapshot_id)
    from arcade_monthly_first
  ), upserted as (
    insert into public.records_candidates(
      classroom_id,candidate_key,candidate_type,student_id,student_name_snapshot,brand_name_snapshot,
      guild_id,guild_name_snapshot,subject_type,subject_id,value_numeric,value_text,occurred_at,
      source_type,source_id,season_id,period_id,is_official,coverage,status,
      record_hall_key,record_type,record_title,record_subtitle,record_unit,metadata
    )
    select p_classroom_id,c.* from candidates c
    on conflict (classroom_id,candidate_key) do update set
      student_id=excluded.student_id,student_name_snapshot=excluded.student_name_snapshot,brand_name_snapshot=excluded.brand_name_snapshot,
      guild_id=excluded.guild_id,guild_name_snapshot=excluded.guild_name_snapshot,value_numeric=excluded.value_numeric,value_text=excluded.value_text,
      occurred_at=excluded.occurred_at,source_type=excluded.source_type,source_id=excluded.source_id,season_id=excluded.season_id,period_id=excluded.period_id,
      is_official=excluded.is_official,coverage=excluded.coverage,record_hall_key=excluded.record_hall_key,record_type=excluded.record_type,
      record_title=excluded.record_title,record_subtitle=excluded.record_subtitle,record_unit=excluded.record_unit,metadata=excluded.metadata,updated_at=now()
    where records_candidates.status in ('PENDING','NEEDS_REVIEW')
    returning id
  )
  select count(*) into v_upserted from upserted;

  select count(*) into v_after from public.records_candidates where classroom_id=p_classroom_id;
  return jsonb_build_object(
    'before_count',v_before,'after_count',v_after,'new_count',v_after-v_before,'upserted_count',v_upserted,
    'pending_count',(select count(*) from public.records_candidates where classroom_id=p_classroom_id and status='PENDING'),
    'needs_review_count',(select count(*) from public.records_candidates where classroom_id=p_classroom_id and status='NEEDS_REVIEW'),
    'validation_status',v_validation->'summary'->>'status'
  );
end;
$$;

revoke all on function public.teacher_refresh_record_candidates(integer) from public,anon;
grant execute on function public.teacher_refresh_record_candidates(integer) to authenticated,service_role;

create or replace function public.teacher_get_record_candidates(
  p_classroom_id integer,p_status text default null,p_candidate_type text default null,p_limit integer default 100,p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),250);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_rows jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then raise exception 'Permission denied: classroom mismatch' using errcode='P0511'; end if;
  if p_status is not null and p_status not in ('PENDING','NEEDS_REVIEW','APPROVED','IGNORED','REJECTED') then raise exception 'Invalid candidate status' using errcode='22023'; end if;
  select count(*) into v_total from public.records_candidates c where c.classroom_id=p_classroom_id and (p_status is null or c.status=p_status) and (p_candidate_type is null or c.candidate_type=p_candidate_type);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc nulls last,x.id desc),'[]'::jsonb) into v_rows from (
    select c.* from public.records_candidates c where c.classroom_id=p_classroom_id and (p_status is null or c.status=p_status) and (p_candidate_type is null or c.candidate_type=p_candidate_type)
    order by c.occurred_at desc nulls last,c.id desc limit v_limit offset v_offset
  ) x;
  return jsonb_build_object(
    'total_count',v_total,'limit',v_limit,'offset',v_offset,'rows',v_rows,
    'status_counts',(select jsonb_object_agg(status,n) from (select status,count(*) n from public.records_candidates where classroom_id=p_classroom_id group by status) q),
    'type_counts',(select coalesce(jsonb_object_agg(candidate_type,n),'{}'::jsonb) from (select candidate_type,count(*) n from public.records_candidates where classroom_id=p_classroom_id group by candidate_type) q)
  );
end;
$$;

revoke all on function public.teacher_get_record_candidates(integer,text,text,integer,integer) from public,anon;
grant execute on function public.teacher_get_record_candidates(integer,text,text,integer,integer) to authenticated,service_role;

create or replace function public.teacher_review_record_candidate(p_candidate_id bigint,p_decision text,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_c public.records_candidates%rowtype;
  v_record_key text;
  v_entry_id bigint;
  v_source_kind text;
  v_subject_name text;
  v_sort_order integer;
  v_season_label text;
begin
  perform public.ensure_teacher_role();
  if p_decision not in ('APPROVED','IGNORED','REJECTED') then raise exception 'Decision must be APPROVED, IGNORED, or REJECTED' using errcode='22023'; end if;
  select * into v_c from public.records_candidates c where c.id=p_candidate_id for update;
  if not found then raise exception 'Record candidate not found' using errcode='P0631'; end if;
  if v_c.classroom_id <> public.current_classroom_id() then raise exception 'Permission denied: classroom mismatch' using errcode='P0511'; end if;
  if v_c.status not in ('PENDING','NEEDS_REVIEW') then raise exception 'Record candidate is already reviewed' using errcode='P0632'; end if;

  if p_decision='APPROVED' then
    v_record_key := 'AUTO_'||upper(md5(v_c.classroom_id::text||'|'||v_c.candidate_key));
    v_source_kind := case when v_c.source_type in ('GUILD5_FINALIZED','ARCADE_FINALIZED') then 'PRODUCTION_SNAPSHOT' when v_c.is_official then 'PRODUCTION_DERIVED' else 'CURATED' end;
    v_subject_name := case when v_c.subject_type='GUILD' then v_c.guild_name_snapshot else v_c.student_name_snapshot end;
    if coalesce(btrim(v_subject_name),'')='' then v_subject_name:='B.R.A.N.D'; end if;
    select coalesce(max(r.sort_order),0)+1 into v_sort_order from public.records_historical_entries r;
    if v_c.season_id is not null then select coalesce(gs.display_name,gs.name) into v_season_label from public.guild_seasons gs where gs.id=v_c.season_id; end if;

    insert into public.records_historical_entries(
      record_key,hall_key,record_type,title,subtitle,description,subject_kind,subject_display_name,subject_brand_name,subject_student_id,subject_guild_id,
      school_year,season_label,period_label,occurred_on,rank_position,value_primary,unit,source_kind,source_ref,metadata,status,sort_order
    ) values (
      v_record_key,v_c.record_hall_key,v_c.record_type,v_c.record_title,v_c.record_subtitle,null,v_c.subject_type,v_subject_name,v_c.brand_name_snapshot,v_c.student_id,v_c.guild_id,
      coalesce(extract(year from (v_c.occurred_at at time zone 'Asia/Seoul'))::integer,extract(year from timezone('Asia/Seoul',clock_timestamp()))::integer),
      v_season_label,v_c.record_subtitle,case when v_c.occurred_at is null then null else (v_c.occurred_at at time zone 'Asia/Seoul')::date end,
      coalesce((v_c.metadata->>'rank')::integer,1),v_c.value_numeric,v_c.record_unit,v_source_kind,v_c.source_type||':'||coalesce(v_c.source_id,''),
      v_c.metadata||jsonb_build_object('candidate_id',v_c.id,'candidate_key',v_c.candidate_key,'coverage',v_c.coverage,'approved_at',clock_timestamp()),'ACTIVE',v_sort_order
    ) on conflict(record_key) do nothing returning id into v_entry_id;
    if v_entry_id is null then select r.id into v_entry_id from public.records_historical_entries r where r.record_key=v_record_key; end if;
  end if;

  update public.records_candidates set status=p_decision,reviewed_at=clock_timestamp(),reviewed_by=auth.uid(),decision_note=nullif(btrim(p_note),''),
    published_entry_id=case when p_decision='APPROVED' then v_entry_id else null end,updated_at=now() where id=v_c.id;
  return jsonb_build_object('candidate_id',v_c.id,'status',p_decision,'published_entry_id',v_entry_id);
end;
$$;

revoke all on function public.teacher_review_record_candidate(bigint,text,text) from public,anon;
grant execute on function public.teacher_review_record_candidate(bigint,text,text) to authenticated,service_role;