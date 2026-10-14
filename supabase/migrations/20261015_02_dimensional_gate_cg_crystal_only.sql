-- Dimension Gate home CGs can be purchased only with CRYSTAL.
CREATE OR REPLACE FUNCTION public.teacher_set_cosmetic_price(p_classroom_id integer, p_item_id integer, p_value_token text, p_price integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_token public.value_token_type;
  v_pricing_id integer;
begin
  perform public.character_teacher_require_classroom(p_classroom_id);
  if p_price is null or p_price < 1 or p_price > 100000000 then
    raise exception '가격은 1~100,000,000 사이여야 합니다.' using errcode = '22023';
  end if;
  if p_value_token not in ('GOLD', 'BV', 'CRYSTAL') then
    raise exception '지원하지 않는 화폐입니다.' using errcode = '22023';
  end if;
  if p_value_token <> 'CRYSTAL' and exists (
    select 1 from public.dimensional_gate_gallery_assets ga
    where ga.cosmetic_item_id=p_item_id and ga.is_active=true
      and ga.asset_type in ('STORY_CG','SPECIAL_CG')
  ) then
    raise exception '차원관문 CG 홈 배경은 크리스탈 가격만 설정할 수 있습니다.'
      using errcode='P0DG8';
  end if;
  v_token := p_value_token::public.value_token_type;
  perform 1 from public.cosmetic_items ci
  where ci.id = p_item_id
    and (ci.classroom_id is null or ci.classroom_id = p_classroom_id)
    and (lower(ci.category) = 'background' or exists (
      select 1 from public.expedition_luxury_catalog lc
      where lc.cosmetic_item_id = ci.id
    ))
  for update;
  if not found then
    raise exception '이 학급에서 가격을 설정할 수 없는 아이템입니다.' using errcode = '42501';
  end if;

  select cp.id into v_pricing_id
  from public.cosmetic_item_pricings cp
  where cp.item_id = p_item_id and cp.value_token = v_token
    and cp.condition_type = 'NONE'::public.cosmetic_condition_type
    and coalesce(cp.secondary_condition_type, 'NONE'::public.cosmetic_condition_type) = 'NONE'::public.cosmetic_condition_type
  order by cp.is_active desc, cp.id
  limit 1 for update;

  if v_pricing_id is null then
    insert into public.cosmetic_item_pricings(item_id, value_token, price, is_active)
    values (p_item_id, v_token, p_price, true)
    returning id into v_pricing_id;
  else
    update public.cosmetic_item_pricings
    set price = p_price, is_active = true
    where id = v_pricing_id;
  end if;
  return jsonb_build_object('pricing_id', v_pricing_id, 'item_id', p_item_id,
                            'value_token', v_token, 'price', p_price);
end;
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
        -v_pricing.price,
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
