# B.R.A.N.D 2.0 — RAID V1 Phase B-1 + C Worklog
Last update: 2026-09-15

## Baseline
- Production Raid V1 Core A1–A9 already applied.
- Teacher Raid Control Phase B has been manually E2E-checked by the user:
  - Raid draft create
  - boss title/name/description/element/HP/end time
  - image/video URL fields
  - combat-rule fields
  - lobby open
  - start -> student snapshots
  - live summary/participant rows
  - pause / force end
- Balance Lab route is reachable; no completed Raid analytics yet.

## Phase B-1 — Boss media preview
Implemented:
- [x] video `controls`
- [x] `preload="metadata"`
- [x] loaded / loading / error states
- [x] 8-second load timeout
- [x] browser media error diagnosis
- [x] first-frame image fallback on video failure
- [x] manual "다시 재생"
- [x] Animated WebP/GIF URL is previewed as `<img>` instead of `<video>`
- [x] recommendation text for direct MP4(H.264)/WebM URL

Goal:
A broken/unsupported URL must never remain as a silent black box with no explanation.

## Phase C — Student Raid Lobby

Production DB addition:
- [x] `20260915034458 raid_v1_phase_c_lobby_authoritative_roster`
- `get_raid_lobby_snapshot(bigint)` now returns an authoritative classroom `roster`.
- Presence broadcasts only `student_id + joined_at`; name/guild/equipped Shard are never trusted from the browser.

Implemented frontend:
- [x] Home Raid banner when `get_active_raid()` returns LOBBY_OPEN / ACTIVE / PAUSED
- [x] `/raid/:raidId/lobby`
- [x] Korean location name: `레이드 관문`
- [x] currently equipped Shard is the student's lobby avatar
- [x] student/BRAND name
- [x] guild logo + guild name
- [x] same guild members placed into nearby clusters
- [x] up to 24-player style stage layout
- [x] Supabase Realtime Presence
- [x] online count
- [x] persisted lobby chat through existing `send_raid_lobby_message` RPC
- [x] realtime chat Broadcast
- [x] missed-message recovery by polling recent persisted messages
- [x] avatar speech bubbles (~5.5 sec)
- [x] recent 50-message side panel
- [x] server chat ON/OFF reflected
- [x] server slow-mode error converted to readable Korean
- [x] Raid state polled every 3 sec
- [x] Raid Gate visual changes for LOBBY_OPEN / ACTIVE / PAUSED

## Phase boundary
Phase C deliberately stops before combat.
When ACTIVE, the Raid Gate visibly activates, but the page states:
`전투 화면은 Phase D에서 연결됩니다.`

Next:
**Phase D — Chromebook 16:9 Raid Battle**
- boss media dominates screen
- top-left boss info
- bottom-right resonance/Crit/cumulative damage
- boss direct touch/click
- 200–300ms tap batching
- white normal damage / yellow Crit damage
- server-authoritative `submit_raid_tap_batch`

## Repository migration sync
This patch also writes the Production Raid migration history into the local repo:
- A1–A8 Core
- A9 teacher detail
- A10 authoritative lobby roster

The versions match `supabase_migrations.schema_migrations`, so they are source-control records of already-applied Production migrations, not instructions to manually re-run them.

## Files added
- `src/lib/rpc/raid_student_rpc.ts`
- `src/features/dashboard/RaidHomeBanner.tsx`
- `src/features/raid/RaidLobbyPage.tsx`
- `src/features/raid/hooks/useRaidLobbyRealtime.ts`

## Files modified by patch
- `src/features/teacher/raid/RaidControlPage.tsx` (B-1 media preview)
- `src/App.tsx` (student Raid Lobby route)
- `src/features/dashboard/DashboardPage.tsx` (home Raid banner)

## Operational safety
- Patch creates `_patch_backup/raid_phase_b1_c_<timestamp>`
- No npm install / npm ci / npm run build is executed by the patch.
- No Git commit/push is executed by the patch.
- Production DB is not altered by this patch.


## Validation completed
- [x] Production A10 applied successfully.
- [x] `get_raid_lobby_snapshot(bigint)` postcheck confirms `roster` exists.
- [x] RPC ACL remains `authenticated + service_role`; no anon execute.
- [x] New/modified TS/TSX files passed TypeScript 5.8 `transpileModule` syntax diagnostics.
- [x] Patch engine tested against expected anchors.
- [x] Patch engine tested idempotent: second run produces no changes.
- [x] Patch copies 10 Production Raid migration records into local source control.
- [x] No npm install / npm ci / npm run build was run.
