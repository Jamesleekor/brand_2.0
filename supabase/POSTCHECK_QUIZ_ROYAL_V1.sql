-- =====================================================================
-- 퀴즈 로얄 v1 — 적용 후 구조 점검 (SQL Editor에서 실행, 읽기 전용)
-- 모든 행의 ok 가 true 여야 한다. 교사·학생 로그인 동작 점검은 화면 E2E 확인표로 한다.
-- =====================================================================
select * from (values
  ('표 7개 생성', (select count(*) = 7 from information_schema.tables where table_schema = 'public'
     and table_name in ('quiz_events','quiz_event_guilds','quiz_roster','quiz_questions','quiz_answers','quiz_audit','quiz_pulse'))),
  ('표 7개 RLS 켜짐', (select count(*) = 7 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname like 'quiz\_%' and c.relkind = 'r' and c.relrowsecurity)),
  ('학생·익명이 문제/답안/대회 표를 직접 못 읽음', not has_table_privilege('authenticated', 'public.quiz_questions', 'SELECT')
     and not has_table_privilege('authenticated', 'public.quiz_answers', 'SELECT')
     and not has_table_privilege('authenticated', 'public.quiz_events', 'SELECT')
     and not has_table_privilege('anon', 'public.quiz_questions', 'SELECT')),
  ('신호 표만 읽기 허용 + 정책', has_table_privilege('authenticated', 'public.quiz_pulse', 'SELECT')
     and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quiz_pulse')),
  ('신호 표 Realtime 등록', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'quiz_pulse')),
  ('공개 함수 수(교사 21 + 학생 3)', (select count(*) = 24 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%'))),
  ('공개 함수 모두 SECURITY DEFINER + search_path', (select bool_and(p.prosecdef) and bool_and(coalesce(p.proconfig::text, '') like '%search_path%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%'))),
  ('공개 함수 anon 실행 불가', (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%' or p.proname like 'quiz\_%'))),
  ('내부 함수(brand_quiz) authenticated 실행 불가', (select coalesce(bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE')), true)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'brand_quiz')),
  ('미디어 버킷(비공개, 50MB)', exists (select 1 from storage.buckets where id = 'quiz-media' and public = false and file_size_limit = 52428800)),
  ('미디어 정책 4개', (select count(*) = 4 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'quiz\_media\_%')),
  ('기존 도구함 신호 표는 그대로(S/T)', coalesce((select pg_get_constraintdef(oid) like '%''S''%''T''%' from pg_constraint where conname = 'toolbox_pulse_audience_check'), true))
) as t(item, ok);
