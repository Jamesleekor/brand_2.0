-- B.R.A.N.D 2.0 Dimensional Gate Wave 1 postcheck (read-only)
select table_name
from information_schema.tables
where table_schema='public'
  and table_name like 'dimensional_gate_%'
order by table_name;

select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('dimensional_gate_relation_stage','student_get_dimensional_gate_roster')
order by p.proname;

select public.dimensional_gate_relation_stage(0) as a0,
       public.dimensional_gate_relation_stage(39) as a39,
       public.dimensional_gate_relation_stage(40) as a40,
       public.dimensional_gate_relation_stage(69) as a69,
       public.dimensional_gate_relation_stage(70) as a70,
       public.dimensional_gate_relation_stage(99) as a99,
       public.dimensional_gate_relation_stage(100) as a100;
