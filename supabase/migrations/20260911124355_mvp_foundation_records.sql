-- B.R.A.N.D. 2.0 — MVP Foundation Records
-- LOCKED SPEC: BRAND_2.0_MVP_FOUNDATION_LOCKED_SPEC_20260911.md
-- Incremental, teacher-only, snapshot-preserving implementation.

begin;

create table if not exists public.mvp_foundation_sessions (
  id bigserial primary key,
  classroom_id integer not null references public.classrooms(id) on delete restrict,
  title varchar(100) not null,
  evaluation_start_date date not null,
  evaluation_end_date date not null,
  comparison_start_date date not null,
  comparison_end_date date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','FINALIZED')),
  draft_data jsonb not null default '{}'::jsonb,
  last_calculated_at timestamptz,
  finalized_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mvp_foundation_eval_dates_check check (evaluation_start_date <= evaluation_end_date),
  constraint mvp_foundation_compare_dates_check check (comparison_start_date <= comparison_end_date),
  constraint mvp_foundation_title_check check (char_length(btrim(title)) between 2 and 100)
);

create index if not exists idx_mvp_foundation_sessions_classroom_created
  on public.mvp_foundation_sessions(classroom_id, created_at desc);
create index if not exists idx_mvp_foundation_sessions_classroom_status
  on public.mvp_foundation_sessions(classroom_id, status, id desc);

