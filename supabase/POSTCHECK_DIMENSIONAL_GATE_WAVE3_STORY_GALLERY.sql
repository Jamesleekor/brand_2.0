-- B.R.A.N.D 2.0 — Dimensional Gate Wave 3 postcheck
select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'student_get_dimensional_gate_stories',
    'student_get_dimensional_gate_story',
    'student_start_dimensional_gate_story',
    'student_complete_dimensional_gate_story',
    'student_get_dimensional_gate_gallery'
  )
order by routine_name;

select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='dimensional_gate_gallery_assets'
  and column_name='source_cut_order';
