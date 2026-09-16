select column_name,data_type,column_default from information_schema.columns
where table_schema='public' and table_name='dimensional_gate_gallery_assets' and column_name='is_active';

select p.proname,pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'teacher_get_dimensional_gate_story_package','teacher_save_dimensional_gate_story_package',
  'student_get_dimensional_gate_story','student_complete_dimensional_gate_story','student_get_dimensional_gate_gallery'
) order by p.proname,args;
