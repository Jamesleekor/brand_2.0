# B.R.A.N.D 2.0 — RAID V1 Phase D Worklog
Last update: 2026-09-15

## Baseline
Phase A Core + Phase B Teacher Control + Phase B-1/C Student Lobby are assumed applied locally.

Production Supabase:
- A1–A9 Core/Teacher RPC
- A10 `20260915034458 raid_v1_phase_c_lobby_authoritative_roster`
- A11 `20260915040909 raid_v1_phase_d_portal_summary`
- A12 `20260915041442 raid_v1_phase_d_archived_result_state`

## Structural change — Raid Gate is now permanent
Previous behavior:
- Home showed Raid only when `get_active_raid()` returned LOBBY_OPEN / ACTIVE / PAUSED.
- A FAILED/COMPLETED Raid made the Home Raid entry disappear.

New behavior:
- Home always shows `레이드 관문`.
- `/raid` is a permanent Raid Portal.
- No active Raid → `현재 개방된 레이드 없음`.
- LOBBY_OPEN → Raid Gate / Lobby entry.
- ACTIVE → Raid Gate + direct Battle entry.
- PAUSED → Raid Gate remains available for waiting/social chat.
- Latest completed/failed Raid is available under `최근 레이드`.
- Student can open its result through the Battle route.

New Production RPC:
- `get_raid_portal_summary()`
  - `active`: current LOBBY_OPEN / ACTIVE / PAUSED Raid
  - `recent`: latest COMPLETED / FAILED / ARCHIVED Raid in which the current student has a participant snapshot
- SECURITY DEFINER
- fixed search_path `public, pg_temp`
- authenticated/service_role only

## Phase D — Chromebook landscape combat
Routes:
- `/raid`
- `/raid/:raidId/lobby`
- `/raid/:raidId/battle`

Battle principles implemented:
- [x] 16:9 landscape-first battle viewport
- [x] Boss visual dominates screen
- [x] No separate Attack button
- [x] Direct pointer/touch on Boss viewport
- [x] top-left Boss HUD
  - boss name
  - HP %
  - HP bar
  - exact HP
  - element
- [x] bottom-right My HUD
  - resonance
  - final Crit rate
  - cumulative damage
- [x] normal damage number = white
- [x] Crit damage number = yellow/gold and larger
- [x] Pause overlay
- [x] attack-blocked overlay
- [x] completed/failed overlay
- [x] video loop / Animated WebP / static image fallback

## Tap batching
Client:
- taps are queued
- flush every 250 ms
- max 25 taps per RPC batch
- local queue bounded at 80
- batch id uses `crypto.randomUUID()` when available

Server:
- existing `submit_raid_tap_batch`
- server-authoritative resonance / Crit / RNG / damage / HP
- idempotent `(participant_id, client_batch_id)`
- server rate limit remains authoritative
- client network retry reuses the exact same batch id and taps, up to 3 attempts

This avoids one HTTP/RPC request per physical click.

## Result modal
Tabs:
1. 전체 순위
   - 순위
   - 이름
   - 피해량
   - 보유 편린 수
   - 공명력
   - 보상

2. 나의 전투 기록
   - 총 피해량
   - 평균 피해량
   - 치명타 횟수
   - 실제 치명타율
   - 최종 순위

Individual attack logs are deliberately not shown.

## Lobby → Battle
- ACTIVE: Raid Gate itself becomes clickable.
- Clicking Gate enters `/raid/:raidId/battle`.
- COMPLETED/FAILED: Gate opens the same Battle route, which automatically opens Result modal.
- PAUSED: remains in Lobby until resumed.

## Files added
- `src/features/raid/RaidPortalPage.tsx`
- `src/features/raid/RaidBattlePage.tsx`
- `src/features/raid/RaidResultModal.tsx`
- `src/features/raid/hooks/useRaidTapBatcher.ts`

## Files changed
- `src/App.tsx`
- `src/features/dashboard/RaidHomeBanner.tsx`
- `src/features/raid/RaidLobbyPage.tsx`
- `src/lib/rpc/raid_student_rpc.ts`

## Migration record added locally
- `supabase/migrations/20260915040909_raid_v1_phase_d_portal_summary.sql`
- `supabase/migrations/20260915041442_raid_v1_phase_d_archived_result_state.sql`

Both Phase D migrations are ALREADY APPLIED to Production. Do not manually run them again.

## Validation already completed by ChatGPT
- Production A11 migration applied successfully.
- A11 function ACL:
  - SECURITY DEFINER = true
  - search_path = `public, pg_temp`
  - execute = authenticated + service_role
- Phase D new/modified TS/TSX files passed TypeScript 5.8 `transpileModule` syntax diagnostics.
- Local patch must not run npm install / npm ci / npm run build.
- Local patch must not commit/push.

## Still requires local authenticated E2E
1. run `npm run build`
2. Home always shows Raid Gate even with no active Raid
3. current FAILED Raid appears as recent result
4. new Raid → Lobby Open
5. 2+ student accounts → Presence/chat still work
6. Start Raid → Gate enters Battle
7. tap Boss repeatedly
8. normal damage white / Crit yellow
9. cumulative damage updates
10. Pause blocks attacks
11. Resume restores attacks
12. HP reaches zero or teacher ends Raid
13. Result modal ranking + personal summary

## Next after Phase D
Phase E/F:
- Reward settlement/payout
- real Balance Lab metrics
- HP timeline
- power-vs-damage analytics
- Crit observed-vs-expected
- damage concentration
- next Boss HP recommendation


## Final packaging checks
- [x] A11 Production migration version confirmed: `20260915040909`.
- [x] A12 Production migration version confirmed: `20260915041442`.
- [x] `get_raid_portal_summary()` is SECURITY DEFINER with fixed `public, pg_temp`.
- [x] Phase D TS/TSX syntax diagnostics: 0 errors.
- [x] patch engine simulation: success.
- [x] second patch-engine run: no changes (idempotent).
- [x] no forbidden gray/slate/text-muted typography tokens in Phase D source.
- [x] npm install/build not executed by ChatGPT.
- [x] Git commit/push not executed by ChatGPT.
