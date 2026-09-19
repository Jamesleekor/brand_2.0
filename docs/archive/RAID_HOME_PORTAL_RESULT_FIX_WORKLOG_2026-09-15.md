# B.R.A.N.D 2.0 — Home Raid Gate + Result Flow Fix
Last update: 2026-09-15

## Requested UI changes

### 1. Move Raid Gate out of the crowded alert/banner area
Previous:
- Student Home rendered a large Raid banner alongside other conditional notices:
  - newbie settlement
  - daily-quest manager
  - emergency/assignment banners
  - service ads

New:
- The temporary `RaidHomeBanner` mount is removed from Dashboard.
- Under `BRAND WORLD`, the shortcut row becomes 3 slots:
  1. `차원관문` — COMING SOON
  2. `레이드 관문` — ACTIVE, opens `/raid`
  3. `편린 원정대` — COMING SOON
- `성좌맵` is removed from Home because that project is cancelled.
- `편린 원정대` reserves that slot for the planned Expedition content.

No gray typography tokens are introduced.

## 2. Fix recent-Raid result modal navigation loop

Observed behavior:
- `/raid` → recent Raid → `결과 확인`
- app navigated to `/raid/:raidId/battle`
- completed Battle page showed a full-screen `레이드 종료 / 결과 확인` overlay
- Result modal opened on top
- closing Result modal exposed the completed Battle overlay
- pressing `결과 확인` opened the same Result modal again
- perceived infinite modal loop

Fix:
- The recent-Raid `결과 확인` button in `/raid` no longer navigates to the Battle route.
- It opens `RaidResultModal` directly over the permanent Raid Portal.
- Closing the result modal returns cleanly to the Raid Portal background.
- No intermediate black/completed Battle screen.

Additional Battle safety:
- When a live battle finishes and the Result modal is closed, the app navigates back to `/raid` with `replace: true`.
- The user no longer falls back to the completed-battle `결과 확인` overlay.

## Files changed
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/raid/RaidPortalPage.tsx`
- `src/features/raid/RaidBattlePage.tsx`

## Database
No DB/schema/RPC change is required for this fix.

## Safety
Patch:
- creates `_patch_backup/raid_home_portal_result_<timestamp>`
- does NOT run npm install/ci/build
- does NOT execute SQL
- does NOT commit/push
