-- Read-only teacher archive. Existing message data, table ACL and RLS stay unchanged.
-- Internal definer functions are kept outside the exposed public schema.
create schema if not exists brand_gate_archive;
revoke all on schema brand_gate_archive from public, anon;
grant usage on schema brand_gate_archive to authenticated;

create or replace function brand_gate_archive.chat_index(
  p_classroom_id integer, p_from timestamptz, p_to timestamptz, p_search text
) returns jsonb language plpgsql stable security definer set search_path = pg_catalog
as $fn$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_teacher_or_admin() then
    raise exception 'Teacher/admin only' using errcode='42501';
  end if;
  if p_classroom_id is null or p_classroom_id is distinct from public.current_classroom_id() then
    raise exception 'Classroom scope mismatch' using errcode='42501';
  end if;
  if (p_from is not null and p_to is not null and p_from >= p_to) or length(coalesce(p_search,'')) > 200 then
    raise exception 'Invalid archive filters' using errcode='22023';
  end if;
  with turns as (
    select u.student_id, s.name student_name, u.character_id, c.name character_name,
      c.character_uid, u.created_at, u.id,
      (1 + case when a.id is not null then 1 else 0 end) message_count
    from public.dimensional_gate_chat_messages u
    join public.students s on s.id=u.student_id and s.classroom_id=p_classroom_id
    join public.characters c on c.id=u.character_id
    left join public.dimensional_gate_chat_messages a on a.student_id=u.student_id
      and a.character_id=u.character_id and a.request_id=u.request_id
      and a.classroom_id=p_classroom_id and a.role='CHARACTER'
    where u.classroom_id=p_classroom_id and u.role='STUDENT'
      and s.role::text='STUDENT' and s.is_test_account is not true
      and (p_from is null or u.created_at >= p_from) and (p_to is null or u.created_at < p_to)
      and (coalesce(btrim(p_search),'')='' or strpos(lower(u.content),lower(btrim(p_search)))>0
        or strpos(lower(coalesce(a.content,'')),lower(btrim(p_search)))>0)
  ), counts as (
    select student_id, student_name, character_id, character_name, character_uid,
      count(*) turn_count, sum(message_count) message_count, max(created_at) last_at
    from turns group by student_id,student_name,character_id,character_name,character_uid
  )
  select coalesce(jsonb_agg(to_jsonb(counts) order by last_at desc,student_id,character_id),'[]'::jsonb)
    into v_result from counts;
  return jsonb_build_object('rows',v_result);
end;
$fn$;

create or replace function brand_gate_archive.chat_page(
  p_classroom_id integer, p_student_id integer, p_character_id bigint,
  p_from timestamptz, p_to timestamptz, p_search text, p_before_id bigint,
  p_limit integer, p_snapshot_id bigint, p_focus_id bigint
) returns jsonb language plpgsql stable security definer set search_path = pg_catalog
as $fn$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,20),500));
  v_snapshot bigint; v_items jsonb; v_more boolean; v_before bigint;
