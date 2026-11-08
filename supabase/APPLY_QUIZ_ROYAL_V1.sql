-- =====================================================================
-- B.R.A.N.D 2.0 — 모험가 도구함 · 길드 대항 퀴즈 로얄 (Quiz Royal) v1
-- 2026-11-07
-- ---------------------------------------------------------------------
-- 근거: BRAND_Quiz_Royal_Implementation_Spec_v1_0 + 2026-11-07 검토 합의
--   * 도구함 화면으로 들어가지만, 안쪽은 퀴즈 전용 표·서버 함수로 분리한다.
--   * 기존 표(students, guilds, guild_members, classrooms)는 읽기만 한다.
--   * 기존 도구함 객체는 바꾸지 않는다. (brand_toolbox.bump 를 '호출'만 한다:
--     학생 도구함 첫 화면에 퀴즈 입구 카드가 나타나도록 학생 신호 한 번)
--
-- 보안 핵심
--   * 문제 표(quiz_questions)는 학생이 직접 읽을 수 없다. 지문·정답·미디어 모두.
--     학생 태블릿은 student_quiz_state 가 '지금 진행 중인 문제 1개'만 받는다.
--   * 중계 화면은 교사 PC의 다른 창(같은 교사 로그인)이다. 권한으로 나눌 수 없으므로
--     teacher_quiz_screen_state 가 공개된 정보만 만들어 보낸다(정답은 채점 확정 뒤에만).
--   * 제출 기기 = 길드별로 교사가 지정한 대표자 계정 1개. 다른 계정은 제출 불가.
--   * 모든 쓰기는 SECURITY DEFINER 함수 안에서 역할·학급·길드 범위를 검증한다.
--
-- 시간
--   * 서버 시각 기준. 마감 시각(deadline_at) + 유예(grace_ms, 기본 1초)까지 도착한 답은 받는다.
--     (화면은 0초에 마감으로 보여 주고, 마지막 순간에 보낸 답이 전송 지연으로 거절되지 않게 한다.)
--   * 일시정지는 남은 밀리초를 저장하고, 재개 때 마감 시각을 다시 계산한다.
--
-- 점수
--   * 원본은 문제별 판정 기록(quiz_answers)뿐이다. 누적 점수는 매번 합산한다(이중 가산 불가).
--   * 공개 점수(작은 순위판)·개인전 발표·최종 발표는 각각 따로 찍어 둔 스냅샷이다.
--
-- 오류 코드(도구함과 동일): P7T01 권한 · P7T02 대상 없음 · P7T03 상태 · P7T04 입력값 · P7T05 이미 처리됨
-- 파괴적 변경 없음. 기존 객체를 DROP/ALTER 하지 않는다.
-- =====================================================================

create schema if not exists brand_quiz;
revoke all on schema brand_quiz from public;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.quiz_events (
  id bigint generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id),
  title text not null check (char_length(title) between 1 and 60),
  is_rehearsal boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  phase text not null default 'SETUP'
    check (phase in ('SETUP','LOBBY','INDIVIDUAL','IND_CEREMONY','TEAM','FINAL_CEREMONY','COMPLETED')),
  current_question_id bigint,
  q_phase text not null default 'IDLE'
    check (q_phase in ('IDLE','SHOWN','LIVE','PAUSED','LOCKED','REVEALED','GRADED')),
  deadline_at timestamptz,
  remaining_ms integer,
  paused_at timestamptz,
  public_board jsonb,
  ind_result jsonb,
  final_result jsonb,
  ceremony_step integer not null default 0,
  checkpoint_ready boolean not null default false,
  screen jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists quiz_events_classroom_idx on public.quiz_events (classroom_id, phase, created_at desc);

create table if not exists public.quiz_event_guilds (
  event_id bigint not null references public.quiz_events(id) on delete cascade,
  guild_id integer not null references public.guilds(id),
  sort_order integer not null default 0,
  guild_name text not null,
  device_student_id integer references public.students(id),
  device_seen_at timestamptz,
  primary key (event_id, guild_id)
);
create unique index if not exists quiz_event_guilds_device_uidx
  on public.quiz_event_guilds (event_id, device_student_id) where device_student_id is not null;
create index if not exists quiz_event_guilds_device_idx on public.quiz_event_guilds (device_student_id);

create table if not exists public.quiz_roster (
  event_id bigint not null,
  guild_id integer not null,
  position_index smallint not null check (position_index between 0 and 9),
  student_id integer not null references public.students(id),
  student_name text not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, guild_id, position_index),
  foreign key (event_id, guild_id) references public.quiz_event_guilds(event_id, guild_id) on delete cascade
);

create table if not exists public.quiz_questions (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.quiz_events(id) on delete cascade,
  stage text not null check (stage in ('INDIVIDUAL','TEAM')),
  position_index smallint check (position_index between 0 and 9),
  order_index integer not null default 0,
  seq integer not null default 0,
  prompt text not null check (char_length(prompt) between 1 and 1000),
  answer_key text not null check (char_length(answer_key) between 1 and 300),
  accepted text[] not null default '{}',
  explanation text check (explanation is null or char_length(explanation) <= 300),
  note text check (note is null or char_length(note) <= 500),
  kind text check (kind is null or kind in ('KNOWLEDGE','REASONING')),
  theme text check (theme is null or theme in ('BRAND_WORLD','BRAND_ECONOMY','GENERAL','CURRICULUM')),
  points integer not null default 10 check (points between 0 and 1000),
  time_limit_sec integer not null default 30 check (time_limit_sec between 5 and 600),
  media_type text check (media_type is null or media_type in ('IMAGE','VIDEO','YOUTUBE')),
  media_path text check (media_path is null or char_length(media_path) <= 300),
  media_url text check (media_url is null or char_length(media_url) <= 500),
  media_on_device boolean not null default true,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  void_reason text,
  attempt integer not null default 0,
  started_at timestamptz,
  locked_at timestamptz,
  revealed_at timestamptz,
  graded_at timestamptz,
  pause_ms integer not null default 0,
  pause_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quiz_questions_stage_position_chk check (
    (stage = 'TEAM' and position_index is null) or (stage = 'INDIVIDUAL' and position_index is not null))
);
create index if not exists quiz_questions_event_idx on public.quiz_questions (event_id, seq);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quiz_events_current_question_fkey') then
    alter table public.quiz_events add constraint quiz_events_current_question_fkey
      foreign key (current_question_id) references public.quiz_questions(id) on delete set null;
  end if;
end $$;

create table if not exists public.quiz_answers (
  event_id bigint not null references public.quiz_events(id) on delete cascade,
  question_id bigint not null references public.quiz_questions(id) on delete cascade,
  attempt integer not null,
  guild_id integer not null,
  player_student_id integer,
  player_name text,
  submitted_by integer,
  answer text check (answer is null or char_length(answer) <= 300),
  submitted_at timestamptz,
  auto_match boolean,
  verdict text check (verdict is null or verdict in ('CORRECT','WRONG')),
  points integer,
  graded_by uuid,
  graded_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (question_id, attempt, guild_id)
);
create index if not exists quiz_answers_event_idx on public.quiz_answers (event_id, guild_id);

create table if not exists public.quiz_audit (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.quiz_events(id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  actor uuid,
  action text not null,
  question_id bigint,
  guild_id integer,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists quiz_audit_event_idx on public.quiz_audit (event_id, id);

-- 실시간 신호 행. 'Q<event>-T' = 운영·중계 화면(교사만), 'Q<event>-D' = 길드 태블릿(지정 대표자 계정만)
create table if not exists public.quiz_pulse (
  pulse_key text primary key,
  event_id bigint not null references public.quiz_events(id) on delete cascade,
  classroom_id integer not null references public.classrooms(id),
  audience text not null check (audience in ('T','D')),
  rev bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Access control — 직접 읽기/쓰기는 신호 행 읽기만 허용
-- ---------------------------------------------------------------------
alter table public.quiz_events enable row level security;
alter table public.quiz_event_guilds enable row level security;
alter table public.quiz_roster enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.quiz_audit enable row level security;
alter table public.quiz_pulse enable row level security;

revoke all on public.quiz_events, public.quiz_event_guilds, public.quiz_roster, public.quiz_questions,
  public.quiz_answers, public.quiz_audit, public.quiz_pulse from anon, authenticated, public;

-- 신호 행 읽기 판정 (정책 안에서 쓰므로 authenticated 실행 허용 — true/false만 돌려준다)
create or replace function public.quiz_pulse_readable(p_event bigint, p_classroom integer, p_audience text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $fn$
  select case
    when public.is_teacher_or_admin() and public.is_classroom_member(p_classroom) then true
    when p_audience = 'D' then exists (
      select 1 from public.quiz_event_guilds g
      join public.students s on s.id = g.device_student_id
      where g.event_id = p_event and s.user_id = auth.uid() and s.transferred_at is null)
    else false
  end
$fn$;

drop policy if exists quiz_pulse_read on public.quiz_pulse;
create policy quiz_pulse_read on public.quiz_pulse for select to authenticated
  using (public.quiz_pulse_readable(event_id, classroom_id, audience));
grant select on public.quiz_pulse to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quiz_pulse'
  ) then
    execute 'alter publication supabase_realtime add table public.quiz_pulse';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Internal helpers (brand_quiz schema, authenticated 실행 불가)
-- ---------------------------------------------------------------------
create or replace function brand_quiz.teacher_classroom()
returns integer language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer;
begin
  if auth.uid() is null or not public.is_teacher_or_admin() then
    raise exception '운영국 계정만 사용할 수 있어요' using errcode = 'P7T01';
  end if;
  v_classroom := public.current_classroom_id();
  if v_classroom is null then
    raise exception '학급 정보를 찾을 수 없어요' using errcode = 'P7T01';
  end if;
  return v_classroom;
end
$fn$;

create or replace function brand_quiz.student_ctx(out o_student_id integer, out o_classroom_id integer)
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
begin
  select s.id, s.classroom_id into o_student_id, o_classroom_id
  from public.students s
  where s.user_id = auth.uid() and s.transferred_at is null
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')
  limit 1;
  if o_student_id is null then
    raise exception '학생 계정으로 로그인해 주세요' using errcode = 'P7T01';
  end if;
end
$fn$;

create or replace function brand_quiz.teacher_event(p_id bigint, p_lock boolean default false)
returns public.quiz_events language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer := brand_quiz.teacher_classroom(); v_row public.quiz_events;
begin
  if p_lock then
    select * into v_row from public.quiz_events where id = p_id and classroom_id = v_classroom for update;
  else
    select * into v_row from public.quiz_events where id = p_id and classroom_id = v_classroom;
  end if;
  if v_row.id is null then
    raise exception '퀴즈 대회를 찾을 수 없어요' using errcode = 'P7T02';
  end if;
  return v_row;
end
$fn$;

create or replace function brand_quiz.cfg_int(p_cfg jsonb, p_key text, p_default integer)
returns integer language sql immutable set search_path = public, pg_temp
as $fn$
  select case when jsonb_typeof(p_cfg->p_key) = 'number' then (p_cfg->>p_key)::numeric::integer else p_default end
$fn$;

create or replace function brand_quiz.cfg_bool(p_cfg jsonb, p_key text, p_default boolean)
returns boolean language sql immutable set search_path = public, pg_temp
as $fn$
  select case when jsonb_typeof(p_cfg->p_key) = 'boolean' then (p_cfg->>p_key)::boolean else p_default end
$fn$;

create or replace function brand_quiz.positions(p_cfg jsonb)
returns text[] language sql immutable set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select array_agg(x order by o) from jsonb_array_elements_text(
       case when jsonb_typeof(p_cfg->'positions') = 'array' then p_cfg->'positions' else '[]'::jsonb end
     ) with ordinality as t(x, o)),
    array['선봉','차봉','중견','부장','대장'])
$fn$;

create or replace function brand_quiz.default_config()
returns jsonb language sql immutable set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'positions', jsonb_build_array('선봉','차봉','중견','부장','대장'),
    'use_individual', true,
    'use_team', true,
    'checkpoint_ind', 3,
    'checkpoint_team', 3,
    'auto_checkpoint', false,
    'max_len', 100,
    'grace_ms', 1000,
    'time_knowledge', 30,
    'time_reasoning', 60,
    'points_ind', 10,
    'points_team', 15)
$fn$;

-- 정답 비교용 정리: 소문자, 띄어쓰기·문장부호 제거 (한글은 그대로)
create or replace function brand_quiz.norm(p text)
returns text language sql immutable set search_path = public, pg_temp
as $fn$
  select regexp_replace(lower(coalesce(p, '')), '[[:space:][:punct:]·…‘’“”「」『』~]+', '', 'g')
