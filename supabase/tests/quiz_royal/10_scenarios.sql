-- =====================================================================
-- 퀴즈 로얄 로컬 시나리오 시험 (00_scaffold.sql → migration → 이 파일)
-- 실패하면 바로 멈춘다(ON_ERROR_STOP). 마지막에 'ALL QUIZ ROYAL TESTS PASSED' 출력.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create or replace function public._ok(p boolean, p_label text) returns void language plpgsql as $$
begin
  if p is distinct from true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;
create or replace function public._expect(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_code then raise notice 'ok  % (% %)', p_label, v_state, v_msg; return; end if;
    raise exception 'FAIL: % — expected %, got % %', p_label, p_code, v_state, v_msg;
  end;
  raise exception 'FAIL: % — expected error %, but succeeded', p_label, p_code;
end $$;
create or replace function public._j(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb; begin execute p_sql into v; return v; end $$;
grant execute on function public._ok(boolean, text), public._expect(text, text, text), public._j(text) to authenticated, anon;

-- 신원 설정 함수(psql 변수 대신 간단히)
create or replace function public._who(p_uuid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', p_uuid, false) $$;
grant execute on function public._who(text) to authenticated, anon;

-- 학생 uuid 규칙: 학생 k → 00000000-0000-0000-0000-00000000000k (k=1..23)
-- 길드 12: 학생1~4 / 13: 5~8 / 14: 9~13 / 15: 14~18 / 16: 19~23

--------------------------------------------------------------------------
-- A. 권한
--------------------------------------------------------------------------
reset role;
set role anon;
select _expect('select public.teacher_quiz_list()', '42501', 'anon은 교사 함수를 실행할 수 없다');
select _expect('select public.student_quiz_feed()', '42501', 'anon은 학생 함수를 실행할 수 없다');
reset role;
select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _expect($$select public.teacher_quiz_create('x')$$, 'P7T01', '학생은 대회를 만들 수 없다');
select _expect('select count(*) from public.quiz_questions', '42501', '학생은 문제 표를 직접 읽을 수 없다');
select _expect('select count(*) from public.quiz_answers', '42501', '학생은 답안 표를 직접 읽을 수 없다');
select _expect('select count(*) from public.quiz_events', '42501', '학생은 대회 표를 직접 읽을 수 없다');
select _expect($$select brand_quiz.scores(1)$$, '42501', '학생은 내부 함수를 실행할 수 없다');

--------------------------------------------------------------------------
-- B. 교사 — 대회 만들기 · 설정
--------------------------------------------------------------------------
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select (public.teacher_quiz_create('11월 길드미션 1 — 퀴즈 로얄')->>'id')::bigint as eid \gset
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'guilds') = 5, '기본 참가 길드 5개(테스트요원 길드 제외)');
select _ok(public.teacher_quiz_state(:eid)->'event'->'config'->>'grace_ms' = '1000', '기본 유예 1초');

select _expect(format($$select public.teacher_quiz_save_setup(%s, 'T', '{}', '[{"guild_id":12,"device_student_id":5}]')$$, :eid),
  'P7T04', '대표 계정은 그 길드원이어야 한다');
select _expect(format($$select public.teacher_quiz_save_setup(%s, 'T', '{}', '[{"guild_id":20}]')$$, :eid),
  'P7T04', '다른 반 길드는 고를 수 없다');
select public.teacher_quiz_save_setup(:eid, '11월 길드미션 1 — 퀴즈 로얄', '{}'::jsonb,
  '[{"guild_id":12,"device_student_id":1},{"guild_id":13,"device_student_id":5},{"guild_id":14,"device_student_id":9},
    {"guild_id":15,"device_student_id":14},{"guild_id":16,"device_student_id":19}]'::jsonb) \g /dev/null

-- 다른 반 교사는 이 대회를 볼 수 없다
reset role; select _who('00000000-0000-0000-0000-0000000000a2'); set role authenticated;
select _expect(format('select public.teacher_quiz_state(%s)', :eid), 'P7T02', '다른 반 교사는 대회를 찾을 수 없다');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;

-- 문제 붙여넣기: 잘못된 줄이 있으면 전체 거절(아무것도 저장 안 됨)
select _expect(format($$select public.teacher_quiz_save_questions(%s, '[{"stage":"INDIVIDUAL","position_index":0,"prompt":"a","answer_key":"b"},{"stage":"INDIVIDUAL","position_index":9,"prompt":"a","answer_key":"b"}]')$$, :eid),
  'P7T04', '범위 밖 포지션 줄이 있으면 거절');
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'questions') = 0, '거절된 붙여넣기는 아무것도 저장하지 않는다');

