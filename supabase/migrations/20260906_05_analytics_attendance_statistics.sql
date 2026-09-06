-- B.R.A.N.D 2.0 — Analytics & Records: Attendance statistics
-- 2026-09-06
-- Display contract: 출석=PRESENT+LATE, 불참=ABSENT, 인정결석=EXCUSED.
-- Streak follows the existing attendance domain rule: PRESENT/LATE/EXCUSED continue it.

create or replace function public.teacher_get_statistics_attendance(
  p_classroom_id integer,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_today date := timezone('Asia/Seoul',clock_timestamp())::date;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  with students_scope as (
    select s.id student_id,s.name student_name,s.brand_name,s.is_test_account,(s.transferred_at is null) is_active
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')
      and (p_include_test or not s.is_test_account)
  ),
  latest as (
    select distinct on(a.student_id) a.student_id,a.attendance_date,a.status::text status,a.streak_days
    from public.attendances a join students_scope s on s.student_id=a.student_id
    where a.classroom_id=p_classroom_id
    order by a.student_id,a.attendance_date desc,a.id desc
  ),
  student_rows as (
    select s.student_id,s.student_name,s.brand_name,s.is_test_account,s.is_active,
      count(a.id) filter(where a.status::text in ('PRESENT','LATE'))::bigint as attendance_count,
      count(a.id) filter(where a.status::text='ABSENT')::bigint as absent_count,
      count(a.id) filter(where a.status::text='EXCUSED')::bigint as excused_count,
      case when l.attendance_date is null or l.attendance_date < v_today-1 then 0 else coalesce(l.streak_days,0) end::int as current_streak,
      coalesce(max(a.streak_days),0)::int as max_streak,
      min(a.attendance_date) as first_recorded_date,
      max(a.attendance_date) as recent_recorded_date
    from students_scope s
    left join public.attendances a on a.student_id=s.student_id and a.classroom_id=p_classroom_id
    left join latest l on l.student_id=s.student_id
    group by s.student_id,s.student_name,s.brand_name,s.is_test_account,s.is_active,l.attendance_date,l.streak_days
  )
  select jsonb_build_object(
    'kst_today',v_today,
    'rules',jsonb_build_object(
      'attendance_display','PRESENT + LATE',
      'absent_display','ABSENT',
      'excused_display','EXCUSED',
      'streak_continues_on',jsonb_build_array('PRESENT','LATE','EXCUSED'),
      'streak_breaks_on',jsonb_build_array('ABSENT'),
      'calendar_day_streak',true
    ),
    'class_summary',jsonb_build_object(
      'attendance_count',coalesce((select sum(attendance_count) from student_rows),0),
      'absent_count',coalesce((select sum(absent_count) from student_rows),0),
      'excused_count',coalesce((select sum(excused_count) from student_rows),0),
      'max_streak',coalesce((select max(max_streak) from student_rows),0)
    ),
    'students',(select coalesce(jsonb_agg(to_jsonb(x) order by x.student_name,x.student_id),'[]'::jsonb) from student_rows x),
    'data_quality',jsonb_build_object(
      'duplicate_student_date_rows',(
        select count(*) from (
          select a.student_id,a.attendance_date
          from public.attendances a join students_scope s on s.student_id=a.student_id
          where a.classroom_id=p_classroom_id
          group by a.student_id,a.attendance_date having count(*)>1
        ) q
      ),
      'negative_streak_rows',(
        select count(*) from public.attendances a join students_scope s on s.student_id=a.student_id
        where a.classroom_id=p_classroom_id and a.streak_days<0
      )
    )
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb);
end;
$function$;

revoke all on function public.teacher_get_statistics_attendance(integer,boolean) from public,anon;
grant execute on function public.teacher_get_statistics_attendance(integer,boolean) to authenticated,service_role;
