-- B.R.A.N.D 2.0
-- Guild 2 / Guild 3 mission GS precision no-op fix
-- Production Supabase was already updated directly on 2026-09-21.
-- Reference/source-control copy only. Do not re-run on current production.

do $do$
declare
  v_oid oid;
  v_def text;
  v_old_compare text := 'ELSIF prior_event.points IS DISTINCT FROM mission_event.mission_gs_points';
  v_new_compare text := 'ELSIF round(prior_event.points::numeric, 2) IS DISTINCT FROM round(mission_event.mission_gs_points::numeric, 2)';
  v_old_insert text := '''POST'', mission_event.mission_gs_points,';
  v_new_insert text := '''POST'', round(mission_event.mission_gs_points::numeric, 2),';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='guild2_refresh_monthly_gs_summary'
    and pg_get_function_identity_arguments(p.oid)='p_classroom_id integer, p_year_month text, p_season_id integer';

  if v_oid is null then
    raise exception 'guild2_refresh_monthly_gs_summary not found';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position(v_old_compare in v_def)=0 and position(v_new_compare in v_def)=0 then
    raise exception 'MISSION_GS comparison anchor not found';
  end if;

  if position(v_old_compare in v_def)>0 then
    v_def := replace(v_def,v_old_compare,v_new_compare);
  end if;

  if position(v_old_insert in v_def)>0 then
    v_def := replace(v_def,v_old_insert,v_new_insert);
  end if;

  execute v_def;
end
$do$;
