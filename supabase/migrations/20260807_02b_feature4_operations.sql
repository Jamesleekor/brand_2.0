-- ============================================================================
-- B.R.A.N.D 2.0 — Feature 4B: 학급 운영 (비상사태 · 경비대 · 돌발 퀘스트)
-- Fault domain: F4B / SQLSTATE P4Bxx
-- ============================================================================
BEGIN;
DO $$ BEGIN
  RAISE NOTICE '[F4B] preflight: operations';
  IF to_regclass('public.emergencies') IS NULL OR to_regclass('public.guard_terms') IS NULL THEN
    RAISE EXCEPTION '[F4B] required operations tables missing' USING ERRCODE='P4B01'; END IF;
  IF to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.ensure_self_or_teacher(integer)') IS NULL
     OR to_regprocedure('public.is_classroom_member(integer)') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL THEN
    RAISE EXCEPTION '[F4B] Feature1/2 transaction or identity core missing' USING ERRCODE='P4B02'; END IF;
  IF to_regprocedure('public.send_mail(integer,public.mail_sender_type,integer,uuid,character varying,text,public.mail_message_type,public.transaction_source_type,bigint)') IS NULL
     OR to_regprocedure('public.broadcast_global_alert(integer,public.global_alert_category,text,character varying,integer,character varying,bigint,integer)') IS NULL
     OR to_regprocedure('public.push_activity_feed(integer,public.activity_feed_type,integer,jsonb,public.activity_visibility)') IS NULL THEN
    RAISE EXCEPTION '[F4B] Feature4A communication helpers missing or mismatched' USING ERRCODE='P4B03'; END IF;
END $$;

