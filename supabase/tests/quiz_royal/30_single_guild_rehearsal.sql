-- =====================================================================
-- 리허설 대회: 테스트 계정 1개(길드 1개)로 처음부터 끝까지 돌아가는지 시험
-- (10_scenarios.sql 이 먼저 실행되어 있어야 함: 같은 시험 DB 사용)
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

reset role;
select id as sid from public.students where user_id = '00000000-0000-0000-0000-0000000000f1' \gset
select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;

-- 1. 실전 대회는 길드 1개로 시작할 수 없다 / 리허설 대회는 된다
select (public.teacher_quiz_create('실전 1길드')->>'id')::bigint as real_id \gset
select public.teacher_quiz_save_setup(:real_id, '실전 1길드', '{}'::jsonb,
  format('[{"guild_id":17,"device_student_id":%s}]', :sid)::jsonb) \g /dev/null
select _ok(public.teacher_quiz_state(:real_id)->'ready_errors' @> '["참가 길드가 2개 이상이어야 해요"]'::jsonb,
  '실전 대회: 길드 1개면 점검 오류(2개 이상 필요)');

select (public.teacher_quiz_create('리허설', true)->>'id')::bigint as eid \gset
select public.teacher_quiz_save_setup(:eid, '리허설', '{}'::jsonb,
  format('[{"guild_id":17,"device_student_id":%s}]', :sid)::jsonb, true) \g /dev/null
select _ok(not (public.teacher_quiz_state(:eid)->'ready_errors')::text like '%참가 길드%', '리허설 대회: 길드 1개여도 길드 수 오류 없음');

-- 2. 문제 5(개인, 포지션마다 1개) + 단체 1, 출전표는 같은 계정이 5자리 모두
select public.teacher_quiz_save_questions(:eid, (
  select jsonb_agg(q) from (
    select jsonb_build_object('stage','INDIVIDUAL','position_index', p, 'prompt', format('개인 %s', p), 'answer_key', format('정답%s', p)) q
    from generate_series(0, 4) p
    union all
    select jsonb_build_object('stage','TEAM','prompt','단체 1','answer_key','단체정답1')
  ) t)) \g /dev/null
select public.teacher_quiz_set_roster(:eid, (
  select jsonb_agg(jsonb_build_object('guild_id', 17, 'position_index', p, 'student_id', :sid)) from generate_series(0, 4) p)) \g /dev/null
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'ready_errors') = 0, '출전표(한 계정이 5자리) + 문제 → 시작 전 점검 오류 없음');

-- 3. 대기실 → 접속 → 시작
select public.teacher_quiz_open_lobby(:eid, true) \g /dev/null
reset role; select _who('00000000-0000-0000-0000-0000000000f1'); set role authenticated;
select public.student_quiz_state(:eid) \g /dev/null
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_start(:eid) \g /dev/null

-- 4. 모든 문제를 처음부터 끝까지: 시작 → (대표 계정 제출 → 모두 제출했으니 자동 마감) → 공개 → 판정 → 확정 → 다음
reset role;
do $$
declare v_e bigint; v_q bigint; v_a int; v_n int := 0; v_t text := '00000000-0000-0000-0000-0000000000a1'; v_d text := '00000000-0000-0000-0000-0000000000f1';
  v_key text; v_phase text;
begin
  select id into v_e from public.quiz_events order by id desc limit 1;
  execute 'set local role authenticated';
  loop
    perform set_config('request.jwt.claim.sub', v_t, false);
    exit when public.teacher_quiz_state(v_e)->'event'->>'phase' not in ('INDIVIDUAL', 'TEAM');
    v_q := (public.teacher_quiz_state(v_e)->'event'->>'current_question_id')::bigint;
    select (x->>'attempt')::int into v_a from jsonb_array_elements(public.teacher_quiz_state(v_e)->'questions') x where (x->>'id')::bigint = v_q;
    select x->>'answer_key' into v_key from jsonb_array_elements(public.teacher_quiz_state(v_e)->'questions') x where (x->>'id')::bigint = v_q;
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'START');
    perform set_config('request.jwt.claim.sub', v_d, false);
    perform public.student_quiz_submit(v_e, v_q, v_a, v_key);
    perform set_config('request.jwt.claim.sub', v_t, false);
    v_phase := public.teacher_quiz_state(v_e)->'event'->>'q_phase';
    if v_phase <> 'LOCKED' then raise exception 'FAIL: 길드 1개가 제출했는데 자동 마감되지 않음 (%)', v_phase; end if;
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'REVEAL');
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'AUTO_GRADE');
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'FINALIZE');
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'NEXT');
    v_n := v_n + 1;
    -- 개인전이 끝나면 발표 단계 → 끝까지 공개 → 단체전으로
    if public.teacher_quiz_state(v_e)->'event'->>'phase' = 'IND_CEREMONY' then
      -- 길드 1개 → 공개 1단계 + 전체 순위 화면 1단계
      perform public.teacher_quiz_ceremony(v_e, 'STEP');
      perform public.teacher_quiz_ceremony(v_e, 'STEP');
      perform public.teacher_quiz_ceremony(v_e, 'ADVANCE');
    end if;
  end loop;
  if v_n <> 6 then raise exception 'FAIL: 문제 6개를 모두 진행해야 하는데 % 개', v_n; end if;
  raise notice 'ok  길드 1개 리허설: 문제 6개를 자동 마감·공개·확정까지 진행';
end $$;
select _ok(public.teacher_quiz_state(:eid)->'event'->>'phase' = 'FINAL_CEREMONY', '단체전 끝 → 최종 발표 단계');
select _ok((public.teacher_quiz_state(:eid)->'scores'->'17'->>'total')::int = 5 * 10 + 15, '점수 = 개인 5×10 + 단체 15 = 65');
select _ok((public.teacher_quiz_state(:eid)->'event'->'final_result'->'guilds'->0->>'rank')::int = 1, '길드 1개여도 순위 1위로 계산');
reset role;
do $$ declare v_e bigint;
begin
  select id into v_e from public.quiz_events order by id desc limit 1;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
  execute 'set local role authenticated';
  perform public.teacher_quiz_ceremony(v_e, 'STEP');
  perform public.teacher_quiz_ceremony(v_e, 'STEP');
  perform public.teacher_quiz_ceremony(v_e, 'ADVANCE');
end $$;
select _ok(public.teacher_quiz_state(:eid)->'event'->>'phase' = 'COMPLETED', '리허설 종료');
select public.teacher_quiz_delete(:eid) \g /dev/null
select _ok(not exists(select 1 from jsonb_array_elements(public.teacher_quiz_list()->'events') x where (x->>'id')::bigint = :eid), '리허설 대회는 끝난 뒤 지울 수 있음');
select public.teacher_quiz_delete(:real_id) \g /dev/null

select 'ALL SINGLE-GUILD REHEARSAL TESTS PASSED' as result;
