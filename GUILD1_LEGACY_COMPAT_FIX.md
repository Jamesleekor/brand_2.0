# Guild 1 legacy compatibility fix

2026-08-11 hotfix

Observed production schema requires `public.guilds.season_id` and `public.guilds.guild_uid` as NOT NULL legacy columns without defaults.

Changes:
- Preflight recognizes these as supported legacy columns rather than aborting.
- `teacher_create_guild()` dynamically writes `season_id` when that legacy column exists.
  - Uses the classroom's active Guild 1 season.
  - Falls back to legacy `guild_seasons.is_active=true` when present.
  - Refuses guild creation if no active season exists rather than inventing a season.
- `teacher_create_guild()` dynamically writes `guild_uid` when present.
  - UUID column: generated UUID.
  - Text/varchar-like column: `GUILD_<16 hex>` stable identifier.
- No existing `guild_uid` or `season_id` values are overwritten.
- The migration is still transaction wrapped; a preflight/runtime failure rolls back the whole apply.
