-- Student raid archive: expose all non-test completed/failed/archive records and finisher summary.
-- Keeps existing active/recent fields for backward compatibility.

create or replace function public.get_raid_portal_summary()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_active jsonb;
  v_history jsonb;
  v_recent jsonb;
begin
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();

  if v_student_id is null or v_classroom_id is null then
    raise exception 'Student context not found' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'boss_name', r.boss_name,
    'boss_description', r.boss_description,
    'boss_element', r.boss_element,
    'status', r.status,
    'max_hp', r.max_hp,
    'current_hp', r.current_hp,
    'hp_ratio', case when r.max_hp > 0 then r.current_hp::numeric / r.max_hp::numeric else 0 end,
    'lobby_open_at', r.lobby_open_at,
    'starts_at', r.starts_at,
    'ends_at', r.ends_at,
    'completed_at', r.completed_at,
    'chat_enabled', r.chat_enabled,
    'phase_preview', (
      select jsonb_build_object(
        'phase_no', rp.phase_no,
        'image_url', rp.image_url,
        'loop_video_url', rp.loop_video_url
      )
      from public.raid_phases rp
      where rp.raid_id = r.id
      order by rp.phase_no
      limit 1
    )
  )
  into v_active
  from public.raids r
  where r.classroom_id = v_classroom_id
    and r.status in ('LOBBY_OPEN','ACTIVE','PAUSED')
  order by
    case r.status
      when 'ACTIVE' then 1
      when 'PAUSED' then 2
      else 3
    end,
    r.created_at desc
  limit 1;

  select coalesce(jsonb_agg(x.item order by x.sort_at desc, x.raid_id desc), '[]'::jsonb)
  into v_history
  from (
    select
      r.id as raid_id,
      coalesce(r.completed_at, r.updated_at, r.created_at) as sort_at,
      jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'boss_name', r.boss_name,
        'boss_description', r.boss_description,
        'boss_element', r.boss_element,
        'status', r.status,
        'max_hp', r.max_hp,
        'current_hp', r.current_hp,
        'hp_ratio', case when r.max_hp > 0 then r.current_hp::numeric / r.max_hp::numeric else 0 end,
        'lobby_open_at', r.lobby_open_at,
        'starts_at', r.starts_at,
        'ends_at', r.ends_at,
        'completed_at', r.completed_at,
        'chat_enabled', r.chat_enabled,
        'phase_preview', (
          select jsonb_build_object(
            'phase_no', ph.phase_no,
            'image_url', ph.image_url,
            'loop_video_url', ph.loop_video_url
          )
          from public.raid_phases ph
          where ph.raid_id = r.id
          order by ph.phase_no
          limit 1
        ),
        'finisher', (
          select jsonb_build_object(
            'student_id', part.student_id,
            'name', part.snapshot_student_name,
            'brand_name', part.snapshot_brand_name,
            'guild_id', part.snapshot_guild_id,
            'guild_name', part.snapshot_guild_name,
            'guild_logo_url', part.snapshot_guild_logo_url,
            'equipped_character_id', part.snapshot_equipped_character_id,
            'equipped_character_name', part.snapshot_equipped_character_name,
            'equipped_character_image_url', part.snapshot_equipped_character_image_url,
            'damage', coalesce((lethal.hit->>'damage')::bigint, 0),
            'crit', coalesce((lethal.hit->>'crit')::boolean, false),
            'occurred_at', ab.created_at
          )
          from public.raid_attack_batches ab
          join public.raid_participants part on part.id = ab.participant_id
          cross join lateral (
            select e.value as hit
            from jsonb_array_elements(
              case
                when jsonb_typeof(ab.result_payload->'results') = 'array'
                  then ab.result_payload->'results'
                else '[]'::jsonb
              end
            ) with ordinality as e(value, ord)
            where coalesce((e.value->>'accepted')::boolean, false)
              and coalesce((e.value->>'damage')::bigint, 0) > 0
            order by e.ord desc
            limit 1
          ) lethal
          where ab.raid_id = r.id
            and ab.raid_hp_before > 0
            and ab.raid_hp_after = 0
          order by ab.created_at asc, ab.id asc
          limit 1
        )
      ) as item
    from public.raids r
    where r.classroom_id = v_classroom_id
      and r.status in ('COMPLETED','FAILED','ARCHIVED')
      and not (
        r.title ~* 'TEST'
        or r.title like '%테스트%'
        or r.title like '[초안]%'
        or coalesce(r.metadata->>'end_reason','') = '테스트 종료'
        or coalesce((r.metadata->>'is_test')::boolean, false)
        or coalesce((r.metadata->>'student_history_hidden')::boolean, false)
      )
  ) x;

  select value
  into v_recent
  from jsonb_array_elements(v_history)
  with ordinality as e(value, ord)
  where ord = 1;

  return jsonb_build_object(
    'active', v_active,
    'recent', v_recent,
    'history', v_history
  );
end;
$function$;
