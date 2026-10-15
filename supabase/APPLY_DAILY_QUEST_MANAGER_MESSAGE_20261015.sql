-- ALREADY APPLIED to production 2026-10-15. Record only; do not reapply.
-- Daily quest report message. Existing metadata preserves unrelated keys.
CREATE OR REPLACE FUNCTION public.daily_quest_manager_submit_with_message(p_report_id bigint, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_result jsonb;
  v_message text := nullif(btrim(p_message), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='42501'; END IF;
  IF char_length(coalesce(v_message,'')) > 2000 THEN
    RAISE EXCEPTION '전달사항은 2000자 이내로 작성해 주세요.' USING ERRCODE='22023';
  END IF;
  -- Existing RPC locks the report, validates classroom/manager/state/checks.
  -- Any later error rolls back both the submission and message together.
  v_result := public.daily_quest_manager_submit(p_report_id);
  UPDATE public.daily_quest_reports
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'manager_message', v_message,
      'manager_message_author', auth.uid(),
      'manager_message_saved_at', now())
    WHERE id=p_report_id;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.daily_quest_manager_submit_with_message(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_quest_manager_submit_with_message(bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_daily_quest_report_message(p_report_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_report public.daily_quest_reports%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_report FROM public.daily_quest_reports WHERE id=p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION '보고서를 찾을 수 없습니다.' USING ERRCODE='22023'; END IF;
  PERFORM public._daily_quest_assert_manager_or_teacher(v_report.classroom_id,v_report.manager_student_id);
  RETURN jsonb_build_object('manager_message',v_report.metadata->>'manager_message');
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_daily_quest_report_message(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_quest_report_message(bigint) TO authenticated;
NOTIFY pgrst, 'reload schema';
