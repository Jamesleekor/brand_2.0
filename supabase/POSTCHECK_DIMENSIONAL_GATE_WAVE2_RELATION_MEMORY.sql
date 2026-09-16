select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('dimensional_gate_sync_milestone_unlocks','student_get_dimensional_gate_character')
order by p.proname;
