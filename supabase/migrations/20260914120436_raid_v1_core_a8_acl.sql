-- 10. ACL
-- ============================================================================

-- Internal helpers: no direct authenticated execution.
REVOKE ALL ON FUNCTION public.raid_teacher_require_classroom(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_teacher_require_raid(BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_current_student_for_raid(BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_element_power_snapshot(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_snapshot_student(BIGINT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_finalize_results(BIGINT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.raid_teacher_require_classroom(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.raid_teacher_require_raid(BIGINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.raid_current_student_for_raid(BIGINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.raid_element_power_snapshot(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.raid_snapshot_student(BIGINT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.raid_finalize_results(BIGINT)
  TO service_role;

-- Teacher RPC.
REVOKE ALL ON FUNCTION public.teacher_create_raid(INTEGER, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_update_raid(BIGINT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_save_raid_phase(BIGINT, SMALLINT, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_open_raid_lobby(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_start_raid(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_pause_raid(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_resume_raid(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_end_raid(BIGINT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_control_board(INTEGER)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_live_dashboard(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_raid_chat_enabled(BIGINT, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_delete_raid_lobby_message(BIGINT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_create_raid(INTEGER, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_update_raid(BIGINT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_save_raid_phase(BIGINT, SMALLINT, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_open_raid_lobby(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_start_raid(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_pause_raid(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_resume_raid(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_end_raid(BIGINT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_control_board(INTEGER)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_live_dashboard(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_set_raid_chat_enabled(BIGINT, BOOLEAN)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_delete_raid_lobby_message(BIGINT)
  TO authenticated, service_role;

-- Student RPC.
REVOKE ALL ON FUNCTION public.get_active_raid()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_raid_lobby_snapshot(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_raid_lobby_message(BIGINT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_raid_battle_state(BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_raid_tap_batch(BIGINT, UUID, JSONB)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_raid_result(BIGINT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_active_raid()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_raid_lobby_snapshot(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_raid_lobby_message(BIGINT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_raid_battle_state(BIGINT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_raid_tap_batch(BIGINT, UUID, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_raid_result(BIGINT)
  TO authenticated, service_role;
