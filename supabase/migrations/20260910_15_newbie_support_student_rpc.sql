-- B.R.A.N.D. 2.0 — Newbie Support student/read private RPCs

CREATE OR REPLACE FUNCTION private.student_get_newbie_support_summary_impl()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_student integer:=public.current_student_id(); v_program bigint; v_my jsonb; v_mentoring jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  SELECT p.id INTO v_program FROM private.newbie_support_programs p
  WHERE p.student_id=v_student AND p.status='ACTIVE' ORDER BY p.id DESC LIMIT 1;
  IF v_program IS NOT NULL THEN
    SELECT jsonb_build_object(
      'program_id',p.id,'effective_status',private.newbie_support_effective_status(p.id),
      'approved_count',(SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),
      'total_count',(SELECT count(*) FROM private.newbie_support_program_quest_slots sl WHERE sl.program_id=p.id),
      'regular_recovered_bv',coalesce((SELECT sum(c.reward_bv) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),0),
      'regular_pool_bv',p.regular_quest_pool_bv,'completion_bonus_bv',p.completion_bonus_bv,
      'start_on',p.start_on,'end_on',p.end_on
    ) INTO v_my FROM private.newbie_support_programs p WHERE p.id=v_program;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'program_id',p.id,'target_student_id',p.student_id,'target_student_name',s.name,'target_brand_name',s.brand_name,
    'effective_status',private.newbie_support_effective_status(p.id),
    'approved_count',(SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),
    'total_count',(SELECT count(*) FROM private.newbie_support_program_quest_slots sl WHERE sl.program_id=p.id),
    'my_valid_help_count',(SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID'),
    'base_reward_eligible',((SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID')>=p.mentor_min_valid_help),
    'start_on',p.start_on,'end_on',p.end_on
  ) ORDER BY p.id DESC),'[]'::jsonb) INTO v_mentoring
  FROM private.newbie_support_program_mentors m JOIN private.newbie_support_programs p ON p.id=m.program_id
  JOIN public.students s ON s.id=p.student_id
  WHERE m.mentor_student_id=v_student AND p.status='ACTIVE';
  RETURN jsonb_build_object('server_today_kst',private.newbie_support_today_kst(),'my_program',v_my,'mentoring',coalesce(v_mentoring,'[]'::jsonb));
END
$fn$;

