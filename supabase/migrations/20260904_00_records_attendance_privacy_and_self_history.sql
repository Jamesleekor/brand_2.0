-- Records v1 / REC-R2A
-- Reproduces the attendance privacy hardening and student self-history reader
-- already applied to Production on 2026-09-04.

create or replace function public.student_get_my_attendance_history(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
declare
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_limit integer := least(greatest(coalesce(p_limit,100),1),500);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_rows jsonb;
  v_total bigint;
begin
  if auth.uid() is null or v_student_id is null or v_classroom_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='P0930';
  end if;

  select count(*) into v_total
  from public.attendances a
  where a.classroom_id=v_classroom_id
    and a.student_id=v_student_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',q.id,
        'attendance_date',q.attendance_date,
        'status',q.status::text,
        'streak_days',q.streak_days,
        'total_attendance',q.total_attendance,
        'recorded_at',q.recorded_at
      ) order by q.attendance_date desc,q.id desc
    ),
    '[]'::jsonb
  ) into v_rows
  from (
    select a.id,a.attendance_date,a.status,a.streak_days,a.total_attendance,a.recorded_at
    from public.attendances a
    where a.classroom_id=v_classroom_id
      and a.student_id=v_student_id
    order by a.attendance_date desc,a.id desc
    limit v_limit offset v_offset
  ) q;

  return jsonb_build_object(
    'rows',v_rows,
    'total_count',v_total,
    'limit',v_limit,
    'offset',v_offset
  );
end;
$$;

revoke all on function public.student_get_my_attendance_history(integer, integer) from public;
revoke all on function public.student_get_my_attendance_history(integer, integer) from anon;
grant execute on function public.student_get_my_attendance_history(integer, integer) to authenticated;

drop policy if exists attendances_select on public.attendances;
create policy attendances_select
on public.attendances
for select
to authenticated
using (
  student_id = (select public.current_student_id())
  or (
    (select public.is_teacher_or_admin())
    and public.is_classroom_member(classroom_id)
  )
);
