-- B.R.A.N.D 2.0
-- Hall of Glory hidden legacy successor quest
-- Hotfix: allow TEST accounts to preview/test the full student flow without
-- counting them toward the 12-person unseal threshold or final roster count.

create or replace function public.records_legacy_can_access_student(p_student_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.transferred_at is null
      and s.role::text in ('STUDENT', 'STUDENT_LEADER', 'GUARD')
  );
$function$;

revoke all on function public.records_legacy_can_access_student(integer) from public, anon, authenticated;

create or replace function public.student_get_records_legacy_successor_state()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_owner_teacher_user_id uuid;
  v_school_year integer;
  v_can_participate boolean := false;
  v_event public.records_legacy_events%rowtype;
  v_successor public.records_legacy_successors%rowtype;
  v_registered_count integer := 0;
begin
  if auth.uid() is null or v_classroom_id is null then
    raise exception '[RECORDS_LEGACY] authenticated classroom context is required.'
      using errcode = 'P0950';
  end if;

  select c.teacher_user_id, c.school_year
    into v_owner_teacher_user_id, v_school_year
  from public.classrooms c
  where c.id = v_classroom_id;

  if v_owner_teacher_user_id is null or v_school_year is null then
    raise exception '[RECORDS_LEGACY] classroom lineage could not be resolved.'
      using errcode = 'P0951';
  end if;

  -- TEST accounts may enter the hidden quest for QA, but they remain excluded
  -- from official counts via is_official_participant() below.
  v_can_participate := v_student_id is not null
    and public.records_legacy_can_access_student(v_student_id);

  select e.* into v_event
  from public.records_legacy_events e
  where e.owner_teacher_user_id = v_owner_teacher_user_id
    and e.school_year = v_school_year
  limit 1;

  if v_student_id is not null then
    select s.* into v_successor
    from public.records_legacy_successors s
    where s.owner_teacher_user_id = v_owner_teacher_user_id
      and s.school_year = v_school_year
      and s.student_id = v_student_id
    limit 1;
  end if;

  select count(*)::integer into v_registered_count
  from public.records_legacy_successors s
  where s.owner_teacher_user_id = v_owner_teacher_user_id
    and s.school_year = v_school_year
    and s.registered_at is not null
    and public.is_official_participant(s.student_id);

  return jsonb_build_object(
    'can_participate', v_can_participate,
    'event_status', coalesce(v_event.status, 'OPEN'),
    'minimum_successors', coalesce(v_event.minimum_successors, 12),
    'registered_count', v_registered_count,
    'seal_discovered_at', v_successor.seal_discovered_at,
    'seal_confirmed_at', v_successor.seal_confirmed_at,
    'legacy_path_code', v_successor.legacy_path_code,
    'legacy_statement', v_successor.legacy_statement,
    'registered_at', v_successor.registered_at,
    'unsealed_at', v_event.unsealed_at,
    'locked_at', v_event.locked_at,
    'inherited_at', v_event.inherited_at
  );
end;
$function$;

create or replace function public.student_discover_records_legacy_seal()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_owner_teacher_user_id uuid;
  v_school_year integer;
  v_student_name text;
  v_brand_name text;
  v_event_id bigint;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS_LEGACY] authenticated student context is required.'
      using errcode = 'P0952';
  end if;

  if not public.records_legacy_can_access_student(v_student_id) then
    raise exception '[RECORDS_LEGACY] only active student accounts may discover the seal.'
      using errcode = 'P0953';
  end if;

  select c.teacher_user_id, c.school_year, s.name, s.brand_name
    into v_owner_teacher_user_id, v_school_year, v_student_name, v_brand_name
  from public.classrooms c
  join public.students s
    on s.id = v_student_id
   and s.classroom_id = c.id
   and s.transferred_at is null
  where c.id = v_classroom_id;

  if v_owner_teacher_user_id is null or v_school_year is null or v_student_name is null then
    raise exception '[RECORDS_LEGACY] student lineage could not be resolved.'
      using errcode = 'P0954';
  end if;

  insert into public.records_legacy_events (
    owner_teacher_user_id, classroom_id, school_year
  ) values (
    v_owner_teacher_user_id, v_classroom_id, v_school_year
  )
  on conflict (owner_teacher_user_id, school_year)
  do update set classroom_id = excluded.classroom_id, updated_at = now()
  returning id into v_event_id;

  insert into public.records_legacy_successors (
    event_id,
    owner_teacher_user_id,
    classroom_id,
    school_year,
    student_id,
    student_name_snapshot,
    brand_name_snapshot,
    seal_discovered_at
  ) values (
    v_event_id,
    v_owner_teacher_user_id,
    v_classroom_id,
    v_school_year,
    v_student_id,
    v_student_name,
    v_brand_name,
    now()
  )
  on conflict (owner_teacher_user_id, school_year, student_id)
  do update set
    event_id = excluded.event_id,
    classroom_id = excluded.classroom_id,
    student_name_snapshot = excluded.student_name_snapshot,
    brand_name_snapshot = excluded.brand_name_snapshot,
    seal_discovered_at = coalesce(public.records_legacy_successors.seal_discovered_at, excluded.seal_discovered_at),
    updated_at = now();

  return public.student_get_records_legacy_successor_state();
