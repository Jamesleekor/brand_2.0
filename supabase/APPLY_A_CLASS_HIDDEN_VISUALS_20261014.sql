-- A-class hidden character artwork; server entitlement is cosmetic ownership.
-- No character acquisition, raid stats, existing rewards or transactions are rewritten.
begin;
do $preflight$
begin
  if (select count(*) from public.characters where character_uid in ('CHAR-022','CHAR-012') and is_active)=2 then null;
  else raise exception 'Expected active Astell and Rumi'; end if;
  if exists(select 1 from public.characters where character_uid in ('CHAR-022','CHAR-012') and showcase_image_url_2 is not null) then
    raise exception 'Showcase slot 2 is already occupied; do not overwrite';
  end if;
  if exists(select 1 from public.cosmetic_items where item_uid in ('HIDDEN_ASTELL_PRESTIGE_2026','HIDDEN_RUMI_PRESTIGE_2026')) then
    raise exception 'Prestige products already exist; inspect before migrating';
  end if;
  if md5(pg_get_functiondef('public.purchase_cosmetic_item(integer,integer,integer)'::regprocedure)) <> '686e8f0ac246175c89b8b339dc1e1d00'
     or md5(pg_get_functiondef('public.student_get_expedition_luxury_shop()'::regprocedure)) <> '02d1dadd6135b85942719c0eacdb7453'
     or md5(pg_get_functiondef('public.student_get_dimensional_gate_visual_entitlements()'::regprocedure)) <> '4de40d79b60aa3559f8e2b5e26df02cc'
     or md5(pg_get_functiondef('public.student_get_home_personalization()'::regprocedure)) <> '20a47a3e1e01dcfdf9b7d156fb0ae641'
     or md5(pg_get_functiondef('public.student_set_home_showcase_slot_visual(integer,bigint,integer)'::regprocedure)) <> '9cea2deaadb387df96d3ed32dd42babc'
  then raise exception 'Live functions changed since preflight; no changes applied'; end if;
end;
$preflight$;

insert into public.cosmetic_items(item_uid,category,name,description,resource_url,is_active,is_market_visible)
values
('HIDDEN_ASTELL_PRESTIGE_2026','character_visual','아스텔(아스트라의 축복)','아스텔 보유자 전용 특별 히든 편린 이미지. 구매 후 홈 꾸미기에서 기본 이미지와 선택하여 전시할 수 있습니다.','https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/character/CHAR-022-Astell-Prestige.webp',true,false),
('HIDDEN_RUMI_PRESTIGE_2026','character_visual','루미(행복한 순간)','루미 보유자 전용 특별 히든 편린 이미지. 구매 후 홈 꾸미기에서 기본 이미지와 선택하여 전시할 수 있습니다.','https://raw.githubusercontent.com/Jamesleekor/brand-assets/refs/heads/main/character/CHAR-012-Rumi-Prestige.webp',true,false);

insert into public.expedition_luxury_catalog(cosmetic_item_id,luxury_group,required_effect_level,presentation_kind,is_active,metadata)
select ci.id,'A',1,'HIDDEN_SHARD_IMAGE',true,
 jsonb_build_object('required_character_uid',v.character_uid,'visual_variant_no',2,'trial_open',false)
from (values ('HIDDEN_ASTELL_PRESTIGE_2026','CHAR-022'),('HIDDEN_RUMI_PRESTIGE_2026','CHAR-012')) v(item_uid,character_uid)
join public.cosmetic_items ci on ci.item_uid=v.item_uid;

insert into public.cosmetic_item_pricings(item_id,value_token,price,condition_description,is_active)
select ci.id,'CRYSTAL',250,c.name || ' 편린 보유자만 구매할 수 있습니다.',true
from public.expedition_luxury_catalog lc
join public.cosmetic_items ci on ci.id=lc.cosmetic_item_id
join public.characters c on c.character_uid=lc.metadata->>'required_character_uid'
where ci.item_uid in ('HIDDEN_ASTELL_PRESTIGE_2026','HIDDEN_RUMI_PRESTIGE_2026');

update public.characters c
set showcase_image_url_2=ci.resource_url,updated_at=now()
from public.expedition_luxury_catalog lc join public.cosmetic_items ci on ci.id=lc.cosmetic_item_id
where c.character_uid=lc.metadata->>'required_character_uid'
  and ci.item_uid in ('HIDDEN_ASTELL_PRESTIGE_2026','HIDDEN_RUMI_PRESTIGE_2026');

