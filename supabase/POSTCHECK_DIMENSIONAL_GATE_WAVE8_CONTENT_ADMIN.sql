select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'teacher_get_dimensional_gate_content','teacher_save_dimensional_gate_profile',
 'teacher_save_dimensional_gate_memories','teacher_save_dimensional_gate_rewards'
) order by p.proname;
