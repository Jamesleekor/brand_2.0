-- ============================================================================
-- B.R.A.N.D 2.0 — Feature 4C: 출석 · 과제
-- Fault domain: F4C / SQLSTATE P4Cxx
-- ============================================================================
BEGIN;
DO $$ BEGIN
 RAISE NOTICE '[F4C] preflight: attendance + assignments';
 IF to_regclass('public.attendances') IS NULL OR to_regclass('public.assignments') IS NULL OR to_regclass('public.assignment_submissions') IS NULL OR to_regclass('public.assignment_gradings') IS NULL THEN
  RAISE EXCEPTION '[F4C] required learning tables missing' USING ERRCODE='P4C01'; END IF;
 IF to_regprocedure('public.record_attendance(integer,date,public.attendance_status)') IS NULL
    OR to_regprocedure('public.reverse_transaction(bigint,text)') IS NULL
    OR to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') IS NULL
    OR to_regprocedure('public.ensure_teacher_role()') IS NULL
    OR to_regprocedure('public.ensure_self_or_teacher(integer)') IS NULL
    OR to_regprocedure('public.is_classroom_member(integer)') IS NULL THEN
  RAISE EXCEPTION '[F4C] Feature2 / attendance dependency missing' USING ERRCODE='P4C02'; END IF;
 IF to_regprocedure('public.send_mail(integer,public.mail_sender_type,integer,uuid,character varying,text,public.mail_message_type,public.transaction_source_type,bigint)') IS NULL
    OR to_regprocedure('public.push_activity_feed(integer,public.activity_feed_type,integer,jsonb,public.activity_visibility)') IS NULL THEN
  RAISE EXCEPTION '[F4C] Feature4A communication helpers missing or mismatched' USING ERRCODE='P4C03'; END IF;
END $$;

-- 학생 제출: SECURITY DEFINER + 본인 검증으로 create_transaction 내부호출 보장
CREATE OR REPLACE FUNCTION public.submit_assignment(p_student_id integer,p_assignment_id integer,p_content_text text DEFAULT NULL,p_attachment_urls jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE a public.assignments%ROWTYPE; v_class integer; v_id bigint; v_late boolean; v_tx bigint;
BEGIN
 PERFORM public.ensure_self_or_teacher(p_student_id);
 SELECT * INTO a FROM public.assignments WHERE id=p_assignment_id AND status='PUBLISHED';
 IF a.id IS NULL THEN RAISE EXCEPTION '[F4C] assignment not published' USING ERRCODE='P4C10'; END IF;
 SELECT classroom_id INTO v_class FROM public.students WHERE id=p_student_id AND transferred_at IS NULL AND role='STUDENT';
 IF v_class IS NULL OR v_class<>a.classroom_id THEN RAISE EXCEPTION '[F4C] assignment classroom mismatch' USING ERRCODE='P4C11'; END IF;
 IF EXISTS(SELECT 1 FROM public.assignment_submissions WHERE assignment_id=p_assignment_id AND student_id=p_student_id AND status<>'RETURNED') THEN
  RAISE EXCEPTION '[F4C] assignment already submitted' USING ERRCODE='P4C12'; END IF;
 IF char_length(coalesce(p_content_text,''))>5000 THEN RAISE EXCEPTION '[F4C] submission too long' USING ERRCODE='P4C13'; END IF;
 IF p_attachment_urls IS NOT NULL AND jsonb_typeof(p_attachment_urls)<>'array' THEN RAISE EXCEPTION '[F4C] attachments must be a JSON array' USING ERRCODE='P4C14'; END IF;
 IF nullif(btrim(coalesce(p_content_text,'')),'') IS NULL
    AND (p_attachment_urls IS NULL OR jsonb_array_length(p_attachment_urls)=0) THEN
  RAISE EXCEPTION '[F4C] submission content or attachment is required' USING ERRCODE='P4C15'; END IF;
 IF p_attachment_urls IS NOT NULL AND jsonb_array_length(p_attachment_urls)>5 THEN RAISE EXCEPTION '[F4C] at most 5 attachments are allowed' USING ERRCODE='P4C16'; END IF;
 IF p_attachment_urls IS NOT NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_attachment_urls) AS u
    WHERE jsonb_typeof(u)<>'string' OR char_length(u #>> '{}')>2000 OR (u #>> '{}') !~ '^https?://'
 ) THEN RAISE EXCEPTION '[F4C] attachment URLs must be http(s) strings up to 2000 chars' USING ERRCODE='P4C17'; END IF;
 v_late:=now()>a.due_at;
 INSERT INTO public.assignment_submissions(assignment_id,classroom_id,student_id,content_text,attachment_urls,is_late)
 VALUES(p_assignment_id,v_class,p_student_id,nullif(btrim(coalesce(p_content_text,'')),''),p_attachment_urls,v_late) RETURNING id INTO v_id;
 IF a.auto_reward_on_submit AND a.base_reward_gold>0
    AND NOT EXISTS(SELECT 1 FROM public.assignment_submissions WHERE assignment_id=p_assignment_id AND student_id=p_student_id AND base_reward_given) THEN
  v_tx:=public.create_transaction(p_student_id,'GOLD',a.base_reward_gold,'ASSIGNMENT_SUBMIT',v_id,0,format('[과제 제출] %s',a.title));
  UPDATE public.assignment_submissions SET base_reward_given=true,transaction_id_base=v_tx WHERE id=v_id;
 END IF;
 RETURN v_id;
