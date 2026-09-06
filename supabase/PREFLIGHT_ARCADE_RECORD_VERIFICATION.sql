-- B.R.A.N.D 2.0 Arcade record verification — SQL Editor-safe PREFLIGHT
-- READ ONLY. Run before 20260906_16_arcade_record_verification.sql.
-- Do not run teacher/auth RPCs from SQL Editor; this file only inspects structure/data.

WITH required_tables(name) AS (
  VALUES
    ('students'),('classrooms'),('guild_seasons'),('arcade_games'),('arcade_game_rule_versions'),
    ('arcade_ranking_periods'),('arcade_runs'),('arcade_run_submissions'),('arcade_run_moderation_events'),
    ('arcade_monthly_finalizations'),('arcade_monthly_snapshots'),('arcade_monthly_snapshot_entries'),
    ('arcade_monthly_snapshot_student_ranks'),('guild2_individual_contributions'),
    ('arcade_analytics_game_semantics'),('test_classroom_fixtures')
)
SELECT 'required_tables' AS check_name,
       count(*) FILTER (WHERE to_regclass('public.' || name) IS NULL) AS problem_count,
       jsonb_agg(name) FILTER (WHERE to_regclass('public.' || name) IS NULL) AS details
FROM required_tables;

WITH required_functions(signature) AS (
  VALUES
    ('public.current_student_id()'),
    ('public.current_classroom_id()'),
    ('public.ensure_teacher_role()'),
    ('public.is_official_participant(integer)'),
    ('public.arcade_generate_run_seed()'),
    ('public.arcade_set_updated_at()'),
    ('public.student_begin_arcade_run(bigint)'),
    ('public.student_submit_focus_reaction_01_run(bigint,jsonb,integer)'),
    ('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'),
    ('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)'),
    ('public.arcade_resolve_period_top10(integer,bigint,bigint)'),
    ('public.teacher_finalize_arcade_monthly_snapshot(bigint)'),
    ('public.guild2_refresh_monthly_scores(integer,text)')
)
SELECT 'required_functions' AS check_name,
       count(*) FILTER (WHERE to_regprocedure(signature) IS NULL) AS problem_count,
       jsonb_agg(signature) FILTER (WHERE to_regprocedure(signature) IS NULL) AS details
FROM required_functions;

SELECT 'period_status_constraint' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
         WHERE c.conrelid='public.arcade_ranking_periods'::regclass
           AND c.conname='arcade_ranking_period_status_check'
           AND pg_get_constraintdef(c.oid) ILIKE '%DRAFT%ACTIVE%FINALIZED%'
       ) THEN 0 ELSE 1 END AS problem_count,
       (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
        WHERE c.conrelid='public.arcade_ranking_periods'::regclass
          AND c.conname='arcade_ranking_period_status_check') AS details;

SELECT 'guild2_cap_contract' AS check_name,
       (CASE WHEN EXISTS (
          SELECT 1 FROM pg_constraint c
          WHERE c.conrelid='public.guild2_individual_contributions'::regclass
            AND c.conname='guild2_contribution_arcade_applied_check'
            AND pg_get_constraintdef(c.oid) ILIKE '%90%'
        ) THEN 0 ELSE 1 END
        + CASE WHEN EXISTS (
          SELECT 1 FROM pg_constraint c
          WHERE c.conrelid='public.guild2_individual_contributions'::regclass
            AND c.conname='guild2_contribution_final_range_check'
            AND pg_get_constraintdef(c.oid) ILIKE '%990%'
        ) THEN 0 ELSE 1 END) AS problem_count,
       jsonb_build_object(
         'arcade_applied', (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid='public.guild2_individual_contributions'::regclass AND c.conname='guild2_contribution_arcade_applied_check'),
         'final_total', (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid='public.guild2_individual_contributions'::regclass AND c.conname='guild2_contribution_final_range_check')
       ) AS details;

SELECT 'production_integrity' AS check_name,
       ((SELECT count(*) FROM public.arcade_ranking_periods p
          WHERE p.period_kind='MONTHLY' AND p.status='FINALIZED'
            AND NOT EXISTS (SELECT 1 FROM public.arcade_monthly_finalizations f WHERE f.period_id=p.id))
        +
        (SELECT count(*) FROM public.arcade_monthly_finalizations f
          WHERE f.eligible_game_count <> (SELECT count(*) FROM public.arcade_monthly_snapshots s WHERE s.finalization_id=f.id))
        +
        (SELECT count(*) FROM public.arcade_monthly_snapshot_student_ranks sr
          JOIN public.arcade_runs r ON r.id=sr.source_run_id
          WHERE r.status<>'VERIFIED')
        +
        (SELECT count(*) FROM public.guild2_individual_contributions c
          WHERE c.arcade_applied<0 OR c.arcade_applied>90 OR c.final_total<0 OR c.final_total>990)) AS problem_count,
       jsonb_build_object(
         'finalized_without_finalization',(SELECT count(*) FROM public.arcade_ranking_periods p WHERE p.period_kind='MONTHLY' AND p.status='FINALIZED' AND NOT EXISTS(SELECT 1 FROM public.arcade_monthly_finalizations f WHERE f.period_id=p.id)),
         'snapshot_count_mismatch',(SELECT count(*) FROM public.arcade_monthly_finalizations f WHERE f.eligible_game_count<>(SELECT count(*) FROM public.arcade_monthly_snapshots s WHERE s.finalization_id=f.id)),
         'snapshot_source_not_verified',(SELECT count(*) FROM public.arcade_monthly_snapshot_student_ranks sr JOIN public.arcade_runs r ON r.id=sr.source_run_id WHERE r.status<>'VERIFIED'),
         'guild_cap_violation',(SELECT count(*) FROM public.guild2_individual_contributions c WHERE c.arcade_applied<0 OR c.arcade_applied>90 OR c.final_total<0 OR c.final_total>990)
       ) AS details;

SELECT 'deployment_quiet_window' AS check_name,
       count(*) AS problem_count,
       jsonb_build_object('recent_in_flight_runs',count(*),'newest_created_at',max(created_at)) AS details
FROM public.arcade_runs
WHERE status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  AND created_at >= clock_timestamp()-interval '15 minutes';

SELECT 'game01_registry' AS check_name,
       CASE WHEN count(*)=1 THEN 0 ELSE 1 END AS problem_count,
       jsonb_agg(jsonb_build_object('id',id,'code',code,'is_active',is_active,'available_from',available_from,'available_until',available_until)) AS details
FROM public.arcade_games
WHERE code='focus_reaction_01';

WITH verification_tables(name) AS (
  VALUES
    ('arcade_verification_game_configs'),('arcade_verification_period_games'),
    ('arcade_verification_provisional_entries'),('arcade_verification_sessions'),
    ('arcade_verification_attempts'),('arcade_verification_official_results'),
    ('arcade_verification_corrections'),('arcade_verification_audit_events')
), existing_tables AS (
  SELECT name FROM verification_tables WHERE to_regclass('public.'||name) IS NOT NULL
), existing_columns AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='arcade_runs'
    AND column_name IN ('run_context','verification_session_id')
)
SELECT 'verification_not_already_applied' AS check_name,
       (SELECT count(*) FROM existing_tables) + (SELECT count(*) FROM existing_columns) AS problem_count,
       jsonb_build_object(
         'existing_verification_tables',coalesce((SELECT jsonb_agg(name) FROM existing_tables),'[]'::jsonb),
         'existing_arcade_run_columns',coalesce((SELECT jsonb_agg(column_name) FROM existing_columns),'[]'::jsonb)
       ) AS details;
