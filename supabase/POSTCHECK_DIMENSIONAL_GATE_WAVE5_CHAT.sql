select routine_name from information_schema.routines
where routine_schema='public' and routine_name in (
 'student_begin_dimensional_gate_chat','student_finalize_dimensional_gate_chat',
 'student_abort_dimensional_gate_chat','student_get_dimensional_gate_chat_history'
) order by routine_name;

select column_name,data_type,column_default from information_schema.columns
where table_schema='public' and table_name='dimensional_gate_chat_messages'
  and column_name in ('moderation_severity','affinity_delta','is_aborted')
order by ordinal_position;
