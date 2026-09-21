-- B.R.A.N.D 2.0
-- Achievement Helper Record Room V7: OVERVIEW + ECONOMY redesign and asset privacy
-- Applied to production on 2026-09-21. This migration is kept for source reproducibility.

create or replace function public.student_get_achievement_helper_directory()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_classroom_id integer:=public.current_classroom_id();
  v_result jsonb;
begin
  if not public.achievement_current_student_is_helper() then
    raise exception 'Achievement helper role required' using errcode='PA302';
  end if;

  with scope as (
    select
      s.id student_id,
      s.name,
      s.brand_name,
      s.cached_tier,
      coalesce(w.bv,0)::bigint bv
    from public.students s
    left join public.wallets w on w.student_id=s.id
    where s.classroom_id=v_classroom_id
      and s.role='STUDENT'
      and s.transferred_at is null
      and coalesce(s.is_test_account,false)=false
  ),
  metrics as (
    select
      sc.*,
      coalesce((
        select count(*)
        from public.student_achievements sa
        where sa.student_id=sc.student_id and coalesce(sa.is_revoked,false)=false
      ),0)::integer achievement_count,
      (
        coalesce((
          select sum(abs(t.amount))
          from public.transactions t
          where t.student_id=sc.student_id
            and t.value_token='GOLD'
            and t.source_type='DONATION'
            and coalesce(t.is_reversed,false)=false
        ),0)
        +
        coalesce((
          select sum(abs(h.gold_delta))
          from public.legacy_asset_history h
          where h.student_id=sc.student_id
            and coalesce(h.gold_delta,0)<0
            and (h.memo ilike '%기부%' or h.memo ilike '%복지기금%')
        ),0)
      )::bigint donation_gold,
      (
        coalesce((
          select count(*)
          from public.transactions t
          where t.student_id=sc.student_id
            and t.value_token='BV'
            and t.amount<0
            and coalesce(t.is_reversed,false)=false
        ),0)
        +
        coalesce((
          select count(*)
          from public.legacy_asset_history h
          where h.student_id=sc.student_id
            and coalesce(h.bv_delta,0)<0
        ),0)
      )::integer bv_deduction_count,
      (
        select cs.total_score
        from public.credit_scores cs
        where cs.student_id=sc.student_id
        order by cs.as_of_date desc,cs.calculated_at desc,cs.id desc
        limit 1
      )::integer credit_score,
      coalesce((
        select count(distinct nullif(btrim(pj.job_name),''))
        from public.primary_jobs pj
        where pj.student_id=sc.student_id
      ),0)::integer primary_job_count,
      coalesce((
        select count(*)
        from public.arcade_runs ar
        where ar.student_id=sc.student_id
          and coalesce(ar.is_prerelease_test,false)=false
          and ar.official_score is not null
      ),0)::integer arcade_official_run_count
    from scope sc
  ),
  ranked as (
    select
      m.*,
      row_number() over(order by m.bv desc,m.name,m.student_id)::integer bv_rank,
      row_number() over(order by m.achievement_count desc,m.name,m.student_id)::integer achievement_rank,
      row_number() over(order by m.donation_gold desc,m.name,m.student_id)::integer donation_rank,
      row_number() over(order by m.bv_deduction_count asc,m.name,m.student_id)::integer low_deduction_rank
    from metrics m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',r.student_id,
    'student_name',r.name,
    'brand_name',r.brand_name,
    'tier',r.cached_tier,
    'bv_rank',r.bv_rank,
    'achievement_count',r.achievement_count,
    'achievement_rank',r.achievement_rank,
    'donation_gold',r.donation_gold,
    'donation_rank',r.donation_rank,
    'bv_deduction_count',r.bv_deduction_count,
    'low_deduction_rank',r.low_deduction_rank,
    'credit_score',r.credit_score,
    'primary_job_count',r.primary_job_count,
    'arcade_official_run_count',r.arcade_official_run_count
  ) order by r.name,r.student_id),'[]'::jsonb)
  into v_result
  from ranked r;

  return v_result;
end;
$function$;

revoke all on function public.student_get_achievement_helper_directory() from public,anon;
grant execute on function public.student_get_achievement_helper_directory() to authenticated;

do $do$
begin
  if to_regprocedure('public._achievement_helper_student_record_legacy_v7(integer,text,integer,integer)') is null then
    alter function public.student_get_achievement_helper_student_record(integer,text,integer,integer)
      rename to _achievement_helper_student_record_legacy_v7;
  end if;
end
$do$;

revoke all on function public._achievement_helper_student_record_legacy_v7(integer,text,integer,integer)
from public,anon,authenticated;
grant execute on function public._achievement_helper_student_record_legacy_v7(integer,text,integer,integer)
to service_role;