-- 기존 비상사태 RPC를 교사 검증 포함 버전으로 하드닝
CREATE OR REPLACE FUNCTION public.activate_emergency(
 p_classroom_id integer,p_emergency_type public.emergency_type,p_reason text,
 p_scheduled_end_at timestamptz DEFAULT NULL,p_auto_termination jsonb DEFAULT NULL,p_teacher_user_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v_id integer; BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10'; END IF;
  IF EXISTS(SELECT 1 FROM public.emergencies WHERE classroom_id=p_classroom_id AND emergency_type=p_emergency_type AND status='ACTIVE') THEN
    RAISE EXCEPTION '[F4B] same emergency type already active' USING ERRCODE='P4B11'; END IF;
  IF char_length(coalesce(p_reason,''))>5000 THEN RAISE EXCEPTION '[F4B] emergency reason too long' USING ERRCODE='P4B15'; END IF;
  IF p_scheduled_end_at IS NOT NULL AND p_scheduled_end_at<=now() THEN RAISE EXCEPTION '[F4B] scheduled end must be future' USING ERRCODE='P4B12'; END IF;
  INSERT INTO public.emergencies(classroom_id,emergency_type,reason,scheduled_end_at,auto_termination_condition,started_by)
  VALUES(p_classroom_id,p_emergency_type,nullif(btrim(coalesce(p_reason,'')),''),p_scheduled_end_at,p_auto_termination,auth.uid()) RETURNING id INTO v_id;
  PERFORM public.broadcast_global_alert(p_classroom_id,'EMERGENCY',format('⚠️ 비상사태 발동: %s',p_emergency_type),'⚠️',NULL,'EMERGENCY',v_id,72);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.terminate_emergency(p_emergency_id integer,p_is_auto boolean DEFAULT false,p_teacher_user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v public.emergencies%ROWTYPE; BEGIN
  -- 외부 RPC는 p_is_auto 값과 무관하게 반드시 교사만 호출할 수 있다.
  -- 자동 종료는 아래 service_role 전용 process_expired_emergencies()가 담당한다.
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v FROM public.emergencies WHERE id=p_emergency_id FOR UPDATE;
  IF v.id IS NULL OR v.status<>'ACTIVE' THEN RAISE EXCEPTION '[F4B] emergency not active' USING ERRCODE='P4B13'; END IF;
  IF NOT public.is_classroom_member(v.classroom_id) THEN RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10'; END IF;
  -- p_is_auto는 구버전 호출 호환용으로만 유지한다. 외부 교사 종료는 항상 MANUAL_TERMINATED.
  UPDATE public.emergencies SET status='MANUAL_TERMINATED'::public.emergency_status,
    actual_end_at=now(),ended_by=auth.uid() WHERE id=p_emergency_id;
  PERFORM public.broadcast_global_alert(v.classroom_id,'EMERGENCY',format('✅ 비상사태 해제: %s',v.emergency_type),'✅',NULL,'EMERGENCY',p_emergency_id,24);
END $$;

-- 만료된 비상사태 자동 종료용 내부 함수. 브라우저에서는 실행할 수 없다.
CREATE OR REPLACE FUNCTION public.process_expired_emergencies()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE e record; v_count integer:=0;
BEGIN
  FOR e IN
    SELECT id,classroom_id,emergency_type
      FROM public.emergencies
     WHERE status='ACTIVE' AND scheduled_end_at IS NOT NULL AND scheduled_end_at<=now()
     ORDER BY id
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.emergencies
       SET status='AUTO_TERMINATED',actual_end_at=now(),ended_by=NULL
     WHERE id=e.id AND status='ACTIVE';
    IF FOUND THEN
      v_count:=v_count+1;
      PERFORM public.broadcast_global_alert(e.classroom_id,'EMERGENCY',format('✅ 비상사태 자동 해제: %s',e.emergency_type),'✅',NULL,'EMERGENCY',e.id,24);
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.process_expired_emergencies() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_emergencies() TO service_role;

-- 로그인한 학급 구성원이 자기 학급의 '이미 만료된' 비상사태만 정리할 수 있는 안전한 외부 래퍼.
-- pg_cron이 잠시 멈춰도 학생/교사 대시보드 진입 시 상태가 스스로 정합화된다.
CREATE OR REPLACE FUNCTION public.finalize_expired_emergencies_for_classroom(p_classroom_id integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE e record; v_count integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[F4B] classroom membership required' USING ERRCODE='P4B14';
  END IF;
  FOR e IN
    SELECT id,emergency_type FROM public.emergencies
     WHERE classroom_id=p_classroom_id AND status='ACTIVE'
       AND scheduled_end_at IS NOT NULL AND scheduled_end_at<=now()
     ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.emergencies SET status='AUTO_TERMINATED',actual_end_at=now(),ended_by=NULL
     WHERE id=e.id AND status='ACTIVE';
    IF FOUND THEN
      v_count:=v_count+1;
      PERFORM public.broadcast_global_alert(p_classroom_id,'EMERGENCY',format('✅ 비상사태 자동 해제: %s',e.emergency_type),'✅',NULL,'EMERGENCY',e.id,24);
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

-- pg_cron이 활성화된 환경에서는 1분마다 만료 상태를 정리한다.
-- cron 권한/확장이 없더라도 Feature4 전체 설치를 실패시키지 않고 NOTICE만 남긴다.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='brand_feature4_expired_emergencies') THEN
      PERFORM cron.schedule('brand_feature4_expired_emergencies','* * * * *','SELECT public.process_expired_emergencies();');
    END IF;
  ELSE
    RAISE NOTICE '[F4B] pg_cron not enabled; expired emergency auto-close job skipped';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[F4B] pg_cron scheduling skipped: %',SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS public.emergency_quests(
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 classroom_id integer NOT NULL REFERENCES public.classrooms(id),
 title varchar(120) NOT NULL,
 description text NOT NULL,
 reward_gold integer NOT NULL DEFAULT 0 CHECK(reward_gold BETWEEN 0 AND 10000),
 reward_bv integer NOT NULL DEFAULT 0 CHECK(reward_bv BETWEEN 0 AND 10000),
 starts_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 status varchar(12) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED')),
 created_by uuid,
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>starts_at)
);
CREATE TABLE IF NOT EXISTS public.emergency_quest_completions(
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 quest_id bigint NOT NULL REFERENCES public.emergency_quests(id) ON DELETE CASCADE,
 classroom_id integer NOT NULL REFERENCES public.classrooms(id),
 student_id integer NOT NULL REFERENCES public.students(id),
 gold_transaction_id bigint REFERENCES public.transactions(id),
 bv_transaction_id bigint REFERENCES public.transactions(id),
 completed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(quest_id,student_id)
);
CREATE INDEX IF NOT EXISTS idx_emergency_quests_active ON public.emergency_quests(classroom_id,expires_at) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS idx_emergency_quest_completion_student ON public.emergency_quest_completions(student_id,completed_at DESC);
ALTER TABLE public.emergency_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_quest_completions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='emergency_quests' AND policyname='emergency_quests_select_class') THEN
  CREATE POLICY emergency_quests_select_class ON public.emergency_quests FOR SELECT TO authenticated USING(public.is_classroom_member(classroom_id)); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='emergency_quest_completions' AND policyname='emergency_quest_completions_select') THEN
  CREATE POLICY emergency_quest_completions_select ON public.emergency_quest_completions FOR SELECT TO authenticated
   USING(student_id=public.current_student_id() OR public.is_teacher_or_admin()); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_create_emergency_quest(
 p_classroom_id integer,p_title text,p_description text,p_reward_gold integer,p_reward_bv integer,p_duration_minutes integer
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v_id bigint; BEGIN
 PERFORM public.ensure_teacher_role();
 IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10'; END IF;
 IF char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION '[F4B] quest title invalid' USING ERRCODE='P4B20'; END IF;
 IF char_length(btrim(coalesce(p_description,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '[F4B] quest description invalid' USING ERRCODE='P4B21'; END IF;
 IF p_reward_gold NOT BETWEEN 0 AND 10000 OR p_reward_bv NOT BETWEEN 0 AND 10000 OR (p_reward_gold=0 AND p_reward_bv=0) THEN RAISE EXCEPTION '[F4B] quest reward invalid' USING ERRCODE='P4B22'; END IF;
 IF p_duration_minutes NOT BETWEEN 1 AND 1440 THEN RAISE EXCEPTION '[F4B] quest duration invalid' USING ERRCODE='P4B23'; END IF;
 INSERT INTO public.emergency_quests(classroom_id,title,description,reward_gold,reward_bv,expires_at,created_by)
 VALUES(p_classroom_id,btrim(p_title),btrim(p_description),p_reward_gold,p_reward_bv,now()+make_interval(mins=>p_duration_minutes),auth.uid()) RETURNING id INTO v_id;
 PERFORM public.broadcast_global_alert(p_classroom_id,'GENERAL',format('⚡ 돌발 퀘스트: %s',btrim(p_title)),'⚡',NULL,'EMERGENCY_QUEST',v_id,least(24,ceil(p_duration_minutes/60.0)::int+1));
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_close_emergency_quest(p_quest_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v_classroom integer; BEGIN
 PERFORM public.ensure_teacher_role();
 SELECT classroom_id INTO v_classroom FROM public.emergency_quests WHERE id=p_quest_id FOR UPDATE;
 IF v_classroom IS NULL THEN RAISE EXCEPTION '[F4B] quest not found' USING ERRCODE='P4B24'; END IF;
 IF NOT public.is_classroom_member(v_classroom) THEN RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10'; END IF;
 UPDATE public.emergency_quests SET status='CLOSED',closed_at=now() WHERE id=p_quest_id AND status='ACTIVE';
END $$;

CREATE OR REPLACE FUNCTION public.complete_emergency_quest(p_student_id integer,p_quest_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE q public.emergency_quests%ROWTYPE; v_class integer; v_completion bigint; v_gold bigint; v_bv bigint;
BEGIN
 PERFORM public.ensure_self_or_teacher(p_student_id);
 SELECT classroom_id INTO v_class FROM public.students WHERE id=p_student_id AND transferred_at IS NULL AND role='STUDENT';
 IF v_class IS NULL THEN RAISE EXCEPTION '[F4B] active student not found' USING ERRCODE='P4B25'; END IF;
 SELECT * INTO q FROM public.emergency_quests WHERE id=p_quest_id FOR UPDATE;
 IF q.id IS NULL THEN RAISE EXCEPTION '[F4B] quest not found' USING ERRCODE='P4B24'; END IF;
 IF q.classroom_id<>v_class THEN RAISE EXCEPTION '[F4B] quest belongs to another classroom' USING ERRCODE='P4B26'; END IF;
 IF q.status<>'ACTIVE' OR now()<q.starts_at OR now()>=q.expires_at THEN RAISE EXCEPTION '[F4B] quest is not completable' USING ERRCODE='P4B27'; END IF;
 INSERT INTO public.emergency_quest_completions(quest_id,classroom_id,student_id) VALUES(q.id,v_class,p_student_id)
 RETURNING id INTO v_completion;
 IF q.reward_gold>0 THEN v_gold:=public.create_transaction(p_student_id,'GOLD',q.reward_gold,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트] %s',q.title)); END IF;
 IF q.reward_bv>0 THEN v_bv:=public.create_transaction(p_student_id,'BV',q.reward_bv,'DAILY_QUEST',v_completion,0,format('[돌발 퀘스트 명예] %s',q.title)); END IF;
 UPDATE public.emergency_quest_completions SET gold_transaction_id=v_gold,bv_transaction_id=v_bv WHERE id=v_completion;
 PERFORM public.send_mail(p_student_id,'SYSTEM',NULL,NULL,'⚡ 돌발 퀘스트 완료',format('"%s" 완료 보상이 지급되었습니다.',q.title),'REWARD','DAILY_QUEST',v_completion);
 PERFORM public.push_activity_feed(v_class,'OTHER',p_student_id,jsonb_build_object('message','돌발 퀘스트 완료','quest_title',q.title),'PUBLIC');
 RETURN v_completion;
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION '[F4B] quest already completed' USING ERRCODE='P4B28';
END $$;

CREATE OR REPLACE FUNCTION public.teacher_appoint_guard(
 p_classroom_id integer,p_student_id integer,p_role_type public.guard_role_type,p_start_date date,p_end_date date,p_note text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE v_id integer; BEGIN
 PERFORM public.ensure_teacher_role();
 IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10'; END IF;
 IF p_start_date>p_end_date THEN RAISE EXCEPTION '[F4B] guard period invalid' USING ERRCODE='P4B30'; END IF;
 IF char_length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION '[F4B] guard note too long' USING ERRCODE='P4B34'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=p_student_id AND classroom_id=p_classroom_id AND transferred_at IS NULL AND role='STUDENT') THEN RAISE EXCEPTION '[F4B] guard student invalid' USING ERRCODE='P4B31'; END IF;
 IF EXISTS(SELECT 1 FROM public.guard_terms WHERE student_id=p_student_id AND is_active AND daterange(start_date,end_date,'[]') && daterange(p_start_date,p_end_date,'[]')) THEN
  RAISE EXCEPTION '[F4B] overlapping guard term exists' USING ERRCODE='P4B32'; END IF;
 INSERT INTO public.guard_terms(classroom_id,student_id,role_type,start_date,end_date,is_active,appointed_by,note)
 VALUES(p_classroom_id,p_student_id,p_role_type,p_start_date,p_end_date,true,auth.uid(),nullif(btrim(coalesce(p_note,'')),'')) RETURNING id INTO v_id;
 PERFORM public.send_mail(p_student_id,'TEACHER',NULL,auth.uid(),'🛡️ 경제수호대 임명',format('%s부터 %s까지 경제수호대 %s으로 임명되었습니다.',p_start_date,p_end_date,CASE WHEN p_role_type='CHIEF' THEN '대장' ELSE '대원' END),'TEACHER_MESSAGE',NULL,NULL);
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_end_guard_term(p_term_id integer,p_end_date date DEFAULT CURRENT_DATE)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$ DECLARE g public.guard_terms%ROWTYPE; BEGIN
 PERFORM public.ensure_teacher_role(); SELECT * INTO g FROM public.guard_terms WHERE id=p_term_id FOR UPDATE;
 IF g.id IS NULL THEN RAISE EXCEPTION '[F4B] guard term not found' USING ERRCODE='P4B33'; END IF;
 IF NOT public.is_classroom_member(g.classroom_id) THEN RAISE EXCEPTION '[F4B] teacher classroom denied' USING ERRCODE='P4B10'; END IF;
 UPDATE public.guard_terms SET end_date=greatest(start_date,p_end_date),is_active=false WHERE id=p_term_id;
 PERFORM public.send_mail(g.student_id,'TEACHER',NULL,auth.uid(),'🛡️ 경제수호대 임기 종료',format('경제수호대 임기가 %s에 종료되었습니다.',greatest(g.start_date,p_end_date)),'TEACHER_MESSAGE',NULL,NULL);
END $$;

-- ACL: 정확한 외부 RPC 시그니처만 authenticated에 공개
REVOKE ALL ON FUNCTION public.activate_emergency(integer,public.emergency_type,text,timestamptz,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_emergency(integer,public.emergency_type,text,timestamptz,jsonb,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.terminate_emergency(integer,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.terminate_emergency(integer,boolean,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.finalize_expired_emergencies_for_classroom(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_expired_emergencies_for_classroom(integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_create_emergency_quest(integer,text,text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_create_emergency_quest(integer,text,text,integer,integer,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_close_emergency_quest(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_close_emergency_quest(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.complete_emergency_quest(integer,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_emergency_quest(integer,bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_appoint_guard(integer,integer,public.guard_role_type,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_appoint_guard(integer,integer,public.guard_role_type,date,date,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_end_guard_term(integer,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_end_guard_term(integer,date) TO authenticated,service_role;
REVOKE ALL ON TABLE public.emergency_quests,public.emergency_quest_completions FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.emergency_quests,public.emergency_quest_completions FROM authenticated;
GRANT SELECT ON TABLE public.emergency_quests,public.emergency_quest_completions TO authenticated;
GRANT ALL ON TABLE public.emergency_quests,public.emergency_quest_completions TO service_role;
DO $$ DECLARE t text; BEGIN IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
 FOREACH t IN ARRAY ARRAY['emergencies','guard_terms','emergency_quests','emergency_quest_completions'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP; END IF; END $$;
DO $$ BEGIN RAISE NOTICE '[F4B] installed successfully'; END $$;
COMMIT;