select public.teacher_quiz_save_questions(:eid, (
  select jsonb_agg(q) from (
    select jsonb_build_object('stage','INDIVIDUAL','position_index', p, 'prompt', format('개인 %s-%s 문제', p, i),
      'answer_key', format('정답%s%s', p, i), 'accepted', jsonb_build_array(format('정답 %s %s', p, i)),
      'kind', case when i = 3 then 'REASONING' else 'KNOWLEDGE' end) q
    from generate_series(0, 4) p, generate_series(1, 3) i
    union all
    select jsonb_build_object('stage','TEAM','prompt', format('단체 %s 문제', i), 'answer_key', format('단체정답%s', i),
      'media_type', case when i = 1 then 'IMAGE' end, 'media_path', case when i = 1 then '1/' || :eid || '/team1.png' end)
    from generate_series(1, 10) i
  ) t)) \g /dev/null
select _ok((select count(*) from jsonb_array_elements(public.teacher_quiz_state(:eid)->'questions')) = 25, '문제 25개 저장');
select _ok((select sum((x->>'points')::int) from jsonb_array_elements(public.teacher_quiz_state(:eid)->'questions') x) = 300, '기본 배점 합계 300(10×15 + 15×10)');
select _ok((select (x->>'time_limit_sec')::int from jsonb_array_elements(public.teacher_quiz_state(:eid)->'questions') x where x->>'kind' = 'REASONING' limit 1) = 60, '추론형 기본 시간 60초');

--------------------------------------------------------------------------
-- C. 출전표 검증 (4인 길드 1명 중복)
--------------------------------------------------------------------------
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'ready_errors') > 0, '출전표가 비면 시작 전 점검 오류');
select public.teacher_quiz_set_roster(:eid, (
  select jsonb_agg(jsonb_build_object('guild_id', g, 'position_index', p, 'student_id', sid))
  from (values
    (12,0,1),(12,1,2),(12,2,3),(12,3,4),(12,4,1),
    (13,0,5),(13,1,6),(13,2,7),(13,3,8),(13,4,6),
    (14,0,9),(14,1,10),(14,2,11),(14,3,12),(14,4,13),
    (15,0,14),(15,1,15),(15,2,16),(15,3,17),(15,4,18),
    (16,0,19),(16,1,20),(16,2,21),(16,3,22),(16,4,22)) t(g, p, sid))) \g /dev/null
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'roster_check'->'errors') = 0, '출전표 오류 없음');
select _ok((public.teacher_quiz_state(:eid)->'roster_check'->'warnings')::text like '%아블루션%출전하지 않는 길드원이 1명%', '5인 길드 중복 출전은 경고');
select _ok((public.teacher_quiz_state(:eid)->'roster_check'->'warnings')::text not like '%슈퍼노바%', '4인 길드 1명 중복은 경고 없음');
select _expect(format($$select public.teacher_quiz_set_roster(%s, '[{"guild_id":12,"position_index":0,"student_id":9}]')$$, :eid),
  'P7T04', '다른 길드 학생은 출전 불가');
-- 아블루션 정상으로 고치기
select public.teacher_quiz_set_roster(:eid, '[{"guild_id":16,"position_index":4,"student_id":23}]'::jsonb) \g /dev/null
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'roster_check'->'warnings') = 0, '경고 해소');

--------------------------------------------------------------------------
-- D. 대기실 · 태블릿 접속
--------------------------------------------------------------------------
select public.teacher_quiz_open_lobby(:eid, true) \g /dev/null
reset role;
select _ok((select count(*) from public._toolbox_bumps where payload->>'event' = 'QUIZ') = 1, '대기실 열기 때 학생 도구함 신호 1번');

reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok(jsonb_array_length(public.student_quiz_feed()->'events') = 1, '대표 계정 도구함에 퀴즈 입구가 보인다');
select _ok(public.student_quiz_state(:eid)->'question' = 'null'::jsonb, '대기실: 문제 정보 없음');
select _ok(public.student_quiz_state(:eid)->>'next_player' = '학생1', '대기실: 첫 출전 선수 표시');
select _ok(exists(select 1 from public.quiz_pulse where pulse_key = 'Q' || :eid || '-D'), '대표 계정은 태블릿 신호 행을 읽을 수 있다');
select _ok(not exists(select 1 from public.quiz_pulse where pulse_key = 'Q' || :eid || '-T'), '대표 계정은 운영 신호 행을 읽을 수 없다');

