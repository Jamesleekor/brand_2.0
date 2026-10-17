-- =====================================================================
-- B.R.A.N.D 2.0 — 모험가 도구함 (Adventurer Toolbox) v1
-- 2026-10-17
-- ---------------------------------------------------------------------
-- 근거: BRAND_모험가_도구함_기능명세서 v1.1
--
-- 범위
--   * 학급 활동 5종(버저·점수판·대진표·투표·카드 구름)의 서버 상태와 검증
--   * 개인 도구 6종은 서버에 저장하지 않으므로 이 파일과 무관
--   * 실시간 알림은 toolbox_pulse 한 표만 Realtime에 추가한다.
--     - '<classroom>-S' 행: 학생 화면용 신호(학급 학생 누구나 읽기)
--     - '<classroom>-T' 행: 운영 화면·중계 화면용 신호(교사만 읽기)
--     버저 입력처럼 몰리는 신호는 T 행만 바꾸므로 학생 24명에게 퍼지지 않는다.
--
-- 안전 원칙
--   * 기존 표(students, guilds, guild_members, attendances 등)는 읽기만 한다.
--   * 모든 쓰기는 SECURITY DEFINER 함수 안에서 역할·학급 범위를 검증한다.
--   * 새 표는 RLS를 켜고 anon/authenticated 직접 쓰기를 막는다.
--     (예외: toolbox_rosters는 교사 전용 RLS 정책으로 직접 읽기/쓰기)
--   * 파괴적 변경 없음. 기존 객체를 DROP하지 않는다.
--   * 투표·점수판만 기록으로 남고, 버저·대진표·카드 구름은 종료 시 삭제된다.
-- =====================================================================

create schema if not exists brand_toolbox;
revoke all on schema brand_toolbox from public;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.toolbox_activities (
  id bigint generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id),
  kind text not null check (kind in ('BUZZER','SCOREBOARD','TOURNAMENT','VOTE','CARDS')),
  title text not null check (char_length(title) between 1 and 60),
  status text not null default 'READY' check (status in ('READY','OPEN','CLOSED','ENDED')),
  config jsonb not null default '{}'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  eligible_student_ids integer[] not null default '{}',
  state jsonb not null default '{}'::jsonb,
  share_to_students boolean not null default true,
  rev integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  ended_at timestamptz
);
create index if not exists toolbox_activities_live_idx on public.toolbox_activities (classroom_id, status);
create index if not exists toolbox_activities_record_idx on public.toolbox_activities (classroom_id, kind, ended_at desc);

create table if not exists public.toolbox_buzzer_presses (
  activity_id bigint not null references public.toolbox_activities(id) on delete cascade,
  round_no integer not null,
  unit_key text not null,
  student_id integer not null references public.students(id),
  rank integer not null,
  pressed_at timestamptz not null,
  primary key (activity_id, round_no, unit_key)
);

create table if not exists public.toolbox_buzzer_locks (
  activity_id bigint not null references public.toolbox_activities(id) on delete cascade,
  student_id integer not null references public.students(id),
  round_no integer not null,          -- 부정출발한 시점에 '다음에 열릴' 라운드 번호
  pressed_at timestamptz not null,
  locked_until timestamptz not null,
  primary key (activity_id, student_id)
);

