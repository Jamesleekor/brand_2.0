# Guild3 UX/Auth/Finalize Fix — Validation Results

Date: 2026-08-16
Baseline: `brand_2.0_chatgpt_20260816_guild3_fix_v11.zip`
Output: v12

## Scope
1. CLOSED mission can be explicitly FINALIZED by teacher before activity-record deadline.
2. Early FINALIZE warns that remaining student activity-record edits will immediately close.
3. Publishing a Guild3 mission emits a Feature4 global alert; student home displays a realtime toast.
4. Student Guild Mission page adds a mission-list jump menu.
5. CANCELLED student mission cards collapse to a single compact message.
6. Teacher login uses a two-account dropdown and password only.
7. Restored teacher session entering `/home` redirects to `/teacher`.

## Frontend changed
- `src/features/guild/GuildMissionAdmin.tsx`
- `src/features/guild/GuildMissionsPage.tsx`
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/auth/LoginPage.tsx`
- `src/components/layout/AppShell.tsx`

## SQL added
Run in this order against the DB:
1. `supabase/PREFLIGHT_GUILD3_FINALIZE_PUBLISH_NOTIFICATION_FIX.sql`
2. `supabase/APPLY_GUILD3_FINALIZE_PUBLISH_NOTIFICATION_FIX.sql`
3. `supabase/POSTCHECK_GUILD3_FINALIZE_PUBLISH_NOTIFICATION_FIX.sql`

Incremental migration copy:
- `supabase/migrations/20260816_01_guild3_finalize_publish_notification_fix.sql`

The APPLY does not modify an already-applied migration file. It replaces the RPC definition incrementally and installs a publish-alert trigger.

## Important behavior
- FINALIZE is no longer blocked merely because `activity_record_due_at` is in the future.
- If teacher finalizes early, lifecycle becomes `FINALIZED`; existing student activity RPC already accepts only `ACTIVE`/`CLOSED`, so later student activity edits are frozen automatically.
- Guild result and grade completeness checks remain intact.
- Missing REQUIRED submission override rules remain intact.
- Publish notification is best-effort: notification failure is caught in the trigger and does not make mission publish fail.

## Static validation
PASS — TypeScript/JSX syntax transpile check:
- GuildMissionAdmin.tsx
- GuildMissionsPage.tsx
- DashboardPage.tsx
- LoginPage.tsx
- AppShell.tsx

## Build gate
`npm ci --offline` could not complete because this sandbox does not have all npm package tarballs cached (`zustand-5.0.14.tgz` missing). Therefore `npm run build` is NOT claimed as passed here.

Local gate required before considering this checkpoint complete:
```bash
npm ci
npm run build
```

## Recommended E2E
1. Run PRE-FLIGHT; review all dependency checks.
2. Run APPLY, then POSTCHECK.
3. CLOSED mission with future activity deadline: verify FINALIZE button is enabled and warning appears.
4. Finalize and verify lifecycle changes to FINALIZED.
5. Student account on `/home`; publish a new DRAFT mission from teacher account and confirm realtime toast appears.
6. Student `/guild/missions`: open `미션 목록`, select an old mission, verify smooth jump.
7. Confirm CANCELLED mission shows only `❌ 취소된 미션입니다.` in the card area.
8. Teacher login: choose one of the two teacher accounts from dropdown and enter only password.
9. With teacher session stored, open `/` or `/home`; verify redirect to `/teacher`.