reset role; select _who('00000000-0000-0000-0000-000000000002'); set role authenticated;
select _ok(jsonb_array_length(public.student_quiz_feed()->'events') = 0, '대표가 아닌 학생에게는 입구가 없다');
select _expect(format('select public.student_quiz_state(%s)', :eid), 'P7T01', '대표가 아닌 학생은 상태를 볼 수 없다');
select _ok(not exists(select 1 from public.quiz_pulse), '대표가 아닌 학생은 신호 행도 못 읽는다');

-- 시작: 꺼진 태블릿이 있으면 사유 요구
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _expect(format('select public.teacher_quiz_start(%s)', :eid), 'P7T03', '꺼진 태블릿이 있으면 시작 전 경고');
-- 나머지 4대 접속
reset role; select _who('00000000-0000-0000-0000-000000000005'); set role authenticated; select public.student_quiz_state(:eid) \g /dev/null
reset role; select _who('00000000-0000-0000-0000-000000000009'); set role authenticated; select public.student_quiz_state(:eid) \g /dev/null
reset role; select _who('00000000-0000-0000-0000-000000000014'); set role authenticated; select public.student_quiz_state(:eid) \g /dev/null
reset role; select _who('00000000-0000-0000-0000-000000000019'); set role authenticated; select public.student_quiz_state(:eid) \g /dev/null
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'offline') = 0, '5대 모두 접속');
select public.teacher_quiz_start(:eid) \g /dev/null
select _expect(format('select public.teacher_quiz_start(%s)', :eid), 'P7T05', '시작 두 번 눌러도 안전');

--------------------------------------------------------------------------
-- E. 문제 1: 공개 전 비밀 유지 · 보여 주기 · 시작
--------------------------------------------------------------------------
select (public.teacher_quiz_state(:eid)->'event'->>'current_question_id')::bigint as q1 \gset
select _ok(public.teacher_quiz_screen_state(:eid)->'question'->>'prompt' is null, '중계: 시작 전 지문 없음');
select _ok((public.teacher_quiz_screen_state(:eid)->>'handoff')::boolean, '중계: 선봉 교체 안내');
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok(public.student_quiz_state(:eid)->'question'->>'prompt' is null, '태블릿: 시작 전 지문 없음');
select _ok((public.student_quiz_state(:eid)->>'handoff')::boolean and public.student_quiz_state(:eid)->>'player' = '학생1', '태블릿: 선봉 학생1 교체 안내');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q1, 0, 'SHOW') \g /dev/null
select _ok(public.teacher_quiz_screen_state(:eid)->'question'->>'prompt' = '개인 0-1 문제', '중계: 보여 주기 뒤 지문 표시');
select _ok(public.teacher_quiz_screen_state(:eid)->'question'->>'answer_key' is null, '중계: 정답은 아직 없음');
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _expect(format($$select public.student_quiz_submit(%s, %s, 0, '정답01')$$, :eid, :q1), 'P7T03', '보여 주기 단계에서는 제출 불가');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q1, 0, 'START') \g /dev/null
select _expect(format('select public.teacher_quiz_q(%s, %s, 0, ''START'')', :eid, :q1), 'P7T05', '시작 두 번 눌러도 안전');

--------------------------------------------------------------------------
-- F. 일시정지 · 재개 (17초 남기고)
--------------------------------------------------------------------------
reset role; update public.quiz_events set deadline_at = clock_timestamp() + interval '17 seconds' where id = :eid;
select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q1, 0, 'PAUSE') \g /dev/null
select _ok((public.teacher_quiz_state(:eid)->'event'->>'remaining_ms')::int between 16800 and 17000, '정지 시 남은 시간 약 17초 저장');
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _expect(format($$select public.student_quiz_submit(%s, %s, 0, '정답01')$$, :eid, :q1), 'P7T03', '일시정지 중 제출 거절');
reset role; select _ok(not exists(select 1 from public.quiz_answers where question_id = :q1), '일시정지 중 제출은 기록되지 않음');
select pg_sleep(1.2);
select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q1, 0, 'RESUME') \g /dev/null
reset role;
select _ok((select extract(epoch from deadline_at - clock_timestamp()) between 16.5 and 17.0 from public.quiz_events where id = :eid), '재개 뒤 남은 시간 유지(정지 1.2초는 소모 안 됨)');
select _ok((select pause_count = 1 and pause_ms >= 1100 from public.quiz_questions where id = :q1), '정지 횟수·총 시간 기록');

