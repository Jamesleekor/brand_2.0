-- APPLY: 모험가 도구함 투표 — 한 표씩 개표 방송 v1 (migrations/20261030_02_toolbox_vote_live_count.sql 과 같은 내용)
-- Supabase SQL Editor에서 한 번 실행합니다. 여러 번 실행해도 안전합니다(새 표·새 함수 추가, 기존 함수 2개 교체, 기존 데이터 변경 없음).
begin;
-- =====================================================================
-- B.R.A.N.D 2.0 — 모험가 도구함 투표: 한 표씩 개표 방송 (Live Count) v1
-- 2026-10-30
-- ---------------------------------------------------------------------
-- 목적
--   손으로 개표하던 재미(한 표씩 펼칠 때마다 득표가 오르고 1·2·3위가
--   실시간으로 바뀌는 맛)를 중계 화면에서 그대로 살린다.
--
-- 흐름
--   1) 투표 마감(CLOSED) → 운영 화면에서 COUNT_START
--      : 유효 표(무효 제외)를 '무작위 순서'로 섞어 개표 순서 표에 복사한다.
--        학생 번호는 복사하지 않는다(익명 보장). 순서는 서버만 안다.
--   2) COUNT_NEXT : 한 표 공개 (shown + 1)
--      COUNT_UNDO : 한 표 되돌리기 (shown - 1)
--      COUNT_ALL  : 남은 표 한꺼번에 공개
--      COUNT_RESET: 개표 초기화(순서 표 삭제, state.count 제거)
--   3) 중계 화면은 '지금까지 공개된 표'만으로 계산한 득표를 받는다.
--      아직 공개되지 않은 표의 내용은 화면으로 보내지 않는다.
--
-- 안전 원칙
--   * 기존 표·기존 데이터는 바꾸지 않는다. 새 표 1개 + 새 내부 함수 1개 추가.
--   * 기존 함수 2개(teacher_toolbox_vote, teacher_toolbox_broadcast)는
--     2026-10-30 production 정의(pg_get_functiondef)를 그대로 두고 개표 부분만 덧붙였다.
--     signature·기본값·권한은 그대로다(CREATE OR REPLACE는 권한을 유지한다).
--   * 학생 화면(student_toolbox_state)은 바꾸지 않는다. 개표 중에도 학생 기기에는
--     기존처럼 '결과 발표를 기다려요'만 보이고, 결과 공개(REVEAL) 때 결과가 보인다.
--   * 개표를 시작한 뒤에는 표 무효/복구를 막는다(개표 순서와 실제 표가 달라지지 않게).
--     정정이 필요하면 개표 초기화 → 정정 → 다시 개표 시작.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 개표 순서 표 (학생 번호 없음)
-- ---------------------------------------------------------------------
create table if not exists public.toolbox_vote_count_order (
  activity_id bigint not null references public.toolbox_activities(id) on delete cascade,
  seq integer not null check (seq >= 1),
  choices jsonb not null,
  primary key (activity_id, seq)
);

alter table public.toolbox_vote_count_order enable row level security;
revoke all on public.toolbox_vote_count_order from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- 2. 지금까지 공개된 표로 계산한 개표 현황 (내부 함수)
--    counts : 후보별 득표
--    reached: 후보가 지금 득표에 도달한 개표 번호(동률일 때 먼저 도달한 쪽이 앞)
--    last   : 방금 공개한 표의 선택(기권이면 ["ABSTAIN"])
-- ---------------------------------------------------------------------
create or replace function brand_toolbox.vote_count_view(p_row public.toolbox_activities)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_shown integer; v_total integer; v_counts jsonb; v_reached jsonb; v_last jsonb; v_abstain integer;
begin
  if jsonb_typeof(p_row.state->'count') is distinct from 'object' then
    return null;
  end if;
  v_shown := coalesce((p_row.state->'count'->>'shown')::integer, 0);
  v_total := coalesce((p_row.state->'count'->>'total')::integer, 0);

  select coalesce(jsonb_object_agg(o->>'key', coalesce(c.n, 0)), '{}'::jsonb),
         coalesce(jsonb_object_agg(o->>'key', c.last_seq) filter (where c.last_seq is not null), '{}'::jsonb)
    into v_counts, v_reached
  from jsonb_array_elements(p_row.config->'options') o
  left join (
    select x.value as k, count(*) as n, max(v.seq) as last_seq
    from public.toolbox_vote_count_order v cross join lateral jsonb_array_elements_text(v.choices) x
    where v.activity_id = p_row.id and v.seq <= v_shown
    group by x.value
  ) c on c.k = o->>'key';

  select count(*) into v_abstain from public.toolbox_vote_count_order
  where activity_id = p_row.id and seq <= v_shown and choices ? 'ABSTAIN';

  select choices into v_last from public.toolbox_vote_count_order
  where activity_id = p_row.id and seq = v_shown;

  return jsonb_build_object(
    'shown', v_shown, 'total', v_total, 'counts', v_counts, 'reached', v_reached,
    'abstain', v_abstain, 'last', v_last, 'started_at', p_row.state->'count'->'started_at');
