-- =============================================================================
-- B.R.A.N.D 2.0 — ONE-TIME real classroom pre-Season-2 cleanup (v2 syntax-fixed)
-- Target: classroom_id=1 / school_year=2026 / name='5학년 4반'
--
-- PURPOSE
--   Make the real classroom a clean migration target before the planned
--   Season-1 data import.  From this point onward all development/E2E testing
--   belongs in the dedicated TEST classroom.
--
-- PRESERVED
--   * classroom row
--   * students + Supabase Auth links
--   * Guild Season 2 row
--   * the 5 Guild definitions
--   * classroom/system/master/catalog definitions (achievements, assignments,
--     daily quests, cosmetics, products, catalogs, settings, school terms, etc.)
--
-- CLEARED/RESET
--   * temporary Guild memberships/elements/history/sessions
--   * Guild 2 / Guild 3 operational evidence
--   * Arcade real-classroom test evidence/periods
--   * student operational history (submissions, attendance, quest completion,
--     achievements, alerts/mail/feed, rankings, auction/economy activity, jobs,
--     deposits/loans/P2P/purchases, etc.)
--   * transactions, wallet balances, welfare-fund operational balance
--
-- SAFETY
--   * hard-coded target identity; aborts on mismatch
--   * transaction-scoped; any error rolls everything back
--   * TEST classroom is never selected by name or parameter
--   * immutable-history USER triggers are disabled only inside this transaction
--     for the exact history tables that must be reset, and re-enabled before COMMIT
--   * before deleting transactions, every FK pointing at the target transaction
--     IDs is checked; any unhandled reference aborts the cleanup
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- -----------------------------------------------------------------------------
-- 0. Hard guard the exact production target.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.classrooms c
  WHERE c.id = 1
    AND c.school_year = 2026
    AND c.name = '5학년 4반'
    AND c.is_active = true;

  IF v_count <> 1 THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] target guard failed: expected exactly classroom_id=1 / 2026 / 5학년 4반.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.classrooms
    WHERE id = 1
      AND (name ILIKE '%TEST%' OR coalesce(to_jsonb(classrooms)->>'display_name','') ILIKE '%TEST%')
  ) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] target unexpectedly looks like a TEST classroom; abort.';
  END IF;
END;
$$;

CREATE TEMP TABLE _cleanup_target_students ON COMMIT DROP AS
SELECT id FROM public.students WHERE classroom_id = 1;
CREATE UNIQUE INDEX ON _cleanup_target_students(id);

CREATE TEMP TABLE _cleanup_target_guilds ON COMMIT DROP AS
SELECT id FROM public.guilds WHERE classroom_id = 1;
CREATE UNIQUE INDEX ON _cleanup_target_guilds(id);

CREATE TEMP TABLE _cleanup_target_seasons ON COMMIT DROP AS
SELECT id FROM public.guild_seasons WHERE classroom_id = 1;
CREATE UNIQUE INDEX ON _cleanup_target_seasons(id);

CREATE TEMP TABLE _cleanup_target_transactions ON COMMIT DROP AS
SELECT id FROM public.transactions WHERE classroom_id = 1;
CREATE UNIQUE INDEX ON _cleanup_target_transactions(id);

CREATE TEMP TABLE _cleanup_before (
  label text PRIMARY KEY,
  row_count bigint NOT NULL
) ON COMMIT DROP;
INSERT INTO _cleanup_before(label,row_count) VALUES
  ('students', (SELECT count(*) FROM public.students WHERE classroom_id=1)),
  ('guilds', (SELECT count(*) FROM public.guilds WHERE classroom_id=1)),
  ('guild_members', (SELECT count(*) FROM public.guild_members WHERE student_id IN (SELECT id FROM _cleanup_target_students))),
  ('guild_membership_events', (SELECT count(*) FROM public.guild_membership_events WHERE classroom_id=1)),
  ('guild_sessions', (SELECT count(*) FROM public.guild_sessions WHERE classroom_id=1)),
  ('guild2_gs_events', (SELECT count(*) FROM public.guild2_gs_events WHERE classroom_id=1)),
  ('guild3_missions', (SELECT count(*) FROM public.guild3_missions WHERE classroom_id=1)),
  ('arcade_runs', (SELECT count(*) FROM public.arcade_runs WHERE classroom_id=1)),
  ('rankings', (SELECT count(*) FROM public.rankings WHERE classroom_id=1)),
  ('transactions', (SELECT count(*) FROM public.transactions WHERE classroom_id=1)),
  ('wallets', (SELECT count(*) FROM public.wallets WHERE student_id IN (SELECT id FROM _cleanup_target_students)));

