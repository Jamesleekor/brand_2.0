-- B.R.A.N.D 2.0 Guild 1 post-check
-- 모든 ok가 true여야 하며, 아래의 duplicate / missing-element 질의는 0행이 정상이다.

SELECT 'guild_membership_events' AS object_name, to_regclass('public.guild_membership_events') IS NOT NULL AS ok
UNION ALL SELECT 'guild_sessions', to_regclass('public.guild_sessions') IS NOT NULL
UNION ALL SELECT 'guild_session_participants', to_regclass('public.guild_session_participants') IS NOT NULL
UNION ALL SELECT 'teacher_create_guild', to_regprocedure('public.teacher_create_guild(text,text,text,text,text,boolean)') IS NOT NULL
UNION ALL SELECT 'teacher_update_guild_profile', to_regprocedure('public.teacher_update_guild_profile(bigint,text,text,text,text,text,boolean)') IS NOT NULL
UNION ALL SELECT 'teacher_assign_guild_member', to_regprocedure('public.teacher_assign_guild_member(integer,bigint,text,text,timestamp with time zone)') IS NOT NULL
UNION ALL SELECT 'teacher_remove_guild_member', to_regprocedure('public.teacher_remove_guild_member(integer,text,timestamp with time zone)') IS NOT NULL
UNION ALL SELECT 'teacher_create_guild_season', to_regprocedure('public.teacher_create_guild_season(integer,text,integer,date,date,boolean)') IS NOT NULL
UNION ALL SELECT 'teacher_create_guild_session', to_regprocedure('public.teacher_create_guild_session(integer,text,date,text)') IS NOT NULL
UNION ALL SELECT 'teacher_record_guild_session_attendance', to_regprocedure('public.teacher_record_guild_session_attendance(bigint,jsonb)') IS NOT NULL
UNION ALL SELECT 'teacher_guild1_health_check', to_regprocedure('public.teacher_guild1_health_check(integer)') IS NOT NULL;

-- 0행 정상: 학생당 활성 membership은 정확히 최대 1개여야 한다.
SELECT student_id, count(*) AS active_memberships
FROM public.guild_members
WHERE left_at IS NULL
GROUP BY student_id
HAVING count(*) > 1;

-- 0행 권장: 활성 길드는 속성이 있어야 새 학생 배정이 가능하다.
SELECT id, name, classroom_id
FROM public.guilds
WHERE coalesce(is_active,true) AND element_code IS NULL
ORDER BY id;


-- 참고: 전출일이 있는데 활성 membership이 남은 학생. 교사 길드 운영에서 소속 종료 권장.
SELECT s.id AS student_id, s.name, s.transferred_at, gm.guild_id, gm.id AS membership_id
FROM public.students s
JOIN public.guild_members gm ON gm.student_id=s.id AND gm.left_at IS NULL
WHERE s.transferred_at IS NOT NULL
ORDER BY s.transferred_at, s.id;

-- 설치 환경에 supabase_realtime publication이 있다면 아래 6개가 모두 보여야 한다.
SELECT p.tablename
FROM pg_publication_tables p
WHERE p.pubname='supabase_realtime'
  AND p.schemaname='public'
  AND p.tablename IN ('guilds','guild_members','guild_seasons','guild_membership_events','guild_sessions','guild_session_participants')
ORDER BY p.tablename;