--------------------------------------------------------------------------
-- G. 제출 · 중복 · 유예 시간
--------------------------------------------------------------------------
select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok((public.student_quiz_submit(:eid, :q1, 0, ' 정답01 ')->>'already')::boolean = false, '슈퍼노바 제출 접수');
select _ok((public.student_quiz_submit(:eid, :q1, 0, '바꾼답')->>'answer') = '정답01', '다시 제출해도 처음 답 유지(중복 방어)');
reset role; select _who('00000000-0000-0000-0000-000000000005'); set role authenticated;
select public.student_quiz_submit(:eid, :q1, 0, '정답 0 1') \g /dev/null
reset role;
select _ok((select count(*) = 2 from public.quiz_answers where question_id = :q1), '제출 2건만 저장');
select _ok((select auto_match from public.quiz_answers where question_id = :q1 and guild_id = 13), '띄어쓰기 달라도 자동 판정 후보는 정답');
-- 중계: 제출 여부만, 원문 없음
select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _ok((select bool_and(x->>'answer' is null) and count(*) filter (where (x->>'submitted')::boolean) = 2
  from jsonb_array_elements(public.teacher_quiz_screen_state(:eid)->'guilds') x), '중계: 공개 전 답 원문 없음, 제출 여부만');
-- 마감 0.5초 뒤 도착(유예 1초 안) → 접수 / 1.5초 뒤 → 거절
reset role; update public.quiz_events set deadline_at = clock_timestamp() - interval '0.5 seconds' where id = :eid;
select _who('00000000-0000-0000-0000-000000000009'); set role authenticated;
select _ok((public.student_quiz_submit(:eid, :q1, 0, '오답')->>'already')::boolean = false, '마감 0.5초 뒤 도착한 답은 유예로 접수');
reset role; update public.quiz_events set deadline_at = clock_timestamp() - interval '1.5 seconds' where id = :eid;
select _who('00000000-0000-0000-0000-000000000014'); set role authenticated;
select _expect(format($$select public.student_quiz_submit(%s, %s, 0, '늦은답')$$, :eid, :q1), 'P7T03', '유예까지 지난 답은 거절');
select _ok(public.student_quiz_state(:eid)->>'q_phase' = 'LOCKED', '시간이 지나면 태블릿에 마감으로 보인다');

--------------------------------------------------------------------------
-- H. 공개 · 판정 · 확정
--------------------------------------------------------------------------
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _expect(format('select public.teacher_quiz_q(%s, %s, 0, ''FINALIZE'')', :eid, :q1), 'P7T03', '공개 전 확정 불가');
select public.teacher_quiz_q(:eid, :q1, 0, 'REVEAL') \g /dev/null
select _ok((select count(*) from jsonb_array_elements(public.teacher_quiz_screen_state(:eid)->'guilds') x where x->>'answer' is not null) = 3, '중계: 공개 뒤 답 원문 3개 표시');
select _ok(public.teacher_quiz_screen_state(:eid)->'question'->>'answer_key' is null, '중계: 공개 뒤에도 확정 전에는 정답 없음');
select _ok(jsonb_array_length(public.teacher_quiz_state(:eid)->'answers') = 5, '마감 때 미제출 길드도 판정 행 생성');
select _expect(format('select public.teacher_quiz_q(%s, %s, 0, ''FINALIZE'')', :eid, :q1), 'P7T03', '제출했는데 판정 안 한 길드가 있으면 확정 불가');
select public.teacher_quiz_q(:eid, :q1, 0, 'AUTO_GRADE') \g /dev/null
select public.teacher_quiz_q(:eid, :q1, 0, 'FINALIZE') \g /dev/null
select _expect(format('select public.teacher_quiz_q(%s, %s, 0, ''FINALIZE'')', :eid, :q1), 'P7T05', '확정 두 번 눌러도 1번만');
select _ok(public.teacher_quiz_state(:eid)->'scores'->'12'->>'total' = '10' and public.teacher_quiz_state(:eid)->'scores'->'13'->>'total' = '10'
  and public.teacher_quiz_state(:eid)->'scores'->'14'->>'total' = '0', '점수: 정답 길드만 10점');
select _ok(public.teacher_quiz_screen_state(:eid)->'question'->>'answer_key' = '정답01', '중계: 확정 뒤 정답 표시');
select _ok(public.teacher_quiz_screen_state(:eid)->'board'->'snapshot'->'scores'->>'12' = '0', '작은 순위판은 공개 전 점수 그대로(스포일러 없음)');
select _expect(format('select public.teacher_quiz_q(%s, %s, 0, ''START'')', :eid, :q1 + 1), 'P7T05', '지난 화면의 다른 문제 버튼은 거절');

