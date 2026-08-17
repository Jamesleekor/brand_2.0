# Guild4-A3 incremental adapter fix — 2026-08-16

## Why this incremental exists
The already-executed top-level `APPLY_GUILD4_A_BACKEND.sql` contained Guild4-A1 foundation and A2 round finalization, but did not include migration `20260816_05_guild4_peer_monthly_guild2_adapter.sql`.

Observed postcheck therefore passed tables/RLS/security but failed exactly the A3 contracts:
- FINALIZED correction RPCs
- student monthly peer summary RPC
- monthly peer readiness / weighted rollup
- Guild2 refresh Peer adapter

## User-confirmed aggregation
Monthly Peer /300 uses Guild3 mission weight weighted average (`GUILD3_MISSION_WEIGHTED_AVERAGE`).

## Correct application sequence
1. `PREFLIGHT_GUILD4_A3_MONTHLY_ADAPTER.sql` (read only)
2. `APPLY_GUILD4_A3_MONTHLY_ADAPTER.sql` (incremental; transaction)
3. `POSTCHECK_GUILD4_A3_MONTHLY_ADAPTER.sql`

Do not rerun or edit the already-applied Guild4-A1/A2 SQL merely to repair this omission.