END $$;

-- 교사 채점: 교사·학급 검증 + 원자적 보상
CREATE OR REPLACE FUNCTION public.grade_assignment(p_submission_id bigint,p_score integer,p_feedback text DEFAULT NULL,p_teacher_user_id uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE s public.assignment_submissions%ROWTYPE; a public.assignments%ROWTYPE; v_id bigint; v_full boolean; v_tx bigint;
BEGIN
 PERFORM public.ensure_teacher_role();
 SELECT * INTO s FROM public.assignment_submissions WHERE id=p_submission_id FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION '[F4C] submission not found' USING ERRCODE='P4C20'; END IF;
 IF NOT public.is_classroom_member(s.classroom_id) THEN RAISE EXCEPTION '[F4C] teacher classroom denied' USING ERRCODE='P4C21'; END IF;
 IF s.status='GRADED' OR EXISTS(SELECT 1 FROM public.assignment_gradings WHERE submission_id=p_submission_id AND NOT is_revoked) THEN
  RAISE EXCEPTION '[F4C] submission already graded' USING ERRCODE='P4C22'; END IF;
 SELECT * INTO a FROM public.assignments WHERE id=s.assignment_id;
 IF a.id IS NULL THEN RAISE EXCEPTION '[F4C] assignment not found for submission' USING ERRCODE='P4C24'; END IF;
 IF p_score<0 OR p_score>a.max_score THEN RAISE EXCEPTION '[F4C] score out of range' USING ERRCODE='P4C23'; END IF;
 IF char_length(coalesce(p_feedback,''))>5000 THEN RAISE EXCEPTION '[F4C] feedback too long' USING ERRCODE='P4C25'; END IF;
 v_full:=(p_score=a.max_score);
 INSERT INTO public.assignment_gradings(submission_id,score,is_full_score,feedback,grading_method,graded_by)
 VALUES(p_submission_id,p_score,v_full,nullif(btrim(coalesce(p_feedback,'')),''),'MANUAL',auth.uid()) RETURNING id INTO v_id;
 UPDATE public.assignment_submissions SET status='GRADED' WHERE id=p_submission_id;
 IF v_full AND a.full_score_reward_bv>0 THEN
  v_tx:=public.create_transaction(s.student_id,'BV',a.full_score_reward_bv,'ASSIGNMENT_EXCELLENCE',v_id,0,format('[과제 만점 명예] %s — BV %s',a.title,a.full_score_reward_bv));
  UPDATE public.assignment_gradings SET full_score_bonus_given=true,transaction_id_bonus=v_tx WHERE id=v_id;
  PERFORM public.send_mail(s.student_id,'TEACHER',NULL,auth.uid(),format('🎉 만점 축하! %s',a.title),format('과제 "%s"에서 만점을 받았습니다. BV %s가 추가되었습니다.',a.title,a.full_score_reward_bv),'REWARD','ASSIGNMENT_EXCELLENCE',v_id);
  PERFORM public.push_activity_feed(s.classroom_id,'ASSIGNMENT_GRADE',s.student_id,jsonb_build_object('assignment_title',a.title,'is_full_score',true),'PUBLIC');
 END IF;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_create_assignment(
 p_classroom_id integer,p_title text,p_description text,p_subject text,p_due_at timestamptz,p_max_score integer,p_base_reward_gold integer,p_full_score_reward_bv integer,p_publish_now boolean DEFAULT true
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v_id integer; BEGIN
 PERFORM public.ensure_teacher_role();
 IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4C] teacher classroom denied' USING ERRCODE='P4C21'; END IF;
 IF char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '[F4C] assignment title invalid' USING ERRCODE='P4C30'; END IF;
 IF char_length(coalesce(p_description,''))>5000 OR char_length(coalesce(p_subject,''))>50 THEN RAISE EXCEPTION '[F4C] assignment text fields too long' USING ERRCODE='P4C34'; END IF;
 IF p_due_at<=now() THEN RAISE EXCEPTION '[F4C] due date must be future' USING ERRCODE='P4C31'; END IF;
 IF p_max_score NOT BETWEEN 1 AND 1000 OR p_base_reward_gold NOT BETWEEN 0 AND 10000 OR p_full_score_reward_bv NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION '[F4C] assignment numeric values invalid' USING ERRCODE='P4C32'; END IF;
 INSERT INTO public.assignments(classroom_id,title,description,subject,published_at,due_at,max_score,base_reward_gold,full_score_reward_bv,auto_reward_on_submit,status,created_by)
 VALUES(p_classroom_id,btrim(p_title),nullif(btrim(coalesce(p_description,'')),''),nullif(btrim(coalesce(p_subject,'')),''),CASE WHEN p_publish_now THEN now() ELSE NULL END,p_due_at,p_max_score,p_base_reward_gold,p_full_score_reward_bv,true,CASE WHEN p_publish_now THEN 'PUBLISHED'::public.assignment_status ELSE 'DRAFT'::public.assignment_status END,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_set_assignment_status(p_assignment_id integer,p_status public.assignment_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v_class integer; BEGIN
 PERFORM public.ensure_teacher_role(); SELECT classroom_id INTO v_class FROM public.assignments WHERE id=p_assignment_id FOR UPDATE;
 IF v_class IS NULL THEN RAISE EXCEPTION '[F4C] assignment not found' USING ERRCODE='P4C33'; END IF;
 IF NOT public.is_classroom_member(v_class) THEN RAISE EXCEPTION '[F4C] teacher classroom denied' USING ERRCODE='P4C21'; END IF;
 IF p_status='PUBLISHED'::public.assignment_status AND EXISTS(SELECT 1 FROM public.assignments WHERE id=p_assignment_id AND due_at<=now()) THEN
  RAISE EXCEPTION '[F4C] cannot publish an assignment whose due date has passed' USING ERRCODE='P4C35'; END IF;
 UPDATE public.assignments SET status=p_status,published_at=CASE WHEN p_status='PUBLISHED' AND published_at IS NULL THEN now() ELSE published_at END,updated_at=now() WHERE id=p_assignment_id;
END $$;

-- 오늘 출석 일괄 입력: 부분 성공 대신 유효한 입력 전체가 한 트랜잭션으로 처리됨
CREATE OR REPLACE FUNCTION public.teacher_record_attendance_bulk(p_classroom_id integer,p_attendance_date date,p_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE e jsonb; v_student integer; v_status public.attendance_status; v_id bigint; v_recorded jsonb:='[]'::jsonb; v_skipped jsonb:='[]'::jsonb; v_today date:=timezone('Asia/Seoul',now())::date;
BEGIN
 PERFORM public.ensure_teacher_role();
 IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4C] teacher classroom denied' USING ERRCODE='P4C21'; END IF;
 IF p_attendance_date<>v_today THEN RAISE EXCEPTION '[F4C] bulk attendance is limited to today (KST) for safe streak accounting' USING ERRCODE='P4C40'; END IF;
 IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries)<1 OR jsonb_array_length(p_entries)>100 THEN RAISE EXCEPTION '[F4C] attendance entries must contain 1-100 rows' USING ERRCODE='P4C41'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_entries)) <>
    (SELECT count(DISTINCT (x->>'student_id')) FROM jsonb_array_elements(p_entries) AS x) THEN
  RAISE EXCEPTION '[F4C] duplicate students in attendance entries' USING ERRCODE='P4C47'; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
  BEGIN v_student:=(e->>'student_id')::integer; v_status:=(e->>'status')::public.attendance_status;
  EXCEPTION WHEN others THEN RAISE EXCEPTION '[F4C] invalid attendance entry: %',e USING ERRCODE='P4C42'; END;
  IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=v_student AND classroom_id=p_classroom_id AND transferred_at IS NULL AND role='STUDENT') THEN RAISE EXCEPTION '[F4C] invalid attendance student %',v_student USING ERRCODE='P4C43'; END IF;
  IF EXISTS(SELECT 1 FROM public.attendances WHERE student_id=v_student AND attendance_date=p_attendance_date) THEN
    v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('student_id',v_student,'reason','already_recorded'));
  ELSE
    v_id:=public.record_attendance(v_student,p_attendance_date,v_status);
    v_recorded:=v_recorded||jsonb_build_array(jsonb_build_object('student_id',v_student,'attendance_id',v_id,'status',v_status));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('recorded',v_recorded,'skipped',v_skipped);
