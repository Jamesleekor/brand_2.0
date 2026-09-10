-- B.R.A.N.D. 2.0 — Newbie Support teacher/private RPCs

CREATE OR REPLACE FUNCTION private.teacher_finalize_newbie_support_program_impl(p_program_id bigint,p_skip_best_mentor boolean DEFAULT false,p_override_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; p private.newbie_support_programs%ROWTYPE; v_approved integer; v_pending integer; v_reason text:=nullif(btrim(coalesce(p_override_reason,'')),''); v_best_valid integer; v_target_tx bigint; v_mentor private.newbie_support_program_mentors%ROWTYPE; v_valid integer; v_base_tx bigint; v_best_tx bigint; v_ids integer[]; v_payouts jsonb:='[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF; PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id FOR UPDATE;
  IF p.id IS NULL OR p.classroom_id<>v_class THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status='COMPLETED' THEN RETURN jsonb_build_object('program_id',p.id,'status','COMPLETED','completion_bonus_transaction_id',p.completion_bonus_transaction_id,'already_processed',true); END IF;
  IF p.status<>'ACTIVE' THEN RAISE EXCEPTION 'ACTIVE 프로그램만 완료 처리할 수 있습니다.' USING ERRCODE='PNB02'; END IF;
  IF NOT public.is_official_participant(p.student_id) THEN RAISE EXCEPTION '정착 대상자가 현재 활성 학생이 아닙니다.' USING ERRCODE='PNB27'; END IF;
  SELECT count(*) FILTER(WHERE status='APPROVED'),count(*) FILTER(WHERE status='PENDING') INTO v_approved,v_pending FROM private.newbie_support_claims WHERE program_id=p.id;
  IF v_approved<>27 OR v_pending<>0 THEN RAISE EXCEPTION '27개 정착 퀘스트가 모두 승인되어야 합니다.' USING ERRCODE='PNB12'; END IF;
  IF p.best_mentor_assignment_id IS NULL THEN
    IF NOT coalesce(p_skip_best_mentor,false) OR v_reason IS NULL OR char_length(v_reason)<2 OR char_length(v_reason)>200 THEN RAISE EXCEPTION 'Best Mentor를 선택하거나 사유를 입력해 Best Mentor 없이 완료해야 합니다.' USING ERRCODE='PNB29'; END IF;
  ELSE
    SELECT count(*) INTO v_best_valid FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=p.best_mentor_assignment_id AND h.status='VALID';
    IF v_best_valid<p.mentor_min_valid_help THEN RAISE EXCEPTION '선정된 Best Mentor의 유효 도움 횟수가 부족합니다.' USING ERRCODE='PNB13'; END IF;
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM (
    SELECT p.student_id x UNION ALL SELECT m.mentor_student_id FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id
  ) z;
  PERFORM 1 FROM public.wallets w WHERE w.student_id=ANY(v_ids) ORDER BY w.student_id FOR UPDATE;
  IF p.completion_bonus_bv>0 THEN
    v_target_tx:=public.create_transaction(p.student_id,'BV'::public.value_token_type,p.completion_bonus_bv,'NEWBIE_SETTLEMENT'::public.transaction_source_type,p.id,0,'[뉴비 정착 지원] 모든 정착 퀘스트 완료 보너스');
    INSERT INTO private.transaction_record_exclusions(transaction_id,record_scope,reason_code,source_entity_type,source_entity_id)
    VALUES(v_target_tx,'MONTHLY_BV_GAIN','NEWBIE_SETTLEMENT_RESTORATION','PROGRAM_COMPLETION',p.id);
  END IF;
  FOR v_mentor IN SELECT * FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id ORDER BY m.mentor_student_id LOOP
    SELECT count(*) INTO v_valid FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=v_mentor.id AND h.status='VALID';
    v_base_tx:=NULL; v_best_tx:=NULL;
    IF NOT public.is_official_participant(v_mentor.mentor_student_id) THEN
      UPDATE private.newbie_support_program_mentors SET base_reward_outcome='SKIPPED_INACTIVE',best_reward_outcome=CASE WHEN id=p.best_mentor_assignment_id THEN 'SKIPPED_INACTIVE' ELSE 'NOT_SELECTED' END WHERE id=v_mentor.id;
    ELSE
      IF v_valid>=p.mentor_min_valid_help THEN
        IF p.mentor_base_reward_crystal>0 THEN v_base_tx:=public.create_transaction(v_mentor.mentor_student_id,'CRYSTAL'::public.value_token_type,p.mentor_base_reward_crystal,'NEWBIE_SETTLEMENT'::public.transaction_source_type,v_mentor.id,0,'[뉴비 정착 멘토] 정착 완료 지원 보상'); END IF;
        UPDATE private.newbie_support_program_mentors SET base_reward_transaction_id=v_base_tx,base_reward_outcome='PAID' WHERE id=v_mentor.id;
      ELSE UPDATE private.newbie_support_program_mentors SET base_reward_outcome='INELIGIBLE' WHERE id=v_mentor.id; END IF;
      IF v_mentor.id=p.best_mentor_assignment_id THEN
        IF p.best_mentor_bonus_crystal>0 THEN v_best_tx:=public.create_transaction(v_mentor.mentor_student_id,'CRYSTAL'::public.value_token_type,p.best_mentor_bonus_crystal,'NEWBIE_SETTLEMENT'::public.transaction_source_type,v_mentor.id,0,'[뉴비 정착 멘토] Best Mentor 추가 보상'); END IF;
        UPDATE private.newbie_support_program_mentors SET best_reward_transaction_id=v_best_tx,best_reward_outcome='PAID' WHERE id=v_mentor.id;
      ELSE UPDATE private.newbie_support_program_mentors SET best_reward_outcome='NOT_SELECTED' WHERE id=v_mentor.id; END IF;
    END IF;
    v_payouts:=v_payouts||jsonb_build_array(jsonb_build_object('mentor_student_id',v_mentor.mentor_student_id,'valid_help_count',v_valid,'base_transaction_id',v_base_tx,'best_transaction_id',v_best_tx));
  END LOOP;
  UPDATE private.newbie_support_programs SET status='COMPLETED',completion_bonus_transaction_id=v_target_tx,completed_at=now(),updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('program_id',p.id,'status','COMPLETED','completion_bonus_bv',p.completion_bonus_bv,'completion_bonus_transaction_id',v_target_tx,'mentor_payouts',v_payouts);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_cancel_newbie_support_program_impl(p_program_id bigint,p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; p private.newbie_support_programs%ROWTYPE; v_reason text:=btrim(coalesce(p_reason,'')); v_approved integer; v_target_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF; PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  IF char_length(v_reason)<2 OR char_length(v_reason)>200 THEN RAISE EXCEPTION '취소 사유는 2~200자입니다.' USING ERRCODE='PNB24'; END IF;
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id FOR UPDATE;
  IF p.id IS NULL OR p.classroom_id<>v_class THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status NOT IN ('DRAFT','ACTIVE') THEN RAISE EXCEPTION '현재 상태에서는 프로그램을 취소할 수 없습니다.' USING ERRCODE='PNB24'; END IF;
  SELECT count(*) INTO v_approved FROM private.newbie_support_claims WHERE program_id=p.id AND status='APPROVED'; v_target_active:=public.is_official_participant(p.student_id);
  IF p.status='ACTIVE' AND v_approved>0 AND v_target_active THEN RAISE EXCEPTION '승인된 정착 보상이 있습니다. 먼저 승인 회수 후 취소하세요.' USING ERRCODE='PNB24'; END IF;
  UPDATE private.newbie_support_claims SET status='CANCELLED' WHERE program_id=p.id AND status='PENDING';
  UPDATE private.newbie_support_claim_mentor_help SET status='INVALID',validated_at=now() WHERE program_id=p.id AND status='PENDING';
  UPDATE private.newbie_support_programs SET status='CANCELLED',cancelled_at=now(),cancel_reason=v_reason,completion_requested_at=NULL,best_mentor_assignment_id=NULL,updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('program_id',p.id,'status','CANCELLED','approved_rewards_left_in_place',v_approved,'target_active',v_target_active);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_get_newbie_support_board_impl()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; v_students jsonb; v_requests jsonb; v_programs jsonb; v_claims jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF; PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('student_id',s.id,'name',s.name,'brand_name',s.brand_name,'enrolled_at',s.enrolled_at) ORDER BY s.name,s.id),'[]'::jsonb) INTO v_students
  FROM public.students s WHERE s.classroom_id=v_class AND public.is_official_participant(s.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('request_id',r.id,'title',r.title,'status',r.status,'due_at',r.due_at) ORDER BY r.due_at,r.id),'[]'::jsonb) INTO v_requests
  FROM public.secondary_job_public_requests r WHERE r.classroom_id=v_class AND r.status='OPEN';
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'program_id',p.id,'student_id',p.student_id,'student_name',s.name,'student_brand_name',s.brand_name,'status',p.status,'effective_status',private.newbie_support_effective_status(p.id),
    'missed_opportunities',p.missed_opportunities,'bv_per_opportunity',p.bv_per_opportunity,'total_restorable_bv',p.total_restorable_bv,'regular_pool_bv',p.regular_quest_pool_bv,'completion_bonus_bv',p.completion_bonus_bv,
    'start_on',p.start_on,'end_on',p.end_on,'approved_count',(SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='APPROVED'),
    'pending_count',(SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.status='PENDING'),'total_count',(SELECT count(*) FROM private.newbie_support_program_quest_slots sl WHERE sl.program_id=p.id),
    'completion_requested_at',p.completion_requested_at,'best_mentor_assignment_id',p.best_mentor_assignment_id,'completed_at',p.completed_at,'cancel_reason',p.cancel_reason,
    'mentor_ids',(SELECT coalesce(jsonb_agg(m.mentor_student_id ORDER BY m.mentor_student_id),'[]'::jsonb) FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id),
    'public_request_ids',(SELECT coalesce(jsonb_agg(pr.request_id ORDER BY pr.request_id),'[]'::jsonb) FROM private.newbie_support_program_public_requests pr WHERE pr.program_id=p.id),
    'mentors',(SELECT coalesce(jsonb_agg(jsonb_build_object('mentor_assignment_id',m.id,'student_id',m.mentor_student_id,'name',ms.name,'brand_name',ms.brand_name,
      'valid_help_count',(SELECT count(*) FROM private.newbie_support_claim_mentor_help h WHERE h.mentor_assignment_id=m.id AND h.status='VALID'),
      'base_reward_outcome',m.base_reward_outcome,'best_reward_outcome',m.best_reward_outcome,'is_best',p.best_mentor_assignment_id=m.id) ORDER BY ms.name,m.id),'[]'::jsonb)
      FROM private.newbie_support_program_mentors m JOIN public.students ms ON ms.id=m.mentor_student_id WHERE m.program_id=p.id)
  ) ORDER BY p.id DESC),'[]'::jsonb) INTO v_programs
  FROM private.newbie_support_programs p JOIN public.students s ON s.id=p.student_id WHERE p.classroom_id=v_class;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'claim_id',c.id,'program_id',c.program_id,'student_id',p.student_id,'student_name',s.name,'quest_code',q.quest_code,'quest_title',q.title,
    'occurrence_no',sl.occurrence_no,'reward_bv',sl.reward_bv,'status',c.status,'evidence_ref_id',c.evidence_ref_id,'student_note',c.student_note,'requested_at',c.requested_at,'review_note',c.review_note,'reviewed_at',c.reviewed_at,
    'evidence',private.newbie_support_inspect_evidence(c.program_id,q.verification_type,c.evidence_ref_id,c.id),
    'mentor_help',(SELECT coalesce(jsonb_agg(jsonb_build_object('mentor_assignment_id',h.mentor_assignment_id,'mentor_student_id',m.mentor_student_id,'mentor_name',ms.name,'help_type',h.help_type,'status',h.status) ORDER BY ms.name,m.id),'[]'::jsonb)
      FROM private.newbie_support_claim_mentor_help h JOIN private.newbie_support_program_mentors m ON m.id=h.mentor_assignment_id JOIN public.students ms ON ms.id=m.mentor_student_id WHERE h.claim_id=c.id)
  ) ORDER BY CASE c.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,c.requested_at,c.id),'[]'::jsonb) INTO v_claims
  FROM private.newbie_support_claims c JOIN private.newbie_support_programs p ON p.id=c.program_id JOIN public.students s ON s.id=p.student_id
  JOIN private.newbie_support_program_quest_slots sl ON sl.id=c.slot_id JOIN private.newbie_support_program_quests q ON q.id=sl.program_quest_id
  WHERE p.classroom_id=v_class AND c.status IN ('PENDING','APPROVED','REJECTED','REVOKED');
  RETURN jsonb_build_object('server_today_kst',private.newbie_support_today_kst(),'students',v_students,'public_requests',v_requests,'programs',v_programs,'claims',v_claims);
END
$fn$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,anon,authenticated;
