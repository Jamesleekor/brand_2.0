-- B.R.A.N.D 2.0 Feature 4.1.1 read-only postcheck
SELECT
  to_regclass('public.emergency_quest_requests') IS NOT NULL AS quest_request_table,
  to_regprocedure('public.request_emergency_quest_completion(integer,bigint)') IS NOT NULL AS quest_request_rpc,
  to_regprocedure('public.teacher_review_emergency_quest_request(bigint,boolean,text)') IS NOT NULL AS quest_review_rpc,
  to_regprocedure('public.teacher_grant_student_assets_combined(integer[],bigint,bigint,text)') IS NOT NULL AS combined_asset_rpc,
  to_regprocedure('public.teacher_feature4_1_1_health_check()') IS NOT NULL AS health_411_rpc,
  to_regprocedure('public.teacher_create_live_auction(integer,integer,integer,date,integer,integer)') IS NOT NULL AS auction_create_rpc,
  to_regprocedure('public.teacher_start_live_auction(integer)') IS NOT NULL AS auction_start_rpc;

SELECT tablename
FROM pg_publication_tables
WHERE pubname='supabase_realtime'
  AND schemaname='public'
  AND tablename IN (
    'mail_messages','global_alerts','global_alert_reads','emergencies',
    'emergency_quests','emergency_quest_completions','emergency_quest_requests','assignments'
  )
ORDER BY tablename;