$fn$;

create or replace function brand_quiz.auto_match(p_answer text, p_key text, p_accepted text[])
returns boolean language sql immutable set search_path = public, pg_temp
as $fn$
  select case when p_answer is null or brand_quiz.norm(p_answer) = '' then false
    else brand_quiz.norm(p_answer) = brand_quiz.norm(p_key)
      or exists (select 1 from unnest(coalesce(p_accepted, '{}')) a where brand_quiz.norm(a) <> '' and brand_quiz.norm(a) = brand_quiz.norm(p_answer))
  end
$fn$;

create or replace function brand_quiz.touch(p_id bigint)
returns bigint language sql security definer set search_path = public, pg_temp
as $fn$ update public.quiz_events set version = version + 1, updated_at = now() where id = p_id returning version $fn$;

-- 신호 보내기: 운영·중계(T)는 항상, 태블릿(D)은 p_devices 일 때만
create or replace function brand_quiz.bump(p_id bigint, p_devices boolean, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events; v_payload jsonb;
begin
  select * into e from public.quiz_events where id = p_id;
  if e.id is null then return; end if;
  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'quiz_id', e.id, 'version', e.version, 'phase', e.phase, 'q_phase', e.q_phase,
    'question_id', e.current_question_id, 'at', clock_timestamp());
  insert into public.quiz_pulse as p (pulse_key, event_id, classroom_id, audience, rev, payload, updated_at)
  values ('Q' || e.id || '-T', e.id, e.classroom_id, 'T', 1, v_payload, now())
  on conflict (pulse_key) do update set rev = p.rev + 1, payload = excluded.payload, updated_at = now();
  if p_devices then
    insert into public.quiz_pulse as p (pulse_key, event_id, classroom_id, audience, rev, payload, updated_at)
    values ('Q' || e.id || '-D', e.id, e.classroom_id, 'D', 1, v_payload - 'media', now())
    on conflict (pulse_key) do update set rev = p.rev + 1, payload = excluded.payload, updated_at = now();
  end if;
end
$fn$;

