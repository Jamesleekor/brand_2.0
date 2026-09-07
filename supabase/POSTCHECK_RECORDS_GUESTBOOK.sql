-- READ ONLY
-- B.R.A.N.D 2.0 Records Guestbook V1 strict postcheck.

select
  to_regclass('public.records_guestbook_entries') is not null as table_ok,
  to_regprocedure('public.student_get_records_guestbook(integer,integer)') is not null as student_read_ok,
  to_regprocedure('public.student_upsert_records_guestbook(text)') is not null as student_write_ok,
  to_regprocedure('public.teacher_get_records_guestbook(integer,integer)') is not null as teacher_read_ok,
  to_regprocedure('public.teacher_delete_records_guestbook(bigint)') is not null as teacher_delete_ok;

select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'records_guestbook_entries';

select
  has_table_privilege('authenticated', 'public.records_guestbook_entries', 'SELECT') as authenticated_direct_select,
  has_table_privilege('authenticated', 'public.records_guestbook_entries', 'INSERT') as authenticated_direct_insert,
  has_table_privilege('authenticated', 'public.records_guestbook_entries', 'UPDATE') as authenticated_direct_update,
  has_table_privilege('authenticated', 'public.records_guestbook_entries', 'DELETE') as authenticated_direct_delete;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.records_guestbook_entries'::regclass
order by conname;
