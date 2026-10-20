-- New teacher adjustments may specify their effective timestamp (KST in UI).
-- No existing ledger rows or balances are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

DO $preflight$
declare r record;
begin
  for r in select * from (values
    ('public.teacher_adjust_student_assets_v2(integer[],value_token_type,bigint,text,numeric)','08c561eb8b8e0c1bace872b0d060aaf0'),
    ('public.teacher_adjust_student_assets_combined(integer[],bigint,bigint,text,text,numeric)','419edbb32d4bb9df149f73207d6f9e66'),
    ('public.create_transaction(integer,value_token_type,bigint,transaction_source_type,bigint,bigint,text)','1771cadb2bb76f519a1252db8fa5e12e'),
    ('public._teacher_grant_gold_with_tax(integer,bigint,text)','9b7cef7a742c6998d942d2810d0c9e6b'),
    ('public._teacher_apply_asset_deduction(integer,value_token_type,bigint,text)','5bcd870e651d9d4e47656a88480de598')
  ) x(signature,expected_md5) loop
    if md5(pg_get_functiondef(r.signature::regprocedure))<>r.expected_md5 then
      raise exception 'Asset dependency changed: %. Re-audit before applying.',r.signature;
    end if;
  end loop;
end;
$preflight$;

alter table public.transactions add column if not exists recorded_at timestamptz;
alter table public.student_asset_arrears add column if not exists recorded_at timestamptz;
comment on column public.transactions.created_at is 'Effective transaction time used by period statistics. Balance_after is the balance after actual processing, not a reconstructed historical balance.';
comment on column public.transactions.recorded_at is 'Actual server processing time for new transactions. NULL on historical rows means use created_at.';
comment on column public.student_asset_arrears.recorded_at is 'Actual server assessment time; created_at is the effective penalty time. Historical rows remain NULL.';