create or replace function public.student_get_achievement_helper_student_record(
  p_student_id integer,
  p_section text default 'OVERVIEW',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_classroom_id integer;
  v_section text:=upper(btrim(coalesce(p_section,'OVERVIEW')));
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),250);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_student jsonb;
  v_result jsonb;
begin
  v_classroom_id:=public._achievement_helper_assert_target(p_student_id);

  select jsonb_build_object(
    'student_id',s.id,
    'student_name',s.name,
    'brand_name',s.brand_name,
    'tier',s.cached_tier,
    'enrolled_at',s.enrolled_at
  )
  into v_student
  from public.students s
  where s.id=p_student_id;

  if v_section='OVERVIEW' then
    with base as (
      select
        coalesce((
          select count(*)
          from public.student_achievements sa
          where sa.student_id=p_student_id and coalesce(sa.is_revoked,false)=false
        ),0)::integer achievement_count,
        (
          coalesce((
            select sum(abs(t.amount))
            from public.transactions t
            where t.student_id=p_student_id
              and t.value_token='GOLD'
              and t.source_type='DONATION'
              and coalesce(t.is_reversed,false)=false
          ),0)
          +
          coalesce((
            select sum(abs(h.gold_delta))
            from public.legacy_asset_history h
            where h.student_id=p_student_id
              and coalesce(h.gold_delta,0)<0
              and (h.memo ilike '%기부%' or h.memo ilike '%복지기금%')
          ),0)
        )::bigint donation_gold,
        (
          coalesce((
            select count(*)
            from public.transactions t
            where t.student_id=p_student_id
              and t.value_token='BV'
              and t.amount<0
              and coalesce(t.is_reversed,false)=false
          ),0)
          +
          coalesce((
            select count(*)
            from public.legacy_asset_history h
            where h.student_id=p_student_id
              and coalesce(h.bv_delta,0)<0
          ),0)
        )::integer bv_deduction_count,
        (
          select cs.total_score
          from public.credit_scores cs
          where cs.student_id=p_student_id
          order by cs.as_of_date desc,cs.calculated_at desc,cs.id desc
          limit 1
        )::integer credit_score,
        coalesce((
          select count(distinct nullif(btrim(pj.job_name),''))
          from public.primary_jobs pj
          where pj.student_id=p_student_id
        ),0)::integer primary_job_count,
        coalesce((
          select count(*)
          from public.arcade_runs ar
          where ar.student_id=p_student_id
            and coalesce(ar.is_prerelease_test,false)=false
            and ar.official_score is not null
        ),0)::integer arcade_official_run_count,
        (
          select ranked.rnk
          from (
            select
              s.id,
              row_number() over(order by coalesce(w.bv,0) desc,s.name,s.id)::integer rnk
            from public.students s
            left join public.wallets w on w.student_id=s.id
            where s.classroom_id=v_classroom_id
              and s.role='STUDENT'
              and s.transferred_at is null
              and coalesce(s.is_test_account,false)=false
          ) ranked
          where ranked.id=p_student_id
        )::integer bv_rank
    )
    select jsonb_build_object(
      'section','OVERVIEW',
      'student',v_student,
      'privacy','현재 GOLD·CRYSTAL·총자산·저축 원금·대출 잔액은 업적 도우미에게 공개되지 않습니다.',
      'data',jsonb_build_object(
        'achievement_count',b.achievement_count,
        'credit_score',b.credit_score,
        'donation_gold',b.donation_gold,
        'bv_deduction_count',b.bv_deduction_count,
        'primary_job_count',b.primary_job_count,
        'arcade_official_run_count',b.arcade_official_run_count,
        'bv_rank',b.bv_rank
      )
    )
    into v_result
    from base b;

    return coalesce(v_result,jsonb_build_object(
      'section','OVERVIEW',
      'student',v_student,
      'privacy','현재 자산 정보는 업적 도우미에게 공개되지 않습니다.',
      'data','{}'::jsonb
    ));
  end if;

  if v_section='ECONOMY' then
    return jsonb_build_object(
      'section','ECONOMY',
      'student',v_student,
      'privacy','현재 GOLD·CRYSTAL·총자산·저축 원금·대출 금액·거래 후 잔액은 공개되지 않습니다. 업적 검증에 필요한 이용 횟수·거래 금액·이자·세금 등 행동 기록만 제공합니다.',
      'data',jsonb_build_object(
        'summary',jsonb_build_object(
          'savings_use_count',
            (select count(*) from public.student_deposits d where d.student_id=p_student_id)
            +
            (select count(*) from public.student_installment_savings si where si.student_id=p_student_id),
          'savings_matured_count',
            (select count(*) from public.student_deposits d where d.student_id=p_student_id and d.status::text='MATURED')
            +
            (select count(*) from public.student_installment_savings si where si.student_id=p_student_id and si.status::text='MATURED'),
          'interest_total',
            coalesce((select sum(d.interest_paid) from public.student_deposits d where d.student_id=p_student_id),0)
            +
            coalesce((select sum(si.interest_paid) from public.student_installment_savings si where si.student_id=p_student_id),0),
          'loan_use_count',
            (select count(*) from public.loans l where l.student_id=p_student_id),
          'market_purchase_count',
            (select count(*) from public.inventory_events ie where ie.student_id=p_student_id and ie.event_type='PURCHASE')
            +
            (select count(*) from public.legacy_shop_purchase_history lp where lp.student_id=p_student_id),
          'market_purchase_total',
            coalesce((select sum(coalesce(ie.total_gold,0)) from public.inventory_events ie where ie.student_id=p_student_id and ie.event_type='PURCHASE'),0)
            +
            coalesce((select sum(lp.price_gold) from public.legacy_shop_purchase_history lp where lp.student_id=p_student_id),0),
          'tax_total',
            coalesce((select sum(coalesce(t.tax_amount,0)) from public.transactions t where t.student_id=p_student_id and coalesce(t.is_reversed,false)=false),0)
            +
            coalesce((
              select sum((substring(h.memo from '세금[ $]*([0-9]+)'))::bigint)
              from public.legacy_asset_history h
              where h.student_id=p_student_id and h.memo ~ '세금[ $]*[0-9]+'
            ),0),
          'latest_credit_score',
            (select cs.total_score from public.credit_scores cs where cs.student_id=p_student_id order by cs.as_of_date desc,cs.calculated_at desc,cs.id desc limit 1)
        ),
        'transactions',coalesce((
          select jsonb_agg(x order by (x->>'created_at')::timestamptz desc)
          from (
            select jsonb_build_object(
              'token',t.value_token::text,
              'amount',t.amount,
              'source_type',t.source_type::text,
              'tax_amount',t.tax_amount,
              'created_at',t.created_at,
              'is_reversed',t.is_reversed
            ) x
            from public.transactions t
            where t.student_id=p_student_id
            order by t.created_at desc,t.id desc
            limit v_limit offset v_offset
          ) q
        ),'[]'::jsonb),
        'deposits',coalesce((
          select jsonb_agg(jsonb_build_object(
            'product_name',d.product_name_snapshot,
            'interest_rate',d.interest_rate,
            'start_date',d.start_date,
            'maturity_date',d.maturity_date,
            'status',d.status::text,
            'interest_paid',d.interest_paid,
            'created_at',d.created_at
          ) order by d.created_at desc)
          from public.student_deposits d
          where d.student_id=p_student_id
        ),'[]'::jsonb),
        'installment_savings',coalesce((
          select jsonb_agg(jsonb_build_object(
            'product_name',si.product_name_snapshot,
            'paid_rounds',si.paid_rounds,
            'missed_rounds',si.missed_rounds,
            'interest_paid',si.interest_paid,
            'status',si.status::text,
            'start_date',si.start_date,
            'maturity_date',si.maturity_date
          ) order by si.created_at desc)
          from public.student_installment_savings si
          where si.student_id=p_student_id
        ),'[]'::jsonb),
        'loans',coalesce((
          select jsonb_agg(jsonb_build_object(
            'weekly_interest_rate',l.weekly_interest_rate,
            'executed_at',l.executed_at,
            'due_date',l.due_date,
            'status',l.status::text,
            'overdue_weeks',l.overdue_weeks
          ) order by l.created_at desc)
          from public.loans l
          where l.student_id=p_student_id
        ),'[]'::jsonb),
        'credit_history',coalesce((
          select jsonb_agg(jsonb_build_object(
            'date',cs.as_of_date,
            'total_score',cs.total_score,
            'grade',cs.grade::text
          ) order by cs.as_of_date desc,cs.calculated_at desc)
          from (
            select *
            from public.credit_scores
            where student_id=p_student_id
            order by as_of_date desc,calculated_at desc
            limit v_limit
          ) cs
        ),'[]'::jsonb),
        'market_purchases',coalesce((
          select jsonb_agg(jsonb_build_object(
            'item_name',mi.name,
            'event_type',ie.event_type,
            'quantity_delta',ie.quantity_delta,
            'unit_gold',ie.unit_gold,
            'total_gold',ie.total_gold,
            'created_at',ie.created_at
          ) order by ie.created_at desc)
          from (
            select *
            from public.inventory_events
            where student_id=p_student_id
            order by created_at desc
            limit v_limit
          ) ie
          join public.market_items mi on mi.id=ie.item_id
        ),'[]'::jsonb)
      )
    );
  end if;

  return public._achievement_helper_student_record_legacy_v7(
    p_student_id,
    v_section,
    v_limit,
    v_offset
  );
end;
$function$;

revoke all on function public.student_get_achievement_helper_student_record(integer,text,integer,integer)
from public,anon;
grant execute on function public.student_get_achievement_helper_student_record(integer,text,integer,integer)
to authenticated;
