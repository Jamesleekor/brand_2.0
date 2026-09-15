-- B.R.A.N.D 2.0 RAID V1 Phase C
-- Production version: 20260915034458
-- Presence carries only online student IDs.
-- Name/guild/equipped Shard are authoritative values from this RPC.

create or replace function public.get_raid_lobby_snapshot(p_raid_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student_id integer;
  v_result jsonb;
begin
  v_student_id := public.raid_current_student_for_raid(p_raid_id);

  select jsonb_build_object(
    'raid',jsonb_build_object(
      'id',r.id,
      'title',r.title,
      'boss_name',r.boss_name,
      'boss_description',r.boss_description,
      'boss_element',r.boss_element,
      'status',r.status,
      'max_hp',r.max_hp,
      'current_hp',r.current_hp,
      'chat_enabled',r.chat_enabled,
      'chat_slow_mode_seconds',r.chat_slow_mode_seconds,
      'lobby_open_at',r.lobby_open_at,
      'starts_at',r.starts_at,
      'ends_at',r.ends_at
    ),
    'me',(
      select jsonb_build_object(
        'student_id',s.id,
        'name',s.name,
        'brand_name',s.brand_name,
        'equipped_character_id',sp.equipped_character_id,
        'equipped_character_name',c.name,
        'equipped_character_image_url',coalesce(c.full_image_url,c.resource_url,c.card_image_url,c.avatar_image_url),
        'guild_id',g.id,
        'guild_name',g.name,
        'guild_logo_url',g.logo_url
      )
      from public.students s
      left join public.student_character_profiles sp on sp.student_id = s.id
      left join public.characters c on c.id = sp.equipped_character_id
      left join public.guild_members gm on gm.student_id = s.id and gm.left_at is null
      left join public.guilds g on g.id = gm.guild_id
      where s.id = v_student_id
    ),
    'roster',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id',s.id,
          'name',s.name,
          'brand_name',s.brand_name,
          'equipped_character_id',sp.equipped_character_id,
          'equipped_character_name',c.name,
          'equipped_character_image_url',coalesce(c.full_image_url,c.resource_url,c.card_image_url,c.avatar_image_url),
          'guild_id',g.id,
          'guild_name',g.name,
          'guild_logo_url',g.logo_url
        )
        order by coalesce(g.name::text,''), s.id
      )
      from public.students s
      left join public.student_character_profiles sp on sp.student_id = s.id
      left join public.characters c on c.id = sp.equipped_character_id
      left join public.guild_members gm on gm.student_id = s.id and gm.left_at is null
      left join public.guilds g on g.id = gm.guild_id
      where s.classroom_id = r.classroom_id
        and s.transferred_at is null
        and s.role::text = 'STUDENT'
        and (r.include_test_accounts or not s.is_test_account)
    ),'[]'::jsonb),
    'recent_messages',coalesce((
      select jsonb_agg(msg_row order by msg_row.created_at)
      from (
        select m.id,
               m.student_id,
               s.name::text as student_name,
               s.brand_name::text as brand_name,
               m.message,
               m.created_at
        from public.raid_lobby_messages m
        join public.students s on s.id = m.student_id
        where m.raid_id = p_raid_id
          and m.is_deleted = false
        order by m.created_at desc, m.id desc
        limit 50
      ) msg_row
    ),'[]'::jsonb)
  )
  into v_result
  from public.raids r
  where r.id = p_raid_id
    and r.status in ('LOBBY_OPEN','ACTIVE','PAUSED','COMPLETED','FAILED');

  if v_result is null then
    raise exception 'Raid lobby is not available' using errcode = 'P0215';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_raid_lobby_snapshot(bigint) from public, anon;
grant execute on function public.get_raid_lobby_snapshot(bigint) to authenticated, service_role;