-- 학생 도구함 첫 화면에 퀴즈 입구가 생기거나 사라질 때만 학급 학생 신호를 한 번 보낸다.
create or replace function brand_quiz.lifecycle_signal(p_classroom integer, p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if to_regprocedure('brand_toolbox.bump(integer,boolean,jsonb)') is not null then
    perform brand_toolbox.bump(p_classroom, true, jsonb_build_object('event', 'QUIZ', 'quiz_id', p_id));
  end if;
end
$fn$;

create or replace function brand_quiz.log(p_event bigint, p_action text, p_question bigint default null,
  p_guild integer default null, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $fn$
  insert into public.quiz_audit (event_id, actor, action, question_id, guild_id, detail)
  values (p_event, auth.uid(), p_action, p_question, p_guild, coalesce(p_detail, '{}'::jsonb))
$fn$;

-- 문제 순서: 개인전(포지션 순 → 문항 순) → 단체전(문항 순)
create or replace function brand_quiz.renumber(p_event bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  with o as (
    select id, row_number() over (order by case stage when 'INDIVIDUAL' then 0 else 1 end,
      coalesce(position_index, 0), order_index, id) as n
    from public.quiz_questions where event_id = p_event
  )
  update public.quiz_questions q set seq = o.n from o where q.id = o.id and q.seq is distinct from o.n;
end
$fn$;

create or replace function brand_quiz.stage_of_phase(p_phase text)
returns text language sql immutable set search_path = public, pg_temp
as $fn$ select case p_phase when 'INDIVIDUAL' then 'INDIVIDUAL' when 'TEAM' then 'TEAM' else null end $fn$;

create or replace function brand_quiz.next_question(p_event bigint, p_stage text, p_after_seq integer)
returns bigint language sql stable security definer set search_path = public, pg_temp
as $fn$
  select id from public.quiz_questions
  where event_id = p_event and stage = p_stage and status = 'ACTIVE' and seq > coalesce(p_after_seq, 0)
    and graded_at is null
  order by seq limit 1
$fn$;

-- 실제(내부) 점수: 확정된 문제의 현재 회차 판정만 합산
create or replace function brand_quiz.scores(p_event bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $fn$
  select coalesce(jsonb_object_agg(g.guild_id::text, jsonb_build_object(
    'ind', coalesce(s.ind, 0), 'team', coalesce(s.team, 0), 'total', coalesce(s.ind, 0) + coalesce(s.team, 0))), '{}'::jsonb)
  from public.quiz_event_guilds g
  left join (
    select a.guild_id,
      sum(case when q.stage = 'INDIVIDUAL' then coalesce(a.points, 0) else 0 end)::int as ind,
      sum(case when q.stage = 'TEAM' then coalesce(a.points, 0) else 0 end)::int as team
    from public.quiz_answers a
    join public.quiz_questions q on q.id = a.question_id and q.attempt = a.attempt
    where a.event_id = p_event and q.status = 'ACTIVE' and q.graded_at is not null
    group by a.guild_id
  ) s on s.guild_id = g.guild_id
  where g.event_id = p_event
$fn$;

create or replace function brand_quiz.graded_count(p_event bigint, p_stage text)
returns integer language sql stable security definer set search_path = public, pg_temp
as $fn$
  select count(*)::int from public.quiz_questions
  where event_id = p_event and stage = p_stage and status = 'ACTIVE' and graded_at is not null
$fn$;

create or replace function brand_quiz.board_snapshot(p_event bigint, p_label text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'label', p_label,
    'at', clock_timestamp(),
    'graded', (select count(*) from public.quiz_questions where event_id = p_event and status = 'ACTIVE' and graded_at is not null),
    'scores', coalesce((select jsonb_object_agg(k, (v->>'total')::int) from jsonb_each(brand_quiz.scores(p_event)) as t(k, v)), '{}'::jsonb))
$fn$;

-- 발표용 스냅샷: 낮은 점수부터(발표 순서). kind = 'IND' | 'FINAL'
create or replace function brand_quiz.result_snapshot(p_event bigint, p_kind text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $fn$
  with sc as (select brand_quiz.scores(p_event) as s),
  rows as (
    select g.guild_id, g.guild_name, g.sort_order,
      ((select s from sc)->g.guild_id::text->>'ind')::int as ind,
      ((select s from sc)->g.guild_id::text->>'team')::int as team,
      ((select s from sc)->g.guild_id::text->>'total')::int as total
    from public.quiz_event_guilds g where g.event_id = p_event
  )
  select jsonb_build_object(
    'kind', p_kind,
    'at', clock_timestamp(),
    'max_ind', (select coalesce(sum(points), 0) from public.quiz_questions where event_id = p_event and stage = 'INDIVIDUAL' and status = 'ACTIVE'),
    'max_team', (select coalesce(sum(points), 0) from public.quiz_questions where event_id = p_event and stage = 'TEAM' and status = 'ACTIVE'),
    'guilds', coalesce((select jsonb_agg(jsonb_build_object(
        'guild_id', r.guild_id, 'name', r.guild_name, 'ind', r.ind, 'team', r.team, 'total', r.total,
        'score', case when p_kind = 'IND' then r.ind else r.total end,
        'rank', 1 + (select count(*) from rows r2 where (case when p_kind = 'IND' then r2.ind else r2.total end)
                                                       > (case when p_kind = 'IND' then r.ind else r.total end)))
      order by (case when p_kind = 'IND' then r.ind else r.total end) asc, r.sort_order desc) from rows r), '[]'::jsonb))
$fn$;

-- 현재 문제의 실제 단계(마감 시각+유예가 지나면 LOCKED로 본다. 표는 바꾸지 않는다)
create or replace function brand_quiz.eff_qphase(e public.quiz_events)
returns text language sql stable set search_path = public, pg_temp
as $fn$
  select case when e.q_phase = 'LIVE' and e.deadline_at is not null
      and clock_timestamp() > e.deadline_at + make_interval(secs => brand_quiz.cfg_int(e.config, 'grace_ms', 1000) / 1000.0)
    then 'LOCKED' else e.q_phase end
$fn$;

-- 기기 접속 상태: 40초 안에 화면이 서버와 통신했으면 접속 중
create or replace function brand_quiz.offline_guilds(p_event bigint)
returns text[] language sql stable security definer set search_path = public, pg_temp
as $fn$
  select coalesce(array_agg(guild_name order by sort_order), '{}') from public.quiz_event_guilds
  where event_id = p_event and (device_seen_at is null or device_seen_at < now() - interval '40 seconds')
$fn$;

-- 마감: 미제출 길드도 판정 행을 만든다(점수 0 후보). 이미 있으면 그대로.
create or replace function brand_quiz.lock_current(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events; q public.quiz_questions;
begin
  select * into e from public.quiz_events where id = p_id;
  select * into q from public.quiz_questions where id = e.current_question_id;
  if q.id is null then return; end if;
  update public.quiz_events set q_phase = 'LOCKED', remaining_ms = null, paused_at = null where id = p_id;
  update public.quiz_questions set locked_at = coalesce(locked_at, least(clock_timestamp(), coalesce(e.deadline_at, clock_timestamp()))),
    updated_at = now() where id = q.id;
  insert into public.quiz_answers (event_id, question_id, attempt, guild_id, player_student_id, player_name, answer, auto_match)
  select p_id, q.id, q.attempt, g.guild_id, r.student_id, r.student_name, null, false
  from public.quiz_event_guilds g
  left join public.quiz_roster r on r.event_id = g.event_id and r.guild_id = g.guild_id and r.position_index = q.position_index
  where g.event_id = p_id
  on conflict (question_id, attempt, guild_id) do nothing;
end
$fn$;

-- 출전표 점검: errors(시작 불가) / warnings(확인 후 진행 가능)
create or replace function brand_quiz.roster_check(p_event bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events; v_pos text[]; v_n integer; g record; v_errors jsonb := '[]'; v_warnings jsonb := '[]';
  v_members integer; v_distinct integer; v_filled integer; v_maxrep integer; v_nonmember integer; v_cap integer;
begin
  select * into e from public.quiz_events where id = p_event;
  if not brand_quiz.cfg_bool(e.config, 'use_individual', true) then
    return jsonb_build_object('errors', v_errors, 'warnings', v_warnings);
  end if;
  v_pos := brand_quiz.positions(e.config);
  v_n := coalesce(array_length(v_pos, 1), 0);
  for g in select * from public.quiz_event_guilds where event_id = p_event order by sort_order loop
    select count(*) into v_members from public.guild_members m
      join public.students s on s.id = m.student_id and s.transferred_at is null
      where m.guild_id = g.guild_id and m.left_at is null;
    select count(*), count(distinct student_id) into v_filled, v_distinct
      from public.quiz_roster where event_id = p_event and guild_id = g.guild_id and position_index < v_n;
    select coalesce(max(c), 0) into v_maxrep from (select count(*) c from public.quiz_roster
      where event_id = p_event and guild_id = g.guild_id and position_index < v_n group by student_id) t;
    select count(*) into v_nonmember from public.quiz_roster r
      where r.event_id = p_event and r.guild_id = g.guild_id and r.position_index < v_n and not exists (
        select 1 from public.guild_members m where m.guild_id = g.guild_id and m.student_id = r.student_id and m.left_at is null);
    if v_filled < v_n then
      v_errors := v_errors || to_jsonb(g.guild_name || ': 비어 있는 포지션이 ' || (v_n - v_filled) || '개 있어요');
    end if;
    if v_nonmember > 0 then
      v_errors := v_errors || to_jsonb(g.guild_name || ': 지금 길드원이 아닌 학생이 출전표에 있어요');
    end if;
    if v_filled = v_n and v_distinct < least(v_members, v_n) then
      v_warnings := v_warnings || to_jsonb(g.guild_name || ': 출전하지 않는 길드원이 ' || (least(v_members, v_n) - v_distinct) || '명 있어요 (결석 등 사유 확인)');
    end if;
    v_cap := ceil(v_n::numeric / greatest(least(v_members, v_n), 1))::int;
    if v_maxrep > v_cap then
      v_warnings := v_warnings || to_jsonb(g.guild_name || ': 한 학생이 ' || v_maxrep || '번 출전해요');
    end if;
  end loop;
  return jsonb_build_object('errors', v_errors, 'warnings', v_warnings);
end
$fn$;

-- 시작 전 점검(대기실 열기·경기 시작에 공통)
create or replace function brand_quiz.ready_errors(p_event bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events; v_err jsonb := '[]'; v_ng integer; v_nodev integer; v_ind integer; v_team integer;
  v_pos text[]; v_empty text[];
begin
  select * into e from public.quiz_events where id = p_event;
  select count(*), count(*) filter (where device_student_id is null) into v_ng, v_nodev
    from public.quiz_event_guilds where event_id = p_event;
  if v_ng < 2 then v_err := v_err || to_jsonb('참가 길드가 2개 이상이어야 해요'::text); end if;
  if v_nodev > 0 then v_err := v_err || to_jsonb(('제출 대표 계정을 정하지 않은 길드가 ' || v_nodev || '개 있어요')::text); end if;
  select count(*) filter (where stage = 'INDIVIDUAL' and status = 'ACTIVE'), count(*) filter (where stage = 'TEAM' and status = 'ACTIVE')
    into v_ind, v_team from public.quiz_questions where event_id = p_event;
  if not brand_quiz.cfg_bool(e.config, 'use_individual', true) and not brand_quiz.cfg_bool(e.config, 'use_team', true) then
    v_err := v_err || to_jsonb('개인전·단체전 중 하나는 켜야 해요'::text);
  end if;
  if brand_quiz.cfg_bool(e.config, 'use_individual', true) then
    if v_ind = 0 then v_err := v_err || to_jsonb('개인전 문제가 없어요'::text); end if;
    v_pos := brand_quiz.positions(e.config);
    select array_agg(v_pos[i + 1] order by i) into v_empty
      from generate_series(0, coalesce(array_length(v_pos, 1), 0) - 1) i
      where not exists (select 1 from public.quiz_questions q where q.event_id = p_event and q.stage = 'INDIVIDUAL'
        and q.status = 'ACTIVE' and q.position_index = i);
    if v_empty is not null and v_ind > 0 then
      v_err := v_err || to_jsonb(('문제가 없는 포지션: ' || array_to_string(v_empty, ', '))::text);
    end if;
    v_err := v_err || (brand_quiz.roster_check(p_event)->'errors');
  end if;
  if brand_quiz.cfg_bool(e.config, 'use_team', true) and v_team = 0 then
    v_err := v_err || to_jsonb('단체전 문제가 없어요'::text);
  end if;
  return v_err;
end
$fn$;

-- 한 문제 입력값 검증 → 정리된 jsonb
create or replace function brand_quiz.clean_question(p_q jsonb, p_cfg jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp
as $fn$
declare v_stage text := upper(coalesce(p_q->>'stage', ''));
  v_pos integer; v_n integer := coalesce(array_length(brand_quiz.positions(p_cfg), 1), 0);
  v_prompt text := btrim(coalesce(p_q->>'prompt', ''));
  v_key text := btrim(coalesce(p_q->>'answer_key', ''));
  v_kind text := nullif(upper(coalesce(p_q->>'kind', '')), '');
  v_theme text := nullif(upper(coalesce(p_q->>'theme', '')), '');
  v_points integer; v_time integer; v_media_type text := nullif(upper(coalesce(p_q->>'media_type', '')), '');
  v_media_path text := nullif(btrim(coalesce(p_q->>'media_path', '')), '');
  v_media_url text := nullif(btrim(coalesce(p_q->>'media_url', '')), '');
  v_accepted text[];
begin
  if v_stage not in ('INDIVIDUAL','TEAM') then raise exception '구간은 개인전 또는 단체전이어야 해요' using errcode = 'P7T04'; end if;
  if v_stage = 'INDIVIDUAL' then
    if jsonb_typeof(p_q->'position_index') <> 'number' then raise exception '개인전 문제는 포지션이 필요해요' using errcode = 'P7T04'; end if;
    v_pos := (p_q->>'position_index')::int;
    if v_pos < 0 or v_pos >= v_n then raise exception '포지션 번호가 범위를 벗어났어요' using errcode = 'P7T04'; end if;
  end if;
  if char_length(v_prompt) not between 1 and 1000 then raise exception '문제는 1~1000자로 써 주세요' using errcode = 'P7T04'; end if;
  if char_length(v_key) not between 1 and 300 then raise exception '정답은 1~300자로 써 주세요' using errcode = 'P7T04'; end if;
  if v_kind is not null and v_kind not in ('KNOWLEDGE','REASONING') then v_kind := null; end if;
  if v_theme is not null and v_theme not in ('BRAND_WORLD','BRAND_ECONOMY','GENERAL','CURRICULUM') then v_theme := null; end if;
  v_points := case when jsonb_typeof(p_q->'points') = 'number' then (p_q->>'points')::numeric::int
    else brand_quiz.cfg_int(p_cfg, case when v_stage = 'TEAM' then 'points_team' else 'points_ind' end, 10) end;
  if v_points < 0 or v_points > 1000 then raise exception '배점은 0~1000점이어야 해요' using errcode = 'P7T04'; end if;
  v_time := case when jsonb_typeof(p_q->'time_limit_sec') = 'number' then (p_q->>'time_limit_sec')::numeric::int
    else brand_quiz.cfg_int(p_cfg, case when v_kind = 'REASONING' then 'time_reasoning' else 'time_knowledge' end, 30) end;
  if v_time < 5 or v_time > 600 then raise exception '제한 시간은 5~600초여야 해요' using errcode = 'P7T04'; end if;
  if v_media_type is not null and v_media_type not in ('IMAGE','VIDEO','YOUTUBE') then raise exception '미디어 종류를 확인해 주세요' using errcode = 'P7T04'; end if;
  if v_media_type is null then v_media_path := null; v_media_url := null; end if;
  if v_media_type is not null and v_media_path is null and v_media_url is null then v_media_type := null; end if;
  if v_media_url is not null and v_media_url !~* '^https://' then raise exception '미디어 주소는 https:// 로 시작해야 해요' using errcode = 'P7T04'; end if;
  select coalesce(array_agg(x), '{}') into v_accepted from (
    select btrim(a) x from jsonb_array_elements_text(case when jsonb_typeof(p_q->'accepted') = 'array' then p_q->'accepted' else '[]'::jsonb end) a
    where btrim(a) <> '' limit 20) t;
  return jsonb_build_object(
    'stage', v_stage, 'position_index', v_pos, 'prompt', v_prompt, 'answer_key', v_key, 'accepted', to_jsonb(v_accepted),
    'explanation', nullif(left(btrim(coalesce(p_q->>'explanation', '')), 300), ''),
    'note', nullif(left(btrim(coalesce(p_q->>'note', '')), 500), ''),
    'kind', v_kind, 'theme', v_theme, 'points', v_points, 'time_limit_sec', v_time,
    'media_type', v_media_type, 'media_path', v_media_path, 'media_url', v_media_url,
    'media_on_device', coalesce(brand_quiz.cfg_bool(p_q, 'media_on_device', v_media_type is distinct from 'VIDEO' and v_media_type is distinct from 'YOUTUBE'), true));
end
$fn$;

-- 설정값 검증 → 정리된 config
create or replace function brand_quiz.clean_config(p_cfg jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp
as $fn$
declare d jsonb := brand_quiz.default_config(); v_pos jsonb; v_n integer; v_bad integer;
  v jsonb := coalesce(p_cfg, '{}'::jsonb);
begin
  v_pos := case when jsonb_typeof(v->'positions') = 'array' then v->'positions' else d->'positions' end;
  v_n := jsonb_array_length(v_pos);
  if v_n < 1 or v_n > 8 then raise exception '포지션은 1~8개로 정해 주세요' using errcode = 'P7T04'; end if;
  select count(*) into v_bad from jsonb_array_elements(v_pos) x
    where jsonb_typeof(x) <> 'string' or char_length(btrim(x #>> '{}')) not between 1 and 10;
  if v_bad > 0 then raise exception '포지션 이름은 1~10자로 써 주세요' using errcode = 'P7T04'; end if;
  return jsonb_build_object(
    'positions', (select jsonb_agg(btrim(x #>> '{}') order by o) from jsonb_array_elements(v_pos) with ordinality t(x, o)),
    'use_individual', brand_quiz.cfg_bool(v, 'use_individual', true),
    'use_team', brand_quiz.cfg_bool(v, 'use_team', true),
    'checkpoint_ind', greatest(0, least(50, brand_quiz.cfg_int(v, 'checkpoint_ind', 3))),
    'checkpoint_team', greatest(0, least(50, brand_quiz.cfg_int(v, 'checkpoint_team', 3))),
    'auto_checkpoint', brand_quiz.cfg_bool(v, 'auto_checkpoint', false),
    'max_len', greatest(10, least(300, brand_quiz.cfg_int(v, 'max_len', 100))),
    'grace_ms', greatest(0, least(2000, brand_quiz.cfg_int(v, 'grace_ms', 1000))),
    'time_knowledge', greatest(5, least(600, brand_quiz.cfg_int(v, 'time_knowledge', 30))),
    'time_reasoning', greatest(5, least(600, brand_quiz.cfg_int(v, 'time_reasoning', 60))),
    'points_ind', greatest(0, least(1000, brand_quiz.cfg_int(v, 'points_ind', 10))),
    'points_team', greatest(0, least(1000, brand_quiz.cfg_int(v, 'points_team', 15))));
end
$fn$;

create or replace function brand_quiz.insert_question(p_event bigint, c jsonb, p_order integer)
returns bigint language sql security definer set search_path = public, pg_temp
as $fn$
  insert into public.quiz_questions (event_id, stage, position_index, order_index, prompt, answer_key, accepted,
    explanation, note, kind, theme, points, time_limit_sec, media_type, media_path, media_url, media_on_device)
  values (p_event, c->>'stage', (c->>'position_index')::smallint, p_order, c->>'prompt', c->>'answer_key',
    coalesce((select array_agg(x) from jsonb_array_elements_text(c->'accepted') x), '{}'),
    c->>'explanation', c->>'note', c->>'kind', c->>'theme', (c->>'points')::int, (c->>'time_limit_sec')::int,
    c->>'media_type', c->>'media_path', c->>'media_url', (c->>'media_on_device')::boolean)
  returning id
$fn$;

-- 단계 진입: 해당 구간 첫 문제를 가리킨다
create or replace function brand_quiz.enter_stage(p_id bigint, p_stage text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  update public.quiz_events set phase = p_stage,
    current_question_id = brand_quiz.next_question(p_id, p_stage, 0),
    q_phase = 'IDLE', deadline_at = null, remaining_ms = null, paused_at = null,
    checkpoint_ready = false, ceremony_step = 0
  where id = p_id;
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. Teacher RPCs — 준비
-- ---------------------------------------------------------------------
create or replace function public.teacher_quiz_list()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer := brand_quiz.teacher_classroom();
begin
  return jsonb_build_object('server_now', now(), 'events', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'phase', e.phase, 'is_rehearsal', e.is_rehearsal,
      'created_at', e.created_at, 'started_at', e.started_at, 'completed_at', e.completed_at,
      'guild_count', (select count(*) from public.quiz_event_guilds g where g.event_id = e.id),
      'question_count', (select count(*) from public.quiz_questions q where q.event_id = e.id and q.status = 'ACTIVE'))
      order by (e.phase = 'COMPLETED'), coalesce(e.completed_at, e.created_at) desc)
    from (select * from public.quiz_events where classroom_id = v_classroom order by created_at desc limit 60) e), '[]'::jsonb));
end
$fn$;

create or replace function public.teacher_quiz_create(p_title text, p_is_rehearsal boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer := brand_quiz.teacher_classroom(); v_id bigint; v_title text := btrim(coalesce(p_title, ''));
begin
  if char_length(v_title) not between 1 and 60 then raise exception '대회 이름은 1~60자로 써 주세요' using errcode = 'P7T04'; end if;
  insert into public.quiz_events (classroom_id, title, is_rehearsal, config, created_by)
  values (v_classroom, v_title, coalesce(p_is_rehearsal, false), brand_quiz.default_config(), auth.uid())
  returning id into v_id;
  -- 기본 참가 길드: 활성 길드 중 시험용 계정만 있는 길드(테스트요원 등)는 뺀다
  insert into public.quiz_event_guilds (event_id, guild_id, sort_order, guild_name)
  select v_id, g.id, row_number() over (order by g.id), g.name
  from public.guilds g
  where g.classroom_id = v_classroom and g.is_active
    and exists (select 1 from public.guild_members m join public.students s on s.id = m.student_id
      where m.guild_id = g.id and m.left_at is null and s.transferred_at is null and not s.is_test_account
        and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD'));
  perform brand_quiz.log(v_id, 'CREATE', null, null, jsonb_build_object('title', v_title, 'rehearsal', coalesce(p_is_rehearsal, false)));
  return jsonb_build_object('id', v_id);
end
$fn$;

-- 기본 설정 + 참가 길드·제출 대표 계정 (준비·대기실 단계에서만)
create or replace function public.teacher_quiz_save_setup(p_id bigint, p_title text, p_config jsonb, p_guilds jsonb, p_is_rehearsal boolean default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_cfg jsonb; v_title text := btrim(coalesce(p_title, ''));
  v_item jsonb; v_gid integer; v_dev integer; v_name text; v_order integer := 0; v_ids integer[] := '{}'; v_npos integer;
begin
  if e.phase not in ('SETUP','LOBBY') then raise exception '경기를 시작한 뒤에는 기본 설정을 바꿀 수 없어요' using errcode = 'P7T03'; end if;
  if char_length(v_title) not between 1 and 60 then raise exception '대회 이름은 1~60자로 써 주세요' using errcode = 'P7T04'; end if;
  v_cfg := brand_quiz.clean_config(p_config);
  v_npos := jsonb_array_length(v_cfg->'positions');
  if exists (select 1 from public.quiz_questions where event_id = p_id and stage = 'INDIVIDUAL' and position_index >= v_npos) then
    raise exception '줄인 포지션에 이미 문제가 있어요. 그 문제를 먼저 옮기거나 지워 주세요' using errcode = 'P7T04';
  end if;
  if jsonb_typeof(p_guilds) <> 'array' or jsonb_array_length(p_guilds) < 1 or jsonb_array_length(p_guilds) > 8 then
    raise exception '참가 길드는 1~8개로 골라 주세요' using errcode = 'P7T04';
  end if;
  for v_item in select * from jsonb_array_elements(p_guilds) loop
    v_gid := (v_item->>'guild_id')::int;
    v_dev := nullif(v_item->>'device_student_id', '')::int;
    select name into v_name from public.guilds where id = v_gid and classroom_id = e.classroom_id and is_active;
    if v_name is null then raise exception '우리 학급의 활성 길드만 고를 수 있어요' using errcode = 'P7T04'; end if;
    if v_gid = any(v_ids) then raise exception '같은 길드를 두 번 고를 수 없어요' using errcode = 'P7T04'; end if;
    if v_dev is not null and not exists (select 1 from public.guild_members m join public.students s on s.id = m.student_id
        where m.guild_id = v_gid and m.student_id = v_dev and m.left_at is null and s.transferred_at is null) then
      raise exception '%: 제출 대표 계정은 그 길드의 길드원이어야 해요', v_name using errcode = 'P7T04';
    end if;
    v_ids := v_ids || v_gid;
    v_order := v_order + 1;
    insert into public.quiz_event_guilds as g (event_id, guild_id, sort_order, guild_name, device_student_id)
    values (p_id, v_gid, v_order, v_name, v_dev)
    on conflict (event_id, guild_id) do update set sort_order = excluded.sort_order, guild_name = excluded.guild_name,
      device_student_id = excluded.device_student_id,
      device_seen_at = case when g.device_student_id is distinct from excluded.device_student_id then null else g.device_seen_at end;
  end loop;
  delete from public.quiz_event_guilds where event_id = p_id and not (guild_id = any(v_ids));
  delete from public.quiz_roster where event_id = p_id and position_index >= v_npos;
  update public.quiz_events set title = v_title, config = v_cfg,
    is_rehearsal = coalesce(p_is_rehearsal, is_rehearsal) where id = p_id;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.log(p_id, 'SAVE_SETUP', null, null, jsonb_build_object('config', v_cfg, 'guilds', p_guilds));
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'SETUP'));
  return jsonb_build_object('id', p_id);
end
$fn$;

-- 문제 한꺼번에 저장(표 붙여넣기). REPLACE = 전체 교체, APPEND = 뒤에 추가. 경기 시작 전만.
create or replace function public.teacher_quiz_save_questions(p_id bigint, p_questions jsonb, p_mode text default 'REPLACE')
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_item jsonb; c jsonb; v_count integer := 0; v_order integer;
begin
  if e.phase not in ('SETUP','LOBBY') then raise exception '경기 중에는 문제를 한 개씩 추가·수정해 주세요' using errcode = 'P7T03'; end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception '문제 목록 형식이 아니에요' using errcode = 'P7T04'; end if;
  if jsonb_array_length(p_questions) > 200 then raise exception '한 대회의 문제는 200개까지예요' using errcode = 'P7T04'; end if;
  if upper(coalesce(p_mode, 'REPLACE')) = 'REPLACE' then
    delete from public.quiz_questions where event_id = p_id;
  end if;
  for v_item in select * from jsonb_array_elements(p_questions) loop
    v_count := v_count + 1;
    begin
      c := brand_quiz.clean_question(v_item, e.config);
    exception when sqlstate 'P7T04' then
      raise exception '%번째 줄: %', v_count, sqlerrm using errcode = 'P7T04';
    end;
    select coalesce(max(order_index), 0) + 1 into v_order from public.quiz_questions
      where event_id = p_id and stage = c->>'stage' and coalesce(position_index, -1) = coalesce((c->>'position_index')::int, -1);
    perform brand_quiz.insert_question(p_id, c, v_order);
  end loop;
  perform brand_quiz.renumber(p_id);
  perform brand_quiz.touch(p_id);
  perform brand_quiz.log(p_id, 'SAVE_QUESTIONS', null, null, jsonb_build_object('mode', upper(coalesce(p_mode, 'REPLACE')), 'count', v_count));
  perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'QUESTIONS'));
  return jsonb_build_object('count', v_count);
end
$fn$;

-- 문제 한 개 추가/수정. 이미 출제한 문제는 정답·허용 표현·해설·메모만 바꿀 수 있다(이력 기록).
create or replace function public.teacher_quiz_upsert_question(p_id bigint, p_question jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); c jsonb; q public.quiz_questions; cur public.quiz_questions;
  v_qid bigint := nullif(p_question->>'id', '')::bigint; v_order integer; v_new_id bigint;
  v_cur_rank integer; v_new_rank integer;
begin
  if e.phase = 'COMPLETED' then raise exception '끝난 대회는 바꿀 수 없어요' using errcode = 'P7T03'; end if;
  c := brand_quiz.clean_question(p_question, e.config);
  if v_qid is not null then
    select * into q from public.quiz_questions where id = v_qid and event_id = p_id for update;
    if q.id is null then raise exception '문제를 찾을 수 없어요' using errcode = 'P7T02'; end if;
    if q.started_at is not null or q.attempt > 0 then
      update public.quiz_questions set answer_key = c->>'answer_key',
        accepted = coalesce((select array_agg(x) from jsonb_array_elements_text(c->'accepted') x), '{}'),
        explanation = c->>'explanation', note = c->>'note', updated_at = now()
      where id = v_qid;
      perform brand_quiz.log(p_id, 'EDIT_STARTED_QUESTION', v_qid, null, jsonb_build_object(
        'before', jsonb_build_object('answer_key', q.answer_key, 'accepted', q.accepted, 'explanation', q.explanation),
        'after', jsonb_build_object('answer_key', c->>'answer_key', 'accepted', c->'accepted', 'explanation', c->>'explanation')));
      -- 정답이 바뀌었으면 아직 확정 전인 판정 후보를 다시 계산한다
      update public.quiz_answers a set auto_match = brand_quiz.auto_match(a.answer, c->>'answer_key',
          coalesce((select array_agg(x) from jsonb_array_elements_text(c->'accepted') x), '{}'))
        where a.question_id = v_qid and a.attempt = q.attempt;
    else
      if q.stage <> c->>'stage' or coalesce(q.position_index, -1) <> coalesce((c->>'position_index')::int, -1) then
        if e.phase not in ('SETUP','LOBBY') then raise exception '경기 중에는 문제의 구간·포지션을 옮길 수 없어요' using errcode = 'P7T03'; end if;
        select coalesce(max(order_index), 0) + 1 into v_order from public.quiz_questions
          where event_id = p_id and stage = c->>'stage' and coalesce(position_index, -1) = coalesce((c->>'position_index')::int, -1);
      else
        v_order := q.order_index;
      end if;
      update public.quiz_questions set stage = c->>'stage', position_index = (c->>'position_index')::smallint, order_index = v_order,
        prompt = c->>'prompt', answer_key = c->>'answer_key',
        accepted = coalesce((select array_agg(x) from jsonb_array_elements_text(c->'accepted') x), '{}'),
        explanation = c->>'explanation', note = c->>'note', kind = c->>'kind', theme = c->>'theme',
        points = (c->>'points')::int, time_limit_sec = (c->>'time_limit_sec')::int,
        media_type = c->>'media_type', media_path = c->>'media_path', media_url = c->>'media_url',
        media_on_device = (c->>'media_on_device')::boolean, updated_at = now()
      where id = v_qid;
      if e.phase not in ('SETUP','LOBBY') then
        perform brand_quiz.log(p_id, 'EDIT_QUESTION', v_qid, null, jsonb_build_object('before_prompt', q.prompt, 'after_prompt', c->>'prompt'));
      end if;
    end if;
    v_new_id := v_qid;
  else
    -- 경기 중 추가: 이미 지나간 구간·포지션에는 넣을 수 없다
    if e.phase not in ('SETUP','LOBBY') then
      select * into cur from public.quiz_questions where id = e.current_question_id;
      v_cur_rank := coalesce(cur.position_index, 0);
      v_new_rank := coalesce((c->>'position_index')::int, 0);
      if not (
        (c->>'stage' = 'TEAM' and e.phase in ('INDIVIDUAL','IND_CEREMONY','TEAM'))
        or (c->>'stage' = 'INDIVIDUAL' and e.phase = 'INDIVIDUAL' and v_new_rank >= v_cur_rank)
      ) then
        raise exception '이미 지나간 구간·포지션에는 문제를 추가할 수 없어요' using errcode = 'P7T03';
      end if;
    end if;
    select coalesce(max(order_index), 0) + 1 into v_order from public.quiz_questions
      where event_id = p_id and stage = c->>'stage' and coalesce(position_index, -1) = coalesce((c->>'position_index')::int, -1);
    v_new_id := brand_quiz.insert_question(p_id, c, v_order);
    if e.phase not in ('SETUP','LOBBY') then
      perform brand_quiz.log(p_id, 'ADD_QUESTION', v_new_id, null, jsonb_build_object('prompt', c->>'prompt'));
    end if;
  end if;
  perform brand_quiz.renumber(p_id);
  -- 단계 진행 중 현재 문제가 없던 경우(모든 문제가 끝난 상태에서 추가) 새 문제를 가리킨다
  if e.phase in ('INDIVIDUAL','TEAM') and e.current_question_id is null then
    update public.quiz_events set current_question_id = brand_quiz.next_question(p_id, e.phase, 0), q_phase = 'IDLE' where id = p_id;
  end if;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'QUESTIONS'));
  return jsonb_build_object('id', v_new_id);
end
$fn$;

create or replace function public.teacher_quiz_delete_question(p_id bigint, p_question_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); q public.quiz_questions;
begin
  select * into q from public.quiz_questions where id = p_question_id and event_id = p_id for update;
  if q.id is null then raise exception '문제를 찾을 수 없어요' using errcode = 'P7T02'; end if;
  if q.started_at is not null or q.attempt > 0 then raise exception '이미 출제한 문제는 지울 수 없어요. 무효 처리를 써 주세요' using errcode = 'P7T03'; end if;
  if e.current_question_id = p_question_id then
    update public.quiz_events set current_question_id = null where id = p_id;
  end if;
  delete from public.quiz_questions where id = p_question_id;
  perform brand_quiz.renumber(p_id);
  if e.phase in ('INDIVIDUAL','TEAM') and e.current_question_id = p_question_id then
    update public.quiz_events set current_question_id = brand_quiz.next_question(p_id, e.phase, 0), q_phase = 'IDLE' where id = p_id;
  end if;
  if e.phase not in ('SETUP','LOBBY') then
    perform brand_quiz.log(p_id, 'DELETE_QUESTION', p_question_id, null, jsonb_build_object('prompt', q.prompt));
  end if;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, e.current_question_id = p_question_id, jsonb_build_object('event', 'QUESTIONS'));
  return jsonb_build_object('id', p_question_id, 'media_path', q.media_path);
end
$fn$;

-- 출전표: 넘겨준 길드의 포지션을 통째로 바꾼다. 경기 중에는 사유 필수, 이미 출제한 포지션은 못 바꾼다.
create or replace function public.teacher_quiz_set_roster(p_id bigint, p_rows jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_item jsonb; v_gid integer; v_pos integer; v_sid integer;
  v_name text; v_npos integer; v_old record; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if e.phase not in ('SETUP','LOBBY','INDIVIDUAL') then raise exception '개인전이 끝난 뒤에는 출전표를 바꿀 수 없어요' using errcode = 'P7T03'; end if;
  if e.phase = 'INDIVIDUAL' and v_reason is null then raise exception '경기 중 선수 교체는 사유를 적어 주세요' using errcode = 'P7T04'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception '출전표 형식이 아니에요' using errcode = 'P7T04'; end if;
  v_npos := coalesce(array_length(brand_quiz.positions(e.config), 1), 0);
  for v_item in select * from jsonb_array_elements(p_rows) loop
    v_gid := (v_item->>'guild_id')::int;
    v_pos := (v_item->>'position_index')::int;
    v_sid := nullif(v_item->>'student_id', '')::int;
    if not exists (select 1 from public.quiz_event_guilds where event_id = p_id and guild_id = v_gid) then
      raise exception '참가하지 않는 길드예요' using errcode = 'P7T04';
    end if;
    if v_pos is null or v_pos < 0 or v_pos >= v_npos then raise exception '포지션 번호가 범위를 벗어났어요' using errcode = 'P7T04'; end if;
    if e.phase = 'INDIVIDUAL' and exists (select 1 from public.quiz_questions where event_id = p_id and stage = 'INDIVIDUAL'
        and position_index = v_pos and (started_at is not null or attempt > 0)) then
      select student_id into v_old from public.quiz_roster where event_id = p_id and guild_id = v_gid and position_index = v_pos;
      if v_old.student_id is distinct from v_sid then
        raise exception '이미 출제가 시작된 포지션의 선수는 바꿀 수 없어요' using errcode = 'P7T03';
      end if;
      continue;
    end if;
    if v_sid is null then
      delete from public.quiz_roster where event_id = p_id and guild_id = v_gid and position_index = v_pos;
      continue;
    end if;
    select s.name into v_name from public.guild_members m join public.students s on s.id = m.student_id
      where m.guild_id = v_gid and m.student_id = v_sid and m.left_at is null and s.transferred_at is null;
    if v_name is null then raise exception '그 길드의 길드원만 출전할 수 있어요' using errcode = 'P7T04'; end if;
    select student_id, student_name into v_old from public.quiz_roster where event_id = p_id and guild_id = v_gid and position_index = v_pos;
    insert into public.quiz_roster as r (event_id, guild_id, position_index, student_id, student_name, updated_at)
    values (p_id, v_gid, v_pos, v_sid, v_name, now())
    on conflict (event_id, guild_id, position_index) do update set student_id = excluded.student_id,
      student_name = excluded.student_name, updated_at = now();
    if e.phase = 'INDIVIDUAL' and v_old.student_id is distinct from v_sid then
      perform brand_quiz.log(p_id, 'SWAP_PLAYER', null, v_gid, jsonb_build_object('position_index', v_pos,
        'before', v_old.student_name, 'after', v_name, 'reason', v_reason));
    end if;
  end loop;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'ROSTER'));
  return jsonb_build_object('check', brand_quiz.roster_check(p_id));
end
$fn$;

-- 대기실 열기(태블릿 접속 시작) / 준비로 돌아가기
create or replace function public.teacher_quiz_open_lobby(p_id bigint, p_open boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_err jsonb;
begin
  if p_open then
    if e.phase = 'LOBBY' then return jsonb_build_object('phase', 'LOBBY'); end if;
    if e.phase <> 'SETUP' then raise exception '이미 시작한 대회예요' using errcode = 'P7T05'; end if;
    select coalesce(jsonb_agg(x), '[]') into v_err from jsonb_array_elements(brand_quiz.ready_errors(p_id)) x
      where x #>> '{}' like '%대표 계정%' or x #>> '{}' like '%참가 길드%';
    if jsonb_array_length(v_err) > 0 then
      raise exception '%', array_to_string(array(select jsonb_array_elements_text(v_err)), ' / ') using errcode = 'P7T03';
    end if;
    update public.quiz_events set phase = 'LOBBY' where id = p_id;
  else
    if e.phase = 'SETUP' then return jsonb_build_object('phase', 'SETUP'); end if;
    if e.phase <> 'LOBBY' then raise exception '이미 시작한 대회예요' using errcode = 'P7T03'; end if;
    update public.quiz_events set phase = 'SETUP' where id = p_id;
  end if;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.log(p_id, case when p_open then 'OPEN_LOBBY' else 'CLOSE_LOBBY' end);
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'LOBBY'));
  perform brand_quiz.lifecycle_signal(e.classroom_id, p_id);
  return jsonb_build_object('phase', case when p_open then 'LOBBY' else 'SETUP' end);
end
$fn$;

-- 경기 시작. 꺼진 태블릿이 있으면 사유를 받아야 진행한다.
create or replace function public.teacher_quiz_start(p_id bigint, p_force_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_err jsonb; v_off text[];
  v_reason text := nullif(btrim(coalesce(p_force_reason, '')), ''); v_stage text;
begin
  if e.phase in ('INDIVIDUAL','TEAM','IND_CEREMONY','FINAL_CEREMONY','COMPLETED') then raise exception '이미 시작한 대회예요' using errcode = 'P7T05'; end if;
  if e.phase <> 'LOBBY' then raise exception '먼저 대기실을 열어 태블릿을 연결해 주세요' using errcode = 'P7T03'; end if;
  v_err := brand_quiz.ready_errors(p_id);
  if jsonb_array_length(v_err) > 0 then
    raise exception '%', array_to_string(array(select jsonb_array_elements_text(v_err)), ' / ') using errcode = 'P7T03';
  end if;
  v_off := brand_quiz.offline_guilds(p_id);
  if array_length(v_off, 1) > 0 and v_reason is null then
    raise exception 'OFFLINE:%', array_to_string(v_off, ', ') using errcode = 'P7T03';
  end if;
  v_stage := case when brand_quiz.cfg_bool(e.config, 'use_individual', true) then 'INDIVIDUAL' else 'TEAM' end;
  perform brand_quiz.renumber(p_id);
  perform brand_quiz.enter_stage(p_id, v_stage);
  update public.quiz_events set started_at = now(), public_board = brand_quiz.board_snapshot(p_id, '시작') where id = p_id;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.log(p_id, 'START', null, null, jsonb_build_object('stage', v_stage, 'offline', to_jsonb(v_off), 'force_reason', v_reason));
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'START'));
  return jsonb_build_object('phase', v_stage);
end
$fn$;

-- ---------------------------------------------------------------------
-- 5. Teacher RPCs — 문제 진행
-- ---------------------------------------------------------------------
-- p_action: SHOW · START · PAUSE · RESUME · LOCK · REVEAL · AUTO_GRADE · FINALIZE · VOID · REISSUE · NEXT · MEDIA
-- 같은 버튼을 두 번 눌러도 안전하다: 대상 문제(p_question_id)와 회차(p_attempt)가 지금 것과 다르거나
-- 이미 그 단계를 지났으면 P7T05(이미 처리됨)로 거절하고 아무것도 바꾸지 않는다.
create or replace function public.teacher_quiz_q(p_id bigint, p_question_id bigint, p_attempt integer, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); q public.quiz_questions; v_act text := upper(coalesce(p_action, ''));
  v_now timestamptz := clock_timestamp(); v_eff text; v_left integer; v_off text[]; v_reason text; v_stage text;
  v_next bigint; v_n integer; v_every integer; v_last boolean; v_devices boolean := true; v_event text := v_act;
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
begin
  if e.phase not in ('INDIVIDUAL','TEAM') then raise exception '지금은 문제를 진행하는 단계가 아니에요' using errcode = 'P7T03'; end if;
  if e.current_question_id is distinct from p_question_id then raise exception '화면이 지난 문제를 보고 있어요. 새로 고침했어요' using errcode = 'P7T05'; end if;
  select * into q from public.quiz_questions where id = p_question_id for update;
  if q.id is null then raise exception '문제를 찾을 수 없어요' using errcode = 'P7T02'; end if;
  if q.attempt is distinct from p_attempt and v_act not in ('MEDIA') then raise exception '화면이 지난 회차를 보고 있어요. 새로 고침했어요' using errcode = 'P7T05'; end if;
  v_stage := e.phase;
  v_eff := brand_quiz.eff_qphase(e);
  v_reason := nullif(btrim(coalesce(v_args->>'reason', '')), '');

  if v_act = 'MEDIA' then
    -- 중계 화면 영상 조작 신호만 보낸다(상태 변화 없음)
    if coalesce(v_args->>'cmd', '') not in ('play','pause','restart') then raise exception '영상 명령을 확인해 주세요' using errcode = 'P7T04'; end if;
    perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'MEDIA', 'media', v_args->>'cmd'));
    return jsonb_build_object('ok', true);

  elsif v_act = 'SHOW' then
    if q.status <> 'ACTIVE' then raise exception '무효 처리된 문제예요' using errcode = 'P7T03'; end if;
    if e.q_phase <> 'IDLE' then raise exception '이미 문제를 보여 주고 있어요' using errcode = 'P7T05'; end if;
    update public.quiz_events set q_phase = 'SHOWN' where id = p_id;

  elsif v_act = 'START' then
    if q.status <> 'ACTIVE' then raise exception '무효 처리된 문제예요' using errcode = 'P7T03'; end if;
    if e.q_phase not in ('IDLE','SHOWN') then raise exception '이미 시작한 문제예요' using errcode = 'P7T05'; end if;
    v_off := brand_quiz.offline_guilds(p_id);
    if array_length(v_off, 1) > 0 and v_reason is null then
      raise exception 'OFFLINE:%', array_to_string(v_off, ', ') using errcode = 'P7T03';
    end if;
    if q.stage = 'INDIVIDUAL' and exists (select 1 from public.quiz_event_guilds g where g.event_id = p_id and not exists (
        select 1 from public.quiz_roster r where r.event_id = p_id and r.guild_id = g.guild_id and r.position_index = q.position_index)) then
      raise exception '이 포지션의 출전 선수가 비어 있는 길드가 있어요' using errcode = 'P7T03';
    end if;
    update public.quiz_events set q_phase = 'LIVE', deadline_at = v_now + make_interval(secs => q.time_limit_sec),
      remaining_ms = null, paused_at = null, checkpoint_ready = false where id = p_id;
    update public.quiz_questions set started_at = coalesce(started_at, v_now), updated_at = now() where id = q.id;
    perform brand_quiz.log(p_id, 'Q_START', q.id, null, jsonb_build_object('attempt', q.attempt, 'time_limit_sec', q.time_limit_sec,
      'offline', to_jsonb(v_off), 'force_reason', v_reason));

  elsif v_act = 'PAUSE' then
    if e.q_phase = 'PAUSED' then raise exception '이미 일시정지했어요' using errcode = 'P7T05'; end if;
    if v_eff <> 'LIVE' then raise exception '진행 중인 문제만 일시정지할 수 있어요' using errcode = 'P7T03'; end if;
    v_left := greatest(0, floor(extract(epoch from (e.deadline_at - v_now)) * 1000))::int;
    if v_left <= 0 then raise exception '이미 시간이 끝났어요' using errcode = 'P7T03'; end if;
    update public.quiz_events set q_phase = 'PAUSED', remaining_ms = v_left, deadline_at = null, paused_at = v_now where id = p_id;
    update public.quiz_questions set pause_count = pause_count + 1 where id = q.id;
    perform brand_quiz.log(p_id, 'PAUSE', q.id, null, jsonb_build_object('remaining_ms', v_left, 'reason', v_reason));

  elsif v_act = 'RESUME' then
    if e.q_phase <> 'PAUSED' then raise exception '일시정지 상태가 아니에요' using errcode = 'P7T05'; end if;
    update public.quiz_events set q_phase = 'LIVE', deadline_at = v_now + make_interval(secs => e.remaining_ms / 1000.0),
      remaining_ms = null, paused_at = null where id = p_id;
    update public.quiz_questions set pause_ms = pause_ms + greatest(0, floor(extract(epoch from (v_now - e.paused_at)) * 1000))::int where id = q.id;
    perform brand_quiz.log(p_id, 'RESUME', q.id, null, jsonb_build_object('remaining_ms', e.remaining_ms,
      'paused_ms', floor(extract(epoch from (v_now - e.paused_at)) * 1000)));

  elsif v_act = 'LOCK' then
    if e.q_phase in ('LOCKED','REVEALED','GRADED') then raise exception '이미 마감했어요' using errcode = 'P7T05'; end if;
    if e.q_phase not in ('LIVE','PAUSED') then raise exception '시작하지 않은 문제예요' using errcode = 'P7T03'; end if;
    perform brand_quiz.lock_current(p_id);
    perform brand_quiz.log(p_id, 'LOCK', q.id, null, jsonb_build_object('early', v_eff = 'LIVE' or e.q_phase = 'PAUSED'));

  elsif v_act = 'REVEAL' then
    if e.q_phase in ('REVEALED','GRADED') then raise exception '이미 답안을 공개했어요' using errcode = 'P7T05'; end if;
    if e.q_phase in ('LIVE','PAUSED') then
      if v_eff = 'LIVE' or e.q_phase = 'PAUSED' then
        if not coalesce((v_args->>'lock')::boolean, false) then
          raise exception '아직 답을 받는 중이에요. 마감하고 공개할까요?' using errcode = 'P7T03';
        end if;
        perform brand_quiz.log(p_id, 'LOCK', q.id, null, jsonb_build_object('early', true));
      end if;
      perform brand_quiz.lock_current(p_id);
    elsif e.q_phase <> 'LOCKED' then
      raise exception '시작하지 않은 문제예요' using errcode = 'P7T03';
    end if;
    update public.quiz_events set q_phase = 'REVEALED' where id = p_id;
    update public.quiz_questions set revealed_at = v_now where id = q.id;
    perform brand_quiz.log(p_id, 'REVEAL', q.id);

  elsif v_act = 'AUTO_GRADE' then
    -- 자동 판정 후보를 아직 판정하지 않은 길드에 채운다(확정 전)
    if e.q_phase not in ('LOCKED','REVEALED') then raise exception '마감 뒤에 판정할 수 있어요' using errcode = 'P7T03'; end if;
    update public.quiz_answers set verdict = case when auto_match then 'CORRECT' else 'WRONG' end, updated_at = now()
      where question_id = q.id and attempt = q.attempt and verdict is null;
    v_devices := false;

  elsif v_act = 'FINALIZE' then
    if e.q_phase = 'GRADED' then raise exception '이미 채점을 확정했어요' using errcode = 'P7T05'; end if;
    if e.q_phase <> 'REVEALED' then raise exception '답안을 공개한 뒤에 확정할 수 있어요' using errcode = 'P7T03'; end if;
    update public.quiz_answers set verdict = 'WRONG', updated_at = now()
      where question_id = q.id and attempt = q.attempt and verdict is null and (answer is null or btrim(answer) = '');
    if exists (select 1 from public.quiz_answers where question_id = q.id and attempt = q.attempt and verdict is null) then
      raise exception '아직 판정하지 않은 길드가 있어요' using errcode = 'P7T03';
    end if;
    update public.quiz_answers set points = case when verdict = 'CORRECT' then q.points else 0 end,
      graded_by = auth.uid(), graded_at = v_now, updated_at = now()
      where question_id = q.id and attempt = q.attempt;
    update public.quiz_events set q_phase = 'GRADED' where id = p_id;
    update public.quiz_questions set graded_at = v_now, updated_at = now() where id = q.id;
    perform brand_quiz.log(p_id, 'FINALIZE', q.id, null, jsonb_build_object('attempt', q.attempt, 'verdicts', (
      select jsonb_object_agg(guild_id::text, verdict) from public.quiz_answers where question_id = q.id and attempt = q.attempt)));
    -- 중간 공개 시점: 이 구간의 확정 문제 수가 N의 배수이고, 구간 마지막 문제가 아니면
    v_n := brand_quiz.graded_count(p_id, v_stage);
    v_every := brand_quiz.cfg_int(e.config, case when v_stage = 'INDIVIDUAL' then 'checkpoint_ind' else 'checkpoint_team' end, 0);
    v_last := brand_quiz.next_question(p_id, v_stage, q.seq) is null;
    if v_every > 0 and v_n % v_every = 0 and not v_last then
      if brand_quiz.cfg_bool(e.config, 'auto_checkpoint', false) then
        update public.quiz_events set public_board = brand_quiz.board_snapshot(p_id, v_n || '문제 후'), checkpoint_ready = false where id = p_id;
        perform brand_quiz.log(p_id, 'PUBLISH_BOARD', q.id, null, jsonb_build_object('auto', true));
      else
        update public.quiz_events set checkpoint_ready = true where id = p_id;
      end if;
    end if;

  elsif v_act = 'VOID' then
    if q.status = 'VOID' then raise exception '이미 무효 처리했어요' using errcode = 'P7T05'; end if;
    if v_reason is null then raise exception '무효 사유를 적어 주세요' using errcode = 'P7T04'; end if;
    update public.quiz_questions set status = 'VOID', void_reason = v_reason, updated_at = now() where id = q.id;
    update public.quiz_events set q_phase = case when e.q_phase in ('IDLE','SHOWN') then 'IDLE' else 'GRADED' end,
      deadline_at = null, remaining_ms = null, paused_at = null where id = p_id;
    perform brand_quiz.log(p_id, 'VOID', q.id, null, jsonb_build_object('reason', v_reason, 'was_graded', q.graded_at is not null));

  elsif v_act = 'REISSUE' then
    -- 같은 문제를 처음부터 다시 낸다(네트워크 사고 등). 지난 회차 답안은 기록으로 남고 점수에서 빠진다.
    if v_reason is null then raise exception '재출제 사유를 적어 주세요' using errcode = 'P7T04'; end if;
    if e.q_phase in ('IDLE','SHOWN') and q.attempt = 0 and q.started_at is null then raise exception '아직 시작하지 않은 문제예요' using errcode = 'P7T03'; end if;
    update public.quiz_questions set attempt = attempt + 1, status = 'ACTIVE', void_reason = null, locked_at = null,
      revealed_at = null, graded_at = null, updated_at = now() where id = q.id;
    update public.quiz_events set q_phase = 'IDLE', deadline_at = null, remaining_ms = null, paused_at = null where id = p_id;
    perform brand_quiz.log(p_id, 'REISSUE', q.id, null, jsonb_build_object('reason', v_reason, 'old_attempt', q.attempt));

  elsif v_act = 'NEXT' then
    if not (e.q_phase = 'GRADED' or (q.status = 'VOID' and e.q_phase in ('IDLE','GRADED'))) then
      raise exception '채점을 확정한 뒤에 다음 문제로 넘어갈 수 있어요' using errcode = 'P7T03';
    end if;
    v_next := brand_quiz.next_question(p_id, v_stage, q.seq);
    if v_next is not null then
      update public.quiz_events set current_question_id = v_next, q_phase = 'IDLE', deadline_at = null,
        remaining_ms = null, paused_at = null where id = p_id;
    else
      -- 구간 끝 → 대형 발표 단계. 발표 스냅샷을 이 순간 찍는다.
      if v_stage = 'INDIVIDUAL' then
        update public.quiz_events set phase = 'IND_CEREMONY', current_question_id = null, q_phase = 'IDLE',
          deadline_at = null, remaining_ms = null, paused_at = null, checkpoint_ready = false, ceremony_step = 0,
          ind_result = brand_quiz.result_snapshot(p_id, 'IND') where id = p_id;
      else
        update public.quiz_events set phase = 'FINAL_CEREMONY', current_question_id = null, q_phase = 'IDLE',
          deadline_at = null, remaining_ms = null, paused_at = null, checkpoint_ready = false, ceremony_step = 0,
          final_result = brand_quiz.result_snapshot(p_id, 'FINAL') where id = p_id;
      end if;
      perform brand_quiz.log(p_id, 'STAGE_END', q.id, null, jsonb_build_object('stage', v_stage));
      v_event := 'STAGE_END';
    end if;

  else
    raise exception '알 수 없는 동작이에요' using errcode = 'P7T04';
  end if;

  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, v_devices, jsonb_build_object('event', v_event));
  return jsonb_build_object('ok', true, 'action', v_act);
end
$fn$;

-- 판정 후보 고르기(확정 전) — 같은 값을 여러 번 보내도 결과가 같다
create or replace function public.teacher_quiz_grade(p_id bigint, p_question_id bigint, p_attempt integer, p_guild_id integer, p_verdict text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); q public.quiz_questions; v_verdict text := nullif(upper(coalesce(p_verdict, '')), '');
begin
  if e.current_question_id is distinct from p_question_id then raise exception '화면이 지난 문제를 보고 있어요' using errcode = 'P7T05'; end if;
  select * into q from public.quiz_questions where id = p_question_id;
  if q.attempt is distinct from p_attempt then raise exception '화면이 지난 회차를 보고 있어요' using errcode = 'P7T05'; end if;
  if e.q_phase not in ('LOCKED','REVEALED') then raise exception '마감 뒤, 확정 전에만 판정할 수 있어요. 확정 뒤에는 점수 정정을 써 주세요' using errcode = 'P7T03'; end if;
  if v_verdict is not null and v_verdict not in ('CORRECT','WRONG') then raise exception '판정 값을 확인해 주세요' using errcode = 'P7T04'; end if;
  update public.quiz_answers set verdict = v_verdict, updated_at = now()
    where question_id = q.id and attempt = q.attempt and guild_id = p_guild_id;
  if not found then raise exception '그 길드의 답안 기록이 없어요' using errcode = 'P7T02'; end if;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'GRADE_DRAFT'));
  return jsonb_build_object('ok', true);