-- -----------------------------------------------------------------------------
-- 1. Temporarily allow deletion of immutable TEST/append-only evidence.
--    ALTER TABLE is transactional in PostgreSQL; a failure rolls these changes back.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild3_mission_activity_records DISABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_audit_events DISABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_grade_events DISABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_judgment_events DISABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_participants DISABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_submissions DISABLE TRIGGER USER;
ALTER TABLE public.guild3_missions DISABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_finalizations DISABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_snapshot_entries DISABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_snapshot_student_ranks DISABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_snapshots DISABLE TRIGGER USER;
ALTER TABLE public.arcade_run_moderation_events DISABLE TRIGGER USER;
ALTER TABLE public.arcade_ranking_periods DISABLE TRIGGER USER;

-- -----------------------------------------------------------------------------
-- 2. Guild 3 — deepest immutable children first.
-- -----------------------------------------------------------------------------
DELETE FROM public.guild3_mission_audit_events WHERE classroom_id = 1;
DELETE FROM public.guild3_mission_grade_events
 WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.guild3_mission_judgment_events WHERE classroom_id = 1;
DELETE FROM public.guild3_mission_activity_records WHERE classroom_id = 1;
DELETE FROM public.guild3_mission_submissions WHERE classroom_id = 1;
DELETE FROM public.guild3_peer_review_openings WHERE classroom_id = 1;
DELETE FROM public.guild3_mission_participants WHERE classroom_id = 1;
DELETE FROM public.guild3_mission_instances WHERE classroom_id = 1;
DELETE FROM public.guild3_missions WHERE classroom_id = 1;

-- -----------------------------------------------------------------------------
-- 3. Arcade — snapshot children, run evidence, then classroom periods.
-- -----------------------------------------------------------------------------
DELETE FROM public.arcade_monthly_snapshot_entries
 WHERE snapshot_id IN (SELECT id FROM public.arcade_monthly_snapshots WHERE classroom_id=1)
    OR source_run_id IN (SELECT id FROM public.arcade_runs WHERE classroom_id=1);
DELETE FROM public.arcade_monthly_snapshot_student_ranks
 WHERE snapshot_id IN (SELECT id FROM public.arcade_monthly_snapshots WHERE classroom_id=1)
    OR source_run_id IN (SELECT id FROM public.arcade_runs WHERE classroom_id=1);
DELETE FROM public.arcade_monthly_snapshots WHERE classroom_id = 1;
DELETE FROM public.arcade_monthly_finalizations WHERE classroom_id = 1;
DELETE FROM public.arcade_run_moderation_events WHERE classroom_id = 1;
DELETE FROM public.arcade_run_submissions
 WHERE run_id IN (SELECT id FROM public.arcade_runs WHERE classroom_id=1);
DELETE FROM public.arcade_runs WHERE classroom_id = 1;
DELETE FROM public.arcade_prerelease_test_access WHERE classroom_id = 1;
DELETE FROM public.arcade_ranking_periods WHERE classroom_id = 1;

-- -----------------------------------------------------------------------------
-- 4. Guild 2 + legacy Guild operational history.
-- -----------------------------------------------------------------------------
DELETE FROM public.guild2_gs_events WHERE classroom_id = 1;
DELETE FROM public.guild2_individual_contributions WHERE classroom_id = 1;
DELETE FROM public.guild2_monthly_gs_summaries WHERE classroom_id = 1;
DELETE FROM public.guild2_observation_events WHERE classroom_id = 1;
DELETE FROM public.guild2_compensation_configs WHERE classroom_id = 1;

DELETE FROM public.guild_session_participants
 WHERE student_id IN (SELECT id FROM _cleanup_target_students)
    OR guild_id_at_session IN (SELECT id FROM _cleanup_target_guilds);
