-- B.R.A.N.D 2.0
-- Enforce cumulative per-product limits for deposits and installment savings.
-- Applied to production Supabase as migration 20260907060234.

create or replace function public.get_my_deposit_quote(p_product_id integer, p_weeks integer, p_principal integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_gold bigint;
  v_product public.deposit_products%rowtype;
  v_term public.deposit_product_terms%rowtype;
  v_bonus_pp numeric;
  v_effective_rate numeric;
  v_gross_interest bigint;
  v_tax bigint;
  v_net_interest bigint;
  v_penalty bigint;
  v_active_total bigint;
  v_remaining bigint;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='P0968';
  end if;
  if p_weeks is null or p_weeks<1 or p_weeks>52 then
    raise exception '예금 기간은 1~52주 범위여야 합니다.' using errcode='P0232';
  end if;

  select s.classroom_id,w.gold into v_classroom_id,v_gold
  from public.students s
  join public.wallets w on w.student_id=s.id
  where s.id=v_student_id and s.transferred_at is null;

  select * into v_product
  from public.deposit_products
  where id=p_product_id and classroom_id=v_classroom_id and status='ACTIVE';
  if v_product.id is null then
    raise exception '현재 가입 가능한 예금상품을 찾을 수 없습니다.' using errcode='P0230';
  end if;
  if p_principal is null or p_principal<v_product.min_amount or p_principal>v_product.max_amount then
    raise exception '가입 금액 범위를 벗어났습니다. (최소 %, 최대 %)',v_product.min_amount,v_product.max_amount using errcode='P0231';
  end if;

  select coalesce(sum(sd.principal),0)::bigint
  into v_active_total
  from public.student_deposits sd
  where sd.student_id=v_student_id
    and sd.product_id=p_product_id
    and sd.status='ACTIVE';

  v_remaining:=greatest(v_product.max_amount::bigint-v_active_total,0::bigint);
  if v_active_total+p_principal>v_product.max_amount then
    raise exception '이 예금상품의 누적 가입 한도를 초과합니다. (현재 %, 추가 가능 %, 상품 한도 %)',
      v_active_total,v_remaining,v_product.max_amount using errcode='P0235';
  end if;

  select * into v_term
  from public.deposit_product_terms
  where product_id=p_product_id and term_weeks=p_weeks and is_active=true;
  if v_term.id is null then
    raise exception '선택한 %주 기간은 현재 가입할 수 없습니다.',p_weeks using errcode='P0234';
  end if;

  v_effective_rate:=public.savings_interest_rate_for_student(v_student_id,v_term.base_interest_rate);
  v_bonus_pp:=v_effective_rate-v_term.base_interest_rate;
  v_gross_interest:=floor(p_principal::numeric*v_effective_rate/100)::bigint;
  v_tax:=public.calculate_income_tax_for_student(v_gross_interest,v_student_id);
  v_net_interest:=v_gross_interest-v_tax;
  v_penalty:=floor(p_principal::numeric*v_product.early_withdrawal_penalty_rate)::bigint;

  return jsonb_build_object(
    'student_id',v_student_id,
    'product_id',v_product.id,
    'product_name',v_product.product_name,
    'term_weeks',v_term.term_weeks,
    'principal',p_principal,
    'base_interest_rate',v_term.base_interest_rate,
    'collection_bonus_pp',v_bonus_pp,
    'effective_interest_rate',v_effective_rate,
    'gross_interest_at_maturity',v_gross_interest,
    'estimated_tax',v_tax,
    'estimated_net_interest',v_net_interest,
    'estimated_maturity_payout',p_principal+v_net_interest,
    'maturity_date',current_date+(v_term.term_weeks*7),
    'early_withdrawal_penalty_rate',v_product.early_withdrawal_penalty_rate,
    'estimated_early_withdrawal_penalty',v_penalty,
    'estimated_early_withdrawal_payout',p_principal-v_penalty,
    'wallet_gold',v_gold,
    'can_afford',v_gold>=p_principal,
    'tax_is_estimate',true,
    'rate_snapshot_timing','AT_SUBSCRIPTION',
    'active_product_principal',v_active_total,
    'remaining_product_capacity',v_remaining
  );
end;
$function$;

create or replace function public.subscribe_to_deposit(p_student_id integer, p_product_id integer, p_principal integer, p_weeks integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_product public.deposit_products%rowtype;
  v_term public.deposit_product_terms%rowtype;
  v_classroom_id integer;
  v_base_rate numeric;
  v_effective_rate numeric;
  v_bonus_pp numeric;
  v_penalty_rate numeric;
  v_maturity_date date;
  v_tx_id bigint;
  v_deposit_id integer;
  v_deposit_uid varchar(50);
  v_school_term_id integer;
  v_active_total bigint;
  v_remaining bigint;
begin
  perform public.ensure_self_or_teacher(p_student_id);

  if p_principal is null or p_principal<=0 then
    raise exception '예금 원금은 1 GOLD 이상이어야 합니다.' using errcode='P0231';
  end if;
  if p_weeks is null or p_weeks<1 or p_weeks>52 then
    raise exception '예금 기간은 1~52주 범위여야 합니다.' using errcode='P0232';
  end if;

  select * into v_product
  from public.deposit_products
  where id=p_product_id and status='ACTIVE'
  for update;
  if v_product.id is null then
    raise exception '현재 가입 가능한 예금상품을 찾을 수 없습니다.' using errcode='P0230';
  end if;

  if p_principal<v_product.min_amount or p_principal>v_product.max_amount then
    raise exception '가입 금액 범위를 벗어났습니다. (최소 %, 최대 %, 요청 %)',
      v_product.min_amount,v_product.max_amount,p_principal using errcode='P0231';
  end if;

  select classroom_id into v_classroom_id
  from public.students
  where id=p_student_id and transferred_at is null;
  if v_classroom_id is null or v_classroom_id<>v_product.classroom_id then
    raise exception '다른 학급의 예금상품에는 가입할 수 없습니다.' using errcode='P0233';
  end if;

  select coalesce(sum(sd.principal),0)::bigint
  into v_active_total
  from public.student_deposits sd
  where sd.student_id=p_student_id
    and sd.product_id=p_product_id
    and sd.status='ACTIVE';

  v_remaining:=greatest(v_product.max_amount::bigint-v_active_total,0::bigint);
  if v_active_total+p_principal>v_product.max_amount then
    raise exception '이 예금상품의 누적 가입 한도를 초과합니다. (현재 %, 추가 가능 %, 상품 한도 %)',
      v_active_total,v_remaining,v_product.max_amount using errcode='P0235';
  end if;

  select * into v_term
  from public.deposit_product_terms
  where product_id=p_product_id
    and term_weeks=p_weeks
    and is_active=true
  for update;
  if v_term.id is null then
    raise exception '선택한 %주 기간은 현재 가입할 수 없습니다.',p_weeks using errcode='P0234';
  end if;

  v_base_rate:=v_term.base_interest_rate;
  v_effective_rate:=public.savings_interest_rate_for_student(p_student_id,v_base_rate);
  v_bonus_pp:=v_effective_rate-v_base_rate;
  v_penalty_rate:=v_product.early_withdrawal_penalty_rate;

  if v_penalty_rate is null or v_penalty_rate<0 or v_penalty_rate>1 then
    raise exception '예금상품의 중도해지 위약금 설정이 올바르지 않습니다.' using errcode='P0966';
  end if;

  v_maturity_date:=current_date+(p_weeks*7);
  v_school_term_id:=public.get_school_term_for_date(v_classroom_id,now());

  v_tx_id:=public.create_transaction(
    p_student_id,'GOLD',-p_principal,'DEPOSIT_PRINCIPAL',p_product_id,0,
    format('[예금 가입] %s · %s주 · 기본 %s%% + 컬렉션 %s%%p = 적용 %s%% · 중도해지 위약금 %s%%',
      v_product.product_name,p_weeks,v_base_rate,v_bonus_pp,v_effective_rate,v_penalty_rate*100)
  );

  v_deposit_uid:='DEP_'||extract(epoch from clock_timestamp())::bigint::text
                    ||'_'||substring(md5(random()::text||p_student_id::text) from 1 for 8);

  insert into public.student_deposits(
    deposit_uid,classroom_id,student_id,product_id,school_term_id,
    principal,interest_rate,deposit_weeks,start_date,maturity_date,status,
    transaction_id_principal,
    product_name_snapshot,base_interest_rate_snapshot,
    collection_bonus_pp_snapshot,early_withdrawal_penalty_rate_snapshot
  ) values (
    v_deposit_uid,v_classroom_id,p_student_id,p_product_id,v_school_term_id,
    p_principal,v_effective_rate,p_weeks,current_date,v_maturity_date,'ACTIVE',
    v_tx_id,
    v_product.product_name,v_base_rate,v_bonus_pp,v_penalty_rate
  ) returning id into v_deposit_id;

  return v_deposit_id;
end;
$function$;

create or replace function public.get_my_installment_savings_quote(p_product_id bigint, p_term_id bigint, p_installment_amount bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_wallet_gold bigint;
  v_product public.installment_savings_products%rowtype;
  v_term public.installment_savings_product_terms%rowtype;
  v_effective_rate numeric;
  v_bonus_pp numeric;
  v_total_planned_principal bigint;
  v_gross_interest bigint;
  v_tax bigint;
  v_net_interest bigint;
  v_penalty bigint;
  v_today date:=timezone('Asia/Seoul',now())::date;
  v_active_installment_total bigint;
  v_remaining bigint;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='P5S20';
  end if;

  select s.classroom_id,w.gold
  into v_classroom_id,v_wallet_gold
  from public.students s
  join public.wallets w on w.student_id=s.id
  where s.id=v_student_id
    and s.transferred_at is null;

  if v_classroom_id is null then
    raise exception '활성 학생 또는 지갑을 찾을 수 없습니다.' using errcode='P5S21';
  end if;

  select * into v_product
  from public.installment_savings_products
  where id=p_product_id
    and classroom_id=v_classroom_id
    and status='ACTIVE';

  if v_product.id is null then
    raise exception '현재 가입 가능한 적금상품을 찾을 수 없습니다.' using errcode='P5S22';
  end if;

  select * into v_term
  from public.installment_savings_product_terms
  where id=p_term_id
    and product_id=p_product_id
    and is_active=true;

  if v_term.id is null then
    raise exception '현재 가입 가능한 적금 기간을 찾을 수 없습니다.' using errcode='P5S23';
  end if;

  if p_installment_amount is null
     or p_installment_amount<v_product.min_installment_amount
     or p_installment_amount>v_product.max_installment_amount then
    raise exception
      '회차당 납입액 범위를 벗어났습니다. (최소 %, 최대 %)',
      v_product.min_installment_amount,v_product.max_installment_amount
      using errcode='P5S24';
  end if;

  select coalesce(sum(s.installment_amount),0)::bigint
  into v_active_installment_total
  from public.student_installment_savings s
  where s.student_id=v_student_id
    and s.product_id=p_product_id
    and s.status='ACTIVE';

  v_remaining:=greatest(v_product.max_installment_amount::bigint-v_active_installment_total,0::bigint);
  if v_active_installment_total+p_installment_amount>v_product.max_installment_amount then
    raise exception '이 적금상품의 활성 계약 회차당 납입액 합계 한도를 초과합니다. (현재 %, 추가 가능 %, 상품 한도 %)',
      v_active_installment_total,v_remaining,v_product.max_installment_amount using errcode='P5S27';
  end if;

  v_effective_rate:=public.savings_interest_rate_for_student(v_student_id,v_term.base_weekly_interest_rate);
  v_bonus_pp:=v_effective_rate-v_term.base_weekly_interest_rate;
  v_total_planned_principal:=p_installment_amount*v_term.total_rounds::bigint;

  select coalesce(
    sum(
      floor(
        p_installment_amount::numeric
        * v_effective_rate
        / 100
        * ((v_term.total_rounds-gs.round_no+1)*v_term.interval_weeks)
      )::bigint
    ),
    0
  )::bigint
  into v_gross_interest
  from generate_series(1,v_term.total_rounds) as gs(round_no);

  v_tax:=public.calculate_income_tax_for_student(v_gross_interest,v_student_id);
  v_net_interest:=v_gross_interest-v_tax;
  v_penalty:=floor(v_total_planned_principal::numeric*v_product.early_withdrawal_penalty_rate)::bigint;

  return jsonb_build_object(
    'student_id',v_student_id,
    'product_id',v_product.id,
    'term_id',v_term.id,
    'product_name',v_product.product_name,
    'installment_amount',p_installment_amount,
    'total_rounds',v_term.total_rounds,
    'interval_weeks',v_term.interval_weeks,
    'planned_total_principal',v_total_planned_principal,
    'base_weekly_interest_rate',v_term.base_weekly_interest_rate,
    'collection_bonus_pp',v_bonus_pp,
    'effective_weekly_interest_rate',v_effective_rate,
    'estimated_full_schedule_gross_interest',v_gross_interest,
    'estimated_tax',v_tax,
    'estimated_full_schedule_net_interest',v_net_interest,
    'estimated_full_schedule_maturity_payout',v_total_planned_principal+v_net_interest,
    'start_date',v_today,
    'maturity_date',v_today+(v_term.total_rounds*v_term.interval_weeks*7),
    'first_round_due_date',v_today,
    'early_withdrawal_penalty_rate',v_product.early_withdrawal_penalty_rate,
    'estimated_penalty_if_fully_paid',v_penalty,
    'wallet_gold',v_wallet_gold,
    'can_afford_first_round',v_wallet_gold>=p_installment_amount,
    'insufficient_gold_policy','MISSED_NO_CATCHUP',
    'rate_snapshot_timing','AT_SUBSCRIPTION',
    'interest_model','SIMPLE_INTEREST_PER_PAID_ROUND',
    'active_product_installment_amount',v_active_installment_total,
    'remaining_product_capacity',v_remaining
  );
end;
$function$;

create or replace function public.subscribe_to_installment_savings(p_product_id bigint, p_term_id bigint, p_installment_amount bigint)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_product public.installment_savings_products%rowtype;
  v_term public.installment_savings_product_terms%rowtype;
  v_effective_rate numeric;
  v_bonus_pp numeric;
  v_today date:=timezone('Asia/Seoul',now())::date;
  v_maturity_date date;
  v_school_term_id integer;
  v_uid varchar(80);
  v_contract_id bigint;
  v_round1_id bigint;
  v_active_installment_total bigint;
  v_remaining bigint;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode='P5S20';
  end if;

  select classroom_id into v_classroom_id
  from public.students
  where id=v_student_id
    and transferred_at is null;

  if v_classroom_id is null then
    raise exception '활성 학생을 찾을 수 없습니다.' using errcode='P5S21';
  end if;

  if public.is_asset_freeze_active(v_classroom_id) then
    raise exception '현재 자산동결 중이라 새 적금에 가입할 수 없습니다.' using errcode='P5S25';
  end if;

  select * into v_product
  from public.installment_savings_products
  where id=p_product_id
    and classroom_id=v_classroom_id
    and status='ACTIVE'
  for update;

  if v_product.id is null then
    raise exception '현재 가입 가능한 적금상품을 찾을 수 없습니다.' using errcode='P5S22';
  end if;

  select * into v_term
  from public.installment_savings_product_terms
  where id=p_term_id
    and product_id=p_product_id
    and is_active=true
  for update;

  if v_term.id is null then
    raise exception '현재 가입 가능한 적금 기간을 찾을 수 없습니다.' using errcode='P5S23';
  end if;

  if p_installment_amount is null
     or p_installment_amount<v_product.min_installment_amount
     or p_installment_amount>v_product.max_installment_amount then
    raise exception '회차당 납입액 범위를 벗어났습니다. (최소 %, 최대 %)',
      v_product.min_installment_amount,v_product.max_installment_amount using errcode='P5S24';
  end if;

  select coalesce(sum(s.installment_amount),0)::bigint
  into v_active_installment_total
  from public.student_installment_savings s
  where s.student_id=v_student_id
    and s.product_id=p_product_id
    and s.status='ACTIVE';

  v_remaining:=greatest(v_product.max_installment_amount::bigint-v_active_installment_total,0::bigint);
  if v_active_installment_total+p_installment_amount>v_product.max_installment_amount then
    raise exception '이 적금상품의 활성 계약 회차당 납입액 합계 한도를 초과합니다. (현재 %, 추가 가능 %, 상품 한도 %)',
      v_active_installment_total,v_remaining,v_product.max_installment_amount using errcode='P5S27';
  end if;

  v_effective_rate:=public.savings_interest_rate_for_student(v_student_id,v_term.base_weekly_interest_rate);
  v_bonus_pp:=v_effective_rate-v_term.base_weekly_interest_rate;

  if v_bonus_pp<0 or v_effective_rate<0 then
    raise exception '적금 금리 snapshot 계산이 올바르지 않습니다.' using errcode='P5S26';
  end if;

  v_maturity_date:=v_today+(v_term.total_rounds*v_term.interval_weeks*7);
  v_school_term_id:=public.get_school_term_for_date(v_classroom_id,now());

  v_uid:='INS_'||v_classroom_id::text||'_'||v_student_id::text||'_'
    ||extract(epoch from clock_timestamp())::bigint::text||'_'
    ||substring(md5(random()::text||clock_timestamp()::text) from 1 for 8);

  insert into public.student_installment_savings(
    installment_uid,classroom_id,student_id,product_id,product_term_id,school_term_id,
    product_name_snapshot,installment_amount,total_rounds_snapshot,interval_weeks_snapshot,
    base_weekly_interest_rate_snapshot,collection_bonus_pp_snapshot,
    effective_weekly_interest_rate_snapshot,early_withdrawal_penalty_rate_snapshot,
    start_date,maturity_date,status
  ) values (
    v_uid,v_classroom_id,v_student_id,v_product.id,v_term.id,v_school_term_id,
    v_product.product_name,p_installment_amount,v_term.total_rounds,v_term.interval_weeks,
    v_term.base_weekly_interest_rate,v_bonus_pp,
    v_effective_rate,v_product.early_withdrawal_penalty_rate,
    v_today,v_maturity_date,'ACTIVE'
  ) returning id into v_contract_id;

  insert into public.installment_savings_rounds(contract_id,round_no,due_date,status)
  select v_contract_id,gs.round_no,v_today+((gs.round_no-1)*v_term.interval_weeks*7),'PENDING'
  from generate_series(1,v_term.total_rounds) as gs(round_no);

  select id into v_round1_id
  from public.installment_savings_rounds
  where contract_id=v_contract_id and round_no=1;

  perform public.process_single_installment_savings_round(v_round1_id);
  return v_contract_id;
end;
$function$;
