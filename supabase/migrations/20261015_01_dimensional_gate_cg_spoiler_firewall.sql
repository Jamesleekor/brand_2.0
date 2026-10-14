-- B.R.A.N.D 2.0 / 2026-10-15
-- DIMENSIONAL GATE CG SPOILER FIREWALL
-- Live DB migration synced to the deployed Supabase function definitions.
-- Story/affinity unlocks reveal art in the Gallery but do not grant cosmetic ownership.
-- Home background cosmetics require a separately priced purchase (or explicit teacher grant).
-- Existing legacy STORY_REWARD and TEACHER_GRANT ownerships are intentionally not revoked.
-- No global prices or shop visibility flags are modified here.

CREATE OR REPLACE FUNCTION public._dimensional_gate_cosmetic_revealed(p_student_id integer, p_item_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT NOT EXISTS(
   SELECT 1 FROM public.dimensional_gate_gallery_assets ga
   WHERE ga.cosmetic_item_id=p_item_id AND ga.is_active=true
    AND ga.asset_type IN ('STORY_CG','SPECIAL_CG')
    AND NOT (
      EXISTS(SELECT 1 FROM public.dimensional_gate_gallery_unlocks gu
             WHERE gu.student_id=p_student_id AND gu.gallery_asset_id=ga.id)
      OR (ga.asset_type='SPECIAL_CG' AND ga.unlock_affinity IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.student_characters sc
        JOIN public.dimensional_gate_character_profiles dp
          ON dp.character_id=ga.character_id AND dp.is_active=true
        LEFT JOIN public.dimensional_gate_relationships r
          ON r.student_id=sc.student_id AND r.character_id=ga.character_id
        WHERE sc.student_id=p_student_id AND sc.character_id=ga.character_id
          AND sc.is_owned=true AND coalesce(r.affinity,dp.start_affinity,0)>=ga.unlock_affinity
      ))
      OR EXISTS(SELECT 1 FROM public.student_cosmetic_ownerships sco
                WHERE sco.student_id=p_student_id AND sco.item_id=p_item_id)
    )
 );
$function$;

