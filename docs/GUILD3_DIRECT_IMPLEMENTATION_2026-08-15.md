# Guild 3 direct implementation handoff — 2026-08-15

## What changed

This patch does not redesign Guild 3. It implements the already-locked Mission specification against the latest `brand_2.0` source tree supplied after TEST classroom work.

### Database

Apply manually in this order:

1. `supabase/APPLY_GUILD3_PRODUCTION_RECONCILE_AND_READ_API.sql`
   - incremental production reconcile only; does not edit already-applied 01~03 migration history
   - reasserts the reviewed Guild 3 fixes already applied manually in production
   - adds teacher mission list RPC
   - adds student aggregate Mission `/300` summary RPC
2. `supabase/APPLY_REAL_CLASSROOM_PRESEASON_CLEANUP.sql`
   - **one-time, destructive, manual-only** pre-season cleanup for exact classroom `id=1 / 2026 / 5학년 4반`
   - must never be placed in automatic deployment/migration flow

`20260815_05_guild3_production_reconcile_and_read_api.sql` is the incremental migration copy of step 1. The destructive real-classroom cleanup deliberately has no migration-folder copy.

### Frontend

New routes:

- Student: `/guild/missions`
- Teacher: `/teacher/guild/missions`

New files:

- `src/features/guild/GuildMissionsPage.tsx`
- `src/features/guild/GuildMissionAdmin.tsx`
- `src/lib/rpc/guild3_rpc.ts`
- `src/lib/zod_schemas/guild3_schemas.ts`

Existing Guild pages now link to Guild 3 Mission screens.

## Locked behavior preserved

- DRAFT teaser only before publication
- ACTIVE participant/guild snapshot ownership stays server-side
- student submission and activity are separate
- activity prompt is the locked 20–500 character prompt
- students never grade themselves
- CLOSED provisional guild result is not shown by the student read RPC
- FINALIZED/VOIDED is required before official grade/result display
- personal Mission score is shown only as aggregate `N / 300`; normalization arithmetic is not exposed
- `special_rule_note` remains per mission-instance, teacher-audited, and visible only to the student's snapshot guild
- Guild 4 is not implemented here; Guild 3 only exposes/finalizes its existing opening contract
- Guild 5 remains owner of final monthly closure/rank

## Required TEST-classroom E2E before marking Guild 3 COMPLETE

Use TEST TEACHER + TEST01~TEST05 only.

1. Create a DRAFT with teaser ON. Student sees title only.
2. Publish. Verify all five TEST GUILD participants are snapshotted and full content appears.
3. Exercise each submission configuration used in production; verify invalid NONE combinations are rejected server-side.
4. Submit and revise result evidence.
5. Save/revise 20–500 char personal activity; verify <20 and >500 rejection.
6. Close mission. Teacher can see/set provisional CLEARED/FAILED; student cannot see provisional result.
7. Grade S/A/B/C/F. Missing activity defaults F; non-F override requires a reason.
8. Set a TEST GUILD special rule note and verify only that snapshot guild can read it.
9. Finalize. Student can now see official result/grade.
10. Verify Guild 2 Mission component and DRAFT GS refresh immediately.
11. Verify a FAILED finalized mission remains a resolved mission and can still create the Guild 4 opening when `peer_review_required=true`.
12. Test correction and VOID before Guild 5 close.
13. Confirm zero valid missions produces Mission `NOT_READY`, not READY 0.
14. Confirm creating/cancelling/moving-weight/month DRAFT sources refreshes Guild 2 DRAFT state.
15. Confirm real classroom cannot be read by TEST students and TEST classroom cannot be read by real students.

Do not mark Guild 3 COMPLETE until this E2E passes.
