select routine_name
from information_schema.routines
where routine_schema='public' and routine_name in (
  'student_get_dimensional_gate_rewards',
  'student_claim_dimensional_gate_reward',
  'student_get_dimensional_gate_visual_entitlements',
  'student_set_home_showcase_slot_visual'
)
order by routine_name;

select column_name,data_type
from information_schema.columns
where table_schema='public' and table_name='dimensional_gate_reward_claims' and column_name='transaction_ids';
