# B.R.A.N.D 2.0 — RAID V1 Phase D Fix + Raid Recreate
Last update: 2026-09-15

## 1. TypeScript build error fix

Error:
`src/features/raid/hooks/useRaidTapBatcher.ts: Property 'error' does not exist on type 'RpcResult<RaidTapBatchResult>'`

Cause:
The failure branch accessed `response.error` directly. In the current project `RpcResult<T>` narrowing was not accepted by TypeScript in that branch.

Fix:
The failure message is now read through an explicit property guard:

```ts
const errorMessage =
  'error' in response
    ? response.error
    : '공격 정보를 서버에 전달하지 못했습니다.';
```

This preserves the existing retry behavior:
- same batch ID
- same tap payload
- up to 3 attempts
- server idempotency remains unchanged

## 2. Existing Raid / Boss recreation

Production migration:
- `20260915043710 raid_v1_teacher_clone_raid`
- already applied to Production Supabase
- local patch only records the migration in source control

New RPC:
`teacher_clone_raid(p_source_raid_id bigint, p_new_title text default null)`

Teacher UI:
- select any existing Raid
- click `♻️ 이 레이드 재생성`
- enter a new title
- a fresh `DRAFT` Raid is created and automatically selected

Copied:
- Raid/boss title-related configuration
- boss name and description
- boss element
- max HP
- damage coefficient
- random min/max
- Crit multiplier
- tap/sec limit
- chat configuration
- TEST-account inclusion
- reward configuration
- every Raid phase
- image/video URLs
- phase damage config/metadata
- every Hit Zone / weak-point structure

Not copied:
- participant snapshots
- attack batches
- lobby messages
- rankings/results
- balance reports
- lobby/start/end/completed timestamps
- old forced-end reason

The new Raid:
- always starts as `DRAFT`
- current HP resets to max HP
- schedule is blank
- can immediately be edited before opening the Lobby

This means a failed Boss can be re-released without re-entering all configuration, or the same Boss can be cloned and then given different HP/element/combat rules.

## 3. Security / Production verification

`teacher_clone_raid`:
- SECURITY DEFINER: true
- fixed search path: `public, pg_temp`
- executable by: `authenticated`, `service_role`
- classroom/teacher authorization goes through existing `raid_teacher_require_raid()`

## 4. Files changed locally

- `src/features/raid/hooks/useRaidTapBatcher.ts`
- `src/features/teacher/raid/RaidControlPage.tsx`
- `src/lib/rpc/raid_admin_rpc.ts`
- `supabase/migrations/20260915043710_raid_v1_teacher_clone_raid.sql`

## 5. Safety

Patch:
- creates `_patch_backup/raid_phase_d_fix_clone_<timestamp>`
- does NOT execute SQL
- does NOT run npm install / npm ci / npm run build
- does NOT commit or push Git

After patch:
run `npm run build` yourself.
