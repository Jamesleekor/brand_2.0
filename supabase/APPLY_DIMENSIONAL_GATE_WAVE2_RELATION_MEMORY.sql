-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 2 Relationship + Memory
-- Requires APPLY_DIMENSIONAL_GATE_WAVE1_CORE.sql
-- Prepared: 2026-09-15
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Internal milestone synchronizer.
-- A milestone unlock is permanent even if affinity later decreases.
-- Not directly callable by students.
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
begin
  if p_student_id is null or p_character_id is null then
    raise exception 'Student and character are required' using errcode='PDG30';
  end if;

  insert into public.dimensional_gate_memory_unlocks(student_id, character_id, memory_no, unlocked_at, source)
  select p_student_id, m.character_id, m.memory_no, now(), 'AFFINITY_MILESTONE'
  from public.dimensional_gate_memories m
  where m.character_id = p_character_id
    and m.is_active = true
    and m.unlock_affinity <= greatest(0, least(coalesce(p_affinity, 0), 100))
  on conflict (student_id, character_id, memory_no) do nothing;

  insert into public.dimensional_gate_visual_unlocks(student_id, character_id, visual_variant_no, unlock_type, unlocked_at)
  select p_student_id,
         p_character_id,
         r.trust_visual_variant_no,
         'TRUST_100',
         now()
  from public.dimensional_gate_reward_rules r
  where r.is_active = true
    and r.affinity_threshold <= greatest(0, least(coalesce(p_affinity, 0), 100))
    and r.trust_visual_variant_no is not null
    and (r.character_id = p_character_id or r.character_id is null)
  order by (r.character_id is not null) desc
  on conflict (student_id, character_id, visual_variant_no) do nothing;
end;
$function$;

revoke all on function public.dimensional_gate_sync_milestone_unlocks(integer,bigint,integer) from public, anon, authenticated;
grant execute on function public.dimensional_gate_sync_milestone_unlocks(integer,bigint,integer) to service_role;

-- ---------------------------------------------------------------------
-- Student character detail read.
-- Current affinity can expose a memory even before a permanent unlock row is
-- backfilled; once milestone mutation is implemented, unlock rows preserve it.
-- ---------------------------------------------------------------------
create or replace function public.student_get_dimensional_gate_character(p_character_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_affinity integer;
  v_profile public.dimensional_gate_character_profiles%rowtype;
  v_relationship public.dimensional_gate_relationships%rowtype;
  v_character public.characters%rowtype;
  v_memories jsonb;
begin
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();

  if v_student_id is null or v_classroom_id is null then
    raise exception 'Student context not found' using errcode='PDG20';
  end if;

  if p_character_id is null then
    raise exception 'Character is required' using errcode='PDG31';
  end if;

  select c.* into v_character
  from public.characters c
  join public.student_characters sc
    on sc.character_id = c.id
   and sc.student_id = v_student_id
   and sc.is_owned = true
  where c.id = p_character_id
    and c.is_active = true;

  if not found then
    raise exception 'Character not owned or inactive' using errcode='PDG22';
  end if;

  select p.* into v_profile
  from public.dimensional_gate_character_profiles p
  where p.character_id = p_character_id
    and p.is_active = true;

  select r.* into v_relationship
  from public.dimensional_gate_relationships r
  where r.student_id = v_student_id
    and r.character_id = p_character_id;

  v_affinity := coalesce(v_relationship.affinity, v_profile.start_affinity, 0);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memory_no', m.memory_no,
        'title', case when (mu.id is not null or v_affinity >= m.unlock_affinity) then m.title else null end,
        'content', case when (mu.id is not null or v_affinity >= m.unlock_affinity) then m.content else null end,
        'unlock_affinity', m.unlock_affinity,
        'unlocked', (mu.id is not null or v_affinity >= m.unlock_affinity),
        'permanently_unlocked', (mu.id is not null)
      )
      order by m.sort_order, m.memory_no
    ),
    '[]'::jsonb
  ) into v_memories
  from public.dimensional_gate_memories m
  left join public.dimensional_gate_memory_unlocks mu
    on mu.student_id = v_student_id
   and mu.character_id = p_character_id
   and mu.memory_no = m.memory_no
  where m.character_id = p_character_id
    and m.is_active = true;

  return jsonb_build_object(
    'character', jsonb_build_object(
      'character_id', v_character.id,
      'character_uid', v_character.character_uid,
      'name', v_character.name,
      'epithet', v_character.epithet,
      'description', v_character.description,
      'resource_kind', v_character.resource_kind,
      'resource_url', v_character.resource_url,
      'full_image_url', v_character.full_image_url,
      'card_image_url', v_character.card_image_url,
      'avatar_image_url', v_character.avatar_image_url
    ),
    'gate_enabled', (v_profile.character_id is not null),
    'relationship', jsonb_build_object(
      'affinity', v_affinity,
      'relation_stage', public.dimensional_gate_relation_stage(v_affinity),
      'status', coalesce(v_relationship.status, 'NORMAL'),
      'warning_count', coalesce(v_relationship.warning_count, 0),
      'daily_chat_limit', coalesce(v_profile.daily_chat_limit, 3),
      'chat_count', case when v_relationship.chat_date = current_date then coalesce(v_relationship.chat_count, 0) else 0 end,
      'remaining_chat_count', case
        when v_relationship.chat_date = current_date then greatest(coalesce(v_profile.daily_chat_limit, 3) - coalesce(v_relationship.chat_count, 0), 0)
        else coalesce(v_profile.daily_chat_limit, 3)
      end,
      'last_interacted_at', v_relationship.last_interacted_at
    ),
    'memories', v_memories
  );
end;
$function$;

revoke all on function public.student_get_dimensional_gate_character(bigint) from public, anon;
grant execute on function public.student_get_dimensional_gate_character(bigint) to authenticated, service_role;

commit;
