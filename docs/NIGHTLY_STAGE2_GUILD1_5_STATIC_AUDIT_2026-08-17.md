# Nightly Stage 2 — Guild1~5 Static Integration Audit
## 2026-08-17

Status: COMPLETE
Production DB writes: NONE
Baseline: v23

## PASS
- Actual TS/TSX import path scan: PASS
- Guild route/link resolution: PASS
- Guild RPC wrapper names found in repository SQL definitions: PASS
- Student Guild pages direct INSERT/UPDATE/DELETE/UPSERT scan: PASS
- Guild5 internal helper authenticated grant coarse scan: PASS
- Guild5 FINAL freeze guard functions/triggers present: PASS
- TEST reset Guild5 wrapper path present: PASS
- Guild3 → Guild4 source-contract markers (FINALIZED + peer requirement) present in migrations
- Conquest map asset present

## Safe issues found for Stage 3

### S2-01 — Conquest popover clipping
`GuildConquestPage.tsx` renders an absolute floating panel inside two `overflow-hidden` ancestors.
This exactly matches the user screenshot where the lower part of the territory panel is clipped at the map boundary.

Planned safe fix:
- desktop: keep an overlay near the selected marker but remove clipping boundary and use lower-slot bottom anchoring;
- mobile: render the detail panel below the map in normal document flow so a panel taller than the map cannot be clipped.
- no DB/state/scoring changes.

### S2-02 — Guild2 teacher copy is stale
`GuildScoreAdmin.tsx` still says Mission / Peer / Arcade will be connected later and that Mission GS is not connected.
That text is obsolete after Guild3/4 + Arcade adapters.

Safe fix: wording only; Guild2 remains a DRAFT calculator and Guild5 owns FINAL.

### S2-03 — Student Guild tab status label is stale
`GuildPage.tsx` always shows `월간결산 / FINAL` in the tab subtitle, even before the current month has a Guild5 FINAL snapshot.

Safe fix:
- current month has Guild5 FINAL → `FINAL`
- otherwise → `마감 전`

## Follow-up verification note
GuildPage loads Guild5 history but does not have its own Guild5 Realtime subscription. This is not changed tonight because query remount/refetch may already be sufficient. Add a morning E2E check: after teacher FINALIZE, verify a student already sitting on `/guild` changes to FINAL without a full browser reload. If not, add targeted query invalidation/realtime later.

## Intentionally untouched
- duplicate `database_types.ts` copies outside Guild feature
- G4 FINALIZED + G3 VOID known follow-up
- Peer NO_RATINGS policy discussion
- territory tax economy effects
- locked scoring/lifecycle formulas
