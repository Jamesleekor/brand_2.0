-- =====================================================================
-- B.R.A.N.D 2.0 — 출석·일일퀘스트 기록 창 V1 (명세 v1.3, 2026-11-18)
-- ---------------------------------------------------------------------
-- 추가만 한다. 기존 테이블·함수·이력은 바꾸지 않는다.
--   1) classroom_closures            : 학급 휴업일(공휴일·대체공휴일·학교 휴업일·방학)
--   2) legacy_daily_quest_results    : 2026-08-24~09-01 일일퀘스트 4종 결과(담임 제공 명단)
--   3) _is_school_day(int, date)     : 운영일 공통 판단(내부 helper)
--   4) student_get_my_attendance_quest_calendar(date) : 학생 본인 월 단위 조회(읽기 전용)
--
-- 이 migration은 attendances / daily_quest_reports / daily_quest_checks /
-- transactions / student_achievements 에 어떤 쓰기도 하지 않는다.
-- 기존 출석 체크·일퀘 원장 생성·보상 함수는 새 테이블을 읽지 않는다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 휴업일 테이블
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classroom_closures (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  start_date   date    NOT NULL,
  end_date     date    NOT NULL,
  kind         text    NOT NULL,
  label        text    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_closures_kind_check
    CHECK (kind IN ('PUBLIC_HOLIDAY','SUBSTITUTE_HOLIDAY','SCHOOL_CLOSURE','VACATION')),
  CONSTRAINT classroom_closures_label_check
    CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  CONSTRAINT classroom_closures_date_order_check
    CHECK (end_date >= start_date),
  CONSTRAINT classroom_closures_unique
    UNIQUE (classroom_id, start_date, end_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_classroom_closures_classroom_range
  ON public.classroom_closures (classroom_id, start_date, end_date);

ALTER TABLE public.classroom_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.classroom_closures FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.classroom_closures IS
  '학급 휴업일. 주말은 넣지 않는다(규칙으로 계산). 출석·일퀘 기록 창과 운영일 판단(_is_school_day) 전용.';

-- 시드: 5학년 4반(classroom_id=1), 2학기 조회 범위 안 휴업일 (담임 확인 2026-11-18)
INSERT INTO public.classroom_closures (classroom_id, start_date, end_date, kind, label)
VALUES
  (1, DATE '2026-09-24', DATE '2026-09-25', 'PUBLIC_HOLIDAY',     '추석'),
  (1, DATE '2026-10-05', DATE '2026-10-05', 'SUBSTITUTE_HOLIDAY', '개천절 대체공휴일'),
  (1, DATE '2026-10-09', DATE '2026-10-09', 'PUBLIC_HOLIDAY',     '한글날'),
  (1, DATE '2026-12-25', DATE '2026-12-25', 'PUBLIC_HOLIDAY',     '성탄절'),
  (1, DATE '2027-01-01', DATE '2027-01-01', 'PUBLIC_HOLIDAY',     '1월 1일')
ON CONFLICT ON CONSTRAINT classroom_closures_unique DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) 2학기 첫 주 보관 테이블 (기존 일퀘 원장과 분리)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legacy_daily_quest_results (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  student_id   integer NOT NULL REFERENCES public.students(id),
  quest_date   date    NOT NULL,
  quest_code   text    NOT NULL,
  result       text    NOT NULL,
  source_note  text    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_daily_quest_results_date_check
    CHECK (quest_date BETWEEN DATE '2026-08-24' AND DATE '2026-09-01'),
  CONSTRAINT legacy_daily_quest_results_code_check
    CHECK (quest_code IN ('ATTENDANCE','PRIMARY_JOB','LEARNING_MATERIALS','CLEANING')),
  CONSTRAINT legacy_daily_quest_results_result_check
    CHECK (result IN ('PASS','FAIL')),
  CONSTRAINT legacy_daily_quest_results_unique
    UNIQUE (student_id, quest_date, quest_code)
);

CREATE INDEX IF NOT EXISTS idx_legacy_daily_quest_results_student_date
  ON public.legacy_daily_quest_results (student_id, quest_date);

ALTER TABLE public.legacy_daily_quest_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legacy_daily_quest_results FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.legacy_daily_quest_results IS
  '2026-08-24~09-01(상세 원장 전환 전) 일일퀘스트 4종 결과. 담임 제공 명단. 기록 창 조회 전용이며 보상·업적 판정에 쓰지 않는다.';

-- 시드: 담임 제공 실패 명단. 명단에 없는 학생·항목은 PASS.
DO $seed$
DECLARE
  v_student_count integer;
  v_found_names   integer;
  v_inserted      integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.legacy_daily_quest_results WHERE classroom_id = 1) THEN
    RAISE NOTICE 'legacy_daily_quest_results: classroom 1 already seeded, skip';
    RETURN;
  END IF;

  CREATE TEMP TABLE _ldq_fail (d date, n text, code text) ON COMMIT DROP;
  INSERT INTO _ldq_fail (d, n, code) VALUES
    ('2026-08-24','김선율','PRIMARY_JOB'),('2026-08-24','박서은','PRIMARY_JOB'),
    ('2026-08-24','이태우','PRIMARY_JOB'),('2026-08-24','한동준','PRIMARY_JOB'),
    ('2026-08-25','정민준','PRIMARY_JOB'),('2026-08-25','한동준','PRIMARY_JOB'),
    ('2026-08-26','김윤우','PRIMARY_JOB'),('2026-08-26','김윤우','CLEANING'),
    ('2026-08-26','이예준','PRIMARY_JOB'),('2026-08-26','이예준','CLEANING'),
    ('2026-08-26','이한성','PRIMARY_JOB'),('2026-08-26','이한성','CLEANING'),
    ('2026-08-26','지담','PRIMARY_JOB'),  ('2026-08-26','지담','CLEANING'),
    ('2026-08-26','한서현','PRIMARY_JOB'),('2026-08-26','한서현','CLEANING'),
    ('2026-08-26','김나연','CLEANING'),('2026-08-26','김서영','CLEANING'),
    ('2026-08-26','김선율','CLEANING'),('2026-08-26','김종현','CLEANING'),
    ('2026-08-26','류은우','CLEANING'),('2026-08-26','이아정','CLEANING'),
    ('2026-08-26','정우림','CLEANING'),('2026-08-26','한동준','CLEANING'),
    ('2026-08-27','김선율','CLEANING'),('2026-08-27','박시현','CLEANING'),
    ('2026-08-27','우서윤','CLEANING'),('2026-08-27','이예준','CLEANING'),
    ('2026-08-27','이하람','CLEANING'),('2026-08-27','이현석','CLEANING'),
    ('2026-08-27','한동준','CLEANING'),('2026-08-27','이준혁','CLEANING'),
    ('2026-08-28','김나연','PRIMARY_JOB'),('2026-08-28','김윤우','PRIMARY_JOB'),
    ('2026-08-28','부희주','PRIMARY_JOB'),('2026-08-28','한동준','PRIMARY_JOB'),
    ('2026-08-28','한서현','LEARNING_MATERIALS'),
    ('2026-08-31','김나연','PRIMARY_JOB'),('2026-08-31','김선율','PRIMARY_JOB'),
    ('2026-08-31','한동준','PRIMARY_JOB'),
    ('2026-09-01','김나연','ATTENDANCE'),('2026-09-01','김나연','LEARNING_MATERIALS'),
    ('2026-09-01','김나연','PRIMARY_JOB'),
    ('2026-09-01','김서영','PRIMARY_JOB'),('2026-09-01','박시현','PRIMARY_JOB'),
    ('2026-09-01','김선율','PRIMARY_JOB');

  CREATE TEMP TABLE _ldq_students ON COMMIT DROP AS
    SELECT s.id, s.name::text AS name
      FROM public.students s
     WHERE s.classroom_id = 1
       AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
       AND coalesce(s.is_test_account, false) = false;

  SELECT count(*) INTO v_student_count FROM _ldq_students;
  IF v_student_count <> 24 THEN
    RAISE EXCEPTION 'legacy seed: expected 24 real students in classroom 1, found %', v_student_count;
  END IF;

  IF EXISTS (SELECT 1 FROM _ldq_students GROUP BY name HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'legacy seed: duplicate student names in classroom 1';
  END IF;

  SELECT count(DISTINCT f.n) INTO v_found_names
    FROM _ldq_fail f JOIN _ldq_students s ON s.name = f.n;
  IF v_found_names <> 22 OR EXISTS (
    SELECT 1 FROM _ldq_fail f WHERE NOT EXISTS (SELECT 1 FROM _ldq_students s WHERE s.name = f.n)
  ) THEN
    RAISE EXCEPTION 'legacy seed: name mapping mismatch (matched % of 22)', v_found_names;
  END IF;

  INSERT INTO public.legacy_daily_quest_results
    (classroom_id, student_id, quest_date, quest_code, result, source_note)
  SELECT 1, s.id, d.d, q.code,
         CASE WHEN EXISTS (SELECT 1 FROM _ldq_fail f WHERE f.d = d.d AND f.n = s.name AND f.code = q.code)
              THEN 'FAIL' ELSE 'PASS' END,
         CASE WHEN s.name = '한서현' AND d.d = DATE '2026-08-28' AND q.code = 'LEARNING_MATERIALS'
              THEN '담임 제공 명단 2026-11-17 · 담임 확인: 출석 또는 준비물 중 하나, 준비물로 표기'
              ELSE '담임 제공 명단 2026-11-17' END
    FROM _ldq_students s
   CROSS JOIN (VALUES (DATE '2026-08-24'),(DATE '2026-08-25'),(DATE '2026-08-26'),(DATE '2026-08-27'),
                      (DATE '2026-08-28'),(DATE '2026-08-31'),(DATE '2026-09-01')) AS d(d)
   CROSS JOIN (VALUES ('ATTENDANCE'),('PRIMARY_JOB'),('LEARNING_MATERIALS'),('CLEANING')) AS q(code);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 672 THEN
    RAISE EXCEPTION 'legacy seed: expected 672 rows, inserted %', v_inserted;
  END IF;
END
$seed$;

-- ---------------------------------------------------------------------
-- 3) 운영일 공통 판단 helper (내부 전용)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_school_day(p_classroom_id integer, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_date IS NOT NULL
     AND extract(isodow FROM p_date) < 6
     AND NOT EXISTS (
       SELECT 1
         FROM public.classroom_closures c
        WHERE c.classroom_id = p_classroom_id
          AND p_date BETWEEN c.start_date AND c.end_date
     );
$fn$;

REVOKE ALL ON FUNCTION public._is_school_day(integer, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._is_school_day(integer, date) IS
  '주말도 아니고 classroom_closures 기간에도 없으면 운영일(true). 비율 계산의 분모 판단에 공통 사용.';

-- ---------------------------------------------------------------------
-- 4) 학생 본인 월 단위 기록 조회 (읽기 전용)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_my_attendance_quest_calendar(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  -- 조회 범위(명세 11.1). 이 함수 한 곳에서만 정한다.
  c_range_start  constant date := DATE '2026-08-24';
  c_range_end    constant date := DATE '2027-01-05';
  c_cutover      constant date := DATE '2026-09-02';

  v_student_id   integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_now          timestamptz := clock_timestamp();
  v_today        date := timezone('Asia/Seoul', clock_timestamp())::date;
  v_enrolled     date;
  v_transferred  date;
  v_earliest_month date := date_trunc('month', c_range_start)::date;
  v_latest_month   date;
  v_month        date;
  v_month_end    date;
  v_range_start  date;
  v_range_end    date;
  v_days         jsonb;
  v_weeks        jsonb;
  v_achievement  jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE = 'P0337';
  END IF;

  SELECT s.enrolled_at, s.transferred_at
    INTO v_enrolled, v_transferred
    FROM public.students s
   WHERE s.id = v_student_id
     AND s.classroom_id = v_classroom_id
     AND s.transferred_at IS NULL
     AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD');

  IF NOT FOUND THEN
    RAISE EXCEPTION '활성 학생 계정을 확인할 수 없습니다.' USING ERRCODE = 'P0338';
  END IF;

  -- 조회 가능한 월: 2026-08 ~ min(현재 월, 2027-01)
  v_latest_month := greatest(
    v_earliest_month,
    least(date_trunc('month', v_today)::date, date_trunc('month', c_range_end)::date)
  );
  v_month := coalesce(date_trunc('month', p_month)::date, v_latest_month);
  v_month := least(greatest(v_month, v_earliest_month), v_latest_month);
  v_month_end := (v_month + interval '1 month' - interval '1 day')::date;

  -- 그 달의 모든 날짜 + 경계 ISO 주의 월~금
  v_range_start := v_month - (extract(isodow FROM v_month)::integer - 1);
  v_range_end   := greatest(v_month_end,
                            v_month_end - (extract(isodow FROM v_month_end)::integer - 1) + 4);

  WITH dates AS (
    SELECT g::date AS d
      FROM generate_series(v_range_start, v_range_end, interval '1 day') AS g
  ),
  base AS (
    SELECT
      dt.d,
      a.status::text           AS att_status,
      a.record_source          AS att_record_source,
      cl.kind                  AS closure_kind,
      cl.label                 AS closure_label,
      r.id                     AS report_id,
      r.status                 AS report_status,
      coalesce(ck.cnt, 0)          AS ck_cnt,
      coalesce(ck.distinct_cnt, 0) AS ck_distinct,
      coalesce(ck.unchecked_cnt,0) AS ck_unchecked,
      coalesce(ck.pass_cnt, 0)     AS ck_pass,
      ck.checks                    AS ck_checks,
      coalesce(lg.cnt, 0)          AS lg_cnt,
      coalesce(lg.pass_cnt, 0)     AS lg_pass,
      lg.checks                    AS lg_checks,
      public._is_school_day(v_classroom_id, dt.d) AS is_school_day
    FROM dates dt
    LEFT JOIN public.attendances a
           ON a.student_id = v_student_id
          AND a.attendance_date = dt.d
    LEFT JOIN LATERAL (
      SELECT c.kind, c.label
        FROM public.classroom_closures c
       WHERE c.classroom_id = v_classroom_id
         AND dt.d BETWEEN c.start_date AND c.end_date
       ORDER BY c.start_date, c.id
       LIMIT 1
    ) cl ON true
    LEFT JOIN public.daily_quest_reports r
           ON r.classroom_id = v_classroom_id
          AND r.quest_date = dt.d
          AND dt.d >= c_cutover
    LEFT JOIN LATERAL (
      SELECT count(*)                                         AS cnt,
             count(DISTINCT c.quest_code)                     AS distinct_cnt,
             count(*) FILTER (WHERE c.result = 'UNCHECKED')   AS unchecked_cnt,
             count(*) FILTER (WHERE c.result = 'PASS')        AS pass_cnt,
             jsonb_object_agg(c.quest_code, c.result)         AS checks
        FROM public.daily_quest_checks c
       WHERE c.report_id = r.id
         AND c.student_id = v_student_id
    ) ck ON r.id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT count(*)                                  AS cnt,
             count(*) FILTER (WHERE l.result = 'PASS') AS pass_cnt,
             jsonb_object_agg(l.quest_code, l.result)  AS checks
        FROM public.legacy_daily_quest_results l
       WHERE l.student_id = v_student_id
         AND l.quest_date = dt.d
    ) lg ON dt.d < c_cutover
  ),
  flags AS (
    SELECT b.*,
      (b.d < c_range_start OR b.d > c_range_end)                                  AS out_of_range,
      ((v_enrolled IS NOT NULL AND b.d < v_enrolled)
        OR (v_transferred IS NOT NULL AND b.d > v_transferred))                   AS not_enrolled,
      (b.report_status = 'SETTLED' AND b.ck_cnt = 4 AND b.ck_distinct = 4
        AND b.ck_unchecked = 0)                                                   AS confirmed_new,
      (b.d < c_cutover AND b.lg_cnt = 4)                                          AS confirmed_legacy
    FROM base b
  ),
  classified AS (
    SELECT f.*,
      CASE
        WHEN f.out_of_range OR f.not_enrolled                         THEN 'CLOSED'
        WHEN (f.confirmed_new OR f.confirmed_legacy) AND f.d > v_today THEN 'CHECK_NEEDED'
        WHEN f.confirmed_new
          THEN CASE WHEN f.ck_pass = 4 THEN 'CLEAR' ELSE 'PARTIAL' END
        WHEN f.confirmed_legacy
          THEN CASE WHEN f.lg_pass = 4 THEN 'CLEAR' ELSE 'PARTIAL' END
        WHEN f.report_status = 'SETTLED'                              THEN 'CHECK_NEEDED'
        WHEN f.d < c_cutover AND f.lg_cnt BETWEEN 1 AND 3             THEN 'CHECK_NEEDED'
        WHEN NOT f.is_school_day                                      THEN 'CLOSED'
        WHEN f.d > v_today                                            THEN 'FUTURE'
        WHEN f.report_id IS NOT NULL OR f.d = v_today                 THEN 'PENDING'
        ELSE 'CHECK_NEEDED'
      END AS day_state,
      CASE
        WHEN f.out_of_range                                           THEN 'OUT_OF_RANGE'
        WHEN f.not_enrolled                                           THEN 'NOT_ENROLLED'
        WHEN (f.confirmed_new OR f.confirmed_legacy) AND f.d > v_today THEN 'DATA_CONFLICT'
        WHEN f.confirmed_new OR f.confirmed_legacy                    THEN NULL
        WHEN f.report_status = 'SETTLED'                              THEN 'MISSING_CHECKS'
        WHEN f.d < c_cutover AND f.lg_cnt BETWEEN 1 AND 3             THEN 'MISSING_CHECKS'
        WHEN NOT f.is_school_day AND f.closure_kind IS NOT NULL       THEN 'CLOSURE'
        WHEN NOT f.is_school_day                                      THEN 'WEEKEND'
        WHEN f.d > v_today                                            THEN NULL
        WHEN f.report_id IS NOT NULL                                  THEN 'REPORT_UNSETTLED'
        WHEN f.d = v_today                                            THEN 'TODAY_NO_REPORT'
        ELSE 'NO_REPORT'
      END AS reason_code,
      CASE
        WHEN f.confirmed_legacy OR (f.d < c_cutover AND f.lg_cnt > 0)  THEN 'LEGACY_TEACHER_RECORD'
        WHEN f.report_id IS NOT NULL                                   THEN 'DAILY_QUEST_CHECKS'
        ELSE 'NONE'
      END AS source,
      CASE
        WHEN f.out_of_range OR f.not_enrolled THEN NULL
        WHEN f.confirmed_legacy OR (f.d < c_cutover AND f.lg_cnt > 0) THEN f.lg_checks
        WHEN f.report_status = 'SETTLED' AND f.ck_cnt > 0 THEN f.ck_checks
        ELSE NULL
      END AS eff_checks
    FROM flags f
  ),
  shaped AS (
    SELECT c.*,
      (c.day_state IN ('CLEAR','PARTIAL')) AS is_settled,
      extract(isodow FROM c.d)::integer    AS dow,
      CASE
        WHEN c.out_of_range OR c.not_enrolled THEN NULL
        WHEN c.att_status IN ('PRESENT','LATE','EXCUSED') THEN true
        WHEN c.att_status IS NOT NULL THEN false
        WHEN c.day_state IN ('CLEAR','PARTIAL') THEN (c.eff_checks->>'ATTENDANCE') = 'PASS'
        ELSE NULL
      END AS attendance_recognized,
      CASE
        WHEN c.out_of_range OR c.not_enrolled THEN NULL
        WHEN c.att_status IS NOT NULL THEN c.att_record_source
        WHEN c.day_state IN ('CLEAR','PARTIAL') THEN 'DAILY_QUEST_FALLBACK'
        ELSE NULL
      END AS attendance_source
    FROM classified c
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'date', s.d,
      'in_month', (s.d BETWEEN v_month AND v_month_end),
      'attendance_status', CASE WHEN s.out_of_range OR s.not_enrolled THEN NULL ELSE s.att_status END,
      'attendance_recognized', s.attendance_recognized,
      'attendance_source', s.attendance_source,
      'day_state', s.day_state,
      'source', s.source,
      'confidence', CASE
                      WHEN s.day_state IN ('CLEAR','PARTIAL') THEN 'VERIFIED'
                      WHEN s.day_state = 'PENDING'            THEN 'UNCONFIRMED'
                      WHEN s.day_state = 'CHECK_NEEDED' AND s.reason_code <> 'NO_REPORT' THEN 'CONFLICT'
                      ELSE NULL
                    END,
      'report_status', s.report_status,
      'pass_count', CASE WHEN s.is_settled
                         THEN CASE WHEN s.confirmed_new THEN s.ck_pass ELSE s.lg_pass END
                         ELSE NULL END,
      'expected_count', 4,
      'checks', jsonb_build_object(
                  'ATTENDANCE',         s.eff_checks->>'ATTENDANCE',
                  'PRIMARY_JOB',        s.eff_checks->>'PRIMARY_JOB',
                  'LEARNING_MATERIALS', s.eff_checks->>'LEARNING_MATERIALS',
                  'CLEANING',           s.eff_checks->>'CLEANING'),
      'failure_codes', CASE WHEN s.is_settled THEN (
                         SELECT coalesce(jsonb_agg(q.code ORDER BY q.ord), '[]'::jsonb)
                           FROM (VALUES (1,'ATTENDANCE'),(2,'PRIMARY_JOB'),(3,'LEARNING_MATERIALS'),(4,'CLEANING')) AS q(ord, code)
                          WHERE s.eff_checks->>q.code = 'FAIL')
                       ELSE '[]'::jsonb END,
      'reason_codes', CASE WHEN s.reason_code IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(s.reason_code) END,
      'closure_kind', CASE WHEN s.day_state = 'CLOSED' AND s.reason_code = 'CLOSURE' THEN s.closure_kind
                           WHEN s.day_state = 'CLOSED' AND s.reason_code = 'WEEKEND' THEN 'WEEKEND'
                           ELSE NULL END,
      'closure_label', CASE WHEN s.day_state = 'CLOSED' AND s.reason_code = 'CLOSURE' THEN s.closure_label ELSE NULL END
    ) ORDER BY s.d), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(w.obj ORDER BY w.week_start)
        FROM (
          SELECT wk.week_start,
                 jsonb_build_object(
                   'week_start', wk.week_start,
                   'week_end', wk.week_start + 4,
                   'settled_days',      count(*) FILTER (WHERE x.is_settled),
                   'complete_days',     count(*) FILTER (WHERE x.day_state = 'CLEAR'),
                   'failed_days',       count(*) FILTER (WHERE x.day_state = 'PARTIAL'),
                   'unconfirmed_days',  count(*) FILTER (WHERE x.day_state = 'PENDING'),
                   'future_days',       count(*) FILTER (WHERE x.day_state = 'FUTURE'),
                   'closed_days',       count(*) FILTER (WHERE x.day_state = 'CLOSED'),
                   'check_needed_days', count(*) FILTER (WHERE x.day_state = 'CHECK_NEEDED'),
                   'pass_total',        coalesce(sum(CASE WHEN x.is_settled
                                                          THEN CASE WHEN x.confirmed_new THEN x.ck_pass ELSE x.lg_pass END
                                                          ELSE 0 END), 0),
                   'expected_total',    4 * count(*) FILTER (WHERE x.is_settled),
                   'record_status', CASE
                       WHEN count(*) FILTER (WHERE x.day_state = 'PARTIAL') > 0 THEN 'HAS_FAIL'
                       WHEN count(*) FILTER (WHERE x.day_state = 'CLEAR') = 5   THEN 'ALL_FIVE_CLEAR'
                       WHEN count(*) FILTER (WHERE x.day_state = 'CHECK_NEEDED') > 0 THEN 'CHECK_NEEDED'
                       WHEN count(*) FILTER (WHERE x.day_state = 'CLOSED') > 0  THEN 'CLOSED_DAY_IN_WEEK'
                       WHEN count(*) FILTER (WHERE x.day_state = 'PENDING' AND x.d < v_today) > 0 THEN 'UNCONFIRMED'
                       WHEN count(*) FILTER (WHERE x.day_state IN ('FUTURE','PENDING')) > 0 THEN 'IN_PROGRESS'
                       ELSE 'GOAL_NOT_MET'
                     END,
                   'warning_codes', to_jsonb(array_remove(ARRAY[
                       CASE WHEN count(*) FILTER (WHERE x.day_state = 'PENDING') > 0 THEN 'HAS_UNCONFIRMED' END,
                       CASE WHEN count(*) FILTER (WHERE x.day_state = 'CHECK_NEEDED') > 0 THEN 'HAS_CHECK_NEEDED' END,
                       CASE WHEN count(*) FILTER (WHERE x.source = 'LEGACY_TEACHER_RECORD') > 0 THEN 'LEGACY_WEEK' END,
                       CASE WHEN count(*) FILTER (WHERE x.out_of_range) > 0 THEN 'OUT_OF_RANGE_DAYS' END
                     ], NULL))
                 ) AS obj
            FROM (
              SELECT g::date AS week_start
                FROM generate_series(v_range_start,
                                     v_month_end - (extract(isodow FROM v_month_end)::integer - 1),
                                     interval '7 day') AS g
            ) wk
            JOIN shaped x ON x.d BETWEEN wk.week_start AND wk.week_start + 4
           GROUP BY wk.week_start
        ) w
    ), '[]'::jsonb)
  INTO v_days, v_weeks
  FROM shaped s;

  -- LIFE-002 「퀘스트 마스터」: 공개 여부·본인 활성 보유만. 공식 신청 가능 판정은 만들지 않는다.
  SELECT CASE
           WHEN a.id IS NULL THEN jsonb_build_object('visible', false)
           WHEN a.is_hidden AND a.revealed_at IS NULL AND NOT coalesce(own.active, false)
             THEN jsonb_build_object('visible', false)
           ELSE jsonb_build_object(
                  'visible', true,
                  'uid', a.achievement_uid,
                  'name', a.name,
                  'condition_text', a.condition_text,
                  'active_ownership', coalesce(own.active, false),
                  'achieved_at', own.achieved_at,
                  'assessment_scope', 'record_summary_only')
         END
    INTO v_achievement
    FROM (SELECT 1) one
    LEFT JOIN public.achievements a
           ON a.classroom_id = v_classroom_id
          AND a.achievement_uid = 'LIFE-002'
          AND a.is_active = true
    LEFT JOIN LATERAL (
      SELECT true AS active, min(sa.achieved_at) AS achieved_at
        FROM public.student_achievements sa
       WHERE sa.student_id = v_student_id
         AND sa.achievement_id = a.id
         AND sa.classroom_id = v_classroom_id
         AND coalesce(sa.is_revoked, false) = false
      HAVING count(*) > 0
    ) own ON a.id IS NOT NULL;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'kst_today', v_today,
    'fetched_at', v_now,
    'month', v_month,
    'range_start', v_range_start,
    'range_end', v_range_end,
    'coverage', jsonb_build_object(
      'earliest_available_date', c_range_start,
      'latest_available_date', c_range_end,
      'earliest_month', v_earliest_month,
      'latest_selectable_month', v_latest_month,
      'detail_ledger_cutover', c_cutover
    ),
    'days', v_days,
    'weeks', v_weeks,
    'achievement', coalesce(v_achievement, jsonb_build_object('visible', false))
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.student_get_my_attendance_quest_calendar(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_get_my_attendance_quest_calendar(date) TO authenticated;

COMMENT ON FUNCTION public.student_get_my_attendance_quest_calendar(date) IS
  '학생 본인 출석·일일퀘스트 월 기록(읽기 전용). 2026-08-24~2027-01-05. 날짜 상태 CLEAR/PARTIAL/PENDING/FUTURE/CLOSED/CHECK_NEEDED.';
