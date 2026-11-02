-- B.R.A.N.D 2.0 | 과제 검수대 + 운영국 신뢰도 V1
-- 실행 방법: Supabase SQL Editor 에서 전체 실행 (코드 파일 패치보다 먼저).
-- 기존 assignments/assignment_submissions, 길드 미션 등급, 자산/보상은 변경하지 않습니다.
BEGIN;

CREATE TABLE IF NOT EXISTS public.homework_check_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  due_on date NOT NULL,
  check_at time NOT NULL DEFAULT '09:00',
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  task_kind text NOT NULL DEFAULT 'OTHER' CHECK (task_kind IN ('MATH','KOREAN','HANDWRITING','FORM','OTHER')),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 800),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','VOID')),
  created_by uuid NOT NULL,
  submitted_at timestamptz,
  submitted_by uuid,
  returned_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS homework_check_tasks_month_idx ON public.homework_check_tasks(classroom_id, due_on DESC, id DESC);
CREATE TABLE IF NOT EXISTS public.homework_check_results (
  task_id bigint NOT NULL REFERENCES public.homework_check_tasks(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES public.students(id),
  student_name text NOT NULL,
  result text NOT NULL DEFAULT 'UNKNOWN' CHECK (result IN ('UNKNOWN','DONE','LATE','MISSING','EXEMPT')),
  marked_by uuid,
  marked_at timestamptz,
  PRIMARY KEY (task_id,student_id)
);
CREATE INDEX IF NOT EXISTS homework_check_results_student_idx ON public.homework_check_results(student_id,task_id);
CREATE TABLE IF NOT EXISTS public.homework_check_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES public.homework_check_tasks(id),
  student_id integer REFERENCES public.students(id),
  before_result text,
  after_result text,
  event_kind text NOT NULL,
  reason text,
  actor uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.homework_guild_trust_outcomes (
  mission_instance_id bigint PRIMARY KEY REFERENCES public.guild3_mission_instances(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('ON_TIME','LATE','FAILED','EXEMPT')),
  note text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 모든 읽기/쓰기는 명시적 접근 검증 RPC만 사용합니다.
ALTER TABLE public.homework_check_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_check_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_guild_trust_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.homework_check_tasks, public.homework_check_results, public.homework_check_audit, public.homework_guild_trust_outcomes FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._homework_check_actor(p_classroom_id integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_classroom_id IS NULL OR p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '과제 검수대 학급 접근 권한이 없습니다.' USING ERRCODE='P0510';
  END IF;
  IF public.is_teacher_or_admin() THEN RETURN 'TEACHER'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.students s JOIN public.primary_jobs p ON p.student_id=s.id
    WHERE s.user_id=auth.uid() AND s.classroom_id=p_classroom_id AND s.role::text='STUDENT'
      AND s.transferred_at IS NULL AND NOT coalesce(s.is_test_account,false)
      AND p.classroom_id=p_classroom_id AND p.is_active AND p.released_at IS NULL
      AND regexp_replace(p.job_name,'[[:space:]]+','','g') IN ('제출관리관','제출관리자')
  ) THEN RETURN 'MANAGER'; END IF;
  RAISE EXCEPTION '현재 제출관리관 또는 교사만 사용할 수 있습니다.' USING ERRCODE='P0510';
END;
$$;
REVOKE ALL ON FUNCTION public._homework_check_actor(integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.homework_check_access() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_cid integer; v_role text;
BEGIN
  v_cid:=public.current_classroom_id();
  IF v_cid IS NULL THEN RETURN jsonb_build_object('can_operate',false,'is_teacher',false); END IF;
  BEGIN v_role:=public._homework_check_actor(v_cid);
  EXCEPTION WHEN SQLSTATE 'P0510' THEN RETURN jsonb_build_object('can_operate',false,'is_teacher',false); END;
  RETURN jsonb_build_object('can_operate',true,'is_teacher',v_role='TEACHER','classroom_id',v_cid);
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_check_board(p_month date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_cid integer:=public.current_classroom_id(); v_month date:=date_trunc('month',coalesce(p_month,(now() AT TIME ZONE 'Asia/Seoul')::date))::date;
DECLARE v_tasks jsonb; v_roster jsonb; v_results jsonb;
BEGIN
  PERFORM public._homework_check_actor(v_cid);
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.due_on DESC,t.id DESC),'[]'::jsonb) INTO v_tasks
  FROM (SELECT id,classroom_id,due_on,check_at,title,task_kind,instructions,status,created_at,submitted_at,returned_reason FROM public.homework_check_tasks WHERE classroom_id=v_cid AND due_on>=v_month AND due_on<(v_month+INTERVAL '1 month')::date AND status<>'VOID') t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name),'[]'::jsonb) INTO v_roster
  FROM public.students s WHERE s.classroom_id=v_cid AND s.role::text='STUDENT' AND s.transferred_at IS NULL AND NOT coalesce(s.is_test_account,false);
  SELECT coalesce(jsonb_agg(jsonb_build_object('task_id',r.task_id,'student_id',r.student_id,'student_name',r.student_name,'result',r.result,'marked_at',r.marked_at) ORDER BY r.task_id,r.student_id),'[]'::jsonb) INTO v_results
  FROM public.homework_check_results r JOIN public.homework_check_tasks t ON t.id=r.task_id
  WHERE t.classroom_id=v_cid AND t.due_on>=v_month AND t.due_on<(v_month+INTERVAL '1 month')::date AND t.status<>'VOID';
  RETURN jsonb_build_object('month',v_month,'tasks',v_tasks,'students',v_roster,'results',v_results);
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_check_create_task(p_due_on date,p_title text,p_kind text DEFAULT 'OTHER',p_instructions text DEFAULT '',p_check_at time DEFAULT '09:00') RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_cid integer:=public.current_classroom_id(); v_role text; v_id bigint; v_today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  v_role:=public._homework_check_actor(v_cid);
  IF p_due_on IS NULL OR (v_role <> 'TEACHER' AND (p_due_on<v_today-31 OR p_due_on>v_today+60)) THEN RAISE EXCEPTION '과제 날짜가 허용 범위를 벗어났습니다.'; END IF;
  IF char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 100 OR char_length(coalesce(p_instructions,''))>800
    OR coalesce(p_kind,'') NOT IN ('MATH','KOREAN','HANDWRITING','FORM','OTHER') THEN RAISE EXCEPTION '과제 제목·유형·설명을 확인해주세요.'; END IF;
  INSERT INTO public.homework_check_tasks(classroom_id,due_on,check_at,title,task_kind,instructions,created_by)
  VALUES(v_cid,p_due_on,coalesce(p_check_at,'09:00'),btrim(p_title),p_kind,coalesce(p_instructions,''),auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.homework_check_results(task_id,student_id,student_name)
  SELECT v_id,s.id,s.name FROM public.students s WHERE s.classroom_id=v_cid AND s.role::text='STUDENT' AND s.transferred_at IS NULL AND NOT coalesce(s.is_test_account,false);
  IF NOT FOUND THEN RAISE EXCEPTION '검사 대상 재학생이 없습니다.'; END IF;
  INSERT INTO public.homework_check_audit(task_id,event_kind,actor) VALUES(v_id,'CREATE',auth.uid());
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_check_set_result(p_task_id bigint,p_student_id integer,p_result text,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_task public.homework_check_tasks%rowtype; v_role text; v_old text;
BEGIN
  SELECT * INTO v_task FROM public.homework_check_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '과제를 찾을 수 없습니다.'; END IF;
  v_role:=public._homework_check_actor(v_task.classroom_id);
  IF v_task.status='VOID' OR (v_role<>'TEACHER' AND v_task.status NOT IN ('DRAFT','RETURNED')) THEN RAISE EXCEPTION '이미 제출된 과제는 교사만 정정할 수 있습니다.'; END IF;
  IF coalesce(p_result,'') NOT IN ('UNKNOWN','DONE','LATE','MISSING','EXEMPT') THEN RAISE EXCEPTION '올바르지 않은 검사 상태입니다.'; END IF;
  IF v_role='TEACHER' AND v_task.status='SUBMITTED' AND char_length(btrim(coalesce(p_reason,'')))<2 THEN RAISE EXCEPTION '제출된 결과를 교사가 정정할 때는 사유가 필요합니다.'; END IF;
  SELECT result INTO v_old FROM public.homework_check_results WHERE task_id=p_task_id AND student_id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '이 과제의 검사 대상 학생이 아닙니다.'; END IF;
  IF v_old IS DISTINCT FROM p_result THEN
    UPDATE public.homework_check_results SET result=p_result,marked_by=auth.uid(),marked_at=now() WHERE task_id=p_task_id AND student_id=p_student_id;
    INSERT INTO public.homework_check_audit(task_id,student_id,before_result,after_result,event_kind,reason,actor)
    VALUES(p_task_id,p_student_id,v_old,p_result,'MARK',nullif(btrim(coalesce(p_reason,'')),''),auth.uid());
    UPDATE public.homework_check_tasks SET updated_at=now() WHERE id=p_task_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_check_mark_unchecked_done(p_task_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_task public.homework_check_tasks%rowtype; v_role text; v_count integer;
BEGIN
  SELECT * INTO v_task FROM public.homework_check_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '과제를 찾을 수 없습니다.'; END IF;
  v_role:=public._homework_check_actor(v_task.classroom_id);
  IF v_task.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION '현재 상태에서는 일괄 처리가 불가능합니다.'; END IF;
  INSERT INTO public.homework_check_audit(task_id,student_id,before_result,after_result,event_kind,actor)
  SELECT task_id,student_id,'UNKNOWN','DONE','MARK_ALL',auth.uid() FROM public.homework_check_results WHERE task_id=p_task_id AND result='UNKNOWN';
  UPDATE public.homework_check_results SET result='DONE',marked_by=auth.uid(),marked_at=now() WHERE task_id=p_task_id AND result='UNKNOWN';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.homework_check_tasks SET updated_at=now() WHERE id=p_task_id;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_check_submit(p_task_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_task public.homework_check_tasks%rowtype; v_role text;
BEGIN
  SELECT * INTO v_task FROM public.homework_check_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '과제를 찾을 수 없습니다.'; END IF;
  v_role:=public._homework_check_actor(v_task.classroom_id);
  IF v_task.status NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION '이미 제출한 과제입니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.homework_check_results r WHERE r.task_id=p_task_id AND r.result='UNKNOWN') THEN RAISE EXCEPTION '미확인 학생을 모두 검사한 후 제출할 수 있습니다.'; END IF;
  UPDATE public.homework_check_tasks SET status='SUBMITTED',submitted_at=now(),submitted_by=auth.uid(),returned_reason=NULL,updated_at=now() WHERE id=p_task_id;
  INSERT INTO public.homework_check_audit(task_id,event_kind,actor) VALUES(p_task_id,'SUBMIT',auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_teacher_return_task(p_task_id bigint,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_task public.homework_check_tasks%rowtype;
BEGIN
  SELECT * INTO v_task FROM public.homework_check_tasks WHERE id=p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '과제를 찾을 수 없습니다.'; END IF;
  IF public._homework_check_actor(v_task.classroom_id)<>'TEACHER' THEN RAISE EXCEPTION '교사 전용 작업입니다.'; END IF;
  IF v_task.status<>'SUBMITTED' OR char_length(btrim(coalesce(p_reason,'')))<2 THEN RAISE EXCEPTION '반려 사유를 입력하세요.'; END IF;
  UPDATE public.homework_check_tasks SET status='RETURNED',returned_reason=p_reason,updated_at=now() WHERE id=p_task_id;
  INSERT INTO public.homework_check_audit(task_id,event_kind,reason,actor) VALUES(p_task_id,'RETURN',p_reason,auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_teacher_guild_dashboard(p_month date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_cid integer:=public.current_classroom_id(); v_ym text:=to_char(coalesce(p_month,(now() AT TIME ZONE 'Asia/Seoul')::date),'YYYY-MM'); v_result jsonb;
BEGIN
  IF public._homework_check_actor(v_cid)<>'TEACHER' THEN RAISE EXCEPTION '교사 전용입니다.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('instance_id',i.id,'mission_id',m.id,'title',m.title,'guild_name',g.name,'current_guild_result',i.current_guild_result,'outcome',o.outcome,'note',o.note) ORDER BY m.id,i.id),'[]'::jsonb) INTO v_result
  FROM public.guild3_missions m JOIN public.guild3_mission_instances i ON i.mission_id=m.id
  JOIN public.guilds g ON g.id=i.guild_id LEFT JOIN public.homework_guild_trust_outcomes o ON o.mission_instance_id=i.id
  WHERE m.classroom_id=v_cid AND i.classroom_id=v_cid AND m.contribution_year_month=v_ym AND m.lifecycle_state='FINALIZED';
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_teacher_guild_outcome(p_instance_id bigint,p_outcome text,p_note text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_cid integer; v_mission bigint; v_state text;
BEGIN
  SELECT i.classroom_id,i.mission_id,m.lifecycle_state INTO v_cid,v_mission,v_state
  FROM public.guild3_mission_instances i JOIN public.guild3_missions m ON m.id=i.mission_id
  WHERE i.id=p_instance_id FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION '길드 미션을 찾을 수 없습니다.'; END IF;
  IF public._homework_check_actor(v_cid)<>'TEACHER' THEN RAISE EXCEPTION '교사 전용입니다.'; END IF;
  IF v_state<>'FINALIZED' OR coalesce(p_outcome,'') NOT IN ('ON_TIME','LATE','FAILED','EXEMPT') OR char_length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION '유효한 결과를 선택해주세요.'; END IF;
  INSERT INTO public.homework_guild_trust_outcomes(mission_instance_id,outcome,note,updated_by)
  VALUES(p_instance_id,p_outcome,coalesce(p_note,''),auth.uid())
  ON CONFLICT (mission_instance_id) DO UPDATE SET outcome=excluded.outcome,note=excluded.note,updated_by=auth.uid(),updated_at=now();
END;
$$;

-- 교사 전용 내부 산정 테이블 함수. 미기록 미션은 신뢰도 자동 반영 금지.
CREATE OR REPLACE FUNCTION public._homework_trust_rows(p_session_id bigint)
RETURNS TABLE(student_id integer,student_name text,homework_count bigint,homework_pct numeric,mission_count bigint,pending_missions bigint,mission_penalty_pct numeric,trust_pct numeric,ready boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
WITH session AS (
  SELECT s.* FROM public.mvp_foundation_sessions s WHERE s.id=p_session_id
), eligible AS (
  SELECT (x->>'student_id')::integer AS sid FROM session s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.draft_data->'students','[]'::jsonb)) x
), homework AS (
  SELECT r.student_id,
    count(*) FILTER (WHERE r.result NOT IN ('EXEMPT','UNKNOWN')) AS n,
    sum(CASE r.result WHEN 'DONE' THEN 100.0 WHEN 'LATE' THEN 70.0 WHEN 'MISSING' THEN 0.0 ELSE NULL END) AS points
  FROM public.homework_check_results r JOIN public.homework_check_tasks t ON t.id=r.task_id
  JOIN session s ON s.classroom_id=t.classroom_id
  WHERE t.status='SUBMITTED' AND t.due_on BETWEEN s.evaluation_start_date AND s.evaluation_end_date
  GROUP BY r.student_id
), missions AS (
  SELECT p.student_id, count(*) FILTER (WHERE o.outcome IS DISTINCT FROM 'EXEMPT')::bigint AS n,
    count(*) FILTER (WHERE o.outcome IS NULL)::bigint AS pending,
    sum(CASE o.outcome WHEN 'LATE' THEN 0.5 WHEN 'FAILED' THEN 1.0 ELSE 0.0 END) AS penalty_units
  FROM public.guild3_mission_participants p
  JOIN public.guild3_missions m ON m.id=p.mission_id
  JOIN session s ON s.classroom_id=m.classroom_id
  LEFT JOIN public.homework_guild_trust_outcomes o ON o.mission_instance_id=p.mission_instance_id
  WHERE m.lifecycle_state='FINALIZED'
    AND m.contribution_year_month BETWEEN to_char(s.evaluation_start_date,'YYYY-MM') AND to_char(s.evaluation_end_date,'YYYY-MM')
  GROUP BY p.student_id
), scores AS (
  SELECT e.sid,s.name::text AS name,coalesce(h.n,0) n,
    CASE WHEN coalesce(h.n,0)>0 THEN round(h.points/h.n,1) ELSE NULL END AS hp,
    coalesce(m.n,0) mn,coalesce(m.pending,0) mp,
    round(least(20.0,20.0*coalesce(m.penalty_units,0)/greatest(2,coalesce(m.n,0))),1) AS deduction
  FROM eligible e JOIN public.students s ON s.id=e.sid LEFT JOIN homework h ON h.student_id=e.sid LEFT JOIN missions m ON m.student_id=e.sid
)
SELECT sid,name,n,hp,mn,mp,deduction,
  CASE WHEN hp IS NOT NULL THEN greatest(0.0,round(hp-deduction,1)) ELSE NULL END AS trust,
  (n>=5 AND mp=0) AS sufficient
FROM scores ORDER BY name;
$$;
REVOKE ALL ON FUNCTION public._homework_trust_rows(bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.homework_teacher_trust_preview(p_session_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_cid integer; v_json jsonb;
BEGIN
  SELECT classroom_id INTO v_cid FROM public.mvp_foundation_sessions WHERE id=p_session_id;
  IF NOT FOUND OR public._homework_check_actor(v_cid)<>'TEACHER' THEN RAISE EXCEPTION '조회 권한이 없습니다.'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_json FROM public._homework_trust_rows(p_session_id) x;
  RETURN v_json;
END;
$$;

CREATE OR REPLACE FUNCTION public.homework_teacher_apply_trust(p_session_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_session public.mvp_foundation_sessions%rowtype; v_applied integer;
BEGIN
  SELECT * INTO v_session FROM public.mvp_foundation_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR public._homework_check_actor(v_session.classroom_id)<>'TEACHER' THEN RAISE EXCEPTION '접근 권한이 없습니다.'; END IF;
  IF v_session.status<>'DRAFT' THEN RAISE EXCEPTION '확정된 MVP 회차에는 자동 산정할 수 없습니다.'; END IF;
  INSERT INTO public.mvp_foundation_teacher_inputs(session_id,student_id,operational_trust_pct,updated_by,updated_at)
  SELECT p_session_id,r.student_id,r.trust_pct,auth.uid(),now() FROM public._homework_trust_rows(p_session_id) r WHERE r.ready AND r.trust_pct IS NOT NULL
  ON CONFLICT(session_id,student_id) DO UPDATE SET operational_trust_pct=excluded.operational_trust_pct,updated_by=auth.uid(),updated_at=now();
  GET DIAGNOSTICS v_applied=ROW_COUNT;
  RETURN jsonb_build_object('applied',v_applied);
END;
$$;

REVOKE ALL ON FUNCTION public.homework_check_access() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_check_board(date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_check_create_task(date,text,text,text,time) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_check_set_result(bigint,integer,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_check_mark_unchecked_done(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_check_submit(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_teacher_return_task(bigint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_teacher_guild_dashboard(date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_teacher_guild_outcome(bigint,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_teacher_trust_preview(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.homework_teacher_apply_trust(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.homework_check_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_check_board(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_check_create_task(date,text,text,text,time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_check_set_result(bigint,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_check_mark_unchecked_done(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_check_submit(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_teacher_return_task(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_teacher_guild_dashboard(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_teacher_guild_outcome(bigint,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_teacher_trust_preview(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homework_teacher_apply_trust(bigint) TO authenticated;
COMMIT;