create table if not exists public.toolbox_score_events (
  id bigint generated always as identity primary key,
  activity_id bigint not null references public.toolbox_activities(id) on delete cascade,
  batch_id bigint,
  unit_key text not null,
  delta integer not null,
  source text not null check (source in ('MANUAL','SET','BUZZER','RESET')),
  detail jsonb not null default '{}'::jsonb,
  undone_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists toolbox_score_events_activity_idx on public.toolbox_score_events (activity_id, id desc);

create table if not exists public.toolbox_vote_ballots (
  activity_id bigint not null references public.toolbox_activities(id) on delete cascade,
  student_id integer not null references public.students(id),
  choices jsonb not null,
  revision integer not null default 1,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidated_reason text,
  invalidated_by uuid,
  primary key (activity_id, student_id)
);

create table if not exists public.toolbox_cards (
  activity_id bigint not null references public.toolbox_activities(id) on delete cascade,
  student_id integer not null references public.students(id),
  title text not null check (char_length(title) between 1 and 40),
  body text not null check (char_length(body) between 1 and 2000),
  revision integer not null default 1,
  hidden boolean not null default false,
  presented boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (activity_id, student_id)
);

create table if not exists public.toolbox_rosters (
  id bigint generated always as identity primary key,
  classroom_id integer not null references public.classrooms(id),
  name text not null check (char_length(name) between 1 and 40),
  items jsonb not null default '[]'::jsonb,
  is_recent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists toolbox_rosters_classroom_idx on public.toolbox_rosters (classroom_id, is_recent, updated_at desc);

create table if not exists public.toolbox_pulse (
  pulse_key text primary key,
  classroom_id integer not null references public.classrooms(id),
  audience text not null check (audience in ('S','T')),
  rev bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Access control
-- ---------------------------------------------------------------------
alter table public.toolbox_activities enable row level security;
alter table public.toolbox_buzzer_presses enable row level security;
alter table public.toolbox_buzzer_locks enable row level security;
alter table public.toolbox_score_events enable row level security;
alter table public.toolbox_vote_ballots enable row level security;
alter table public.toolbox_cards enable row level security;
alter table public.toolbox_rosters enable row level security;
alter table public.toolbox_pulse enable row level security;

revoke all on public.toolbox_activities, public.toolbox_buzzer_presses, public.toolbox_buzzer_locks,
  public.toolbox_score_events, public.toolbox_vote_ballots, public.toolbox_cards,
  public.toolbox_rosters, public.toolbox_pulse from anon, authenticated, public;

-- 저장 명단: 교사만 자기 학급 것을 직접 읽고 쓴다.
drop policy if exists toolbox_rosters_teacher on public.toolbox_rosters;
create policy toolbox_rosters_teacher on public.toolbox_rosters for all to authenticated
  using (public.is_teacher_or_admin() and public.is_classroom_member(classroom_id))
  with check (public.is_teacher_or_admin() and public.is_classroom_member(classroom_id));
grant select, insert, update, delete on public.toolbox_rosters to authenticated;

-- 신호 행: 학생 신호는 학급 구성원, 교사 신호는 교사만 읽는다. 쓰기는 함수만.
drop policy if exists toolbox_pulse_read on public.toolbox_pulse;
create policy toolbox_pulse_read on public.toolbox_pulse for select to authenticated
  using (
    case audience
      when 'S' then public.is_classroom_member(classroom_id)
      else public.is_teacher_or_admin() and public.is_classroom_member(classroom_id)
    end
  );
grant select on public.toolbox_pulse to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'toolbox_pulse'
  ) then
    execute 'alter publication supabase_realtime add table public.toolbox_pulse';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Internal helpers (brand_toolbox schema, not exposed)
-- ---------------------------------------------------------------------
-- 오류 코드: P7T01 권한 · P7T02 대상 없음 · P7T03 상태 · P7T04 입력값 · P7T05 이미 처리됨

create or replace function brand_toolbox.teacher_classroom()
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

create or replace function brand_toolbox.student_ctx(out o_student_id integer, out o_classroom_id integer)
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

create or replace function brand_toolbox.teacher_activity(p_id bigint, p_lock boolean default false)
returns public.toolbox_activities language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer := brand_toolbox.teacher_classroom(); v_row public.toolbox_activities;
begin
  if p_lock then
    select * into v_row from public.toolbox_activities where id = p_id and classroom_id = v_classroom for update;
  else
    select * into v_row from public.toolbox_activities where id = p_id and classroom_id = v_classroom;
  end if;
  if v_row.id is null then
    raise exception '활동을 찾을 수 없어요. 이미 종료되었을 수 있어요' using errcode = 'P7T02';
  end if;
  return v_row;
end
$fn$;

-- 학생 화면에 보이는 활동인지
create or replace function brand_toolbox.student_can_see(p_row public.toolbox_activities, p_student integer)
returns boolean language sql stable set search_path = public, pg_temp
as $fn$
  select p_row.status in ('OPEN','CLOSED') and (
    case p_row.kind
      when 'BUZZER' then p_student = any(p_row.eligible_student_ids)
      when 'VOTE' then p_student = any(p_row.eligible_student_ids)
      when 'CARDS' then p_student = any(p_row.eligible_student_ids)
      else p_row.share_to_students
    end)
$fn$;

create or replace function brand_toolbox.bump(p_classroom integer, p_student_visible boolean, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_open integer; v_payload jsonb := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('at', clock_timestamp());
begin
  insert into public.toolbox_pulse as p (pulse_key, classroom_id, audience, rev, payload, updated_at)
  values (p_classroom || '-T', p_classroom, 'T', 1, v_payload, now())
  on conflict (pulse_key) do update set rev = p.rev + 1, payload = excluded.payload, updated_at = now();

  if p_student_visible then
    select count(*) into v_open from public.toolbox_activities a
    where a.classroom_id = p_classroom and a.status in ('OPEN','CLOSED')
      and (a.kind in ('BUZZER','VOTE','CARDS') or a.share_to_students);
    insert into public.toolbox_pulse as p (pulse_key, classroom_id, audience, rev, payload, updated_at)
    values (p_classroom || '-S', p_classroom, 'S', 1, v_payload || jsonb_build_object('open_count', v_open), now())
    on conflict (pulse_key) do update set rev = p.rev + 1, payload = excluded.payload, updated_at = now();
  end if;
end
$fn$;

create or replace function brand_toolbox.touch(p_id bigint)
returns void language sql security definer set search_path = public, pg_temp
as $fn$ update public.toolbox_activities set rev = rev + 1, updated_at = now() where id = p_id $fn$;

-- 참가 단위 검증·정리
create or replace function brand_toolbox.normalize_units(p_classroom integer, p_units jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_unit jsonb; v_out jsonb := '[]'::jsonb; v_keys text[] := '{}'; v_key text; v_type text; v_label text;
  v_color text; v_sid integer; v_gid integer; v_members jsonb; v_member jsonb; v_msid integer; v_mlist jsonb;
begin
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception '참가자 목록 형식이 올바르지 않아요' using errcode = 'P7T04';
  end if;
  if jsonb_array_length(p_units) > 64 then
    raise exception '참가자는 64개까지 넣을 수 있어요' using errcode = 'P7T04';
  end if;
  for v_unit in select value from jsonb_array_elements(p_units) loop
    v_key := btrim(coalesce(v_unit->>'key', ''));
    v_type := upper(coalesce(v_unit->>'type', ''));
    v_label := btrim(coalesce(v_unit->>'label', ''));
    v_color := nullif(btrim(coalesce(v_unit->>'color', '')), '');
    if v_key = '' or char_length(v_key) > 40 or v_key = any(v_keys) then
      raise exception '참가자 구분값이 비었거나 겹쳐요' using errcode = 'P7T04';
    end if;
    if v_type not in ('STUDENT','GUILD','TEAM','MANUAL') then
      raise exception '참가자 종류가 올바르지 않아요' using errcode = 'P7T04';
    end if;
    if v_label = '' or char_length(v_label) > 40 then
      raise exception '참가자 이름은 1~40자여야 해요' using errcode = 'P7T04';
    end if;
    if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception '색상 값이 올바르지 않아요' using errcode = 'P7T04';
    end if;
    v_sid := null; v_gid := null;
    if v_type = 'STUDENT' then
      v_sid := (v_unit->>'student_id')::integer;
      if not exists (select 1 from public.students s where s.id = v_sid and s.classroom_id = p_classroom and s.transferred_at is null
                     and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')) then
        raise exception '우리 반 학생이 아닌 참가자가 있어요' using errcode = 'P7T04';
      end if;
    elsif v_type = 'GUILD' then
      v_gid := (v_unit->>'guild_id')::integer;
      if not exists (select 1 from public.guilds g where g.id = v_gid and g.classroom_id = p_classroom) then
        raise exception '우리 반 길드가 아닌 참가자가 있어요' using errcode = 'P7T04';
      end if;
    end if;
    v_mlist := '[]'::jsonb;
    v_members := coalesce(v_unit->'members', '[]'::jsonb);
    if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) > 64 then
      raise exception '구성원 목록 형식이 올바르지 않아요' using errcode = 'P7T04';
    end if;
    for v_member in select value from jsonb_array_elements(v_members) loop
      v_msid := (v_member->>'student_id')::integer;
      if not exists (select 1 from public.students s where s.id = v_msid and s.classroom_id = p_classroom and s.transferred_at is null
                     and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')) then
        raise exception '우리 반 학생이 아닌 구성원이 있어요' using errcode = 'P7T04';
      end if;
      if exists (select 1 from jsonb_array_elements(v_mlist) m where (m->>'student_id')::integer = v_msid) then
        continue;
      end if;
      v_mlist := v_mlist || jsonb_build_array(jsonb_build_object(
        'student_id', v_msid,
        'label', left(btrim(coalesce(v_member->>'label', '')), 40)));
    end loop;
    v_keys := v_keys || v_key;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'type', v_type, 'label', v_label, 'color', v_color,
      'student_id', v_sid, 'guild_id', v_gid, 'members', v_mlist)));
  end loop;
  return v_out;
end
$fn$;

create or replace function brand_toolbox.normalize_eligible(p_classroom integer, p_ids jsonb)
returns integer[] language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_ids integer[];
begin
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then
    raise exception '참여 대상 형식이 올바르지 않아요' using errcode = 'P7T04';
  end if;
  select coalesce(array_agg(distinct s.id order by s.id), '{}') into v_ids
  from jsonb_array_elements_text(p_ids) x
  join public.students s on s.id = x.value::integer
  where s.classroom_id = p_classroom and s.transferred_at is null
    and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST');
  if cardinality(v_ids) <> (select count(distinct value) from jsonb_array_elements_text(p_ids)) then
    raise exception '우리 반 학생이 아닌 참여 대상이 있어요' using errcode = 'P7T04';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception '참여 대상을 한 명 이상 골라 주세요' using errcode = 'P7T04';
  end if;
  return v_ids;
end
$fn$;

-- 버저: 학생이 누를 수 있는 참가 단위
create or replace function brand_toolbox.buzzer_unit_for(p_row public.toolbox_activities, p_student integer)
returns text language sql stable set search_path = public, pg_temp
as $fn$
  select u->>'key'
  from jsonb_array_elements(p_row.participants) u
  where case
    when coalesce(p_row.config->>'mode', 'INDIVIDUAL') = 'INDIVIDUAL'
      then (u->>'student_id')::integer = p_student
    when coalesce(p_row.config->>'team_press', 'ANY') = 'REP'
      then (p_row.config->'reps'->>(u->>'key'))::integer = p_student
    else exists (select 1 from jsonb_array_elements(u->'members') m where (m->>'student_id')::integer = p_student)
  end
  limit 1
$fn$;

-- 점수판: 이벤트로부터 점수 다시 계산
create or replace function brand_toolbox.recompute_scores(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_scores jsonb;
begin
  select coalesce(jsonb_object_agg(u->>'key', coalesce(t.total, 0)), '{}'::jsonb) into v_scores
  from public.toolbox_activities a
  cross join lateral jsonb_array_elements(a.participants) u
  left join (
    select e.unit_key, sum(e.delta)::bigint total from public.toolbox_score_events e
    where e.activity_id = p_id and e.undone_at is null group by e.unit_key
  ) t on t.unit_key = u->>'key'
  where a.id = p_id;
  update public.toolbox_activities set state = jsonb_set(state, '{scores}', v_scores), rev = rev + 1, updated_at = now()
  where id = p_id;
  return v_scores;
end
$fn$;

create or replace function brand_toolbox.score_add(p_board bigint, p_unit text, p_delta integer, p_source text, p_detail jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_id bigint;
begin
  insert into public.toolbox_score_events (activity_id, unit_key, delta, source, detail, created_by)
  values (p_board, p_unit, p_delta, p_source, coalesce(p_detail, '{}'::jsonb), auth.uid())
  returning id into v_id;
  update public.toolbox_score_events set batch_id = v_id where id = v_id;
  perform brand_toolbox.recompute_scores(p_board);
  return v_id;
end
$fn$;

-- 대진표: 경기 목록 / 양쪽 참가자 / 승자 계산
create or replace function brand_toolbox.bracket_rounds(p_state jsonb)
returns integer language sql immutable
as $fn$ select round(ln(jsonb_array_length(p_state->'slots')) / ln(2))::integer $fn$;

create or replace function brand_toolbox.bracket_winner(p_state jsonb, p_match text)
returns text language plpgsql stable set search_path = public, pg_temp
as $fn$
declare v_sides text[] := brand_toolbox.bracket_sides(p_state, p_match); v_w text;
begin
  if p_match like 'R1-%' then
    if v_sides[1] is null and v_sides[2] is not null then return v_sides[2]; end if;
    if v_sides[2] is null and v_sides[1] is not null then return v_sides[1]; end if;
  end if;
  if v_sides[1] is null or v_sides[2] is null then return null; end if;
  v_w := p_state->'results'->p_match->>'winner';
  if v_w is not null and v_w in (v_sides[1], v_sides[2]) then return v_w; end if;
  return null;
end
$fn$;

create or replace function brand_toolbox.bracket_sides(p_state jsonb, p_match text)
returns text[] language plpgsql stable set search_path = public, pg_temp
as $fn$
declare v_round integer; v_idx integer; v_rounds integer := brand_toolbox.bracket_rounds(p_state);
  a text; b text; w1 text; w2 text; s1 text[]; s2 text[];
begin
  if p_match = 'T' then
    if v_rounds < 2 then return array[null, null]::text[]; end if;
    s1 := brand_toolbox.bracket_sides(p_state, 'R' || (v_rounds - 1) || '-1');
    s2 := brand_toolbox.bracket_sides(p_state, 'R' || (v_rounds - 1) || '-2');
    w1 := brand_toolbox.bracket_winner(p_state, 'R' || (v_rounds - 1) || '-1');
    w2 := brand_toolbox.bracket_winner(p_state, 'R' || (v_rounds - 1) || '-2');
    a := case when w1 is null or s1[1] is null or s1[2] is null then null when w1 = s1[1] then s1[2] else s1[1] end;
    b := case when w2 is null or s2[1] is null or s2[2] is null then null when w2 = s2[1] then s2[2] else s2[1] end;
    return array[a, b];
  end if;
  v_round := split_part(substr(p_match, 2), '-', 1)::integer;
  v_idx := split_part(p_match, '-', 2)::integer;
  if v_round = 1 then
    return array[p_state->'slots'->>(2 * v_idx - 2), p_state->'slots'->>(2 * v_idx - 1)];
  end if;
  return array[
    brand_toolbox.bracket_winner(p_state, 'R' || (v_round - 1) || '-' || (2 * v_idx - 1)),
    brand_toolbox.bracket_winner(p_state, 'R' || (v_round - 1) || '-' || (2 * v_idx))];
end
$fn$;

create or replace function brand_toolbox.bracket_matches(p_state jsonb)
returns setof text language plpgsql stable set search_path = public, pg_temp
as $fn$
declare v_rounds integer := brand_toolbox.bracket_rounds(p_state); r integer; i integer;
begin
  for r in 1..v_rounds loop
    for i in 1..(jsonb_array_length(p_state->'slots') / (2 ^ r)::integer) loop
      return next 'R' || r || '-' || i;
    end loop;
  end loop;
  if coalesce((p_state->>'third_place')::boolean, false) and v_rounds >= 2 then
    return next 'T';
  end if;
end
$fn$;

-- 결과 변경 뒤, 참가자가 바뀐 후속 경기 결과를 지운다.
create or replace function brand_toolbox.bracket_apply(p_before jsonb, p_after jsonb)
returns jsonb language plpgsql stable set search_path = public, pg_temp
as $fn$
declare v_state jsonb := p_after; m text; v_old text[]; v_new text[];
begin
  for m in select * from brand_toolbox.bracket_matches(p_after) loop
    if m like 'R1-%' then continue; end if;
    v_old := brand_toolbox.bracket_sides(p_before, m);
    v_new := brand_toolbox.bracket_sides(v_state, m);
    if v_old is distinct from v_new and (v_state->'results') ? m then
      v_state := jsonb_set(v_state, '{results}', (v_state->'results') - m);
    end if;
  end loop;
  return v_state;
end
$fn$;

-- 투표 집계
create or replace function brand_toolbox.vote_tally(p_row public.toolbox_activities)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_counts jsonb; v_valid integer; v_abstain integer; v_invalid integer; v_choosers integer;
begin
  select coalesce(jsonb_object_agg(o->>'key', coalesce(c.n, 0)), '{}'::jsonb) into v_counts
  from jsonb_array_elements(p_row.config->'options') o
  left join (
    select x.value as k, count(*) n
    from public.toolbox_vote_ballots b cross join lateral jsonb_array_elements_text(b.choices) x
    where b.activity_id = p_row.id and b.invalidated_at is null
    group by x.value
  ) c on c.k = o->>'key';
  select count(*) filter (where invalidated_at is null),
         count(*) filter (where invalidated_at is null and choices ? 'ABSTAIN'),
         count(*) filter (where invalidated_at is not null),
         count(*) filter (where invalidated_at is null and not (choices ? 'ABSTAIN'))
    into v_valid, v_abstain, v_invalid, v_choosers
  from public.toolbox_vote_ballots where activity_id = p_row.id;
  return jsonb_build_object(
    'counts', v_counts, 'submitted', v_valid, 'abstain', v_abstain, 'invalidated', v_invalid,
    'choosers', v_choosers, 'eligible', cardinality(p_row.eligible_student_ids),
    'not_voted', greatest(cardinality(p_row.eligible_student_ids) - v_valid - v_invalid, 0));
end
$fn$;

-- 시간 지정 마감이 지난 투표를 닫는다(읽을 때 지연 처리).
create or replace function brand_toolbox.vote_autoclose(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer;
begin
  update public.toolbox_activities
  set status = 'CLOSED', closed_at = now(), rev = rev + 1, updated_at = now()
  where id = p_id and kind = 'VOTE' and status = 'OPEN'
    and (config->>'close_at') is not null and (config->>'close_at')::timestamptz <= now()
  returning classroom_id into v_classroom;
  if v_classroom is not null then
    perform brand_toolbox.bump(v_classroom, true, jsonb_build_object('activity_id', p_id, 'kind', 'VOTE', 'event', 'CLOSED'));
  end if;
end
$fn$;

create or replace function brand_toolbox.student_names(p_ids integer[])
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $fn$
  select coalesce(jsonb_object_agg(s.id::text, jsonb_build_object('name', s.name, 'brand_name', s.brand_name)), '{}'::jsonb)
  from public.students s where s.id = any(p_ids)
$fn$;

create or replace function brand_toolbox.activity_summary(p_row public.toolbox_activities)
returns jsonb language sql stable set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'id', p_row.id, 'kind', p_row.kind, 'title', p_row.title, 'status', p_row.status,
    'share_to_students', p_row.share_to_students, 'created_at', p_row.created_at,
    'updated_at', p_row.updated_at, 'opened_at', p_row.opened_at, 'closed_at', p_row.closed_at,
    'ended_at', p_row.ended_at, 'unit_count', jsonb_array_length(p_row.participants),
    'eligible_count', cardinality(p_row.eligible_student_ids))
$fn$;

-- ---------------------------------------------------------------------
-- 4. Teacher RPCs
-- ---------------------------------------------------------------------
create or replace function public.teacher_toolbox_hub()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer := brand_toolbox.teacher_classroom(); v_cleaned integer; v_live jsonb; v_records jsonb;
begin
  -- 7일 넘게 방치된 학급 활동(기록 대상 제외)은 정리한다.
  with gone as (
    delete from public.toolbox_activities
    where classroom_id = v_classroom and kind in ('BUZZER','TOURNAMENT','CARDS')
      and updated_at < now() - interval '7 days'
    returning 1
  ) select count(*) into v_cleaned from gone;
  if v_cleaned > 0 then perform brand_toolbox.bump(v_classroom, true, '{"event":"CLEANUP"}'::jsonb); end if;

  select coalesce(jsonb_agg(brand_toolbox.activity_summary(a) order by a.created_at desc), '[]'::jsonb) into v_live
  from public.toolbox_activities a where a.classroom_id = v_classroom and a.status <> 'ENDED';
  select coalesce(jsonb_agg(brand_toolbox.activity_summary(a) order by a.ended_at desc), '[]'::jsonb) into v_records
  from (select * from public.toolbox_activities where classroom_id = v_classroom and status = 'ENDED'
        order by ended_at desc limit 100) a;
  return jsonb_build_object('classroom_id', v_classroom, 'live', v_live, 'records', v_records, 'cleaned', v_cleaned, 'server_now', now());
end
$fn$;

create or replace function public.teacher_toolbox_create(
  p_kind text, p_title text, p_config jsonb, p_participants jsonb, p_open boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_classroom integer := brand_toolbox.teacher_classroom();
  v_kind text := upper(coalesce(p_kind, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_cfg jsonb := coalesce(p_config, '{}'::jsonb);
  v_units jsonb := '[]'::jsonb; v_state jsonb := '{}'::jsonb; v_out_cfg jsonb := '{}'::jsonb;
  v_eligible integer[] := '{}'; v_id bigint; v_unit jsonb; v_keys text[]; v_slots jsonb; v_n integer;
  v_opt jsonb; v_options jsonb := '[]'::jsonb; v_labels text[] := '{}'; v_label text; v_sid integer;
  v_mode text; v_max integer; v_seats integer; v_board public.toolbox_activities; v_i integer;
begin
  if v_kind not in ('BUZZER','SCOREBOARD','TOURNAMENT','VOTE','CARDS') then
    raise exception '알 수 없는 도구예요' using errcode = 'P7T04';
  end if;
  if v_title = '' or char_length(v_title) > 60 then
    raise exception '활동 제목은 1~60자여야 해요' using errcode = 'P7T04';
  end if;

  if v_kind in ('BUZZER','SCOREBOARD','TOURNAMENT') then
    v_units := brand_toolbox.normalize_units(v_classroom, p_participants);
    select coalesce(array_agg(u->>'key'), '{}') into v_keys from jsonb_array_elements(v_units) u;
    if jsonb_array_length(v_units) < (case when v_kind = 'TOURNAMENT' then 2 else 1 end) then
      raise exception '참가자가 부족해요' using errcode = 'P7T04';
    end if;
  end if;

  if v_kind = 'SCOREBOARD' then
    v_out_cfg := jsonb_build_object('sort', case when v_cfg->>'sort' = 'SCORE' then 'SCORE' else 'FIXED' end);
    select jsonb_object_agg(k, 0) into v_state from unnest(v_keys) k;
    v_state := jsonb_build_object('scores', v_state);

  elsif v_kind = 'BUZZER' then
    v_mode := case when v_cfg->>'mode' = 'TEAM' then 'TEAM' else 'INDIVIDUAL' end;
    v_out_cfg := jsonb_build_object(
      'mode', v_mode,
      'team_press', case when v_cfg->>'team_press' = 'REP' then 'REP' else 'ANY' end,
      'close_on_first', coalesce((v_cfg->>'close_on_first')::boolean, false),
      'show_false_starts', coalesce((v_cfg->>'show_false_starts')::boolean, false),
      'reps', '{}'::jsonb);
    for v_unit in select value from jsonb_array_elements(v_units) loop
      if v_mode = 'INDIVIDUAL' then
        if v_unit->>'student_id' is null then
          raise exception '개인전 버저는 학생 계정이 연결된 참가자만 넣을 수 있어요' using errcode = 'P7T04';
        end if;
        v_eligible := v_eligible || (v_unit->>'student_id')::integer;
      else
        if jsonb_array_length(coalesce(v_unit->'members', '[]'::jsonb)) = 0 then
          raise exception '「%」 팀에 학생 계정이 연결된 구성원이 없어요', v_unit->>'label' using errcode = 'P7T04';
        end if;
        select v_eligible || coalesce(array_agg((m->>'student_id')::integer), '{}') into v_eligible
        from jsonb_array_elements(v_unit->'members') m;
        if v_out_cfg->>'team_press' = 'REP' then
          v_sid := (v_cfg->'reps'->>(v_unit->>'key'))::integer;
          if v_sid is null or not exists (select 1 from jsonb_array_elements(v_unit->'members') m where (m->>'student_id')::integer = v_sid) then
            raise exception '「%」 팀의 대표를 구성원 중에서 정해 주세요', v_unit->>'label' using errcode = 'P7T04';
          end if;
          v_out_cfg := jsonb_set(v_out_cfg, array['reps', v_unit->>'key'], to_jsonb(v_sid));
        end if;
      end if;
    end loop;
    if cardinality(v_eligible) <> cardinality(array(select distinct x from unnest(v_eligible) x)) then
      raise exception '한 학생이 두 참가 단위에 들어 있어요' using errcode = 'P7T04';
    end if;
    if (v_cfg->>'scoreboard_id') is not null then
      select * into v_board from public.toolbox_activities
      where id = (v_cfg->>'scoreboard_id')::bigint and classroom_id = v_classroom and kind = 'SCOREBOARD' and status <> 'ENDED';
      if v_board.id is null then
        raise exception '연결할 점수판을 찾을 수 없어요' using errcode = 'P7T02';
      end if;
      if (select array_agg(x order by x) from unnest(v_keys) x) is distinct from
         (select array_agg(u->>'key' order by u->>'key') from jsonb_array_elements(v_board.participants) u) then
        raise exception '버저와 점수판의 참가자 구성이 달라요' using errcode = 'P7T04';
      end if;
      v_out_cfg := v_out_cfg || jsonb_build_object('scoreboard_id', v_board.id);
    end if;
    v_n := coalesce((v_cfg->>'points')::integer, 10);
    if v_n < 1 or v_n > 100000 then v_n := 10; end if;
    v_state := jsonb_build_object('round_no', 0, 'round_status', 'IDLE', 'points', v_n, 'judgments', '[]'::jsonb);

  elsif v_kind = 'TOURNAMENT' then
    v_slots := v_cfg->'slots';
    if v_slots is null or jsonb_typeof(v_slots) <> 'array' then
      raise exception '대진 배치가 비어 있어요' using errcode = 'P7T04';
    end if;
    v_n := jsonb_array_length(v_slots);
    if v_n < 2 or v_n > 64 or (v_n & (v_n - 1)) <> 0 then
      raise exception '대진 칸 수가 올바르지 않아요' using errcode = 'P7T04';
    end if;
    if (select array_agg(x order by x) from jsonb_array_elements_text(v_slots) x where x is not null) is distinct from
       (select array_agg(x order by x) from unnest(v_keys) x) then
      raise exception '모든 참가자가 대진에 한 번씩 들어가야 해요' using errcode = 'P7T04';
    end if;
    if v_n < cardinality(v_keys) or v_n / 2 >= cardinality(v_keys) then
      raise exception '대진 칸 수가 참가자 수와 맞지 않아요' using errcode = 'P7T04';
    end if;
    for v_i in 0..(v_n / 2 - 1) loop
      if jsonb_typeof(v_slots->(2 * v_i)) = 'null' and jsonb_typeof(v_slots->(2 * v_i + 1)) = 'null' then
        raise exception '빈 칸끼리 맞붙는 경기가 있어요' using errcode = 'P7T04';
      end if;
    end loop;
    v_out_cfg := jsonb_build_object('third_place', coalesce((v_cfg->>'third_place')::boolean, false));
    v_state := jsonb_build_object('slots', v_slots, 'third_place', v_out_cfg->'third_place',
                                  'results', '{}'::jsonb, 'revealed_at', null);

  elsif v_kind = 'VOTE' then
    v_eligible := brand_toolbox.normalize_eligible(v_classroom, v_cfg->'eligible');
    v_mode := upper(coalesce(v_cfg->>'mode', ''));
    if v_mode not in ('YESNO','MULTI','CANDIDATE') then
      raise exception '투표 방식을 골라 주세요' using errcode = 'P7T04';
    end if;
    if v_mode = 'YESNO' then
      v_options := '[{"key":"YES","label":"찬성"},{"key":"NO","label":"반대"}]'::jsonb;
    else
      if jsonb_typeof(coalesce(v_cfg->'options', 'null'::jsonb)) <> 'array' then
        raise exception '선택지를 넣어 주세요' using errcode = 'P7T04';
      end if;
      v_n := 0;
      for v_opt in select value from jsonb_array_elements(v_cfg->'options') loop
        v_n := v_n + 1;
        if v_mode = 'CANDIDATE' then
          v_sid := (v_opt->>'student_id')::integer;
          select s.name into v_label from public.students s
          where s.id = v_sid and s.classroom_id = v_classroom and s.transferred_at is null
            and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST');
          if v_label is null then
            raise exception '후보는 우리 반 학생 중에서 골라 주세요' using errcode = 'P7T04';
          end if;
          if exists (select 1 from jsonb_array_elements(v_options) o where (o->>'student_id')::integer = v_sid) then
            raise exception '같은 후보를 두 번 넣을 수 없어요' using errcode = 'P7T04';
          end if;
          v_options := v_options || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'key', 'S' || v_sid, 'label', v_label, 'student_id', v_sid,
            'desc', nullif(left(btrim(coalesce(v_opt->>'desc', '')), 80), ''))));
        else
          v_label := btrim(coalesce(v_opt->>'label', ''));
          if v_label = '' or char_length(v_label) > 40 then
            raise exception '선택지 문구는 1~40자여야 해요' using errcode = 'P7T04';
          end if;
          if lower(v_label) = any(v_labels) then
            raise exception '같은 선택지를 두 번 넣을 수 없어요' using errcode = 'P7T04';
          end if;
          v_labels := v_labels || lower(v_label);
          v_options := v_options || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'key', 'O' || v_n, 'label', v_label,
            'desc', nullif(left(btrim(coalesce(v_opt->>'desc', '')), 80), ''))));
        end if;
      end loop;
      if jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 12 then
        raise exception '선택지는 2~12개여야 해요' using errcode = 'P7T04';
      end if;
    end if;
    v_max := case when v_mode = 'YESNO' then 1 else coalesce((v_cfg->>'max_choices')::integer, 1) end;
    if v_max < 1 or v_max > jsonb_array_length(v_options) then
      raise exception '고를 수 있는 개수가 선택지 수보다 많아요' using errcode = 'P7T04';
    end if;
    v_seats := case when v_mode = 'CANDIDATE' then coalesce((v_cfg->>'seats')::integer, 1) else 1 end;
    if v_seats < 1 or v_seats > jsonb_array_length(v_options) then
      raise exception '선출 인원이 후보 수보다 많아요' using errcode = 'P7T04';
    end if;
    if (v_cfg->>'close_at') is not null and (v_cfg->>'close_at')::timestamptz <= now() then
      raise exception '마감 시각은 지금보다 뒤여야 해요' using errcode = 'P7T04';
    end if;
    v_out_cfg := jsonb_strip_nulls(jsonb_build_object(
      'mode', v_mode, 'options', v_options,
      'description', nullif(left(btrim(coalesce(v_cfg->>'description', '')), 300), ''),
      'position', nullif(left(btrim(coalesce(v_cfg->>'position', '')), 40), ''),
      'allow_abstain', coalesce((v_cfg->>'allow_abstain')::boolean, v_mode = 'CANDIDATE'),
      'max_choices', v_max, 'seats', v_seats,
      'anonymous', coalesce((v_cfg->>'anonymous')::boolean, true),
      'reveal', case when v_cfg->>'reveal' = 'LIVE' then 'LIVE' else 'AFTER_CLOSE' end,
      'close_at', v_cfg->'close_at',
      'shuffle', coalesce((v_cfg->>'shuffle')::boolean, false),
      'judge', case when v_mode = 'YESNO' and coalesce((v_cfg->'judge'->>'enabled')::boolean, false) then
        jsonb_build_object('rule', case when v_cfg->'judge'->>'rule' = 'ABSOLUTE' then 'ABSOLUTE' else 'MAJORITY' end,
                           'threshold', greatest(1, coalesce((v_cfg->'judge'->>'threshold')::integer, 1)))
        else null end,
      'runoff_of', (v_cfg->>'runoff_of')::bigint,
      'confirmed', case when jsonb_typeof(v_cfg->'confirmed') = 'array' then v_cfg->'confirmed' else null end));
    v_state := jsonb_build_object('revealed', false, 'reveal_names', false, 'decision_note', null);

  elsif v_kind = 'CARDS' then
    v_eligible := brand_toolbox.normalize_eligible(v_classroom, v_cfg->'eligible');
    v_out_cfg := jsonb_build_object(
      'prompt', nullif(left(btrim(coalesce(v_cfg->>'prompt', '')), 200), ''),
      'show_author', coalesce((v_cfg->>'show_author')::boolean, true));
    v_state := jsonb_build_object('submission_open', true, 'spotlight', null);
  end if;

  insert into public.toolbox_activities (classroom_id, kind, title, status, config, participants, eligible_student_ids,
    state, share_to_students, created_by, opened_at)
  values (v_classroom, v_kind, v_title, case when p_open then 'OPEN' else 'READY' end, v_out_cfg, v_units, v_eligible,
    v_state, coalesce((v_cfg->>'share_to_students')::boolean, true), auth.uid(), case when p_open then now() end)
  returning id into v_id;

  perform brand_toolbox.bump(v_classroom, p_open, jsonb_build_object('activity_id', v_id, 'kind', v_kind, 'event', 'CREATED'));
  return jsonb_build_object('id', v_id);
end
$fn$;

create or replace function public.teacher_toolbox_set_status(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true); v_to text := upper(coalesce(p_status, ''));
begin
  if v_to not in ('OPEN','CLOSED','ENDED') then
    raise exception '바꿀 수 없는 상태예요' using errcode = 'P7T04';
  end if;
  if v_row.status = 'ENDED' then
    raise exception '이미 끝난 활동이에요' using errcode = 'P7T03';
  end if;
  if v_to = 'OPEN' and v_row.status <> 'READY' then
    if v_row.status = 'OPEN' then return jsonb_build_object('id', p_id, 'status', 'OPEN'); end if;
    raise exception '마감한 투표는 다시 열 수 없어요. 새 회차로 만들어 주세요' using errcode = 'P7T03';
  end if;
  if v_to = 'CLOSED' and v_row.kind <> 'VOTE' then
    raise exception '마감은 투표에만 쓸 수 있어요' using errcode = 'P7T04';
  end if;
  if v_to = 'CLOSED' and v_row.status <> 'OPEN' then
    raise exception '진행 중인 투표만 마감할 수 있어요' using errcode = 'P7T03';
  end if;

  if v_to = 'ENDED' and v_row.kind in ('BUZZER','TOURNAMENT','CARDS') then
    delete from public.toolbox_activities where id = p_id;
    perform brand_toolbox.bump(v_row.classroom_id, true, jsonb_build_object('activity_id', p_id, 'kind', v_row.kind, 'event', 'REMOVED'));
    return jsonb_build_object('id', p_id, 'status', 'REMOVED');
  end if;

  update public.toolbox_activities set
    status = v_to, rev = rev + 1, updated_at = now(),
    opened_at = case when v_to = 'OPEN' then now() else opened_at end,
    closed_at = case when v_to = 'CLOSED' or (v_to = 'ENDED' and closed_at is null) then now() else closed_at end,
    ended_at = case when v_to = 'ENDED' then now() else ended_at end
  where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, true, jsonb_build_object('activity_id', p_id, 'kind', v_row.kind, 'event', v_to));
  return jsonb_build_object('id', p_id, 'status', v_to);
