-- B.R.A.N.D 2.0 SECOND_JOB-A Production discovery
-- 2026-08-17
-- READ ONLY: metadata/function inspection only. No DDL/DML/RPC mutations.
WITH
secondary_tables AS (
  SELECT t.table_name
  FROM information_schema.tables t
  WHERE t.table_schema='public'
    AND (
      t.table_name ILIKE '%secondary%job%'
      OR t.table_name ILIKE '%job%catalog%'
      OR t.table_name ILIKE '%job%definition%'
    )
),
app_columns AS (
  SELECT ordinal_position,column_name,data_type,udt_name,is_nullable,column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='secondary_job_applications'
  ORDER BY ordinal_position
),
job_columns AS (
  SELECT ordinal_position,column_name,data_type,udt_name,is_nullable,column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='secondary_jobs'
  ORDER BY ordinal_position
),
app_constraints AS (
  SELECT c.conname,pg_get_constraintdef(c.oid,true) AS definition
  FROM pg_constraint c
  WHERE c.conrelid=to_regclass('public.secondary_job_applications')
  ORDER BY c.conname
),
job_constraints AS (
  SELECT c.conname,pg_get_constraintdef(c.oid,true) AS definition
  FROM pg_constraint c
  WHERE c.conrelid=to_regclass('public.secondary_jobs')
  ORDER BY c.conname
),
job_functions AS (
  SELECT p.oid,p.proname,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         pg_get_function_result(p.oid) AS result_type,
         p.prosecdef AS security_definer,
         pg_get_userbyid(p.proowner) AS owner,
         coalesce(p.proacl::text,'<default ACL>') AS acl,
         pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('apply_secondary_job','approve_secondary_job')
  ORDER BY p.proname,p.oid
),
rls AS (
  SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('secondary_job_applications','secondary_jobs')
),
policies AS (
  SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('secondary_job_applications','secondary_jobs')
  ORDER BY tablename,policyname
),
tier_columns AS (
  SELECT table_name,column_name,data_type,udt_name
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('students','wallets')
    AND column_name IN ('cached_tier','tier','bv','student_id','classroom_id')
  ORDER BY table_name,ordinal_position
),
checks AS (
  SELECT 10 AS check_order,'required_objects'::text AS check_name,
         CASE WHEN to_regclass('public.secondary_job_applications') IS NOT NULL
                    AND to_regclass('public.secondary_jobs') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END AS status,
         jsonb_build_object(
           'secondary_job_applications',to_regclass('public.secondary_job_applications')::text,
           'secondary_jobs',to_regclass('public.secondary_jobs')::text,
           'apply_secondary_job_overloads',(SELECT count(*) FROM job_functions WHERE proname='apply_secondary_job'),
           'approve_secondary_job_overloads',(SELECT count(*) FROM job_functions WHERE proname='approve_secondary_job')
         ) AS detail

  UNION ALL
  SELECT 20,'related_job_tables','INFO',
         jsonb_build_object('tables',coalesce((SELECT jsonb_agg(table_name ORDER BY table_name) FROM secondary_tables),'[]'::jsonb))

  UNION ALL
  SELECT 30,'secondary_job_applications_columns',
         CASE WHEN EXISTS(SELECT 1 FROM app_columns) THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('columns',coalesce((SELECT jsonb_agg(to_jsonb(app_columns) ORDER BY ordinal_position) FROM app_columns),'[]'::jsonb))

  UNION ALL
  SELECT 40,'secondary_jobs_columns',
         CASE WHEN EXISTS(SELECT 1 FROM job_columns) THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('columns',coalesce((SELECT jsonb_agg(to_jsonb(job_columns) ORDER BY ordinal_position) FROM job_columns),'[]'::jsonb))

  UNION ALL
  SELECT 50,'constraints','INFO',jsonb_build_object(
         'applications',coalesce((SELECT jsonb_agg(to_jsonb(app_constraints) ORDER BY conname) FROM app_constraints),'[]'::jsonb),
         'jobs',coalesce((SELECT jsonb_agg(to_jsonb(job_constraints) ORDER BY conname) FROM job_constraints),'[]'::jsonb)
       )

  UNION ALL
  SELECT 60,'rls_and_policies','INFO',jsonb_build_object(
         'rls',coalesce((SELECT jsonb_agg(to_jsonb(rls) ORDER BY table_name) FROM rls),'[]'::jsonb),
         'policies',coalesce((SELECT jsonb_agg(to_jsonb(policies) ORDER BY tablename,policyname) FROM policies),'[]'::jsonb)
       )

  UNION ALL
  SELECT 70,'rpc_contracts',
         CASE WHEN (SELECT count(*) FROM job_functions WHERE proname='apply_secondary_job')>=1
                   AND (SELECT count(*) FROM job_functions WHERE proname='approve_secondary_job')>=1
              THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object('functions',coalesce((SELECT jsonb_agg(jsonb_build_object(
           'name',proname,
           'identity_arguments',identity_arguments,
           'result_type',result_type,
           'security_definer',security_definer,
           'owner',owner,
           'acl',acl
         ) ORDER BY proname,oid) FROM job_functions),'[]'::jsonb))

  UNION ALL
  SELECT 80,'rpc_definitions','INFO',
         jsonb_build_object('functions',coalesce((SELECT jsonb_agg(jsonb_build_object(
           'name',proname,
           'identity_arguments',identity_arguments,
           'definition',definition
         ) ORDER BY proname,oid) FROM job_functions),'[]'::jsonb))

  UNION ALL
  SELECT 90,'tier_dependencies',
         CASE WHEN to_regprocedure('public.calculate_tier_from_bv(bigint)') IS NOT NULL
                    AND to_regclass('public.wallets') IS NOT NULL
                    AND to_regclass('public.students') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         jsonb_build_object(
           'calculate_tier_from_bv',to_regprocedure('public.calculate_tier_from_bv(bigint)')::text,
           'columns',coalesce((SELECT jsonb_agg(to_jsonb(tier_columns)) FROM tier_columns),'[]'::jsonb),
           'locked_unlock_tier','금 광석',
           'locked_unlock_bv',20000
         )

  UNION ALL
  SELECT 100,'indexes','INFO',jsonb_build_object(
    'indexes',coalesce((
      SELECT jsonb_agg(jsonb_build_object('table',tablename,'index',indexname,'definition',indexdef) ORDER BY tablename,indexname)
      FROM pg_indexes
      WHERE schemaname='public' AND tablename IN ('secondary_job_applications','secondary_jobs')
    ),'[]'::jsonb)
  )
)
SELECT * FROM checks ORDER BY check_order;