CREATE OR REPLACE FUNCTION private.student_get_newbie_support_board_impl()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_student integer:=public.current_student_id(); p private.newbie_support_programs%ROWTYPE; v_program jsonb; v_quests jsonb; v_mentors jsonb; v_can_candidates boolean;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  SELECT * INTO p FROM private.newbie_support_programs x
  WHERE x.student_id=v_student AND x.status IN ('ACTIVE','COMPLETED','EXPIRED')
  ORDER BY CASE x.status WHEN 'ACTIVE' THEN 0 WHEN 'COMPLETED' THEN 1 ELSE 2 END,x.id DESC LIMIT 1;
  IF p.id IS NULL THEN RETURN jsonb_build_object('server_today_kst',private.newbie_support_today_kst(),'program',NULL,'quests','[]'::jsonb,'mentors','[]'::jsonb); END IF;
  v_can_candidates := p.status='ACTIVE' AND now()>=private.newbie_support_start_ts(p.start_on) AND now()<private.newbie_support_end_exclusive_ts(p.end_on);
  v_program:=jsonb_build_object(
    'program_id',p.id,'status',p.status,'effective_status',private.newbie_support_effective_status(p.id),
    'missed_opportunities',p.missed_opportunities,'bv_per_opportunity',p.bv_per_opportunity,
    'total_restorable_bv',p.total_restorable_bv,'regular_pool_bv',p.regular_quest_pool_bv,
    'completion_bonus_bv',p.completion_bonus_bv,'start_on',p.start_on,'end_on',p.end_on,
    'approved_count',(SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),
    'total_count',(SELECT count(*) FROM private.newbie_support_program_quest_slots sl WHERE sl.program_id=p.id),
    'regular_recovered_bv',coalesce((SELECT sum(c.reward_bv) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),0),
    'completion_requested_at',p.completion_requested_at,'completed_at',p.completed_at
  );
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'mentor_assignment_id',m.id,'student_id',m.mentor_student_id,'student_name',s.name,'brand_name',s.brand_name,
    'valid_help_count',(SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID'),
    'base_reward_eligible',((SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID')>=p.mentor_min_valid_help),
    'is_best',p.best_mentor_assignment_id=m.id
  ) ORDER BY s.name,m.id),'[]'::jsonb) INTO v_mentors
  FROM private.newbie_support_program_mentors m JOIN public.students s ON s.id=m.mentor_student_id WHERE m.program_id=p.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'program_quest_id',q.id,'quest_code',q.quest_code,'title',q.title,'description',q.description,
    'target_count',q.target_count,'weight_per_completion',q.weight_per_completion,'sort_order',q.sort_order,
    'approved_count',(SELECT count(*) FROM private.newbie_support_claims c JOIN private.newbie_support_program_quest_slots sl2 ON sl2.id=c.slot_id WHERE c.program_id=p.id AND sl2.program_quest_id=q.id AND c.status='APPROVED'),
    'pending_count',(SELECT count(*) FROM private.newbie_support_claims c JOIN private.newbie_support_program_quest_slots sl2 ON sl2.id=c.slot_id WHERE c.program_id=p.id AND sl2.program_quest_id=q.id AND c.status='PENDING'),
    'slots',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'slot_id',sl.id,'occurrence_no',sl.occurrence_no,'reward_bv',sl.reward_bv,
      'claim',(SELECT jsonb_build_object('claim_id',c.id,'status',c.status,'evidence_ref_id',c.evidence_ref_id,'student_note',c.student_note,
        'requested_at',c.requested_at,'review_note',c.review_note,'reward_bv',c.reward_bv,'reviewed_at',c.reviewed_at)
        FROM private.newbie_support_claims c WHERE c.slot_id=sl.id ORDER BY c.id DESC LIMIT 1)
    ) ORDER BY sl.occurrence_no),'[]'::jsonb) FROM private.newbie_support_program_quest_slots sl WHERE sl.program_quest_id=q.id),
    'evidence_candidates',CASE WHEN v_can_candidates THEN private.newbie_support_evidence_candidates(p.id,q.quest_code,true) ELSE '[]'::jsonb END
  ) ORDER BY q.sort_order),'[]'::jsonb) INTO v_quests
  FROM private.newbie_support_program_quests q WHERE q.program_id=p.id;

  RETURN jsonb_build_object('server_today_kst',private.newbie_support_today_kst(),'program',v_program,'quests',v_quests,'mentors',v_mentors);
END
$fn$;

CREATE OR REPLACE FUNCTION private.student_get_newbie_support_mentor_board_impl()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_student integer:=public.current_student_id(); v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'mentor_assignment_id',m.id,'program_id',p.id,'effective_status',private.newbie_support_effective_status(p.id),
    'target_student_id',p.student_id,'target_student_name',s.name,'target_brand_name',s.brand_name,
    'start_on',p.start_on,'end_on',p.end_on,
    'approved_count',(SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),
    'total_count',(SELECT count(*) FROM private.newbie_support_program_quest_slots sl WHERE sl.program_id=p.id),
    'my_valid_help_count',(SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID'),
    'required_help_count',p.mentor_min_valid_help,
    'base_reward_eligible',((SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID')>=p.mentor_min_valid_help),
    'help_history',(SELECT coalesce(jsonb_agg(jsonb_build_object('claim_id',h.claim_id,'help_type',h.help_type,'status',h.status,'created_at',h.created_at,'validated_at',h.validated_at,'quest_title',q.title) ORDER BY h.created_at DESC),'[]'::jsonb)
      FROM private.newbie_support_claim_mentor_help h
      JOIN private.newbie_support_claims c ON c.id=h.claim_id
      JOIN private.newbie_support_program_quest_slots sl ON sl.id=c.slot_id
      JOIN private.newbie_support_program_quests q ON q.id=sl.program_quest_id
      WHERE h.mentor_assignment_id=m.id)
  ) ORDER BY p.id DESC),'[]'::jsonb) INTO v_rows
  FROM private.newbie_support_program_mentors m JOIN private.newbie_support_programs p ON p.id=m.program_id
  JOIN public.students s ON s.id=p.student_id
  WHERE m.mentor_student_id=v_student AND p.status IN ('ACTIVE','COMPLETED');
  RETURN jsonb_build_object('server_today_kst',private.newbie_support_today_kst(),'assignments',coalesce(v_rows,'[]'::jsonb));
