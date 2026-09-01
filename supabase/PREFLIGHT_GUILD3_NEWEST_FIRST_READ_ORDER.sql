-- Guild3 newest-first read order preflight (READ ONLY)
SELECT
  to_regprocedure('public.student_get_guild3_mission_board()') IS NOT NULL AS student_board_rpc_exists,
  to_regprocedure('public.teacher_list_guild3_missions()') IS NOT NULL AS teacher_list_rpc_exists,
  to_regclass('public.guild3_missions') IS NOT NULL AS missions_table_exists;

SELECT id, title, lifecycle_state, created_at, published_at, due_at
FROM public.guild3_missions
WHERE classroom_id = public.current_classroom_id()
ORDER BY coalesce(published_at, created_at) DESC, id DESC
LIMIT 20;
