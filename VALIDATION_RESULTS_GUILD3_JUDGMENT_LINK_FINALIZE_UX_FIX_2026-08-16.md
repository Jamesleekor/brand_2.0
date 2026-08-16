# Guild3 judgment / reference link / finalize UX fix — validation

Date: 2026-08-16
Baseline: v10 Guild3 time dropdown fix (rebuilt cleanly from canonical v9 + v10 GuildMissionAdmin change)
DB migration required: NO

## Root-cause review
The reported FINALIZE failure is not caused by the personal grade buttons.
`teacher_finalize_guild3_mission` intentionally rejects finalization while `clock_timestamp() < activity_record_due_at`.
This preserves the period during which students may still submit/revise their personal activity record.

## Changes
### 1. Guild result selection feedback
- CLEARED / FAILED now shows a persistent selected state after the RPC succeeds.
- The current result badge changes to CLEARED or FAILED.
- The selected result button gets a stronger highlighted/ring state and a check mark.

### 2. Personal grade selection feedback
- S/A/B/C/F now shows a persistent selected state after the RPC succeeds.
- The selected grade button gets a strong filled/ring state and check mark.
- `현재 등급` is shown as a highlighted badge.
- Local display state is synchronized again when the refreshed server detail arrives.

### 3. Submission reference URL
- Valid HTTP/HTTPS reference URLs are rendered as clickable hyperlinks.
- Links open in a new tab with `noopener noreferrer`.
- URLs without a scheme are normalized to HTTPS.
- Non-HTTP(S)/invalid values are not made clickable.

### 4. FINALIZE deadline UX
- While a CLOSED mission is still before `activity_record_due_at`, FINALIZE is disabled instead of sending a request that is known to fail.
- UI displays the exact activity-record deadline and explains why finalization is waiting.
- Button text becomes `최종 확정 (마감 대기)` while blocked.

### 5. CLOSED mission deadline correction
- `표시/마감 수정` is now available in CLOSED state.
- This is already supported by the existing backend RPC and remains audited by the required correction reason.
- This allows a teacher to correct an accidentally wrong deadline without changing the server rule.

### 6. Mutation refresh
- Guild3 teacher actions now use `mutateAsync` and await query invalidation/refetch before resolving to the row-level UI.
- This makes selection feedback reliable after a successful server mutation.

## Static validation
- `GuildMissionAdmin.tsx` TypeScript/JSX syntax transpile: PASS using TypeScript `transpileModule`.
- Existing RPC signatures were reviewed against the frontend calls: no new RPC or DB schema change is required.

## Build gate
A full `npm ci && npm run build` could not be completed in the ChatGPT container because package installation is unavailable/times out in this environment. The source ZIP intentionally excludes `node_modules`.
Run once locally:

```bash
npm ci
npm run build
```

Do not mark Guild3 COMPLETE until this build and the remaining E2E checks pass.