--------------------------------------------------------------------------
-- I. 문제 2·3 → 중간 공개 시점(3문제마다) · 모두 제출 시 자동 마감
--------------------------------------------------------------------------
select public.teacher_quiz_q(:eid, :q1, 0, 'NEXT') \g /dev/null
select (public.teacher_quiz_state(:eid)->'event'->>'current_question_id')::bigint as q2 \gset
select _ok(not (public.teacher_quiz_screen_state(:eid)->>'handoff')::boolean, '같은 포지션 다음 문제는 교체 안내 없음');
select public.teacher_quiz_q(:eid, :q2, 0, 'START') \g /dev/null
reset role;
create temp table _dev(uuid text, n int);
insert into _dev values ('00000000-0000-0000-0000-000000000001',1),('00000000-0000-0000-0000-000000000005',2),
  ('00000000-0000-0000-0000-000000000009',3),('00000000-0000-0000-0000-000000000014',4),('00000000-0000-0000-0000-000000000019',5);
grant select on _dev to authenticated;
reset role;
do $$ declare d record; v_q bigint; v_e bigint;
begin
  select id, current_question_id into v_e, v_q from public.quiz_events order by id desc limit 1;
  for d in select * from _dev order by n loop
    perform set_config('request.jwt.claim.sub', d.uuid, false);
    execute 'set local role authenticated';
    perform public.student_quiz_submit(v_e, v_q, 0, case when d.n <= 2 then '정답02' else '모름' end);
    execute 'reset role';
  end loop;
end $$;
select _ok((select q_phase = 'LOCKED' from public.quiz_events where id = :eid), '5길드 모두 제출하면 자동 마감');
select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q2, 0, 'REVEAL') \g /dev/null
select public.teacher_quiz_q(:eid, :q2, 0, 'AUTO_GRADE') \g /dev/null
select public.teacher_quiz_grade(:eid, :q2, 0, 15, 'CORRECT') \g /dev/null
select public.teacher_quiz_q(:eid, :q2, 0, 'FINALIZE') \g /dev/null
select _ok(public.teacher_quiz_state(:eid)->'scores'->'15'->>'total' = '10', '교사가 오답 후보를 정답으로 바꿔 확정');
select _ok(not (public.teacher_quiz_state(:eid)->'event'->>'checkpoint_ready')::boolean, '2문제 후에는 중간 공개 시점 아님');
select public.teacher_quiz_q(:eid, :q2, 0, 'NEXT') \g /dev/null
select (public.teacher_quiz_state(:eid)->'event'->>'current_question_id')::bigint as q3 \gset
select public.teacher_quiz_q(:eid, :q3, 0, 'START') \g /dev/null
select public.teacher_quiz_q(:eid, :q3, 0, 'REVEAL', '{"lock":true}') \g /dev/null
select public.teacher_quiz_q(:eid, :q3, 0, 'FINALIZE') \g /dev/null
select _ok((public.teacher_quiz_state(:eid)->'event'->>'checkpoint_ready')::boolean, '3문제 확정 → 중간 공개 준비');
select _ok(public.teacher_quiz_screen_state(:eid)->'board'->'snapshot'->'scores'->>'12' = '0', '교사가 누르기 전에는 순위판 그대로');
select public.teacher_quiz_publish_board(:eid) \g /dev/null
select _ok(public.teacher_quiz_screen_state(:eid)->'board'->'snapshot'->'scores'->>'12' = '20', '중간 공개 뒤 순위판 갱신');

--------------------------------------------------------------------------
-- J. 점수 정정 · 무효 · 재출제
--------------------------------------------------------------------------
select public.teacher_quiz_correct(:eid, :q1, 14, 'CORRECT', '띄어쓰기 표기 인정') \g /dev/null
select _ok(public.teacher_quiz_state(:eid)->'scores'->'14'->>'total' = '10', '정정 후 누적 점수 1회 재계산');
select _ok((public.teacher_quiz_state(:eid)->>'board_stale')::boolean, '공개 점수와 달라졌음을 표시');
select _ok((select count(*) = 1 from jsonb_array_elements(public.teacher_quiz_audit(:eid)) x where x->>'action' = 'CORRECT_GRADE'
  and x->'detail'->'before'->>'verdict' = 'WRONG' and x->'detail'->>'reason' = '띄어쓰기 표기 인정'), '정정 이력(전·후·사유) 보존');
select _expect(format($$select public.teacher_quiz_correct(%s, %s, 14, 'CORRECT', '두 번')$$, :eid, :q1), 'P7T05', '같은 정정 반복은 무해');
select _expect(format($$select public.teacher_quiz_correct(%s, %s, 14, 'WRONG', '')$$, :eid, :q1), 'P7T04', '정정 사유 필수');

