-- B.R.A.N.D 2.0 Analytics & Records — Login history phase 1
-- 2026-09-06
-- Additive-only: permanent trusted LOGIN_SUCCESS / LOGOUT history and teacher read RPC.

create table public.auth_login_history (
  id bigint generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id) on delete restrict,
  student_id integer references public.students(id) on delete set null,
  auth_user_id uuid not null,
  actor_kind text not null check (actor_kind in ('STUDENT','TEACHER')),
  student_name_snapshot text,
  event_type text not null check (event_type in ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT')),
  occurred_at timestamptz not null default now(),
  session_id uuid,
  device_type text,
  browser text,
  is_test_account boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint auth_login_history_device_type_len check (device_type is null or char_length(device_type) <= 40),
  constraint auth_login_history_browser_len check (browser is null or char_length(browser) <= 80)
);

comment on table public.auth_login_history is
  'Permanent B.R.A.N.D authentication history. Phase 1 records trusted LOGIN_SUCCESS and LOGOUT events; LOGIN_FAILED is reserved for a secure Auth Audit Log ingestion path.';
comment on column public.auth_login_history.session_id is
  'Supabase Auth JWT session_id claim. Used for idempotency; auth.sessions itself is not historical storage.';

create unique index auth_login_history_session_event_uq
  on public.auth_login_history(session_id, event_type)
  where session_id is not null;

create index auth_login_history_classroom_occurred_idx
  on public.auth_login_history(classroom_id, occurred_at desc, id desc);

create index auth_login_history_student_occurred_idx
  on public.auth_login_history(student_id, occurred_at desc, id desc)
  where student_id is not null;

create index auth_login_history_classroom_type_occurred_idx
  on public.auth_login_history(classroom_id, event_type, occurred_at desc, id desc);

alter table public.auth_login_history enable row level security;

revoke all on table public.auth_login_history from public, anon, authenticated;
revoke all on sequence public.auth_login_history_id_seq from public, anon, authenticated;