END $$;

-- 같은 날만 안전 정정: 기존 보상/오늘 마일스톤을 역분개 후 재기록
CREATE OR REPLACE FUNCTION public.teacher_correct_today_attendance(p_attendance_id bigint,p_new_status public.attendance_status,p_reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE a public.attendances%ROWTYPE; m record; v_new bigint; v_reason text; v_today date:=timezone('Asia/Seoul',now())::date;
BEGIN
 PERFORM public.ensure_teacher_role();
 v_reason:=btrim(coalesce(p_reason,'')); IF char_length(v_reason)<2 OR char_length(v_reason)>200 THEN RAISE EXCEPTION '[F4C] correction reason must be 2-200 chars' USING ERRCODE='P4C44'; END IF;
 SELECT * INTO a FROM public.attendances WHERE id=p_attendance_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION '[F4C] attendance not found' USING ERRCODE='P4C45'; END IF;
 IF NOT public.is_classroom_member(a.classroom_id) THEN RAISE EXCEPTION '[F4C] teacher classroom denied' USING ERRCODE='P4C21'; END IF;
 IF a.attendance_date<>v_today THEN RAISE EXCEPTION '[F4C] only today attendance can be corrected automatically' USING ERRCODE='P4C46'; END IF;
 IF a.status=p_new_status THEN RETURN a.id; END IF;
 IF a.transaction_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.transactions WHERE id=a.transaction_id AND NOT is_reversed) THEN PERFORM public.reverse_transaction(a.transaction_id,'출석 정정: '||v_reason); END IF;
 FOR m IN SELECT * FROM public.attendance_milestones WHERE student_id=a.student_id AND achieved_on=v_today FOR UPDATE LOOP
  IF m.transaction_id_gold IS NOT NULL AND EXISTS(SELECT 1 FROM public.transactions WHERE id=m.transaction_id_gold AND NOT is_reversed) THEN PERFORM public.reverse_transaction(m.transaction_id_gold,'출석 정정: '||v_reason); END IF;
  IF m.transaction_id_bv IS NOT NULL AND EXISTS(SELECT 1 FROM public.transactions WHERE id=m.transaction_id_bv AND NOT is_reversed) THEN PERFORM public.reverse_transaction(m.transaction_id_bv,'출석 정정: '||v_reason); END IF;
  IF m.transaction_id_crystal IS NOT NULL AND EXISTS(SELECT 1 FROM public.transactions WHERE id=m.transaction_id_crystal AND NOT is_reversed) THEN PERFORM public.reverse_transaction(m.transaction_id_crystal,'출석 정정: '||v_reason); END IF;
  DELETE FROM public.attendance_milestones WHERE id=m.id;
 END LOOP;
 DELETE FROM public.attendances WHERE id=a.id;
 v_new:=public.record_attendance(a.student_id,v_today,p_new_status);
 RETURN v_new;
END $$;

-- ACL: 정확한 시그니처만 공개. 같은 이름의 과거 오버로드가 있어도 자동 공개하지 않는다.
REVOKE ALL ON FUNCTION public.submit_assignment(integer,integer,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_assignment(integer,integer,text,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.grade_assignment(bigint,integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grade_assignment(bigint,integer,text,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_create_assignment(integer,text,text,text,timestamptz,integer,integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_create_assignment(integer,text,text,text,timestamptz,integer,integer,integer,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_set_assignment_status(integer,public.assignment_status) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_set_assignment_status(integer,public.assignment_status) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_record_attendance_bulk(integer,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_record_attendance_bulk(integer,date,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_correct_today_attendance(bigint,public.attendance_status,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_correct_today_attendance(bigint,public.attendance_status,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_attendance(integer,date,public.attendance_status) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_attendance(integer,date,public.attendance_status) TO authenticated,service_role;
DO $$ DECLARE t text; BEGIN IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
 FOREACH t IN ARRAY ARRAY['assignments','assignment_submissions','assignment_gradings','attendances','attendance_milestones'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP; END IF; END $$;
DO $$ BEGIN RAISE NOTICE '[F4C] installed successfully'; END $$;
COMMIT;
