-- B.R.A.N.D 2.0 Records Legacy Successors V1 strict postcheck
select
  to_regclass('public.records_legacy_events') is not null as events_table_ok,
  to_regclass('public.records_legacy_successors') is not null as successors_table_ok,
  to_regprocedure('public.student_get_records_legacy_successor_state()') is not null as student_state_ok,
  to_regprocedure('public.student_discover_records_legacy_seal()') is not null as student_discover_ok,
  to_regprocedure('public.student_confirm_records_legacy_seal()') is not null as student_confirm_ok,
  to_regprocedure('public.student_register_records_legacy_successor(text,text)') is not null as student_register_ok,
  to_regprocedure('public.teacher_get_records_legacy_successors()') is not null as teacher_board_ok,
  to_regprocedure('public.teacher_reset_records_legacy_successor(integer)') is not null as teacher_reset_ok,
  to_regprocedure('public.teacher_lock_records_legacy_successors()') is not null as teacher_lock_ok,
  to_regprocedure('public.teacher_unlock_records_legacy_successors()') is not null as teacher_unlock_ok;

select
  has_table_privilege('authenticated', 'public.records_legacy_events', 'SELECT') as authenticated_events_select,
  has_table_privilege('authenticated', 'public.records_legacy_events', 'INSERT') as authenticated_events_insert,
  has_table_privilege('authenticated', 'public.records_legacy_successors', 'SELECT') as authenticated_successors_select,
  has_table_privilege('authenticated', 'public.records_legacy_successors', 'INSERT') as authenticated_successors_insert;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.records_legacy_events'::regclass,
  'public.records_legacy_successors'::regclass
)
order by conrelid::regclass::text, conname;
