-- B.R.A.N.D 2.0 Records / Guild Hall season1 champion roster preservation
-- 2026-09-05
-- Preserve the actual Ruby roster for the curated 2026 Season 1 champion exhibit.

do $$
declare
  v_updated integer;
begin
  update public.records_historical_entries
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'champion_roster', jsonb_build_array('김서영','박시우','이현석','정우림','한서현')
  )
  where status='ACTIVE'
    and hall_key='GUILD_HEGEMONY'
    and record_type='SEASON_CHAMPION'
    and record_key='GUILD_SEASON1_CHAMPION_RUBY'
    and subject_display_name='Ruby'
    and season_label='2026 시즌1'
    and metadata->'champion_roster' is null;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception '[RECORDS] expected exactly one Ruby season1 champion row to enrich, updated %', v_updated;
  end if;
end;
$$;
