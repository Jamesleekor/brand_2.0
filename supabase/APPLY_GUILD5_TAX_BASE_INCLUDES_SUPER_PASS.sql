-- =============================================================================
-- B.R.A.N.D 2.0 · Guild5 영토세 과세 기준에 SUPER PASS 포함
--
-- 운영 결정(2026-11-19): 슈퍼패스는 GOLD와 같다고 보고 영토세 과세 대상에 포함한다.
--   슈퍼패스 환산가: 자리 2,000G · 급식순서 1,500G · 1인1역 2,500G (guild5_super_pass_unit_value)
--   낙찰 1건의 과세 대상 = 낙찰가(GOLD) + 그 낙찰에 소모된 슈퍼패스 장수 × 환산가
--   세금 = 버림( 과세 대상 × 실효세율 )
--
-- 변경 범위
--   * guild5_territory_tax_assessments 에 컬럼 3개 추가 (증분, 기존 행은 건드리지 않음)
--       super_pass_count / super_pass_equivalent_value / includes_super_pass
--       기존 행(2026-10 정산분)은 includes_super_pass=false 로 남아 'GOLD만 과세된 기록'임을 구분한다.
--   * guild5_assess_result_with_rate_internal 교체 (시그니처·권한 동일)
--   * 이미 걷은 세금, 이미 한 분배는 수정하지 않는다. (과거 이력 rewrite 없음)
-- =============================================================================
BEGIN;

ALTER TABLE public.guild5_territory_tax_assessments
  ADD COLUMN IF NOT EXISTS super_pass_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS super_pass_equivalent_value bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS includes_super_pass boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.guild5_territory_tax_assessments.includes_super_pass IS
  'true: 과세 대상에 슈퍼패스 환산액이 포함된 과세(2026-11 이후). false: GOLD 낙찰가만 과세된 과거 기록.';
COMMENT ON COLUMN public.guild5_territory_tax_assessments.super_pass_equivalent_value IS
  '이 낙찰에 소모된 슈퍼패스의 GOLD 환산액. includes_super_pass=true 인 행에서만 과세 대상에 들어간다.';