-- Join the existing world-effect sale window; never open an extra trial or change B/C windows.
insert into public.seasonal_items(item_id,season_name,available_from,available_until,is_active)
select ci.id,format('편린 원정 명품관 · Week %s',effect.week_id),effect.starts_at,effect.ends_at,true
from public.cosmetic_items ci
cross join lateral (
 select e.week_id,e.starts_at,e.ends_at from public.expedition_world_effect_instances e
 where e.effect_code='COSMETIC' and e.effect_level>=1
   and clock_timestamp()>=e.starts_at and clock_timestamp()<e.ends_at
   and (ci.classroom_id is null or ci.classroom_id=e.classroom_id)
 order by e.starts_at desc,e.id desc limit 1
) effect
where ci.item_uid in ('HIDDEN_ASTELL_PRESTIGE_2026','HIDDEN_RUMI_PRESTIGE_2026');

create or replace function public._luxury_character_requirement_met(p_student_id integer,p_item_id integer)
returns boolean language sql stable security invoker set search_path=public,pg_temp
as $fn$
 select not exists (
  select 1 from public.expedition_luxury_catalog lc
  where lc.cosmetic_item_id=p_item_id and nullif(lc.metadata->>'required_character_uid','') is not null
  and not exists (
   select 1 from public.student_characters sc join public.characters c on c.id=sc.character_id
   where sc.student_id=p_student_id and sc.is_owned and c.is_active
     and c.character_uid=lc.metadata->>'required_character_uid'
  )
 );
$fn$;
revoke all on function public._luxury_character_requirement_met(integer,integer) from public,anon,authenticated;

create or replace function public._character_showcase_visual_allowed(p_student_id integer,p_character_id bigint,p_variant integer)
returns boolean language plpgsql stable security invoker set search_path=public,pg_temp
as $fn$
declare
 v_character public.characters%rowtype;
 v_item_id integer;
 v_gated_variant integer;
begin
 select c.* into v_character from public.characters c
 join public.student_characters sc on sc.character_id=c.id and sc.student_id=p_student_id and sc.is_owned
 where c.id=p_character_id and c.is_active;
 if not found then return false; end if;
 if p_variant=1 then return true; end if;
 if p_variant not in (2,3) or p_variant is null then return false; end if;
 if (p_variant=2 and nullif(btrim(v_character.showcase_image_url_2),'') is null)
 or (p_variant=3 and nullif(btrim(v_character.showcase_image_url_3),'') is null) then return false; end if;

 -- Retired products still confer a purchased entitlement; revocation removes it.
 select lc.cosmetic_item_id into v_item_id
 from public.expedition_luxury_catalog lc
 join public.cosmetic_items ci on ci.id=lc.cosmetic_item_id
 join public.students s on s.id=p_student_id
 where lc.presentation_kind='HIDDEN_SHARD_IMAGE'
   and lc.metadata->>'required_character_uid'=v_character.character_uid
   and lc.metadata->>'visual_variant_no'=p_variant::text
   and (ci.classroom_id is null or ci.classroom_id=s.classroom_id)
 order by lc.cosmetic_item_id limit 1;
 if found then
   return exists(select 1 from public.student_cosmetic_ownerships where student_id=p_student_id and item_id=v_item_id);
 end if;

 -- Preserve the existing trust reward rule for all non-luxury images.
 select rr.trust_visual_variant_no into v_gated_variant
 from public.dimensional_gate_reward_rules rr
 where rr.is_active and rr.affinity_threshold=100 and (rr.character_id=p_character_id or rr.character_id is null)
 order by (rr.character_id is not null) desc limit 1;
 return v_gated_variant is distinct from p_variant or exists (
  select 1 from public.dimensional_gate_visual_unlocks
  where student_id=p_student_id and character_id=p_character_id and visual_variant_no=p_variant
 );
end;
$fn$;
revoke all on function public._character_showcase_visual_allowed(integer,bigint,integer) from public,anon,authenticated;
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
$function$

