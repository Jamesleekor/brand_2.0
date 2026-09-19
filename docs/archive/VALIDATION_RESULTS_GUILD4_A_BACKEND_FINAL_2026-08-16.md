# Guild4-A Backend final implementation validation

Date: 2026-08-16
Baseline: Guild3 COMPLETE v13 / Git checkpoint 897bdd7
Status: IMPLEMENTED / PRE-FLIGHT PASSED / APPLY NOT YET RUN / NOT COMPLETE

## User-confirmed monthly Peer aggregation
- Monthly Peer /300 uses Guild3 mission weight weighted average.
- Only peer_review_required=true missions participate.
- CANCELLED / VOIDED missions are excluded.
- DRAFT / ACTIVE / CLOSED valid peer missions remain in the denominator, matching Guild3 Mission normalization behavior.
- Peer status becomes READY only when every valid peer source is FINALIZED and its Guild4 round is FINALIZED.
- A month with no valid peer-review-required mission is READY with Peer=0.

## Backend implemented
- Round / participant snapshot / obligation / revision / exception / audit
- 1~10 score, comment >=20 chars, revision append-only
- +48h default deadline and teacher deadline audit
- EXCUSED / RESTORED
- OPEN -> CLOSED -> FINALIZED
- Reviewer tendency correction cap ±1.5
- Target-median individual influence cap ±2
- Per-round /300 rollup
- Missing-review penalty: exactly 2,000 GOLD once per reviewer per round
- POSTED / PENDING_FUNDS / WAIVED and reversal handling
- Guild3 VOID exclusion + penalty reversal/waiver
- FINALIZED review correction via append-only revision + audit
- FINALIZED exception correction + score/penalty recalculation
- Guild2 monthly Peer weighted adapter and immediate refresh after round FINALIZE
- Student privacy RPC: own authored reviews/progress only; monthly final Peer /300 only when READY
- Teacher raw review/audit access

## Still intentionally deferred
- Guild5 FINAL/REOPEN correction freeze guard. Guild5 owns the monthly FINAL state and its tables do not exist yet; the guard will be installed in Guild5 backend.
- Guild4 frontend and E2E.

## Preflight
User executed consolidated PRE-FLIGHT successfully:
- required_helpers PASS
- required_source_tables PASS
- required_economy_enums PASS
- invalid_guild3_opening_contract PASS (0 invalid)
- duplicate_guild3_participants PASS (0 duplicates)
- source INFO: 2 OPENABLE openings, both valid, each 5 participants
- existing Guild4 tables/functions PASS (clean first apply)

## Static validation
- One outer transaction in cumulative APPLY: PASS
- Dollar-quote pairing: PASS
- No DROP TABLE / destructive table replacement: PASS
- Guild2 refresh references Guild4 peer weighted rollup: PASS
- FINALIZE triggers Guild2 refresh: PASS
- FINALIZED correction RPCs present: PASS
- Student round RPC does not expose received/raw per-round Peer result: PASS
- Consolidated POSTCHECK includes weighted adapter/security checks: PASS

## Next gate
1. Run final APPLY_GUILD4_A_BACKEND.sql once.
2. Run POSTCHECK_GUILD4_A_BACKEND_CONSOLIDATED.sql.
3. Do not call Guild4-A COMPLETE until postcheck and backend E2E pass.
