-- =============================================================================
-- B.R.A.N.D 2.0 — Guild4-A Backend PRE-FLIGHT (READ ONLY)
-- Baseline: Guild3 COMPLETE v13 / checkpoint 897bdd7
-- 2026-08-16
-- =============================================================================

SELECT 'G4-A PREFLIGHT START' AS checkpoint, now() AS checked_at;

-- 1) Required auth/context/economy/Guild2 helpers.
SELECT
  to_regprocedure('public.ensure_teacher_role()') AS ensure_teacher_role,
  to_regprocedure('public.current_classroom_id()') AS current_classroom_id,
  to_regprocedure('public.current_student_id()') AS current_student_id,
  to_regprocedure('public.is_teacher_or_admin()') AS is_teacher_or_admin,
  to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') AS create_transaction,
  to_regprocedure('public.reverse_transaction(bigint,text)') AS reverse_transaction,
  to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') AS guild2_refresh_monthly_scores;

-- 2) Required source/core tables.
SELECT
  to_regclass('public.guild3_missions') AS guild3_missions,
  to_regclass('public.guild3_mission_instances') AS guild3_mission_instances,
  to_regclass('public.guild3_mission_participants') AS guild3_mission_participants,
  to_regclass('public.guild3_peer_review_openings') AS guild3_peer_review_openings,
  to_regclass('public.wallets') AS wallets,
  to_regclass('public.transactions') AS transactions,
  to_regclass('public.guild2_individual_contributions') AS guild2_individual_contributions,
  to_regclass('public.test_classroom_fixtures') AS test_classroom_fixtures;

-- 3) Required enum labels. G4-A intentionally reuses TEACHER_DEDUCT for the
-- ledger posting while G4 tables/audit carry the peer-penalty semantics.
SELECT t.typname AS enum_name,e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid=t.oid
JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname='public'
  AND t.typname IN ('value_token_type','transaction_source_type')
ORDER BY t.typname,e.enumsortorder;

-- 4) Guild3 opening/source contract.
SELECT
  o.id AS opening_id,
  o.mission_id,
  o.mission_instance_id,
  o.classroom_id,
  o.season_id,
  o.guild_id,
  o.opening_status,
  o.voided_at,
  m.contribution_year_month,
  m.lifecycle_state,
  m.peer_review_required,
  m.finalized_at,
  count(p.id) AS participant_count
FROM public.guild3_peer_review_openings o
JOIN public.guild3_missions m ON m.id=o.mission_id
JOIN public.guild3_mission_instances i ON i.id=o.mission_instance_id
LEFT JOIN public.guild3_mission_participants p ON p.mission_instance_id=o.mission_instance_id
GROUP BY o.id,m.contribution_year_month,m.lifecycle_state,m.peer_review_required,m.finalized_at
ORDER BY o.id;

-- 5) Any invalid OPENABLE source should return rows here. Expected: zero rows.
SELECT
  o.id AS opening_id,
  o.mission_id,
  o.mission_instance_id,
  o.opening_status,
  m.lifecycle_state,
  m.peer_review_required,
  m.finalized_at,
  o.classroom_id AS opening_classroom_id,
  m.classroom_id AS mission_classroom_id,
  i.classroom_id AS instance_classroom_id,
  o.guild_id AS opening_guild_id,
  i.guild_id AS instance_guild_id
FROM public.guild3_peer_review_openings o
JOIN public.guild3_missions m ON m.id=o.mission_id
JOIN public.guild3_mission_instances i ON i.id=o.mission_instance_id
WHERE o.mission_id IS DISTINCT FROM i.mission_id
   OR o.classroom_id IS DISTINCT FROM m.classroom_id
   OR o.classroom_id IS DISTINCT FROM i.classroom_id
   OR o.guild_id IS DISTINCT FROM i.guild_id
   OR (o.opening_status='OPENABLE' AND (
        m.lifecycle_state<>'FINALIZED'
        OR m.peer_review_required IS DISTINCT FROM true
        OR m.finalized_at IS NULL
      ));

-- 6) Participant duplicates. Expected: zero rows.
SELECT mission_instance_id,student_id,count(*) AS duplicate_count
FROM public.guild3_mission_participants
GROUP BY mission_instance_id,student_id
HAVING count(*)>1;

-- 7) First-apply collision check. On a clean v13 database these are NULL.
SELECT
  to_regclass('public.guild4_peer_review_rounds') AS rounds,
  to_regclass('public.guild4_peer_review_participants') AS participants,
  to_regclass('public.guild4_peer_review_obligations') AS obligations,
  to_regclass('public.guild4_peer_review_revisions') AS revisions,
  to_regclass('public.guild4_peer_review_exception_events') AS exception_events,
  to_regclass('public.guild4_peer_review_penalties') AS penalties,
  to_regclass('public.guild4_peer_review_score_rollups') AS score_rollups,
  to_regclass('public.guild4_peer_review_audit_events') AS audit_events;

SELECT proname,pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname LIKE '%guild4%'
ORDER BY proname,args;

SELECT 'G4-A PREFLIGHT END' AS checkpoint, now() AS checked_at;