end
$fn$;

revoke all on function brand_toolbox.vote_count_view(public.toolbox_activities) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. 투표 진행 (기존 동작 그대로 + COUNT_* 동작 추가)
-- ---------------------------------------------------------------------
create or replace function public.teacher_toolbox_vote(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.toolbox_activities := brand_toolbox.teacher_activity(p_id, true);
  v_action text := upper(coalesce(p_action, '')); v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_state jsonb := v_row.state; v_sid integer := (v_args->>'student_id')::integer; v_reason text;
  -- 개표 방송
  v_total integer; v_shown integer; v_next integer; v_expect integer;
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
    -- [개표 방송] 개표 순서를 만든 뒤에는 정정하지 않는다.
    if jsonb_typeof(v_state->'count') = 'object' then
      raise exception '개표를 시작한 뒤에는 표를 정정할 수 없어요. 개표 초기화를 누른 뒤 정정해 주세요' using errcode = 'P7T03';
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

  -- ------------------------------------------------------------------
  -- [개표 방송] 한 표씩 개표
  -- ------------------------------------------------------------------
  elsif v_action = 'COUNT_START' then
    if v_row.status <> 'CLOSED' then
      raise exception '투표를 마감한 뒤에 개표를 시작할 수 있어요' using errcode = 'P7T03';
    end if;
    if jsonb_typeof(v_state->'count') = 'object' then
      raise exception '이미 개표를 시작했어요. 처음부터 다시 하려면 개표 초기화를 눌러 주세요' using errcode = 'P7T05';
    end if;
    delete from public.toolbox_vote_count_order where activity_id = p_id;
    insert into public.toolbox_vote_count_order (activity_id, seq, choices)
    select p_id, row_number() over (order by random())::integer, b.choices
    from public.toolbox_vote_ballots b
    where b.activity_id = p_id and b.invalidated_at is null;
    get diagnostics v_total = row_count;
    if v_total = 0 then
      raise exception '개표할 표가 없어요' using errcode = 'P7T02';
    end if;
    v_state := jsonb_set(v_state, '{count}', jsonb_build_object('total', v_total, 'shown', 0, 'started_at', now()));
  elsif v_action in ('COUNT_NEXT', 'COUNT_UNDO', 'COUNT_ALL') then
    if jsonb_typeof(v_state->'count') is distinct from 'object' then
      raise exception '개표를 먼저 시작해 주세요' using errcode = 'P7T03';
    end if;
    v_total := coalesce((v_state->'count'->>'total')::integer, 0);
    v_shown := coalesce((v_state->'count'->>'shown')::integer, 0);
    -- 두 창(운영 화면·중계 화면)에서 거의 동시에 눌러 한 표를 건너뛰지 않도록,
    -- 화면이 보고 있던 번호(expect)와 다르면 아무것도 바꾸지 않는다.
    v_expect := (v_args->>'expect')::integer;
    if v_expect is not null and v_expect <> v_shown then
      return jsonb_build_object('id', p_id, 'state', v_state, 'skipped', true);
    end if;
    if v_action = 'COUNT_NEXT' then
      if v_shown >= v_total then
        raise exception '모든 표를 개표했어요' using errcode = 'P7T05';
      end if;
      v_next := v_shown + 1;
    elsif v_action = 'COUNT_ALL' then
      if v_shown >= v_total then
        raise exception '모든 표를 개표했어요' using errcode = 'P7T05';
      end if;
      v_next := v_total;
    else
      if v_shown <= 0 then
        raise exception '되돌릴 표가 없어요' using errcode = 'P7T05';
      end if;
      v_next := v_shown - 1;
    end if;
    v_state := jsonb_set(v_state, '{count,shown}', to_jsonb(v_next));
  elsif v_action = 'COUNT_RESET' then
    delete from public.toolbox_vote_count_order where activity_id = p_id;
    v_state := v_state - 'count';

  else
    raise exception '알 수 없는 투표 동작이에요' using errcode = 'P7T04';
  end if;

  update public.toolbox_activities set state = v_state, rev = rev + 1, updated_at = now() where id = p_id;
  perform brand_toolbox.bump(v_row.classroom_id, v_action in ('REVEAL','HIDE_RESULT','REVEAL_NAMES'),
    jsonb_build_object('activity_id', p_id, 'kind', 'VOTE', 'event', v_action));
  return jsonb_build_object('id', p_id, 'state', v_state);
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. 중계 화면 (기존 그대로 + 투표에 'count' 추가)
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
    -- [개표 방송] 지금까지 공개된 표만으로 계산한 현황
    if jsonb_typeof(v_row.state->'count') = 'object' then
      v_extra := v_extra || jsonb_build_object('count', brand_toolbox.vote_count_view(v_row));
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

notify pgrst, 'reload schema';
commit;