CREATE OR REPLACE FUNCTION public.student_get_expedition_luxury_shop()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student public.students%rowtype;
  v_effect jsonb;
  v_access integer;
  v_trial_access integer;
  v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode='42501';
  end if;

  select * into v_student
  from public.students
  where user_id=auth.uid()
    and transferred_at is null
    and role::text='STUDENT';

  if not found then
    raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501';
  end if;

  v_effect:=public._expedition_active_world_effect(v_student.classroom_id,v_now);
  v_access:=public._expedition_current_cosmetic_access_level(v_student.classroom_id,v_now);
  select coalesce(max(lc.required_effect_level),0) into v_trial_access
  from public.expedition_luxury_catalog lc
  join public.cosmetic_items ci on ci.id=lc.cosmetic_item_id
  join public.seasonal_items si on si.item_id=ci.id
  where lc.is_active=true and ci.is_active=true
    and (ci.classroom_id is null or ci.classroom_id=v_student.classroom_id)
    and si.is_active=true and v_now between si.available_from and si.available_until
    and lc.metadata->>'trial_open'='true'
    and v_now<(lc.metadata->>'trial_until')::timestamptz;

  return jsonb_build_object(
    'open',(v_access>0 or v_trial_access>0),
    'access_level',greatest(v_access,v_trial_access),
    'trial_open',(v_trial_access>0),
    'active_effect',v_effect,
    'items',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id',ci.id,
          'item_uid',ci.item_uid,
          'name',ci.name,
          'description',ci.description,
          'resource_url',ci.resource_url,
          'category',ci.category,
          'luxury_group',lc.luxury_group,
          'required_effect_level',lc.required_effect_level,
          'presentation_kind',lc.presentation_kind,
          'purchase_eligible',public._luxury_character_requirement_met(v_student.id,ci.id),
          'required_character_name',(select c.name from public.characters c where c.character_uid=lc.metadata->>'required_character_uid'),
          'owned',exists(
            select 1 from public.student_cosmetic_ownerships sco
            where sco.student_id=v_student.id and sco.item_id=ci.id
          ),
          'pricing',coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'pricing_id',cp.id,
                'value_token',cp.value_token,
                'price',cp.price,
                'condition_description',cp.condition_description
              )
              order by cp.id
            )
            from public.cosmetic_item_pricings cp
            where cp.item_id=ci.id and cp.is_active=true
          ),'[]'::jsonb)
        )
        order by lc.required_effect_level,ci.name,ci.id
      )
      from public.expedition_luxury_catalog lc
      join public.cosmetic_items ci
        on ci.id=lc.cosmetic_item_id
       and ci.is_active=true
       and (ci.classroom_id is null or ci.classroom_id=v_student.classroom_id)
      join public.seasonal_items si
        on si.item_id=ci.id
       and si.is_active=true
       and v_now>=si.available_from
       and v_now<=si.available_until
      where lc.is_active=true
        and (lc.required_effect_level<=v_access or (
          lc.metadata->>'trial_open'='true'
          and v_now<(lc.metadata->>'trial_until')::timestamptz
        ))
    ),'[]'::jsonb),
    'assets_pending',not exists(
      select 1 from public.expedition_luxury_catalog where is_active=true
    )
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.student_get_dimensional_gate_visual_entitlements()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer;
  v_result jsonb;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'character_id',c.id,
    'gated_visual_variant_no',gate.gated_variant,
    'visual_variant_labels',coalesce((
      select jsonb_object_agg(lc.metadata->>'visual_variant_no',ci.name)
      from public.expedition_luxury_catalog lc join public.cosmetic_items ci on ci.id=lc.cosmetic_item_id
      where lc.presentation_kind='HIDDEN_SHARD_IMAGE' and lc.metadata->>'required_character_uid'=c.character_uid
    ),'{}'::jsonb),
    'unlocked_visual_variants',jsonb_build_array(1)
      || case when public._character_showcase_visual_allowed(v_student_id,c.id,2) then jsonb_build_array(2) else '[]'::jsonb end
      || case when public._character_showcase_visual_allowed(v_student_id,c.id,3) then jsonb_build_array(3) else '[]'::jsonb end
  ) order by c.sort_order,c.id),'[]'::jsonb)
  into v_result
  from public.student_characters sc
  join public.characters c on c.id=sc.character_id and c.is_active=true
  left join lateral (
    select rr.trust_visual_variant_no as gated_variant
    from public.dimensional_gate_reward_rules rr
    where rr.is_active=true and rr.affinity_threshold=100
      and (rr.character_id=c.id or rr.character_id is null)
    order by (rr.character_id is not null) desc
    limit 1
  ) gate on true
  left join public.dimensional_gate_visual_unlocks vu2 on vu2.student_id=v_student_id and vu2.character_id=c.id and vu2.visual_variant_no=2
  left join public.dimensional_gate_visual_unlocks vu3 on vu3.student_id=v_student_id and vu3.character_id=c.id and vu3.visual_variant_no=3
  where sc.student_id=v_student_id and sc.is_owned=true;

  return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.student_set_home_showcase_slot_visual(p_slot_no integer, p_character_id bigint, p_visual_variant_no integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer;
  v_variant smallint;
  v_url_2 text;
  v_url_3 text;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then raise exception 'Student session not found' using errcode='P0H22'; end if;

  if not exists(select 1 from public.students s where s.id=v_student_id and s.role::text='STUDENT' and s.transferred_at is null) then
    raise exception 'Student role required' using errcode='P0H25';
  end if;
  if p_slot_no is null or p_slot_no<1 or p_slot_no>3 then raise exception 'Showcase slot must be between 1 and 3' using errcode='P0H23'; end if;

  if p_character_id is null then
    delete from public.student_home_showcase_slots where student_id=v_student_id and slot_no=p_slot_no;
    return public.student_get_home_personalization();
  end if;

  if coalesce(p_visual_variant_no,1)<1 or coalesce(p_visual_variant_no,1)>3 then raise exception 'Visual variant must be between 1 and 3' using errcode='P0H26'; end if;
  v_variant:=coalesce(p_visual_variant_no,1)::smallint;

  select c.showcase_image_url_2,c.showcase_image_url_3 into v_url_2,v_url_3
  from public.student_characters sc join public.characters c on c.id=sc.character_id
  where sc.student_id=v_student_id and sc.character_id=p_character_id and sc.is_owned=true and c.is_active=true;
  if not found then raise exception 'Character not owned or inactive' using errcode='P0H24'; end if;

  if v_variant=2 and nullif(btrim(v_url_2),'') is null then raise exception 'Showcase image 2 is not available' using errcode='P0H26'; end if;
  if v_variant=3 and nullif(btrim(v_url_3),'') is null then raise exception 'Showcase image 3 is not available' using errcode='P0H26'; end if;

  if not public._character_showcase_visual_allowed(v_student_id,p_character_id,v_variant) then
    raise exception '아직 해금되지 않은 전시 이미지입니다. 명품관 구매 또는 신뢰 보상 조건을 확인해 주세요.' using errcode='P0H27';
  end if;

  delete from public.student_home_showcase_slots
  where student_id=v_student_id and character_id=p_character_id and slot_no<>p_slot_no;

  insert into public.student_home_showcase_slots(student_id,slot_no,character_id,visual_variant_no,created_at,updated_at)
  values(v_student_id,p_slot_no::smallint,p_character_id,v_variant,now(),now())
  on conflict(student_id,slot_no) do update
    set character_id=excluded.character_id,visual_variant_no=excluded.visual_variant_no,updated_at=now();

  return public.student_get_home_personalization();
end;
$function$

CREATE OR REPLACE FUNCTION public.student_get_home_personalization()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_background jsonb;
  v_slots jsonb;
begin
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();

  if v_student_id is null or v_classroom_id is null then
    raise exception 'Student context not found'
      using errcode='P0H20';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = v_student_id
      and s.classroom_id = v_classroom_id
      and s.role::text = 'STUDENT'
      and s.transferred_at is null
  ) then
    raise exception 'Student role required'
      using errcode='P0H25';
  end if;

  select jsonb_build_object(
    'item_id', ci.id,
    'ownership_id', sco.id,
    'name', ci.name,
    'resource_url', ci.resource_url
  )
  into v_background
  from public.student_cosmetic_ownerships sco
  join public.cosmetic_items ci
    on ci.id = sco.item_id
  where sco.student_id = v_student_id
    and sco.is_equipped = true
    and lower(ci.category::text) = 'background'
    and ci.is_active = true
    and (ci.classroom_id is null or ci.classroom_id = v_classroom_id)
  order by sco.purchased_at desc, sco.id desc
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slot_no', g.slot_no,
        'character_id', c.id,
        'character_uid', c.character_uid,
        'name', c.name,
        'epithet', c.epithet,
        'resource_kind', c.resource_kind,
        'resource_url', c.resource_url,
        'emoji', c.emoji,
        'full_image_url', c.full_image_url,
        'card_image_url', c.card_image_url,
        'avatar_image_url', c.avatar_image_url,
        'showcase_image_url_2', c.showcase_image_url_2,
        'showcase_image_url_3', c.showcase_image_url_3,
        'visual_variant_no', case when public._character_showcase_visual_allowed(v_student_id,c.id,coalesce(hs.visual_variant_no,1)) then coalesce(hs.visual_variant_no,1) else 1 end
      )
      order by g.slot_no
    ),
    '[]'::jsonb
  )
  into v_slots
  from generate_series(1,3) as g(slot_no)
  left join public.student_home_showcase_slots hs
    on hs.student_id = v_student_id
   and hs.slot_no = g.slot_no
  left join public.characters c
    on c.id = hs.character_id
   and c.is_active = true;

  return jsonb_build_object(
    'background', v_background,
    'showcase_slots', v_slots
  );
end;
$function$

notify pgrst, 'reload schema';
commit;

