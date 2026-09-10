-- B.R.A.N.D. 2.0 — Newbie Support teacher/private RPCs

CREATE OR REPLACE FUNCTION private.teacher_create_newbie_support_program_impl(
  p_student_id integer,p_template_code text,p_template_version integer,
  p_missed_opportunities integer,p_bv_per_opportunity bigint,p_start_on date,p_end_on date,
  p_mentor_student_ids integer[],p_public_request_ids bigint[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; t private.newbie_support_templates%ROWTYPE; v_integrity jsonb; v_total bigint; v_regular bigint; v_completion bigint; v_weight integer; v_program bigint; v_id integer; v_req bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM private.newbie_support_assert_official_student(p_student_id,v_class,'PNB27');
  SELECT * INTO t FROM private.newbie_support_templates WHERE code=p_template_code AND version=p_template_version AND is_active;
  IF t.id IS NULL THEN RAISE EXCEPTION '활성 정착 템플릿을 찾을 수 없습니다.' USING ERRCODE='PNB23'; END IF;
  v_integrity:=private.newbie_support_template_integrity(t.id);
  IF NOT coalesce((v_integrity->>'ok')::boolean,false) THEN RAISE EXCEPTION '정착 템플릿 무결성 검증에 실패했습니다.' USING ERRCODE='PNB23'; END IF;
  IF p_missed_opportunities NOT BETWEEN 1 AND 1000 OR p_bv_per_opportunity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION '놓친 기회/기준 BV가 허용 범위를 벗어났습니다.' USING ERRCODE='PNB22'; END IF;
  IF p_start_on IS NULL OR p_end_on IS NULL OR p_start_on>p_end_on THEN RAISE EXCEPTION '정착 기간이 올바르지 않습니다.' USING ERRCODE='PNB20'; END IF;
  PERFORM private.newbie_support_validate_mentor_ids(v_class,p_student_id,p_mentor_student_ids,t.mentor_min_count,t.mentor_max_count);
  PERFORM private.newbie_support_validate_public_request_ids(v_class,p_public_request_ids,false,p_start_on);
  v_total:=p_missed_opportunities::bigint*p_bv_per_opportunity; IF v_total>10000000 THEN RAISE EXCEPTION '총 복원 BV가 허용 한도를 초과합니다.' USING ERRCODE='PNB22'; END IF;
  v_regular:=(v_total*t.regular_percent)/100; v_completion:=v_total-v_regular; v_weight:=(v_integrity->>'total_weight')::integer;
  INSERT INTO private.newbie_support_programs(
    classroom_id,student_id,template_id,status,missed_opportunities,bv_per_opportunity,total_restorable_bv,
    regular_percent,completion_percent,regular_quest_pool_bv,completion_bonus_bv,total_quest_weight,start_on,end_on,
    mentor_min_count,mentor_max_count,mentor_min_valid_help,mentor_base_reward_crystal,best_mentor_bonus_crystal,mentor_p2p_cap,created_by
  ) VALUES(v_class,p_student_id,t.id,'DRAFT',p_missed_opportunities,p_bv_per_opportunity,v_total,t.regular_percent,t.completion_percent,
    v_regular,v_completion,v_weight,p_start_on,p_end_on,t.mentor_min_count,t.mentor_max_count,t.mentor_min_valid_help,
    t.mentor_base_reward_crystal,t.best_mentor_bonus_crystal,t.mentor_p2p_cap,auth.uid()) RETURNING id INTO v_program;
  INSERT INTO private.newbie_support_program_quests(program_id,quest_code,title,description,target_count,weight_per_completion,verification_type,sort_order,config)
  SELECT v_program,q.quest_code,q.title,q.description,q.target_count,q.weight_per_completion,q.verification_type,q.sort_order,q.config
  FROM private.newbie_support_template_quests q WHERE q.template_id=t.id ORDER BY q.sort_order;
  FOREACH v_id IN ARRAY p_mentor_student_ids LOOP INSERT INTO private.newbie_support_program_mentors(program_id,mentor_student_id) VALUES(v_program,v_id); END LOOP;
  FOREACH v_req IN ARRAY p_public_request_ids LOOP INSERT INTO private.newbie_support_program_public_requests(program_id,request_id) VALUES(v_program,v_req); END LOOP;
  RETURN jsonb_build_object('program_id',v_program,'status','DRAFT','total_restorable_bv',v_total,'regular_pool_bv',v_regular,'completion_bonus_bv',v_completion);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_update_newbie_support_program_impl(
  p_program_id bigint,p_missed_opportunities integer,p_bv_per_opportunity bigint,p_start_on date,p_end_on date,
  p_mentor_student_ids integer[],p_public_request_ids bigint[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; p private.newbie_support_programs%ROWTYPE; v_total bigint; v_regular bigint; v_completion bigint; v_id integer; v_req bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id FOR UPDATE;
  IF p.id IS NULL OR p.classroom_id<>v_class THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status<>'DRAFT' THEN RAISE EXCEPTION '활성화된 정착 프로그램 구성은 수정할 수 없습니다.' USING ERRCODE='PNB19'; END IF;
  IF p_missed_opportunities NOT BETWEEN 1 AND 1000 OR p_bv_per_opportunity NOT BETWEEN 1 AND 10000 OR p_start_on IS NULL OR p_end_on IS NULL OR p_start_on>p_end_on THEN RAISE EXCEPTION '수정 값이 올바르지 않습니다.' USING ERRCODE='PNB20'; END IF;
  PERFORM private.newbie_support_assert_official_student(p.student_id,v_class,'PNB27');
  PERFORM private.newbie_support_validate_mentor_ids(v_class,p.student_id,p_mentor_student_ids,p.mentor_min_count,p.mentor_max_count);
  PERFORM private.newbie_support_validate_public_request_ids(v_class,p_public_request_ids,false,p_start_on);
  v_total:=p_missed_opportunities::bigint*p_bv_per_opportunity; IF v_total>10000000 THEN RAISE EXCEPTION '총 복원 BV가 허용 한도를 초과합니다.' USING ERRCODE='PNB22'; END IF;
  v_regular:=(v_total*p.regular_percent)/100; v_completion:=v_total-v_regular;
  UPDATE private.newbie_support_programs SET missed_opportunities=p_missed_opportunities,bv_per_opportunity=p_bv_per_opportunity,total_restorable_bv=v_total,
    regular_quest_pool_bv=v_regular,completion_bonus_bv=v_completion,start_on=p_start_on,end_on=p_end_on,completion_requested_at=NULL,best_mentor_assignment_id=NULL,updated_at=now()
  WHERE id=p.id;
  DELETE FROM private.newbie_support_program_mentors WHERE program_id=p.id; DELETE FROM private.newbie_support_program_public_requests WHERE program_id=p.id;
  FOREACH v_id IN ARRAY p_mentor_student_ids LOOP INSERT INTO private.newbie_support_program_mentors(program_id,mentor_student_id) VALUES(p.id,v_id); END LOOP;
  FOREACH v_req IN ARRAY p_public_request_ids LOOP INSERT INTO private.newbie_support_program_public_requests(program_id,request_id) VALUES(p.id,v_req); END LOOP;
  RETURN jsonb_build_object('program_id',p.id,'status','DRAFT','total_restorable_bv',v_total,'regular_pool_bv',v_regular,'completion_bonus_bv',v_completion);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_preview_newbie_support_activation_impl(p_program_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; p private.newbie_support_programs%ROWTYPE; v_errors jsonb:='[]'::jsonb; v_warnings jsonb:='[]'::jsonb; v_integrity jsonb;
 v_mentor_count integer; v_bad_mentors integer; v_req_count integer; v_bad_req integer; v_slot_preview jsonb; v_slot_count integer; v_slot_sum bigint; v_min_reward bigint; v_baseline_count integer; v_today date:=private.newbie_support_today_kst(); v_codes text[]; v_qrows integer; v_completion integer; v_weight integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id;
  IF p.id IS NULL OR p.classroom_id<>v_class THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status<>'DRAFT' THEN v_errors:=v_errors||jsonb_build_array('DRAFT 상태의 프로그램만 활성화할 수 있습니다.'); END IF;
  IF p.start_on<v_today THEN v_errors:=v_errors||jsonb_build_array('시작일은 서버 기준 오늘(KST)보다 이전일 수 없습니다.'); END IF;
  IF p.end_on<p.start_on THEN v_errors:=v_errors||jsonb_build_array('종료일은 시작일보다 빠를 수 없습니다.'); END IF;
  IF NOT public.is_official_participant(p.student_id) OR NOT EXISTS(SELECT 1 FROM public.students s WHERE s.id=p.student_id AND s.classroom_id=v_class) THEN v_errors:=v_errors||jsonb_build_array('정착 대상 학생이 현재 학급의 공식 참여자가 아닙니다.'); END IF;
  SELECT count(*),count(*) FILTER(WHERE NOT public.is_official_participant(m.mentor_student_id) OR NOT EXISTS(SELECT 1 FROM public.students s WHERE s.id=m.mentor_student_id AND s.classroom_id=v_class) OR m.mentor_student_id=p.student_id)
    INTO v_mentor_count,v_bad_mentors FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id;
  IF v_mentor_count<p.mentor_min_count OR v_mentor_count>p.mentor_max_count OR v_bad_mentors>0 THEN v_errors:=v_errors||jsonb_build_array('멘토 구성(인원/학급/활성 상태)이 올바르지 않습니다.'); END IF;
  SELECT count(*),count(*) FILTER(WHERE r.id IS NULL OR r.classroom_id<>v_class OR r.status<>'OPEN' OR r.due_at<=private.newbie_support_start_ts(p.start_on))
    INTO v_req_count,v_bad_req FROM private.newbie_support_program_public_requests pr LEFT JOIN public.secondary_job_public_requests r ON r.id=pr.request_id WHERE pr.program_id=p.id;
  IF v_req_count<1 OR v_bad_req>0 THEN v_errors:=v_errors||jsonb_build_array('지정 공공의뢰는 같은 학급의 OPEN 상태이며 시작일 이후까지 유효해야 합니다.'); END IF;
  SELECT count(*),sum(target_count),sum(target_count*weight_per_completion),array_agg(quest_code ORDER BY quest_code)
    INTO v_qrows,v_completion,v_weight,v_codes FROM private.newbie_support_program_quests WHERE program_id=p.id;
  IF v_qrows<>7 OR v_completion<>27 OR v_weight<>40 OR v_codes<>ARRAY['ARCADE_FOCUS_50000','CLASS_HELP_BONUS_300','COLLECTION_FIRST','COLLECTION_SECOND','P2P_BUY_REVIEW','P2P_SELL_REVIEW','PUBLIC_REQUEST_DELIVERY']::text[] THEN
    v_errors:=v_errors||jsonb_build_array('프로그램 퀘스트 스냅샷이 7종/27회/가중치40 규칙과 일치하지 않습니다.');
  END IF;
  v_integrity:=private.newbie_support_template_integrity(p.template_id); IF NOT coalesce((v_integrity->>'ok')::boolean,false) THEN v_errors:=v_errors||jsonb_build_array('원본 템플릿 무결성 검증에 실패했습니다.'); END IF;
  IF p.regular_quest_pool_bv<p.total_quest_weight THEN v_errors:=v_errors||jsonb_build_array('일반 복원 BV 풀이 총 가중치보다 작아 0 BV 슬롯이 생길 수 있습니다.'); END IF;
  WITH expanded AS (
    SELECT q.id program_quest_id,q.quest_code,q.title,q.sort_order,gs::smallint occurrence_no,q.weight_per_completion,
      coalesce(sum(q.weight_per_completion) OVER(ORDER BY q.sort_order,gs ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)::bigint start_weight
    FROM private.newbie_support_program_quests q CROSS JOIN LATERAL generate_series(1,q.target_count) gs WHERE q.program_id=p.id
  ), rewards AS (
    SELECT *, ((p.regular_quest_pool_bv*(start_weight+weight_per_completion))/p.total_quest_weight)-((p.regular_quest_pool_bv*start_weight)/p.total_quest_weight) reward_bv FROM expanded
  ) SELECT count(*),coalesce(sum(reward_bv),0),coalesce(min(reward_bv),0),coalesce(jsonb_agg(jsonb_build_object('program_quest_id',program_quest_id,'quest_code',quest_code,'title',title,'occurrence_no',occurrence_no,'reward_bv',reward_bv) ORDER BY sort_order,occurrence_no),'[]'::jsonb)
    INTO v_slot_count,v_slot_sum,v_min_reward,v_slot_preview FROM rewards;
  IF v_slot_count<>27 OR v_slot_sum<>p.regular_quest_pool_bv OR v_min_reward<=0 THEN v_errors:=v_errors||jsonb_build_array('27개 보상 슬롯 계산 결과가 복원 BV 풀과 일치하지 않습니다.'); END IF;
  SELECT count(*) INTO v_baseline_count FROM public.character_collections cc WHERE cc.classroom_id=p.classroom_id AND cc.is_active AND cc.is_visible AND cc.collection_uid<>'COLL-001' AND public.character_collection_is_complete(p.student_id,cc.id);
  IF EXISTS(SELECT 1 FROM private.newbie_support_programs x WHERE x.student_id=p.student_id AND x.classroom_id=p.classroom_id AND x.status='ACTIVE' AND x.id<>p.id
    AND NOT (now()>=private.newbie_support_end_exclusive_ts(x.end_on) AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=x.id AND c.status='PENDING') AND (SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=x.id AND c.status='APPROVED')<27)) THEN
    v_errors:=v_errors||jsonb_build_array('같은 학생에게 아직 종료할 수 없는 ACTIVE 정착 프로그램이 있습니다.');
  END IF;
  IF EXISTS(SELECT 1 FROM private.newbie_support_programs x WHERE x.student_id=p.student_id AND x.classroom_id=p.classroom_id AND x.status='ACTIVE' AND x.id<>p.id
    AND now()>=private.newbie_support_end_exclusive_ts(x.end_on)) THEN v_warnings:=v_warnings||jsonb_build_array('기간이 지난 기존 ACTIVE 프로그램은 새 프로그램 활성화 시 EXPIRED로 정리됩니다.'); END IF;
  RETURN jsonb_build_object('ok',jsonb_array_length(v_errors)=0,'blocking_errors',v_errors,'warnings',v_warnings,'server_today_kst',v_today,
    'target',jsonb_build_object('student_id',p.student_id,'name',(SELECT s.name FROM public.students s WHERE s.id=p.student_id),'brand_name',(SELECT s.brand_name FROM public.students s WHERE s.id=p.student_id)),
    'mentor_validation',jsonb_build_object('count',v_mentor_count,'min',p.mentor_min_count,'max',p.mentor_max_count,'invalid_count',v_bad_mentors),
    'public_request_validation',jsonb_build_object('count',v_req_count,'invalid_count',v_bad_req),
    'quest_count',v_qrows,'completion_count',v_completion,'total_weight',v_weight,'slot_preview',v_slot_preview,'slot_reward_sum',v_slot_sum,
    'regular_pool',p.regular_quest_pool_bv,'completion_bonus',p.completion_bonus_bv,'collection_baseline_count_if_activated',v_baseline_count);
END
$fn$;

CREATE OR REPLACE FUNCTION private.teacher_activate_newbie_support_program_impl(p_program_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_class integer; p private.newbie_support_programs%ROWTYPE; v_preview jsonb; v_count integer; v_sum bigint; v_min bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PNB01'; END IF;
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id FOR UPDATE;
  IF p.id IS NULL OR p.classroom_id<>v_class THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  IF p.status='ACTIVE' THEN RETURN jsonb_build_object('program_id',p.id,'status','ACTIVE','already_active',true); END IF;
  IF p.status<>'DRAFT' THEN RAISE EXCEPTION 'DRAFT 상태에서만 활성화할 수 있습니다.' USING ERRCODE='PNB02'; END IF;
  v_preview:=private.teacher_preview_newbie_support_activation_impl(p.id);
  IF NOT coalesce((v_preview->>'ok')::boolean,false) THEN RAISE EXCEPTION '활성화 검토 실패: %',v_preview->'blocking_errors' USING ERRCODE='PNB23'; END IF;
  UPDATE private.newbie_support_programs x SET status='EXPIRED',expired_at=now(),updated_at=now()
  WHERE x.student_id=p.student_id AND x.classroom_id=p.classroom_id AND x.status='ACTIVE' AND x.id<>p.id
    AND now()>=private.newbie_support_end_exclusive_ts(x.end_on)
    AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=x.id AND c.status='PENDING')
    AND (SELECT count(*) FROM private.newbie_support_claims c WHERE c.program_id=x.id AND c.status='APPROVED')<27;
  IF EXISTS(SELECT 1 FROM private.newbie_support_programs x WHERE x.student_id=p.student_id AND x.classroom_id=p.classroom_id AND x.status='ACTIVE' AND x.id<>p.id) THEN
    RAISE EXCEPTION '같은 학생에게 이미 ACTIVE 정착 프로그램이 있습니다.' USING ERRCODE='PNB14';
  END IF;
  DELETE FROM private.newbie_support_program_collection_baseline WHERE program_id=p.id; DELETE FROM private.newbie_support_program_quest_slots WHERE program_id=p.id;
  INSERT INTO private.newbie_support_program_collection_baseline(program_id,collection_id)
  SELECT p.id,cc.id FROM public.character_collections cc
  WHERE cc.classroom_id=p.classroom_id AND cc.is_active AND cc.is_visible AND cc.collection_uid<>'COLL-001' AND public.character_collection_is_complete(p.student_id,cc.id);
  WITH expanded AS (
    SELECT q.id program_quest_id,q.sort_order,gs::smallint occurrence_no,q.weight_per_completion,
      coalesce(sum(q.weight_per_completion) OVER(ORDER BY q.sort_order,gs ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)::bigint start_weight
    FROM private.newbie_support_program_quests q CROSS JOIN LATERAL generate_series(1,q.target_count) gs WHERE q.program_id=p.id
  )
  INSERT INTO private.newbie_support_program_quest_slots(program_id,program_quest_id,occurrence_no,reward_bv)
  SELECT p.id,program_quest_id,occurrence_no,
    ((p.regular_quest_pool_bv*(start_weight+weight_per_completion))/p.total_quest_weight)-((p.regular_quest_pool_bv*start_weight)/p.total_quest_weight)
  FROM expanded ORDER BY sort_order,occurrence_no;
  SELECT count(*),coalesce(sum(reward_bv),0),coalesce(min(reward_bv),0) INTO v_count,v_sum,v_min FROM private.newbie_support_program_quest_slots WHERE program_id=p.id;
  IF v_count<>27 OR v_sum<>p.regular_quest_pool_bv OR v_min<=0 THEN RAISE EXCEPTION '보상 슬롯 무결성 검증에 실패했습니다.' USING ERRCODE='PNB10'; END IF;
  UPDATE private.newbie_support_programs SET status='ACTIVE',activated_at=now(),updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('program_id',p.id,'status','ACTIVE','slot_count',v_count,'slot_reward_sum',v_sum,'collection_baseline_count',(SELECT count(*) FROM private.newbie_support_program_collection_baseline b WHERE b.program_id=p.id));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION '같은 학생에게 이미 ACTIVE 정착 프로그램이 있습니다.' USING ERRCODE='PNB14';
END
$fn$;

