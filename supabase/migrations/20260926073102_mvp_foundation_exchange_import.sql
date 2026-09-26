-- B.R.A.N.D. 2.0 - MVP Foundation XLSX/TSV exchange import
-- Production migration already applied as 20260926073102.
-- This file keeps the repository migration history in sync.

create or replace function public.teacher_import_mvp_foundation_inputs(
  p_session_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_classroom_id integer;
  v_session public.mvp_foundation_sessions%rowtype;
  v_rows jsonb;
  v_metadata jsonb;
  v_row jsonb;
  v_student_id integer;
  v_student_name text;
  v_expected_count integer;
  v_row_count integer;
  v_candidate_count integer;
  v_changed_count integer := 0;
  v_unchanged_count integer := 0;
  v_current public.mvp_foundation_teacher_inputs%rowtype;
  v_candidate boolean;
  v_preparation text;
  v_participation text;
  v_assignment text;
  v_improvement text;
  v_notes text;
begin
  perform public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  select * into v_session
  from public.mvp_foundation_sessions
  where id = p_session_id
  for update;

  if v_session.id is null or v_session.classroom_id is distinct from v_classroom_id then
    raise exception 'MVP 회차를 찾을 수 없습니다.' using errcode='PMV14';
  end if;
  if v_session.status <> 'DRAFT' then
    raise exception '확정된 MVP 회차에는 가져오기를 적용할 수 없습니다.' using errcode='PMV15';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception '가져오기 파일 형식이 올바르지 않습니다.' using errcode='PMV31';
  end if;

  v_metadata := p_payload->'metadata';
  v_rows := p_payload->'rows';

  if jsonb_typeof(v_metadata) <> 'object'
     or coalesce(v_metadata->>'format_version','') <> 'BRAND_MVP_EXCHANGE_V1' then
    raise exception '지원하지 않는 MVP 가져오기 파일입니다.' using errcode='PMV31';
  end if;

  begin
    if coalesce((v_metadata->>'session_id')::bigint,-1) <> v_session.id
       or coalesce(v_metadata->>'title','') <> v_session.title
       or coalesce(v_metadata->>'evaluation_start_date','') <> v_session.evaluation_start_date::text
       or coalesce(v_metadata->>'evaluation_end_date','') <> v_session.evaluation_end_date::text
       or coalesce(v_metadata->>'comparison_start_date','') <> v_session.comparison_start_date::text
       or coalesce(v_metadata->>'comparison_end_date','') <> v_session.comparison_end_date::text then
      raise exception '현재 MVP 회차와 다른 파일입니다. 회차/기간 정보를 확인해주세요.' using errcode='PMV32';
    end if;
  exception when invalid_text_representation then
    raise exception '회차 ID 형식이 올바르지 않습니다.' using errcode='PMV32';
  end;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception '교사 입력 행을 찾을 수 없습니다.' using errcode='PMV31';
  end if;

  select count(*) into v_expected_count
  from public.mvp_foundation_teacher_inputs i
  where i.session_id = v_session.id;

  if v_expected_count = 0 then
    raise exception '먼저 MVP 기초 데이터를 계산해주세요.' using errcode='PMV33';
  end if;

  v_row_count := jsonb_array_length(v_rows);
  if v_row_count <> v_expected_count then
    raise exception '학생 행 수가 현재 회차와 일치하지 않습니다. 기대 %, 파일 %.', v_expected_count, v_row_count using errcode='PMV34';
  end if;

  begin
    if exists (
      select 1 from (
        select (x->>'student_id')::integer as student_id, count(*) as n
        from jsonb_array_elements(v_rows) x
        group by (x->>'student_id')::integer
        having count(*) > 1
      ) d
    ) then
      raise exception '같은 학생이 파일에 두 번 이상 포함되어 있습니다.' using errcode='PMV35';
    end if;

    if exists (
      select 1
      from public.mvp_foundation_teacher_inputs i
      where i.session_id = v_session.id
        and not exists (
          select 1 from jsonb_array_elements(v_rows) x
          where (x->>'student_id')::integer = i.student_id
        )
    ) then
      raise exception '현재 회차의 학생이 파일에서 누락되었습니다.' using errcode='PMV34';
    end if;
  exception when invalid_text_representation then
    raise exception '학생 ID가 올바르지 않은 행이 있습니다.' using errcode='PMV36';
  end;

  select count(*) into v_candidate_count
  from jsonb_array_elements(v_rows) x
  where lower(coalesce(x->>'is_preliminary_candidate','false')) in ('true','1','yes','y');

  if v_candidate_count > 12 then
    raise exception '예선 후보는 최대 12명까지 선택할 수 있습니다.' using errcode='PMV20';
  end if;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    begin
      v_student_id := (v_row->>'student_id')::integer;
    exception when invalid_text_representation then
      raise exception '학생 ID가 올바르지 않은 행이 있습니다.' using errcode='PMV36';
    end;
    v_student_name := btrim(coalesce(v_row->>'student_name',''));

    if not exists (
      select 1 from public.students s
      where s.id = v_student_id
        and s.classroom_id = v_classroom_id
        and s.transferred_at is null
        and public.is_official_participant(s.id)
        and s.name = v_student_name
    ) then
      raise exception '학생 ID와 이름이 일치하지 않거나 현재 학급 학생이 아닙니다: % / %',
        v_student_id, v_student_name using errcode='PMV36';
    end if;

    if not exists (
      select 1 from public.mvp_foundation_teacher_inputs i
      where i.session_id=v_session.id and i.student_id=v_student_id
    ) then
      raise exception '현재 MVP 회차에 없는 학생 ID %가 포함되어 있습니다.', v_student_id using errcode='PMV36';
    end if;

    v_candidate := lower(coalesce(v_row->>'is_preliminary_candidate','false')) in ('true','1','yes','y');
    v_preparation := nullif(btrim(coalesce(v_row->>'preparation_responsibility_grade','')),'');
    v_participation := nullif(btrim(coalesce(v_row->>'participation_listening_grade','')),'');
    v_assignment := nullif(btrim(coalesce(v_row->>'assignment_performance_grade','')),'');
    v_improvement := nullif(btrim(coalesce(v_row->>'improvement_growth_grade','')),'');
    v_notes := nullif(btrim(coalesce(v_row->>'notes','')),'');

    if v_preparation is not null and v_preparation not in ('S+','S','A+','A','B') then
      raise exception '% 학생의 수업준비와 책임 등급이 올바르지 않습니다.', v_student_name using errcode='PMV18';
    end if;
    if v_participation is not null and v_participation not in ('S+','S','A+','A','B') then
      raise exception '% 학생의 참여와 경청 등급이 올바르지 않습니다.', v_student_name using errcode='PMV18';
    end if;
    if v_assignment is not null and v_assignment not in ('S+','S','A+','A','B') then
      raise exception '% 학생의 과제 수행 등급이 올바르지 않습니다.', v_student_name using errcode='PMV18';
    end if;
    if v_improvement is not null and v_improvement not in ('S+','S','A+','A','B') then
      raise exception '% 학생의 개선과 성장 등급이 올바르지 않습니다.', v_student_name using errcode='PMV18';
    end if;
    if v_notes is not null and char_length(v_notes) > 2000 then
      raise exception '% 학생의 비고가 2,000자를 초과했습니다.', v_student_name using errcode='PMV19';
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_student_id := (v_row->>'student_id')::integer;
    v_candidate := lower(coalesce(v_row->>'is_preliminary_candidate','false')) in ('true','1','yes','y');
    v_preparation := nullif(btrim(coalesce(v_row->>'preparation_responsibility_grade','')),'');
    v_participation := nullif(btrim(coalesce(v_row->>'participation_listening_grade','')),'');
    v_assignment := nullif(btrim(coalesce(v_row->>'assignment_performance_grade','')),'');
    v_improvement := nullif(btrim(coalesce(v_row->>'improvement_growth_grade','')),'');
    v_notes := nullif(btrim(coalesce(v_row->>'notes','')),'');

    select * into v_current
    from public.mvp_foundation_teacher_inputs i
    where i.session_id=v_session.id and i.student_id=v_student_id;

    if v_current.is_preliminary_candidate is not distinct from v_candidate
       and v_current.preparation_responsibility_grade is not distinct from v_preparation
       and v_current.participation_listening_grade is not distinct from v_participation
       and v_current.assignment_performance_grade is not distinct from v_assignment
       and v_current.improvement_growth_grade is not distinct from v_improvement
       and v_current.notes is not distinct from v_notes then
      v_unchanged_count := v_unchanged_count + 1;
    else
      v_changed_count := v_changed_count + 1;
    end if;

    update public.mvp_foundation_teacher_inputs
       set is_preliminary_candidate = v_candidate,
           preparation_responsibility_grade = v_preparation,
           participation_listening_grade = v_participation,
           assignment_performance_grade = v_assignment,
           improvement_growth_grade = v_improvement,
           notes = v_notes,
           updated_by = auth.uid(),
           updated_at = now()
     where session_id=v_session.id and student_id=v_student_id;
  end loop;

  return jsonb_build_object(
    'saved', true,
    'session_id', v_session.id,
    'row_count', v_row_count,
    'changed_count', v_changed_count,
    'unchanged_count', v_unchanged_count,
    'candidate_count', v_candidate_count
  );
end;
$function$;

revoke all on function public.teacher_import_mvp_foundation_inputs(bigint,jsonb) from public;
revoke all on function public.teacher_import_mvp_foundation_inputs(bigint,jsonb) from anon;
grant execute on function public.teacher_import_mvp_foundation_inputs(bigint,jsonb) to authenticated;

comment on function public.teacher_import_mvp_foundation_inputs(bigint,jsonb) is
'Teacher-only atomic MVP input import. Validates exchange metadata, exact student roster, student ID/name pairs, grades, notes, and 12-candidate cap. Does not mutate calculated statistics.';