DELETE FROM public.guild_session_attendances
 WHERE student_id IN (SELECT id FROM _cleanup_target_students)
    OR guild_id IN (SELECT id FROM _cleanup_target_guilds);
DELETE FROM public.guild_sessions WHERE classroom_id = 1;

DELETE FROM public.guild_peer_reviews
 WHERE reviewer_id IN (SELECT id FROM _cleanup_target_students)
    OR reviewee_id IN (SELECT id FROM _cleanup_target_students)
    OR guild_id IN (SELECT id FROM _cleanup_target_guilds);
DELETE FROM public.guild_activity_logs
 WHERE student_id IN (SELECT id FROM _cleanup_target_students)
    OR guild_id IN (SELECT id FROM _cleanup_target_guilds);
DELETE FROM public.guild_individual_contributions WHERE classroom_id = 1;
DELETE FROM public.guild_gs WHERE guild_id IN (SELECT id FROM _cleanup_target_guilds);
DELETE FROM public.guild_mission_logs WHERE guild_id IN (SELECT id FROM _cleanup_target_guilds);
DELETE FROM public.guild_missions WHERE classroom_id = 1;
DELETE FROM public.hall_of_fame_entries
 WHERE student_id IN (SELECT id FROM _cleanup_target_students)
    OR guild_id IN (SELECT id FROM _cleanup_target_guilds);

-- Temporary 16-person assignments and their arbitrary elements/history are test data.
DELETE FROM public.guild_membership_events WHERE classroom_id = 1;
DELETE FROM public.guild_members WHERE student_id IN (SELECT id FROM _cleanup_target_students);

-- -----------------------------------------------------------------------------
-- 5. Student operational history outside Guild.
--    MASTER/DEFINITION/CATALOG rows are intentionally preserved.
-- -----------------------------------------------------------------------------
DELETE FROM public.assignment_gradings
 WHERE submission_id IN (SELECT id FROM public.assignment_submissions WHERE classroom_id=1);
DELETE FROM public.assignment_submissions WHERE classroom_id = 1;

DELETE FROM public.attendance_milestones WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.attendances WHERE classroom_id = 1;

DELETE FROM public.achievement_applications WHERE classroom_id = 1;
DELETE FROM public.student_achievements WHERE student_id IN (SELECT id FROM _cleanup_target_students);

DELETE FROM public.daily_quest_completions WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.daily_statistics WHERE classroom_id = 1;

DELETE FROM public.emergency_quest_completions WHERE classroom_id = 1;
DELETE FROM public.emergency_quests WHERE classroom_id = 1;
DELETE FROM public.guard_terms WHERE classroom_id = 1;
DELETE FROM public.emergencies WHERE classroom_id = 1;

DELETE FROM public.global_alert_reads WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.global_alerts WHERE classroom_id = 1;
DELETE FROM public.activity_feed_items WHERE classroom_id = 1;
DELETE FROM public.mail_messages WHERE classroom_id = 1;

DELETE FROM public.cosmetic_collections WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.student_cosmetic_ownerships WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.credit_scores WHERE student_id IN (SELECT id FROM _cleanup_target_students);

DELETE FROM public.secondary_job_applications WHERE classroom_id = 1;
DELETE FROM public.secondary_jobs WHERE classroom_id = 1;
DELETE FROM public.job_market_requests WHERE classroom_id = 1;
DELETE FROM public.loan_applications WHERE classroom_id = 1;
DELETE FROM public.loans WHERE classroom_id = 1;
DELETE FROM public.p2p_transfers
 WHERE sender_id IN (SELECT id FROM _cleanup_target_students)
    OR receiver_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.student_deposits WHERE classroom_id = 1;
DELETE FROM public.snack_purchases WHERE student_id IN (SELECT id FROM _cleanup_target_students);
DELETE FROM public.exchange_logs WHERE student_id IN (SELECT id FROM _cleanup_target_students);

-- Auction is operational history. Primary jobs linked to auction items must go first.
DELETE FROM public.primary_jobs WHERE classroom_id = 1;
UPDATE public.auctions SET current_item_id = NULL WHERE classroom_id = 1;
UPDATE public.auction_items
SET current_bid_id = NULL
WHERE auction_id IN (SELECT id FROM public.auctions WHERE classroom_id=1);
DELETE FROM public.auction_event_logs
 WHERE auction_id IN (SELECT id FROM public.auctions WHERE classroom_id=1)
    OR auction_item_id IN (SELECT i.id FROM public.auction_items i JOIN public.auctions a ON a.id=i.auction_id WHERE a.classroom_id=1);
