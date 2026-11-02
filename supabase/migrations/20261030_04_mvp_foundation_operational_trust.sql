-- MVP 운영국 신뢰도 (학생별 교사 수동 입력 / 확정 시점 스냅샷)
-- 기존 평가값 및 확정 회차는 변경하지 않는다.
begin;

alter table public.mvp_foundation_teacher_inputs
  add column if not exists operational_trust_pct numeric(4,1)
    constraint mvp_foundation_teacher_inputs_operational_trust_pct_check
    check (operational_trust_pct between 0.0 and 100.0);

alter table public.mvp_foundation_student_snapshots
  add column if not exists operational_trust_pct numeric(4,1)
    constraint mvp_foundation_student_snapshots_operational_trust_pct_check
    check (operational_trust_pct between 0.0 and 100.0);

comment on column public.mvp_foundation_teacher_inputs.operational_trust_pct is
  '운영국 신뢰도(%). 교사 직접 입력, 0.0~100.0 한 자리. NULL=미입력.';
comment on column public.mvp_foundation_student_snapshots.operational_trust_pct is
  '확정 순간의 운영국 신뢰도 스냅샷. NULL=당시 미입력.';

create or replace function public.teacher_set_mvp_foundation_operational_trust(
  p_session_id bigint,
  p_student_id integer,
  p_pct numeric
)
returns void
language plpgsql security definer
set search_path to 'public','pg_temp'
as $fn$
declare
  v_session public.mvp_foundation_sessions%rowtype;
begin
  perform public.ensure_teacher_role();
  select * into v_session
    from public.mvp_foundation_sessions
    where id = p_session_id
    for update;
  if v_session.id is null or v_session.classroom_id is distinct from public.current_classroom_id() then
    raise exception 'MVP 회차를 찾을 수 없습니다.';
  end if;
  if v_session.status <> 'DRAFT' then
    raise exception '확정된 MVP 회차는 수정할 수 없습니다.';
  end if;
  if p_pct is not null and
     (p_pct < 0 or p_pct > 100 or p_pct <> round(p_pct, 1)) then
    raise exception '운영국 신뢰도는 0.0~100.0 사이, 소수점 한 자리까지 입력해주세요.';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_session.draft_data->'students', '[]'::jsonb)) s
    where (s->>'student_id')::integer = p_student_id
  ) then
    raise exception '이 회차의 학생이 아닙니다. 먼저 기초 데이터 계산을 완료해주세요.';
  end if;

  insert into public.mvp_foundation_teacher_inputs
    (session_id, student_id, operational_trust_pct, updated_by, updated_at)
  values
    (p_session_id, p_student_id, p_pct, auth.uid(), now())
  on conflict (session_id, student_id) do update
    set operational_trust_pct = excluded.operational_trust_pct,
        updated_by = auth.uid(),
        updated_at = now();
end;
$fn$;

revoke all on function public.teacher_set_mvp_foundation_operational_trust(bigint, integer, numeric) from public, anon;
grant execute on function public.teacher_set_mvp_foundation_operational_trust(bigint, integer, numeric) to authenticated;

create or replace function public.teacher_get_mvp_foundation_operational_trust(p_session_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $fn$
declare
  v_session public.mvp_foundation_sessions%rowtype;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  select * into v_session from public.mvp_foundation_sessions where id = p_session_id;
  if v_session.id is null or v_session.classroom_id is distinct from public.current_classroom_id() then
    raise exception 'MVP 회차를 찾을 수 없습니다.';
  end if;

  if v_session.status = 'DRAFT' then
    select coalesce(jsonb_object_agg(i.student_id::text, i.operational_trust_pct), '{}'::jsonb)
      into v_result from public.mvp_foundation_teacher_inputs i
      where i.session_id = p_session_id;
  else
    select coalesce(jsonb_object_agg(s.student_id::text, s.operational_trust_pct), '{}'::jsonb)
      into v_result from public.mvp_foundation_student_snapshots s
      where s.session_id = p_session_id;
  end if;
  return v_result;
end;
$fn$;

revoke all on function public.teacher_get_mvp_foundation_operational_trust(bigint) from public, anon;
grant execute on function public.teacher_get_mvp_foundation_operational_trust(bigint) to authenticated;

-- 기존 확정 RPC를 교체하지 않고 스냅샷 INSERT 순간 저장된 교사 값을 복사한다.
create or replace function public._mvp_foundation_capture_operational_trust()
returns trigger
language plpgsql security invoker
set search_path to 'public','pg_temp'
as $fn$
begin
  select i.operational_trust_pct into new.operational_trust_pct
    from public.mvp_foundation_teacher_inputs i
    where i.session_id = new.session_id and i.student_id = new.student_id;
  return new;
end;
$fn$;

drop trigger if exists trg_mvp_foundation_capture_operational_trust on public.mvp_foundation_student_snapshots;
create trigger trg_mvp_foundation_capture_operational_trust
  before insert on public.mvp_foundation_student_snapshots
  for each row execute function public._mvp_foundation_capture_operational_trust();

commit;
