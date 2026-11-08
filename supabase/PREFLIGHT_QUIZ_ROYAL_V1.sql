-- =====================================================================
-- 퀴즈 로얄 v1 — 적용 전 점검 (읽기 전용, SQL Editor에서 실행)
-- 모든 행의 ok 가 true 여야 APPLY_QUIZ_ROYAL_V1.sql 을 실행한다.
-- =====================================================================
select * from (values
  ('classrooms 표', to_regclass('public.classrooms') is not null),
  ('students.user_id/role/transferred_at/is_test_account', (select count(*) = 4 from information_schema.columns
     where table_schema = 'public' and table_name = 'students' and column_name in ('user_id','role','transferred_at','is_test_account'))),
  ('guilds.is_active/logo_url', (select count(*) = 2 from information_schema.columns
     where table_schema = 'public' and table_name = 'guilds' and column_name in ('is_active','logo_url'))),
  ('guild_members.left_at', exists (select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'guild_members' and column_name = 'left_at')),
  ('is_teacher_or_admin()', to_regprocedure('public.is_teacher_or_admin()') is not null),
  ('current_classroom_id()', to_regprocedure('public.current_classroom_id()') is not null),
  ('is_classroom_member(integer)', to_regprocedure('public.is_classroom_member(integer)') is not null),
  ('도구함 신호 함수 brand_toolbox.bump (있으면 학생 도구함 입구 신호 사용)', to_regprocedure('brand_toolbox.bump(integer,boolean,jsonb)') is not null),
  ('storage.buckets 표', to_regclass('storage.buckets') is not null),
  ('supabase_realtime publication', exists (select 1 from pg_publication where pubname = 'supabase_realtime')),
  ('이름 충돌 없음: quiz_* 표', not exists (select 1 from information_schema.tables where table_schema = 'public'
     and table_name in ('quiz_events','quiz_event_guilds','quiz_roster','quiz_questions','quiz_answers','quiz_audit','quiz_pulse'))),
  ('이름 충돌 없음: brand_quiz 스키마', not exists (select 1 from pg_namespace where nspname = 'brand_quiz')),
  ('이름 충돌 없음: teacher_quiz_*/student_quiz_* 함수', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%' or p.proname like 'quiz\_%'))),
  ('이름 충돌 없음: quiz-media 버킷', not exists (select 1 from storage.buckets where id = 'quiz-media'))
) as t(item, ok);