DELETE FROM public.auction_failures
 WHERE auction_item_id IN (SELECT i.id FROM public.auction_items i JOIN public.auctions a ON a.id=i.auction_id WHERE a.classroom_id=1);
DELETE FROM public.auction_bids
 WHERE auction_item_id IN (SELECT i.id FROM public.auction_items i JOIN public.auctions a ON a.id=i.auction_id WHERE a.classroom_id=1);
DELETE FROM public.auction_results
 WHERE auction_item_id IN (SELECT i.id FROM public.auction_items i JOIN public.auctions a ON a.id=i.auction_id WHERE a.classroom_id=1);
DELETE FROM public.auction_items WHERE auction_id IN (SELECT id FROM public.auctions WHERE classroom_id=1);
DELETE FROM public.auctions WHERE classroom_id = 1;

DELETE FROM public.rankings WHERE classroom_id = 1;

-- Optional AI debug/cache rows are cleared only if they are actually classroom-scoped.
DO $$
BEGIN
  IF to_regclass('public.ai_call_logs') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_call_logs' AND column_name='classroom_id') THEN
    EXECUTE 'DELETE FROM public.ai_call_logs WHERE classroom_id=1';
  END IF;
  IF to_regclass('public.ai_response_cache') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_response_cache' AND column_name='classroom_id') THEN
    EXECUTE 'DELETE FROM public.ai_response_cache WHERE classroom_id=1';
  END IF;
END;
$$;

-- Welfare movement rows point at transactions; remove them before transaction cleanup.
DELETE FROM public.welfare_fund_movements
 WHERE fund_id IN (SELECT id FROM public.welfare_funds WHERE classroom_id=1)
    OR transaction_id IN (SELECT id FROM _cleanup_target_transactions);

-- -----------------------------------------------------------------------------
-- 6. Transaction FK completeness guard.
--    If a production table gained a new FK to transactions and we did not clear
--    its target rows above, abort rather than corrupting or partially cleaning.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_remaining bigint;
BEGIN
  FOR r IN
    SELECT dep.relname AS dependent_table,
           a.attname AS dependent_column
    FROM pg_constraint c
    JOIN pg_class dep ON dep.oid=c.conrelid
    JOIN pg_namespace dn ON dn.oid=dep.relnamespace
    JOIN pg_class ref ON ref.oid=c.confrelid
    JOIN pg_namespace rn ON rn.oid=ref.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY ck(attnum,ord) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY fk(attnum,ord) ON fk.ord=ck.ord
    JOIN pg_attribute a ON a.attrelid=dep.oid AND a.attnum=ck.attnum
    JOIN pg_attribute ra ON ra.attrelid=ref.oid AND ra.attnum=fk.attnum
    WHERE c.contype='f'
      AND dn.nspname='public'
      AND rn.nspname='public'
      AND ref.relname='transactions'
      AND ra.attname='id'
      AND dep.relname <> 'transactions'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I d WHERE d.%I IN (SELECT id FROM pg_temp._cleanup_target_transactions)',
      r.dependent_table, r.dependent_column
    ) INTO v_remaining;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION '[PRESEASON CLEANUP] unhandled transaction FK remains: %.% => % row(s). Cleanup rolled back.',
        r.dependent_table, r.dependent_column, v_remaining;
    END IF;
  END LOOP;
END;
$$;

DELETE FROM public.transactions WHERE classroom_id = 1;

-- Clean migration baseline: preserve wallet identity rows, zero all balances.
UPDATE public.wallets w
SET gold = 0,
    bv = 0,
    crystal = 0,
    updated_at = now()
WHERE w.student_id IN (SELECT id FROM _cleanup_target_students);

-- Preserve the classroom welfare-fund singleton/config row but reset test totals.
UPDATE public.welfare_funds
SET total_collected = 0,
    current_balance = 0,
    updated_at = now()
WHERE classroom_id = 1;

