-- =====================================================================
-- 퀴즈 로얄 v1 — 되돌리기 (주의: 퀴즈 기록이 모두 지워집니다)
-- ---------------------------------------------------------------------
-- 이 파일은 퀴즈 로얄이 새로 만든 객체만 지운다. 기존 표·함수·도구함은 건드리지 않는다.
-- 실제 경기 기록을 남겨야 하면 실행하지 말고, 화면만 이전 버전으로 되돌린다(Git revert).
-- 미디어 파일(이미지·영상)은 SQL로 지울 수 없으므로 Supabase 대시보드 → Storage → quiz-media 에서
-- 파일을 먼저 비운 뒤 실행한다(파일이 남아 있으면 버킷만 남겨 둔다).
-- 전체가 한 트랜잭션이라 중간에 실패하면 아무것도 지워지지 않는다.
-- =====================================================================
begin;
-- 1) 정책(함수를 참조하므로 먼저)
drop policy if exists quiz_media_read on storage.objects;
drop policy if exists quiz_media_insert on storage.objects;
drop policy if exists quiz_media_update on storage.objects;
drop policy if exists quiz_media_delete on storage.objects;
drop policy if exists quiz_pulse_read on public.quiz_pulse;

-- 2) Realtime 등록 해제
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'quiz_pulse') then
    execute 'alter publication supabase_realtime drop table public.quiz_pulse';
  end if;
end $$;

-- 3) 함수(표 형식을 참조하므로 표보다 먼저)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and (p.proname like 'teacher\_quiz\_%' or p.proname like 'student\_quiz\_%'
             or p.proname in ('quiz_pulse_readable','quiz_media_readable','quiz_media_writable')))
       or n.nspname = 'brand_quiz'
  loop
    execute format('drop function if exists %s', f.sig);
  end loop;
end $$;

-- 4) 표
drop table if exists public.quiz_pulse;
drop table if exists public.quiz_audit;
drop table if exists public.quiz_answers;
alter table if exists public.quiz_events drop constraint if exists quiz_events_current_question_fkey;
drop table if exists public.quiz_questions;
drop table if exists public.quiz_roster;
drop table if exists public.quiz_event_guilds;
drop table if exists public.quiz_events;
drop schema if exists brand_quiz;

-- 5) 빈 버킷만 지운다
delete from storage.buckets where id = 'quiz-media' and not exists (select 1 from storage.objects where bucket_id = 'quiz-media');
commit;
notify pgrst, 'reload schema';
