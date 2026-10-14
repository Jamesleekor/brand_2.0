-- B.R.A.N.D 2.0 RAID pattern generator: teacher-only aggregated power (read-only).
-- Exact power snapshot source: sum(characters.raid_power) over student_characters owned/active.
-- No student-identifying rows are returned; no legacy raid records are modified.
CREATE OR REPLACE FUNCTION public.teacher_get_raid_generator_power_profile(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_include_tests boolean;
  v_count integer;
  v_total bigint;
BEGIN
  SELECT r.classroom_id, r.include_test_accounts
    INTO v_classroom_id, v_include_tests
  FROM public.raids r WHERE r.id = p_raid_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid not found' USING ERRCODE='P0202'; END IF;

  PERFORM public.raid_teacher_require_classroom(v_classroom_id);

  SELECT COUNT(*)::integer, COALESCE(SUM(COALESCE(chars.raid_power,0)),0)::bigint
    INTO v_count, v_total
  FROM public.students s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(c.raid_power),0)::bigint AS raid_power
      FROM public.student_characters sc
      JOIN public.characters c ON c.id = sc.character_id
     WHERE sc.student_id = s.id
       AND sc.is_owned = true
       AND c.is_active = true
  ) chars ON true
  WHERE s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text = 'STUDENT'
    AND (v_include_tests OR NOT s.is_test_account);

  RETURN jsonb_build_object(
    'raid_id',p_raid_id,
    'eligible_count',v_count,
    'total_raid_power',v_total,
    'average_raid_power', CASE WHEN v_count > 0 THEN ROUND(v_total::numeric/v_count)::bigint ELSE 0 END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_get_raid_generator_power_profile(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_generator_power_profile(bigint) TO authenticated, service_role;