create or replace function private.teacher_asset_effective_time(p_effective_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $fn$
declare
  v_classroom_id integer;
  v_effective_at timestamptz:=coalesce(p_effective_at,clock_timestamp());
  v_date date;
  v_legacy_last date;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='P0600'; end if;
  perform public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  if v_classroom_id is null then raise exception '담당 학급을 확인할 수 없습니다.' using errcode='P0607'; end if;
  if not isfinite(v_effective_at) or v_effective_at>clock_timestamp() then
    raise exception '반영 일시는 현재 시각까지 지정할 수 있습니다. 예약 지급은 지원하지 않습니다.' using errcode='P0640';
  end if;
  v_date:=timezone('Asia/Seoul',v_effective_at)::date;
  if p_effective_at is not null then
    select max(h.event_date) into v_legacy_last from public.legacy_asset_history h where h.classroom_id=v_classroom_id;
    if v_legacy_last is not null and v_date<=v_legacy_last then
      raise exception '이관 완료된 과거 원장 기간은 지정할 수 없습니다. % 이후 날짜를 선택해주세요.',v_legacy_last+1 using errcode='P0641';
    end if;
    if exists(select 1 from public.mvp_foundation_sessions s where s.classroom_id=v_classroom_id and s.status='FINALIZED'
      and (v_date between s.evaluation_start_date and s.evaluation_end_date or v_date between s.comparison_start_date and s.comparison_end_date)) then
      raise exception '선택한 날짜는 이미 확정된 MVP 통계 기간입니다. 확정 기록을 보존하기 위해 소급 처리할 수 없습니다.' using errcode='P0642';
    end if;
  end if;
  return v_effective_at;
end;
$fn$;
revoke all on function private.teacher_asset_effective_time(timestamptz) from public,anon,authenticated;

create or replace function private.teacher_asset_stamp_effective_time()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  v_effective_at text:=nullif(current_setting('brand.teacher_asset_effective_at',true),'');
  v_classroom_id text:=nullif(current_setting('brand.teacher_asset_classroom_id',true),'');
begin
  NEW.recorded_at:=clock_timestamp();
  if v_effective_at is not null and v_classroom_id=NEW.classroom_id::text then
    if TG_ARGV[0]='TRANSACTION' then
      -- Automatic arrears repayments use source_id; they keep the actual payment date.
      if NEW.source_id is null and NEW.source_type::text in ('TEACHER_GRANT','TEACHER_DEDUCT','BV_REVOKE') then
        NEW.created_at:=v_effective_at::timestamptz;
      end if;
    elsif TG_ARGV[0]='ARREAR' then
      NEW.created_at:=v_effective_at::timestamptz;
    end if;
  end if;
  return NEW;
end;
$fn$;
revoke all on function private.teacher_asset_stamp_effective_time() from public,anon,authenticated;

-- BEFORE trigger name sorts before trigger_transactions_assign_term so the effective term is selected.
create trigger trg_00_teacher_asset_effective_at before insert on public.transactions
for each row execute function private.teacher_asset_stamp_effective_time('TRANSACTION');
create trigger trg_00_teacher_arrear_effective_at before insert on public.student_asset_arrears
for each row execute function private.teacher_asset_stamp_effective_time('ARREAR');

create or replace function private.teacher_asset_refresh_mvp_drafts(p_classroom_id integer,p_effective_at timestamptz)
returns void language plpgsql security definer set search_path='' as $fn$
declare s public.mvp_foundation_sessions%rowtype; v_date date:=timezone('Asia/Seoul',p_effective_at)::date;
begin
  for s in select * from public.mvp_foundation_sessions
    where classroom_id=p_classroom_id and status='DRAFT' and last_calculated_at is not null
      and (v_date between evaluation_start_date and evaluation_end_date or v_date between comparison_start_date and comparison_end_date)
    order by id for update loop
    update public.mvp_foundation_sessions set
      draft_data=public._mvp_foundation_calculate_payload(s.classroom_id,s.evaluation_start_date,s.evaluation_end_date,s.comparison_start_date,s.comparison_end_date),
      last_calculated_at=now(),updated_at=now() where id=s.id and status='DRAFT';
  end loop;
end;
$fn$;
revoke all on function private.teacher_asset_refresh_mvp_drafts(integer,timestamptz) from public,anon,authenticated;

create or replace function public.teacher_adjust_student_assets_at(
  p_student_ids integer[],p_value_token public.value_token_type,p_amount bigint,p_reason text,
  p_effective_at timestamptz,p_tax_rate_percent numeric default null
)
returns table(student_id integer,transaction_id bigint,new_balance bigint,tax_amount bigint,arrear_amount bigint,effective_at timestamptz)
language plpgsql security definer set search_path='' as $fn$
declare
  v_effective_at timestamptz;
  v_classroom_id integer;
  v_previous_time text:=coalesce(current_setting('brand.teacher_asset_effective_at',true),'');
  v_previous_class text:=coalesce(current_setting('brand.teacher_asset_classroom_id',true),'');
begin
  v_effective_at:=private.teacher_asset_effective_time(p_effective_at);
  v_classroom_id:=public.current_classroom_id();
  perform set_config('brand.teacher_asset_effective_at',v_effective_at::text,true);
  perform set_config('brand.teacher_asset_classroom_id',v_classroom_id::text,true);
  return query select x.student_id,x.transaction_id,x.new_balance,x.tax_amount,x.arrear_amount,v_effective_at
    from public.teacher_adjust_student_assets_v2(p_student_ids,p_value_token,p_amount,p_reason,p_tax_rate_percent) x;
  perform set_config('brand.teacher_asset_effective_at',v_previous_time,true);
  perform set_config('brand.teacher_asset_classroom_id',v_previous_class,true);
  perform private.teacher_asset_refresh_mvp_drafts(v_classroom_id,v_effective_at);
exception when others then
  perform set_config('brand.teacher_asset_effective_at',v_previous_time,true);
  perform set_config('brand.teacher_asset_classroom_id',v_previous_class,true);
  raise;
end;
$fn$;
revoke all on function public.teacher_adjust_student_assets_at(integer[],public.value_token_type,bigint,text,timestamptz,numeric) from public,anon;
grant execute on function public.teacher_adjust_student_assets_at(integer[],public.value_token_type,bigint,text,timestamptz,numeric) to authenticated;

create or replace function public.teacher_adjust_student_assets_combined_at(
  p_student_ids integer[],p_bv_amount bigint,p_gold_amount bigint,p_operation text,p_reason text,
  p_effective_at timestamptz,p_tax_rate_percent numeric default null
)
returns table(student_id integer,bv_transaction_id bigint,gold_transaction_id bigint,new_bv bigint,new_gold bigint,
  gold_tax_amount bigint,bv_arrear_amount bigint,gold_arrear_amount bigint,effective_at timestamptz)
language plpgsql security definer set search_path='' as $fn$
declare
  v_effective_at timestamptz;
  v_classroom_id integer;
  v_previous_time text:=coalesce(current_setting('brand.teacher_asset_effective_at',true),'');
  v_previous_class text:=coalesce(current_setting('brand.teacher_asset_classroom_id',true),'');
begin
  v_effective_at:=private.teacher_asset_effective_time(p_effective_at);
  v_classroom_id:=public.current_classroom_id();
  perform set_config('brand.teacher_asset_effective_at',v_effective_at::text,true);
  perform set_config('brand.teacher_asset_classroom_id',v_classroom_id::text,true);
  return query select x.student_id,x.bv_transaction_id,x.gold_transaction_id,x.new_bv,x.new_gold,
    x.gold_tax_amount,x.bv_arrear_amount,x.gold_arrear_amount,v_effective_at
    from public.teacher_adjust_student_assets_combined(p_student_ids,p_bv_amount,p_gold_amount,p_operation,p_reason,p_tax_rate_percent) x;
  perform set_config('brand.teacher_asset_effective_at',v_previous_time,true);
  perform set_config('brand.teacher_asset_classroom_id',v_previous_class,true);
  perform private.teacher_asset_refresh_mvp_drafts(v_classroom_id,v_effective_at);
exception when others then
  perform set_config('brand.teacher_asset_effective_at',v_previous_time,true);
  perform set_config('brand.teacher_asset_classroom_id',v_previous_class,true);
  raise;
end;
$fn$;
revoke all on function public.teacher_adjust_student_assets_combined_at(integer[],bigint,bigint,text,text,timestamptz,numeric) from public,anon;
grant execute on function public.teacher_adjust_student_assets_combined_at(integer[],bigint,bigint,text,text,timestamptz,numeric) to authenticated;

DO $patch$
DECLARE v_definition text;
BEGIN
  v_definition:=pg_get_functiondef('public.teacher_get_asset_adjustment_config(integer)'::regprocedure);
  if md5(v_definition)<>'b2946c526a34430b81dc20be69aa1063' then raise exception 'Asset config function changed; re-audit before applying.'; end if;
  v_definition:=replace(v_definition,
    $old$'income_tax_rate_percent',round(v_rate,2)$old$,
    $new$'income_tax_rate_percent',round(v_rate,2),
    'server_now',now(),
    'earliest_effective_at',(select (max(h.event_date)+1)::timestamp at time zone 'Asia/Seoul' from public.legacy_asset_history h where h.classroom_id=p_classroom_id),
    'effective_time_zone','Asia/Seoul'$new$);
  execute v_definition;
  v_definition:=pg_get_functiondef('public.teacher_get_economy_history(integer,integer,integer,integer,text,text,date,date)'::regprocedure);
  if md5(v_definition)<>'c8f91a8aeb419b0b29794ccb98574393' then raise exception 'Economy history function changed; re-audit before applying.'; end if;
  v_definition:=replace(v_definition,'t.created_at AS occurred_at,','t.created_at AS occurred_at, coalesce(t.recorded_at,t.created_at) AS recorded_at,');
  v_definition:=replace(v_definition,'e.created_at AS occurred_at,','e.created_at AS occurred_at, e.created_at AS recorded_at,');
  execute v_definition;
END
$patch$;

-- Exercise the production timestamp trigger on isolated temporary rows only.
-- No real transactions, wallets, rewards or student accounts are changed.
create temporary table teacher_asset_time_probe (
  id integer, classroom_id integer, source_type text, source_id bigint,
  created_at timestamptz default now(),recorded_at timestamptz
) on commit drop;
create trigger stamp before insert on teacher_asset_time_probe for each row
execute function private.teacher_asset_stamp_effective_time('TRANSACTION');
create temporary table teacher_arrear_time_probe (
  id integer,classroom_id integer,created_at timestamptz default now(),recorded_at timestamptz
) on commit drop;
create trigger stamp before insert on teacher_arrear_time_probe for each row
execute function private.teacher_asset_stamp_effective_time('ARREAR');
DO $test$
declare
  v_target timestamptz:=date_trunc('minute',now()-interval '1 day');
  v_old_time text:=coalesce(current_setting('brand.teacher_asset_effective_at',true),'');
  v_old_class text:=coalesce(current_setting('brand.teacher_asset_classroom_id',true),'');
begin
  perform set_config('brand.teacher_asset_effective_at',v_target::text,true);
  perform set_config('brand.teacher_asset_classroom_id','1',true);
  insert into pg_temp.teacher_asset_time_probe(id,classroom_id,source_type,source_id,recorded_at) values
    (1,1,'TEACHER_GRANT',null,'2000-01-01'),(2,1,'TEACHER_DEDUCT',null,null),
    (3,1,'BV_REVOKE',null,null),(4,1,'TEACHER_DEDUCT',100,null),
    (5,1,'DAILY_QUEST',null,null),(6,2,'TEACHER_GRANT',null,null),
    (7,1,'NEWBIE_SETTLEMENT',null,null),(8,1,'REVERSAL',null,null);
  if (select count(*) from pg_temp.teacher_asset_time_probe where created_at=v_target)<>3 then
    raise exception 'Effective date leaked beyond direct teacher adjustments.';
  end if;
  if exists(select 1 from pg_temp.teacher_asset_time_probe where recorded_at<now()-interval '1 minute') then
    raise exception 'Actual server processing time was not recorded.';
  end if;
  insert into pg_temp.teacher_arrear_time_probe(id,classroom_id) values(1,1),(2,2);
  if (select count(*) from pg_temp.teacher_arrear_time_probe where created_at=v_target)<>1 then
    raise exception 'Arrear effective date scope test failed.';
  end if;
  perform set_config('brand.teacher_asset_effective_at','',true);
  perform set_config('brand.teacher_asset_classroom_id','',true);
  insert into pg_temp.teacher_asset_time_probe(id,classroom_id,source_type) values(9,1,'TEACHER_GRANT');
  if (select created_at from pg_temp.teacher_asset_time_probe where id=9)<>now() then
    raise exception 'Default current-time behavior changed.';
  end if;
  perform set_config('brand.teacher_asset_effective_at',v_old_time,true);
  perform set_config('brand.teacher_asset_classroom_id',v_old_class,true);
  if has_function_privilege('anon','public.teacher_adjust_student_assets_at(integer[],public.value_token_type,bigint,text,timestamptz,numeric)','EXECUTE')
    or has_function_privilege('authenticated','private.teacher_asset_effective_time(timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','private.teacher_asset_stamp_effective_time()','EXECUTE')
    or has_function_privilege('authenticated','private.teacher_asset_refresh_mvp_drafts(integer,timestamptz)','EXECUTE') then
    raise exception 'Unexpected timestamp helper execute privilege.';
  end if;
end;
$test$;
notify pgrst,'reload schema';
commit;
