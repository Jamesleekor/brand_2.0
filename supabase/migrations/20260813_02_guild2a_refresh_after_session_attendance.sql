-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 2A refresh after Guild 1 session attendance change
-- 2026-08-13
--
-- Production source verified:
--   teacher_record_guild_session_attendance(bigint, jsonb) saved the Guild 1
--   participant status but did not refresh the Guild 2 draft aggregate.
--
-- Result:
--   Changing ABSENT back to PRESENT or EXCUSED now recalculates that session's
--   calendar month in the same teacher action. Existing Guild 1 snapshots and
--   Guild 2 evidence/ledger rows are not deleted or rewritten.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.teacher_record_guild_session_attendance(
  p_session_id bigint,
  p_records jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_session_date date;
  v_row jsonb;
  v_student integer;
  v_status text;
  v_note text;
  v_count integer := 0;
BEGIN
  PERFORM public.ensure_teacher_role();

  SELECT classroom_id, session_date
    INTO v_class, v_session_date
  FROM public.guild_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_class IS NULL OR v_class IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[G1] guild session not found in teacher classroom' USING ERRCODE = 'PG170';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RAISE EXCEPTION '[G1] attendance records must be an array' USING ERRCODE = 'PG171';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_student := NULLIF(v_row->>'student_id', '')::integer;
    v_status := upper(btrim(coalesce(v_row->>'status', '')));
    v_note := nullif(btrim(coalesce(v_row->>'note', '')), '');

    IF v_status NOT IN ('UNMARKED', 'PRESENT', 'ABSENT', 'EXCUSED') THEN
      RAISE EXCEPTION '[G1] invalid guild session status: %', v_status USING ERRCODE = 'PG172';
    END IF;

    UPDATE public.guild_session_participants
    SET attendance_status = v_status,
        note = v_note,
        recorded_by_user_id = auth.uid(),
        recorded_at = now(),
        updated_at = now()
    WHERE session_id = p_session_id
      AND student_id = v_student;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[G1] student % is not in this session snapshot', v_student USING ERRCODE = 'PG173';
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.guild_sessions
  SET updated_at = now()
  WHERE id = p_session_id;

  -- Guild 2 stores a draft/cache for audit-friendly scoring. Refresh only the
  -- affected month, after all Guild 1 participant snapshot rows are saved.
  PERFORM public.guild2_refresh_monthly_scores(
    v_class,
    to_char(v_session_date, 'YYYY-MM')
  );

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'updated', v_count,
    'guild2_refreshed_year_month', to_char(v_session_date, 'YYYY-MM')
  );
END;
$$;

-- Reassert the verified Guild 1 function ACL after replacement.
REVOKE ALL ON FUNCTION public.teacher_record_guild_session_attendance(bigint, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_record_guild_session_attendance(bigint, jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- SQL Editor-safe postcheck: do not call the teacher-only RPC here.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer,
  pg_get_functiondef(p.oid) LIKE '%guild2_refresh_monthly_scores%' AS refresh_connected
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'teacher_record_guild_session_attendance';

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  coalesce(grantee.rolname, 'PUBLIC') AS grantee,
  acl.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE n.nspname = 'public'
  AND p.proname = 'teacher_record_guild_session_attendance'
ORDER BY grantee, acl.privilege_type;
