-- POSTCHECK: 모험가 도구함 v1 — SQL Editor에서 실행 가능한 구조 점검 (교사 로그인 없이)
-- 모든 행의 ok 가 true 여야 합니다.
with t(name) as (values ('toolbox_activities'),('toolbox_buzzer_presses'),('toolbox_buzzer_locks'),('toolbox_score_events'),
  ('toolbox_vote_ballots'),('toolbox_cards'),('toolbox_rosters'),('toolbox_pulse'))
select 'table+rls: ' || t.name as check, coalesce(c.relrowsecurity, false) as ok
from t left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
union all
select 'realtime publication: toolbox_pulse', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'toolbox_pulse')
union all
select 'policy: toolbox_pulse_read', exists (select 1 from pg_policies where tablename = 'toolbox_pulse' and policyname = 'toolbox_pulse_read')
union all
select 'policy: toolbox_rosters_teacher', exists (select 1 from pg_policies where tablename = 'toolbox_rosters' and policyname = 'toolbox_rosters_teacher')
union all
select 'no anon/authenticated direct write on activities/ballots/cards',
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
    and table_name in ('toolbox_activities','toolbox_vote_ballots','toolbox_cards','toolbox_buzzer_presses','toolbox_score_events','toolbox_pulse')
    and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE'))
union all
select 'public rpc count = 19', (select count(*) = 19 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'teacher\_toolbox\_%' or p.proname like 'student\_toolbox\_%'))
union all
select 'all public rpc are security definer with fixed search_path',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'teacher\_toolbox\_%' or p.proname like 'student\_toolbox\_%')
      and (not p.prosecdef or p.proconfig is null))
union all
select 'anon cannot execute toolbox rpc',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'teacher\_toolbox\_%' or p.proname like 'student\_toolbox\_%')
      and has_function_privilege('anon', p.oid, 'EXECUTE'))
union all
select 'authenticated cannot execute internal brand_toolbox helpers',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'brand_toolbox' and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
union all
select 'existing tables untouched: no toolbox trigger on students/guilds/attendances',
  not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname in ('students','guilds','guild_members','attendances') and tg.tgname ilike '%toolbox%');
