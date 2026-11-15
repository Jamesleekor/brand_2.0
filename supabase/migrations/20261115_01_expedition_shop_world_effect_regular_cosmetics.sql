-- B.R.A.N.D 2.0: SHOP Lv1/2/3 discounts non-luxury cosmetics.
-- Same server quote in student_get_cosmetic_store and purchase_cosmetic_item.
-- Font/background/other standard cosmetic items; any token; no luxury or fragment-restore discount.
CREATE OR REPLACE FUNCTION public._cosmetic_shop_effective_price(
  p_student_id integer, p_item_id integer, p_base_price integer
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_classroom_id integer;
  v_discount integer;
BEGIN
  IF p_base_price IS NULL OR p_base_price <= 0 OR p_student_id IS NULL THEN
    RETURN p_base_price;
  END IF;
  -- Every luxury-catalog item (even temporarily inactive) stays full price.
  IF EXISTS (SELECT 1 FROM public.expedition_luxury_catalog lc WHERE lc.cosmetic_item_id=p_item_id) THEN
    RETURN p_base_price;
  END IF;
  SELECT s.classroom_id INTO v_classroom_id
  FROM public.students s
  JOIN public.cosmetic_items ci
    ON ci.id=p_item_id AND (ci.classroom_id IS NULL OR ci.classroom_id=s.classroom_id)
  WHERE s.id=p_student_id AND s.transferred_at IS NULL AND s.role::text='STUDENT';
  IF v_classroom_id IS NULL THEN RETURN p_base_price; END IF;
  v_discount:=public._expedition_current_shop_discount_percent(v_classroom_id,clock_timestamp());
  RETURN CASE WHEN v_discount<=0 THEN p_base_price
    ELSE greatest(1,floor(p_base_price::numeric * (100-v_discount)::numeric / 100)::integer)
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public._cosmetic_shop_effective_price(integer,integer,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.student_get_cosmetic_store()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_student_id integer; v_classroom_id integer; v_rows jsonb;
BEGIN
 v_student_id:=public.current_student_id();
 IF v_student_id IS NULL OR auth.uid() IS NULL THEN
   RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PFC01';
 END IF;
 SELECT s.classroom_id INTO v_classroom_id FROM public.students s
 WHERE s.id=v_student_id AND s.user_id=auth.uid()
   AND s.transferred_at IS NULL AND s.role::text='STUDENT';
 IF v_classroom_id IS NULL THEN
   RAISE EXCEPTION '학생 계정을 확인할 수 없습니다.' USING ERRCODE='PFC05';
 END IF;
 SELECT coalesce(jsonb_agg(
   jsonb_build_object(
     'id',ci.id,
     'item_uid',CASE WHEN locked.is_locked THEN 'STORY_CG_LOCKED_'||ci.id::text ELSE ci.item_uid END,
     'name',CASE WHEN locked.is_locked THEN '??? · 미공개 CG' ELSE ci.name END,
     'description',CASE WHEN locked.is_locked THEN
       '해당 편린의 화첩에서 이 장면을 먼저 해금하면 그림과 구매 옵션이 공개됩니다.'
       ELSE ci.description END,
     'category',ci.category,
     'resource_url',CASE WHEN locked.is_locked THEN NULL ELSE ci.resource_url END,
     'is_market_visible',ci.is_market_visible,
     'gallery_locked',locked.is_locked,
     'pricing',CASE WHEN locked.is_locked THEN '[]'::jsonb ELSE prices.options END,
     'is_owned',sco.id IS NOT NULL,
     'is_equipped',coalesce(sco.is_equipped,false),
     'ownership_id',sco.id
   ) ORDER BY ci.id
 ),'[]'::jsonb) INTO v_rows
 FROM public.cosmetic_items ci
 LEFT JOIN public.student_cosmetic_ownerships sco
   ON sco.student_id=v_student_id AND sco.item_id=ci.id
 CROSS JOIN LATERAL (
   SELECT NOT public._dimensional_gate_cosmetic_revealed(v_student_id,ci.id) AS is_locked
 ) locked
 LEFT JOIN LATERAL (
   SELECT coalesce(jsonb_agg(
     jsonb_build_object('id',cp.id,'value_token',cp.value_token,
        'price',public._cosmetic_shop_effective_price(v_student_id,ci.id,cp.price),
        'original_price',cp.price,
        'world_discount_percent',CASE
          WHEN EXISTS (SELECT 1 FROM public.expedition_luxury_catalog lx WHERE lx.cosmetic_item_id=ci.id) THEN 0
          ELSE public._expedition_current_shop_discount_percent(v_classroom_id,clock_timestamp())
        END,
        'condition_description',cp.condition_description,'is_active',cp.is_active)
      ORDER BY cp.id
   ),'[]'::jsonb) options
   FROM public.cosmetic_item_pricings cp
   WHERE cp.item_id=ci.id AND cp.is_active=true
 ) prices ON true
 WHERE ci.is_active=true
   AND (ci.classroom_id IS NULL OR ci.classroom_id=v_classroom_id)
   AND (ci.is_market_visible=true OR sco.id IS NOT NULL);
 RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_cosmetic_item(p_student_id integer, p_item_id integer, p_pricing_id integer)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_pricing           cosmetic_item_pricings%ROWTYPE;
    v_item              cosmetic_items%ROWTYPE;
    v_seasonal          seasonal_items%ROWTYPE;
    v_can_buy_1         BOOLEAN;
    v_can_buy_2         BOOLEAN;
    v_tx_id             BIGINT;
    v_ownership_id      BIGINT;
BEGIN
    if not public._luxury_character_requirement_met(p_student_id,p_item_id) then
      raise exception '먼저 해당 원본 편린을 보유해야 구매할 수 있습니다.' using errcode='P0HV1';
    end if;
    if not public._dimensional_gate_cosmetic_revealed(p_student_id,p_item_id) then
      raise exception '차원관문 화첩에서 이 CG를 먼저 해금해야 구매할 수 있습니다.'
        using errcode='P0DG7';
    end if;
    -- 1. 가격 옵션 조회 + 잠금
    SELECT * INTO v_pricing FROM cosmetic_item_pricings 
    WHERE id = p_pricing_id AND is_active = TRUE
    FOR UPDATE;
    
    IF v_pricing.id IS NULL THEN
        RAISE EXCEPTION 'Pricing option not found' USING ERRCODE = 'P0170';
    END IF;
    
    IF v_pricing.item_id != p_item_id THEN
        RAISE EXCEPTION 'Pricing does not match item' USING ERRCODE = 'P0171';
    END IF;
    
    if v_pricing.value_token <> 'CRYSTAL'::public.value_token_type
       and exists (
         select 1 from public.dimensional_gate_gallery_assets ga
         where ga.cosmetic_item_id=p_item_id and ga.is_active=true
           and ga.asset_type in ('STORY_CG','SPECIAL_CG')
       ) then
      raise exception '차원관문 CG 홈 배경은 크리스탈로만 구매할 수 있습니다.'
        using errcode='P0DG8';
    end if;
    -- 2. 아이템 조회
    SELECT * INTO v_item FROM cosmetic_items 
    WHERE id = p_item_id AND is_active = TRUE;
    
    IF v_item.id IS NULL THEN
        RAISE EXCEPTION 'Cosmetic item not found or inactive' USING ERRCODE = 'P0172';
    END IF;
    
    -- 3. 구매 조건 검증 (1차 + 2차 — AND 로직)
    v_can_buy_1 := check_purchase_condition(
        p_student_id, 
        v_pricing.condition_type, 
        v_pricing.condition_value
    );
    
    IF NOT v_can_buy_1 THEN
        RAISE EXCEPTION 'Purchase condition not met: %', 
            COALESCE(v_pricing.condition_description, '조건 미충족')
            USING ERRCODE = 'P0173';
    END IF;
    
    -- 2차 조건 (선택)
    IF v_pricing.secondary_condition_type IS NOT NULL 
       AND v_pricing.secondary_condition_type != 'NONE' THEN
        v_can_buy_2 := check_purchase_condition(
            p_student_id,
            v_pricing.secondary_condition_type,
            v_pricing.secondary_condition_value
        );
        
        IF NOT v_can_buy_2 THEN
            RAISE EXCEPTION 'Secondary condition not met' USING ERRCODE = 'P0174';
        END IF;
    END IF;
    
    -- 4. 시즌 한정 검증
    SELECT * INTO v_seasonal FROM seasonal_items 
    WHERE item_id = p_item_id;
    
    IF v_seasonal.id IS NOT NULL THEN
        IF NOT v_seasonal.is_active 
           OR NOW() < v_seasonal.available_from 
           OR NOW() > v_seasonal.available_until THEN
            RAISE EXCEPTION 'Seasonal item not currently available' 
                USING ERRCODE = 'P0175';
        END IF;
    END IF;
    
    -- 5. 중복 보유 검증
    IF EXISTS (
        SELECT 1 FROM student_cosmetic_ownerships
        WHERE student_id = p_student_id AND item_id = p_item_id
    ) THEN
        RAISE EXCEPTION 'Already owned' USING ERRCODE = 'P0176';
    END IF;
    
    -- 6. 화폐 차감 (Aggregate 패턴)
    v_tx_id := create_transaction(
        p_student_id,
        v_pricing.value_token,
        -public._cosmetic_shop_effective_price(p_student_id,p_item_id,v_pricing.price),
        'COSMETIC_PURCHASE',
        p_item_id,
        0,
        format('[꾸미기 구매] %s', v_item.name)
    );
    
    -- 7. 보유 기록
    INSERT INTO student_cosmetic_ownerships (
        student_id, item_id, transaction_id, obtained_via, is_equipped
    ) VALUES (
        p_student_id, p_item_id, v_tx_id, 'PURCHASE', FALSE
    ) RETURNING id INTO v_ownership_id;
    
    -- 8. 컬렉션 진행률 자동 갱신
    PERFORM update_collection_progress(p_student_id);
    
    -- 9. 세트 완성 검증·발동
    PERFORM check_set_completion(p_student_id, p_item_id);
    
    RETURN v_ownership_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