CREATE OR REPLACE FUNCTION public.guild5_assess_result_with_rate_internal(
  p_auction_result_id integer,
  p_settlement_id bigint,
  p_rate_percent numeric,
  p_surcharge_pp numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_result public.auction_results%ROWTYPE;
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_year_month text;
  v_reduction numeric:=0;
  v_effective numeric:=0;
  v_tax bigint:=0;
  v_deduct jsonb;
  v_collected bigint:=0;
  v_outstanding bigint:=0;
  v_pass_count integer:=0;
  v_pass_value bigint:=0;
  v_base bigint:=0;
  v_tx_id bigint:=null;
  v_arrear_id bigint:=null;
  v_status text:='PAID';
  v_new_id bigint;
BEGIN
  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] settlement not found.' USING ERRCODE='P0560';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.guild5_territory_tax_assessments
    WHERE auction_result_id=p_auction_result_id AND voided_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status','ALREADY_ASSESSED','auction_result_id',p_auction_result_id);
  END IF;

  SELECT * INTO v_result FROM public.auction_results WHERE id=p_auction_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] auction result not found.' USING ERRCODE='P0553';
  END IF;
  SELECT * INTO v_item FROM public.auction_items WHERE id=v_result.auction_item_id;
  SELECT * INTO v_auction FROM public.auctions WHERE id=v_item.auction_id;

  IF v_auction.classroom_id IS DISTINCT FROM v_s.classroom_id THEN
    RAISE EXCEPTION '[G5 TAX] classroom mismatch.' USING ERRCODE='P0554';
  END IF;
  IF v_item.category IS DISTINCT FROM v_s.auction_category THEN
    RETURN jsonb_build_object('status','CATEGORY_MISMATCH','auction_result_id',p_auction_result_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.id=v_result.transaction_id AND tx.is_reversed) THEN
    RETURN jsonb_build_object('status','SKIPPED_REVERSED','auction_result_id',p_auction_result_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.students st WHERE st.id=v_result.winner_student_id AND st.transferred_at IS NOT NULL) THEN
    RETURN jsonb_build_object('status','SKIPPED_TRANSFERRED','auction_result_id',p_auction_result_id);
  END IF;

  SELECT c.year_month INTO v_year_month FROM public.guild5_month_closures c WHERE c.id=v_s.closure_id;

  v_reduction:=greatest(0,public.collection_buff_value(v_result.winner_student_id,'TAX_RATE_REDUCTION_PP'));
  v_effective:=greatest(0,least(100,coalesce(p_rate_percent,0)+coalesce(p_surcharge_pp,0)-v_reduction));

  -- 이 낙찰 건에 실제로 소모된 SUPER PASS (낙찰 항목 + 낙찰자 + 같은 시도). 슈퍼패스는 환산가만큼의 GOLD로 보고 과세한다.
  SELECT count(*)::integer INTO v_pass_count
  FROM public.auction_super_pass_entries e
  WHERE e.auction_item_id=v_result.auction_item_id
    AND e.student_id=v_result.winner_student_id
    AND e.attempt_number=v_result.attempt_number
    AND e.status='WINNER_CONSUMED';
  v_pass_value:=v_pass_count::bigint*public.guild5_super_pass_unit_value(v_item.category::text);
  v_base:=v_result.final_price::bigint+v_pass_value;

  v_tax:=floor(v_base::numeric*v_effective/100)::bigint;

  IF v_tax>0 THEN
    v_deduct:=public._teacher_apply_asset_deduction(
      v_result.winner_student_id,
      'GOLD'::public.value_token_type,
      v_tax,
      format(
        '[Guild5 영토세] %s · %s 점령 %s · 경매 %s회차 %s · 낙찰가 %s GOLD%s × 실효세율 %s%%%s',
        v_s.territory_name_snapshot,
        coalesce(v_year_month,''),
        v_s.owner_guild_name_snapshot,
        v_auction.round_number,
        v_s.auction_category,
        v_result.final_price,
        CASE WHEN v_pass_count>0
          THEN format(' + 슈퍼패스 %s장(환산 %s GOLD)',v_pass_count,v_pass_value)
          ELSE '' END,
        trim(to_char(v_effective,'FM999990.00')),
        CASE WHEN coalesce(p_surcharge_pp,0)>0
          THEN format(' (이의 제기 부결 가산 +%s%%p 포함)',trim(to_char(p_surcharge_pp,'FM999990.##')))
          ELSE '' END
      )
    );
    v_collected:=coalesce((v_deduct->>'collected_amount')::bigint,0);
    v_outstanding:=coalesce((v_deduct->>'outstanding_amount')::bigint,0);
    v_tx_id:=nullif(v_deduct->>'transaction_id','')::bigint;
    v_arrear_id:=nullif(v_deduct->>'arrear_id','')::bigint;
    v_status:=CASE WHEN v_outstanding<=0 THEN 'PAID' WHEN v_collected>0 THEN 'PARTIAL' ELSE 'UNPAID' END;

    IF v_tx_id IS NOT NULL THEN
      UPDATE public.transactions SET tax_amount=v_collected WHERE id=v_tx_id;
    END IF;
  END IF;

  INSERT INTO public.guild5_territory_tax_assessments(
    classroom_id,closure_id,version_id,conquest_turn_id,owner_guild_id,
    territory_id,territory_slot_no,territory_name_snapshot,
    auction_id,auction_result_id,auction_item_id,auction_category,
    student_id,final_price,territory_tax_rate_percent,tax_reduction_pp,
    effective_tax_rate_percent,tax_amount,collected_amount_at_assessment,
    transaction_id,arrear_id,assessment_mode,status_at_assessment,
    objection_surcharge_pp,rate_settlement_id,
    super_pass_count,super_pass_equivalent_value,includes_super_pass
  ) VALUES (
    v_s.classroom_id,v_s.closure_id,v_s.version_id,v_s.conquest_turn_id,v_s.owner_guild_id,
    v_s.territory_id,v_s.territory_slot_no,v_s.territory_name_snapshot,
    v_auction.id,v_result.id,v_item.id,v_s.auction_category,
    v_result.winner_student_id,v_result.final_price,p_rate_percent,v_reduction,
    v_effective,v_tax,v_collected,v_tx_id,v_arrear_id,'RETROACTIVE',v_status,
    coalesce(p_surcharge_pp,0),v_s.id,
    v_pass_count,v_pass_value,true
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'status','ASSESSED',
    'assessment_id',v_new_id,
    'student_id',v_result.winner_student_id,
    'tax_amount',v_tax,
    'tax_base',v_base,
    'super_pass_count',v_pass_count,
    'super_pass_equivalent_value',v_pass_value,
    'collected_amount',v_collected,
    'outstanding_amount',v_outstanding,
    'surcharge_pp',coalesce(p_surcharge_pp,0),
    'effective_tax_rate_percent',v_effective
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.guild5_assess_result_with_rate_internal(integer,bigint,numeric,numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guild5_assess_result_with_rate_internal(integer,bigint,numeric,numeric) IS
  '확정 세율로 낙찰 1건 과세. 과세 대상 = 낙찰가(GOLD) + 소모된 슈퍼패스 환산액 (2026-11-19 이후).';

COMMIT;