end
$fn$;

-- 확정된 판정 정정(사유 필수) — 원본 판정만 바꾸고 누적 점수는 합산으로 다시 계산된다
create or replace function public.teacher_quiz_correct(p_id bigint, p_question_id bigint, p_guild_id integer, p_verdict text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); q public.quiz_questions; a public.quiz_answers;
  v_verdict text := upper(coalesce(p_verdict, '')); v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_verdict not in ('CORRECT','WRONG') then raise exception '판정 값을 확인해 주세요' using errcode = 'P7T04'; end if;
  if v_reason is null then raise exception '정정 사유를 적어 주세요' using errcode = 'P7T04'; end if;
  select * into q from public.quiz_questions where id = p_question_id and event_id = p_id;
  if q.id is null then raise exception '문제를 찾을 수 없어요' using errcode = 'P7T02'; end if;
  if q.graded_at is null then raise exception '확정 전 문제는 진행 화면에서 판정해 주세요' using errcode = 'P7T03'; end if;
  select * into a from public.quiz_answers where question_id = q.id and attempt = q.attempt and guild_id = p_guild_id for update;
  if a.question_id is null then raise exception '그 길드의 답안 기록이 없어요' using errcode = 'P7T02'; end if;
  if a.verdict = v_verdict then raise exception '이미 그 판정이에요' using errcode = 'P7T05'; end if;
  update public.quiz_answers set verdict = v_verdict, points = case when v_verdict = 'CORRECT' then q.points else 0 end,
    graded_by = auth.uid(), graded_at = clock_timestamp(), updated_at = now()
    where question_id = q.id and attempt = q.attempt and guild_id = p_guild_id;
  perform brand_quiz.log(p_id, 'CORRECT_GRADE', q.id, p_guild_id, jsonb_build_object(
    'before', jsonb_build_object('verdict', a.verdict, 'points', a.points),
    'after', jsonb_build_object('verdict', v_verdict, 'points', case when v_verdict = 'CORRECT' then q.points else 0 end),
    'reason', v_reason, 'phase', e.phase));
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'CORRECT'));
  return jsonb_build_object('scores', brand_quiz.scores(p_id));
