begin;

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
  v_roster_changed boolean := false;
  v_fresh_payload jsonb;
  v_unready_contribution_count integer := 0;
  v_finalized_at timestamptz := clock_timestamp();
begin
  perform public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  select * into v_session
  from public.mvp_foundation_sessions
  where id=p_session_id
  for update;

  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then
    raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14';
  end if;
  if v_session.status<>'DRAFT' then
    raise exception '이미 확정된 MVP 회차입니다.' using errcode='PMV23';
  end if;

  v_draft_student_count := jsonb_array_length(coalesce(v_session.draft_data->'students','[]'::jsonb));
  if v_draft_student_count=0 or v_session.last_calculated_at is null then
    raise exception '먼저 MVP 기초 데이터를 계산해주세요.' using errcode='PMV24';
  end if;

  select count(*) into v_current_student_count
  from public.students s
  where s.classroom_id=v_classroom_id
    and s.transferred_at is null
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
    and not coalesce(s.is_test_account,false)
    and public.is_official_participant(s.id);

  select exists(
    select 1
    from (
      (
        select (x->>'student_id')::integer as student_id
        from jsonb_array_elements(coalesce(v_session.draft_data->'students','[]'::jsonb)) x
        except
        select s.id
        from public.students s
        where s.classroom_id=v_classroom_id
          and s.transferred_at is null
          and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
          and not coalesce(s.is_test_account,false)
          and public.is_official_participant(s.id)
      )
      union all
      (
        select s.id as student_id
        from public.students s
        where s.classroom_id=v_classroom_id
          and s.transferred_at is null
          and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
          and not coalesce(s.is_test_account,false)
          and public.is_official_participant(s.id)
        except
        select (x->>'student_id')::integer
        from jsonb_array_elements(coalesce(v_session.draft_data->'students','[]'::jsonb)) x
      )
    ) roster_diff
  ) into v_roster_changed;

  if v_current_student_count<>v_draft_student_count or v_roster_changed then
    raise exception '활성 학생 구성이 계산 시점과 달라졌습니다. 데이터를 다시 계산한 뒤 확정해주세요.' using errcode='PMV25';
  end if;

  -- Recalculate immediately before FINALIZE.  Ignore only the top-level
  -- calculation timestamp; every student metric/evidence field must still
  -- match the reviewed DRAFT exactly.
  v_fresh_payload := public._mvp_foundation_calculate_payload(
    v_session.classroom_id,
    v_session.evaluation_start_date,
    v_session.evaluation_end_date,
    v_session.comparison_start_date,
    v_session.comparison_end_date
  );

  if (v_fresh_payload - 'calculated_at') is distinct from (v_session.draft_data - 'calculated_at') then
    raise exception '원본 통계 데이터가 마지막 계산 이후 변경되었습니다. 다시 계산한 뒤 변경 내용을 검토하고 확정해주세요.' using errcode='PMV30';
  end if;

  -- Personal contribution is a monthly composite.  A DRAFT row with any
  -- non-READY component is useful for preview, but must never be frozen as
  -- final MVP evidence.  FINALIZED Guild 5 snapshots are already immutable
  -- official evidence and therefore satisfy this guard.
  with eval_months as (
    select to_char(m::date,'YYYY-MM') as year_month
    from generate_series(
      date_trunc('month',v_session.evaluation_start_date::timestamp),
      date_trunc('month',v_session.evaluation_end_date::timestamp),
      interval '1 month'
    ) m
  ), active_students as (
    select s.id
    from public.students s
    where s.classroom_id=v_classroom_id
      and s.transferred_at is null
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
      and not coalesce(s.is_test_account,false)
      and public.is_official_participant(s.id)
  )
  select count(*) into v_unready_contribution_count
  from active_students s
  cross join eval_months m
  where not exists (
    select 1
    from public.guild5_month_closures c
    join public.guild5_student_snapshots ss
      on ss.version_id=c.current_version_id
     and ss.student_id=s.id
    where c.classroom_id=v_classroom_id
      and c.year_month=m.year_month
      and c.lifecycle_state='FINALIZED'
      and c.current_version_id is not null
  )
  and not exists (
    select 1
    from public.guild2_individual_contributions c
    where c.classroom_id=v_classroom_id
      and c.student_id=s.id
      and c.year_month=m.year_month
      and c.peer_status='READY'
      and c.mission_status='READY'
      and c.session_status='READY'
      and c.teacher_observation_status='READY'
      and c.arcade_status='READY'
  );

  if v_unready_contribution_count>0 then
    raise exception '개인 기여도 원천 데이터가 아직 확정되지 않은 학생-월이 %건 있습니다. 동료평가·미션·세션·아케이드 월 집계를 완료한 뒤 다시 계산하고 확정해주세요.',v_unready_contribution_count using errcode='PMV31';
  end if;

  select count(*) into v_candidate_count
  from public.mvp_foundation_teacher_inputs i
  join jsonb_array_elements(v_session.draft_data->'students') s
    on (s->>'student_id')::integer=i.student_id
  where i.session_id=v_session.id
    and i.is_preliminary_candidate;

  if v_candidate_count<>12 then
    raise exception '예선 진출 후보를 정확히 12명 선택해야 합니다. 현재 %명입니다.',v_candidate_count using errcode='PMV26';
  end if;

  select count(*) into v_missing_grade_count
  from jsonb_array_elements(v_session.draft_data->'students') s
  left join public.mvp_foundation_teacher_inputs i
    on i.session_id=v_session.id
   and i.student_id=(s->>'student_id')::integer
  where i.session_id is null
     or i.preparation_responsibility_grade is null
     or i.participation_listening_grade is null
     or i.assignment_performance_grade is null
     or i.improvement_growth_grade is null;

  if v_missing_grade_count>0 then
    raise exception '수업 참여 평가가 비어 있는 학생이 %명 있습니다.',v_missing_grade_count using errcode='PMV27';
  end if;

  insert into public.mvp_foundation_student_snapshots(
    session_id,student_id,student_name_snapshot,brand_name_snapshot,guild_name_snapshot,guild_id_snapshot,
    evaluation_bv_earned,evaluation_bv_deducted,evaluation_bv_net,comparison_bv_earned,bv_growth_rate,bv_growth_status,
    daily_quest_target_days,daily_quest_completed_days,daily_quest_completion_rate,
    achievement_count,achievement_score,achievement_detail,
    guild_score,personal_contribution_score,personal_contribution_coverage,
    donation_gold,secondary_job_sales_completed,evidence_detail,is_preliminary_candidate,
    preparation_responsibility_grade,participation_listening_grade,assignment_performance_grade,improvement_growth_grade,
    notes_snapshot,finalized_at
  )
  select
    v_session.id,(m->>'student_id')::integer,m->>'student_name',nullif(m->>'brand_name',''),
    nullif(m->>'guild_name',''),nullif(m->>'guild_id','')::integer,
    coalesce((m->>'evaluation_bv_earned')::bigint,0),coalesce((m->>'evaluation_bv_deducted')::bigint,0),
    coalesce((m->>'evaluation_bv_net')::bigint,0),coalesce((m->>'comparison_bv_earned')::bigint,0),
    nullif(m->>'bv_growth_rate','')::numeric,coalesce(m->>'bv_growth_status','RATE'),
    coalesce((m->>'daily_quest_target_days')::integer,0),coalesce((m->>'daily_quest_completed_days')::integer,0),
    nullif(m->>'daily_quest_completion_rate','')::numeric,
    coalesce((m->>'achievement_count')::integer,0),coalesce((m->>'achievement_score')::integer,0),
    coalesce(m->'evidence'->'achievements','[]'::jsonb),
    coalesce((m->>'guild_score')::numeric,0),coalesce((m->>'personal_contribution_score')::numeric,0),
    coalesce(m->>'personal_contribution_coverage','MONTHLY_AGGREGATE'),coalesce((m->>'donation_gold')::bigint,0),
    coalesce((m->>'secondary_job_sales_completed')::integer,0),coalesce(m->'evidence','{}'::jsonb),
    i.is_preliminary_candidate,i.preparation_responsibility_grade,i.participation_listening_grade,
    i.assignment_performance_grade,i.improvement_growth_grade,i.notes,v_finalized_at
  from jsonb_array_elements(v_session.draft_data->'students') m
  join public.mvp_foundation_teacher_inputs i
    on i.session_id=v_session.id
   and i.student_id=(m->>'student_id')::integer;

  update public.mvp_foundation_sessions
  set status='FINALIZED',finalized_at=v_finalized_at,updated_at=v_finalized_at
  where id=v_session.id;

  return jsonb_build_object(
    'session_id',v_session.id,
    'status','FINALIZED',
    'candidate_count',v_candidate_count,
    'student_count',v_draft_student_count,
    'finalized_at',v_finalized_at
  );
end;
$$;

revoke all on function public.teacher_finalize_mvp_foundation_session(bigint) from public,anon;
grant execute on function public.teacher_finalize_mvp_foundation_session(bigint) to authenticated;

commit;
