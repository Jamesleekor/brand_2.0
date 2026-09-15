create function public.teacher_get_raid_detail(p_raid_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_classroom_id integer;
  v_result jsonb;
begin
  v_classroom_id := public.raid_teacher_require_raid(p_raid_id);

  select jsonb_build_object(
    'raid', jsonb_build_object(
      'id', r.id,
      'classroom_id', r.classroom_id,
      'title', r.title,
      'boss_name', r.boss_name,
      'boss_description', r.boss_description,
      'boss_element', r.boss_element,
      'status', r.status,
      'max_hp', r.max_hp,
      'current_hp', r.current_hp,
      'lobby_open_at', r.lobby_open_at,
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'completed_at', r.completed_at,
      'damage_coefficient', r.damage_coefficient,
      'variance_min', r.variance_min,
      'variance_max', r.variance_max,
      'crit_multiplier', r.crit_multiplier,
      'tap_rate_limit_per_second', r.tap_rate_limit_per_second,
      'chat_enabled', r.chat_enabled,
      'chat_slow_mode_seconds', r.chat_slow_mode_seconds,
      'include_test_accounts', r.include_test_accounts,
      'reward_config', r.reward_config,
      'metadata', r.metadata,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ),
    'phases', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rp.id,
          'phase_no', rp.phase_no,
          'hp_from_ratio', rp.hp_from_ratio,
          'hp_to_ratio', rp.hp_to_ratio,
          'boss_element', rp.boss_element,
          'image_url', rp.image_url,
          'loop_video_url', rp.loop_video_url,
          'damage_config', rp.damage_config,
          'metadata', rp.metadata,
          'hit_zones', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', hz.id,
                'zone_key', hz.zone_key,
                'name', hz.name,
                'shape', hz.shape,
                'x', hz.x,
                'y', hz.y,
                'width', hz.width,
                'height', hz.height,
                'damage_multiplier', hz.damage_multiplier,
                'weak_element', hz.weak_element,
                'element_multiplier', hz.element_multiplier,
                'is_active', hz.is_active,
                'is_visible_to_student', hz.is_visible_to_student,
                'priority', hz.priority
              ) order by hz.priority desc, hz.id
            )
            from public.raid_hit_zones hz
            where hz.raid_phase_id = rp.id
          ), '[]'::jsonb)
        ) order by rp.phase_no
      )
      from public.raid_phases rp
      where rp.raid_id = r.id
    ), '[]'::jsonb)
  ) into v_result
  from public.raids r
  where r.id = p_raid_id;

  if v_result is null then
    raise exception 'Raid not found' using errcode = 'P0202';
  end if;

  return v_result;
end;
$$;

revoke all on function public.teacher_get_raid_detail(bigint) from public, anon;
grant execute on function public.teacher_get_raid_detail(bigint) to authenticated, service_role;
