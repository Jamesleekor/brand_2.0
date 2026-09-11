-- B.R.A.N.D 2.0 Records Legacy Successors V1 rollback
-- WARNING: This removes all successor-registration data. Use only when you
-- intentionally want to remove this feature before inheritance data is used.

begin;

drop function if exists public.teacher_unlock_records_legacy_successors();
drop function if exists public.teacher_lock_records_legacy_successors();
drop function if exists public.teacher_reset_records_legacy_successor(integer);
drop function if exists public.teacher_get_records_legacy_successors();
drop function if exists public.student_register_records_legacy_successor(text, text);
drop function if exists public.student_confirm_records_legacy_seal();
drop function if exists public.student_discover_records_legacy_seal();
drop function if exists public.student_get_records_legacy_successor_state();

drop table if exists public.records_legacy_successors;
drop table if exists public.records_legacy_events;

commit;
