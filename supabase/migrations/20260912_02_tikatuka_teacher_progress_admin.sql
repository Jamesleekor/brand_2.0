-- =============================================================================
-- B.R.A.N.D 2.0 — Tikatuka teacher progress administration
-- 2026-09-12
--
-- Teachers may adjust only the highest unlocked difficulty for active students in
-- their own classroom. Cleared difficulties and match statistics remain derived
-- from immutable completed game history.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.tikatuka_progress') IS NULL
     OR to_regclass('public.tikatuka_games') IS NULL
     OR to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] required tables are missing.' USING ERRCODE = 'PTK30';
  END IF;

  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.tikatuka_progress_payload(integer,integer)') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] required teacher/progress helpers are missing.' USING ERRCODE = 'PTK30';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_tikatuka_progress_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', s.id,
        'student_name', s.name,
        'brand_name', s.brand_name
      ) || public.tikatuka_progress_payload(v_classroom_id, s.id)
      ORDER BY s.name, s.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.students s
  WHERE s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST');

  RETURN jsonb_build_object('items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_tikatuka_progress_v1(
  p_student_id integer,
  p_highest_unlocked_difficulty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student public.students;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION '학생을 선택해주세요.' USING ERRCODE = 'PTK32';
  END IF;

  IF p_highest_unlocked_difficulty IS NULL
     OR p_highest_unlocked_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '해금 난이도는 1~10이어야 합니다.' USING ERRCODE = 'PTK33';
  END IF;

  SELECT s.*
  INTO v_student
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST');

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION '현재 학급에서 관리할 수 있는 학생을 찾을 수 없습니다.' USING ERRCODE = 'PTK32';
  END IF;

  INSERT INTO public.tikatuka_progress(
    classroom_id,
    student_id,
    highest_unlocked_difficulty,
    created_at,
    updated_at
  )
  VALUES (
    v_classroom_id,
    p_student_id,
    p_highest_unlocked_difficulty,
    now(),
    now()
  )
  ON CONFLICT (classroom_id, student_id)
  DO UPDATE SET
    highest_unlocked_difficulty = EXCLUDED.highest_unlocked_difficulty,
    updated_at = now();

  RETURN jsonb_build_object(
    'student_id', v_student.id,
    'student_name', v_student.name,
    'brand_name', v_student.brand_name
  ) || public.tikatuka_progress_payload(v_classroom_id, p_student_id);
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_get_tikatuka_progress_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_tikatuka_progress_v1(integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_get_tikatuka_progress_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_set_tikatuka_progress_v1(integer, integer) TO authenticated, service_role;