end
$fn$;

create or replace function public.teacher_toolbox_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
begin
  delete from public.toolbox_activities where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, true, jsonb_build_object('activity_id', p_id, 'kind', v_row.kind, 'event', 'REMOVED'));
  return jsonb_build_object('id', p_id, 'deleted', true);
end
$fn$;

create or replace function public.teacher_toolbox_rename(p_id bigint, p_title text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true); v_title text := btrim(coalesce(p_title, ''));
begin
  if v_title = '' or char_length(v_title) > 60 then
    raise exception '활동 제목은 1~60자여야 해요' using errcode = 'P7T04';
  end if;
  update public.toolbox_activities set title = v_title, rev = rev + 1, updated_at = now() where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, v_row.status in ('OPEN','CLOSED'), jsonb_build_object('activity_id', p_id, 'kind', v_row.kind, 'event', 'RENAMED'));
  return jsonb_build_object('id', p_id, 'title', v_title);
end
$fn$;

-- 교사 운영 화면 전체 상태
create or replace function public.teacher_toolbox_state(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_row public.toolbox_activities; v_extra jsonb := '{}'::jsonb; v_board public.toolbox_activities; v_round integer;
begin
  v_row := brand_toolbox.teacher_activity(p_id, false);
  if v_row.kind = 'VOTE' then
    perform brand_toolbox.vote_autoclose(p_id);
    v_row := brand_toolbox.teacher_activity(p_id, false);
  end if;

  if v_row.kind = 'BUZZER' then
    v_round := coalesce((v_row.state->>'round_no')::integer, 0);
    v_extra := jsonb_build_object(
      'presses', (select coalesce(jsonb_agg(jsonb_build_object(
          'unit_key', p.unit_key, 'student_id', p.student_id, 'rank', p.rank, 'pressed_at', p.pressed_at,
          'student_name', s.name, 'brand_name', s.brand_name) order by p.rank), '[]'::jsonb)
        from public.toolbox_buzzer_presses p join public.students s on s.id = p.student_id
        where p.activity_id = p_id and p.round_no = v_round),
      'false_starts', (select coalesce(jsonb_agg(jsonb_build_object(
          'student_id', l.student_id, 'student_name', s.name, 'locked_until', l.locked_until,
          'pressed_at', l.pressed_at, 'round_no', l.round_no) order by l.pressed_at desc), '[]'::jsonb)
        from public.toolbox_buzzer_locks l join public.students s on s.id = l.student_id
        where l.activity_id = p_id and l.round_no >= v_round),
      'scoreboard', null);
    if (v_row.config->>'scoreboard_id') is not null then
      select * into v_board from public.toolbox_activities where id = (v_row.config->>'scoreboard_id')::bigint;
      if v_board.id is not null then
        v_extra := jsonb_set(v_extra, '{scoreboard}', jsonb_build_object(
          'id', v_board.id, 'title', v_board.title, 'status', v_board.status, 'scores', v_board.state->'scores'));
      end if;
    end if;
  elsif v_row.kind = 'SCOREBOARD' then
    v_extra := jsonb_build_object('events', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'batch_id', e.batch_id, 'unit_key', e.unit_key, 'delta', e.delta, 'source', e.source,
        'detail', e.detail, 'undone_at', e.undone_at, 'created_at', e.created_at) order by e.id desc), '[]'::jsonb)
      from (select * from public.toolbox_score_events where activity_id = p_id order by id desc limit 200) e));
  elsif v_row.kind = 'VOTE' then
    v_extra := jsonb_build_object('tally', brand_toolbox.vote_tally(v_row),
      'not_voted', (select coalesce(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.name, 'brand_name', s.brand_name) order by s.name), '[]'::jsonb)
        from public.students s where s.id = any(v_row.eligible_student_ids)
          and not exists (select 1 from public.toolbox_vote_ballots b where b.activity_id = p_id and b.student_id = s.id)),
      'eligible_names', brand_toolbox.student_names(v_row.eligible_student_ids));
  elsif v_row.kind = 'CARDS' then
    v_extra := jsonb_build_object(
      'cards', (select coalesce(jsonb_agg(jsonb_build_object(
          'student_id', c.student_id, 'name', s.name, 'brand_name', s.brand_name, 'title', c.title, 'body', c.body,
          'revision', c.revision, 'hidden', c.hidden, 'presented', c.presented,
          'created_at', c.created_at, 'updated_at', c.updated_at) order by c.created_at), '[]'::jsonb)
        from public.toolbox_cards c join public.students s on s.id = c.student_id where c.activity_id = p_id),
      'not_submitted', (select coalesce(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.name, 'brand_name', s.brand_name) order by s.name), '[]'::jsonb)
        from public.students s where s.id = any(v_row.eligible_student_ids)
          and not exists (select 1 from public.toolbox_cards c where c.activity_id = p_id and c.student_id = s.id)));
  end if;

  return brand_toolbox.activity_summary(v_row) || jsonb_build_object(
    'config', v_row.config, 'participants', v_row.participants, 'state', v_row.state, 'rev', v_row.rev,
    'eligible_student_ids', to_jsonb(v_row.eligible_student_ids), 'server_now', clock_timestamp()) || v_extra;
