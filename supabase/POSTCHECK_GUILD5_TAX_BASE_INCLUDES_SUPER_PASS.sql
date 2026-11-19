-- SQL Editor에서 실행하는 구조 확인용 postcheck (로그인 교사 권한이 필요한 RPC는 호출하지 않음)
-- 대상: 20261119_01_guild5_tax_base_includes_super_pass.sql

-- 1) 컬럼 3개가 있어야 한다 (3행)
select column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name='guild5_territory_tax_assessments'
  and column_name in ('super_pass_count','super_pass_equivalent_value','includes_super_pass')
order by column_name;

-- 2) 과세 helper: SECURITY DEFINER + search_path 고정, 본문에 슈퍼패스 환산이 들어 있어야 한다
select p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       p.proconfig as config,
       position('guild5_super_pass_unit_value' in pg_get_functiondef(p.oid))>0 as uses_super_pass_unit
from pg_proc p
where p.pronamespace='public'::regnamespace
  and p.proname='guild5_assess_result_with_rate_internal';

-- 3) 학생/익명이 실행할 수 없어야 한다 (authenticated, anon, PUBLIC 이 보이면 안 됨 → 0행이어야 정상)
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema='public'
  and routine_name='guild5_assess_result_with_rate_internal'
  and grantee in ('PUBLIC','anon','authenticated');

-- 4) 기존(2026-10) 과세 기록은 그대로 'GOLD만 과세'로 남아 있어야 한다
select includes_super_pass, count(*) as rows_n, sum(tax_amount) as assessed
from public.guild5_territory_tax_assessments
where voided_at is null
group by includes_super_pass
order by includes_super_pass;
