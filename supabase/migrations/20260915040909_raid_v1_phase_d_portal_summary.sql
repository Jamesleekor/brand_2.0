-- B.R.A.N.D 2.0 RAID V1 Phase D portal summary
-- Production migration version: 20260915040909 (already applied).

create or replace function public.get_raid_portal_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student_id integer;
  v_classroom_id integer;
  v_active jsonb;
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
  into v_recent
  from public.raids r
  where r.classroom_id = v_classroom_id
    and r.status in ('COMPLETED','FAILED','ARCHIVED')
    and exists (
      select 1
      from public.raid_participants part
      where part.raid_id = r.id
        and part.student_id = v_student_id
    )
  order by coalesce(r.completed_at, r.updated_at, r.created_at) desc
  limit 1;

  return jsonb_build_object(
    'active', v_active,
    'recent', v_recent
  );
end;
$$;

revoke all on function public.get_raid_portal_summary() from public, anon;
grant execute on function public.get_raid_portal_summary() to authenticated, service_role;