end
$fn$;

-- 버저 진행
create or replace function public.teacher_toolbox_buzzer(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
  v_action text := upper(coalesce(p_action, '')); v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_state jsonb := v_row.state; v_round integer := coalesce((v_row.state->>'round_no')::integer, 0);
  v_points integer; v_unit text; v_press record; v_board public.toolbox_activities; v_event bigint;
  v_judgments jsonb; v_j jsonb; v_live_correct integer; v_student_visible boolean := false;
begin
  if v_row.kind <> 'BUZZER' then raise exception '버저 활동이 아니에요' using errcode = 'P7T04'; end if;
  if v_row.status <> 'OPEN' then raise exception '활동을 먼저 시작해 주세요' using errcode = 'P7T03'; end if;

  if v_action = 'SET_POINTS' then
    v_points := (v_args->>'points')::integer;
    if v_points is null or v_points < 1 or v_points > 100000 then
      raise exception '배점은 1 이상 100000 이하로 넣어 주세요' using errcode = 'P7T04';
    end if;
    v_state := jsonb_set(v_state, '{points}', to_jsonb(v_points));

  elsif v_action = 'OPEN_ROUND' then
    if v_state->>'round_status' = 'OPEN' then raise exception '이미 라운드가 열려 있어요' using errcode = 'P7T05'; end if;
    v_points := coalesce((v_args->>'points')::integer, (v_state->>'points')::integer, 10);
    if v_points < 1 or v_points > 100000 then
      raise exception '배점은 1 이상 100000 이하로 넣어 주세요' using errcode = 'P7T04';
    end if;
    v_state := v_state || jsonb_build_object('round_no', v_round + 1, 'round_status', 'OPEN',
      'opened_at', clock_timestamp(), 'points', v_points, 'judgments', '[]'::jsonb);
    v_student_visible := true;

  elsif v_action = 'CLOSE_ROUND' then
    if v_state->>'round_status' <> 'OPEN' then raise exception '열린 라운드가 없어요' using errcode = 'P7T03'; end if;
    v_state := v_state || jsonb_build_object('round_status', 'CLOSED', 'closed_at', clock_timestamp());
    v_student_visible := true;

  elsif v_action in ('JUDGE', 'UNJUDGE') then
    if v_round = 0 then raise exception '아직 진행한 라운드가 없어요' using errcode = 'P7T03'; end if;
    v_unit := v_args->>'unit_key';
    select * into v_press from public.toolbox_buzzer_presses where activity_id = p_id and round_no = v_round and unit_key = v_unit;
    if v_press.unit_key is null then raise exception '이번 라운드에 누르지 않은 참가자예요' using errcode = 'P7T02'; end if;
    if (v_row.config->>'scoreboard_id') is not null then
      select * into v_board from public.toolbox_activities where id = (v_row.config->>'scoreboard_id')::bigint for update;
    end if;
    v_judgments := coalesce(v_state->'judgments', '[]'::jsonb);

    -- 점수판에서 취소된 정답은 '살아 있는 정답'에서 뺀다.
    select count(*) into v_live_correct from jsonb_array_elements(v_judgments) j
    where j->>'verdict' = 'CORRECT' and (
      j->>'score_event_id' is null or exists (select 1 from public.toolbox_score_events e
        where e.id = (j->>'score_event_id')::bigint and e.undone_at is null));

    if v_action = 'UNJUDGE' then
      for v_j in select value from jsonb_array_elements(v_judgments) loop
        if v_j->>'unit_key' = v_unit and (v_j->>'score_event_id') is not null then
          update public.toolbox_score_events set undone_at = now()
          where batch_id = (select batch_id from public.toolbox_score_events where id = (v_j->>'score_event_id')::bigint)
            and undone_at is null;
        end if;
      end loop;
      select coalesce(jsonb_agg(j), '[]'::jsonb) into v_judgments from jsonb_array_elements(v_judgments) j where j->>'unit_key' <> v_unit;
      if v_board.id is not null then perform brand_toolbox.recompute_scores(v_board.id); end if;
    else
      if exists (select 1 from jsonb_array_elements(v_judgments) j where j->>'unit_key' = v_unit and (
          j->>'verdict' = 'WRONG' or j->>'score_event_id' is null or exists (select 1 from public.toolbox_score_events e
            where e.id = (j->>'score_event_id')::bigint and e.undone_at is null))) then
        raise exception '이미 판정한 참가자예요. 판정 취소 후 다시 골라 주세요' using errcode = 'P7T05';
      end if;
      select coalesce(jsonb_agg(j), '[]'::jsonb) into v_judgments from jsonb_array_elements(v_judgments) j where j->>'unit_key' <> v_unit;
      if v_args->>'verdict' = 'CORRECT' then
        if v_live_correct > 0 and not coalesce((v_args->>'extra')::boolean, false) then
          raise exception '이번 문제는 이미 정답이 나왔어요. 공동 정답이면 추가 정답으로 골라 주세요' using errcode = 'P7T05';
        end if;
        v_points := coalesce((v_state->>'points')::integer, 10);
        v_event := null;
        if v_board.id is not null and v_board.status <> 'ENDED' then
          v_event := brand_toolbox.score_add(v_board.id, v_unit, v_points, 'BUZZER', jsonb_build_object(
            'buzzer_id', p_id, 'buzzer_title', v_row.title, 'round_no', v_round, 'points', v_points,
            'student_id', v_press.student_id,
            'student_name', (select name from public.students where id = v_press.student_id)));
        end if;
        v_judgments := v_judgments || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'unit_key', v_unit, 'verdict', 'CORRECT', 'points', v_points, 'score_event_id', v_event, 'at', clock_timestamp())));
      elsif v_args->>'verdict' = 'WRONG' then
        v_judgments := v_judgments || jsonb_build_array(jsonb_build_object('unit_key', v_unit, 'verdict', 'WRONG', 'at', clock_timestamp()));
      else
        raise exception '판정 값이 올바르지 않아요' using errcode = 'P7T04';
      end if;
    end if;
    v_state := jsonb_set(v_state, '{judgments}', v_judgments);
    v_student_visible := true;
  else
    raise exception '알 수 없는 버저 동작이에요' using errcode = 'P7T04';
  end if;

  update public.toolbox_activities set state = v_state, rev = rev + 1, updated_at = now() where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, v_student_visible, jsonb_build_object(
    'activity_id', p_id, 'kind', 'BUZZER', 'event', v_action,
    'round_no', v_state->'round_no', 'round_status', v_state->'round_status', 'opened_at', v_state->'opened_at'));
  return jsonb_build_object('id', p_id, 'state', v_state);
