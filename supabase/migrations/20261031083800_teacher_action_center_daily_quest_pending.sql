-- Teacher-only action-center read, preserving private daily_quest_reports table.
CREATE OR REPLACE FUNCTION public.teacher_get_pending_daily_quest_reports()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_reports jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '학급 정보를 찾을 수 없습니다.' USING ERRCODE = 'DQ401';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'quest_date', r.quest_date,
        'submitted_at', r.submitted_at,
        'status', r.status
      )
      ORDER BY r.quest_date ASC, r.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_reports
  FROM public.daily_quest_reports r
  WHERE r.classroom_id = v_classroom_id
    AND r.status = 'SUBMITTED';

  RETURN v_reports;
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_get_pending_daily_quest_reports() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_get_pending_daily_quest_reports() FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_pending_daily_quest_reports() TO authenticated;

COMMENT ON FUNCTION public.teacher_get_pending_daily_quest_reports() IS
'Authenticated teachers only: read minimal pending daily-quest settlement report summaries for the action center.';