create or replace function public.record_login_event(
  p_event_type text,
  p_device_type text default null,
  p_browser text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id integer;
  v_classroom_id integer;
  v_student_name text;
  v_is_test boolean := false;
  v_actor_kind text;
  v_session_id uuid;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'Authentication required'
      using errcode = 'P0510';
  end if;

  -- LOGIN_FAILED must never be accepted from an authenticated app RPC.
  -- It will be populated only by a future trusted Supabase Auth audit-log path.
  if p_event_type not in ('LOGIN_SUCCESS', 'LOGOUT') then
    raise exception 'Unsupported login event type: %', p_event_type
      using errcode = '22023';
  end if;

  select s.id, s.classroom_id, s.name, s.is_test_account
    into v_student_id, v_classroom_id, v_student_name, v_is_test
  from public.students s
  where s.user_id = v_uid
    and s.transferred_at is null
  order by s.id
  limit 1;

  if v_student_id is not null then
    v_actor_kind := 'STUDENT';
  else
    select c.id
      into v_classroom_id
    from public.classrooms c
    where c.teacher_user_id = v_uid
      and c.is_active = true
    order by c.id
    limit 1;

    if v_classroom_id is null then
      raise exception 'No active B.R.A.N.D classroom context for authenticated user'
        using errcode = 'P0511';
    end if;

    v_actor_kind := 'TEACHER';
    v_student_name := null;
    v_is_test := false;
  end if;

  v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  insert into public.auth_login_history (
    classroom_id,
    student_id,
    auth_user_id,
    actor_kind,
    student_name_snapshot,
    event_type,
    occurred_at,
    session_id,
    device_type,
    browser,
    is_test_account,
    metadata
  )
  values (
    v_classroom_id,
    v_student_id,
    v_uid,
    v_actor_kind,
    v_student_name,
    p_event_type,
    now(),
    v_session_id,
    left(nullif(btrim(p_device_type), ''), 40),
    left(nullif(btrim(p_browser), ''), 80),
    coalesce(v_is_test, false),
    '{}'::jsonb
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null and v_session_id is not null then
    select h.id into v_id
    from public.auth_login_history h
    where h.session_id = v_session_id
      and h.event_type = p_event_type
    order by h.id
    limit 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_login_event(text,text,text) from public, anon;
grant execute on function public.record_login_event(text,text,text) to authenticated;

create or replace function public.teacher_get_login_history(
  p_classroom_id integer,
  p_limit integer default 50,
  p_offset integer default 0,
  p_student_id integer default null,
  p_event_type text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_tracking_start timestamptz;
  v_rows jsonb;
  v_student_summaries jsonb;
  v_summary jsonb;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch'
      using errcode = 'P0511';
  end if;

  if p_event_type is not null
     and p_event_type not in ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT') then
    raise exception 'Invalid event type: %', p_event_type
      using errcode = '22023';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'p_date_from must be on or before p_date_to'
      using errcode = '22023';
  end if;

  select min(h.occurred_at)
    into v_tracking_start
  from public.auth_login_history h
  where h.classroom_id = p_classroom_id;

  select count(*)
    into v_total
  from public.auth_login_history h
  where h.classroom_id = p_classroom_id
    and (p_student_id is null or h.student_id = p_student_id)
    and (p_event_type is null or h.event_type = p_event_type)
    and (p_include_test or not h.is_test_account)
    and (p_date_from is null or h.occurred_at >= (p_date_from::timestamp at time zone 'Asia/Seoul'))
    and (p_date_to is null or h.occurred_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Seoul'));

  select jsonb_build_object(
    'login_success_count', count(*) filter (where h.event_type = 'LOGIN_SUCCESS'),
    'logout_count', count(*) filter (where h.event_type = 'LOGOUT'),
    'login_failed_count', count(*) filter (where h.event_type = 'LOGIN_FAILED'),
    'distinct_student_count', count(distinct h.student_id) filter (
      where h.event_type = 'LOGIN_SUCCESS' and h.student_id is not null
    ),
    'distinct_student_login_days', count(distinct (h.student_id, (h.occurred_at at time zone 'Asia/Seoul')::date)) filter (
      where h.event_type = 'LOGIN_SUCCESS' and h.student_id is not null
    )
  )
    into v_summary
  from public.auth_login_history h
  where h.classroom_id = p_classroom_id
    and (p_student_id is null or h.student_id = p_student_id)
    and (p_event_type is null or h.event_type = p_event_type)
    and (p_include_test or not h.is_test_account)
    and (p_date_from is null or h.occurred_at >= (p_date_from::timestamp at time zone 'Asia/Seoul'))
    and (p_date_to is null or h.occurred_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Seoul'));

  select coalesce(jsonb_agg(to_jsonb(x) order by x.student_name, x.student_id), '[]'::jsonb)
    into v_student_summaries
  from (
    select
      s.id as student_id,
      s.name as student_name,
      s.is_test_account,
      count(h.id) filter (where h.event_type = 'LOGIN_SUCCESS')::bigint as total_login_count,
      count(distinct (h.occurred_at at time zone 'Asia/Seoul')::date) filter (
        where h.event_type = 'LOGIN_SUCCESS'
      )::bigint as total_login_days,
      max(h.occurred_at) filter (where h.event_type = 'LOGIN_SUCCESS') as last_login_at
    from public.students s
    left join public.auth_login_history h
      on h.student_id = s.id
     and h.classroom_id = p_classroom_id
    where s.classroom_id = p_classroom_id
      and s.role in ('STUDENT'::public.student_role, 'STUDENT_LEADER'::public.student_role, 'GUARD'::public.student_role, 'TEST'::public.student_role)
      and (p_include_test or not s.is_test_account)
    group by s.id, s.name, s.is_test_account
  ) x;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.occurred_at desc, r.id desc), '[]'::jsonb)
    into v_rows
  from (
    select
      h.id,
      h.classroom_id,
      h.student_id,
      h.student_name_snapshot,
      h.actor_kind,
      h.event_type,
      h.occurred_at,
      h.session_id,
      h.device_type,
      h.browser,
      h.is_test_account
    from public.auth_login_history h
    where h.classroom_id = p_classroom_id
      and (p_student_id is null or h.student_id = p_student_id)
      and (p_event_type is null or h.event_type = p_event_type)
      and (p_include_test or not h.is_test_account)
      and (p_date_from is null or h.occurred_at >= (p_date_from::timestamp at time zone 'Asia/Seoul'))
      and (p_date_to is null or h.occurred_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Seoul'))
    order by h.occurred_at desc, h.id desc
    limit v_limit offset v_offset
  ) r;

  return jsonb_build_object(
    'tracking_start_at', v_tracking_start,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'student_summaries', v_student_summaries,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.teacher_get_login_history(integer,integer,integer,integer,text,date,date,boolean) from public, anon;
grant execute on function public.teacher_get_login_history(integer,integer,integer,integer,text,date,date,boolean) to authenticated;
