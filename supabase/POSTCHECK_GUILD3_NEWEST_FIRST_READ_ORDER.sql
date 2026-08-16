-- Guild3 newest-first read order postcheck
SELECT
  position('sort_visible_at DESC' in pg_get_functiondef(to_regprocedure('public.student_get_guild3_mission_board()'))) > 0 AS student_newest_first_installed,
  position('coalesce(mission.published_at, mission.created_at) DESC' in pg_get_functiondef(to_regprocedure('public.teacher_list_guild3_missions()'))) > 0 AS teacher_newest_first_installed,
  has_function_privilege('authenticated', 'public.student_get_guild3_mission_board()', 'EXECUTE') AS student_execute_ok,
  has_function_privilege('authenticated', 'public.teacher_list_guild3_missions()', 'EXECUTE') AS teacher_execute_ok;
