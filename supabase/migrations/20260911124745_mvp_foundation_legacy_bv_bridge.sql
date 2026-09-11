begin;

-- Bridge historical B.R.A.N.D. 1.0 BV history with the 2.0 transaction ledger.
-- legacy_asset_history is authoritative through its last event_date.
-- transactions is authoritative only after that date, preventing overlap/double counting.

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
  bv_legacy_coverage as (
    select min(h.event_date) as first_date,max(h.event_date) as last_date
    from public.legacy_asset_history h
    where h.classroom_id=p_classroom_id
  ),
  eval_bv_events as (
    select h.student_id,h.bv_delta::bigint as amount,
      'LEGACY_ASSET_HISTORY'::text as source_type,h.memo,
      coalesce(h.occurred_at,h.event_date::timestamp at time zone 'Asia/Seoul') as created_at,
      ('LEGACY-'||h.id::text)::text as event_key
    from public.legacy_asset_history h
    join eligible_students es on es.id=h.student_id
    cross join bv_legacy_coverage lc
    where h.classroom_id=p_classroom_id
      and h.event_date between p_evaluation_start and p_evaluation_end
      and lc.last_date is not null
      and h.event_date<=lc.last_date
    union all
    select t.student_id,t.amount::bigint,t.source_type::text,t.memo,t.created_at,
      ('TX-'||t.id::text)::text
    from public.transactions t
    join eligible_students es on es.id=t.student_id
    cross join bv_legacy_coverage lc
    where t.classroom_id=p_classroom_id
      and t.value_token::text='BV'
      and not coalesce(t.is_reversed,false)
      and t.created_at>=v_eval_start_ts and t.created_at<v_eval_end_ts
      and (lc.last_date is null or (timezone('Asia/Seoul',t.created_at))::date>lc.last_date)
  ),
  eval_bv as (
    select e.student_id,
      coalesce(sum(e.amount) filter (where e.amount>0),0)::bigint as earned,
      coalesce(sum(abs(e.amount)) filter (where e.amount<0),0)::bigint as deducted,
      coalesce(jsonb_agg(jsonb_build_object(
        'event_key',e.event_key,'amount',e.amount,'source_type',e.source_type,
        'memo',e.memo,'created_at',e.created_at
      ) order by e.created_at,e.event_key),'[]'::jsonb) as events
    from eval_bv_events e
    group by e.student_id
  ),
  compare_bv_events as (
    select h.student_id,h.bv_delta::bigint as amount
    from public.legacy_asset_history h
    join eligible_students es on es.id=h.student_id
    cross join bv_legacy_coverage lc
    where h.classroom_id=p_classroom_id
      and h.event_date between p_comparison_start and p_comparison_end
      and lc.last_date is not null
      and h.event_date<=lc.last_date
    union all
    select t.student_id,t.amount::bigint
    from public.transactions t
    join eligible_students es on es.id=t.student_id
    cross join bv_legacy_coverage lc
    where t.classroom_id=p_classroom_id
      and t.value_token::text='BV'
      and not coalesce(t.is_reversed,false)
      and t.created_at>=v_compare_start_ts and t.created_at<v_compare_end_ts
      and (lc.last_date is null or (timezone('Asia/Seoul',t.created_at))::date>lc.last_date)
  ),
  compare_bv as (
    select e.student_id,
      coalesce(sum(e.amount) filter (where e.amount>0),0)::bigint as earned
    from compare_bv_events e
    group by e.student_id
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
      'personal_contribution_warning','개인 기여도는 시스템 원천 자체가 월 단위이므로 평가기간과 겹치는 공식 월 집계값을 합산합니다.',
      'bv_source','LEGACY_ASSET_HISTORY_THROUGH_CUTOVER_PLUS_TRANSACTIONS_AFTER',
      'bv_legacy_first_date',(select first_date from bv_legacy_coverage),
      'bv_legacy_last_date',(select last_date from bv_legacy_coverage)
    ),
    'students',coalesce((
      select jsonb_agg(to_jsonb(sr) order by sr.evaluation_bv_earned desc,sr.student_name,sr.student_id)
      from student_rows sr
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public._mvp_foundation_calculate_payload(integer,date,date,date,date) from public,anon,authenticated;

commit;
