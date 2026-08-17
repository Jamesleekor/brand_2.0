-- =============================================================================
-- B.R.A.N.D 2.0 — Guild4-A Backend POSTCHECK (READ ONLY)
-- 2026-08-16
-- =============================================================================

SELECT 'G4-A POSTCHECK START' AS checkpoint, now() AS checked_at;

-- 1) Tables.
SELECT
  to_regclass('public.guild4_peer_review_rounds') IS NOT NULL AS rounds_ok,
  to_regclass('public.guild4_peer_review_participants') IS NOT NULL AS participants_ok,
  to_regclass('public.guild4_peer_review_obligations') IS NOT NULL AS obligations_ok,
  to_regclass('public.guild4_peer_review_revisions') IS NOT NULL AS revisions_ok,
  to_regclass('public.guild4_peer_review_exception_events') IS NOT NULL AS exceptions_ok,
  to_regclass('public.guild4_peer_review_penalties') IS NOT NULL AS penalties_ok,
  to_regclass('public.guild4_peer_review_score_rollups') IS NOT NULL AS score_rollups_ok,
  to_regclass('public.guild4_peer_review_audit_events') IS NOT NULL AS audit_ok;

-- 2) Required functions/RPCs.
SELECT
  to_regprocedure('public.guild4_materialize_round_from_opening(bigint)') IS NOT NULL AS materialize_ok,
  to_regprocedure('public.teacher_sync_guild4_peer_review_rounds()') IS NOT NULL AS teacher_sync_ok,
  to_regprocedure('public.teacher_list_guild4_peer_review_rounds()') IS NOT NULL AS teacher_list_ok,
  to_regprocedure('public.teacher_get_guild4_peer_review_round_detail(bigint)') IS NOT NULL AS teacher_detail_ok,
  to_regprocedure('public.teacher_update_guild4_peer_review_deadline(bigint,timestamptz,text)') IS NOT NULL AS deadline_ok,
  to_regprocedure('public.teacher_set_guild4_peer_review_excused(bigint,boolean,text)') IS NOT NULL AS excused_ok,
  to_regprocedure('public.teacher_close_guild4_peer_review_round(bigint,text)') IS NOT NULL AS close_ok,
  to_regprocedure('public.teacher_finalize_guild4_peer_review_round(bigint,text)') IS NOT NULL AS finalize_ok,
  to_regprocedure('public.teacher_retry_guild4_peer_review_penalty(bigint)') IS NOT NULL AS retry_penalty_ok,
  to_regprocedure('public.teacher_waive_guild4_peer_review_penalty(bigint,text)') IS NOT NULL AS waive_penalty_ok,
  to_regprocedure('public.student_get_guild4_peer_review_rounds()') IS NOT NULL AS student_list_ok,
  to_regprocedure('public.student_submit_guild4_peer_review(bigint,integer,text)') IS NOT NULL AS student_submit_ok,
  to_regprocedure('public.guild4_calculate_peer_review_round_scores(bigint)') IS NOT NULL AS scoring_helper_ok,
  to_regprocedure('public.guild4_evaluate_peer_review_penalties(bigint)') IS NOT NULL AS penalty_helper_ok;

-- 3) Browser privilege boundaries.
SELECT
  has_function_privilege('authenticated','public.teacher_sync_guild4_peer_review_rounds()','EXECUTE') AS teacher_sync_authenticated,
  has_function_privilege('authenticated','public.teacher_finalize_guild4_peer_review_round(bigint,text)','EXECUTE') AS teacher_finalize_authenticated,
  has_function_privilege('authenticated','public.student_get_guild4_peer_review_rounds()','EXECUTE') AS student_list_authenticated,
  has_function_privilege('authenticated','public.student_submit_guild4_peer_review(bigint,integer,text)','EXECUTE') AS student_submit_authenticated,
  NOT has_function_privilege('authenticated','public.guild4_calculate_peer_review_round_scores(bigint)','EXECUTE') AS scoring_helper_hidden,
  NOT has_function_privilege('authenticated','public.guild4_evaluate_peer_review_penalties(bigint)','EXECUTE') AS penalty_helper_hidden,
  NOT has_function_privilege('authenticated','public.guild4_materialize_round_from_opening(bigint)','EXECUTE') AS materializer_hidden;

-- 4) Direct table grants to anon/authenticated should be absent.
SELECT grantee,table_name,privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name LIKE 'guild4_peer_review_%'
  AND grantee IN ('anon','authenticated')
ORDER BY table_name,grantee,privilege_type;

-- 5) RLS status.
SELECT relname,relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND relname LIKE 'guild4_peer_review_%'
ORDER BY relname;

-- 6) Source VOID trigger.
SELECT tgname,pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname='guild3_peer_review_openings'
  AND NOT t.tgisinternal
  AND tgname='guild4_reconcile_source_void_on_opening';

-- 7) Constraint shape relevant to locked rules.
SELECT conrelid::regclass AS table_name,conname,pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.guild4_peer_review_rounds'::regclass,
  'public.guild4_peer_review_obligations'::regclass,
  'public.guild4_peer_review_revisions'::regclass,
  'public.guild4_peer_review_penalties'::regclass,
  'public.guild4_peer_review_score_rollups'::regclass
)
ORDER BY table_name::text,conname;

-- 8) Current materialized state. Empty is valid before teacher sync.
SELECT
  (SELECT count(*) FROM public.guild4_peer_review_rounds) AS rounds,
  (SELECT count(*) FROM public.guild4_peer_review_participants) AS participants,
  (SELECT count(*) FROM public.guild4_peer_review_obligations) AS obligations,
  (SELECT count(*) FROM public.guild4_peer_review_revisions) AS revisions,
  (SELECT count(*) FROM public.guild4_peer_review_penalties) AS penalties,
  (SELECT count(*) FROM public.guild4_peer_review_score_rollups) AS score_rollups;

-- 9) Any invalid self-review pair should return zero rows.
SELECT id,round_id,reviewer_student_id,target_student_id
FROM public.guild4_peer_review_obligations
WHERE reviewer_student_id=target_student_id;

SELECT 'G4-A POSTCHECK END' AS checkpoint, now() AS checked_at;