select public.teacher_quiz_q(:eid, :q3, 0, 'NEXT') \g /dev/null
select (public.teacher_quiz_state(:eid)->'event'->>'current_question_id')::bigint as q4 \gset
select _ok((public.teacher_quiz_screen_state(:eid)->>'handoff')::boolean and public.teacher_quiz_screen_state(:eid)->'question'->>'position_label' = '차봉', '차봉전 교체 안내');
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok(public.student_quiz_state(:eid)->>'player' = '학생2', '태블릿: 차봉 학생2');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
-- 경기 중 선수 교체: 사유 필수, 이미 출제한 포지션은 불가
select _expect(format($$select public.teacher_quiz_set_roster(%s, '[{"guild_id":12,"position_index":1,"student_id":3}]')$$, :eid), 'P7T04', '경기 중 교체는 사유 필수');
select _expect(format($$select public.teacher_quiz_set_roster(%s, '[{"guild_id":12,"position_index":0,"student_id":3}]', '실수')$$, :eid), 'P7T03', '이미 출제한 선봉은 교체 불가');
select public.teacher_quiz_set_roster(:eid, '[{"guild_id":12,"position_index":1,"student_id":3}]'::jsonb, '학생2 보건실') \g /dev/null
select _ok((select count(*) = 1 from jsonb_array_elements(public.teacher_quiz_audit(:eid)) x where x->>'action' = 'SWAP_PLAYER'), '선수 교체 이력');
select public.teacher_quiz_set_roster(:eid, '[{"guild_id":12,"position_index":1,"student_id":2}]'::jsonb, '복귀') \g /dev/null

select public.teacher_quiz_q(:eid, :q4, 0, 'START') \g /dev/null
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select public.student_quiz_submit(:eid, :q4, 0, '정답11') \g /dev/null
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _expect(format($$select public.teacher_quiz_q(%s, %s, 0, 'REISSUE')$$, :eid, :q4), 'P7T04', '재출제 사유 필수');
select public.teacher_quiz_q(:eid, :q4, 0, 'REISSUE', '{"reason":"와이파이 끊김"}') \g /dev/null
select _ok((select (x->>'attempt')::int from jsonb_array_elements(public.teacher_quiz_state(:eid)->'questions') x where (x->>'id')::bigint = :q4) = 1, '재출제 → 회차 1');
reset role;
select _ok((select count(*) = 1 from public.quiz_answers where question_id = :q4 and attempt = 0), '지난 회차 답안은 기록으로 남음');
select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok((public.student_quiz_submit(:eid, :q4, 0, '다른답')->>'already')::boolean, '지난 회차로 다시 보내면 기존 기록만 돌려줌');
select _expect(format($$select public.student_quiz_submit(%s, %s, 1, '정답11')$$, :eid, :q4), 'P7T03', '새 회차 시작 전 제출 불가');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q4, 1, 'START') \g /dev/null
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok((public.student_quiz_submit(:eid, :q4, 1, '정답11')->>'already')::boolean = false, '새 회차에 다시 제출 가능');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_q(:eid, :q4, 1, 'REVEAL', '{"lock":true}') \g /dev/null
select public.teacher_quiz_q(:eid, :q4, 1, 'AUTO_GRADE') \g /dev/null
select public.teacher_quiz_q(:eid, :q4, 1, 'FINALIZE') \g /dev/null
select _ok(public.teacher_quiz_state(:eid)->'scores'->'12'->>'total' = '30', '재출제 문제 점수는 새 회차 기준 1번만');
select _expect(format($$select public.teacher_quiz_q(%s, %s, 1, 'VOID')$$, :eid, :q4), 'P7T04', '무효 사유 필수');
select public.teacher_quiz_q(:eid, :q4, 1, 'VOID', '{"reason":"문제 오류"}') \g /dev/null
select _ok(public.teacher_quiz_state(:eid)->'scores'->'12'->>'total' = '20', '무효 처리한 문제 점수는 빠짐');