end
$fn$;

-- 점수판 조작
create or replace function public.teacher_toolbox_score(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
  v_action text := upper(coalesce(p_action, '')); v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_unit text := v_args->>'unit_key'; v_delta integer; v_current integer; v_batch bigint; v_k text; v_v integer;
  v_scores jsonb;
begin
  if v_row.kind <> 'SCOREBOARD' then raise exception '점수판이 아니에요' using errcode = 'P7T04'; end if;
  if v_row.status = 'ENDED' then raise exception '끝난 점수판은 바꿀 수 없어요' using errcode = 'P7T03'; end if;
  if v_action in ('ADD','SET') and not exists (select 1 from jsonb_array_elements(v_row.participants) u where u->>'key' = v_unit) then
    raise exception '점수판에 없는 팀이에요' using errcode = 'P7T02';
  end if;

  if v_action = 'ADD' then
    v_delta := (v_args->>'delta')::integer;
    if v_delta is null or v_delta = 0 or abs(v_delta) > 1000000 then
      raise exception '바꿀 점수를 넣어 주세요' using errcode = 'P7T04';
    end if;
    perform brand_toolbox.score_add(p_id, v_unit, v_delta, 'MANUAL', '{}'::jsonb);
  elsif v_action = 'SET' then
    v_current := coalesce((v_row.state->'scores'->>v_unit)::integer, 0);
    v_delta := (v_args->>'value')::integer - v_current;
    if (v_args->>'value') is null or abs((v_args->>'value')::bigint) > 100000000 then
      raise exception '점수 값을 넣어 주세요' using errcode = 'P7T04';
    end if;
    if v_delta <> 0 then
      perform brand_toolbox.score_add(p_id, v_unit, v_delta, 'SET', jsonb_build_object('from', v_current, 'to', (v_args->>'value')::integer));
    end if;
  elsif v_action = 'RESET' then
    v_batch := null;
    for v_k, v_v in select key, value::integer from jsonb_each_text(v_row.state->'scores') loop
      if v_v <> 0 then
        insert into public.toolbox_score_events (activity_id, batch_id, unit_key, delta, source, detail, created_by)
        values (p_id, v_batch, v_k, -v_v, 'RESET', '{}'::jsonb, auth.uid())
        returning coalesce(batch_id, id) into v_batch;
        update public.toolbox_score_events set batch_id = v_batch where activity_id = p_id and batch_id is null;
      end if;
    end loop;
    perform brand_toolbox.recompute_scores(p_id);
  elsif v_action in ('UNDO_LAST', 'UNDO') then
    if v_action = 'UNDO' then
      select batch_id into v_batch from public.toolbox_score_events where id = (v_args->>'event_id')::bigint and activity_id = p_id and undone_at is null;
    else
      select batch_id into v_batch from public.toolbox_score_events where activity_id = p_id and undone_at is null order by id desc limit 1;
    end if;
    if v_batch is null then raise exception '취소할 점수 변경이 없어요' using errcode = 'P7T05'; end if;
    update public.toolbox_score_events set undone_at = now() where activity_id = p_id and batch_id = v_batch;
    perform brand_toolbox.recompute_scores(p_id);
  elsif v_action = 'SET_SORT' then
    update public.toolbox_activities set config = jsonb_set(config, '{sort}', to_jsonb(case when v_args->>'sort' = 'SCORE' then 'SCORE' else 'FIXED' end)),
      rev = rev + 1, updated_at = now() where id = p_id;
  elsif v_action = 'SET_SHARE' then
    update public.toolbox_activities set share_to_students = coalesce((v_args->>'share')::boolean, true), rev = rev + 1, updated_at = now() where id = p_id;
  else
    raise exception '알 수 없는 점수판 동작이에요' using errcode = 'P7T04';
  end if;

  select state->'scores' into v_scores from public.toolbox_activities where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, true, jsonb_build_object('activity_id', p_id, 'kind', 'SCOREBOARD', 'event', v_action));
  return jsonb_build_object('id', p_id, 'scores', v_scores);
