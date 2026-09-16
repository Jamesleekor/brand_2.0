select p.proname,pg_get_function_identity_arguments(p.oid) args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
 'teacher_get_dimensional_gate_content_extras','teacher_save_dimensional_gate_special_cgs',
 'dimensional_gate_grant_gallery_background','dimensional_gate_sync_milestone_unlocks'
) order by p.proname,args;
