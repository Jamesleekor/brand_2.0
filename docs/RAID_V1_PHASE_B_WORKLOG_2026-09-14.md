# B.R.A.N.D 2.0 — RAID V1 PHASE B WORKLOG
Last update: 2026-09-14

## Recovery
Production Phase A DB Core is already applied.
Do not re-run the Core SQL against Production.

Core checkpoint:
- Production project: `tnsmjyzbjgfepubxvstw`
- A1–A8 Core migrations applied
- A9 `20260914120922 raid_v1_core_a9_teacher_detail` applied
- 7 Raid tables + SECURITY DEFINER RPC architecture
- Structural/RLS/ACL/snapshot smoke checks passed
- Real authenticated app-session E2E still pending

## Phase B goal
Make the teacher capable of creating/configuring/opening/starting/pausing/resuming/ending a real test Raid before student Lobby/Battle UI is implemented.

## Files added by Phase B patch
- `src/lib/rpc/raid_admin_rpc.ts`
- `src/features/teacher/raid/RaidControlPage.tsx`
- `src/features/teacher/raid/RaidBalanceLabPage.tsx`
- this worklog

## Existing files patched
- `src/App.tsx`
  - imports RaidControlPage / RaidBalanceLabPage
  - `/teacher/raid`
  - `/teacher/raid/analytics`
- `src/components/teacher/TeacherShell.tsx`
  - `길드 & 콘텐츠 → 👾 레이드`

## Teacher Control features in Phase B
- Raid list / status / boss HP preview
- New Raid draft creation
- Boss name/title/description/element/max HP/end time
- Phase 1 first-frame image URL / loop-video URL
- Browser media preview
- damage coefficient
- random min/max
- Crit multiplier
- server tap/sec limit
- chat enabled + slow mode
- optional TEST-account snapshot inclusion
- Save DRAFT / LOBBY_OPEN settings
- Open Lobby
- Start Raid (creates immutable student stat snapshots)
- Pause / Resume
- Force End
- Chat ON/OFF during Lobby/Battle
- Live teacher summary polling while ACTIVE/PAUSED
- Participant table: guild / resonance / Crit / cumulative damage / valid taps / state
- Balance Lab route/skeleton separated from Control Room

## Deferred intentionally
- Student Raid Lobby
- Presence/Broadcast
- Lobby speech bubbles
- Student Battle screen
- Boss tap client batcher
- Result modal
- Reward payout UI/settlement
- actual Balance Lab calculations / charts
- next Boss HP recommendation engine
- multi-phase editing UI
- weak-point editor

## Validation rule
ChatGPT must not run npm install/ci/build.
After applying patch locally, user runs:
`npm run build`

Then authenticated teacher E2E should test:
1. create DRAFT with image/video
2. open Lobby
3. start Raid
4. verify participant snapshots appear
5. pause/resume
6. force end

## Static validation completed
- [x] Node patch engine tested against matching App/TeacherShell anchors.
- [x] Patch engine is idempotent: second run makes no changes.
- [x] New `.ts/.tsx` files passed TypeScript 5.8 `transpileModule` syntax diagnostics.
- [x] CMD is ASCII-only and Windows CRLF.
- [x] No npm install/build was run.
