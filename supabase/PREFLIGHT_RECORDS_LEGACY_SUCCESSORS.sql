-- B.R.A.N.D 2.0 Records Legacy Successors V1 preflight
select
  to_regclass('public.records_legacy_events') as events_table,
  to_regclass('public.records_legacy_successors') as successors_table,
  to_regprocedure('public.student_get_records_legacy_successor_state()') as student_state_rpc,
  to_regprocedure('public.student_discover_records_legacy_seal()') as discover_rpc,
  to_regprocedure('public.student_confirm_records_legacy_seal()') as confirm_rpc,
  to_regprocedure('public.student_register_records_legacy_successor(text,text)') as register_rpc,
  to_regprocedure('public.teacher_get_records_legacy_successors()') as teacher_board_rpc,
  to_regprocedure('public.teacher_reset_records_legacy_successor(integer)') as teacher_reset_rpc,
  to_regprocedure('public.teacher_lock_records_legacy_successors()') as teacher_lock_rpc,
  to_regprocedure('public.teacher_unlock_records_legacy_successors()') as teacher_unlock_rpc;
