-- B.R.A.N.D 2.0 — financial lifetime summary cutover correction
-- 2026-09-06
-- Function-only, backward-compatible correction.
--
-- The imported tax/donation baseline represents legacy data. The previous
-- per-student cutover_transaction_id was captured when the baseline table was
-- seeded on 2026-09-03, so it could hide valid B.R.A.N.D 2.0 transactions that
-- occurred after the final student migration but before the baseline seed.
--
-- Prefer the classroom's final_student_migration_runs.created_at boundary.
-- Preserve cutover_transaction_id as a compatibility fallback for classrooms
-- without a final migration run.

create or replace function public.student_get_financial_lifetime_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_baseline_tax bigint := 0;
  v_baseline_donation bigint := 0;
  v_cutover_tx_id bigint := 0;
  v_baseline_created_at timestamptz;
  v_migration_cutover_at timestamptz;
  v_new_tax bigint := 0;
  v_new_donation bigint := 0;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='PFN10';
  end if;

  select s.classroom_id into v_classroom_id
  from public.students s
  where s.id=v_student_id and s.transferred_at is null;
  if v_classroom_id is null then
    raise exception '활성 학생 정보를 찾을 수 없습니다.' using errcode='PFN11';
  end if;

  select b.tax_paid_baseline,b.donation_total_baseline,b.cutover_transaction_id,b.created_at
    into v_baseline_tax,v_baseline_donation,v_cutover_tx_id,v_baseline_created_at
  from public.student_financial_migration_baselines b
  where b.student_id=v_student_id;

  v_baseline_tax := coalesce(v_baseline_tax,0);
  v_baseline_donation := coalesce(v_baseline_donation,0);
  v_cutover_tx_id := coalesce(v_cutover_tx_id,0);

  select max(r.created_at)
    into v_migration_cutover_at
  from public.final_student_migration_runs r
  where r.classroom_id=v_classroom_id;

  select coalesce(sum(t.tax_amount),0)::bigint
    into v_new_tax
  from public.transactions t
  where t.student_id=v_student_id
    and coalesce(t.is_reversed,false)=false
    and coalesce(t.tax_amount,0)>0
    and (
      (v_migration_cutover_at is not null and t.created_at > v_migration_cutover_at)
      or
      (v_migration_cutover_at is null and t.id > v_cutover_tx_id)
    );

  select coalesce(sum(abs(t.amount)),0)::bigint
    into v_new_donation
  from public.transactions t
  where t.student_id=v_student_id
    and coalesce(t.is_reversed,false)=false
    and t.source_type::text='DONATION'
    and (
      (v_migration_cutover_at is not null and t.created_at > v_migration_cutover_at)
      or
      (v_migration_cutover_at is null and t.id > v_cutover_tx_id)
    );

  return jsonb_build_object(
    'student_id',v_student_id,
    'classroom_id',v_classroom_id,
    'tax_paid_total',v_baseline_tax+v_new_tax,
    'donation_total',v_baseline_donation+v_new_donation,
    'baseline_tax_paid',v_baseline_tax,
    'baseline_donation_total',v_baseline_donation,
    'season2_tax_paid',v_new_tax,
    'season2_donation_total',v_new_donation,
    'cutover_transaction_id',v_cutover_tx_id,
    'migration_cutover_at',v_migration_cutover_at,
    'baseline_created_at',v_baseline_created_at
  );
end;
$function$;

revoke all on function public.student_get_financial_lifetime_summary() from public,anon;
grant execute on function public.student_get_financial_lifetime_summary() to authenticated,service_role;