create table if not exists public.mvp_foundation_teacher_inputs (
  session_id bigint not null references public.mvp_foundation_sessions(id) on delete restrict,
  student_id integer not null references public.students(id) on delete restrict,
  is_preliminary_candidate boolean not null default false,
  preparation_responsibility_grade text,
  participation_listening_grade text,
  assignment_performance_grade text,
  improvement_growth_grade text,
  notes text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (session_id, student_id),
  constraint mvp_foundation_grade_1_check check (preparation_responsibility_grade is null or preparation_responsibility_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_grade_2_check check (participation_listening_grade is null or participation_listening_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_grade_3_check check (assignment_performance_grade is null or assignment_performance_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_grade_4_check check (improvement_growth_grade is null or improvement_growth_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_notes_check check (notes is null or char_length(notes) <= 2000)
);

create index if not exists idx_mvp_foundation_inputs_candidate
  on public.mvp_foundation_teacher_inputs(session_id, is_preliminary_candidate, student_id);

create table if not exists public.mvp_foundation_student_snapshots (
  id bigserial primary key,
  session_id bigint not null references public.mvp_foundation_sessions(id) on delete restrict,
  student_id integer not null references public.students(id) on delete restrict,
  student_name_snapshot text not null,
  brand_name_snapshot text,
  guild_name_snapshot text,
  guild_id_snapshot integer,
  evaluation_bv_earned bigint not null default 0,
  evaluation_bv_deducted bigint not null default 0,
  evaluation_bv_net bigint not null default 0,
  comparison_bv_earned bigint not null default 0,
  bv_growth_rate numeric(12,2),
  bv_growth_status text not null default 'RATE' check (bv_growth_status in ('RATE','NEW')),
  daily_quest_target_days integer not null default 0,
  daily_quest_completed_days integer not null default 0,
  daily_quest_completion_rate numeric(7,2),
  achievement_count integer not null default 0,
  achievement_score integer not null default 0,
  achievement_detail jsonb not null default '[]'::jsonb,
  guild_score numeric(14,2) not null default 0,
  personal_contribution_score numeric(14,2) not null default 0,
  personal_contribution_coverage text not null default 'MONTHLY_AGGREGATE',
  donation_gold bigint not null default 0,
  secondary_job_sales_completed integer not null default 0,
  evidence_detail jsonb not null default '{}'::jsonb,
  is_preliminary_candidate boolean not null default false,
  preparation_responsibility_grade text not null,
  participation_listening_grade text not null,
  assignment_performance_grade text not null,
  improvement_growth_grade text not null,
  notes_snapshot text,
  finalized_at timestamptz not null,
  unique (session_id, student_id),
  constraint mvp_foundation_snapshot_grade_1_check check (preparation_responsibility_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_snapshot_grade_2_check check (participation_listening_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_snapshot_grade_3_check check (assignment_performance_grade in ('S+','S','A+','A','B')),
  constraint mvp_foundation_snapshot_grade_4_check check (improvement_growth_grade in ('S+','S','A+','A','B'))
);

create index if not exists idx_mvp_foundation_snapshots_session_candidate
  on public.mvp_foundation_student_snapshots(session_id, is_preliminary_candidate, student_id);

alter table public.mvp_foundation_sessions enable row level security;
alter table public.mvp_foundation_teacher_inputs enable row level security;
alter table public.mvp_foundation_student_snapshots enable row level security;

revoke all on table public.mvp_foundation_sessions from public, anon, authenticated;
revoke all on table public.mvp_foundation_teacher_inputs from public, anon, authenticated;
revoke all on table public.mvp_foundation_student_snapshots from public, anon, authenticated;
revoke all on sequence public.mvp_foundation_sessions_id_seq from public, anon, authenticated;
revoke all on sequence public.mvp_foundation_student_snapshots_id_seq from public, anon, authenticated;

-- Internal calculation helper. Direct execution is revoked below.
create or replace function public._mvp_foundation_calculate_payload(
  p_classroom_id integer,
  p_evaluation_start date,
  p_evaluation_end date,
  p_comparison_start date,
  p_comparison_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_eval_start_ts timestamptz;
  v_eval_end_ts timestamptz;
  v_compare_start_ts timestamptz;
  v_compare_end_ts timestamptz;
  v_result jsonb;
begin
  if p_classroom_id is null then
    raise exception '학급 정보가 필요합니다.' using errcode='PMV01';
  end if;
  if p_evaluation_start is null or p_evaluation_end is null or p_evaluation_start > p_evaluation_end then
    raise exception '평가기간이 올바르지 않습니다.' using errcode='PMV02';
  end if;
  if p_comparison_start is null or p_comparison_end is null or p_comparison_start > p_comparison_end then
    raise exception '비교기간이 올바르지 않습니다.' using errcode='PMV03';
  end if;

  v_eval_start_ts := p_evaluation_start::timestamp at time zone 'Asia/Seoul';
  v_eval_end_ts := (p_evaluation_end + 1)::timestamp at time zone 'Asia/Seoul';
  v_compare_start_ts := p_comparison_start::timestamp at time zone 'Asia/Seoul';
  v_compare_end_ts := (p_comparison_end + 1)::timestamp at time zone 'Asia/Seoul';

  with
  eligible_students as (
    select s.id,s.name,s.brand_name
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.transferred_at is null
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      and not coalesce(s.is_test_account,false)
      and public.is_official_participant(s.id)
  ),
  current_guild as (
    select distinct on (gm.student_id)
      gm.student_id,gm.guild_id,g.name as guild_name
    from public.guild_members gm
    join public.guilds g on g.id=gm.guild_id
    join eligible_students es on es.id=gm.student_id
    where gm.left_at is null
    order by gm.student_id,gm.joined_at desc,gm.id desc
  ),
  eval_bv as (
    select t.student_id,
      coalesce(sum(t.amount) filter (where t.amount>0),0)::bigint as earned,
      coalesce(sum(abs(t.amount)) filter (where t.amount<0),0)::bigint as deducted,
      coalesce(jsonb_agg(jsonb_build_object(
        'transaction_id',t.id,'amount',t.amount,'source_type',t.source_type::text,
        'memo',t.memo,'created_at',t.created_at
      ) order by t.created_at,t.id),'[]'::jsonb) as events
    from public.transactions t
    join eligible_students es on es.id=t.student_id
    where t.classroom_id=p_classroom_id
      and t.value_token::text='BV'
      and not coalesce(t.is_reversed,false)
      and t.created_at>=v_eval_start_ts and t.created_at<v_eval_end_ts
    group by t.student_id
  ),
  compare_bv as (
    select t.student_id,
      coalesce(sum(t.amount) filter (where t.amount>0),0)::bigint as earned
    from public.transactions t
    join eligible_students es on es.id=t.student_id
    where t.classroom_id=p_classroom_id
      and t.value_token::text='BV'
      and not coalesce(t.is_reversed,false)
      and t.created_at>=v_compare_start_ts and t.created_at<v_compare_end_ts
    group by t.student_id
  ),
  dq_per_day as (
    select r.quest_date,c.student_id,
      count(*) filter (where c.quest_code in ('ATTENDANCE','PRIMARY_JOB','LEARNING_MATERIALS','CLEANING'))::integer as total_count,
      count(*) filter (where c.quest_code in ('ATTENDANCE','PRIMARY_JOB','LEARNING_MATERIALS','CLEANING') and c.result='PASS')::integer as pass_count
    from public.daily_quest_reports r
    join public.daily_quest_checks c on c.report_id=r.id
    join eligible_students es on es.id=c.student_id
    where r.classroom_id=p_classroom_id
      and r.status='SETTLED'
      and r.quest_date between p_evaluation_start and p_evaluation_end
    group by r.quest_date,c.student_id
    having count(*) filter (where c.quest_code in ('ATTENDANCE','PRIMARY_JOB','LEARNING_MATERIALS','CLEANING'))=4
  ),
  dq_agg as (
    select d.student_id,
      count(*)::integer as target_days,
      count(*) filter (where d.pass_count=4)::integer as completed_days,
      jsonb_agg(jsonb_build_object(
        'date',d.quest_date,'pass_count',d.pass_count,'total_count',d.total_count,
        'completed',(d.pass_count=4)
      ) order by d.quest_date) as days
    from dq_per_day d
    group by d.student_id
  ),
  achievement_agg as (
    select sa.student_id,
      count(*)::integer as achievement_count,
      coalesce(sum(a.achievement_score),0)::integer as achievement_score,
      jsonb_agg(jsonb_build_object(
        'student_achievement_id',sa.id,'achievement_id',a.id,'uid',a.achievement_uid,
        'name',a.name,'grade',a.grade::text,'score',a.achievement_score,'achieved_at',sa.achieved_at
      ) order by sa.achieved_at,sa.id) as details
    from public.student_achievements sa
    join public.achievements a on a.id=sa.achievement_id
    join eligible_students es on es.id=sa.student_id
    where sa.classroom_id=p_classroom_id
      and not coalesce(sa.is_revoked,false)
      and sa.achieved_at>=v_eval_start_ts and sa.achieved_at<v_eval_end_ts
    group by sa.student_id
  ),
  guild_score_by_guild as (
    select es.id as student_id,ge.guild_id,g.name as guild_name,
      coalesce(sum(ge.points),0)::numeric as guild_points,
      count(*)::integer as event_count
    from eligible_students es
    join public.guild2_gs_events ge
      on ge.classroom_id=p_classroom_id
     and ge.created_at>=v_eval_start_ts and ge.created_at<v_eval_end_ts
    join public.guilds g on g.id=ge.guild_id
    where exists (
      select 1
      from public.guild_members gm
      where gm.student_id=es.id
        and gm.guild_id=ge.guild_id
        and ge.created_at>=gm.joined_at
        and (gm.left_at is null or ge.created_at<gm.left_at)
    )
    group by es.id,ge.guild_id,g.name
  ),
  guild_score_agg as (
    select x.student_id,
      coalesce(sum(x.guild_points),0)::numeric as guild_score,
      jsonb_agg(jsonb_build_object(
        'guild_id',x.guild_id,'guild_name',x.guild_name,'points',x.guild_points,'event_count',x.event_count
      ) order by x.guild_id) as details
    from guild_score_by_guild x
    group by x.student_id
  ),
  contribution_rows as (
    select c.student_id,c.year_month,c.scoring_guild_id,g.name as guild_name,
      c.final_total,c.basic_total,c.peer_points,c.mission_points,c.session_points,
      c.teacher_observation_points,c.arcade_applied,c.calculated_at
    from public.guild2_individual_contributions c
    join eligible_students es on es.id=c.student_id
    left join public.guilds g on g.id=c.scoring_guild_id
    where c.classroom_id=p_classroom_id
      and to_date(c.year_month||'-01','YYYY-MM-DD') <= p_evaluation_end
      and (to_date(c.year_month||'-01','YYYY-MM-DD') + interval '1 month')::date > p_evaluation_start
  ),
  contribution_agg as (
    select c.student_id,
      coalesce(sum(c.final_total),0)::numeric as personal_contribution_score,
      jsonb_agg(jsonb_build_object(
        'year_month',c.year_month,'guild_id',c.scoring_guild_id,'guild_name',c.guild_name,
        'final_total',c.final_total,'basic_total',c.basic_total,'peer_points',c.peer_points,
        'mission_points',c.mission_points,'session_points',c.session_points,
        'teacher_observation_points',c.teacher_observation_points,'arcade_applied',c.arcade_applied,
        'calculated_at',c.calculated_at
      ) order by c.year_month) as details
    from contribution_rows c
    group by c.student_id
  ),
  donation_agg as (
    select t.student_id,
      coalesce(sum(abs(t.amount)),0)::bigint as donation_gold,
      jsonb_agg(jsonb_build_object(
        'transaction_id',t.id,'amount',abs(t.amount),'memo',t.memo,'created_at',t.created_at
      ) order by t.created_at,t.id) as details
    from public.transactions t
    join eligible_students es on es.id=t.student_id
    where t.classroom_id=p_classroom_id
      and t.value_token::text='GOLD'
      and t.source_type::text='DONATION'
      and t.amount<0
      and not coalesce(t.is_reversed,false)
      and t.created_at>=v_eval_start_ts and t.created_at<v_eval_end_ts
    group by t.student_id
  ),
  service_agg as (
    select o.seller_student_id as student_id,
      count(*)::integer as completed_count,
      jsonb_agg(jsonb_build_object(
        'order_id',o.id,'service_title',o.service_title_snapshot,
        'buyer_student_id',o.buyer_student_id,'buyer_name',b.name,
        'price_gold',coalesce(o.price_gold_snapshot,
          case when o.unit_price_gold_snapshot is not null then o.unit_price_gold_snapshot*coalesce(o.quantity,o.requested_quantity,1) else 0 end),
        'completed_at',o.completed_at
      ) order by o.completed_at,o.id) as details
    from public.secondary_job_service_orders o
    join eligible_students es on es.id=o.seller_student_id
    left join public.students b on b.id=o.buyer_student_id
    where o.classroom_id=p_classroom_id
      and o.status='COMPLETED'
      and o.completed_at is not null
      and o.completed_at>=v_eval_start_ts and o.completed_at<v_eval_end_ts
    group by o.seller_student_id
  ),
  student_rows as (
    select es.id as student_id,es.name as student_name,es.brand_name,
      cg.guild_id,cg.guild_name,
      coalesce(eb.earned,0)::bigint as evaluation_bv_earned,
      coalesce(eb.deducted,0)::bigint as evaluation_bv_deducted,
      (coalesce(eb.earned,0)-coalesce(eb.deducted,0))::bigint as evaluation_bv_net,
      coalesce(cb.earned,0)::bigint as comparison_bv_earned,
      case
        when coalesce(cb.earned,0)=0 and coalesce(eb.earned,0)>0 then null
        when coalesce(cb.earned,0)=0 then 0::numeric
        else round(((coalesce(eb.earned,0)-cb.earned)::numeric/cb.earned::numeric)*100,2)
      end as bv_growth_rate,
      case when coalesce(cb.earned,0)=0 and coalesce(eb.earned,0)>0 then 'NEW' else 'RATE' end as bv_growth_status,
      coalesce(dq.target_days,0)::integer as daily_quest_target_days,
      coalesce(dq.completed_days,0)::integer as daily_quest_completed_days,
      case when coalesce(dq.target_days,0)=0 then null
           else round((dq.completed_days::numeric/dq.target_days::numeric)*100,2) end as daily_quest_completion_rate,
      coalesce(aa.achievement_count,0)::integer as achievement_count,
      coalesce(aa.achievement_score,0)::integer as achievement_score,
      coalesce(ga.guild_score,0)::numeric as guild_score,
      coalesce(ca.personal_contribution_score,0)::numeric as personal_contribution_score,
      'MONTHLY_AGGREGATE'::text as personal_contribution_coverage,
      coalesce(da.donation_gold,0)::bigint as donation_gold,
      coalesce(sa.completed_count,0)::integer as secondary_job_sales_completed,
      jsonb_build_object(
        'bv',jsonb_build_object(
          'evaluation_events',coalesce(eb.events,'[]'::jsonb),
          'evaluation_earned',coalesce(eb.earned,0),'evaluation_deducted',coalesce(eb.deducted,0),
          'evaluation_net',coalesce(eb.earned,0)-coalesce(eb.deducted,0),
          'comparison_earned',coalesce(cb.earned,0)
        ),
        'daily_quest',jsonb_build_object(
          'target_days',coalesce(dq.target_days,0),'completed_days',coalesce(dq.completed_days,0),
          'days',coalesce(dq.days,'[]'::jsonb)
        ),
        'achievements',coalesce(aa.details,'[]'::jsonb),
        'guild_score',jsonb_build_object(
          'total',coalesce(ga.guild_score,0),'guilds',coalesce(ga.details,'[]'::jsonb)
        ),
        'personal_contribution',jsonb_build_object(
          'coverage','MONTHLY_AGGREGATE','rows',coalesce(ca.details,'[]'::jsonb)
        ),
        'donations',coalesce(da.details,'[]'::jsonb),
        'services',coalesce(sa.details,'[]'::jsonb)
      ) as evidence
    from eligible_students es
    left join current_guild cg on cg.student_id=es.id
    left join eval_bv eb on eb.student_id=es.id
    left join compare_bv cb on cb.student_id=es.id
    left join dq_agg dq on dq.student_id=es.id
    left join achievement_agg aa on aa.student_id=es.id
    left join guild_score_agg ga on ga.student_id=es.id
    left join contribution_agg ca on ca.student_id=es.id
    left join donation_agg da on da.student_id=es.id
    left join service_agg sa on sa.student_id=es.id
  )
  select jsonb_build_object(
    'calculated_at',clock_timestamp(),
    'evaluation_period',jsonb_build_object('start',p_evaluation_start,'end',p_evaluation_end),
    'comparison_period',jsonb_build_object('start',p_comparison_start,'end',p_comparison_end),
    'summary',jsonb_build_object(
      'student_count',(select count(*) from student_rows),
      'daily_quest_source','SETTLED_REPORTS_4_OF_4',
      'guild_score_source','GUILD2_GS_EVENT_LEDGER_EXACT_PERIOD',
      'personal_contribution_source','GUILD2_MONTHLY_OFFICIAL_AGGREGATE',
      'personal_contribution_warning','개인 기여도는 시스템 원천 자체가 월 단위이므로 평가기간과 겹치는 공식 월 집계값을 합산합니다.'
    ),
    'students',coalesce((
      select jsonb_agg(to_jsonb(sr) order by sr.evaluation_bv_earned desc,sr.student_name,sr.student_id)
      from student_rows sr
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.teacher_list_mvp_foundation_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  if v_classroom_id is null then raise exception '학급 정보를 찾을 수 없습니다.' using errcode='PMV10'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,'title',s.title,'status',s.status,
      'evaluation_start_date',s.evaluation_start_date,'evaluation_end_date',s.evaluation_end_date,
      'comparison_start_date',s.comparison_start_date,'comparison_end_date',s.comparison_end_date,
      'last_calculated_at',s.last_calculated_at,'finalized_at',s.finalized_at,
      'created_at',s.created_at,'updated_at',s.updated_at,
      'candidate_count',case when s.status='FINALIZED' then
        (select count(*) from public.mvp_foundation_student_snapshots x where x.session_id=s.id and x.is_preliminary_candidate)
        else (select count(*) from public.mvp_foundation_teacher_inputs x where x.session_id=s.id and x.is_preliminary_candidate)
      end
    ) order by s.id desc)
    from public.mvp_foundation_sessions s
    where s.classroom_id=v_classroom_id
  ),'[]'::jsonb);
end;
$$;

create or replace function public.teacher_create_mvp_foundation_session(
  p_title text,
  p_evaluation_start date,
  p_evaluation_end date,
  p_comparison_start date,
  p_comparison_end date
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_title text:=btrim(coalesce(p_title,''));
  v_id bigint;
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  if v_classroom_id is null then raise exception '학급 정보를 찾을 수 없습니다.' using errcode='PMV10'; end if;
  if char_length(v_title) not between 2 and 100 then raise exception '회차명은 2~100자로 입력해주세요.' using errcode='PMV11'; end if;
  if p_evaluation_start is null or p_evaluation_end is null or p_evaluation_start>p_evaluation_end then raise exception '평가기간이 올바르지 않습니다.' using errcode='PMV12'; end if;
  if p_comparison_start is null or p_comparison_end is null or p_comparison_start>p_comparison_end then raise exception '비교기간이 올바르지 않습니다.' using errcode='PMV13'; end if;

  insert into public.mvp_foundation_sessions(
    classroom_id,title,evaluation_start_date,evaluation_end_date,
    comparison_start_date,comparison_end_date,status,created_by
  ) values(
    v_classroom_id,v_title,p_evaluation_start,p_evaluation_end,
    p_comparison_start,p_comparison_end,'DRAFT',auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.teacher_update_mvp_foundation_session(
  p_session_id bigint,
  p_title text,
  p_evaluation_start date,
  p_evaluation_end date,
  p_comparison_start date,
  p_comparison_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_title text:=btrim(coalesce(p_title,''));
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  select * into v_session from public.mvp_foundation_sessions where id=p_session_id for update;
  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14'; end if;
  if v_session.status<>'DRAFT' then raise exception '확정된 MVP 회차는 수정할 수 없습니다.' using errcode='PMV15'; end if;
  if char_length(v_title) not between 2 and 100 then raise exception '회차명은 2~100자로 입력해주세요.' using errcode='PMV11'; end if;
  if p_evaluation_start is null or p_evaluation_end is null or p_evaluation_start>p_evaluation_end then raise exception '평가기간이 올바르지 않습니다.' using errcode='PMV12'; end if;
  if p_comparison_start is null or p_comparison_end is null or p_comparison_start>p_comparison_end then raise exception '비교기간이 올바르지 않습니다.' using errcode='PMV13'; end if;

  update public.mvp_foundation_sessions
  set title=v_title,evaluation_start_date=p_evaluation_start,evaluation_end_date=p_evaluation_end,
      comparison_start_date=p_comparison_start,comparison_end_date=p_comparison_end,
      draft_data=case when evaluation_start_date is distinct from p_evaluation_start
                        or evaluation_end_date is distinct from p_evaluation_end
                        or comparison_start_date is distinct from p_comparison_start
                        or comparison_end_date is distinct from p_comparison_end
                      then '{}'::jsonb else draft_data end,
      last_calculated_at=case when evaluation_start_date is distinct from p_evaluation_start
                        or evaluation_end_date is distinct from p_evaluation_end
                        or comparison_start_date is distinct from p_comparison_start
                        or comparison_end_date is distinct from p_comparison_end
                      then null else last_calculated_at end,
      updated_at=now()
  where id=v_session.id;

  return jsonb_build_object('session_id',v_session.id,'saved',true);
end;
$$;

create or replace function public.teacher_calculate_mvp_foundation_data(p_session_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_payload jsonb;
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  select * into v_session from public.mvp_foundation_sessions where id=p_session_id for update;
  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14'; end if;
  if v_session.status<>'DRAFT' then raise exception '확정된 MVP 회차는 다시 계산할 수 없습니다.' using errcode='PMV16'; end if;

  v_payload:=public._mvp_foundation_calculate_payload(
    v_session.classroom_id,v_session.evaluation_start_date,v_session.evaluation_end_date,
    v_session.comparison_start_date,v_session.comparison_end_date
  );

  update public.mvp_foundation_sessions
  set draft_data=v_payload,last_calculated_at=now(),updated_at=now()
  where id=v_session.id;

  insert into public.mvp_foundation_teacher_inputs(session_id,student_id,updated_by)
  select v_session.id,(x->>'student_id')::integer,auth.uid()
  from jsonb_array_elements(coalesce(v_payload->'students','[]'::jsonb)) x
  on conflict(session_id,student_id) do nothing;

  return jsonb_build_object(
    'session_id',v_session.id,'last_calculated_at',now(),
    'student_count',jsonb_array_length(coalesce(v_payload->'students','[]'::jsonb))
  );
end;
$$;

create or replace function public.teacher_save_mvp_foundation_input(
  p_session_id bigint,
  p_student_id integer,
  p_is_preliminary_candidate boolean,
  p_preparation_responsibility_grade text,
  p_participation_listening_grade text,
  p_assignment_performance_grade text,
  p_improvement_growth_grade text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_candidate_count integer;
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  select * into v_session from public.mvp_foundation_sessions where id=p_session_id for update;
  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14'; end if;
  if v_session.status<>'DRAFT' then raise exception '확정된 MVP 회차는 수정할 수 없습니다.' using errcode='PMV15'; end if;
  if not exists(select 1 from public.students s where s.id=p_student_id and s.classroom_id=v_classroom_id and s.transferred_at is null and public.is_official_participant(s.id)) then
    raise exception '현재 학급의 활성 학생을 찾을 수 없습니다.' using errcode='PMV17';
  end if;
  if p_preparation_responsibility_grade is not null and p_preparation_responsibility_grade not in ('S+','S','A+','A','B') then raise exception '수업준비와 책임 등급이 올바르지 않습니다.' using errcode='PMV18'; end if;
  if p_participation_listening_grade is not null and p_participation_listening_grade not in ('S+','S','A+','A','B') then raise exception '참여와 경청 등급이 올바르지 않습니다.' using errcode='PMV18'; end if;
  if p_assignment_performance_grade is not null and p_assignment_performance_grade not in ('S+','S','A+','A','B') then raise exception '과제 수행 등급이 올바르지 않습니다.' using errcode='PMV18'; end if;
  if p_improvement_growth_grade is not null and p_improvement_growth_grade not in ('S+','S','A+','A','B') then raise exception '개선과 성장 등급이 올바르지 않습니다.' using errcode='PMV18'; end if;
  if v_notes is not null and char_length(v_notes)>2000 then raise exception '비고는 2,000자 이하로 입력해주세요.' using errcode='PMV19'; end if;

  if coalesce(p_is_preliminary_candidate,false) then
    select count(*) into v_candidate_count
    from public.mvp_foundation_teacher_inputs i
    where i.session_id=v_session.id and i.is_preliminary_candidate and i.student_id<>p_student_id;
    if v_candidate_count>=12 then raise exception '예선 후보는 최대 12명까지 선택할 수 있습니다.' using errcode='PMV20'; end if;
  end if;

  insert into public.mvp_foundation_teacher_inputs(
    session_id,student_id,is_preliminary_candidate,
    preparation_responsibility_grade,participation_listening_grade,
    assignment_performance_grade,improvement_growth_grade,notes,updated_by,updated_at
  ) values(
    v_session.id,p_student_id,coalesce(p_is_preliminary_candidate,false),
    p_preparation_responsibility_grade,p_participation_listening_grade,
    p_assignment_performance_grade,p_improvement_growth_grade,v_notes,auth.uid(),now()
  )
  on conflict(session_id,student_id) do update set
    is_preliminary_candidate=excluded.is_preliminary_candidate,
    preparation_responsibility_grade=excluded.preparation_responsibility_grade,
    participation_listening_grade=excluded.participation_listening_grade,
    assignment_performance_grade=excluded.assignment_performance_grade,
    improvement_growth_grade=excluded.improvement_growth_grade,
    notes=excluded.notes,updated_by=auth.uid(),updated_at=now();

  select count(*) into v_candidate_count from public.mvp_foundation_teacher_inputs i where i.session_id=v_session.id and i.is_preliminary_candidate;
  return jsonb_build_object('saved',true,'session_id',v_session.id,'student_id',p_student_id,'candidate_count',v_candidate_count);
end;
$$;

create or replace function public.teacher_get_mvp_foundation_session(p_session_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_students jsonb;
  v_summary jsonb;
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  select * into v_session from public.mvp_foundation_sessions where id=p_session_id;
  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14'; end if;

  if v_session.status='DRAFT' then
    select coalesce(jsonb_agg(
      (m - 'evidence') || jsonb_build_object(
        'is_preliminary_candidate',coalesce(i.is_preliminary_candidate,false),
        'preparation_responsibility_grade',i.preparation_responsibility_grade,
        'participation_listening_grade',i.participation_listening_grade,
        'assignment_performance_grade',i.assignment_performance_grade,
        'improvement_growth_grade',i.improvement_growth_grade,
        'notes',i.notes,
        'input_updated_at',i.updated_at
      )
      order by coalesce((m->>'evaluation_bv_earned')::bigint,0) desc,m->>'student_name',(m->>'student_id')::integer
    ),'[]'::jsonb)
    into v_students
    from jsonb_array_elements(coalesce(v_session.draft_data->'students','[]'::jsonb)) m
    left join public.mvp_foundation_teacher_inputs i
      on i.session_id=v_session.id and i.student_id=(m->>'student_id')::integer;
    v_summary:=coalesce(v_session.draft_data->'summary','{}'::jsonb);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'student_id',x.student_id,'student_name',x.student_name_snapshot,'brand_name',x.brand_name_snapshot,
      'guild_id',x.guild_id_snapshot,'guild_name',x.guild_name_snapshot,
      'evaluation_bv_earned',x.evaluation_bv_earned,'evaluation_bv_deducted',x.evaluation_bv_deducted,
      'evaluation_bv_net',x.evaluation_bv_net,'comparison_bv_earned',x.comparison_bv_earned,
      'bv_growth_rate',x.bv_growth_rate,'bv_growth_status',x.bv_growth_status,
      'daily_quest_target_days',x.daily_quest_target_days,'daily_quest_completed_days',x.daily_quest_completed_days,
      'daily_quest_completion_rate',x.daily_quest_completion_rate,
      'achievement_count',x.achievement_count,'achievement_score',x.achievement_score,
      'guild_score',x.guild_score,'personal_contribution_score',x.personal_contribution_score,
      'personal_contribution_coverage',x.personal_contribution_coverage,
      'donation_gold',x.donation_gold,'secondary_job_sales_completed',x.secondary_job_sales_completed,
      'is_preliminary_candidate',x.is_preliminary_candidate,
      'preparation_responsibility_grade',x.preparation_responsibility_grade,
      'participation_listening_grade',x.participation_listening_grade,
      'assignment_performance_grade',x.assignment_performance_grade,
      'improvement_growth_grade',x.improvement_growth_grade,'notes',x.notes_snapshot
    ) order by x.evaluation_bv_earned desc,x.student_name_snapshot,x.student_id),'[]'::jsonb)
      into v_students
    from public.mvp_foundation_student_snapshots x
    where x.session_id=v_session.id;
    v_summary:=jsonb_build_object(
      'student_count',(select count(*) from public.mvp_foundation_student_snapshots x where x.session_id=v_session.id),
      'daily_quest_source','FINALIZED_SNAPSHOT',
      'guild_score_source','FINALIZED_SNAPSHOT',
      'personal_contribution_source','FINALIZED_SNAPSHOT_MONTHLY_AGGREGATE',
      'personal_contribution_warning','개인 기여도는 확정 당시 월 단위 공식 집계 스냅샷입니다.'
    );
  end if;

  return jsonb_build_object(
    'session',jsonb_build_object(
      'id',v_session.id,'title',v_session.title,'status',v_session.status,
      'evaluation_start_date',v_session.evaluation_start_date,'evaluation_end_date',v_session.evaluation_end_date,
      'comparison_start_date',v_session.comparison_start_date,'comparison_end_date',v_session.comparison_end_date,
      'last_calculated_at',v_session.last_calculated_at,'finalized_at',v_session.finalized_at,
      'created_at',v_session.created_at,'updated_at',v_session.updated_at
    ),
    'summary',v_summary,
    'students',v_students,
    'candidate_count',(select count(*) from jsonb_array_elements(v_students) z where coalesce((z->>'is_preliminary_candidate')::boolean,false)),
    'calculated',case when v_session.status='FINALIZED' then true else jsonb_array_length(coalesce(v_session.draft_data->'students','[]'::jsonb))>0 end
  );
end;
$$;

create or replace function public.teacher_get_mvp_foundation_student_detail(p_session_id bigint,p_student_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_metric jsonb;
  v_input public.mvp_foundation_teacher_inputs%rowtype;
  v_snapshot public.mvp_foundation_student_snapshots%rowtype;
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  select * into v_session from public.mvp_foundation_sessions where id=p_session_id;
  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14'; end if;

  if v_session.status='DRAFT' then
    select x into v_metric from jsonb_array_elements(coalesce(v_session.draft_data->'students','[]'::jsonb)) x where (x->>'student_id')::integer=p_student_id limit 1;
    if v_metric is null then raise exception '먼저 데이터를 계산해주세요.' using errcode='PMV21'; end if;
    select * into v_input from public.mvp_foundation_teacher_inputs where session_id=v_session.id and student_id=p_student_id;
    return jsonb_build_object(
      'student',v_metric - 'evidence',
      'evidence',coalesce(v_metric->'evidence','{}'::jsonb),
      'input',case when v_input.session_id is null then null else jsonb_build_object(
        'is_preliminary_candidate',v_input.is_preliminary_candidate,
        'preparation_responsibility_grade',v_input.preparation_responsibility_grade,
        'participation_listening_grade',v_input.participation_listening_grade,
        'assignment_performance_grade',v_input.assignment_performance_grade,
        'improvement_growth_grade',v_input.improvement_growth_grade,'notes',v_input.notes
      ) end
    );
  end if;

  select * into v_snapshot from public.mvp_foundation_student_snapshots where session_id=v_session.id and student_id=p_student_id;
  if v_snapshot.id is null then raise exception '확정 스냅샷에서 학생을 찾을 수 없습니다.' using errcode='PMV22'; end if;
  return jsonb_build_object(
    'student',jsonb_build_object(
      'student_id',v_snapshot.student_id,'student_name',v_snapshot.student_name_snapshot,'brand_name',v_snapshot.brand_name_snapshot,
      'guild_id',v_snapshot.guild_id_snapshot,'guild_name',v_snapshot.guild_name_snapshot,
      'evaluation_bv_earned',v_snapshot.evaluation_bv_earned,'evaluation_bv_deducted',v_snapshot.evaluation_bv_deducted,
      'evaluation_bv_net',v_snapshot.evaluation_bv_net,'comparison_bv_earned',v_snapshot.comparison_bv_earned,
      'bv_growth_rate',v_snapshot.bv_growth_rate,'bv_growth_status',v_snapshot.bv_growth_status,
      'daily_quest_target_days',v_snapshot.daily_quest_target_days,'daily_quest_completed_days',v_snapshot.daily_quest_completed_days,
      'daily_quest_completion_rate',v_snapshot.daily_quest_completion_rate,'achievement_count',v_snapshot.achievement_count,
      'achievement_score',v_snapshot.achievement_score,'guild_score',v_snapshot.guild_score,
      'personal_contribution_score',v_snapshot.personal_contribution_score,'personal_contribution_coverage',v_snapshot.personal_contribution_coverage,
      'donation_gold',v_snapshot.donation_gold,'secondary_job_sales_completed',v_snapshot.secondary_job_sales_completed
    ),
    'evidence',v_snapshot.evidence_detail,
    'input',jsonb_build_object(
      'is_preliminary_candidate',v_snapshot.is_preliminary_candidate,
      'preparation_responsibility_grade',v_snapshot.preparation_responsibility_grade,
      'participation_listening_grade',v_snapshot.participation_listening_grade,
      'assignment_performance_grade',v_snapshot.assignment_performance_grade,
      'improvement_growth_grade',v_snapshot.improvement_growth_grade,'notes',v_snapshot.notes_snapshot
    )
  );
end;
$$;

create or replace function public.teacher_finalize_mvp_foundation_session(p_session_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_candidate_count integer;
  v_missing_grade_count integer;
  v_draft_student_count integer;
  v_current_student_count integer;
  v_finalized_at timestamptz:=clock_timestamp();
begin
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  select * into v_session from public.mvp_foundation_sessions where id=p_session_id for update;
  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14'; end if;
  if v_session.status<>'DRAFT' then raise exception '이미 확정된 MVP 회차입니다.' using errcode='PMV23'; end if;

  v_draft_student_count:=jsonb_array_length(coalesce(v_session.draft_data->'students','[]'::jsonb));
  if v_draft_student_count=0 or v_session.last_calculated_at is null then raise exception '먼저 MVP 기초 데이터를 계산해주세요.' using errcode='PMV24'; end if;

  select count(*) into v_current_student_count
  from public.students s
  where s.classroom_id=v_classroom_id and s.transferred_at is null
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
    and not coalesce(s.is_test_account,false) and public.is_official_participant(s.id);
  if v_current_student_count<>v_draft_student_count then
    raise exception '활성 학생 구성이 계산 시점과 달라졌습니다. 데이터를 다시 계산한 뒤 확정해주세요.' using errcode='PMV25';
  end if;

  select count(*) into v_candidate_count
  from public.mvp_foundation_teacher_inputs i
  join jsonb_array_elements(v_session.draft_data->'students') s on (s->>'student_id')::integer=i.student_id
  where i.session_id=v_session.id and i.is_preliminary_candidate;
  if v_candidate_count<>12 then raise exception '예선 진출 후보를 정확히 12명 선택해야 합니다. 현재 %명입니다.',v_candidate_count using errcode='PMV26'; end if;

  select count(*) into v_missing_grade_count
  from jsonb_array_elements(v_session.draft_data->'students') s
  left join public.mvp_foundation_teacher_inputs i on i.session_id=v_session.id and i.student_id=(s->>'student_id')::integer
  where i.session_id is null
     or i.preparation_responsibility_grade is null
     or i.participation_listening_grade is null
     or i.assignment_performance_grade is null
     or i.improvement_growth_grade is null;
  if v_missing_grade_count>0 then raise exception '수업 참여 평가가 비어 있는 학생이 %명 있습니다.',v_missing_grade_count using errcode='PMV27'; end if;

  insert into public.mvp_foundation_student_snapshots(
    session_id,student_id,student_name_snapshot,brand_name_snapshot,guild_name_snapshot,guild_id_snapshot,
    evaluation_bv_earned,evaluation_bv_deducted,evaluation_bv_net,comparison_bv_earned,bv_growth_rate,bv_growth_status,
    daily_quest_target_days,daily_quest_completed_days,daily_quest_completion_rate,
    achievement_count,achievement_score,achievement_detail,guild_score,personal_contribution_score,personal_contribution_coverage,
    donation_gold,secondary_job_sales_completed,evidence_detail,is_preliminary_candidate,
    preparation_responsibility_grade,participation_listening_grade,assignment_performance_grade,improvement_growth_grade,
    notes_snapshot,finalized_at
  )
  select
    v_session.id,(m->>'student_id')::integer,m->>'student_name',nullif(m->>'brand_name',''),nullif(m->>'guild_name',''),nullif(m->>'guild_id','')::integer,
    coalesce((m->>'evaluation_bv_earned')::bigint,0),coalesce((m->>'evaluation_bv_deducted')::bigint,0),coalesce((m->>'evaluation_bv_net')::bigint,0),
    coalesce((m->>'comparison_bv_earned')::bigint,0),nullif(m->>'bv_growth_rate','')::numeric,coalesce(m->>'bv_growth_status','RATE'),
    coalesce((m->>'daily_quest_target_days')::integer,0),coalesce((m->>'daily_quest_completed_days')::integer,0),nullif(m->>'daily_quest_completion_rate','')::numeric,
    coalesce((m->>'achievement_count')::integer,0),coalesce((m->>'achievement_score')::integer,0),coalesce(m->'evidence'->'achievements','[]'::jsonb),
    coalesce((m->>'guild_score')::numeric,0),coalesce((m->>'personal_contribution_score')::numeric,0),coalesce(m->>'personal_contribution_coverage','MONTHLY_AGGREGATE'),
    coalesce((m->>'donation_gold')::bigint,0),coalesce((m->>'secondary_job_sales_completed')::integer,0),coalesce(m->'evidence','{}'::jsonb),
    i.is_preliminary_candidate,i.preparation_responsibility_grade,i.participation_listening_grade,i.assignment_performance_grade,i.improvement_growth_grade,
    i.notes,v_finalized_at
  from jsonb_array_elements(v_session.draft_data->'students') m
  join public.mvp_foundation_teacher_inputs i on i.session_id=v_session.id and i.student_id=(m->>'student_id')::integer;

  update public.mvp_foundation_sessions
  set status='FINALIZED',finalized_at=v_finalized_at,updated_at=v_finalized_at
  where id=v_session.id;

  return jsonb_build_object('session_id',v_session.id,'status','FINALIZED','candidate_count',v_candidate_count,'student_count',v_draft_student_count,'finalized_at',v_finalized_at);
end;
$$;

-- FINALIZED teacher inputs must remain immutable even if a privileged client somehow reaches the table.
create or replace function public._mvp_foundation_guard_input_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists(select 1 from public.mvp_foundation_sessions s where s.id=(case when tg_op='DELETE' then old.session_id else new.session_id end) and s.status='FINALIZED') then
    raise exception '확정된 MVP 회차의 교사 입력은 수정할 수 없습니다.' using errcode='PMV28';
  end if;
  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mvp_foundation_input_immutable on public.mvp_foundation_teacher_inputs;
create trigger trg_mvp_foundation_input_immutable
before update or delete on public.mvp_foundation_teacher_inputs
for each row execute function public._mvp_foundation_guard_input_mutation();

create or replace function public._mvp_foundation_snapshot_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception '확정된 MVP 스냅샷은 수정하거나 삭제할 수 없습니다.' using errcode='PMV29';
end;
$$;

drop trigger if exists trg_mvp_foundation_snapshot_append_only on public.mvp_foundation_student_snapshots;
create trigger trg_mvp_foundation_snapshot_append_only
before update or delete on public.mvp_foundation_student_snapshots
for each row execute function public._mvp_foundation_snapshot_append_only();

revoke all on function public._mvp_foundation_calculate_payload(integer,date,date,date,date) from public,anon,authenticated;
revoke all on function public._mvp_foundation_guard_input_mutation() from public,anon,authenticated;
revoke all on function public._mvp_foundation_snapshot_append_only() from public,anon,authenticated;

revoke all on function public.teacher_list_mvp_foundation_sessions() from public,anon;
revoke all on function public.teacher_create_mvp_foundation_session(text,date,date,date,date) from public,anon;
revoke all on function public.teacher_update_mvp_foundation_session(bigint,text,date,date,date,date) from public,anon;
revoke all on function public.teacher_calculate_mvp_foundation_data(bigint) from public,anon;
revoke all on function public.teacher_save_mvp_foundation_input(bigint,integer,boolean,text,text,text,text,text) from public,anon;
revoke all on function public.teacher_get_mvp_foundation_session(bigint) from public,anon;
revoke all on function public.teacher_get_mvp_foundation_student_detail(bigint,integer) from public,anon;
revoke all on function public.teacher_finalize_mvp_foundation_session(bigint) from public,anon;

grant execute on function public.teacher_list_mvp_foundation_sessions() to authenticated;
grant execute on function public.teacher_create_mvp_foundation_session(text,date,date,date,date) to authenticated;
grant execute on function public.teacher_update_mvp_foundation_session(bigint,text,date,date,date,date) to authenticated;
grant execute on function public.teacher_calculate_mvp_foundation_data(bigint) to authenticated;
grant execute on function public.teacher_save_mvp_foundation_input(bigint,integer,boolean,text,text,text,text,text) to authenticated;
grant execute on function public.teacher_get_mvp_foundation_session(bigint) to authenticated;
grant execute on function public.teacher_get_mvp_foundation_student_detail(bigint,integer) to authenticated;
grant execute on function public.teacher_finalize_mvp_foundation_session(bigint) to authenticated;

commit;