end
$fn$;

-- 작은 순위판에 지금 점수를 공개(중간 공개·정정 공표)
create or replace function public.teacher_quiz_publish_board(p_id bigint, p_label text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if e.phase not in ('INDIVIDUAL','TEAM') then raise exception '경기 진행 중에만 중간 공개할 수 있어요' using errcode = 'P7T03'; end if;
  if e.q_phase in ('LIVE','PAUSED') then raise exception '문제를 받는 중에는 공개하지 않아요' using errcode = 'P7T03'; end if;
  v_label := coalesce(v_label, brand_quiz.graded_count(p_id, e.phase) || '문제 후');
  update public.quiz_events set public_board = brand_quiz.board_snapshot(p_id, v_label), checkpoint_ready = false where id = p_id;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.log(p_id, 'PUBLISH_BOARD', e.current_question_id, null, jsonb_build_object('label', v_label));
  perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'BOARD'));
  return jsonb_build_object('ok', true);
end
$fn$;

-- 대형 발표: STEP(다음 길드 공개) · BACK · RESNAP(공개 시작 전 다시 집계) · ADVANCE(다음 단계로)
create or replace function public.teacher_quiz_ceremony(p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_act text := upper(coalesce(p_action, ''));
  v_res jsonb; v_max integer; v_kind text;
begin
  if e.phase not in ('IND_CEREMONY','FINAL_CEREMONY') then raise exception '발표 단계가 아니에요' using errcode = 'P7T03'; end if;
  v_kind := case when e.phase = 'IND_CEREMONY' then 'IND' else 'FINAL' end;
  v_res := case when v_kind = 'IND' then e.ind_result else e.final_result end;
  v_max := jsonb_array_length(coalesce(v_res->'guilds', '[]'::jsonb)) + 1;  -- 길드별 공개 + 마지막 전체 화면
  if v_act = 'STEP' then
    if e.ceremony_step >= v_max then raise exception '모두 공개했어요' using errcode = 'P7T05'; end if;
    update public.quiz_events set ceremony_step = ceremony_step + 1 where id = p_id;
  elsif v_act = 'BACK' then
    if e.ceremony_step <= 0 then raise exception '처음 화면이에요' using errcode = 'P7T05'; end if;
    update public.quiz_events set ceremony_step = ceremony_step - 1 where id = p_id;
  elsif v_act = 'RESNAP' then
    if e.ceremony_step > 0 then raise exception '공개를 시작한 뒤에는 다시 집계할 수 없어요. 처음 화면으로 돌아간 뒤 해 주세요' using errcode = 'P7T03'; end if;
    if v_kind = 'IND' then
      update public.quiz_events set ind_result = brand_quiz.result_snapshot(p_id, 'IND') where id = p_id;
    else
      update public.quiz_events set final_result = brand_quiz.result_snapshot(p_id, 'FINAL') where id = p_id;
    end if;
    perform brand_quiz.log(p_id, 'RESNAP', null, null, jsonb_build_object('kind', v_kind));
  elsif v_act = 'ADVANCE' then
    if e.ceremony_step < v_max then raise exception '발표를 끝까지 공개한 뒤 넘어갈 수 있어요' using errcode = 'P7T03'; end if;
    if v_kind = 'IND' then
      if brand_quiz.cfg_bool(e.config, 'use_team', true) and brand_quiz.next_question(p_id, 'TEAM', 0) is not null then
        perform brand_quiz.enter_stage(p_id, 'TEAM');
        update public.quiz_events set public_board = brand_quiz.board_snapshot(p_id, '개인전 결과') where id = p_id;
      else
        update public.quiz_events set phase = 'FINAL_CEREMONY', ceremony_step = 0,
          final_result = brand_quiz.result_snapshot(p_id, 'FINAL') where id = p_id;
      end if;
    else
      update public.quiz_events set phase = 'COMPLETED', completed_at = now(),
        public_board = brand_quiz.board_snapshot(p_id, '최종') where id = p_id;
      perform brand_quiz.lifecycle_signal(e.classroom_id, p_id);
    end if;
    perform brand_quiz.log(p_id, 'CEREMONY_ADVANCE', null, null, jsonb_build_object('kind', v_kind));
  else
    raise exception '알 수 없는 동작이에요' using errcode = 'P7T04';
  end if;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'CEREMONY'));
  return jsonb_build_object('ok', true);