--------------------------------------------------------------------------
-- K. 개인전 나머지 빠르게 → 개인전 대형 발표
--------------------------------------------------------------------------
reset role;
do $$
declare v_e bigint; v_q bigint; v_a int; i int := 0;
begin
  select id into v_e from public.quiz_events order by id desc limit 1;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
  execute 'set local role authenticated';
  perform public.teacher_quiz_q(v_e, (public.teacher_quiz_state(v_e)->'event'->>'current_question_id')::bigint, 1, 'NEXT');
  loop
    exit when public.teacher_quiz_state(v_e)->'event'->>'phase' <> 'INDIVIDUAL';
    v_q := (public.teacher_quiz_state(v_e)->'event'->>'current_question_id')::bigint;
    select (x->>'attempt')::int into v_a from jsonb_array_elements(public.teacher_quiz_state(v_e)->'questions') x where (x->>'id')::bigint = v_q;
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'START');
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'REVEAL', '{"lock":true}');
    -- 문제마다 길드 하나씩 돌아가며 정답 처리
    perform public.teacher_quiz_grade(v_e, v_q, v_a, (array[12,13,14,15,16])[1 + (i % 5)], 'CORRECT');
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'FINALIZE');
    perform public.teacher_quiz_q(v_e, v_q, v_a, 'NEXT');
    i := i + 1;
  end loop;
end $$;
select _ok(public.teacher_quiz_state(:eid)->'event'->>'phase' = 'IND_CEREMONY', '개인전 끝 → 개인전 발표 단계');
select _ok((public.teacher_quiz_screen_state(:eid)->'result'->>'total')::int = 5 and jsonb_array_length(public.teacher_quiz_screen_state(:eid)->'result'->'guilds') = 0, '발표 시작 전 순위 0개 공개(스포일러 없음)');
select _ok((public.teacher_quiz_screen_state(:eid)->'result'->>'max_ind')::int = 140, '개인전 만점 = 무효 1문제 뺀 140');
select _expect(format($$select public.teacher_quiz_ceremony(%s, 'ADVANCE')$$, :eid), 'P7T03', '끝까지 공개하기 전에는 단체전으로 못 넘어감');
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select _ok(jsonb_array_length(public.teacher_quiz_screen_state(:eid)->'result'->'guilds') = 1, '1단계: 1개 길드 공개');
select _ok((select (x->>'score')::int from jsonb_array_elements(public.teacher_quiz_screen_state(:eid)->'result'->'guilds') x limit 1)
  = (select min((v->>'ind')::int) from jsonb_each(public.teacher_quiz_state(:eid)->'scores') t(k, v)), '가장 낮은 점수부터 공개');
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select _expect(format($$select public.teacher_quiz_ceremony(%s, 'STEP')$$, :eid), 'P7T05', '모두 공개 뒤 더 누르면 무해');
select public.teacher_quiz_ceremony(:eid, 'ADVANCE') \g /dev/null
select _ok(public.teacher_quiz_state(:eid)->'event'->>'phase' = 'TEAM', '단체전 입장');
select _ok(public.teacher_quiz_screen_state(:eid)->'board'->'snapshot'->>'label' = '개인전 결과', '단체전 순위판 = 개인전 결과');

--------------------------------------------------------------------------
-- L. 단체전: 미디어 권한 · 진행 · 최종 발표 · 종료
--------------------------------------------------------------------------
select (public.teacher_quiz_state(:eid)->'event'->>'current_question_id')::bigint as t1 \gset
reset role; insert into storage.objects (bucket_id, name) values ('quiz-media', '1/' || :eid || '/team1.png'), ('quiz-media', '1/' || :eid || '/other.png');
select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok((select count(*) from storage.objects) = 0, '미디어: 보여 주기 전에는 대표 계정도 못 읽음');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _ok((select count(*) from storage.objects) = 2, '미디어: 교사는 자기 반 파일을 읽음');
select _expect($$insert into storage.objects (bucket_id, name) values ('quiz-media', '2/1/x.png')$$, '42501', '미디어: 다른 반 폴더에는 못 올림');
insert into storage.objects (bucket_id, name) values ('quiz-media', '1/' || :eid || '/upload.png');
select public.teacher_quiz_q(:eid, :t1, 0, 'SHOW') \g /dev/null
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok((select array_agg(name) from storage.objects) = array['1/' || :eid || '/team1.png'], '미디어: 보여 준 문제의 파일 1개만 읽음');
select _ok(public.student_quiz_state(:eid)->'question'->>'media_path' = '1/' || :eid || '/team1.png', '태블릿: 지금 문제의 미디어 경로 받음');
select _expect($$insert into storage.objects (bucket_id, name) values ('quiz-media', '1/1/hack.png')$$, '42501', '미디어: 학생은 올릴 수 없음');
reset role; select _who('00000000-0000-0000-0000-000000000002'); set role authenticated;
select _ok((select count(*) from storage.objects) = 0, '미디어: 대표가 아닌 학생은 못 읽음');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;

