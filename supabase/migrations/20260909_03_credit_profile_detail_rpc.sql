-- B.R.A.N.D. 2.0 — 학생 신용 상세 UI용 자기조회 RPC
-- 기존 V2 계산식은 변경하지 않는다.
-- 현재 계산 결과 + 최근 28일 일일퀘스트 세부 건수 + 최근 30일 신용 스냅샷을 묶어 반환한다.

create or replace function public.student_get_my_credit_detail()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_current jsonb;
  v_window_start date;
  v_full_pass integer := 0;
  v_service_half integer := 0;
  v_missed integer := 0;
  v_history jsonb := '[]'::jsonb;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode = 'PCD10';
  end if;

  v_current := public._credit_score_v2_compute(v_student_id, v_today);
  if v_current is null then
    raise exception '신용점수를 계산할 학생 정보를 찾을 수 없습니다.' using errcode = 'PCD11';
  end if;

  v_window_start := (v_current ->> 'window_start')::date;

  with quest_rows as (
    select
      c.result,
      c.quest_code,
      r.quest_date,
      exists (
        select 1
        from public.secondary_job_service_orders o
        left join public.secondary_job_services sv on sv.id = o.service_id
        where o.buyer_student_id = c.student_id
          and o.status = 'COMPLETED'
          and (o.completed_at at time zone 'Asia/Seoul')::date = r.quest_date
          and coalesce(o.service_category_snapshot, sv.service_category) =
            case when c.quest_code = 'PRIMARY_JOB' then '1인1역' else '청소' end
      ) as has_service_assist
    from public.daily_quest_checks c
    join public.daily_quest_reports r on r.id = c.report_id
    where c.student_id = v_student_id
      and r.status = 'SETTLED'
      and r.quest_date between greatest(v_window_start, (
        select s.enrolled_at from public.students s where s.id = v_student_id
      )) and v_today
  )
  select
    count(*) filter (where result = 'PASS')::integer,
    count(*) filter (
      where result <> 'PASS'
        and quest_code in ('PRIMARY_JOB','CLEANING')
        and has_service_assist
    )::integer,
    count(*) filter (
      where result <> 'PASS'
        and not (quest_code in ('PRIMARY_JOB','CLEANING') and has_service_assist)
    )::integer
  into v_full_pass, v_service_half, v_missed
  from quest_rows;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'as_of_date', cs.as_of_date,
        'total_score', cs.total_score,
        'grade', cs.grade::text,
        'income_creation_score', cs.income_creation_score,
        'asset_capacity_score', cs.asset_capacity_score,
        'daily_quest_reliability_score', cs.daily_quest_reliability_score,
        'trade_contract_trust_score', cs.trade_contract_trust_score,
        'long_term_trust_score', cs.long_term_trust_score
      ) order by cs.as_of_date
    ),
    '[]'::jsonb
  )
  into v_history
  from public.credit_scores cs
  where cs.student_id = v_student_id
    and cs.as_of_date between (v_today - 30) and v_today;

  return v_current || jsonb_build_object(
    'quest_breakdown', jsonb_build_object(
      'full_pass_count', coalesce(v_full_pass, 0),
      'service_half_count', coalesce(v_service_half, 0),
      'missed_count', coalesce(v_missed, 0)
    ),
    'history', v_history
  );
end;
$$;

revoke all on function public.student_get_my_credit_detail() from public;
grant execute on function public.student_get_my_credit_detail() to authenticated;
