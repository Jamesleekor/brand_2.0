CREATE OR REPLACE FUNCTION public.teacher_expire_arcade_standard_run(p_period_id bigint, p_run_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_period public.arcade_ranking_periods%ROWTYPE; v_run public.arcade_runs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '종료 사유는 2~500자여야 합니다.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=public.current_classroom_id() AND period_kind='MONTHLY' AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '활성 월간 기간을 찾을 수 없습니다.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id AND classroom_id=v_period.classroom_id AND run_context='STANDARD' AND NOT is_prerelease_test AND created_at>=v_period.starts_at AND created_at<v_period.ends_at_exclusive FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '해당 기간의 일반 플레이를 찾을 수 없습니다.' USING ERRCODE='42501'; END IF;
  IF v_run.status NOT IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') OR v_run.submitted_at IS NOT NULL OR v_run.official_score IS NOT NULL OR EXISTS (SELECT 1 FROM public.arcade_run_submissions WHERE run_id=v_run.id) THEN
    RAISE EXCEPTION '이미 종료되었거나 결과가 제출된 플레이입니다. 새로고침하세요.' USING ERRCODE='P0001';
  END IF;
  UPDATE public.arcade_runs SET status='EXPIRED',rejection_code='TEACHER_FORCE_EXPIRED',rejection_reason=btrim(p_reason) WHERE id=v_run.id;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,event_kind,reason,metadata,actor_user_id)
  VALUES(v_period.classroom_id,v_period.id,v_run.game_id,v_run.student_id,'STANDARD_RUN_FORCE_EXPIRED',btrim(p_reason),jsonb_build_object('run_id',v_run.id,'previous_status',v_run.status),auth.uid());
  RETURN jsonb_build_object('run_id',v_run.id,'status','EXPIRED');
END $function$;

CREATE OR REPLACE FUNCTION public.teacher_list_arcade_unfinished_runs(p_period_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_period public.arcade_ranking_periods%ROWTYPE; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=public.current_classroom_id() AND period_kind='MONTHLY';
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly period not found' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.blocks_freeze DESC,q.created_at DESC,q.run_id DESC),'[]'::jsonb) INTO v_result
  FROM (SELECT r.id AS run_id, s.name AS student_name, s.brand_name, g.internal_name AS game_name, r.status, r.created_at, r.play_started_at,
     (r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') AND r.created_at >= clock_timestamp()-interval '15 minutes' AND v_period.status='ACTIVE') AS blocks_freeze,
     (r.submitted_at IS NULL AND r.official_score IS NULL AND NOT EXISTS (SELECT 1 FROM public.arcade_run_submissions a WHERE a.run_id=r.id)) AS can_expire
   FROM public.arcade_runs r JOIN public.students s ON s.id=r.student_id JOIN public.arcade_games g ON g.id=r.game_id
   WHERE r.classroom_id=v_period.classroom_id AND r.run_context='STANDARD' AND NOT r.is_prerelease_test
     AND r.created_at>=v_period.starts_at AND r.created_at<v_period.ends_at_exclusive
     AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) q;
  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.teacher_list_arcade_unfinished_runs(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_expire_arcade_standard_run(bigint,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_list_arcade_unfinished_runs(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_expire_arcade_standard_run(bigint,bigint,text) TO authenticated;