END
$fn$;

CREATE OR REPLACE FUNCTION private.student_submit_newbie_support_claim_impl(
  p_program_quest_id bigint,p_evidence_ref_id bigint,p_mentor_help jsonb DEFAULT '[]'::jsonb,p_student_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_student integer:=public.current_student_id(); q private.newbie_support_program_quests%ROWTYPE; p private.newbie_support_programs%ROWTYPE;
  sl private.newbie_support_program_quest_slots%ROWTYPE; v_detail jsonb; v_claim bigint; v_item jsonb; v_assignment bigint; v_help_type text; v_note text;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  SELECT * INTO q FROM private.newbie_support_program_quests WHERE id=p_program_quest_id;
  IF q.id IS NULL THEN RAISE EXCEPTION '정착 퀘스트를 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=q.program_id FOR UPDATE;
  IF p.id IS NULL OR p.student_id<>v_student THEN RAISE EXCEPTION '내 정착 프로그램이 아닙니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status<>'ACTIVE' THEN RAISE EXCEPTION '현재 완료 요청을 받을 수 없는 프로그램 상태입니다.' USING ERRCODE='PNB02'; END IF;
  IF now()<private.newbie_support_start_ts(p.start_on) OR now()>=private.newbie_support_end_exclusive_ts(p.end_on) THEN
    RAISE EXCEPTION '정착 퀘스트 완료 요청 기간이 아닙니다.' USING ERRCODE='PNB03';
  END IF;
  IF NOT public.is_official_participant(v_student) THEN RAISE EXCEPTION '활성 정착 대상자가 아닙니다.' USING ERRCODE='PNB27'; END IF;
  IF q.quest_code='COLLECTION_SECOND' AND NOT EXISTS(
    SELECT 1 FROM private.newbie_support_claims c JOIN private.newbie_support_program_quest_slots x ON x.id=c.slot_id
    JOIN private.newbie_support_program_quests y ON y.id=x.program_quest_id
    WHERE c.program_id=p.id AND c.status='APPROVED' AND y.quest_code='COLLECTION_FIRST'
  ) THEN RAISE EXCEPTION '첫 번째 컬렉션 승인이 먼저 필요합니다.' USING ERRCODE='PNB17'; END IF;

  SELECT x.* INTO sl FROM private.newbie_support_program_quest_slots x
  WHERE x.program_id=p.id AND x.program_quest_id=q.id
    AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.slot_id=x.id AND c.status IN ('PENDING','APPROVED'))
  ORDER BY x.occurrence_no FOR UPDATE OF x LIMIT 1;
  IF sl.id IS NULL THEN RAISE EXCEPTION '이 퀘스트의 완료 요청 가능 횟수를 모두 사용했습니다.' USING ERRCODE='PNB04'; END IF;
  IF EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=q.verification_type AND c.evidence_ref_id=p_evidence_ref_id AND c.status IN ('PENDING','APPROVED')) THEN
    RAISE EXCEPTION '이미 사용 중인 정착 퀘스트 근거입니다.' USING ERRCODE='PNB06';
  END IF;
  v_detail:=private.newbie_support_validate_evidence(p.id,q.verification_type,p_evidence_ref_id,NULL);

  IF p_mentor_help IS NULL THEN p_mentor_help:='[]'::jsonb; END IF;
  IF jsonb_typeof(p_mentor_help)<>'array' OR jsonb_array_length(p_mentor_help)>p.mentor_max_count THEN
    RAISE EXCEPTION '멘토 도움 정보가 올바르지 않습니다.' USING ERRCODE='PNB25';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_mentor_help))<>(SELECT count(DISTINCT (e->>'mentor_assignment_id')) FROM jsonb_array_elements(p_mentor_help) e) THEN
    RAISE EXCEPTION '같은 멘토를 중복 선택할 수 없습니다.' USING ERRCODE='PNB25';
  END IF;
  v_note:=nullif(btrim(coalesce(p_student_note,'')),'');
  IF v_note IS NOT NULL AND char_length(v_note)>500 THEN RAISE EXCEPTION '메모는 500자 이하로 입력해주세요.' USING ERRCODE='PNB25'; END IF;

  INSERT INTO private.newbie_support_claims(program_id,slot_id,evidence_type,evidence_ref_id,evidence_payload,student_note)
  VALUES(p.id,sl.id,q.verification_type,p_evidence_ref_id,v_detail,v_note) RETURNING id INTO v_claim;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_mentor_help) LOOP
    BEGIN
      v_assignment:=(v_item->>'mentor_assignment_id')::bigint; v_help_type:=upper(btrim(v_item->>'help_type'));
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '멘토 도움 정보 형식이 올바르지 않습니다.' USING ERRCODE='PNB25'; END;
    IF v_help_type NOT IN ('EXPLANATION','COACHING','CHECKING','TRANSACTION','OTHER') OR NOT EXISTS(
      SELECT 1 FROM private.newbie_support_program_mentors m WHERE m.id=v_assignment AND m.program_id=p.id
    ) THEN RAISE EXCEPTION '정착 프로그램에 지정되지 않은 멘토 도움 정보입니다.' USING ERRCODE='PNB25'; END IF;
    INSERT INTO private.newbie_support_claim_mentor_help(program_id,claim_id,mentor_assignment_id,help_type)
    VALUES(p.id,v_claim,v_assignment,v_help_type);
  END LOOP;
  RETURN jsonb_build_object('claim_id',v_claim,'program_id',p.id,'slot_id',sl.id,'occurrence_no',sl.occurrence_no,'reward_bv',sl.reward_bv,'status','PENDING');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION '같은 퀘스트/근거로 이미 검토 중인 요청이 있습니다.' USING ERRCODE='PNB11';
