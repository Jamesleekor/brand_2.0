-- Enable Supabase Realtime for the Guild 2 admin tables that GuildScoreAdmin subscribes to.
-- Idempotent so it is safe to apply after the live database has already been updated.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'guild2_observation_events',
    'guild2_compensation_configs',
    'guild2_individual_contributions',
    'guild2_gs_events',
    'guild2_monthly_gs_summaries'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;
