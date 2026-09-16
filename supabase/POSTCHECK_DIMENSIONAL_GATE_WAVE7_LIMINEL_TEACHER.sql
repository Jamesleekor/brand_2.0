select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'student_get_dimensional_gate_liminel_record','student_mark_dimensional_gate_intro_seen',
  'teacher_get_dimensional_gate_admin_board','teacher_manage_dimensional_gate_relationship'
) order by p.proname;
