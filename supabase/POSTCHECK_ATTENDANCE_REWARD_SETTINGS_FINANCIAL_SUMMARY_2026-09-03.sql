SET ROLE postgres;

-- B.R.A.N.D 2.0 — Attendance reward settings + financial summary POSTCHECK
-- READ ONLY

SELECT jsonb_build_object(
  'attendance_financial_postcheck',jsonb_build_object(
    'baseline',jsonb_build_object(
      'table_present',to_regclass('public.student_financial_migration_baselines') IS NOT NULL,
      'classroom_1_rows',(SELECT count(*) FROM public.student_financial_migration_baselines WHERE classroom_id=1),
      'tax_baseline_sum',(SELECT coalesce(sum(tax_paid_baseline),0) FROM public.student_financial_migration_baselines WHERE classroom_id=1),
      'donation_baseline_sum',(SELECT coalesce(sum(donation_total_baseline),0) FROM public.student_financial_migration_baselines WHERE classroom_id=1),
      'official_rows',(SELECT count(*) FROM public.student_financial_migration_baselines b WHERE b.classroom_id=1 AND public.is_official_participant(b.student_id)),
      'sample',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',s.name,'tax',b.tax_paid_baseline,'donation',b.donation_total_baseline) ORDER BY s.id),'[]'::jsonb)
                FROM public.student_financial_migration_baselines b JOIN public.students s ON s.id=b.student_id WHERE b.classroom_id=1 AND s.name IN ('김나연','류은우','한서현'))
    ),
    'student_summary_rpc',jsonb_build_object(
      'present',to_regprocedure('public.student_get_financial_lifetime_summary()') IS NOT NULL,
      'security_definer',(SELECT p.prosecdef FROM pg_proc p WHERE p.oid='public.student_get_financial_lifetime_summary()'::regprocedure),
      'authenticated_execute',has_function_privilege('authenticated','public.student_get_financial_lifetime_summary()','EXECUTE'),
      'anon_execute',has_function_privilege('anon','public.student_get_financial_lifetime_summary()','EXECUTE'),
      'uses_tax_amount',position('tax_amount' in pg_get_functiondef('public.student_get_financial_lifetime_summary()'::regprocedure))>0,
      'uses_donation',position('DONATION' in pg_get_functiondef('public.student_get_financial_lifetime_summary()'::regprocedure))>0,
      'uses_cutover_tx',position('cutover_transaction_id' in pg_get_functiondef('public.student_get_financial_lifetime_summary()'::regprocedure))>0
    ),
    'attendance_reward_admin',jsonb_build_object(
      'get_present',to_regprocedure('public.teacher_get_attendance_reward_settings(integer)') IS NOT NULL,
      'update_present',to_regprocedure('public.teacher_update_attendance_reward_settings(integer,jsonb)') IS NOT NULL,
      'get_auth_execute',has_function_privilege('authenticated','public.teacher_get_attendance_reward_settings(integer)','EXECUTE'),
      'update_auth_execute',has_function_privilege('authenticated','public.teacher_update_attendance_reward_settings(integer,jsonb)','EXECUTE'),
      'get_anon_execute',has_function_privilege('anon','public.teacher_get_attendance_reward_settings(integer)','EXECUTE'),
      'update_anon_execute',has_function_privilege('anon','public.teacher_update_attendance_reward_settings(integer,jsonb)','EXECUTE'),
      'current_setting',(SELECT setting_value FROM public.classroom_settings WHERE classroom_id=1 AND setting_key='attendance_streak_rewards')
    )
  )
) AS result;

RESET ROLE;
