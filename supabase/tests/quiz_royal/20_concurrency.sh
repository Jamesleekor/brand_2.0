#!/usr/bin/env bash
# 5대 동시 제출(대표 계정마다 3번씩 연타) → 정확히 5건, 자동 마감 1번
# run.sh 다음에 같은 DB(quiz_royal_test)에서 실행
set -euo pipefail
P="psql -U ${PGUSER:-postgres} -d quiz_royal_test -v ON_ERROR_STOP=1 -qtA"
EID=$($P <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false) \g /dev/null
set role authenticated;
select (public.teacher_quiz_create('동시성 시험', true)->>'id');
SQL
)
$P <<SQL >/dev/null
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select public.teacher_quiz_save_setup($EID, '동시성 시험', '{"use_individual":false}', '[{"guild_id":12,"device_student_id":1},{"guild_id":13,"device_student_id":5},{"guild_id":14,"device_student_id":9},{"guild_id":15,"device_student_id":14},{"guild_id":16,"device_student_id":19}]');
select public.teacher_quiz_save_questions($EID, '[{"stage":"TEAM","prompt":"동시","answer_key":"답","time_limit_sec":60}]');
select public.teacher_quiz_open_lobby($EID, true);
select public.teacher_quiz_start($EID, '시험');
select public.teacher_quiz_q($EID, (public.teacher_quiz_state($EID)->'event'->>'current_question_id')::bigint, 0, 'START', '{"reason":"시험"}');
SQL
QID=$($P -c "select current_question_id from public.quiz_events where id = $EID")
for U in 001 005 009 014 019; do
  for K in 1 2 3; do
    $P -c "select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000$U', false); set role authenticated; select public.student_quiz_submit($EID, $QID, 0, '답$K');" >/dev/null 2>&1 &
  done
done
wait
R=$($P -c "select (select count(*) from public.quiz_answers where question_id = $QID and submitted_at is not null) || ',' || (select q_phase from public.quiz_events where id = $EID) || ',' || (select count(*) from public.quiz_audit where event_id = $EID and action = 'LOCK')")
echo "submitted,q_phase,lock_logs = $R"
[ "$R" = "5,LOCKED,1" ] && echo "CONCURRENCY TEST PASSED" || { echo "CONCURRENCY TEST FAILED"; exit 1; }
