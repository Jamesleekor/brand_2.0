-- =====================================================================
-- PRESENCE_MANUAL_TOGGLE_V1  (2026-10-01)
-- ---------------------------------------------------------------------
-- 1) 원인 수정: 학생은 presence 채널에 '쓰기(INSERT)' 권한만 있고 '읽기(SELECT)'
--    권한이 없어서 비공개 채널 입장 자체가 거부됐다(Unauthorized 7,359회).
--    Supabase Realtime 비공개 채널은 입장할 때 SELECT 권한이 필요하다.
-- 2) 기본값 OFF: 선생님이 켰을 때만(최대 30분, 기본 10분) 학생 앱이 접속을 알린다.
--    시간이 지나면 자동으로 꺼진다.
-- 기존 정책(brand_presence_student_track, brand_presence_teacher_read)은 그대로 둔다.
-- =====================================================================

create table if not exists public.classroom_presence_settings (
  classroom_id  integer primary key references public.classrooms(id) on delete cascade,
  enabled_until timestamptz,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

alter table public.classroom_presence_settings enable row level security;
revoke all on public.classroom_presence_settings from anon, authenticated;
-- 직접 접근 정책은 만들지 않는다. 아래 RPC로만 읽고 쓴다.

-- ---------------------------------------------------------------------
-- 현재 켜져 있는지 확인 (학생·교사 공용, 아주 가벼운 1행 조회)
-- ---------------------------------------------------------------------
create or replace function public.get_presence_tracking_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_classroom_id integer;
  v_until timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('enabled', false, 'enabled_until', null, 'server_now', now());
  end if;

  v_classroom_id := public.current_classroom_id();
  if v_classroom_id is null then
    return jsonb_build_object('enabled', false, 'enabled_until', null, 'server_now', now());
  end if;

  select s.enabled_until into v_until
    from public.classroom_presence_settings s
   where s.classroom_id = v_classroom_id;

  return jsonb_build_object(
    'enabled', v_until is not null and v_until > now(),
    'enabled_until', case when v_until > now() then v_until else null end,
    'server_now', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 선생님 전용: 켜기(분 단위, 1~30분) / 끄기
-- ---------------------------------------------------------------------
create or replace function public.teacher_set_presence_tracking(
  p_classroom_id integer,
  p_enabled boolean,
  p_minutes integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_minutes integer;
  v_until timestamptz;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id is distinct from public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode = 'P4P01';
  end if;

  v_minutes := least(greatest(coalesce(p_minutes, 10), 1), 30);
  v_until := case when coalesce(p_enabled, false) then now() + make_interval(mins => v_minutes) else null end;

  insert into public.classroom_presence_settings as c (classroom_id, enabled_until, updated_at, updated_by)
  values (p_classroom_id, v_until, now(), auth.uid())
  on conflict (classroom_id) do update
     set enabled_until = excluded.enabled_until,
         updated_at    = excluded.updated_at,
         updated_by    = excluded.updated_by;

  return jsonb_build_object(
    'enabled', v_until is not null,
    'enabled_until', v_until,
    'server_now', now()
  );
end;
$$;

revoke all on function public.get_presence_tracking_state() from public, anon;
grant execute on function public.get_presence_tracking_state() to authenticated;
revoke all on function public.teacher_set_presence_tracking(integer, boolean, integer) from public, anon;
grant execute on function public.teacher_set_presence_tracking(integer, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 빠져 있던 학생 입장(SELECT) 권한. 기존 학생 INSERT 정책과 같은 조건.
-- ---------------------------------------------------------------------
drop policy if exists brand_presence_student_join on realtime.messages;
create policy brand_presence_student_join
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'presence'
    and (substring((select realtime.topic()), '^brand:classroom:([0-9]+):presence$'))::integer = public.current_classroom_id()
    and public.current_student_id() is not null
  );