-- -----------------------------------------------------------------------------
-- 7. Restore immutable triggers before verification/commit.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild3_mission_activity_records ENABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_audit_events ENABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_grade_events ENABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_judgment_events ENABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_participants ENABLE TRIGGER USER;
ALTER TABLE public.guild3_mission_submissions ENABLE TRIGGER USER;
ALTER TABLE public.guild3_missions ENABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_finalizations ENABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_snapshot_entries ENABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ENABLE TRIGGER USER;
ALTER TABLE public.arcade_monthly_snapshots ENABLE TRIGGER USER;
ALTER TABLE public.arcade_run_moderation_events ENABLE TRIGGER USER;
ALTER TABLE public.arcade_ranking_periods ENABLE TRIGGER USER;

-- -----------------------------------------------------------------------------
-- 8. Hard postconditions. Any violation aborts the entire transaction.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id=1 AND school_year=2026 AND name='5학년 4반') THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] real classroom disappeared; rollback.';
  END IF;
  IF (SELECT count(*) FROM public.guilds WHERE classroom_id=1) <> 5 THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] expected exactly 5 preserved guild definitions; rollback.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.guild_seasons WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] Guild Season baseline disappeared; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE classroom_id=1 AND user_id IS NULL) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] an existing real-classroom student/Auth link is NULL after cleanup; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guild_members WHERE student_id IN (SELECT id FROM _cleanup_target_students)) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] guild_members test assignments remain; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guild_membership_events WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] guild_membership_events remain; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guild_sessions WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] guild_sessions remain; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guild2_gs_events WHERE classroom_id=1)
     OR EXISTS (SELECT 1 FROM public.guild2_individual_contributions WHERE classroom_id=1)
     OR EXISTS (SELECT 1 FROM public.guild2_monthly_gs_summaries WHERE classroom_id=1)
     OR EXISTS (SELECT 1 FROM public.guild2_observation_events WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] Guild 2 operational history remains; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guild3_missions WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] Guild 3 operational history remains; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs WHERE classroom_id=1)
     OR EXISTS (SELECT 1 FROM public.arcade_ranking_periods WHERE classroom_id=1)
     OR EXISTS (SELECT 1 FROM public.arcade_prerelease_test_access WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] Arcade real-classroom test history remains; rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE classroom_id=1) THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] transactions remain; rollback.';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.wallets w
  WHERE w.student_id IN (SELECT id FROM _cleanup_target_students)
    AND (w.gold<>0 OR w.bv<>0 OR w.crystal<>0);
  IF v_count > 0 THEN
    RAISE EXCEPTION '[PRESEASON CLEANUP] non-zero wallet(s) remain; rollback.';
  END IF;
END;
$$;

-- Human-readable before/after report.
SELECT b.label,
       b.row_count AS before_count,
       CASE b.label
         WHEN 'students' THEN (SELECT count(*) FROM public.students WHERE classroom_id=1)
         WHEN 'guilds' THEN (SELECT count(*) FROM public.guilds WHERE classroom_id=1)
         WHEN 'guild_members' THEN (SELECT count(*) FROM public.guild_members WHERE student_id IN (SELECT id FROM _cleanup_target_students))
         WHEN 'guild_membership_events' THEN (SELECT count(*) FROM public.guild_membership_events WHERE classroom_id=1)
         WHEN 'guild_sessions' THEN (SELECT count(*) FROM public.guild_sessions WHERE classroom_id=1)
         WHEN 'guild2_gs_events' THEN (SELECT count(*) FROM public.guild2_gs_events WHERE classroom_id=1)
         WHEN 'guild3_missions' THEN (SELECT count(*) FROM public.guild3_missions WHERE classroom_id=1)
         WHEN 'arcade_runs' THEN (SELECT count(*) FROM public.arcade_runs WHERE classroom_id=1)
         WHEN 'rankings' THEN (SELECT count(*) FROM public.rankings WHERE classroom_id=1)
         WHEN 'transactions' THEN (SELECT count(*) FROM public.transactions WHERE classroom_id=1)
         WHEN 'wallets' THEN (SELECT count(*) FROM public.wallets WHERE student_id IN (SELECT id FROM _cleanup_target_students))
       END AS after_count
FROM _cleanup_before b
ORDER BY b.label;

COMMIT;
