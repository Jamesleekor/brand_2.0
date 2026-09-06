-- B.R.A.N.D 2.0 Arcade record verification — SQL Editor-safe POSTCHECK
-- READ ONLY. Run immediately after 20260906_16_arcade_record_verification.sql.

WITH expected_tables(name) AS (
  VALUES
    ('arcade_verification_game_configs'),('arcade_verification_period_games'),
    ('arcade_verification_provisional_entries'),('arcade_verification_sessions'),
    ('arcade_verification_attempts'),('arcade_verification_official_results'),
    ('arcade_verification_corrections'),('arcade_verification_audit_events')
)
SELECT 'verification_tables' AS check_name,
       count(*) FILTER (WHERE to_regclass('public.'||name) IS NULL) AS problem_count,
       jsonb_agg(name) FILTER (WHERE to_regclass('public.'||name) IS NULL) AS details
FROM expected_tables;

SELECT 'lifecycle_constraint' AS check_name,
       CASE WHEN EXISTS(
         SELECT 1 FROM pg_constraint c
         WHERE c.conrelid='public.arcade_ranking_periods'::regclass
           AND c.conname='arcade_ranking_period_status_check'
           AND pg_get_constraintdef(c.oid) ILIKE '%VERIFICATION%'
           AND pg_get_constraintdef(c.oid) ILIKE '%READY_TO_FINALIZE%'
       ) THEN 0 ELSE 1 END AS problem_count,
       (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid='public.arcade_ranking_periods'::regclass AND c.conname='arcade_ranking_period_status_check') AS details;

SELECT 'run_context_columns' AS check_name,
       (CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='run_context') THEN 0 ELSE 1 END
        + CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='verification_session_id') THEN 0 ELSE 1 END) AS problem_count,
       jsonb_build_object(
         'run_context_exists',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='run_context'),
         'verification_session_id_exists',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='verification_session_id'),
         'legacy_nonstandard_runs',(SELECT count(*) FROM public.arcade_runs WHERE run_context<>'STANDARD')
       ) AS details;

SELECT 'rls_enabled' AS check_name,
       count(*) FILTER (WHERE NOT c.relrowsecurity) AS problem_count,
       jsonb_agg(c.relname) FILTER (WHERE NOT c.relrowsecurity) AS details
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN(
  'arcade_verification_game_configs','arcade_verification_period_games','arcade_verification_provisional_entries',
  'arcade_verification_sessions','arcade_verification_attempts','arcade_verification_official_results',
  'arcade_verification_corrections','arcade_verification_audit_events'
);

WITH verification_tables(name) AS (
  VALUES
    ('arcade_verification_game_configs'),('arcade_verification_period_games'),
    ('arcade_verification_provisional_entries'),('arcade_verification_sessions'),
    ('arcade_verification_attempts'),('arcade_verification_official_results'),
    ('arcade_verification_corrections'),('arcade_verification_audit_events')
), leaked AS (
  SELECT name
  FROM verification_tables
  WHERE has_table_privilege('authenticated','public.'||name,'SELECT')
     OR has_table_privilege('authenticated','public.'||name,'INSERT')
     OR has_table_privilege('authenticated','public.'||name,'UPDATE')
     OR has_table_privilege('authenticated','public.'||name,'DELETE')
     OR has_table_privilege('anon','public.'||name,'SELECT')
     OR has_table_privilege('anon','public.'||name,'INSERT')
     OR has_table_privilege('anon','public.'||name,'UPDATE')
     OR has_table_privilege('anon','public.'||name,'DELETE')
)
SELECT 'direct_client_table_privileges' AS check_name,
       count(*) AS problem_count,
       coalesce(jsonb_agg(name),'[]'::jsonb) AS details
FROM leaked;

WITH verification_sequences(name) AS (
  VALUES
    ('arcade_verification_period_games_id_seq'),('arcade_verification_provisional_entries_id_seq'),
    ('arcade_verification_sessions_id_seq'),('arcade_verification_attempts_id_seq'),
    ('arcade_verification_official_results_id_seq'),('arcade_verification_corrections_id_seq'),
    ('arcade_verification_audit_events_id_seq')
), leaked AS (
  SELECT name
  FROM verification_sequences
  WHERE has_sequence_privilege('authenticated','public.'||name,'USAGE')
     OR has_sequence_privilege('anon','public.'||name,'USAGE')
)
SELECT 'direct_client_sequence_privileges' AS check_name,
       count(*) AS problem_count,
       coalesce(jsonb_agg(name),'[]'::jsonb) AS details
FROM leaked;

