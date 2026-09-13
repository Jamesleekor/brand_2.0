-- =============================================================================
-- B.R.A.N.D 2.0 — Rakaruka staged win gates
-- 2026-09-13
--
-- Unlock policy
--   Lv.1~6 : 1 win at the current level unlocks the next level.
--   Lv.7   : 2 wins at Lv.7 unlock Lv.8.
--   Lv.8   : 2 wins at Lv.8 unlock Lv.9.
--   Lv.9   : 3 wins at Lv.9 unlock Lv.10.
--   Lv.10  : final level.
--
-- Existing higher unlocks are never reduced. The gate intercepts only automatic
-- upward progress updates. Teacher overrides remain explicit and audited through
-- the existing teacher RPC.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tikatuka_progress') IS NULL
     OR to_regclass('public.tikatuka_games') IS NULL
     OR to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] required progression tables are missing.' USING ERRCODE = 'PTK30';
  END IF;

  IF to_regprocedure('public.tikatuka_progress_payload(integer,integer)') IS NULL
     OR to_regprocedure('public.teacher_set_tikatuka_progress_v1(integer,integer)') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] required progression helpers are missing.' USING ERRCODE = 'PTK30';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tikatuka_required_wins_for_unlock(p_difficulty integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_difficulty BETWEEN 1 AND 6 THEN 1
    WHEN p_difficulty IN (7, 8) THEN 2
    WHEN p_difficulty = 9 THEN 3
    WHEN p_difficulty = 10 THEN 0
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.tikatuka_required_wins_for_unlock(integer) IS
  'Internal Rakaruka unlock threshold helper: 1 win through Lv6, 2 wins at Lv7/Lv8, 3 wins at Lv9.';

CREATE OR REPLACE FUNCTION public.tikatuka_enforce_win_gate_progression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_difficulty integer;
  v_required_wins integer;
  v_actual_wins integer;
  v_override text := current_setting('app.tikatuka_progress_override', true);
BEGIN
  -- Never relock already-open content. Downward teacher edits are also left alone.
  IF NEW.highest_unlocked_difficulty <= OLD.highest_unlocked_difficulty THEN
    RETURN NEW;
  END IF;

  -- The teacher admin RPC is the only supported bypass for a manual unlock jump.
  IF v_override = 'teacher' THEN
    RETURN NEW;
  END IF;

  -- Automatic play may advance at most one level at a time.
  IF NEW.highest_unlocked_difficulty > OLD.highest_unlocked_difficulty + 1 THEN
    NEW.highest_unlocked_difficulty := OLD.highest_unlocked_difficulty + 1;
  END IF;

  v_source_difficulty := NEW.highest_unlocked_difficulty - 1;
  v_required_wins := public.tikatuka_required_wins_for_unlock(v_source_difficulty);

  IF v_required_wins IS NULL OR v_required_wins <= 0 THEN
    NEW.highest_unlocked_difficulty := OLD.highest_unlocked_difficulty;
    RETURN NEW;
  END IF;

  SELECT count(*)::integer
  INTO v_actual_wins
  FROM public.tikatuka_games g
  WHERE g.classroom_id = NEW.classroom_id
    AND g.student_id = NEW.student_id
    AND g.status = 'COMPLETED'
    AND g.server_winner = 'player'
    AND g.difficulty = v_source_difficulty;

  IF coalesce(v_actual_wins, 0) < v_required_wins THEN
    NEW.highest_unlocked_difficulty := OLD.highest_unlocked_difficulty;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tikatuka_progress_enforce_win_gate ON public.tikatuka_progress;
CREATE TRIGGER tikatuka_progress_enforce_win_gate
  BEFORE UPDATE OF highest_unlocked_difficulty ON public.tikatuka_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.tikatuka_enforce_win_gate_progression();

-- Preserve the existing teacher override semantics while making the bypass
-- explicit so normal student result submission cannot skip the new win gates.
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

  PERFORM set_config('app.tikatuka_progress_override', 'teacher', true);

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

REVOKE ALL ON FUNCTION public.tikatuka_required_wins_for_unlock(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_enforce_win_gate_progression() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_set_tikatuka_progress_v1(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_set_tikatuka_progress_v1(integer, integer) TO authenticated, service_role;

COMMIT;
