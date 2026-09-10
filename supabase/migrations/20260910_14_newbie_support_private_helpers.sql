-- B.R.A.N.D. 2.0 — Newbie Support private helpers / evidence validation
-- v1.2 FINAL AUDIT

CREATE OR REPLACE FUNCTION private.newbie_support_today_kst()
RETURNS date LANGUAGE sql STABLE SET search_path='' AS $fn$
  SELECT (now() AT TIME ZONE 'Asia/Seoul')::date;
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_start_ts(p_date date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
  SELECT p_date::timestamp AT TIME ZONE 'Asia/Seoul';
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_end_exclusive_ts(p_date date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
  SELECT (p_date + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_effective_status(p_program_id bigint)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE p private.newbie_support_programs%ROWTYPE; v_approved integer; v_pending integer; v_now timestamptz:=now();
BEGIN
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id;
  IF p.id IS NULL THEN RETURN NULL; END IF;
  IF p.status<>'ACTIVE' THEN RETURN p.status; END IF;
  SELECT count(*) FILTER(WHERE status='APPROVED'),count(*) FILTER(WHERE status='PENDING')
    INTO v_approved,v_pending FROM private.newbie_support_claims WHERE program_id=p.id;
  IF v_approved=27 THEN
    IF p.completion_requested_at IS NOT NULL THEN RETURN 'COMPLETION_PENDING'; END IF;
    RETURN 'READY_TO_COMPLETE';
  END IF;
  IF v_now < private.newbie_support_start_ts(p.start_on) THEN RETURN 'SCHEDULED'; END IF;
  IF v_now < private.newbie_support_end_exclusive_ts(p.end_on) THEN RETURN 'IN_PROGRESS'; END IF;
  IF v_pending>0 THEN RETURN 'REVIEWING'; END IF;
  RETURN 'EXPIRED';
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_assert_official_student(p_student_id integer,p_classroom_id integer,p_error text DEFAULT 'PNB08')
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF NOT public.is_official_participant(p_student_id)
     OR NOT EXISTS(SELECT 1 FROM public.students s WHERE s.id=p_student_id AND s.classroom_id=p_classroom_id) THEN
    RAISE EXCEPTION '정착 지원에 사용할 수 없는 학생입니다.' USING ERRCODE=p_error;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_validate_mentor_ids(
  p_classroom_id integer,p_target_id integer,p_mentor_ids integer[],p_min smallint,p_max smallint
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_count integer; v_id integer;
BEGIN
  IF p_mentor_ids IS NULL THEN RAISE EXCEPTION '멘토 목록이 필요합니다.' USING ERRCODE='PNB09'; END IF;
  v_count:=cardinality(p_mentor_ids);
  IF v_count IS NULL OR v_count<p_min OR v_count>p_max THEN
    RAISE EXCEPTION '멘토는 %~%명이어야 합니다.',p_min,p_max USING ERRCODE='PNB09';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_mentor_ids) x)<>v_count THEN
    RAISE EXCEPTION '같은 멘토가 중복 지정되었습니다.' USING ERRCODE='PNB08';
  END IF;
  FOREACH v_id IN ARRAY p_mentor_ids LOOP
    IF v_id=p_target_id THEN RAISE EXCEPTION '정착 대상자는 자신의 멘토가 될 수 없습니다.' USING ERRCODE='PNB08'; END IF;
    PERFORM private.newbie_support_assert_official_student(v_id,p_classroom_id,'PNB08');
  END LOOP;
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_validate_public_request_ids(
  p_classroom_id integer,p_request_ids bigint[],p_require_open boolean DEFAULT false,p_start_on date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_count integer; v_valid integer;
BEGIN
  IF p_request_ids IS NULL OR cardinality(p_request_ids)<1 THEN
    RAISE EXCEPTION '정착 공공의뢰를 1개 이상 지정해야 합니다.' USING ERRCODE='PNB15';
  END IF;
  v_count:=cardinality(p_request_ids);
  IF (SELECT count(DISTINCT x) FROM unnest(p_request_ids) x)<>v_count THEN
    RAISE EXCEPTION '공공의뢰가 중복 지정되었습니다.' USING ERRCODE='PNB15';
  END IF;
  SELECT count(*) INTO v_valid
  FROM public.secondary_job_public_requests r
  WHERE r.id=ANY(p_request_ids) AND r.classroom_id=p_classroom_id
    AND (NOT p_require_open OR (r.status='OPEN' AND (p_start_on IS NULL OR r.due_at>private.newbie_support_start_ts(p_start_on))));
  IF v_valid<>v_count THEN
    RAISE EXCEPTION '정착 공공의뢰가 현재 학급/상태 조건과 맞지 않습니다.' USING ERRCODE=CASE WHEN p_require_open THEN 'PNB28' ELSE 'PNB15' END;
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_template_integrity(p_template_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_rows int; v_count int; v_weight int; v_codes text[]; v_ok boolean;
BEGIN
  SELECT count(*),coalesce(sum(target_count),0),coalesce(sum(target_count*weight_per_completion),0),array_agg(quest_code ORDER BY quest_code)
    INTO v_rows,v_count,v_weight,v_codes
  FROM private.newbie_support_template_quests WHERE template_id=p_template_id;
  v_ok := v_rows=7 AND v_count=27 AND v_weight=40 AND v_codes=ARRAY[
    'ARCADE_FOCUS_50000','CLASS_HELP_BONUS_300','COLLECTION_FIRST','COLLECTION_SECOND',
    'P2P_BUY_REVIEW','P2P_SELL_REVIEW','PUBLIC_REQUEST_DELIVERY'
  ]::text[];
  RETURN jsonb_build_object('ok',v_ok,'quest_rows',v_rows,'completion_count',v_count,'total_weight',v_weight,'quest_codes',coalesce(to_jsonb(v_codes),'[]'::jsonb));
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_p2p_mentor_cap_ok(
  p_program_id bigint,p_direction text,p_counterparty_id integer,p_current_claim_id bigint DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_cap integer; v_is_mentor boolean; v_used integer;
BEGIN
  SELECT mentor_p2p_cap INTO v_cap FROM private.newbie_support_programs WHERE id=p_program_id;
  SELECT EXISTS(SELECT 1 FROM private.newbie_support_program_mentors m WHERE m.program_id=p_program_id AND m.mentor_student_id=p_counterparty_id) INTO v_is_mentor;
  IF NOT v_is_mentor THEN RETURN true; END IF;
  IF v_cap<=0 THEN RETURN false; END IF;
  IF p_direction='SELL' THEN
    SELECT count(*) INTO v_used
    FROM private.newbie_support_claims c
    JOIN public.secondary_job_service_orders o ON o.id=c.evidence_ref_id
    WHERE c.program_id=p_program_id AND c.evidence_type='P2P_SELL_REVIEW'
      AND c.status IN ('PENDING','APPROVED') AND o.buyer_student_id=p_counterparty_id
      AND (p_current_claim_id IS NULL OR c.id<>p_current_claim_id);
  ELSE
    SELECT count(*) INTO v_used
    FROM private.newbie_support_claims c
    JOIN public.secondary_job_service_orders o ON o.id=c.evidence_ref_id
    WHERE c.program_id=p_program_id AND c.evidence_type='P2P_BUY_REVIEW'
      AND c.status IN ('PENDING','APPROVED') AND o.seller_student_id=p_counterparty_id
      AND (p_current_claim_id IS NULL OR c.id<>p_current_claim_id);
  END IF;
  RETURN v_used<v_cap;
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_validate_evidence(
  p_program_id bigint,p_quest_code text,p_evidence_ref_id bigint,p_current_claim_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
  p private.newbie_support_programs%ROWTYPE;
  v_start timestamptz; v_end timestamptz;
  v_detail jsonb; v_counterparty integer; v_first_collection bigint; v_max_acquired timestamptz; v_member_count integer;
BEGIN
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id;
  IF p.id IS NULL THEN RAISE EXCEPTION '정착 프로그램을 찾을 수 없습니다.' USING ERRCODE='PNB01'; END IF;
  v_start:=private.newbie_support_start_ts(p.start_on); v_end:=private.newbie_support_end_exclusive_ts(p.end_on);

  IF p_quest_code='P2P_SELL_REVIEW' THEN
    SELECT o.buyer_student_id,
      jsonb_build_object('order_id',o.id,'service_id',o.service_id,'service_title',o.service_title_snapshot,
        'service_category',o.service_category_snapshot,'price_gold',o.price_gold_snapshot,'quantity',coalesce(o.quantity,o.requested_quantity,1),
        'buyer_student_id',o.buyer_student_id,'buyer_name',bs.name,'buyer_brand_name',bs.brand_name,
        'rating',rv.rating,'review_text',rv.review_text,'completed_at',o.completed_at)
      INTO v_counterparty,v_detail
    FROM public.secondary_job_service_orders o
    JOIN public.secondary_job_service_reviews rv ON rv.order_id=o.id
    JOIN public.students bs ON bs.id=o.buyer_student_id
    WHERE o.id=p_evidence_ref_id AND o.classroom_id=p.classroom_id AND o.seller_student_id=p.student_id
      AND o.status='COMPLETED' AND o.completed_at>=v_start AND o.completed_at<v_end
      AND rv.seller_student_id=p.student_id AND rv.buyer_student_id=o.buyer_student_id
      AND rv.is_rating_valid AND rv.is_review_visible AND char_length(btrim(rv.review_text))>=2;
    IF v_detail IS NULL THEN RAISE EXCEPTION '판매 서비스 완료/후기 조건을 확인할 수 없습니다.' USING ERRCODE='PNB05'; END IF;
    IF NOT private.newbie_support_p2p_mentor_cap_ok(p.id,'SELL',v_counterparty,p_current_claim_id) THEN
      RAISE EXCEPTION '해당 멘토와의 판매 거래는 정착 퀘스트 인정 한도를 넘었습니다.' USING ERRCODE='PNB07';
    END IF;
    RETURN v_detail || jsonb_build_object('counterparty_is_mentor',EXISTS(SELECT 1 FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id AND m.mentor_student_id=v_counterparty));

  ELSIF p_quest_code='P2P_BUY_REVIEW' THEN
    SELECT o.seller_student_id,
      jsonb_build_object('order_id',o.id,'service_id',o.service_id,'service_title',o.service_title_snapshot,
        'service_category',o.service_category_snapshot,'price_gold',o.price_gold_snapshot,'quantity',coalesce(o.quantity,o.requested_quantity,1),
        'seller_student_id',o.seller_student_id,'seller_name',ss.name,'seller_brand_name',ss.brand_name,
        'rating',rv.rating,'review_text',rv.review_text,'completed_at',o.completed_at)
      INTO v_counterparty,v_detail
    FROM public.secondary_job_service_orders o
    JOIN public.secondary_job_service_reviews rv ON rv.order_id=o.id
    JOIN public.students ss ON ss.id=o.seller_student_id
    WHERE o.id=p_evidence_ref_id AND o.classroom_id=p.classroom_id AND o.buyer_student_id=p.student_id
      AND o.status='COMPLETED' AND o.completed_at>=v_start AND o.completed_at<v_end
      AND rv.buyer_student_id=p.student_id AND rv.seller_student_id=o.seller_student_id
      AND rv.is_rating_valid AND rv.is_review_visible AND char_length(btrim(rv.review_text))>=2;
    IF v_detail IS NULL THEN RAISE EXCEPTION '구매 서비스 완료/후기 조건을 확인할 수 없습니다.' USING ERRCODE='PNB05'; END IF;
    IF NOT private.newbie_support_p2p_mentor_cap_ok(p.id,'BUY',v_counterparty,p_current_claim_id) THEN
      RAISE EXCEPTION '해당 멘토와의 구매 거래는 정착 퀘스트 인정 한도를 넘었습니다.' USING ERRCODE='PNB07';
    END IF;
    RETURN v_detail || jsonb_build_object('counterparty_is_mentor',EXISTS(SELECT 1 FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id AND m.mentor_student_id=v_counterparty));

  ELSIF p_quest_code IN ('COLLECTION_FIRST','COLLECTION_SECOND') THEN
    SELECT count(*),max(sc.acquired_at)
      INTO v_member_count,v_max_acquired
    FROM public.character_collection_members m
    JOIN public.student_characters sc ON sc.student_id=p.student_id AND sc.classroom_id=p.classroom_id AND sc.character_id=m.character_id AND sc.is_owned
    WHERE m.collection_id=p_evidence_ref_id AND m.is_active;
    SELECT jsonb_build_object('collection_id',cc.id,'collection_uid',cc.collection_uid,'collection_name',cc.name,
      'required_member_count',v_member_count,'completed_at',v_max_acquired)
      INTO v_detail
    FROM public.character_collections cc
    WHERE cc.id=p_evidence_ref_id AND cc.classroom_id=p.classroom_id AND cc.is_active AND cc.is_visible AND cc.collection_uid<>'COLL-001'
      AND NOT EXISTS(SELECT 1 FROM private.newbie_support_program_collection_baseline b WHERE b.program_id=p.id AND b.collection_id=cc.id)
      AND public.character_collection_is_complete(p.student_id,cc.id)
      AND v_member_count>0 AND v_max_acquired>=v_start AND v_max_acquired<v_end;
    IF v_detail IS NULL THEN RAISE EXCEPTION '정착 기간 중 새로 완성한 인정 가능한 컬렉션이 아닙니다.' USING ERRCODE='PNB17'; END IF;
    IF p_quest_code='COLLECTION_SECOND' THEN
      SELECT c.evidence_ref_id INTO v_first_collection
      FROM private.newbie_support_claims c
      JOIN private.newbie_support_program_quest_slots sl ON sl.id=c.slot_id AND sl.program_id=c.program_id
      JOIN private.newbie_support_program_quests q ON q.id=sl.program_quest_id AND q.program_id=sl.program_id
      WHERE c.program_id=p.id AND c.status='APPROVED' AND q.quest_code='COLLECTION_FIRST'
      ORDER BY c.reviewed_at,c.id LIMIT 1;
      IF v_first_collection IS NULL THEN RAISE EXCEPTION '첫 번째 컬렉션 승인이 먼저 필요합니다.' USING ERRCODE='PNB17'; END IF;
      IF v_first_collection=p_evidence_ref_id THEN RAISE EXCEPTION '두 번째 컬렉션은 첫 번째와 달라야 합니다.' USING ERRCODE='PNB17'; END IF;
    END IF;
    RETURN v_detail;

  ELSIF p_quest_code='PUBLIC_REQUEST_DELIVERY' THEN
    SELECT jsonb_build_object('assignment_id',a.id,'request_id',a.request_id,'request_title',r.title,
      'status',a.status,'submitted_at',a.submitted_at,'job_name',a.job_name_snapshot,'teacher_feedback',a.teacher_feedback)
      INTO v_detail
    FROM public.secondary_job_public_assignments a
    JOIN public.secondary_job_public_requests r ON r.id=a.request_id
    JOIN private.newbie_support_program_public_requests pr ON pr.program_id=p.id AND pr.request_id=a.request_id
    WHERE a.id=p_evidence_ref_id AND a.classroom_id=p.classroom_id AND a.student_id=p.student_id
      AND a.submitted_at IS NOT NULL AND a.submitted_at>=v_start AND a.submitted_at<v_end
      AND a.status IN ('SUBMITTED','REVISION_REQUESTED','COMPLETED','FAILED')
      AND r.classroom_id=p.classroom_id AND r.status<>'CANCELLED';
    IF v_detail IS NULL THEN RAISE EXCEPTION '지정 공공의뢰의 유효한 납품 기록이 아닙니다.' USING ERRCODE='PNB15'; END IF;
    RETURN v_detail;

  ELSIF p_quest_code='CLASS_HELP_BONUS_300' THEN
    SELECT jsonb_build_object('transaction_id',t.id,'amount',t.amount,'memo',t.memo,'created_at',t.created_at)
      INTO v_detail FROM public.transactions t
    WHERE t.id=p_evidence_ref_id AND t.student_id=p.student_id AND t.classroom_id=p.classroom_id
      AND t.value_token='BV'::public.value_token_type AND t.amount=300
      AND t.source_type='TEACHER_GRANT'::public.transaction_source_type AND NOT t.is_reversed
      AND t.created_at>=v_start AND t.created_at<v_end;
    IF v_detail IS NULL THEN RAISE EXCEPTION '+300 수업 참여/학급 도움 후보 거래가 아닙니다.' USING ERRCODE='PNB05'; END IF;
    RETURN v_detail;

  ELSIF p_quest_code='ARCADE_FOCUS_50000' THEN
    SELECT jsonb_build_object('run_id',r.id,'game_code',g.code,'score',r.official_score,'play_started_at',r.play_started_at,'game_over_at',r.game_over_at)
      INTO v_detail
    FROM public.arcade_runs r JOIN public.arcade_games g ON g.id=r.game_id
    WHERE r.id=p_evidence_ref_id AND r.classroom_id=p.classroom_id AND r.student_id=p.student_id
      AND g.code='focus_reaction_01' AND g.is_active
      AND r.status='VERIFIED' AND r.official_score>=50000 AND NOT r.is_prerelease_test AND r.run_context='STANDARD'
      AND r.play_started_at>=v_start AND r.game_over_at<v_end
      AND NOT EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE');
    IF v_detail IS NULL THEN RAISE EXCEPTION '집중 반응 50,000점 조건을 충족한 유효 기록이 아닙니다.' USING ERRCODE='PNB16'; END IF;
    RETURN v_detail;
  END IF;
  RAISE EXCEPTION '알 수 없는 정착 퀘스트 검증 유형입니다.' USING ERRCODE='PNB05';
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_inspect_evidence(
  p_program_id bigint,p_quest_code text,p_evidence_ref_id bigint,p_current_claim_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_detail jsonb;
BEGIN
  BEGIN
    v_detail:=private.newbie_support_validate_evidence(p_program_id,p_quest_code,p_evidence_ref_id,p_current_claim_id);
    RETURN jsonb_build_object('valid',true,'detail',v_detail);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('valid',false,'error_code',SQLSTATE,'error_message',SQLERRM,'detail','{}'::jsonb);
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION private.newbie_support_evidence_candidates(p_program_id bigint,p_quest_code text,p_student_view boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE p private.newbie_support_programs%ROWTYPE; v_start timestamptz; v_end timestamptz; v_rows jsonb:='[]'::jsonb; v_first_collection bigint;
BEGIN
  SELECT * INTO p FROM private.newbie_support_programs WHERE id=p_program_id;
  IF p.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_start:=private.newbie_support_start_ts(p.start_on); v_end:=private.newbie_support_end_exclusive_ts(p.end_on);

  IF p_quest_code='P2P_SELL_REVIEW' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'evidence_ref_id',o.id,'occurred_at',o.completed_at,'primary_label',o.service_title_snapshot,
      'secondary_label',coalesce(bs.brand_name,bs.name),'summary',format('%s GOLD · 후기·평점 등록 완료',coalesce(o.price_gold_snapshot,0)),
      'meta',jsonb_build_object('price_gold',o.price_gold_snapshot,'quantity',coalesce(o.quantity,o.requested_quantity,1),
        'counterparty_is_mentor',EXISTS(SELECT 1 FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id AND m.mentor_student_id=o.buyer_student_id),
        'review_complete',true)
    ) ORDER BY o.completed_at,o.id),'[]'::jsonb) INTO v_rows
    FROM public.secondary_job_service_orders o JOIN public.secondary_job_service_reviews rv ON rv.order_id=o.id JOIN public.students bs ON bs.id=o.buyer_student_id
    WHERE o.classroom_id=p.classroom_id AND o.seller_student_id=p.student_id AND o.status='COMPLETED'
      AND o.completed_at>=v_start AND o.completed_at<v_end AND rv.seller_student_id=p.student_id AND rv.buyer_student_id=o.buyer_student_id
      AND rv.is_rating_valid AND rv.is_review_visible AND char_length(btrim(rv.review_text))>=2
      AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=p_quest_code AND c.evidence_ref_id=o.id AND c.status IN ('PENDING','APPROVED'))
      AND private.newbie_support_p2p_mentor_cap_ok(p.id,'SELL',o.buyer_student_id,NULL);

  ELSIF p_quest_code='P2P_BUY_REVIEW' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'evidence_ref_id',o.id,'occurred_at',o.completed_at,'primary_label',o.service_title_snapshot,
      'secondary_label',coalesce(ss.brand_name,ss.name),'summary',format('%s GOLD · 내가 남긴 후기·평점',coalesce(o.price_gold_snapshot,0)),
      'meta',jsonb_build_object('price_gold',o.price_gold_snapshot,'quantity',coalesce(o.quantity,o.requested_quantity,1),
        'counterparty_is_mentor',EXISTS(SELECT 1 FROM private.newbie_support_program_mentors m WHERE m.program_id=p.id AND m.mentor_student_id=o.seller_student_id),
        'rating',rv.rating,'review_text',rv.review_text)
    ) ORDER BY o.completed_at,o.id),'[]'::jsonb) INTO v_rows
    FROM public.secondary_job_service_orders o JOIN public.secondary_job_service_reviews rv ON rv.order_id=o.id JOIN public.students ss ON ss.id=o.seller_student_id
    WHERE o.classroom_id=p.classroom_id AND o.buyer_student_id=p.student_id AND o.status='COMPLETED'
      AND o.completed_at>=v_start AND o.completed_at<v_end AND rv.buyer_student_id=p.student_id AND rv.seller_student_id=o.seller_student_id
      AND rv.is_rating_valid AND rv.is_review_visible AND char_length(btrim(rv.review_text))>=2
      AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=p_quest_code AND c.evidence_ref_id=o.id AND c.status IN ('PENDING','APPROVED'))
      AND private.newbie_support_p2p_mentor_cap_ok(p.id,'BUY',o.seller_student_id,NULL);

  ELSIF p_quest_code IN ('COLLECTION_FIRST','COLLECTION_SECOND') THEN
    IF p_quest_code='COLLECTION_SECOND' THEN
      SELECT c.evidence_ref_id INTO v_first_collection
      FROM private.newbie_support_claims c JOIN private.newbie_support_program_quest_slots sl ON sl.id=c.slot_id
      JOIN private.newbie_support_program_quests q ON q.id=sl.program_quest_id
      WHERE c.program_id=p.id AND c.status='APPROVED' AND q.quest_code='COLLECTION_FIRST' LIMIT 1;
      IF v_first_collection IS NULL THEN RETURN '[]'::jsonb; END IF;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'evidence_ref_id',x.collection_id,'occurred_at',x.completed_at,'primary_label',x.collection_name,
      'secondary_label',x.collection_uid,'summary',format('필요 편린 %s종 완성',x.required_count),
      'meta',jsonb_build_object('collection_uid',x.collection_uid,'required_count',x.required_count)
    ) ORDER BY x.sort_order,x.collection_id),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT cc.id collection_id,cc.collection_uid,cc.name collection_name,cc.sort_order,
        count(m.id)::int required_count,max(sc.acquired_at) completed_at
      FROM public.character_collections cc
      JOIN public.character_collection_members m ON m.collection_id=cc.id AND m.is_active
      JOIN public.student_characters sc ON sc.student_id=p.student_id AND sc.classroom_id=p.classroom_id AND sc.character_id=m.character_id AND sc.is_owned
      WHERE cc.classroom_id=p.classroom_id AND cc.is_active AND cc.is_visible AND cc.collection_uid<>'COLL-001'
        AND NOT EXISTS(SELECT 1 FROM private.newbie_support_program_collection_baseline b WHERE b.program_id=p.id AND b.collection_id=cc.id)
        AND (v_first_collection IS NULL OR cc.id<>v_first_collection)
      GROUP BY cc.id,cc.collection_uid,cc.name,cc.sort_order
      HAVING public.character_collection_is_complete(p.student_id,cc.id)
        AND max(sc.acquired_at)>=v_start AND max(sc.acquired_at)<v_end
    ) x
    WHERE NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=p_quest_code AND c.evidence_ref_id=x.collection_id AND c.status IN ('PENDING','APPROVED'));

  ELSIF p_quest_code='PUBLIC_REQUEST_DELIVERY' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'evidence_ref_id',a.id,'occurred_at',a.submitted_at,'primary_label',r.title,
      'secondary_label',a.job_name_snapshot,'summary',format('납품 상태: %s',a.status),
      'meta',jsonb_build_object('request_id',r.id,'assignment_status',a.status)
    ) ORDER BY a.submitted_at,a.id),'[]'::jsonb) INTO v_rows
    FROM public.secondary_job_public_assignments a JOIN public.secondary_job_public_requests r ON r.id=a.request_id
    JOIN private.newbie_support_program_public_requests pr ON pr.program_id=p.id AND pr.request_id=a.request_id
    WHERE a.classroom_id=p.classroom_id AND a.student_id=p.student_id AND a.submitted_at>=v_start AND a.submitted_at<v_end
      AND a.status IN ('SUBMITTED','REVISION_REQUESTED','COMPLETED','FAILED') AND r.status<>'CANCELLED'
      AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=p_quest_code AND c.evidence_ref_id=a.id AND c.status IN ('PENDING','APPROVED'));

  ELSIF p_quest_code='CLASS_HELP_BONUS_300' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'evidence_ref_id',t.id,'occurred_at',t.created_at,'primary_label','+300 BV 보너스',
      'secondary_label',NULL,'summary',coalesce(t.memo,'교사 BV 지급'),
      'meta',jsonb_build_object('memo',t.memo)
    ) ORDER BY t.created_at,t.id),'[]'::jsonb) INTO v_rows
    FROM public.transactions t
    WHERE t.student_id=p.student_id AND t.classroom_id=p.classroom_id AND t.value_token='BV'::public.value_token_type AND t.amount=300
      AND t.source_type='TEACHER_GRANT'::public.transaction_source_type AND NOT t.is_reversed AND t.created_at>=v_start AND t.created_at<v_end
      AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=p_quest_code AND c.evidence_ref_id=t.id AND c.status IN ('PENDING','APPROVED'));

  ELSIF p_quest_code='ARCADE_FOCUS_50000' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'evidence_ref_id',r.id,'occurred_at',r.game_over_at,'primary_label',format('집중 반응 %s점',r.official_score),
      'secondary_label','일반 플레이','summary','50,000점 이상 달성',
      'meta',jsonb_build_object('score',r.official_score,'game_code',g.code)
    ) ORDER BY r.official_score DESC,r.game_over_at,r.id),'[]'::jsonb) INTO v_rows
    FROM public.arcade_runs r JOIN public.arcade_games g ON g.id=r.game_id
    WHERE r.classroom_id=p.classroom_id AND r.student_id=p.student_id AND g.code='focus_reaction_01' AND g.is_active
      AND r.status='VERIFIED' AND r.official_score>=50000 AND NOT r.is_prerelease_test AND r.run_context='STANDARD'
      AND r.play_started_at>=v_start AND r.game_over_at<v_end
      AND NOT EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE')
      AND NOT EXISTS(SELECT 1 FROM private.newbie_support_claims c WHERE c.program_id=p.id AND c.evidence_type=p_quest_code AND c.evidence_ref_id=r.id AND c.status IN ('PENDING','APPROVED'));
  END IF;
  RETURN coalesce(v_rows,'[]'::jsonb);
END
$fn$;

CREATE OR REPLACE FUNCTION private.compute_official_monthly_bv_gain(p_student_id integer,p_month_start date)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_start timestamptz; v_end timestamptz; v_result bigint;
BEGIN
  IF p_month_start<>date_trunc('month',p_month_start::timestamp)::date THEN
    RAISE EXCEPTION 'month_start는 월 1일이어야 합니다.' USING ERRCODE='22023';
  END IF;
  v_start:=private.newbie_support_start_ts(p_month_start);
  v_end:=private.newbie_support_start_ts((p_month_start+interval '1 month')::date);
  SELECT coalesce(sum(t.amount),0)::bigint INTO v_result
  FROM public.transactions t
  WHERE t.student_id=p_student_id AND t.value_token='BV'::public.value_token_type
    AND t.created_at>=v_start AND t.created_at<v_end
    AND NOT EXISTS(SELECT 1 FROM private.transaction_record_exclusions x WHERE x.transaction_id=t.id AND x.record_scope='MONTHLY_BV_GAIN');
  RETURN v_result;
END
$fn$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,anon,authenticated;
