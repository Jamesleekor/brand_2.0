-- B.R.A.N.D 2.0
-- Automatic fixed-deposit maturity settlement
-- 2026-10-03
--
-- maturity_date is date-based. Contracts become payable at 00:00 Asia/Seoul.
-- pg_cron checks every 5 minutes and retries automatically.

CREATE OR REPLACE FUNCTION public.process_single_deposit_maturity(p_deposit_id integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deposit public.student_deposits%ROWTYPE;
  v_rate numeric;
  v_interest bigint;
  v_tax bigint;
  v_net_interest bigint;
  v_tx_id bigint;
  v_today_kst date := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT * INTO v_deposit
  FROM public.student_deposits
  WHERE id=p_deposit_id
  FOR UPDATE;

  IF v_deposit.id IS NULL THEN RETURN false; END IF;
  IF v_deposit.status<>'ACTIVE' THEN RETURN false; END IF;
  IF v_deposit.maturity_date>v_today_kst THEN RETURN false; END IF;

  v_rate:=v_deposit.interest_rate;
  IF v_rate IS NULL OR v_rate<0 THEN
    RAISE EXCEPTION 'Stored deposit interest rate is invalid: %',v_rate USING ERRCODE='P0243';
  END IF;

  v_interest:=FLOOR(v_deposit.principal::numeric*v_rate/100)::bigint;
  v_tax:=public.calculate_income_tax_for_student(v_interest,v_deposit.student_id);
  v_net_interest:=v_interest-v_tax;

  v_tx_id:=public.create_transaction(
    v_deposit.student_id,'GOLD',v_deposit.principal+v_net_interest,
    'DEPOSIT_MATURITY',v_deposit.id::bigint,v_tax,
    format('[예금 만기] %s · %s주 · 기본 %s%% + 컬렉션 %s%%p = 적용 %s%% · 원금 %s + 순이자 %s (세금 %s)',
      v_deposit.product_name_snapshot,v_deposit.deposit_weeks,
      v_deposit.base_interest_rate_snapshot,v_deposit.collection_bonus_pp_snapshot,
      v_rate,v_deposit.principal,v_net_interest,v_tax)
  );

  IF v_tax>0 THEN
    PERFORM public.collect_to_welfare_fund(
      v_deposit.classroom_id,v_tax,'INCOME_TAX'::public.transaction_source_type,v_tx_id
    );
  END IF;

  UPDATE public.student_deposits
  SET status='MATURED',
      interest_paid=v_net_interest::integer,
      processed_at=now(),
      transaction_id_payout=v_tx_id
  WHERE id=p_deposit_id AND status='ACTIVE';

  IF NOT FOUND THEN
    RAISE EXCEPTION '예금이 이미 처리됐습니다.' USING ERRCODE='P0241';
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_matured_deposits(p_classroom_id integer DEFAULT NULL::integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_deposit_id integer;
    v_processed integer := 0;
    v_today_kst date := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
    PERFORM public.ensure_teacher_role();

    FOR v_deposit_id IN
        SELECT id
        FROM public.student_deposits
        WHERE status='ACTIVE'
          AND maturity_date<=v_today_kst
          AND (p_classroom_id IS NULL OR classroom_id=p_classroom_id)
        ORDER BY maturity_date,id
    LOOP
        BEGIN
            IF public.process_single_deposit_maturity(v_deposit_id) THEN
                v_processed:=v_processed+1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '예금 % 만기 처리 실패: %',v_deposit_id,SQLERRM;
        END;
    END LOOP;

    RETURN v_processed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_matured_deposits_cron()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_deposit_id integer;
    v_processed integer := 0;
    v_today_kst date := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
    FOR v_deposit_id IN
        SELECT id
        FROM public.student_deposits
        WHERE status='ACTIVE'
          AND maturity_date<=v_today_kst
        ORDER BY maturity_date,id
    LOOP
        BEGIN
            IF public.process_single_deposit_maturity(v_deposit_id) THEN
                v_processed:=v_processed+1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '자동 예금 만기 처리 실패 [deposit_id=%]: %',v_deposit_id,SQLERRM;
        END;
    END LOOP;

    RETURN v_processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_matured_deposits_cron()
FROM PUBLIC, anon, authenticated, service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='brand_deposit_maturity') THEN
    PERFORM cron.unschedule('brand_deposit_maturity');
  END IF;
END
$do$;

SELECT cron.schedule(
  'brand_deposit_maturity',
  '*/5 * * * *',
  'SELECT public.process_matured_deposits_cron();'
);

COMMENT ON FUNCTION public.process_matured_deposits_cron()
IS 'Cron-only fixed-deposit maturity settlement. Uses Asia/Seoul date and retries every 5 minutes.';

NOTIFY pgrst, 'reload schema';
