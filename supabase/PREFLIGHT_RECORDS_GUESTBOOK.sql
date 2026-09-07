-- READ ONLY
-- B.R.A.N.D 2.0 Records Guestbook V1 preflight / state check.

select
  to_regclass('public.records_guestbook_entries') as guestbook_table,
  to_regprocedure('public.student_get_records_guestbook(integer,integer)') as student_read_rpc,
  to_regprocedure('public.student_upsert_records_guestbook(text)') as student_write_rpc,
  to_regprocedure('public.teacher_get_records_guestbook(integer,integer)') as teacher_read_rpc,
  to_regprocedure('public.teacher_delete_records_guestbook(bigint)') as teacher_delete_rpc;

select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  (select count(*) from public.records_guestbook_entries) as row_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'records_guestbook_entries';

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.records_guestbook_entries'::regclass
order by conname;