CREATE OR REPLACE FUNCTION public.student_can_view_cosmetic(p_item_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.is_teacher_or_admin()
     OR public._dimensional_gate_cosmetic_revealed(public.current_student_id(),p_item_id);
$function$;

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
     jsonb_build_object('id',cp.id,'value_token',cp.value_token,'price',cp.price,
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

CREATE OR REPLACE FUNCTION public.student_complete_dimensional_gate_story(p_episode_id bigint, p_gallery_asset_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer; v_character_id bigint; v_required_affinity integer;
  v_affinity integer; v_start_affinity integer; v_unlocked_count integer:=0; v_asset record;
begin
  v_student_id:=public.current_student_id(); if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  select e.character_id,e.required_affinity into v_character_id,v_required_affinity from public.dimensional_gate_story_episodes e where e.id=p_episode_id and e.is_active=true;
  if not found then raise exception 'Story episode not found' using errcode='PDG40'; end if;
  if not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=v_character_id and sc.is_owned=true) then raise exception 'Character not owned' using errcode='PDG22'; end if;
  select p.start_affinity into v_start_affinity from public.dimensional_gate_character_profiles p where p.character_id=v_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;
  select coalesce(r.affinity,v_start_affinity,0) into v_affinity from (select 1) seed left join public.dimensional_gate_relationships r on r.student_id=v_student_id and r.character_id=v_character_id;
  if v_affinity<v_required_affinity then raise exception 'Story is locked' using errcode='PDG41'; end if;

  insert into public.dimensional_gate_story_progress(student_id,episode_id,opened_at,completed_at,updated_at)
  values(v_student_id,p_episode_id,now(),now(),now())
  on conflict(student_id,episode_id) do update set opened_at=coalesce(public.dimensional_gate_story_progress.opened_at,excluded.opened_at),completed_at=coalesce(public.dimensional_gate_story_progress.completed_at,excluded.completed_at),updated_at=now();

  for v_asset in select ga.id from public.dimensional_gate_gallery_assets ga
    where ga.episode_id=p_episode_id and ga.asset_type='STORY_CG' and ga.is_active=true
      and ga.id=any(coalesce(p_gallery_asset_ids,'{}'::bigint[]))
  loop
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(v_student_id,v_asset.id,'STORY_COMPLETION',now()) on conflict(student_id,gallery_asset_id) do nothing;
    if found then v_unlocked_count:=v_unlocked_count+1; end if;

  end loop;
  return jsonb_build_object('completed',true,'new_gallery_unlocks',v_unlocked_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.dimensional_gate_sync_milestone_unlocks(p_student_id integer, p_character_id bigint, p_affinity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_affinity integer:=greatest(0,least(coalesce(p_affinity,0),100));
  v_asset record; v_rule public.dimensional_gate_reward_rules%rowtype;
begin
  if p_student_id is null or p_character_id is null then raise exception 'Student and character are required' using errcode='PDG30'; end if;
  insert into public.dimensional_gate_memory_unlocks(student_id,character_id,memory_no,unlocked_at,source)
  select p_student_id,m.character_id,m.memory_no,now(),'AFFINITY_MILESTONE' from public.dimensional_gate_memories m
  where m.character_id=p_character_id and m.is_active=true and m.unlock_affinity<=v_affinity
  on conflict(student_id,character_id,memory_no) do nothing;

  for v_asset in select ga.id from public.dimensional_gate_gallery_assets ga
    where ga.character_id=p_character_id and ga.asset_type='SPECIAL_CG' and ga.is_active=true
      and ga.unlock_affinity is not null and ga.unlock_affinity<=v_affinity
  loop
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(p_student_id,v_asset.id,'AFFINITY_MILESTONE',now()) on conflict(student_id,gallery_asset_id) do nothing;

  end loop;

  if v_affinity>=100 then
    select * into v_rule from public.dimensional_gate_resolved_reward_rule(p_character_id,100);
    if found and v_rule.trust_visual_variant_no is not null then
      insert into public.dimensional_gate_visual_unlocks(student_id,character_id,visual_variant_no,unlock_type,unlocked_at)
      values(p_student_id,p_character_id,v_rule.trust_visual_variant_no,'TRUST_100',now())
      on conflict(student_id,character_id,visual_variant_no) do nothing;
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_claim_dimensional_gate_reward(p_character_id bigint, p_affinity_threshold integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer;
  v_affinity integer;
  v_start_affinity integer;
  v_rule public.dimensional_gate_reward_rules%rowtype;
  v_claim_id bigint;
  v_gold_tx bigint;
  v_crystal_tx bigint;
  v_bv_tx bigint;
  v_wallet jsonb;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
  if p_affinity_threshold not in (40,70,100) then raise exception 'Invalid reward threshold' using errcode='PDG50'; end if;

  if not exists(select 1 from public.student_characters sc where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select p.start_affinity into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id=p_character_id and p.is_active=true;
  if not found then raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23'; end if;

  select coalesce(r.affinity,v_start_affinity,0) into v_affinity
  from (select 1) seed left join public.dimensional_gate_relationships r
    on r.student_id=v_student_id and r.character_id=p_character_id;

  if v_affinity<p_affinity_threshold then raise exception 'Reward milestone not reached' using errcode='PDG51'; end if;

  select * into v_rule from public.dimensional_gate_resolved_reward_rule(p_character_id,p_affinity_threshold);
  if not found then raise exception 'Reward rule not configured' using errcode='PDG52'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_student_id::text||':'||p_character_id::text||':'||p_affinity_threshold::text,0));
  if exists(select 1 from public.dimensional_gate_reward_claims c where c.student_id=v_student_id and c.character_id=p_character_id and c.affinity_threshold=p_affinity_threshold) then
    raise exception 'Reward already claimed' using errcode='PDG53';
  end if;

  insert into public.dimensional_gate_reward_claims(student_id,character_id,affinity_threshold,claimed_at)
  values(v_student_id,p_character_id,p_affinity_threshold,now()) returning id into v_claim_id;

  if v_rule.reward_gold>0 then
    v_gold_tx:=public.create_transaction(v_student_id,'GOLD'::public.value_token_type,v_rule.reward_gold,'DIMENSIONAL_GATE_REWARD'::public.transaction_source_type,v_claim_id,0,'차원관문 호감도 '||p_affinity_threshold||' 보상');
  end if;
  if v_rule.reward_crystal>0 then
    v_crystal_tx:=public.create_transaction(v_student_id,'CRYSTAL'::public.value_token_type,v_rule.reward_crystal,'DIMENSIONAL_GATE_REWARD'::public.transaction_source_type,v_claim_id,0,'차원관문 호감도 '||p_affinity_threshold||' 보상');
  end if;
  if v_rule.reward_bv>0 then
    v_bv_tx:=public.create_transaction(v_student_id,'BV'::public.value_token_type,v_rule.reward_bv,'DIMENSIONAL_GATE_REWARD'::public.transaction_source_type,v_claim_id,0,'차원관문 호감도 '||p_affinity_threshold||' 보상');
  end if;

  update public.dimensional_gate_reward_claims
  set transaction_id=coalesce(v_gold_tx,v_crystal_tx,v_bv_tx),
      transaction_ids=jsonb_strip_nulls(jsonb_build_object('GOLD',v_gold_tx,'CRYSTAL',v_crystal_tx,'BV',v_bv_tx))
  where id=v_claim_id;

  if v_rule.gallery_asset_id is not null then
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(v_student_id,v_rule.gallery_asset_id,'REWARD_CLAIM',now())
    on conflict(student_id,gallery_asset_id) do nothing;

  end if;

  perform public.dimensional_gate_sync_milestone_unlocks(v_student_id,p_character_id,v_affinity);

  select jsonb_build_object('gold',w.gold,'crystal',w.crystal,'bv',w.bv) into v_wallet
  from public.wallets w where w.student_id=v_student_id;

  return jsonb_build_object(
    'claimed',true,
    'affinity_threshold',p_affinity_threshold,
    'reward_gold',v_rule.reward_gold,
    'reward_crystal',v_rule.reward_crystal,
    'reward_bv',v_rule.reward_bv,
    'trust_visual_variant_no',v_rule.trust_visual_variant_no,
    'wallet',v_wallet
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public._cosmetic_market_purchase_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.obtained_via = 'PURCHASE'::public.cosmetic_obtained_via THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cosmetic_items ci
      WHERE ci.id = NEW.item_id
        AND (ci.is_market_visible OR EXISTS (
          SELECT 1 FROM public.expedition_luxury_catalog lc
          WHERE lc.cosmetic_item_id = ci.id AND lc.is_active
        ))
    ) THEN
      RAISE EXCEPTION '현재 상점에 공개되지 않은 아이템입니다.' USING ERRCODE = '42501';
    END IF;

    -- Story CG ownership is separate from its gallery unlock.
    -- A student must have viewed the scene in the Dimensional Gate story first.
    IF EXISTS (
      SELECT 1 FROM public.dimensional_gate_gallery_assets ga
      WHERE ga.cosmetic_item_id = NEW.item_id
        AND ga.asset_type = 'STORY_CG'
        AND ga.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM public.dimensional_gate_gallery_unlocks gu
          WHERE gu.student_id = NEW.student_id
            AND gu.gallery_asset_id = ga.id
        )
    ) THEN
      RAISE EXCEPTION '스토리 CG는 먼저 해당 장면을 감상하고 화첩에서 해금해야 구매할 수 있습니다.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
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

REVOKE ALL ON FUNCTION public._dimensional_gate_cosmetic_revealed(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.student_can_view_cosmetic(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_view_cosmetic(integer) TO authenticated,anon;

DROP POLICY IF EXISTS cosmetic_story_cg_spoiler_guard ON public.cosmetic_items;
CREATE POLICY cosmetic_story_cg_spoiler_guard ON public.cosmetic_items
  AS RESTRICTIVE FOR SELECT TO PUBLIC
  USING (public.student_can_view_cosmetic(id));

REVOKE ALL ON FUNCTION public.student_get_cosmetic_store() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_get_cosmetic_store() TO authenticated;

REVOKE ALL ON FUNCTION public.dimensional_gate_grant_gallery_background(integer,bigint)
  FROM PUBLIC,anon,authenticated;
