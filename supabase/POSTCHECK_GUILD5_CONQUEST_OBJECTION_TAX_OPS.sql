-- SQL Editor-safe structural postcheck for 20261102_02_guild5_conquest_objection_tax_ops
-- (교사 로그인 RPC는 실행하지 않는다. 구조·권한만 확인)

SELECT 'tables' AS check_name,
       to_regclass('public.guild5_territory_rate_settlements') IS NOT NULL AS settlements,
       to_regclass('public.guild5_territory_objections') IS NOT NULL AS objections,
       to_regclass('public.guild5_territory_tax_distributions') IS NOT NULL AS distributions,
       to_regclass('public.guild5_territory_tax_distribution_lines') IS NOT NULL AS distribution_lines;

SELECT 'assessment columns' AS check_name, string_agg(column_name, ', ' ORDER BY column_name) AS columns
FROM information_schema.columns
WHERE table_schema='public' AND table_name='guild5_territory_tax_assessments'
  AND column_name IN ('voided_at','void_reason','voided_by_user_id','void_refund_amount','objection_surcharge_pp','rate_settlement_id');

SELECT 'live unique index' AS check_name, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND indexname IN ('ux_g5_tax_assessment_live_result','ux_g5_objection_one_live_per_territory');

SELECT 'old unique constraint removed' AS check_name,
       NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='guild5_territory_tax_assessments_auction_result_id_key') AS ok;

SELECT 'grants' AS check_name, routine_name, string_agg(grantee, ', ' ORDER BY grantee) AS grantees
FROM information_schema.routine_privileges
WHERE routine_schema='public'
  AND routine_name IN (
    'teacher_get_guild5_conquest_ops','teacher_get_guild5_conquest_history','teacher_declare_guild5_territory_rate',
    'teacher_file_guild5_territory_objection','teacher_withdraw_guild5_territory_objection','teacher_record_guild5_objection_vote',
    'teacher_finalize_guild5_territory_rate','teacher_distribute_guild5_territory_tax','teacher_refund_guild5_prior_territory_tax',
    'guild5_refund_territory_tax_assessment_internal','guild5_assess_result_with_rate_internal','guild5_build_conquest_turn_ops',
    'guild5_require_current_final_version'
  )
GROUP BY routine_name
ORDER BY routine_name;
-- 기대값: teacher_* 함수는 authenticated 포함, guild5_*_internal / build / require 함수는 authenticated·anon 없음

SELECT 'immediate tax trigger is no-op' AS check_name,
       position('guild5_assess_auction_result_territory_tax' IN pg_get_functiondef('public.guild5_assess_sold_auction_item_tax_trigger()'::regprocedure))=0 AS ok;

SELECT 'choose_territory no longer taxes' AS check_name,
       position('DEFERRED_UNTIL_RATE_FINALIZED' IN pg_get_functiondef('public.teacher_choose_guild5_territory(bigint,bigint)'::regprocedure))>0 AS ok;
