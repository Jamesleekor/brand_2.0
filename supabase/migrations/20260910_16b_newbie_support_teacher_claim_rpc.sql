-- B.R.A.N.D. 2.0 — Newbie Support teacher/private RPCs

CREATE OR REPLACE FUNCTION private.teacher_review_newbie_support_claim_impl(
  p_claim_id bigint,p_decision text,p_valid_mentor_assignment_ids bigint[] DEFAULT '{}'::bigint[],p_review_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; c private.newbie_support_claims%ROWTYPE; p private.newbie_support_programs%ROWTYPE; sl private.newbie_support_program_quest_slots%ROWTYPE; q private.newbie_support_program_quests%ROWTYPE;
 v_decision text:=upper(btrim(coalesce(p_decision,''))); v_detail jsonb; v_tx bigint; v_note text:=nullif(btrim(coalesce(p_review_note,'')),''); v_valid_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  IF v_decision NOT IN ('APPROVE','REJECT') THEN RAISE EXCEPTION '승인 또는 반려를 선택해주세요.' USING ERRCODE='PNB11'; END IF;
  SELECT * INTO c FROM private.newbie_support_claims WHERE id=p_claim_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION '완료 요청을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=c.program_id FOR UPDATE;
  IF p.classroom_id<>v_class THEN RAISE EXCEPTION '담당 학급의 요청이 아닙니다.' USING ERRCODE='PNB01'; END IF;
  IF c.status='APPROVED' AND v_decision='APPROVE' THEN RETURN jsonb_build_object('claim_id',c.id,'status','APPROVED','reward_transaction_id',c.reward_transaction_id,'reward_bv',c.reward_bv,'already_processed',true); END IF;
  IF c.status<>'PENDING' THEN RAISE EXCEPTION '이미 처리된 완료 요청입니다.' USING ERRCODE='PNB11'; END IF;
  SELECT * INTO sl FROM private.newbie_support_program_quest_slots WHERE id=c.slot_id AND program_id=c.program_id;
  SELECT * INTO q FROM private.newbie_support_program_quests WHERE id=sl.program_quest_id AND program_id=c.program_id;
  IF v_decision='REJECT' THEN
    UPDATE private.newbie_support_claims SET status='REJECTED',reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note WHERE id=c.id;
    UPDATE private.newbie_support_claim_mentor_help SET status='INVALID',validated_at=now() WHERE claim_id=c.id;
    RETURN jsonb_build_object('claim_id',c.id,'status','REJECTED');
  END IF;
  v_detail:=private.newbie_support_validate_evidence(p.id,q.verification_type,c.evidence_ref_id,c.id);
  IF p_valid_mentor_assignment_ids IS NULL THEN p_valid_mentor_assignment_ids:='{}'::bigint[]; END IF;
  IF cardinality(p_valid_mentor_assignment_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_valid_mentor_assignment_ids) x) THEN RAISE EXCEPTION '유효 멘토 목록이 중복되었습니다.' USING ERRCODE='PNB25'; END IF;
  SELECT count(*) INTO v_valid_count FROM private.newbie_support_claim_mentor_help h WHERE h.claim_id=c.id AND h.mentor_assignment_id=ANY(p_valid_mentor_assignment_ids);
  IF v_valid_count<>cardinality(p_valid_mentor_assignment_ids) THEN RAISE EXCEPTION '학생이 도움 멘토로 첨부하지 않은 항목은 인정할 수 없습니다.' USING ERRCODE='PNB25'; END IF;
  v_tx:=public.create_transaction(p.student_id,'BV'::public.value_token_type,sl.reward_bv,'NEWBIE_SETTLEMENT'::public.transaction_source_type,c.id,0,format('[뉴비 정착 지원] %s %s/%s',q.title,sl.occurrence_no,q.target_count));
  INSERT INTO private.transaction_record_exclusions(transaction_id,record_scope,reason_code,source_entity_type,source_entity_id)
  VALUES(v_tx,'MONTHLY_BV_GAIN','NEWBIE_SETTLEMENT_RESTORATION','CLAIM',c.id);
  UPDATE private.newbie_support_claims SET status='APPROVED',evidence_payload=v_detail,reviewed_by=auth.uid(),reviewed_at=now(),review_note=v_note,
    reward_bv=sl.reward_bv,reward_transaction_id=v_tx WHERE id=c.id;
  UPDATE private.newbie_support_claim_mentor_help SET status=CASE WHEN mentor_assignment_id=ANY(p_valid_mentor_assignment_ids) THEN 'VALID' ELSE 'INVALID' END,validated_at=now() WHERE claim_id=c.id;
  RETURN jsonb_build_object('claim_id',c.id,'status','APPROVED','reward_bv',sl.reward_bv,'reward_transaction_id',v_tx);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_revoke_newbie_support_claim_impl(p_claim_id bigint,p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; c private.newbie_support_claims%ROWTYPE; p private.newbie_support_programs%ROWTYPE; v_reason text:=btrim(coalesce(p_reason,'')); v_rev bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  IF char_length(v_reason)<2 OR char_length(v_reason)>200 THEN RAISE EXCEPTION '승인 회수 사유는 2~200자입니다.' USING ERRCODE='PNB18'; END IF;
  SELECT * INTO c FROM private.newbie_support_claims WHERE id=p_claim_id FOR UPDATE; IF c.id IS NULL THEN RAISE EXCEPTION '완료 요청을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=c.program_id FOR UPDATE; IF p.classroom_id<>v_class THEN RAISE EXCEPTION '담당 학급의 요청이 아닙니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status='COMPLETED' OR c.status<>'APPROVED' THEN RAISE EXCEPTION '현재 상태에서는 승인 회수가 불가능합니다.' USING ERRCODE='PNB18'; END IF;
  BEGIN v_rev:=public.reverse_transaction(c.reward_transaction_id,v_reason);
  EXCEPTION WHEN SQLSTATE 'P0004' THEN RAISE EXCEPTION '현재 BV 잔액이 부족하여 정착 보상을 회수할 수 없습니다.' USING ERRCODE='PNB18'; END;
  UPDATE private.newbie_support_claims SET status='REVOKED',reversal_transaction_id=v_rev,reviewed_by=auth.uid(),review_note=v_reason WHERE id=c.id;
  UPDATE private.newbie_support_claim_mentor_help SET status='INVALID',validated_at=now() WHERE claim_id=c.id;
  UPDATE private.newbie_support_programs SET completion_requested_at=NULL,best_mentor_assignment_id=NULL,updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('claim_id',c.id,'status','REVOKED','reversal_transaction_id',v_rev);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_extend_newbie_support_deadline_impl(p_program_id bigint,p_new_end_on date,p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; p private.newbie_support_programs%ROWTYPE; v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF; PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id FOR UPDATE;
  IF p.id IS NULL OR p.classroom_id<>v_class THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status<>'ACTIVE' OR p_new_end_on IS NULL OR p_new_end_on<=p.end_on OR char_length(v_reason)<2 OR char_length(v_reason)>200 THEN RAISE EXCEPTION '마감 연장 조건/사유가 올바르지 않습니다.' USING ERRCODE='PNB20'; END IF;
  UPDATE private.newbie_support_programs SET end_on=p_new_end_on,expired_at=NULL,updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('program_id',p.id,'end_on',p_new_end_on,'reason',v_reason);
END
$fn$;