end
$fn$;

-- 대진표 진행
create or replace function public.teacher_toolbox_tournament(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
  v_action text := upper(coalesce(p_action, '')); v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_before jsonb := v_row.state; v_state jsonb := v_row.state; v_match text := v_args->>'match_id';
  v_sides text[]; v_winner text; v_result jsonb;
begin
  if v_row.kind <> 'TOURNAMENT' then raise exception '대진표가 아니에요' using errcode = 'P7T04'; end if;
  if v_row.status <> 'OPEN' then raise exception '대진표를 먼저 시작해 주세요' using errcode = 'P7T03'; end if;

  if v_action = 'REVEAL' then
    v_state := jsonb_set(v_state, '{revealed_at}', to_jsonb(clock_timestamp()));
  elsif v_action in ('SET_RESULT', 'CLEAR_RESULT', 'UPDATE_NOTE') then
    if v_match is null or v_match not in (select * from brand_toolbox.bracket_matches(v_state)) then
      raise exception '없는 경기예요' using errcode = 'P7T02';
    end if;
    v_sides := brand_toolbox.bracket_sides(v_state, v_match);
    if v_action = 'CLEAR_RESULT' then
      v_state := jsonb_set(v_state, '{results}', (v_state->'results') - v_match);
    else
      if v_sides[1] is null or v_sides[2] is null then
        raise exception '아직 두 참가자가 정해지지 않은 경기예요' using errcode = 'P7T03';
      end if;
      v_winner := case when v_action = 'SET_RESULT' then v_args->>'winner' else v_state->'results'->v_match->>'winner' end;
      if v_winner is null or v_winner not in (v_sides[1], v_sides[2]) then
        raise exception '승자는 이 경기의 두 참가자 중에서 골라 주세요' using errcode = 'P7T04';
      end if;
      v_result := jsonb_strip_nulls(jsonb_build_object(
        'winner', v_winner,
        'score_a', case when v_args ? 'score_a' then v_args->'score_a' else v_state->'results'->v_match->'score_a' end,
        'score_b', case when v_args ? 'score_b' then v_args->'score_b' else v_state->'results'->v_match->'score_b' end,
        'note', case when v_args ? 'note' then to_jsonb(nullif(left(btrim(coalesce(v_args->>'note', '')), 80), ''))
                     else v_state->'results'->v_match->'note' end,
        'note_public', case when v_args ? 'note_public' then v_args->'note_public' else v_state->'results'->v_match->'note_public' end));
      if jsonb_typeof(coalesce(v_result->'score_a', '0'::jsonb)) <> 'number' or jsonb_typeof(coalesce(v_result->'score_b', '0'::jsonb)) <> 'number' then
        raise exception '경기 점수는 숫자로 넣어 주세요' using errcode = 'P7T04';
      end if;
      v_state := jsonb_set(v_state, array['results', v_match], v_result);
    end if;
    v_state := brand_toolbox.bracket_apply(v_before, v_state);
  else
    raise exception '알 수 없는 대진표 동작이에요' using errcode = 'P7T04';
  end if;

  update public.toolbox_activities set state = v_state, rev = rev + 1, updated_at = now() where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, v_row.share_to_students, jsonb_build_object('activity_id', p_id, 'kind', 'TOURNAMENT', 'event', v_action, 'match_id', v_match));
  return jsonb_build_object('id', p_id, 'state', v_state);
end
$fn$;

-- 투표 진행
create or replace function public.teacher_toolbox_vote(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
  v_action text := upper(coalesce(p_action, '')); v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_state jsonb := v_row.state; v_sid integer := (v_args->>'student_id')::integer; v_reason text;
begin
  if v_row.kind <> 'VOTE' then raise exception '투표가 아니에요' using errcode = 'P7T04'; end if;
  if v_row.status = 'ENDED' then raise exception '이미 끝난 투표예요' using errcode = 'P7T03'; end if;

  if v_action = 'REVEAL' then
    if v_row.status <> 'CLOSED' and v_row.config->>'reveal' <> 'LIVE' then
      raise exception '마감한 뒤에 결과를 공개할 수 있어요' using errcode = 'P7T03';
    end if;
    v_state := jsonb_set(v_state, '{revealed}', 'true'::jsonb);
  elsif v_action = 'HIDE_RESULT' then
    v_state := jsonb_set(v_state, '{revealed}', 'false'::jsonb);
    v_state := jsonb_set(v_state, '{reveal_names}', 'false'::jsonb);
  elsif v_action = 'REVEAL_NAMES' then
    if coalesce((v_row.config->>'anonymous')::boolean, true) then
      raise exception '익명 투표는 개인별 선택을 공개할 수 없어요' using errcode = 'P7T03';
    end if;
    if not coalesce((v_state->>'revealed')::boolean, false) then
      raise exception '결과를 먼저 공개해 주세요' using errcode = 'P7T03';
    end if;
    v_state := jsonb_set(v_state, '{reveal_names}', to_jsonb(coalesce((v_args->>'on')::boolean, true)));
  elsif v_action in ('INVALIDATE', 'RESTORE') then
    if coalesce((v_state->>'revealed')::boolean, false) then
      raise exception '결과를 공개한 뒤에는 표를 정정할 수 없어요. 새 회차로 진행해 주세요' using errcode = 'P7T03';
    end if;
    if v_action = 'INVALIDATE' then
      v_reason := btrim(coalesce(v_args->>'reason', ''));
      if v_reason = '' or char_length(v_reason) > 200 then
        raise exception '무효 처리 사유를 1~200자로 적어 주세요' using errcode = 'P7T04';
      end if;
      update public.toolbox_vote_ballots set invalidated_at = now(), invalidated_reason = v_reason, invalidated_by = auth.uid()
      where activity_id = p_id and student_id = v_sid and invalidated_at is null;
    else
      update public.toolbox_vote_ballots set invalidated_at = null, invalidated_reason = null, invalidated_by = null
      where activity_id = p_id and student_id = v_sid and invalidated_at is not null;
    end if;
    if not found then raise exception '바꿀 표가 없어요' using errcode = 'P7T02'; end if;
  elsif v_action = 'DECISION_NOTE' then
    v_state := jsonb_set(v_state, '{decision_note}', to_jsonb(nullif(left(btrim(coalesce(v_args->>'note', '')), 300), '')));
  else
    raise exception '알 수 없는 투표 동작이에요' using errcode = 'P7T04';
  end if;

  update public.toolbox_activities set state = v_state, rev = rev + 1, updated_at = now() where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, v_action in ('REVEAL','HIDE_RESULT','REVEAL_NAMES'),
    jsonb_build_object('activity_id', p_id, 'kind', 'VOTE', 'event', v_action));
  return jsonb_build_object('id', p_id, 'state', v_state);
end
$fn$;

-- 학생별 투표 확인(교사 전용, 익명 투표 포함)
create or replace function public.teacher_toolbox_vote_ballots(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, false);
begin
  if v_row.kind <> 'VOTE' then raise exception '투표가 아니에요' using errcode = 'P7T04'; end if;
  return jsonb_build_object('id', p_id, 'ballots', (select coalesce(jsonb_agg(jsonb_build_object(
      'student_id', b.student_id, 'name', s.name, 'brand_name', s.brand_name, 'choices', b.choices,
      'revision', b.revision, 'submitted_at', b.submitted_at, 'updated_at', b.updated_at,
      'invalidated_at', b.invalidated_at, 'invalidated_reason', b.invalidated_reason) order by s.name), '[]'::jsonb)
    from public.toolbox_vote_ballots b join public.students s on s.id = b.student_id where b.activity_id = p_id));
end
$fn$;

-- 카드 구름 진행
create or replace function public.teacher_toolbox_cards(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
  v_action text := upper(coalesce(p_action, '')); v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_state jsonb := v_row.state; v_cfg jsonb := v_row.config; v_sid integer := (v_args->>'student_id')::integer;
  v_on boolean := coalesce((v_args->>'on')::boolean, true); v_student_visible boolean := false;
begin
  if v_row.kind <> 'CARDS' then raise exception '카드 구름이 아니에요' using errcode = 'P7T04'; end if;
  if v_row.status <> 'OPEN' then raise exception '활동을 먼저 시작해 주세요' using errcode = 'P7T03'; end if;

  if v_action = 'SET_SUBMISSION' then
    v_state := jsonb_set(v_state, '{submission_open}', to_jsonb(v_on));
    v_student_visible := true;
  elsif v_action = 'SET_SHOW_AUTHOR' then
    v_cfg := jsonb_set(v_cfg, '{show_author}', to_jsonb(v_on));
    v_student_visible := true;
  elsif v_action in ('HIDE', 'PRESENTED') then
    if v_action = 'HIDE' then
      update public.toolbox_cards set hidden = v_on where activity_id = p_id and student_id = v_sid;
    else
      update public.toolbox_cards set presented = v_on where activity_id = p_id and student_id = v_sid;
    end if;
    if not found then raise exception '카드를 찾을 수 없어요' using errcode = 'P7T02'; end if;
    if v_action = 'HIDE' and v_on and (v_state->>'spotlight')::integer = v_sid then
      v_state := jsonb_set(v_state, '{spotlight}', 'null'::jsonb);
    end if;
  elsif v_action = 'SPOTLIGHT' then
    if v_sid is not null and not exists (select 1 from public.toolbox_cards where activity_id = p_id and student_id = v_sid and not hidden) then
      raise exception '펼칠 수 없는 카드예요' using errcode = 'P7T02';
    end if;
    v_state := jsonb_set(v_state, '{spotlight}', coalesce(to_jsonb(v_sid), 'null'::jsonb));
  else
    raise exception '알 수 없는 카드 구름 동작이에요' using errcode = 'P7T04';
  end if;

  update public.toolbox_activities set state = v_state, config = v_cfg, rev = rev + 1, updated_at = now() where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, v_student_visible, jsonb_build_object('activity_id', p_id, 'kind', 'CARDS', 'event', v_action));
  return jsonb_build_object('id', p_id, 'state', v_state, 'config', v_cfg);
end
$fn$;