reset role;
do $$
declare v_e bigint; v_q bigint; i int := 0;
begin
  select id into v_e from public.quiz_events order by id desc limit 1;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
  execute 'set local role authenticated';
  loop
    exit when public.teacher_quiz_state(v_e)->'event'->>'phase' <> 'TEAM';
    v_q := (public.teacher_quiz_state(v_e)->'event'->>'current_question_id')::bigint;
    perform public.teacher_quiz_q(v_e, v_q, 0, 'START');
    perform public.teacher_quiz_q(v_e, v_q, 0, 'REVEAL', '{"lock":true}');
    perform public.teacher_quiz_grade(v_e, v_q, 0, 16, 'CORRECT');
    perform public.teacher_quiz_q(v_e, v_q, 0, 'FINALIZE');
    perform public.teacher_quiz_q(v_e, v_q, 0, 'NEXT');
    i := i + 1;
  end loop;
end $$;
select _ok(public.teacher_quiz_state(:eid)->'event'->>'phase' = 'FINAL_CEREMONY', '단체전 끝 → 최종 발표 단계');
select _ok(public.teacher_quiz_state(:eid)->'scores'->'16'->>'team' = '150', '단체전 점수 별도 집계(아블루션 150)');
select _ok((public.teacher_quiz_state(:eid)->'event'->'final_result'->'guilds'->4->>'guild_id')::int = 16, '최종 1위(마지막 공개) = 아블루션');
-- 최종 발표: 5위·4위·3위는 한 길드씩, 마지막 1·2위는 한 번에, 그다음 전체 순위 화면
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select _ok((public.teacher_quiz_state(:eid)->'event'->>'ceremony_step')::int = 3
  and jsonb_array_length(public.teacher_quiz_screen_state(:eid)->'result'->'guilds') = 3, '최종 발표: 3단계까지 하위 3개 길드만 공개');
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select _ok((public.teacher_quiz_state(:eid)->'event'->>'ceremony_step')::int = 5
  and jsonb_array_length(public.teacher_quiz_screen_state(:eid)->'result'->'guilds') = 5, '최종 발표: 4번째 누름 → 1·2위 동시 공개(단계 3→5)');
select public.teacher_quiz_ceremony(:eid, 'BACK') \g /dev/null
select _ok((public.teacher_quiz_state(:eid)->'event'->>'ceremony_step')::int = 3, '최종 발표: 한 단계 전 → 1·2위가 함께 다시 가려짐(5→3)');
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select public.teacher_quiz_ceremony(:eid, 'STEP') \g /dev/null
select _ok((public.teacher_quiz_state(:eid)->'event'->>'ceremony_step')::int = 6, '최종 발표: 마지막 전체 순위 화면(단계 6)');
select _expect(format($$select public.teacher_quiz_ceremony(%s, 'STEP')$$, :eid), 'P7T05', '최종 발표: 모두 공개 뒤 더 누르면 무해');
select public.teacher_quiz_ceremony(:eid, 'ADVANCE') \g /dev/null
select _ok(public.teacher_quiz_state(:eid)->'event'->>'phase' = 'COMPLETED', '대회 종료');
reset role; select _who('00000000-0000-0000-0000-000000000001'); set role authenticated;
select _ok(jsonb_array_length(public.student_quiz_feed()->'events') = 0, '끝난 대회는 학생 입구에서 사라짐');
reset role; select _who('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select _expect(format('select public.teacher_quiz_delete(%s)', :eid), 'P7T03', '실제 경기 기록은 지울 수 없음');
select _ok(jsonb_array_length(public.teacher_quiz_audit(:eid)) > 30, '전체 운영 이력 보존');

--------------------------------------------------------------------------
-- M. 리허설 대회는 지울 수 있다 · 경기 중 문제 추가 제한
--------------------------------------------------------------------------
select (public.teacher_quiz_create('리허설', true)->>'id')::bigint as rid \gset
select public.teacher_quiz_save_questions(:rid, '[{"stage":"TEAM","prompt":"q","answer_key":"a"}]') \g /dev/null
select public.teacher_quiz_delete(:rid) \g /dev/null
reset role;
select _ok(not exists(select 1 from public.quiz_events where id = :rid) and not exists(select 1 from public.quiz_questions where event_id = :rid), '리허설 대회 삭제(문제까지)');
select _ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'brand_quiz' and has_function_privilege('authenticated', p.oid, 'execute')) = 0, '내부 함수는 authenticated 실행 권한 없음');
select _ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like '%quiz%' and has_function_privilege('anon', p.oid, 'execute')) = 0, '퀴즈 함수는 anon 실행 권한 없음');
select _ok((select bool_and(prosecdef) and bool_and(proconfig::text like '%search_path%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%')), '공개 함수 모두 SECURITY DEFINER + search_path 고정');

\echo 'ALL QUIZ ROYAL TESTS PASSED'
