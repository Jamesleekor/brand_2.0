-- B.R.A.N.D 2.0
-- Teacher live student presence: private Supabase Realtime Presence + last_seen roster.
-- 2026-09-29

begin;

create or replace function public.teacher_get_presence_roster(p_classroom_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_rows jsonb;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id is distinct from public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P4P01';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', s.id,
        'student_name', s.name,
        'brand_name', s.brand_name,
        'role', s.role::text,
        'last_seen_at', a.last_seen_at,
        'last_device_type', a.last_device_type,
        'last_browser', a.last_browser
      ) order by s.name
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.students s
  left join lateral (
    select d.last_seen_at,d.last_device_type,d.last_browser
    from public.app_access_daily d
    where d.student_id=s.id
    order by d.last_seen_at desc
    limit 1
  ) a on true
  where s.classroom_id=p_classroom_id
    and s.transferred_at is null
    and coalesce(s.is_test_account,false)=false
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD');

  return jsonb_build_object(
    'classroom_id',p_classroom_id,
    'student_count',jsonb_array_length(v_rows),
    'students',v_rows
  );
end;
$function$;

revoke all on function public.teacher_get_presence_roster(integer) from public,anon;
grant execute on function public.teacher_get_presence_roster(integer) to authenticated,service_role;

-- Realtime schema is locked in current Supabase, but RLS policies on
-- realtime.messages are explicitly supported for private channel authorization.
drop policy if exists brand_presence_teacher_read on realtime.messages;
drop policy if exists brand_presence_student_track on realtime.messages;

create policy brand_presence_teacher_read
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'presence'
  and substring((select realtime.topic()) from '^brand:classroom:([0-9]+):presence$')::integer = public.current_classroom_id()
  and public.is_teacher_or_admin()
);

create policy brand_presence_student_track
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and substring((select realtime.topic()) from '^brand:classroom:([0-9]+):presence$')::integer = public.current_classroom_id()
  and public.current_student_id() is not null
);

commit;