-- 저장 명단(최근 명단은 5개만 유지)
create or replace function public.teacher_toolbox_save_roster(p_name text, p_items jsonb, p_recent boolean default false, p_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_classroom integer := brand_toolbox.teacher_classroom(); v_name text := btrim(coalesce(p_name, '')); v_id bigint;
begin
  if v_name = '' or char_length(v_name) > 40 then raise exception '명단 이름은 1~40자여야 해요' using errcode = 'P7T04'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 80
     or pg_column_size(p_items) > 60000 then
    raise exception '명단 내용이 올바르지 않아요' using errcode = 'P7T04';
  end if;
  if p_id is not null then
    update public.toolbox_rosters set name = v_name, items = p_items, updated_at = now()
    where id = p_id and classroom_id = v_classroom and not is_recent returning id into v_id;
    if v_id is null then raise exception '명단을 찾을 수 없어요' using errcode = 'P7T02'; end if;
  else
    insert into public.toolbox_rosters (classroom_id, name, items, is_recent) values (v_classroom, v_name, p_items, coalesce(p_recent, false))
    returning id into v_id;
    if p_recent then
      delete from public.toolbox_rosters where classroom_id = v_classroom and is_recent and id not in (
        select id from public.toolbox_rosters where classroom_id = v_classroom and is_recent order by updated_at desc, id desc limit 5);
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end
$fn$;

-- ---------------------------------------------------------------------
-- 5. Broadcast RPC (교사 계정 · 교실 대형 화면용, 비공개 정보 제외)
-- ---------------------------------------------------------------------
create or replace function public.teacher_toolbox_broadcast(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_row public.toolbox_activities; v_extra jsonb := '{}'::jsonb; v_board public.toolbox_activities;
  v_round integer; v_revealed boolean; v_show_author boolean;
begin
  v_row := brand_toolbox.teacher_activity(p_id, false);
  if v_row.kind = 'VOTE' then
    perform brand_toolbox.vote_autoclose(p_id);
    v_row := brand_toolbox.teacher_activity(p_id, false);
  end if;

  if v_row.kind = 'BUZZER' then
    v_round := coalesce((v_row.state->>'round_no')::integer, 0);
    v_extra := jsonb_build_object('presses', (select coalesce(jsonb_agg(jsonb_build_object(
        'unit_key', p.unit_key, 'rank', p.rank, 'student_name', s.name, 'brand_name', s.brand_name,
        'ms', round(extract(epoch from (p.pressed_at - (v_row.state->>'opened_at')::timestamptz)) * 1000)) order by p.rank), '[]'::jsonb)
      from public.toolbox_buzzer_presses p join public.students s on s.id = p.student_id
      where p.activity_id = p_id and p.round_no = v_round));
    if coalesce((v_row.config->>'show_false_starts')::boolean, false) then
      v_extra := v_extra || jsonb_build_object('false_starts', (select coalesce(jsonb_agg(jsonb_build_object(
          'student_name', s.name, 'locked_until', l.locked_until) order by l.pressed_at desc), '[]'::jsonb)
        from public.toolbox_buzzer_locks l join public.students s on s.id = l.student_id
        where l.activity_id = p_id and l.round_no >= v_round and l.locked_until > now()));
    end if;
    if (v_row.config->>'scoreboard_id') is not null then
      select * into v_board from public.toolbox_activities where id = (v_row.config->>'scoreboard_id')::bigint;
      if v_board.id is not null then
        v_extra := v_extra || jsonb_build_object('scoreboard', jsonb_build_object('id', v_board.id, 'scores', v_board.state->'scores'));
      end if;
    end if;
  elsif v_row.kind = 'VOTE' then
    v_revealed := coalesce((v_row.state->>'revealed')::boolean, false) or (v_row.config->>'reveal' = 'LIVE');
    v_extra := jsonb_build_object('tally', case when v_revealed then brand_toolbox.vote_tally(v_row)
      else (select jsonb_build_object('submitted', count(*) filter (where invalidated_at is null),
                                      'eligible', cardinality(v_row.eligible_student_ids))
            from public.toolbox_vote_ballots where activity_id = p_id) end);
    if coalesce((v_row.state->>'reveal_names')::boolean, false) and not coalesce((v_row.config->>'anonymous')::boolean, true) then
      v_extra := v_extra || jsonb_build_object('voters', (select coalesce(jsonb_object_agg(k, names), '{}'::jsonb) from (
        select x.value k, jsonb_agg(s.name order by s.name) names
        from public.toolbox_vote_ballots b cross join lateral jsonb_array_elements_text(b.choices) x
        join public.students s on s.id = b.student_id
        where b.activity_id = p_id and b.invalidated_at is null group by x.value) t));
    end if;
  elsif v_row.kind = 'CARDS' then
    v_show_author := coalesce((v_row.config->>'show_author')::boolean, true);
    v_extra := jsonb_build_object(
      'cards', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'card_id', c.student_id, 'title', c.title, 'presented', c.presented,
          'author', case when v_show_author then coalesce(s.brand_name, s.name) end)) order by c.created_at), '[]'::jsonb)
        from public.toolbox_cards c join public.students s on s.id = c.student_id
        where c.activity_id = p_id and not c.hidden),
      'spotlight_card', (select jsonb_strip_nulls(jsonb_build_object('card_id', c.student_id, 'title', c.title, 'body', c.body,
          'author', case when v_show_author then coalesce(s.brand_name, s.name) end))
        from public.toolbox_cards c join public.students s on s.id = c.student_id
        where c.activity_id = p_id and not c.hidden and c.student_id = (v_row.state->>'spotlight')::integer),
      'submitted', (select count(*) from public.toolbox_cards where activity_id = p_id),
      'eligible', cardinality(v_row.eligible_student_ids));
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'kind', v_row.kind, 'title', v_row.title, 'status', v_row.status, 'rev', v_row.rev,
    'participants', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'key', u->>'key', 'type', u->>'type', 'label', u->>'label', 'color', u->>'color',
        'member_count', jsonb_array_length(coalesce(u->'members', '[]'::jsonb))))), '[]'::jsonb)
      from jsonb_array_elements(v_row.participants) u),
    'config', case v_row.kind
      when 'VOTE' then v_row.config - 'confirmed'
      when 'BUZZER' then v_row.config - 'reps'
      else v_row.config end,
    'state', case v_row.kind
      when 'CARDS' then v_row.state - 'spotlight' || jsonb_build_object('has_spotlight', v_row.state->'spotlight' <> 'null'::jsonb)
      when 'TOURNAMENT' then v_row.state || jsonb_build_object('results', (select coalesce(jsonb_object_agg(k,
          case when coalesce((r->>'note_public')::boolean, false) then r else r - 'note' end), '{}'::jsonb)
        from jsonb_each(v_row.state->'results') x(k, r)))
      else v_row.state end,
    'server_now', clock_timestamp()) || v_extra;
end
$fn$;

-- ---------------------------------------------------------------------
-- 6. Student RPCs
-- ---------------------------------------------------------------------
create or replace function public.student_toolbox_feed()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; v_rows jsonb;
begin
  select * into v_ctx from brand_toolbox.student_ctx();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'title', a.title, 'status', a.status, 'opened_at', a.opened_at,
      'mine', case a.kind
        when 'VOTE' then jsonb_build_object('submitted', exists (select 1 from public.toolbox_vote_ballots b where b.activity_id = a.id and b.student_id = v_ctx.o_student_id))
        when 'CARDS' then jsonb_build_object('submitted', exists (select 1 from public.toolbox_cards c where c.activity_id = a.id and c.student_id = v_ctx.o_student_id),
                                             'submission_open', coalesce((a.state->>'submission_open')::boolean, false))
        when 'BUZZER' then jsonb_build_object('round_status', a.state->'round_status')
        else '{}'::jsonb end) order by a.opened_at desc nulls last), '[]'::jsonb)
    into v_rows
  from public.toolbox_activities a
  where a.classroom_id = v_ctx.o_classroom_id and brand_toolbox.student_can_see(a, v_ctx.o_student_id);
  return jsonb_build_object('activities', v_rows, 'server_now', clock_timestamp());
end
$fn$;

create or replace function public.student_toolbox_state(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; v_row public.toolbox_activities; v_out jsonb; v_unit text; v_round integer; v_press record;
  v_lock record; v_mine jsonb; v_revealed boolean; v_judge jsonb;
begin
  select * into v_ctx from brand_toolbox.student_ctx();
  select * into v_row from public.toolbox_activities where id = p_id and classroom_id = v_ctx.o_classroom_id;
  if v_row.id is not null and v_row.kind = 'VOTE' then
    perform brand_toolbox.vote_autoclose(p_id);
    select * into v_row from public.toolbox_activities where id = p_id;
  end if;
  if v_row.id is null or not brand_toolbox.student_can_see(v_row, v_ctx.o_student_id) then
    return jsonb_build_object('id', p_id, 'available', false, 'server_now', clock_timestamp());
  end if;

  v_out := jsonb_build_object('id', v_row.id, 'available', true, 'kind', v_row.kind, 'title', v_row.title,
    'status', v_row.status, 'rev', v_row.rev, 'server_now', clock_timestamp());

  if v_row.kind = 'BUZZER' then
    v_unit := brand_toolbox.buzzer_unit_for(v_row, v_ctx.o_student_id);
    v_round := coalesce((v_row.state->>'round_no')::integer, 0);
    select * into v_press from public.toolbox_buzzer_presses where activity_id = p_id and round_no = v_round and unit_key = v_unit;
    select * into v_lock from public.toolbox_buzzer_locks where activity_id = p_id and student_id = v_ctx.o_student_id;
    select j into v_judge from jsonb_array_elements(coalesce(v_row.state->'judgments', '[]'::jsonb)) j where j->>'unit_key' = v_unit limit 1;
    v_out := v_out || jsonb_build_object(
      'mode', v_row.config->'mode', 'team_press', v_row.config->'team_press',
      'can_press', v_unit is not null,
      'my_unit', (select jsonb_strip_nulls(jsonb_build_object('key', u->>'key', 'label', u->>'label', 'color', u->>'color'))
                  from jsonb_array_elements(v_row.participants) u where u->>'key' = v_unit),
      'round_no', v_round, 'round_status', v_row.state->'round_status', 'opened_at', v_row.state->'opened_at',
      'points', v_row.state->'points',
      'my_press', case when v_press.unit_key is null then null else jsonb_build_object(
          'rank', v_press.rank, 'by_me', v_press.student_id = v_ctx.o_student_id,
          'student_name', (select name from public.students where id = v_press.student_id)) end,
      'my_verdict', v_judge->'verdict',
      'locked_until', case when v_lock.locked_until > now() then v_lock.locked_until end);
  elsif v_row.kind = 'SCOREBOARD' then
    v_out := v_out || jsonb_build_object(
      'sort', v_row.config->'sort', 'scores', v_row.state->'scores',
      'units', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', u->>'key', 'label', u->>'label', 'color', u->>'color',
          'mine', (u->>'student_id')::integer = v_ctx.o_student_id
                  or exists (select 1 from jsonb_array_elements(coalesce(u->'members', '[]'::jsonb)) m where (m->>'student_id')::integer = v_ctx.o_student_id)))), '[]'::jsonb)
        from jsonb_array_elements(v_row.participants) u));
  elsif v_row.kind = 'TOURNAMENT' then
    v_out := v_out || jsonb_build_object(
      'revealed_at', v_row.state->'revealed_at',
      'state', case when v_row.state->>'revealed_at' is null then jsonb_build_object('revealed_at', null)
        else v_row.state || jsonb_build_object('results', (select coalesce(jsonb_object_agg(k,
            case when coalesce((r->>'note_public')::boolean, false) then r else r - 'note' end), '{}'::jsonb)
          from jsonb_each(v_row.state->'results') x(k, r))) end,
      'units', case when v_row.state->>'revealed_at' is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'key', u->>'key', 'label', u->>'label', 'color', u->>'color',
          'mine', (u->>'student_id')::integer = v_ctx.o_student_id
                  or exists (select 1 from jsonb_array_elements(coalesce(u->'members', '[]'::jsonb)) m where (m->>'student_id')::integer = v_ctx.o_student_id)))), '[]'::jsonb)
        from jsonb_array_elements(v_row.participants) u) end);
  elsif v_row.kind = 'VOTE' then
    select to_jsonb(b) - 'invalidated_by' into v_mine from (
      select choices, revision, submitted_at, updated_at, invalidated_at is not null as invalidated
      from public.toolbox_vote_ballots where activity_id = p_id and student_id = v_ctx.o_student_id) b;
    v_revealed := coalesce((v_row.state->>'revealed')::boolean, false) or (v_row.config->>'reveal' = 'LIVE');
    v_out := v_out || jsonb_build_object(
      'config', v_row.config - 'confirmed' - 'runoff_of', 'my_ballot', v_mine,
      'revealed', v_revealed,
      'decision_note', case when v_revealed then v_row.state->'decision_note' end,
      'tally', case when v_revealed then brand_toolbox.vote_tally(v_row)
        else jsonb_build_object('submitted', (select count(*) from public.toolbox_vote_ballots where activity_id = p_id and invalidated_at is null),
                                'eligible', cardinality(v_row.eligible_student_ids)) end);
  elsif v_row.kind = 'CARDS' then
    select jsonb_build_object('title', title, 'body', body, 'revision', revision, 'updated_at', updated_at) into v_mine
    from public.toolbox_cards where activity_id = p_id and student_id = v_ctx.o_student_id;
    v_out := v_out || jsonb_build_object('prompt', v_row.config->'prompt', 'show_author', v_row.config->'show_author',
      'submission_open', v_row.state->'submission_open', 'my_card', v_mine);
  end if;
  return v_out;
