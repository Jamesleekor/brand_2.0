-- B.R.A.N.D 2.0 — Separate authentication history from actual app access
-- Applied to production as migration 20260907095643.
-- KST daily app-access evidence is used for weekend-attendance decisions;
-- auth_login_history remains an authentication/session audit trail.

create table if not exists public.app_access_daily (
  classroom_id integer not null references public.classrooms(id) on delete restrict,
  student_id integer not null references public.students(id) on delete cascade,
  auth_user_id uuid not null,
  access_date date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  signal_count integer not null default 1 check (signal_count >= 0),
  evidence_sources text[] not null default '{}'::text[],
  has_direct_app_signal boolean not null default false,
  has_backfill_signal boolean not null default false,
  last_device_type text,
  last_browser text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, access_date),
  constraint app_access_daily_seen_order_chk check (first_seen_at <= last_seen_at),
  constraint app_access_daily_device_len_chk check (last_device_type is null or char_length(last_device_type) <= 40),
  constraint app_access_daily_browser_len_chk check (last_browser is null or char_length(last_browser) <= 80)
);

comment on table public.app_access_daily is
  'Daily evidence that a student actually accessed or actively used B.R.A.N.D. Authentication history remains separate in auth_login_history.';
comment on column public.app_access_daily.access_date is
  'Asia/Seoul calendar date of access evidence.';
comment on column public.app_access_daily.has_backfill_signal is
  'True when at least one signal was reconstructed from retained Auth/session or high-confidence app activity.';

create index if not exists app_access_daily_classroom_date_idx
  on public.app_access_daily(classroom_id, access_date desc, student_id);
create index if not exists app_access_daily_classroom_student_date_idx
  on public.app_access_daily(classroom_id, student_id, access_date desc);

alter table public.app_access_daily enable row level security;
revoke all on table public.app_access_daily from public, anon, authenticated;

create or replace function public.record_app_access(
  p_source text default 'APP_INIT',
  p_device_type text default null,
  p_browser text default null
)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id integer;
  v_classroom_id integer;
  v_access_date date := (now() at time zone 'Asia/Seoul')::date;
  v_source text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = 'P0510';
  end if;

  select s.id, s.classroom_id
    into v_student_id, v_classroom_id
  from public.students s
  where s.user_id = v_uid
    and s.transferred_at is null
    and not s.is_test_account
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
  order by s.id
  limit 1;

  if v_student_id is null then
    return null;
  end if;

  v_source := case
    when upper(coalesce(p_source, '')) in ('APP_INIT','SESSION_RESTORE','AUTH_STATE','EXPLICIT_LOGIN')
      then upper(p_source)
    else 'APP_ACCESS'
  end;

  insert into public.app_access_daily (
    classroom_id, student_id, auth_user_id, access_date,
    first_seen_at, last_seen_at, signal_count, evidence_sources,
    has_direct_app_signal, has_backfill_signal,
    last_device_type, last_browser, metadata
  ) values (
    v_classroom_id, v_student_id, v_uid, v_access_date,
    now(), now(), 1, array[v_source],
    true, false,
    left(nullif(btrim(p_device_type), ''), 40),
    left(nullif(btrim(p_browser), ''), 80),
    '{}'::jsonb
  )
  on conflict (student_id, access_date) do update
  set first_seen_at = least(public.app_access_daily.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.app_access_daily.last_seen_at, excluded.last_seen_at),
      signal_count = public.app_access_daily.signal_count + 1,
      evidence_sources = (
        select coalesce(array_agg(distinct x order by x), '{}'::text[])
        from unnest(public.app_access_daily.evidence_sources || excluded.evidence_sources) as u(x)
      ),
      has_direct_app_signal = true,
      last_device_type = coalesce(excluded.last_device_type, public.app_access_daily.last_device_type),
      last_browser = coalesce(excluded.last_browser, public.app_access_daily.last_browser),
      updated_at = now();

  return v_access_date;
end;
$$;

revoke all on function public.record_app_access(text,text,text) from public, anon;
grant execute on function public.record_app_access(text,text,text) to authenticated;

create or replace function public.teacher_get_app_access_daily(
  p_classroom_id integer,
  p_date_from date default null,
  p_date_to date default null,
  p_student_id integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
  v_summary jsonb;
begin
  perform public.ensure_teacher_role();

  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode = 'P0511';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'p_date_from must be on or before p_date_to' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'student_days', count(*),
    'distinct_students', count(distinct a.student_id),
    'direct_student_days', count(*) filter (where a.has_direct_app_signal),
    'backfilled_student_days', count(*) filter (where a.has_backfill_signal)
  ) into v_summary
  from public.app_access_daily a
  where a.classroom_id = p_classroom_id
    and (p_student_id is null or a.student_id = p_student_id)
    and (p_date_from is null or a.access_date >= p_date_from)
    and (p_date_to is null or a.access_date <= p_date_to);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.access_date desc, x.student_name), '[]'::jsonb)
    into v_rows
  from (
    select a.access_date, a.student_id, s.name as student_name,
           a.first_seen_at, a.last_seen_at, a.signal_count,
           a.evidence_sources, a.has_direct_app_signal, a.has_backfill_signal,
           a.last_device_type, a.last_browser
    from public.app_access_daily a
    join public.students s on s.id = a.student_id
    where a.classroom_id = p_classroom_id
      and (p_student_id is null or a.student_id = p_student_id)
      and (p_date_from is null or a.access_date >= p_date_from)
      and (p_date_to is null or a.access_date <= p_date_to)
  ) x;

  return jsonb_build_object('summary', coalesce(v_summary, '{}'::jsonb), 'rows', v_rows);
