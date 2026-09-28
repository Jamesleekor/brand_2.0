-- B.R.A.N.D 2.0 RAID Visual V2 - VFX-B runtime RPC exposure
-- Production migration version: 20260920105317
-- Exposes only normalized phase.visual, not the complete raid_phases.metadata object.

create or replace function public.raid_normalize_visual_v2(p_metadata jsonb)
returns jsonb
language sql
immutable
set search_path = 'public', 'pg_temp'
as $function$
  select case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)->'visual_v2') <> 'object' then null
    else
      (coalesce(p_metadata, '{}'::jsonb)->'visual_v2')
      || jsonb_build_object(
        'version', 1,
        'media',
          (case
            when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)#>'{visual_v2,media}') = 'object'
              then coalesce(p_metadata, '{}'::jsonb)#>'{visual_v2,media}'
            else '{}'::jsonb
          end)
          || jsonb_build_object(
            'action_video_url', nullif(btrim(coalesce(p_metadata, '{}'::jsonb)#>>'{visual_v2,media,action_video_url}'), ''),
            'state_video_url', nullif(btrim(coalesce(p_metadata, '{}'::jsonb)#>>'{visual_v2,media,state_video_url}'), ''),
            'state_video_trigger', case
              when upper(coalesce(p_metadata, '{}'::jsonb)#>>'{visual_v2,media,state_video_trigger}') in ('GROGGY','ENRAGE','BOTH')
                then upper(coalesce(p_metadata, '{}'::jsonb)#>>'{visual_v2,media,state_video_trigger}')
              else 'BOTH'
            end,
            'crossfade_ms', case
              when coalesce(p_metadata, '{}'::jsonb)#>>'{visual_v2,media,crossfade_ms}' ~ '^[0-9]+$'
                then greatest(0, least(2000, (coalesce(p_metadata, '{}'::jsonb)#>>'{visual_v2,media,crossfade_ms}')::integer))
              else 240
            end
          )
      )
  end;
$function$;

revoke all on function public.raid_normalize_visual_v2(jsonb) from public, anon;
grant execute on function public.raid_normalize_visual_v2(jsonb) to authenticated, service_role;

do $migration$
declare
  v_name text;
  v_oid oid;
  v_def text;
  v_patched text;
  v_pattern text := E'''loop_video_url'',[[:space:]]*phase\\.loop_video_url[[:space:]]*\\)[[:space:]]*end';
  v_count integer;
begin
  foreach v_name in array array['get_raid_battle_state(bigint)', 'teacher_get_raid_broadcast_state(bigint)']
  loop
    v_oid := to_regprocedure('public.' || v_name);
    if v_oid is null then
      raise exception 'VFX-B: required RPC public.% was not found', v_name;
    end if;

    select pg_get_functiondef(v_oid) into v_def;

    if position('raid_normalize_visual_v2(phase.metadata)' in v_def) > 0 then
      continue;
    end if;

    select count(*) into v_count
    from regexp_matches(v_def, v_pattern, 'gi');

    if v_count <> 1 then
      raise exception 'VFX-B: public.% phase media anchor count was %, expected 1', v_name, v_count;
    end if;

    v_patched := regexp_replace(
      v_def,
      v_pattern,
      '''loop_video_url'', phase.loop_video_url, ''visual'', public.raid_normalize_visual_v2(phase.metadata)) end',
      'i'
    );

    execute v_patched;
  end loop;
end;
$migration$;
