# Nightly Stage 1 — v23 Baseline Preservation
## 2026-08-17

Status: COMPLETE
Production DB writes: NONE

## Canonical source
- Input: `brand_2.0_guild5_v23_conquest_interactive_map.zip`
- Guild 1~5 current source baseline: v23
- Release-priority blueprint copied into `docs/BRAND_2.0_전체_기능_구현_청사진_2026-08-17_RELEASE_PRIORITY.md`

## Current functional checkpoint
- Guild1: membership / season / element foundation
- Guild2: monthly draft individual contribution + draft Guild GS
- Guild3: mission lifecycle / mission contribution / official Mission GS
- Guild4: peer review / penalties / corrections / Guild2 Peer adapter
- Guild5: monthly FINAL snapshot / ranking / conquest / reopen / student final UI
- Conquest v23: interactive map + territory tax metadata snapshot

## User-confirmed E2E context carried into nightly audit
- Guild3 mission main E2E passed before Guild4 work.
- Guild4: OPEN edit, CLOSED blocking, FINALIZED teacher correction, EXCUSED/reversal, privacy passed.
- Guild5: readiness preview, NOT_READY blocking, FINAL snapshot/ranking/conquest/reopen flow tested through v23 UI work.

## Known FOLLOW-UP, not nightly redesign targets
1. Guild4 FINALIZED + source Guild3 VOID:
   - source Mission official GS is removed;
   - already-finalized Peer contribution can remain in individual contribution.
   - recorded as follow-up; do not redesign tonight.
2. Territory tax:
   - v23 stores/displays territory tax metadata in snapshots;
   - actual economy taxation/distribution is not yet wired.
3. `NO_RATINGS` special peer scoring policy was discussed but is not a locked production rule; do not silently introduce it.

## Nightly safety rules
- No Production APPLY.
- No destructive SQL.
- Do not change locked Guild scoring/lifecycle semantics.
- Safe static/frontend fixes are allowed.
- SQL findings that require DB changes are documented/preflighted only.