end;
$function$;

create or replace function public.student_confirm_records_legacy_seal()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_owner_teacher_user_id uuid;
  v_school_year integer;
  v_updated bigint;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS_LEGACY] authenticated student context is required.'
      using errcode = 'P0955';
  end if;

  if not public.records_legacy_can_access_student(v_student_id) then
    raise exception '[RECORDS_LEGACY] only active student accounts may confirm the seal.'
      using errcode = 'P0956';
  end if;

  select c.teacher_user_id, c.school_year
    into v_owner_teacher_user_id, v_school_year
  from public.classrooms c
  where c.id = v_classroom_id;

  update public.records_legacy_successors s
  set seal_confirmed_at = coalesce(s.seal_confirmed_at, now()),
      updated_at = now()
  where s.owner_teacher_user_id = v_owner_teacher_user_id
    and s.school_year = v_school_year
    and s.student_id = v_student_id
    and s.seal_discovered_at is not null
  returning s.id into v_updated;

  if v_updated is null then
    raise exception '[RECORDS_LEGACY] discover the seal before confirming it.'
      using errcode = 'P0957';
  end if;

  return public.student_get_records_legacy_successor_state();
end;
$function$;

create or replace function public.student_register_records_legacy_successor(
  p_path_code text,
  p_statement text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_owner_teacher_user_id uuid;
  v_school_year integer;
  v_student_name text;
  v_brand_name text;
  v_event public.records_legacy_events%rowtype;
  v_successor public.records_legacy_successors%rowtype;
  v_statement text;
  v_registered_count integer := 0;
  v_just_unsealed boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null or v_classroom_id is null or v_student_id is null then
    raise exception '[RECORDS_LEGACY] authenticated student context is required.'
      using errcode = 'P0958';
  end if;

  if not public.records_legacy_can_access_student(v_student_id) then
    raise exception '[RECORDS_LEGACY] only active student accounts may register as successors.'
      using errcode = 'P0959';
  end if;

  if p_path_code is null or p_path_code not in (
    'GRANDMASTER_LINEAGE',
    'FIRST_50000_GOLD',
    'HIGHEST_BV',
    'HIGHEST_ASSETS',
    'MOST_MVP_NOMINATIONS',
    'HIGHEST_MONTHLY_BV_GAIN'
  ) then
    raise exception '[RECORDS_LEGACY] invalid legacy path.'
      using errcode = 'P0960';
  end if;

  v_statement := regexp_replace(btrim(coalesce(p_statement, '')), '[[:space:]]+', ' ', 'g');
  if char_length(v_statement) < 1 or char_length(v_statement) > 120 then
    raise exception '[RECORDS_LEGACY] statement must be between 1 and 120 characters.'
      using errcode = 'P0961';
  end if;

  select c.teacher_user_id, c.school_year, s.name, s.brand_name
    into v_owner_teacher_user_id, v_school_year, v_student_name, v_brand_name
  from public.classrooms c
  join public.students s
    on s.id = v_student_id
   and s.classroom_id = c.id
   and s.transferred_at is null
  where c.id = v_classroom_id;

  if v_owner_teacher_user_id is null or v_school_year is null or v_student_name is null then
    raise exception '[RECORDS_LEGACY] student lineage could not be resolved.'
      using errcode = 'P0962';
  end if;

  insert into public.records_legacy_events (
    owner_teacher_user_id, classroom_id, school_year
  ) values (
    v_owner_teacher_user_id, v_classroom_id, v_school_year
  )
  on conflict (owner_teacher_user_id, school_year)
  do update set classroom_id = excluded.classroom_id, updated_at = now();

  select e.* into v_event
  from public.records_legacy_events e
  where e.owner_teacher_user_id = v_owner_teacher_user_id
    and e.school_year = v_school_year
  for update;

  if v_event.status in ('LOCKED', 'INHERITED') then
    raise exception '[RECORDS_LEGACY] successor registration is closed.'
      using errcode = 'P0963';
  end if;

  select s.* into v_successor
  from public.records_legacy_successors s
  where s.owner_teacher_user_id = v_owner_teacher_user_id
    and s.school_year = v_school_year
    and s.student_id = v_student_id
  for update;

  if v_successor.id is null or v_successor.seal_discovered_at is null or v_successor.seal_confirmed_at is null then
    raise exception '[RECORDS_LEGACY] confirm the hidden seal before registering.'
      using errcode = 'P0964';
  end if;

  if v_successor.registered_at is not null then
    raise exception '[RECORDS_LEGACY] successor path has already been registered.'
      using errcode = 'P0965';
  end if;

  update public.records_legacy_successors s
  set legacy_path_code = p_path_code,
      legacy_statement = v_statement,
      student_name_snapshot = v_student_name,
      brand_name_snapshot = v_brand_name,
      registered_at = now(),
      updated_at = now()
  where s.id = v_successor.id;

  -- Only real/official students contribute to the 12-person threshold.
  select count(*)::integer into v_registered_count
  from public.records_legacy_successors s
  where s.event_id = v_event.id
    and s.registered_at is not null
    and public.is_official_participant(s.student_id);

  if v_event.status = 'OPEN'
     and v_event.unsealed_at is null
     and v_registered_count >= v_event.minimum_successors then
    update public.records_legacy_events e
    set status = 'UNSEALED',
        unsealed_at = now(),
        updated_at = now()
    where e.id = v_event.id;
    v_just_unsealed := true;
  end if;

  v_result := public.student_get_records_legacy_successor_state();
  return v_result || jsonb_build_object('just_unsealed', v_just_unsealed);
end;
$function$;

create or replace function public.teacher_get_records_legacy_successors()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_owner_teacher_user_id uuid;
  v_school_year integer;
  v_event public.records_legacy_events%rowtype;
  v_discovered_count integer := 0;
  v_confirmed_count integer := 0;
  v_registered_count integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_path_counts jsonb := '{}'::jsonb;
begin
  perform public.ensure_teacher_role();

  if auth.uid() is null or v_classroom_id is null then
    raise exception '[RECORDS_LEGACY] authenticated teacher context is required.'
      using errcode = 'P0966';
  end if;

  select c.teacher_user_id, c.school_year
    into v_owner_teacher_user_id, v_school_year
  from public.classrooms c
  where c.id = v_classroom_id;

  if v_owner_teacher_user_id is null or v_school_year is null then
    raise exception '[RECORDS_LEGACY] teacher lineage could not be resolved.'
      using errcode = 'P0967';
  end if;

  insert into public.records_legacy_events (
    owner_teacher_user_id, classroom_id, school_year
  ) values (
    v_owner_teacher_user_id, v_classroom_id, v_school_year
  )
  on conflict (owner_teacher_user_id, school_year)
  do update set classroom_id = excluded.classroom_id, updated_at = now();

  select e.* into v_event
  from public.records_legacy_events e
  where e.owner_teacher_user_id = v_owner_teacher_user_id
    and e.school_year = v_school_year;

  select
    count(*) filter (where s.seal_discovered_at is not null and public.is_official_participant(s.student_id))::integer,
    count(*) filter (where s.seal_confirmed_at is not null and public.is_official_participant(s.student_id))::integer,
    count(*) filter (where s.registered_at is not null and public.is_official_participant(s.student_id))::integer
  into v_discovered_count, v_confirmed_count, v_registered_count
  from public.records_legacy_successors s
  where s.event_id = v_event.id;

  select coalesce(
    jsonb_object_agg(x.legacy_path_code, x.cnt),
    '{}'::jsonb
  ) into v_path_counts
  from (
    select s.legacy_path_code, count(*)::integer as cnt
    from public.records_legacy_successors s
    where s.event_id = v_event.id
      and s.registered_at is not null
      and s.legacy_path_code is not null
      and public.is_official_participant(s.student_id)
    group by s.legacy_path_code
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', x.student_id,
        'student_name', x.student_name_snapshot,
        'brand_name', x.brand_name_snapshot,
        'seal_discovered_at', x.seal_discovered_at,
        'seal_confirmed_at', x.seal_confirmed_at,
        'legacy_path_code', x.legacy_path_code,
        'legacy_statement', x.legacy_statement,
        'registered_at', x.registered_at,
        'is_official', public.is_official_participant(x.student_id)
      )
      order by x.registered_at desc nulls last, x.seal_discovered_at desc, x.student_name_snapshot asc
    ),
    '[]'::jsonb
  ) into v_rows
  from public.records_legacy_successors x
  where x.event_id = v_event.id;

  return jsonb_build_object(
    'event_status', v_event.status,
    'minimum_successors', v_event.minimum_successors,
    'discovered_count', v_discovered_count,
    'confirmed_count', v_confirmed_count,
    'registered_count', v_registered_count,
    'unsealed_at', v_event.unsealed_at,
    'locked_at', v_event.locked_at,
    'locked_successor_count', v_event.locked_successor_count,
    'inherited_at', v_event.inherited_at,
    'path_counts', v_path_counts,
    'rows', v_rows
  );