end
$fn$;

-- 중계 화면 표시 설정(작은 순위판 숨김 등) — 점수·진행에는 영향 없음
create or replace function public.teacher_quiz_screen(p_id bigint, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v jsonb := coalesce(p_settings, '{}'::jsonb);
begin
  update public.quiz_events set screen = jsonb_build_object(
    'board', case when coalesce(v->>'board', e.screen->>'board', 'SHOW') = 'HIDE' then 'HIDE' else 'SHOW' end)
  where id = p_id;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'SCREEN'));
  return jsonb_build_object('ok', true);
end
$fn$;

-- 대회 조기 종료(기록은 남는다)
create or replace function public.teacher_quiz_end(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if e.phase = 'COMPLETED' then raise exception '이미 끝난 대회예요' using errcode = 'P7T05'; end if;
  if v_reason is null then raise exception '종료 사유를 적어 주세요' using errcode = 'P7T04'; end if;
  update public.quiz_events set phase = 'COMPLETED', completed_at = now(), q_phase = case when q_phase in ('LIVE','PAUSED') then 'LOCKED' else q_phase end,
    deadline_at = null, remaining_ms = null, paused_at = null where id = p_id;
  perform brand_quiz.touch(p_id);
  perform brand_quiz.log(p_id, 'END_EARLY', e.current_question_id, null, jsonb_build_object('reason', v_reason, 'phase', e.phase));
  perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'END'));
  perform brand_quiz.lifecycle_signal(e.classroom_id, p_id);
  return jsonb_build_object('ok', true);
