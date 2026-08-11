# Guild 1 Legacy Compatibility Fix 2

## Fixed
- Existing Stage 9 `guild_members.season_id NOT NULL` is now recognized as a supported legacy column.
- `teacher_assign_or_move_guild_member()` now inherits `season_id` from the target guild when inserting a new membership.
- If the target guild does not expose `season_id`, the function falls back to the currently ACTIVE Guild 1 season.
- If no season can be resolved, the RPC fails explicitly rather than inserting an invalid membership.

## Safety
- Existing membership rows are not rewritten.
- The previous failed APPLY script was wrapped in a transaction and should have rolled back completely.