end;
$function$;

create or replace function public.teacher_lock_records_legacy_successors()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer := public.current_classroom_id();
  v_owner_teacher_user_id uuid;
  v_school_year integer;
  v_event public.records_legacy_events%rowtype;
  v_count integer := 0;
begin
  perform public.ensure_teacher_role();

  if auth.uid() is null or v_classroom_id is null then
    raise exception '[RECORDS_LEGACY] authenticated teacher context is required.'
      using errcode = 'P0975';
  end if;

  select c.teacher_user_id, c.school_year
    into v_owner_teacher_user_id, v_school_year
  from public.classrooms c
  where c.id = v_classroom_id;

  select e.* into v_event
  from public.records_legacy_events e
  where e.owner_teacher_user_id = v_owner_teacher_user_id
    and e.school_year = v_school_year
  for update;

  if v_event.id is null then
    raise exception '[RECORDS_LEGACY] event has not started.' using errcode = 'P0970';
  end if;

  if v_event.status not in ('OPEN', 'UNSEALED') then
    raise exception '[RECORDS_LEGACY] only an open successor roster can be locked.' using errcode = 'P0971';
  end if;

  select count(*)::integer into v_count
  from public.records_legacy_successors s
  where s.event_id = v_event.id
    and s.registered_at is not null
    and public.is_official_participant(s.student_id);

  if v_count < v_event.minimum_successors then
    raise exception '[RECORDS_LEGACY] minimum successor count has not been reached.' using errcode = 'P0972';
  end if;

  update public.records_legacy_events e
  set status = 'LOCKED',
      locked_at = now(),
      locked_successor_count = v_count,
      updated_at = now()
  where e.id = v_event.id;

  return public.teacher_get_records_legacy_successors();
end;
$function$;

-- Keep student/teacher public RPC permissions unchanged.
grant execute on function public.student_get_records_legacy_successor_state() to authenticated;
grant execute on function public.student_discover_records_legacy_seal() to authenticated;
grant execute on function public.student_confirm_records_legacy_seal() to authenticated;
grant execute on function public.student_register_records_legacy_successor(text, text) to authenticated;
grant execute on function public.teacher_get_records_legacy_successors() to authenticated;
grant execute on function public.teacher_lock_records_legacy_successors() to authenticated;