WITH expected_rpc(signature) AS (
  VALUES
    ('public.student_get_arcade_verification_state(text)'),
    ('public.student_create_arcade_verification_run(bigint,uuid)'),
    ('public.teacher_freeze_arcade_monthly_period(bigint)'),
    ('public.teacher_get_arcade_verification_overview(bigint,text)'),
    ('public.teacher_start_arcade_verification_session(bigint,text,integer)'),
    ('public.teacher_end_arcade_verification_session(bigint)'),
    ('public.teacher_cancel_arcade_verification_run(bigint,text)'),
    ('public.teacher_restore_arcade_verification_attempt(bigint,text)'),
    ('public.teacher_reset_arcade_verification_session(bigint,text)'),
    ('public.teacher_set_arcade_verification_correction(bigint,text,integer,bigint,text)')
)
SELECT 'public_rpc_acl' AS check_name,
       count(*) FILTER (WHERE to_regprocedure(signature) IS NULL OR NOT has_function_privilege('authenticated',signature,'EXECUTE')) AS problem_count,
       jsonb_agg(signature) FILTER (WHERE to_regprocedure(signature) IS NULL OR NOT has_function_privilege('authenticated',signature,'EXECUTE')) AS details
FROM expected_rpc;

WITH internal_rpc(signature) AS (
  VALUES
    ('public.arcade_refresh_verification_readiness(integer,bigint)'),
    ('public.arcade_finalize_verification_session(bigint)'),
    ('public.arcade_capture_verification_attempt(bigint)'),
    ('public.arcade_verification_test_fixture_cleanup()'),
    ('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)'),
    ('public.arcade_resolve_period_top10(integer,bigint,bigint)')
)
SELECT 'internal_rpc_not_exposed' AS check_name,
       count(*) FILTER (WHERE has_function_privilege('authenticated',signature,'EXECUTE')) AS problem_count,
       jsonb_agg(signature) FILTER (WHERE has_function_privilege('authenticated',signature,'EXECUTE')) AS details
FROM internal_rpc;

SELECT 'game01_policy' AS check_name,
       CASE WHEN count(*)=1 THEN 0 ELSE 1 END AS problem_count,
       jsonb_agg(jsonb_build_object('game_code',g.code,'enabled',c.is_enabled,'target_rank_count',c.target_rank_count,'threshold_percent',c.threshold_percent,'max_attempts',c.max_attempts)) AS details
FROM public.arcade_verification_game_configs c
JOIN public.arcade_games g ON g.id=c.game_id
WHERE g.code='focus_reaction_01' AND c.is_enabled AND c.target_rank_count=10 AND c.threshold_percent=80 AND c.max_attempts=3;

SELECT 'guild2_cap_still_locked' AS check_name,
       ((CASE WHEN EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.guild2_individual_contributions'::regclass AND c.conname='guild2_contribution_arcade_applied_check' AND pg_get_constraintdef(c.oid) ILIKE '%90%') THEN 0 ELSE 1 END)
        +(CASE WHEN EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.guild2_individual_contributions'::regclass AND c.conname='guild2_contribution_final_range_check' AND pg_get_constraintdef(c.oid) ILIKE '%990%') THEN 0 ELSE 1 END)) AS problem_count,
       jsonb_build_object('cap_90',true,'final_total_max_990',true) AS details;

SELECT 'migration_did_not_reclassify_legacy_runs' AS check_name,
       count(*) AS problem_count,
       jsonb_build_object('nonstandard_run_count',count(*)) AS details
FROM public.arcade_runs
WHERE run_context<>'STANDARD';

-- Every verification FK should have an index whose leading columns match the FK columns.
WITH fk AS (
  SELECT c.oid,c.conname,c.conrelid,c.conkey,n.nspname,cl.relname,
         array_agg(a.attname ORDER BY u.ord) AS fk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=cl.relnamespace
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY u(attnum,ord) ON true
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum
  WHERE c.contype='f'
    AND n.nspname='public'
    AND cl.relname LIKE 'arcade_verification_%'
  GROUP BY c.oid,c.conname,c.conrelid,c.conkey,n.nspname,cl.relname
), missing AS (
  SELECT fk.relname,fk.conname,fk.fk_cols
  FROM fk
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid=fk.conrelid
      AND i.indisvalid
      AND i.indisready
      AND (
        SELECT array_agg(attnum ORDER BY ord)
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY x(attnum,ord)
        WHERE ord <= cardinality(fk.conkey)
      ) = fk.conkey
  )
)
SELECT 'verification_fk_leading_indexes' AS check_name,
       count(*) AS problem_count,
       coalesce(jsonb_agg(jsonb_build_object('table',relname,'fk',conname,'columns',fk_cols)),'[]'::jsonb) AS details
FROM missing;
