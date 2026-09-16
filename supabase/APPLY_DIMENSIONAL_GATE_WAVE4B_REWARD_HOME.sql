-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 4B Reward + Home Entitlements
-- Requires Wave 1~3 and committed Wave 4A enum values.
-- Prepared: 2026-09-15
-- =====================================================================

begin;

alter table public.dimensional_gate_reward_claims
  add column if not exists transaction_ids jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Internal: resolve character-specific reward first, then global fallback.
-- ---------------------------------------------------------------------
create or replace function public.dimensional_gate_resolved_reward_rule(
  p_character_id bigint,
  p_affinity_threshold integer
)
returns public.dimensional_gate_reward_rules
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select r
  from public.dimensional_gate_reward_rules r
  where r.is_active=true
    and r.affinity_threshold=p_affinity_threshold
    and (r.character_id=p_character_id or r.character_id is null)
  order by (r.character_id is not null) desc
  limit 1;
$function$;

revoke all on function public.dimensional_gate_resolved_reward_rule(bigint,integer) from public, anon, authenticated;
grant execute on function public.dimensional_gate_resolved_reward_rule(bigint,integer) to service_role;

-- ---------------------------------------------------------------------
-- Internal: grant linked home background ownership idempotently.
-- ---------------------------------------------------------------------
create or replace function public.dimensional_gate_grant_gallery_background(
  p_student_id integer,
  p_gallery_asset_id bigint
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_item_id integer;
  v_ownership_id bigint;
begin
  select ga.cosmetic_item_id
  into v_item_id
  from public.dimensional_gate_gallery_assets ga
  where ga.id=p_gallery_asset_id
    and ga.home_background_allowed=true
    and ga.cosmetic_item_id is not null;

  if v_item_id is null then return null; end if;

  select sco.id into v_ownership_id
  from public.student_cosmetic_ownerships sco
  where sco.student_id=p_student_id and sco.item_id=v_item_id
  limit 1;

  if v_ownership_id is not null then return v_ownership_id; end if;

  insert into public.student_cosmetic_ownerships(student_id,item_id,obtained_via,is_equipped,purchased_at)
  values(p_student_id,v_item_id,'STORY_REWARD'::public.cosmetic_obtained_via,false,now())
  on conflict do nothing
  returning id into v_ownership_id;

  if v_ownership_id is null then
    select sco.id into v_ownership_id
    from public.student_cosmetic_ownerships sco
    where sco.student_id=p_student_id and sco.item_id=v_item_id
    limit 1;
  end if;

  return v_ownership_id;
end;
$function$;

revoke all on function public.dimensional_gate_grant_gallery_background(integer,bigint) from public, anon, authenticated;
grant execute on function public.dimensional_gate_grant_gallery_background(integer,bigint) to service_role;

-- ---------------------------------------------------------------------
-- Replace milestone synchronizer:
-- - memory unlocks are permanent
-- - affinity SPECIAL_CG is permanently recorded
-- - linked home backgrounds are granted
-- - only the resolved 100-point reward variant is trust-gated
-- ---------------------------------------------------------------------
create or replace function public.dimensional_gate_sync_milestone_unlocks(
  p_student_id integer,
  p_character_id bigint,
  p_affinity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_affinity integer := greatest(0, least(coalesce(p_affinity,0),100));
  v_asset record;
  v_rule public.dimensional_gate_reward_rules%rowtype;
begin
  if p_student_id is null or p_character_id is null then
    raise exception 'Student and character are required' using errcode='PDG30';
  end if;

  insert into public.dimensional_gate_memory_unlocks(student_id,character_id,memory_no,unlocked_at,source)
  select p_student_id,m.character_id,m.memory_no,now(),'AFFINITY_MILESTONE'
  from public.dimensional_gate_memories m
  where m.character_id=p_character_id and m.is_active=true and m.unlock_affinity<=v_affinity
  on conflict(student_id,character_id,memory_no) do nothing;

  for v_asset in
    select ga.id
    from public.dimensional_gate_gallery_assets ga
    where ga.character_id=p_character_id
      and ga.asset_type='SPECIAL_CG'
      and ga.unlock_affinity is not null
      and ga.unlock_affinity<=v_affinity
  loop
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(p_student_id,v_asset.id,'AFFINITY_MILESTONE',now())
    on conflict(student_id,gallery_asset_id) do nothing;
    perform public.dimensional_gate_grant_gallery_background(p_student_id,v_asset.id);
  end loop;

  if v_affinity>=100 then
    select * into v_rule
    from public.dimensional_gate_resolved_reward_rule(p_character_id,100);
    if found and v_rule.trust_visual_variant_no is not null then
      insert into public.dimensional_gate_visual_unlocks(student_id,character_id,visual_variant_no,unlock_type,unlocked_at)
      values(p_student_id,p_character_id,v_rule.trust_visual_variant_no,'TRUST_100',now())
      on conflict(student_id,character_id,visual_variant_no) do nothing;
    end if;
  end if;
end;
$function$;

revoke all on function public.dimensional_gate_sync_milestone_unlocks(integer,bigint,integer) from public, anon, authenticated;
grant execute on function public.dimensional_gate_sync_milestone_unlocks(integer,bigint,integer) to service_role;

-- ---------------------------------------------------------------------
-- Student reward status.
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_rewards(p_character_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_affinity integer;
  v_start_affinity integer;
  v_rewards jsonb;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;
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

  with thresholds(threshold) as (values (40),(70),(100)),
  resolved as (
    select t.threshold,
      (select rr.id from public.dimensional_gate_reward_rules rr where rr.is_active=true and rr.affinity_threshold=t.threshold and (rr.character_id=p_character_id or rr.character_id is null) order by (rr.character_id is not null) desc limit 1) rule_id
    from thresholds t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'affinity_threshold',r.affinity_threshold,
    'reward_gold',r.reward_gold,
    'reward_crystal',r.reward_crystal,
    'reward_bv',r.reward_bv,
    'gallery_asset_id',r.gallery_asset_id,
    'trust_visual_variant_no',r.trust_visual_variant_no,
    'reached',v_affinity>=r.affinity_threshold,
    'claimed',c.id is not null,
    'claimed_at',c.claimed_at
  ) order by r.affinity_threshold),'[]'::jsonb)
  into v_rewards
  from resolved x
  join public.dimensional_gate_reward_rules r on r.id=x.rule_id
  left join public.dimensional_gate_reward_claims c
    on c.student_id=v_student_id and c.character_id=p_character_id and c.affinity_threshold=r.affinity_threshold;

  return jsonb_build_object('affinity',v_affinity,'rewards',v_rewards);
end;
$function$;

revoke all on function public.student_get_dimensional_gate_rewards(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_rewards(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Manual economic reward claim. Entitlements are synced separately and are
-- permanent. Duplicate claim is blocked by unique(student,character,threshold).
-- ---------------------------------------------------------------------
create or replace function public.student_claim_dimensional_gate_reward(
  p_character_id bigint,
  p_affinity_threshold integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    perform public.dimensional_gate_grant_gallery_background(v_student_id,v_rule.gallery_asset_id);
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

revoke all on function public.student_claim_dimensional_gate_reward(bigint,integer) from public, anon;
grant execute on function public.student_claim_dimensional_gate_reward(bigint,integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Student visual entitlement map used by HomeCustomizationPanel.
-- Only the resolved 100 reward's variant is gated; all other registered image
-- variants stay immediately usable (important for current premium fragments).
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_visual_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_result jsonb;
begin
  v_student_id:=public.current_student_id();
  if v_student_id is null then raise exception 'Student context not found' using errcode='PDG20'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'character_id',c.id,
    'gated_visual_variant_no',gate.gated_variant,
    'unlocked_visual_variants',jsonb_build_array(1)
      || case when c.showcase_image_url_2 is not null and (gate.gated_variant is distinct from 2 or vu2.id is not null) then jsonb_build_array(2) else '[]'::jsonb end
      || case when c.showcase_image_url_3 is not null and (gate.gated_variant is distinct from 3 or vu3.id is not null) then jsonb_build_array(3) else '[]'::jsonb end
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
$function$;

revoke all on function public.student_get_dimensional_gate_visual_entitlements() from public, anon;
grant execute on function public.student_get_dimensional_gate_visual_entitlements() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Preserve existing home showcase behavior, adding exactly one new rule:
-- if the resolved trust reward designates this variant, require its unlock row.
-- ---------------------------------------------------------------------
create or replace function public.student_set_home_showcase_slot_visual(
  p_slot_no integer,
  p_character_id bigint,
  p_visual_variant_no integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_variant smallint;
  v_url_2 text;
  v_url_3 text;
  v_gated_variant smallint;
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

  select rr.trust_visual_variant_no into v_gated_variant
  from public.dimensional_gate_reward_rules rr
  where rr.is_active=true and rr.affinity_threshold=100 and (rr.character_id=p_character_id or rr.character_id is null)
  order by (rr.character_id is not null) desc limit 1;

  if v_variant>1 and v_gated_variant=v_variant and not exists(
    select 1 from public.dimensional_gate_visual_unlocks vu
    where vu.student_id=v_student_id and vu.character_id=p_character_id and vu.visual_variant_no=v_variant
  ) then
    raise exception 'Trust visual is not unlocked' using errcode='P0H27';
  end if;

  delete from public.student_home_showcase_slots
  where student_id=v_student_id and character_id=p_character_id and slot_no<>p_slot_no;

  insert into public.student_home_showcase_slots(student_id,slot_no,character_id,visual_variant_no,created_at,updated_at)
  values(v_student_id,p_slot_no::smallint,p_character_id,v_variant,now(),now())
  on conflict(student_id,slot_no) do update
    set character_id=excluded.character_id,visual_variant_no=excluded.visual_variant_no,updated_at=now();

  return public.student_get_home_personalization();
end;
$function$;

revoke all on function public.student_set_home_showcase_slot_visual(integer,bigint,integer) from public, anon;
grant execute on function public.student_set_home_showcase_slot_visual(integer,bigint,integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Replace story completion to bridge unlocked story CGs directly into the
-- existing cosmetic/background ownership system.
-- ---------------------------------------------------------------------
create or replace function public.student_complete_dimensional_gate_story(
  p_episode_id bigint,
  p_gallery_asset_ids bigint[] default '{}'::bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_character_id bigint;
  v_required_affinity integer;
  v_affinity integer;
  v_start_affinity integer;
  v_unlocked_count integer:=0;
  v_asset record;
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
  on conflict(student_id,episode_id) do update
    set opened_at=coalesce(public.dimensional_gate_story_progress.opened_at,excluded.opened_at),
        completed_at=coalesce(public.dimensional_gate_story_progress.completed_at,excluded.completed_at),updated_at=now();

  for v_asset in
    select ga.id
    from public.dimensional_gate_gallery_assets ga
    where ga.episode_id=p_episode_id and ga.asset_type='STORY_CG'
      and ga.id=any(coalesce(p_gallery_asset_ids,'{}'::bigint[]))
  loop
    insert into public.dimensional_gate_gallery_unlocks(student_id,gallery_asset_id,source,unlocked_at)
    values(v_student_id,v_asset.id,'STORY_COMPLETION',now())
    on conflict(student_id,gallery_asset_id) do nothing;
    if found then v_unlocked_count:=v_unlocked_count+1; end if;
    perform public.dimensional_gate_grant_gallery_background(v_student_id,v_asset.id);
  end loop;

  return jsonb_build_object('completed',true,'new_gallery_unlocks',v_unlocked_count);
end;
$function$;

revoke all on function public.student_complete_dimensional_gate_story(bigint,bigint[]) from public, anon;
grant execute on function public.student_complete_dimensional_gate_story(bigint,bigint[]) to authenticated, service_role;

commit;
