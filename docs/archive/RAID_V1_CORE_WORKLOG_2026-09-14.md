# B.R.A.N.D 2.0 — RAID V1 CORE WORKLOG
Last update: 2026-09-14
Production project: `tnsmjyzbjgfepubxvstw`
Repository baseline checked: `Jamesleekor/brand_2.0` main `9acac6168a94fea637df7e41d9fc62c0bc05fa44`

## RECOVERY RULE
If the conversation stops, resume from this document.

1. Do **not** blindly re-run the Raid migrations.
2. First inspect `supabase_migrations.schema_migrations` and the Raid postcheck.
3. Production already contains A1–A8 below.
4. Phase B teacher control UI is being prepared against this checkpoint.
5. npm install/build must be run only by the user locally.

## Production status — Phase A DB Core
**STATUS: COMPLETE + A9 teacher detail RPC**

Applied Supabase migrations:

- [x] `20260914120104` — `raid_v1_core_a1_tables_security`
- [x] `20260914120133` — `raid_v1_core_a2_internal_helpers`
- [x] `20260914120208` — `raid_v1_core_a3_teacher_config`
- [x] `20260914120236` — `raid_v1_core_a4_teacher_state`
- [x] `20260914120301` — `raid_v1_core_a5_student_lobby`
- [x] `20260914120337` — `raid_v1_core_a6_battle_rpc`
- [x] `20260914120416` — `raid_v1_core_a7_results_teacher_read`
- [x] `20260914120436` — `raid_v1_core_a8_acl`
- [x] `20260914120922` — `raid_v1_core_a9_teacher_detail` (`teacher_get_raid_detail(bigint)`)

## Added tables
- [x] `raids`
- [x] `raid_phases`
- [x] `raid_hit_zones`
- [x] `raid_participants`
- [x] `raid_attack_batches`
- [x] `raid_lobby_messages`
- [x] `raid_balance_reports`

All 7 tables have RLS enabled.
`anon` and `authenticated` have **no direct table privileges**.
Application access is through SECURITY DEFINER RPC only.

## Added internal helpers
- [x] `raid_teacher_require_classroom(integer)`
- [x] `raid_teacher_require_raid(bigint)`
- [x] `raid_current_student_for_raid(bigint)`
- [x] `raid_element_power_snapshot(integer)`
- [x] `raid_snapshot_student(bigint, integer)`
- [x] `raid_finalize_results(bigint)`

Internal helpers are not executable by ordinary authenticated users.
Their ACL is `postgres + service_role`.

## Added teacher RPC
- [x] `teacher_create_raid(integer, jsonb)`
- [x] `teacher_update_raid(bigint, jsonb)`
- [x] `teacher_save_raid_phase(bigint, smallint, jsonb)`
- [x] `teacher_open_raid_lobby(bigint)`
- [x] `teacher_start_raid(bigint)`
- [x] `teacher_pause_raid(bigint)`
- [x] `teacher_resume_raid(bigint)`
- [x] `teacher_end_raid(bigint, text)`
- [x] `teacher_get_raid_control_board(integer)`
- [x] `teacher_get_raid_live_dashboard(bigint)`
- [x] `teacher_get_raid_detail(bigint)`
- [x] `teacher_set_raid_chat_enabled(bigint, boolean)`
- [x] `teacher_delete_raid_lobby_message(bigint)`

## Added student RPC
- [x] `get_active_raid()`
- [x] `get_raid_lobby_snapshot(bigint)`
- [x] `send_raid_lobby_message(bigint, text)`
- [x] `get_raid_battle_state(bigint)`
- [x] `submit_raid_tap_batch(bigint, uuid, jsonb)`
- [x] `get_raid_result(bigint)`

## Core battle rules currently encoded
- Base Crit snapshot: `500 bp = 5.00%`
- Final Crit hard cap: `10000 bp = 100%`
- Default Crit damage multiplier: `×2`
- Default damage coefficient: `0.02`
- Default random variance: `0.90–1.10`
- Default tap server limit: `10/sec`
- Client batch size accepted by RPC: `1–25 taps`
- Default chat slow mode: `2 sec`
- Damage/crit/HP/RNG are server-authoritative.
- `client_batch_id` is idempotent per participant.
- Boss HP update uses row locking.
- Running Raid stats are frozen in `raid_participants`.
- Test accounts are excluded by default; Raid config can opt in.

## Hit Zone / Phase readiness
- Phase table supports multiple phases now.
- V1 default phase is `100% → 0%`.
- Every created phase receives a hidden full-screen `BODY` Hit Zone.
- Hit Zone coordinates use normalized `0..1`.
- V1 uses BODY only; weak-point UI is deliberately deferred.
- Raid cannot start unless phase ranges continuously cover 100%→0%.
- Raid cannot start unless every phase has an image or loop video.

## Snapshot content
At Raid start, every eligible student gets a historical snapshot of:
- student/brand name
- equipped Shard id/name/image
- active guild id/name/logo
- owned Shard count
- total resonance power
- base/shard/collection/final Crit
- six-element resonance distribution

Later Shard purchases/edits do not rewrite an active Raid snapshot.

## Validation completed
- [x] 7 Raid tables exist.
- [x] RLS enabled on all 7.
- [x] No direct `anon`/`authenticated` table privileges.
- [x] SECURITY DEFINER functions have fixed `search_path=public, pg_temp`.
- [x] Internal helper ACL is service-role only.
- [x] Teacher/student public RPC ACL is authenticated + service_role.
- [x] Active Shards: 79.
- [x] All 79 active Shards have element profiles.
- [x] Element-power smoke test: student 2 had total power 96 and six-element sum exactly 96.0000.
- [x] Participant snapshot smoke test passed inside a transaction and was rolled back.
- [x] After smoke rollback all Raid tables contain 0 real rows.

## Not E2E-tested yet
Per repository rule, SQL Editor was **not** used to fake an authenticated teacher/student JWT.

Therefore these require real app-session E2E after Phase B/C UI exists:
- teacher create/open/start/pause/resume/end RPC
- lobby message RPC
- battle-state RPC
- tap batching RPC
- result RPC

## Deliberately deferred
These schemas exist, but feature logic is later:
- real reward payout / `reward_snapshot` settlement
- Balance Lab report generation
- next Boss HP recommendation algorithm
- Presence/Broadcast client wiring
- student lobby avatar rendering
- multi-phase visual transition
- visible weak points / part destruction

## Files in this checkpoint
Production-history-matching migration files:
- `20260914120104_raid_v1_core_a1_tables_security.sql`
- `20260914120133_raid_v1_core_a2_internal_helpers.sql`
- `20260914120208_raid_v1_core_a3_teacher_config.sql`
- `20260914120236_raid_v1_core_a4_teacher_state.sql`
- `20260914120301_raid_v1_core_a5_student_lobby.sql`
- `20260914120337_raid_v1_core_a6_battle_rpc.sql`
- `20260914120416_raid_v1_core_a7_results_teacher_read.sql`
- `20260914120436_raid_v1_core_a8_acl.sql`

Safety/reference:
- `20260914_01_raid_v1_core.sql` — combined reference only; **do not re-run on Production**
- `20260914_01_raid_v1_core_ROLLBACK.sql` — emergency rollback only, never normal deployment
- `RAID_V1_CORE_POSTCHECK.sql`
- `RAID_V1_CORE_WORKLOG.md`

## Next step
**Phase B: repository TypeScript RPC layer + Teacher Raid Control UI skeleton**
Do not start student lobby/battle UI before teacher can create/configure/start a test Raid.
