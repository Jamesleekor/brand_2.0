#!/usr/bin/env bash
# Starlink / ephemeral PostgreSQL-only 24 parallel certification submissions.
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=starlink_ci}"

psql -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE public.arcade_verification_period_games
SET verification_closed_at=NULL
WHERE id=101;

CREATE TABLE public.starlink_ci_events(payload jsonb NOT NULL);
INSERT INTO public.starlink_ci_events(payload)
VALUES ('[
  {"type":"PATH_START","elapsed_ms":100,"cell":22},
  {"type":"CELL_ENTER","elapsed_ms":150,"cell":29},
  {"type":"CELL_ENTER","elapsed_ms":200,"cell":30},
  {"type":"CELL_ENTER","elapsed_ms":220,"cell":36},
  {"type":"PATH_RELEASE","elapsed_ms":250},
  {"type":"PATH_START","elapsed_ms":450,"cell":3},
  {"type":"CELL_ENTER","elapsed_ms":470,"cell":9},
  {"type":"CELL_ENTER","elapsed_ms":490,"cell":10},
  {"type":"PATH_RELEASE","elapsed_ms":500}
]'::jsonb);

INSERT INTO public.arcade_verification_sessions
  (id,status,period_id,game_id,student_id,rule_version_id)
SELECT 400+n,'ACTIVE',100,g.id,101+n,rv.id
FROM generate_series(0,23) AS n
CROSS JOIN public.arcade_games g
JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';

INSERT INTO public.arcade_verification_seed_assignments
  (period_game_id,student_id,opportunity_number,seed_slot_id)
SELECT 101,101+n,1,slot.id
FROM generate_series(0,23) AS n
JOIN public.arcade_verification_seed_pack_slots slot
  ON slot.period_game_id=101 AND slot.slot_code='A';

INSERT INTO public.arcade_runs
  (id,classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,
   run_nonce,play_started_at,run_context,verification_session_id)
SELECT
  100+n,1,101+n,g.id,rv.id,'PLAYING',6059,
  gen_random_uuid(),clock_timestamp()-interval '60 seconds',
  'VERIFICATION',400+n
FROM generate_series(0,23) AS n
CROSS JOIN public.arcade_games g
JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';

INSERT INTO public.arcade_verification_attempts
  (id,run_id,session_id,opportunity_number,status,consumed)
SELECT 500+n,100+n,400+n,1,'ISSUED',true
FROM generate_series(0,23) AS n;
COMMIT;
SQL

declare -a pids=()
for ((n=0; n<24; n++)); do
  (
    student=$((101+n))
    run=$((100+n))
    result=$(psql -qAt -v ON_ERROR_STOP=1 -c "
      SET app.starlink_student_id TO '${student}';
      SELECT (public.student_submit_starlink_04_run(
        r.id,r.run_nonce,
        (SELECT payload FROM public.starlink_ci_events LIMIT 1),
        60000
      )->>'accepted')::boolean
      FROM public.arcade_runs r WHERE r.id=${run};
    ")
    if [[ "${result//$'\n'/}" != "t" ]]; then
      echo "[FAIL] student ${student} run ${run} result: ${result}" >&2
      exit 1
    fi
  ) &
  pids+=("$!")
done

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then failed=1; fi
done
if ((failed)); then
  echo "[FAIL] 24-client parallel Starlink certification submit failed." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.arcade_runs WHERE id BETWEEN 100 AND 123
        AND status='VERIFIED' AND official_score=457)<>24
     OR (SELECT count(*) FROM public.arcade_run_submissions WHERE run_id BETWEEN 100 AND 123)<>24
     OR (SELECT count(*) FROM public.arcade_verification_attempts WHERE id BETWEEN 500 AND 523
        AND status='TERMINAL')<>24
     OR (SELECT count(DISTINCT student_id) FROM public.arcade_runs WHERE id BETWEEN 100 AND 123)<>24 THEN
    RAISE EXCEPTION '[STARLINK 24 CLIENT] results/capture are incomplete or duplicated.';
  END IF;
  RAISE NOTICE '[STARLINK 24 CLIENT] 24 concurrent official submissions passed.';
END;
$assert$;
SQL

echo "[PASS] 24 parallel Starlink verification submissions and common capture."