end;
$$;

revoke all on function public.teacher_get_app_access_daily(integer,date,date,integer) from public, anon;
grant execute on function public.teacher_get_app_access_daily(integer,date,date,integer) to authenticated;

-- Production backfill. Retained Auth/session evidence begins on 2026-09-02.
with signals as (
  select s.id student_id, s.classroom_id, s.user_id auth_user_id,
         se.created_at occurred_at, 'SESSION_CREATED'::text src
  from auth.sessions se
  join public.students s on s.user_id = se.user_id
  where s.classroom_id = 1 and s.transferred_at is null and not s.is_test_account
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
    and se.created_at >= timestamptz '2026-09-02 00:00:00+00'

  union all
  select s.id, s.classroom_id, s.user_id, rt.created_at, 'TOKEN_REFRESH'
  from auth.refresh_tokens rt
  join public.students s on s.user_id::text = rt.user_id
  where s.classroom_id = 1 and s.transferred_at is null and not s.is_test_account
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
    and rt.created_at >= timestamptz '2026-09-02 00:00:00+00'

  union all
  select s.id, s.classroom_id, s.user_id, h.occurred_at, 'LOGIN_HISTORY'
  from public.auth_login_history h
  join public.students s on s.id = h.student_id
  where h.classroom_id = 1 and h.event_type = 'LOGIN_SUCCESS'
    and s.transferred_at is null and not s.is_test_account
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD')
    and h.occurred_at >= timestamptz '2026-09-02 00:00:00+00'

  union all select s.id,s.classroom_id,s.user_id,a.created_at,'ACHIEVEMENT_APPLICATION'
    from public.achievement_applications a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.play_started_at,'ARCADE_RUN'
    from public.arcade_runs a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.play_started_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.submitted_at,'ASSIGNMENT_SUBMISSION'
    from public.assignment_submissions a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.submitted_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'AUCTION_BID'
    from public.auction_bids a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.applied_at,'AUCTION_SUPER_PASS'
    from public.auction_super_pass_entries a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.applied_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.requested_at,'EMERGENCY_QUEST_REQUEST'
    from public.emergency_quest_requests a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.requested_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.completed_at,'EMERGENCY_QUEST_COMPLETION'
    from public.emergency_quest_completions a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.completed_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.read_at,'ALERT_READ'
    from public.global_alert_reads a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.read_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.submitted_at,'GUILD_MISSION_ACTIVITY'
    from public.guild3_mission_activity_records a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.submitted_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'LOAN_APPLICATION'
    from public.loan_applications a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'RANDOM_BOX_OPENING'
    from public.random_box_openings a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'GUESTBOOK_ENTRY'
    from public.records_guestbook_entries a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'SECONDARY_JOB_APPLICATION'
    from public.secondary_job_applications a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.accepted_at,'SECONDARY_PUBLIC_ACCEPT'
    from public.secondary_job_public_assignments a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.accepted_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.submitted_at,'SECONDARY_PUBLIC_SUBMIT'
    from public.secondary_job_public_assignments a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.submitted_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.submitted_at,'SECONDARY_SERVICE_AD'
    from public.secondary_job_service_ads a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.submitted_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.purchased_at,'SNACK_PURCHASE'
    from public.snack_purchases a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.purchased_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.purchased_at,'COSMETIC_PURCHASE'
    from public.student_cosmetic_ownerships a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.purchased_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'DEPOSIT_OPEN'
    from public.student_deposits a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
  union all select s.id,s.classroom_id,s.user_id,a.created_at,'INSTALLMENT_OPEN'
    from public.student_installment_savings a join public.students s on s.id=a.student_id
    where s.classroom_id=1 and s.transferred_at is null and not s.is_test_account and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD') and a.created_at >= timestamptz '2026-09-02 00:00:00+00'
), daily as (
  select classroom_id, student_id, auth_user_id,
         (occurred_at at time zone 'Asia/Seoul')::date access_date,
         min(occurred_at) first_seen_at,
         max(occurred_at) last_seen_at,
         count(*)::integer signal_count,
         array_agg(distinct src order by src) evidence_sources
  from signals
  where occurred_at is not null
  group by classroom_id, student_id, auth_user_id, (occurred_at at time zone 'Asia/Seoul')::date
)
insert into public.app_access_daily (
  classroom_id, student_id, auth_user_id, access_date,
  first_seen_at, last_seen_at, signal_count, evidence_sources,
  has_direct_app_signal, has_backfill_signal, metadata
)
select classroom_id, student_id, auth_user_id, access_date,
       first_seen_at, last_seen_at, signal_count, evidence_sources,
       false, true,
       jsonb_build_object('backfill_method','auth_session_refresh_and_high_confidence_app_actions','backfilled_at',now())
from daily
on conflict (student_id, access_date) do update
set first_seen_at = least(public.app_access_daily.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.app_access_daily.last_seen_at, excluded.last_seen_at),
    signal_count = public.app_access_daily.signal_count + excluded.signal_count,
    evidence_sources = (
      select coalesce(array_agg(distinct x order by x), '{}'::text[])
      from unnest(public.app_access_daily.evidence_sources || excluded.evidence_sources) as u(x)
    ),
    has_backfill_signal = true,
    metadata = public.app_access_daily.metadata || excluded.metadata,
    updated_at = now();