end
$fn$;

-- 대회 삭제: 리허설이거나 아직 시작하지 않은 대회만
create or replace function public.teacher_quiz_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, true); v_paths text[];
begin
  if not (e.is_rehearsal or e.phase in ('SETUP','LOBBY')) then
    raise exception '실제 경기 기록은 지울 수 없어요(리허설 대회만 지울 수 있어요)' using errcode = 'P7T03';
  end if;
  select coalesce(array_agg(media_path) filter (where media_path is not null), '{}') into v_paths
    from public.quiz_questions where event_id = p_id;
  delete from public.quiz_events where id = p_id;
  if e.phase not in ('SETUP','COMPLETED') then perform brand_quiz.lifecycle_signal(e.classroom_id, p_id); end if;
  return jsonb_build_object('id', p_id, 'media_paths', to_jsonb(v_paths));
end
$fn$;

-- ---------------------------------------------------------------------
-- 6. Teacher RPCs — 읽기
-- ---------------------------------------------------------------------
-- 교사 운영 화면 전체 상태(정답 포함)
create or replace function public.teacher_quiz_state(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, false); v_scores jsonb; v_board_total jsonb; v_stale boolean;
begin
  v_scores := brand_quiz.scores(p_id);
  v_board_total := coalesce(e.public_board->'scores', '{}'::jsonb);
  select exists (select 1 from jsonb_each(v_scores) s where coalesce((v_board_total->>s.key)::int, 0) <> (s.value->>'total')::int)
    into v_stale;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'is_rehearsal', e.is_rehearsal, 'config', e.config,
      'phase', e.phase, 'current_question_id', e.current_question_id, 'q_phase', e.q_phase, 'eff_q_phase', brand_quiz.eff_qphase(e),
      'deadline_at', e.deadline_at, 'remaining_ms', e.remaining_ms, 'paused_at', e.paused_at,
      'public_board', e.public_board, 'ind_result', e.ind_result, 'final_result', e.final_result,
      'ceremony_step', e.ceremony_step, 'checkpoint_ready', e.checkpoint_ready, 'screen', e.screen,
      'version', e.version, 'created_at', e.created_at, 'started_at', e.started_at, 'completed_at', e.completed_at),
    'guilds', coalesce((select jsonb_agg(jsonb_build_object('guild_id', g.guild_id, 'name', g.guild_name, 'sort_order', g.sort_order,
        'device_student_id', g.device_student_id, 'device_name', s.name, 'device_seen_at', g.device_seen_at,
        'logo_url', gg.logo_url) order by g.sort_order)
      from public.quiz_event_guilds g left join public.students s on s.id = g.device_student_id
      left join public.guilds gg on gg.id = g.guild_id where g.event_id = p_id), '[]'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object('guild_id', r.guild_id, 'position_index', r.position_index,
        'student_id', r.student_id, 'name', r.student_name) order by r.guild_id, r.position_index)
      from public.quiz_roster r where r.event_id = p_id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(q) - 'event_id' - 'created_at' order by q.seq)
      from public.quiz_questions q where q.event_id = p_id), '[]'::jsonb),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'attempt', a.attempt, 'guild_id', a.guild_id,
        'player_student_id', a.player_student_id, 'player_name', a.player_name, 'answer', a.answer, 'submitted_at', a.submitted_at,
        'auto_match', a.auto_match, 'verdict', a.verdict, 'points', a.points, 'graded_at', a.graded_at))
      from public.quiz_answers a where a.event_id = p_id), '[]'::jsonb),
    'scores', v_scores,
    'board_stale', coalesce(v_stale, false),
    'offline', to_jsonb(brand_quiz.offline_guilds(p_id)),
    'roster_check', brand_quiz.roster_check(p_id),
    'ready_errors', case when e.phase in ('SETUP','LOBBY') then brand_quiz.ready_errors(p_id) else '[]'::jsonb end);
end
$fn$;

-- 기기 접속 상태만 가볍게(운영 화면이 8초마다 확인)
create or replace function public.teacher_quiz_presence(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, false);
begin
  return jsonb_build_object('server_now', clock_timestamp(), 'version', e.version,
    'devices', coalesce((select jsonb_object_agg(guild_id::text, device_seen_at) from public.quiz_event_guilds where event_id = p_id), '{}'::jsonb));
end
$fn$;

-- 중계 화면(교실 스크린) — 공개된 정보만 만든다. 정답은 채점 확정 뒤에만, 답안 원문은 공개 뒤에만.
create or replace function public.teacher_quiz_screen_state(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, false); q public.quiz_questions; v_eff text;
  v_positions text[]; v_question jsonb; v_guilds jsonb; v_handoff boolean := false; v_prev public.quiz_questions;
  v_stage_total integer; v_stage_index integer; v_pos_total integer; v_pos_index integer; v_result jsonb; v_shown integer;
begin
  v_eff := brand_quiz.eff_qphase(e);
  v_positions := brand_quiz.positions(e.config);
  select * into q from public.quiz_questions where id = e.current_question_id;
  if q.id is not null then
    select * into v_prev from public.quiz_questions where event_id = p_id and stage = q.stage and seq < q.seq order by seq desc limit 1;
    v_handoff := e.q_phase = 'IDLE' and q.stage = 'INDIVIDUAL' and (v_prev.id is null or v_prev.position_index is distinct from q.position_index);
    select count(*), count(*) filter (where seq <= q.seq) into v_stage_total, v_stage_index
      from public.quiz_questions where event_id = p_id and stage = q.stage and status = 'ACTIVE';
    select count(*), count(*) filter (where seq <= q.seq) into v_pos_total, v_pos_index
      from public.quiz_questions where event_id = p_id and stage = q.stage and status = 'ACTIVE'
        and coalesce(position_index, -1) = coalesce(q.position_index, -1);
    v_question := jsonb_build_object('id', q.id, 'attempt', q.attempt, 'stage', q.stage, 'position_index', q.position_index,
      'position_label', case when q.position_index is not null then v_positions[q.position_index + 1] end,
      'points', q.points, 'time_limit_sec', q.time_limit_sec, 'status', q.status,
      'stage_index', v_stage_index, 'stage_total', v_stage_total, 'pos_index', v_pos_index, 'pos_total', v_pos_total,
      'prompt', case when e.q_phase <> 'IDLE' then q.prompt end,
      'media_type', case when e.q_phase <> 'IDLE' then q.media_type end,
      'media_path', case when e.q_phase <> 'IDLE' then q.media_path end,
      'media_url', case when e.q_phase <> 'IDLE' then q.media_url end,
      'answer_key', case when e.q_phase = 'GRADED' and q.status = 'ACTIVE' then q.answer_key end,
      'explanation', case when e.q_phase = 'GRADED' and q.status = 'ACTIVE' then q.explanation end);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'guild_id', g.guild_id, 'name', g.guild_name, 'logo_url', gg.logo_url,
      'player', case when q.stage = 'INDIVIDUAL' then r.student_name end,
      'online', g.device_seen_at is not null and g.device_seen_at >= now() - interval '40 seconds',
      'submitted', a.submitted_at is not null,
      'answer', case when e.q_phase in ('REVEALED','GRADED') then a.answer end,
      'verdict', case when e.q_phase = 'GRADED' then a.verdict end,
      'points', case when e.q_phase = 'GRADED' then a.points end) order by g.sort_order), '[]'::jsonb)
    into v_guilds
  from public.quiz_event_guilds g
  left join public.guilds gg on gg.id = g.guild_id
  left join public.quiz_roster r on r.event_id = g.event_id and r.guild_id = g.guild_id and r.position_index = q.position_index
  left join public.quiz_answers a on a.question_id = q.id and a.attempt = q.attempt and a.guild_id = g.guild_id
  where g.event_id = p_id;
  -- 발표: 지금까지 공개한 길드(낮은 점수부터)만 보낸다
  if e.phase in ('IND_CEREMONY','FINAL_CEREMONY') then
    v_result := case when e.phase = 'IND_CEREMONY' then e.ind_result else e.final_result end;
    v_shown := least(e.ceremony_step, jsonb_array_length(coalesce(v_result->'guilds', '[]'::jsonb)));
    v_result := jsonb_build_object('kind', v_result->'kind', 'max_ind', v_result->'max_ind', 'max_team', v_result->'max_team',
      'total', jsonb_array_length(coalesce(v_result->'guilds', '[]'::jsonb)), 'step', e.ceremony_step,
      'guilds', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_result->'guilds') with ordinality t(x, o)
        where o <= v_shown), '[]'::jsonb));
  elsif e.phase = 'COMPLETED' then
    v_result := e.final_result;
  end if;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'version', e.version, 'title', e.title, 'phase', e.phase, 'q_phase', v_eff,
    'deadline_at', e.deadline_at, 'remaining_ms', e.remaining_ms,
    'positions', to_jsonb(v_positions),
    'handoff', v_handoff,
    'question', v_question,
    'guilds', v_guilds,
    'board', jsonb_build_object('visible', coalesce(e.screen->>'board', 'SHOW') <> 'HIDE', 'snapshot', e.public_board),
    'result', v_result);