END
$fn$;

CREATE OR REPLACE FUNCTION private.student_request_newbie_support_completion_impl(p_program_id bigint,p_best_mentor_student_id integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_student integer:=public.current_student_id(); p private.newbie_support_programs%ROWTYPE; v_best bigint; v_valid integer; v_approved integer; v_pending integer;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id FOR UPDATE;
  IF p.id IS NULL OR p.student_id<>v_student THEN RAISE EXCEPTION '내 정착 프로그램이 아닙니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status<>'ACTIVE' THEN RAISE EXCEPTION '완료 요청이 가능한 프로그램이 아닙니다.' USING ERRCODE='PNB02'; END IF;
  SELECT count(*) FILTER(WHERE status='APPROVED'),count(*) FILTER(WHERE status='PENDING') INTO v_approved,v_pending FROM private.newbie_support_claims WHERE program_id=p.id;
  IF v_approved<>27 OR v_pending<>0 THEN RAISE EXCEPTION '모든 정착 퀘스트 승인이 필요합니다.' USING ERRCODE='PNB12'; END IF;
  IF p_best_mentor_student_id IS NOT NULL THEN
    SELECT m.id,(SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID')
      INTO v_best,v_valid FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id AND m.mentor_student_id=p_best_mentor_student_id;
    IF v_best IS NULL OR v_valid<p.mentor_min_valid_help THEN RAISE EXCEPTION 'Best Mentor 조건을 충족하지 못했습니다.' USING ERRCODE='PNB13'; END IF;
  END IF;
  UPDATE private.newbie_support_programs SET completion_requested_at=now(),best_mentor_assignment_id=v_best,updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('program_id',p.id,'status','COMPLETION_PENDING','best_mentor_assignment_id',v_best,'completion_requested_at',now());
END
$fn$;

CREATE OR REPLACE FUNCTION private.student_get_current_month_bv_delta_impl()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_student integer:=public.current_student_id(); v_today date:=private.newbie_support_today_kst(); v_month date; v_start timestamptz; v_end timestamptz; v_delta bigint;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  v_month:=date_trunc('month',v_today::timestamp)::date; v_start:=private.newbie_support_start_ts(v_month); v_end:=private.newbie_support_start_ts((v_month+interval '1 month')::date);
  SELECT coalesce(sum(t.amount),0)::bigint INTO v_delta FROM public.transactions t
  WHERE t.student_id=v_student AND t.value_token='BV'::public.value_token_type AND t.created_at>=v_start AND t.created_at<v_end;
  RETURN jsonb_build_object('month',to_char(v_month,'YYYY-MM'),'delta_bv',v_delta,'server_today_kst',v_today);
END
$fn$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,anon,authenticated;
