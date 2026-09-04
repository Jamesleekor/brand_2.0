-- Records v1 / Honor records
-- Class-scoped FINAL Guild5 history reader.
-- Allows current authenticated classroom members, including non-official test accounts,
-- to view official finalized history without including them in the official calculation.

create or replace function public.student_get_guild5_official_history()
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_class integer;
  v_result jsonb;
begin
  v_class := public.current_classroom_id();
  if v_class is null then
    raise exception '[G5] classroom context missing.' using errcode='P0540';
  end if;

  select coalesce(jsonb_agg(item order by item->>'year_month' desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'year_month', c.year_month,
      'version_no', v.version_no,
      'finalized_at', v.finalized_at,
      'rankings', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'guild_id', r.guild_id,
            'guild_name_at_close', r.guild_name_at_close,
            'guild_logo_url_at_close', r.guild_logo_url_at_close,
            'rank_position', r.rank_position,
            'total_gs', r.total_gs,
            'territory', ct.territory_name_snapshot,
            'territory_id', ct.territory_id,
            'territory_slot_no', ct.territory_slot_no_snapshot,
            'tax_rate_percent', ct.territory_tax_rate_snapshot,
            'territory_description', ct.territory_description_snapshot
          ) order by r.rank_position
        ), '[]'::jsonb)
        from public.guild5_guild_snapshots r
        left join public.guild5_conquest_turns ct
          on ct.version_id = v.id
         and ct.guild_id = r.guild_id
         and ct.turn_status in ('ASSIGNED','AUTO_ASSIGNED')
        where r.version_id = v.id
      )
    ) as item
    from public.guild5_month_closures c
    join public.guild5_closure_versions v on v.id = c.current_version_id
    where c.classroom_id = v_class
      and c.lifecycle_state = 'FINALIZED'
  ) q;

  return v_result;
end;
$$;

revoke all on function public.student_get_guild5_official_history() from public;
revoke all on function public.student_get_guild5_official_history() from anon;
grant execute on function public.student_get_guild5_official_history() to authenticated;