end
$fn$;

-- 기록 화면: 운영 이력
create or replace function public.teacher_quiz_audit(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare e public.quiz_events := brand_quiz.teacher_event(p_id, false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'action', a.action, 'question_id', a.question_id,
      'guild_id', a.guild_id, 'detail', a.detail) order by a.id)
    from public.quiz_audit a where a.event_id = e.id), '[]'::jsonb);
end
$fn$;

-- ---------------------------------------------------------------------
-- 7. Student RPCs — 지정된 대표자 계정(길드 태블릿)만
-- ---------------------------------------------------------------------
create or replace function public.student_quiz_feed()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record;
begin
  select * into v_ctx from brand_quiz.student_ctx();
  return jsonb_build_object('server_now', now(), 'events', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'phase', e.phase, 'guild_name', g.guild_name) order by e.created_at desc)
    from public.quiz_event_guilds g join public.quiz_events e on e.id = g.event_id
    where g.device_student_id = v_ctx.o_student_id and e.classroom_id = v_ctx.o_classroom_id
      and e.phase not in ('SETUP','COMPLETED')), '[]'::jsonb));
end
$fn$;

-- 태블릿 상태: 내 길드 정보 + 지금 문제 1개(보여 주는 단계부터). 접속 기록도 남긴다(10초에 한 번만 씀).
create or replace function public.student_quiz_state(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; e public.quiz_events; g public.quiz_event_guilds; q public.quiz_questions; v_eff text;
  v_positions text[]; v_player_id integer; v_player_name text; v_mine public.quiz_answers; v_prev public.quiz_questions; v_handoff boolean := false;
  v_next_pos integer; v_next_player text; v_question jsonb;
begin
  select * into v_ctx from brand_quiz.student_ctx();
  select * into e from public.quiz_events where id = p_id and classroom_id = v_ctx.o_classroom_id;
  select * into g from public.quiz_event_guilds where event_id = p_id and device_student_id = v_ctx.o_student_id;
  if e.id is null or g.event_id is null then
    raise exception '이 퀴즈의 길드 제출 기기로 지정된 계정이 아니에요' using errcode = 'P7T01';
  end if;
  if g.device_seen_at is null or g.device_seen_at < now() - interval '10 seconds' then
    update public.quiz_event_guilds set device_seen_at = now() where event_id = p_id and guild_id = g.guild_id;
  end if;
  v_eff := brand_quiz.eff_qphase(e);
  v_positions := brand_quiz.positions(e.config);
  if e.phase in ('INDIVIDUAL','TEAM') then
    select * into q from public.quiz_questions where id = e.current_question_id;
  end if;
  if q.id is not null then
    if q.stage = 'INDIVIDUAL' then
      select student_id, student_name into v_player_id, v_player_name from public.quiz_roster
        where event_id = p_id and guild_id = g.guild_id and position_index = q.position_index;
      select * into v_prev from public.quiz_questions where event_id = p_id and stage = q.stage and seq < q.seq order by seq desc limit 1;
      v_handoff := e.q_phase = 'IDLE' and (v_prev.id is null or v_prev.position_index is distinct from q.position_index);
    end if;
    select * into v_mine from public.quiz_answers where question_id = q.id and attempt = q.attempt and guild_id = g.guild_id;
    v_question := jsonb_build_object('id', q.id, 'attempt', q.attempt, 'stage', q.stage, 'position_index', q.position_index,
      'position_label', case when q.position_index is not null then v_positions[q.position_index + 1] end,
      'points', q.points, 'time_limit_sec', q.time_limit_sec, 'status', q.status,
      -- 지문·미디어는 교사가 문제를 보여 준 뒤부터만 보낸다
      'prompt', case when e.q_phase <> 'IDLE' and q.status = 'ACTIVE' then q.prompt end,
      'media_type', case when e.q_phase <> 'IDLE' and q.status = 'ACTIVE' and q.media_on_device then q.media_type end,
      'media_path', case when e.q_phase <> 'IDLE' and q.status = 'ACTIVE' and q.media_on_device then q.media_path end,
      'media_url', case when e.q_phase <> 'IDLE' and q.status = 'ACTIVE' and q.media_on_device and q.media_type = 'IMAGE' then q.media_url end,
      'answer_key', case when e.q_phase = 'GRADED' and q.status = 'ACTIVE' then q.answer_key end,
      'mine', case when v_mine.question_id is null then null else jsonb_build_object(
        'answer', v_mine.answer, 'submitted_at', v_mine.submitted_at,
        'verdict', case when e.q_phase = 'GRADED' then v_mine.verdict end,
        'points', case when e.q_phase = 'GRADED' then v_mine.points end) end);
  end if;
  -- 다음 출전 선수(교체 안내용)
  if e.phase in ('LOBBY','INDIVIDUAL') and brand_quiz.cfg_bool(e.config, 'use_individual', true) then
    v_next_pos := coalesce(q.position_index, 0);
    select student_name into v_next_player from public.quiz_roster where event_id = p_id and guild_id = g.guild_id and position_index = v_next_pos;
  end if;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'version', e.version, 'title', e.title, 'phase', e.phase, 'q_phase', v_eff,
    'deadline_at', e.deadline_at, 'remaining_ms', e.remaining_ms,
    'max_len', brand_quiz.cfg_int(e.config, 'max_len', 100),
    'guild', jsonb_build_object('guild_id', g.guild_id, 'name', g.guild_name),
    'handoff', v_handoff,
    'player', v_player_name,
    'next_player', v_next_player,
    'first_position', v_positions[1],
    'question', v_question);
end
$fn$;

-- 답 제출: 길드당 문제(회차)마다 1번. 다시 눌러도 처음 낸 답을 그대로 돌려준다.
create or replace function public.student_quiz_submit(p_id bigint, p_question_id bigint, p_attempt integer, p_answer text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; e public.quiz_events; g public.quiz_event_guilds; q public.quiz_questions; v_now timestamptz := clock_timestamp();
  v_answer text := btrim(coalesce(p_answer, '')); v_row public.quiz_answers; v_player_id integer; v_player_name text; v_count integer; v_total integer;
  v_inserted boolean := false;
begin
  select * into v_ctx from brand_quiz.student_ctx();
  -- 마감·일시정지 판정과 '모두 제출 시 자동 마감'이 엇갈리지 않도록 대회 행을 잠근다(길드 5개라 대기 무시 가능)
  select * into e from public.quiz_events where id = p_id and classroom_id = v_ctx.o_classroom_id for update;
  select * into g from public.quiz_event_guilds where event_id = p_id and device_student_id = v_ctx.o_student_id;
  if e.id is null or g.event_id is null then
    raise exception '이 퀴즈의 길드 제출 기기로 지정된 계정이 아니에요' using errcode = 'P7T01';
  end if;
  select * into q from public.quiz_questions where id = p_question_id and event_id = p_id;
  if q.id is null then raise exception '문제를 찾을 수 없어요' using errcode = 'P7T02'; end if;
  -- 이미 낸 답이 있으면 그대로 돌려준다(중복 클릭·새로고침·재전송)
  select * into v_row from public.quiz_answers where question_id = q.id and attempt = p_attempt and guild_id = g.guild_id;
  if v_row.submitted_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'answer', v_row.answer, 'submitted_at', v_row.submitted_at);
  end if;
  if e.current_question_id is distinct from q.id or q.attempt is distinct from p_attempt or e.phase not in ('INDIVIDUAL','TEAM') then
    raise exception '지금 받는 문제가 아니에요' using errcode = 'P7T03';
  end if;
  if e.q_phase = 'PAUSED' then raise exception '경기가 일시정지되었어요. 답이 저장되지 않았어요' using errcode = 'P7T03'; end if;
  if e.q_phase <> 'LIVE' or brand_quiz.eff_qphase(e) <> 'LIVE' then
    raise exception '시간이 끝나 답을 받을 수 없어요' using errcode = 'P7T03';
  end if;
  if char_length(v_answer) < 1 then raise exception '답을 입력해 주세요' using errcode = 'P7T04'; end if;
  if char_length(v_answer) > brand_quiz.cfg_int(e.config, 'max_len', 100) then
    raise exception '답은 %자까지 쓸 수 있어요', brand_quiz.cfg_int(e.config, 'max_len', 100) using errcode = 'P7T04';
  end if;
  if q.stage = 'INDIVIDUAL' then
    select student_id, student_name into v_player_id, v_player_name from public.quiz_roster
      where event_id = p_id and guild_id = g.guild_id and position_index = q.position_index;
  end if;
  insert into public.quiz_answers (event_id, question_id, attempt, guild_id, player_student_id, player_name, submitted_by,
    answer, submitted_at, auto_match)
  values (p_id, q.id, q.attempt, g.guild_id, v_player_id, v_player_name, v_ctx.o_student_id,
    v_answer, v_now, brand_quiz.auto_match(v_answer, q.answer_key, q.accepted))
  on conflict (question_id, attempt, guild_id) do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_count > 0;
  update public.quiz_event_guilds set device_seen_at = now() where event_id = p_id and guild_id = g.guild_id;
  select * into v_row from public.quiz_answers where question_id = q.id and attempt = q.attempt and guild_id = g.guild_id;
  if v_inserted then
    -- 모든 길드가 냈으면 바로 마감
    select count(*) into v_total from public.quiz_event_guilds where event_id = p_id;
    select count(*) into v_count from public.quiz_answers where question_id = q.id and attempt = q.attempt and submitted_at is not null;
    if v_count >= v_total then
      perform brand_quiz.lock_current(p_id);
      perform brand_quiz.log(p_id, 'LOCK', q.id, null, jsonb_build_object('all_submitted', true));
      perform brand_quiz.touch(p_id);
      perform brand_quiz.bump(p_id, true, jsonb_build_object('event', 'LOCK'));
    else
      perform brand_quiz.touch(p_id);
      perform brand_quiz.bump(p_id, false, jsonb_build_object('event', 'SUBMIT'));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'already', not v_inserted, 'answer', v_row.answer, 'submitted_at', v_row.submitted_at);
end
$fn$;

-- ---------------------------------------------------------------------
-- 8. 문제 미디어 저장소 (이미지·짧은 영상) — 비공개 버킷
--   경로: <학급 id>/<대회 id>/<임의 이름>.<확장자>
--   교사: 자기 학급 폴더만 올리기·읽기·지우기
--   학생: 지정 대표자 계정이 '지금 보여 주는 문제'의 미디어만 읽기(기기 표시를 켠 문제)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-media', 'quiz-media', false, 52428800,
  array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do nothing;

create or replace function public.quiz_media_readable(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $fn$
  select case
    when public.is_teacher_or_admin() then split_part(p_path, '/', 1) = coalesce(public.current_classroom_id()::text, '-')
    else exists (
      select 1 from public.quiz_questions q
      join public.quiz_events e on e.id = q.event_id and e.current_question_id = q.id
      join public.quiz_event_guilds g on g.event_id = e.id
      join public.students s on s.id = g.device_student_id
      where q.media_path = p_path and q.media_on_device and q.status = 'ACTIVE'
        and e.phase in ('INDIVIDUAL','TEAM') and e.q_phase <> 'IDLE'
        and s.user_id = auth.uid() and s.transferred_at is null)
  end
$fn$;

create or replace function public.quiz_media_writable(p_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $fn$
  select public.is_teacher_or_admin() and split_part(p_path, '/', 1) = coalesce(public.current_classroom_id()::text, '-')
$fn$;

drop policy if exists quiz_media_read on storage.objects;
create policy quiz_media_read on storage.objects for select to authenticated
  using (bucket_id = 'quiz-media' and public.quiz_media_readable(name));
drop policy if exists quiz_media_insert on storage.objects;
create policy quiz_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'quiz-media' and public.quiz_media_writable(name));
drop policy if exists quiz_media_update on storage.objects;
create policy quiz_media_update on storage.objects for update to authenticated
  using (bucket_id = 'quiz-media' and public.quiz_media_writable(name))
  with check (bucket_id = 'quiz-media' and public.quiz_media_writable(name));
drop policy if exists quiz_media_delete on storage.objects;
create policy quiz_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'quiz-media' and public.quiz_media_writable(name));

-- ---------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%'
             or p.proname in ('quiz_pulse_readable','quiz_media_readable','quiz_media_writable')))
       or n.nspname = 'brand_quiz'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
