-- Guild 1.1 element model postcheck
SELECT 'guild_level_element_removed' AS check_name,
       NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='guilds' AND column_name='element_code'
       ) AS ok;

SELECT 'new_create_signature' AS check_name,
       to_regprocedure('public.teacher_create_guild(text,text,text,text,boolean)') IS NOT NULL AS ok;

SELECT 'new_update_signature' AS check_name,
       to_regprocedure('public.teacher_update_guild_profile(bigint,text,text,text,text,boolean)') IS NOT NULL AS ok;

SELECT 'member_assignment_signature' AS check_name,
       to_regprocedure('public.teacher_assign_guild_member(integer,bigint,text,text,timestamp with time zone)') IS NOT NULL AS ok;

SELECT public.teacher_guild1_health_check(public.current_classroom_id()) AS guild1_health;
