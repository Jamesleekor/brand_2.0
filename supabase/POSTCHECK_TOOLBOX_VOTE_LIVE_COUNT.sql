-- POSTCHECK: 한 표씩 개표 방송 v1 (SQL Editor-safe, 읽기만 함)
-- 모든 행의 ok 가 true 이면 정상입니다.
select '1. 개표 순서 표 존재 + RLS 켜짐' as check_name,
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'toolbox_vote_count_order' and c.relrowsecurity) as ok
union all
select '2. 학생·익명은 개표 순서 표를 직접 못 읽음',
       not has_table_privilege('authenticated', 'public.toolbox_vote_count_order', 'select')
       and not has_table_privilege('anon', 'public.toolbox_vote_count_order', 'select')
union all
select '3. 내부 함수 vote_count_view 존재 + 외부 실행 막힘',
       to_regprocedure('brand_toolbox.vote_count_view(public.toolbox_activities)') is not null
       and not has_function_privilege('authenticated', 'brand_toolbox.vote_count_view(public.toolbox_activities)', 'execute')
union all
select '4. teacher_toolbox_vote 에 개표 동작 포함 (signature 1개)',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'teacher_toolbox_vote') = 1
       and pg_get_functiondef('public.teacher_toolbox_vote(bigint,text,jsonb)'::regprocedure) like '%COUNT_START%'
union all
select '5. teacher_toolbox_broadcast 에 개표 현황 포함 (signature 1개)',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'teacher_toolbox_broadcast') = 1
       and pg_get_functiondef('public.teacher_toolbox_broadcast(bigint)'::regprocedure) like '%vote_count_view%'
union all
select '6. 로그인 사용자 RPC 실행 권한 유지',
       has_function_privilege('authenticated', 'public.teacher_toolbox_vote(bigint,text,jsonb)', 'execute')
       and has_function_privilege('authenticated', 'public.teacher_toolbox_broadcast(bigint)', 'execute')
       and not has_function_privilege('anon', 'public.teacher_toolbox_vote(bigint,text,jsonb)', 'execute');