end
$fn$;

-- 버저 누르기 (빠른 경로)
create or replace function public.student_toolbox_buzz(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; v_row public.toolbox_activities; v_unit text; v_now timestamptz; v_round integer;
  v_lock record; v_press record; v_rank integer; v_until timestamptz; v_state jsonb;
begin
  select * into v_ctx from brand_toolbox.student_ctx();
  select * into v_row from public.toolbox_activities where id = p_id and classroom_id = v_ctx.o_classroom_id and kind = 'BUZZER' for update;
  v_now := clock_timestamp();
  if v_row.id is null or v_row.status <> 'OPEN' then
    return jsonb_build_object('result', 'CLOSED', 'server_now', v_now);
  end if;
  v_unit := brand_toolbox.buzzer_unit_for(v_row, v_ctx.o_student_id);
  if v_unit is null then
    return jsonb_build_object('result', 'NOT_PARTICIPANT', 'server_now', v_now);
  end if;
  v_round := coalesce((v_row.state->>'round_no')::integer, 0);

  select * into v_lock from public.toolbox_buzzer_locks where activity_id = p_id and student_id = v_ctx.o_student_id;
  if v_lock.locked_until is not null and v_lock.locked_until > v_now then
    return jsonb_build_object('result', 'LOCKED', 'locked_until', v_lock.locked_until, 'server_now', v_now);
  end if;

  if coalesce(v_row.state->>'round_status', 'IDLE') <> 'OPEN' then
    -- 부정출발: 5초 잠금
    v_until := v_now + interval '5 seconds';
    insert into public.toolbox_buzzer_locks (activity_id, student_id, round_no, pressed_at, locked_until)
    values (p_id, v_ctx.o_student_id, v_round + 1, v_now, v_until)
    on conflict (activity_id, student_id) do update set round_no = excluded.round_no, pressed_at = excluded.pressed_at, locked_until = excluded.locked_until;
    perform brand_toolbox.bump(v_row.classroom_id, false, jsonb_build_object('activity_id', p_id, 'kind', 'BUZZER', 'event', 'FALSE_START'));
    return jsonb_build_object('result', 'FALSE_START', 'locked_until', v_until, 'server_now', v_now);
  end if;

  select * into v_press from public.toolbox_buzzer_presses where activity_id = p_id and round_no = v_round and unit_key = v_unit;
  if v_press.unit_key is not null then
    return jsonb_build_object('result', 'ALREADY', 'rank', v_press.rank, 'by_me', v_press.student_id = v_ctx.o_student_id, 'server_now', v_now);
  end if;
  select count(*) + 1 into v_rank from public.toolbox_buzzer_presses where activity_id = p_id and round_no = v_round;
  if coalesce((v_row.config->>'close_on_first')::boolean, false) and v_rank > 1 then
    return jsonb_build_object('result', 'ROUND_FULL', 'server_now', v_now);
  end if;
  insert into public.toolbox_buzzer_presses (activity_id, round_no, unit_key, student_id, rank, pressed_at)
  values (p_id, v_round, v_unit, v_ctx.o_student_id, v_rank, v_now);

  if coalesce((v_row.config->>'close_on_first')::boolean, false) then
    v_state := v_row.state || jsonb_build_object('round_status', 'CLOSED', 'closed_at', v_now);
    update public.toolbox_activities set state = v_state, rev = rev + 1, updated_at = now() where id = p_id;
    perform brand_toolbox.bump(v_row.classroom_id, true, jsonb_build_object('activity_id', p_id, 'kind', 'BUZZER', 'event', 'CLOSE_ROUND',
      'round_no', v_round, 'round_status', 'CLOSED'));
  else
    perform brand_toolbox.bump(v_row.classroom_id, false, jsonb_build_object('activity_id', p_id, 'kind', 'BUZZER', 'event', 'PRESS', 'round_no', v_round));
  end if;
  return jsonb_build_object('result', 'ACCEPTED', 'rank', v_rank, 'round_no', v_round, 'server_now', v_now);
end
$fn$;

create or replace function public.student_toolbox_vote_submit(p_id bigint, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; v_row public.toolbox_activities; v_keys text[]; v_choice text; v_n integer; v_rev integer;
begin
  select * into v_ctx from brand_toolbox.student_ctx();
  perform brand_toolbox.vote_autoclose(p_id);
  select * into v_row from public.toolbox_activities where id = p_id and classroom_id = v_ctx.o_classroom_id and kind = 'VOTE';
  if v_row.id is null or not (v_ctx.o_student_id = any(v_row.eligible_student_ids)) then
    raise exception '참여할 수 없는 투표예요' using errcode = 'P7T01';
  end if;
  if v_row.status <> 'OPEN' then raise exception '투표가 마감되었어요' using errcode = 'P7T03'; end if;
  if p_choices is null or jsonb_typeof(p_choices) <> 'array' or jsonb_array_length(p_choices) = 0 then
    raise exception '하나 이상 골라 주세요' using errcode = 'P7T04';
  end if;
  select array_agg(o->>'key') into v_keys from jsonb_array_elements(v_row.config->'options') o;
  v_n := jsonb_array_length(p_choices);
  if (select count(distinct value) from jsonb_array_elements_text(p_choices)) <> v_n then
    raise exception '같은 선택지를 두 번 고를 수 없어요' using errcode = 'P7T04';
  end if;
  for v_choice in select value from jsonb_array_elements_text(p_choices) loop
    if v_choice = 'ABSTAIN' then
      if not coalesce((v_row.config->>'allow_abstain')::boolean, false) then
        raise exception '이 투표는 기권을 고를 수 없어요' using errcode = 'P7T04';
      end if;
      if v_n > 1 then raise exception '기권은 다른 선택과 함께 고를 수 없어요' using errcode = 'P7T04'; end if;
    elsif not (v_choice = any(v_keys)) then
      raise exception '없는 선택지예요' using errcode = 'P7T04';
    end if;
  end loop;
  if not (p_choices ? 'ABSTAIN') and v_n > coalesce((v_row.config->>'max_choices')::integer, 1) then
    raise exception '최대 %개까지 고를 수 있어요', coalesce((v_row.config->>'max_choices')::integer, 1) using errcode = 'P7T04';
  end if;

  insert into public.toolbox_vote_ballots as b (activity_id, student_id, choices)
  values (p_id, v_ctx.o_student_id, p_choices)
  on conflict (activity_id, student_id) do update set choices = excluded.choices, revision = b.revision + 1, updated_at = now()
  where b.invalidated_at is null
  returning revision into v_rev;
  if v_rev is null then
    raise exception '이 표는 운영국 확인 중이라 바꿀 수 없어요' using errcode = 'P7T03';
  end if;
  perform brand_toolbox.bump(v_row.classroom_id, v_row.config->>'reveal' = 'LIVE', jsonb_build_object('activity_id', p_id, 'kind', 'VOTE', 'event', 'BALLOT'));
  return jsonb_build_object('id', p_id, 'revision', v_rev, 'choices', p_choices);
end
$fn$;

create or replace function public.student_toolbox_card_submit(p_id bigint, p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_ctx record; v_row public.toolbox_activities; v_title text := btrim(coalesce(p_title, '')); v_body text := btrim(coalesce(p_body, ''));
  v_rev integer;
begin
  select * into v_ctx from brand_toolbox.student_ctx();
  select * into v_row from public.toolbox_activities where id = p_id and classroom_id = v_ctx.o_classroom_id and kind = 'CARDS';
  if v_row.id is null or not (v_ctx.o_student_id = any(v_row.eligible_student_ids)) then
    raise exception '참여할 수 없는 활동이에요' using errcode = 'P7T01';
  end if;
  if v_row.status <> 'OPEN' or not coalesce((v_row.state->>'submission_open')::boolean, false) then
    raise exception '지금은 카드를 낼 수 없어요' using errcode = 'P7T03';
  end if;
  if char_length(v_title) not between 1 and 40 then raise exception '제목은 1~40자로 써 주세요' using errcode = 'P7T04'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception '내용은 1~2000자로 써 주세요' using errcode = 'P7T04'; end if;
  insert into public.toolbox_cards as c (activity_id, student_id, title, body)
  values (p_id, v_ctx.o_student_id, v_title, v_body)
  on conflict (activity_id, student_id) do update set title = excluded.title, body = excluded.body,
    revision = c.revision + 1, updated_at = now()
  returning revision into v_rev;
  perform brand_toolbox.bump(v_row.classroom_id, false, jsonb_build_object('activity_id', p_id, 'kind', 'CARDS', 'event', 'CARD'));
  return jsonb_build_object('id', p_id, 'revision', v_rev);
end
$fn$;

-- ---------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and (p.proname like 'teacher\_toolbox\_%' or p.proname like 'student\_toolbox\_%'))
       or n.nspname = 'brand_toolbox'
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