begin
  if auth.uid() is null or not public.is_teacher_or_admin() then
    raise exception 'Teacher/admin only' using errcode='42501';
  end if;
  if p_classroom_id is null or p_classroom_id is distinct from public.current_classroom_id() then
    raise exception 'Classroom scope mismatch' using errcode='42501';
  end if;
  if (p_from is not null and p_to is not null and p_from >= p_to) or length(coalesce(p_search,''))>200 then
    raise exception 'Invalid archive filters' using errcode='22023';
  end if;
  if p_student_id is not null and not exists (
    select 1 from public.students s where s.id=p_student_id and s.classroom_id=p_classroom_id
      and s.role::text='STUDENT' and s.is_test_account is not true
  ) then raise exception 'Student scope mismatch' using errcode='42501'; end if;
  select coalesce(p_snapshot_id,max(m.id),0) into v_snapshot
    from public.dimensional_gate_chat_messages m where m.classroom_id=p_classroom_id;

  with turns as (
    select u.id turn_id, u.student_id,s.name student_name,u.character_id,c.name character_name,c.character_uid,
      u.request_id,u.created_at,u.content student_content,a.created_at reply_at,a.content reply_content,
      u.id student_message_id,a.id reply_message_id,
      u.moderation_severity, u.affinity_delta, u.is_aborted
    from public.dimensional_gate_chat_messages u
    join public.students s on s.id=u.student_id and s.classroom_id=p_classroom_id
    join public.characters c on c.id=u.character_id
    left join public.dimensional_gate_chat_messages a on a.student_id=u.student_id
      and a.character_id=u.character_id and a.request_id=u.request_id
      and a.classroom_id=p_classroom_id and a.role='CHARACTER' and a.id <= v_snapshot
    where u.classroom_id=p_classroom_id and u.role='STUDENT' and u.id <= v_snapshot
      and s.role::text='STUDENT' and s.is_test_account is not true
      and (p_student_id is null or u.student_id=p_student_id)
      and (p_character_id is null or u.character_id=p_character_id)
      and (p_from is null or u.created_at>=p_from) and (p_to is null or u.created_at<p_to)
      and (coalesce(btrim(p_search),'')='' or strpos(lower(u.content),lower(btrim(p_search)))>0
        or strpos(lower(coalesce(a.content,'')),lower(btrim(p_search)))>0)
  ), older as (
    select * from turns where (p_before_id is null or turn_id<p_before_id)
      and (p_focus_id is null or turn_id<=p_focus_id)
    order by turn_id desc limit (case when p_focus_id is null then v_limit+1 else 10 end)
  ), newer as (
    select * from turns where p_focus_id is not null and turn_id>p_focus_id
    order by turn_id limit 10
  ), chosen as (
    (select * from older order by turn_id desc limit v_limit)
    union all select * from newer
  )
  select coalesce((select jsonb_agg(to_jsonb(chosen) order by turn_id) from chosen),'[]'::jsonb),
    (select count(*)>v_limit from older), (select min(turn_id) from chosen)
  into v_items,v_more,v_before;
  return jsonb_build_object('items',v_items,'has_more',case when p_focus_id is null then v_more else false end,
    'next_before_id',v_before,'snapshot_id',v_snapshot);
end;
$fn$;

revoke all on function brand_gate_archive.chat_index(integer,timestamptz,timestamptz,text) from public,anon;
revoke all on function brand_gate_archive.chat_page(integer,integer,bigint,timestamptz,timestamptz,text,bigint,integer,bigint,bigint) from public,anon;
grant execute on function brand_gate_archive.chat_index(integer,timestamptz,timestamptz,text) to authenticated;
grant execute on function brand_gate_archive.chat_page(integer,integer,bigint,timestamptz,timestamptz,text,bigint,integer,bigint,bigint) to authenticated;

create or replace function public.teacher_gate_chat_archive_index(
  p_classroom_id integer, p_from timestamptz, p_to timestamptz, p_search text
) returns jsonb language sql stable security invoker set search_path=pg_catalog
as $fn$ select brand_gate_archive.chat_index(p_classroom_id,p_from,p_to,p_search); $fn$;
create or replace function public.teacher_gate_chat_archive_page(
  p_classroom_id integer, p_student_id integer, p_character_id bigint,
  p_from timestamptz, p_to timestamptz, p_search text, p_before_id bigint,
  p_limit integer, p_snapshot_id bigint, p_focus_id bigint
) returns jsonb language sql stable security invoker set search_path=pg_catalog
as $fn$ select brand_gate_archive.chat_page(p_classroom_id,p_student_id,p_character_id,
  p_from,p_to,p_search,p_before_id,p_limit,p_snapshot_id,p_focus_id); $fn$;
revoke all on function public.teacher_gate_chat_archive_index(integer,timestamptz,timestamptz,text) from public,anon;
revoke all on function public.teacher_gate_chat_archive_page(integer,integer,bigint,timestamptz,timestamptz,text,bigint,integer,bigint,bigint) from public,anon;
grant execute on function public.teacher_gate_chat_archive_index(integer,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.teacher_gate_chat_archive_page(integer,integer,bigint,timestamptz,timestamptz,text,bigint,integer,bigint,bigint) to authenticated;
notify pgrst,'reload schema';
