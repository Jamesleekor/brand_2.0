-- ============================================================================
-- B.R.A.N.D 2.0 — Feature 4 post-check / fault isolation
-- Bundle 적용 뒤 이 파일을 별도 New query에서 실행하세요.
-- ============================================================================

-- 1) 모듈 핵심 객체 존재
WITH checks(module, check_name, ok) AS (
 VALUES
 ('F4A','global_alert_reads table', to_regclass('public.global_alert_reads') IS NOT NULL),
 ('F4A','teacher_send_mail', to_regprocedure('public.teacher_send_mail(integer,integer[],text,text,public.mail_message_type)') IS NOT NULL),
 ('F4A','teacher_broadcast_alert', to_regprocedure('public.teacher_broadcast_alert(integer,text,character varying,integer)') IS NOT NULL),
 ('F4B','emergency_quests table', to_regclass('public.emergency_quests') IS NOT NULL),
 ('F4B','emergency completions table', to_regclass('public.emergency_quest_completions') IS NOT NULL),
 ('F4B','expiry classroom rpc', to_regprocedure('public.finalize_expired_emergencies_for_classroom(integer)') IS NOT NULL),
 ('F4B','guard appointment rpc', to_regprocedure('public.teacher_appoint_guard(integer,integer,public.guard_role_type,date,date,text)') IS NOT NULL),
 ('F4C','attendance bulk rpc', to_regprocedure('public.teacher_record_attendance_bulk(integer,date,jsonb)') IS NOT NULL),
 ('F4C','assignment create rpc', to_regprocedure('public.teacher_create_assignment(integer,text,text,text,timestamptz,integer,integer,integer,boolean)') IS NOT NULL),
 ('F4C','submit assignment rpc', to_regprocedure('public.submit_assignment(integer,integer,text,jsonb)') IS NOT NULL),
 ('F4D','hall_of_fame_entries table', to_regclass('public.hall_of_fame_entries') IS NOT NULL),
 ('F4D','records refresh rpc', to_regprocedure('public.teacher_refresh_classroom_records(integer,date)') IS NOT NULL),
 ('F4D','feature4 health rpc', to_regprocedure('public.teacher_feature4_health_check()') IS NOT NULL)
)
SELECT * FROM checks ORDER BY module,check_name;

-- 2) 외부 RPC 권한. 아래 모든 external 함수는 anon=false, authenticated=true, service_role=true가 정상.
WITH funcs(module,function_name,signature) AS (
 VALUES
 ('F4A','teacher_send_mail','public.teacher_send_mail(integer,integer[],text,text,public.mail_message_type)'),
 ('F4A','teacher_broadcast_alert','public.teacher_broadcast_alert(integer,text,character varying,integer)'),
 ('F4A','mark_mail_read','public.mark_mail_read(bigint)'),
 ('F4A','mark_global_alert_read','public.mark_global_alert_read(bigint)'),
 ('F4B','activate_emergency','public.activate_emergency(integer,public.emergency_type,text,timestamptz,jsonb,uuid)'),
 ('F4B','terminate_emergency','public.terminate_emergency(integer,boolean,uuid)'),
 ('F4B','finalize_expired_emergencies_for_classroom','public.finalize_expired_emergencies_for_classroom(integer)'),
 ('F4B','complete_emergency_quest','public.complete_emergency_quest(integer,bigint)'),
 ('F4B','teacher_appoint_guard','public.teacher_appoint_guard(integer,integer,public.guard_role_type,date,date,text)'),
 ('F4C','teacher_record_attendance_bulk','public.teacher_record_attendance_bulk(integer,date,jsonb)'),
 ('F4C','teacher_correct_today_attendance','public.teacher_correct_today_attendance(bigint,public.attendance_status,text)'),
 ('F4C','teacher_create_assignment','public.teacher_create_assignment(integer,text,text,text,timestamptz,integer,integer,integer,boolean)'),
 ('F4C','submit_assignment','public.submit_assignment(integer,integer,text,jsonb)'),
 ('F4C','grade_assignment','public.grade_assignment(bigint,integer,text,uuid)'),
 ('F4D','teacher_refresh_classroom_records','public.teacher_refresh_classroom_records(integer,date)'),
 ('F4D','teacher_feature4_health_check','public.teacher_feature4_health_check()')
), roles(role_name) AS (VALUES ('anon'),('authenticated'),('service_role'))
SELECT f.module,r.role_name,f.function_name,
       has_function_privilege(r.role_name,to_regprocedure(f.signature),'EXECUTE') AS can_execute
FROM funcs f CROSS JOIN roles r
ORDER BY f.module,f.function_name,r.role_name;

-- 3) 내부 함수 보호. 모두 anon/authenticated=false, service_role=true가 정상.
WITH funcs(module,function_name,signature) AS (
 VALUES
 ('F4A','send_mail','public.send_mail(integer,public.mail_sender_type,integer,uuid,character varying,text,public.mail_message_type,public.transaction_source_type,bigint)'),
 ('F4A','broadcast_global_alert','public.broadcast_global_alert(integer,public.global_alert_category,text,character varying,integer,character varying,bigint,integer)'),
 ('F4A','push_activity_feed','public.push_activity_feed(integer,public.activity_feed_type,integer,jsonb,public.activity_visibility)'),
 ('F4B','process_expired_emergencies','public.process_expired_emergencies()'),
 ('F4D','calculate_daily_statistics','public.calculate_daily_statistics(integer,date)'),
 ('F4D','calculate_rankings','public.calculate_rankings(integer,date)'),
 ('CORE','create_transaction','public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)'),
 ('CORE','reverse_transaction','public.reverse_transaction(bigint,text)')
), roles(role_name) AS (VALUES ('anon'),('authenticated'),('service_role'))
SELECT f.module,r.role_name,f.function_name,
       has_function_privilege(r.role_name,to_regprocedure(f.signature),'EXECUTE') AS can_execute
FROM funcs f CROSS JOIN roles r
ORDER BY f.module,f.function_name,r.role_name;

-- 4) Realtime publication
SELECT tablename
FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND schemaname='public'
  AND tablename IN (
   'mail_messages','global_alerts','activity_feed_items','global_alert_reads',
   'emergencies','guard_terms','emergency_quests','emergency_quest_completions',
   'assignments','assignment_submissions','assignment_gradings','attendances','attendance_milestones',
   'daily_statistics','rankings','hall_of_fame_entries'
  )
ORDER BY tablename;
