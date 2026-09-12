-- =============================================================================
-- B.R.A.N.D 2.0 — Rakaruka official day gate + one attempt per student/period
-- 2026-09-13
--
-- Confirmed operating rule:
--   * Official challenge is available only while the teacher opens Official Day.
--   * One student may create exactly ONE five-match official session per KST month.
--   * The single attempt is consumed even if the final 5-match score is not qualified.
--   * Closing Official Day blocks NEW sessions only. Already-started sessions may
--     finish their remaining matches.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tikatuka_official_sessions') IS NULL
     OR to_regclass('public.tikatuka_progress') IS NULL
     OR to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] official-day prerequisites are missing.' USING ERRCODE = 'PTK40';
  END IF;

  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.tikatuka_competition_payload(integer,integer)') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] official-day helpers are missing.' USING ERRCODE = 'PTK40';
  END IF;
END;
$$;

CREATE TABLE public.tikatuka_official_windows (
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_key date NOT NULL,
  is_open boolean NOT NULL DEFAULT false,
  opened_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, period_key),
  CONSTRAINT tikatuka_official_window_time_check CHECK (
    (is_open = true AND opened_at IS NOT NULL AND closed_at IS NULL)
    OR (is_open = false)
  )
);

ALTER TABLE public.tikatuka_official_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tikatuka_official_windows FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.tikatuka_official_windows IS
  'Teacher-controlled Rakaruka Official Day start gate. Closing does not cancel already-started five-match sessions.';

-- Existing production currently has no official sessions, but fail safely if the
-- migration is ever replayed onto a database that already contains duplicate attempts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions
    GROUP BY classroom_id, student_id, period_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '[TIKATUKA] duplicate official attempts exist; resolve them before enabling one-attempt policy.'
      USING ERRCODE = 'PTK46';
  END IF;
END;
$$;

CREATE UNIQUE INDEX ux_tikatuka_official_one_attempt_student_period
  ON public.tikatuka_official_sessions(classroom_id, student_id, period_key);

-- Student competition payload v2: preserve the Phase-8 payload and append the
-- teacher gate / one-attempt state without duplicating ranking logic.
CREATE OR REPLACE FUNCTION public.tikatuka_competition_payload_v2(
  p_classroom_id integer,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_base jsonb;
  v_open boolean := false;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_attempt_used boolean := false;
BEGIN
  v_base := public.tikatuka_competition_payload(p_classroom_id, p_student_id);

  SELECT w.is_open, w.opened_at, w.closed_at
  INTO v_open, v_opened_at, v_closed_at
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id = p_classroom_id
    AND w.period_key = v_period;

  v_open := coalesce(v_open, false);

  SELECT EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions s
    WHERE s.classroom_id = p_classroom_id
      AND s.student_id = p_student_id
      AND s.period_key = v_period
  )
  INTO v_attempt_used;

  RETURN v_base || jsonb_build_object(
    'official_window_open', v_open,
    'official_window_opened_at', v_opened_at,
    'official_window_closed_at', v_closed_at,
    'official_attempt_used', v_attempt_used,
    'official_can_start', v_open AND NOT v_attempt_used
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_tikatuka_competition_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  RETURN public.tikatuka_competition_payload_v2(v_classroom_id, v_student_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.student_start_tikatuka_official_challenge_v1(
  p_difficulty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_highest integer;
  v_window_open boolean := false;
  v_existing bigint;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_difficulty IS NULL OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty must be 1..10.' USING ERRCODE = 'PTK41';
  END IF;

  SELECT coalesce(w.is_open, false)
  INTO v_window_open
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id = v_classroom_id
    AND w.period_key = v_period;

  IF coalesce(v_window_open, false) = false THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge is not open.' USING ERRCODE = 'PTK44';
  END IF;

  SELECT coalesce(highest_unlocked_difficulty, 1)
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id AND student_id = v_student_id;
  v_highest := coalesce(v_highest, 1);

  IF p_difficulty > v_highest THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty % is locked; highest unlocked is %.', p_difficulty, v_highest
      USING ERRCODE = 'PTK03';
  END IF;

  SELECT id INTO v_existing
  FROM public.tikatuka_official_sessions
  WHERE classroom_id = v_classroom_id
    AND student_id = v_student_id
    AND period_key = v_period
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge attempt has already been used for this period.' USING ERRCODE = 'PTK45';
  END IF;

  BEGIN
    INSERT INTO public.tikatuka_official_sessions(
      classroom_id, student_id, period_key, difficulty
    ) VALUES (
      v_classroom_id, v_student_id, v_period, p_difficulty
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge attempt has already been used for this period.' USING ERRCODE = 'PTK45';
  END;

  RETURN public.tikatuka_competition_payload_v2(v_classroom_id, v_student_id);
END;
$$;

-- Internal teacher payload.
CREATE OR REPLACE FUNCTION public.tikatuka_official_window_admin_payload(
  p_classroom_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_open boolean := false;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_started integer := 0;
  v_completed integer := 0;
BEGIN
  SELECT w.is_open, w.opened_at, w.closed_at
  INTO v_open, v_opened_at, v_closed_at
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id = p_classroom_id
    AND w.period_key = v_period;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE os.status = 'COMPLETED')::integer
  INTO v_started, v_completed
  FROM public.tikatuka_official_sessions os
  JOIN public.students s ON s.id = os.student_id
  WHERE os.classroom_id = p_classroom_id
    AND os.period_key = v_period
    AND s.transferred_at IS NULL
    AND coalesce(s.is_test_account, false) = false;

  RETURN jsonb_build_object(
    'period_key', to_char(v_period, 'YYYY-MM'),
    'is_open', coalesce(v_open, false),
    'opened_at', v_opened_at,
    'closed_at', v_closed_at,
    'started_count', coalesce(v_started, 0),
    'completed_count', coalesce(v_completed, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_tikatuka_official_window_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  RETURN public.tikatuka_official_window_admin_payload(v_classroom_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_tikatuka_official_window_v1(
  p_is_open boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  IF p_is_open IS NULL THEN
    RAISE EXCEPTION '공인 도전 공개 상태가 필요합니다.' USING ERRCODE = 'PTK47';
  END IF;

  INSERT INTO public.tikatuka_official_windows(
    classroom_id, period_key, is_open, opened_at, closed_at, updated_at
  ) VALUES (
    v_classroom_id,
    v_period,
    p_is_open,
    CASE WHEN p_is_open THEN now() ELSE NULL END,
    CASE WHEN p_is_open THEN NULL ELSE now() END,
    now()
  )
  ON CONFLICT (classroom_id, period_key)
  DO UPDATE SET
    is_open = EXCLUDED.is_open,
    opened_at = CASE WHEN EXCLUDED.is_open THEN now() ELSE public.tikatuka_official_windows.opened_at END,
    closed_at = CASE WHEN EXCLUDED.is_open THEN NULL ELSE now() END,
    updated_at = now();

  RETURN public.tikatuka_official_window_admin_payload(v_classroom_id);
END;
$$;

REVOKE ALL ON FUNCTION public.tikatuka_competition_payload_v2(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_official_window_admin_payload(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_get_tikatuka_competition_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_start_tikatuka_official_challenge_v1(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_tikatuka_official_window_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_tikatuka_official_window_v1(boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.student_get_tikatuka_competition_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_start_tikatuka_official_challenge_v1(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_tikatuka_official_window_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_set_tikatuka_official_window_v1(boolean) TO authenticated, service_role;

COMMIT;
