# B.R.A.N.D 2.0 — Guild4-A Backend validation

Date: 2026-08-16
Baseline: Guild3 COMPLETE v13 / Git checkpoint `897bdd7`
Scope: Backend only. No Guild4 frontend changes.

## Implemented

### Foundation / immutable scope
- Guild3 `FINALIZED + peer_review_required=true` openings are the only source.
- Guild3 mission-instance participant snapshot is copied once into Guild4 participants.
- Reviewer → target obligations are materialized once and never recomputed from current guild membership.
- Self-review is blocked by DB constraint.
- Review revisions are append-only.
- Score 1–10 and comment minimum 20 characters are enforced in DB and RPC.
- Default deadline is Guild3 FINALIZED + 48 hours.
- Teacher may change deadline with audited reason.
- Teacher may EXCUSE/RESTORE an obligation with audit history.
- Lifecycle implemented: OPEN → CLOSED → FINALIZED.

### Per-round scoring
- Stage A reviewer tendency correction:
  - reviewer mean
  - center = median(reviewer means)
  - bias = clamp(mean - center, -1.5, +1.5)
  - stageA = clamp(raw - bias, 1, 10)
- Stage B target-specific extreme influence cap:
  - target median of stageA scores
  - clamp to target median ±2
- Final rating = mean(final corrected evaluations)
- Round peer points = final rating / 10 × 300
- Teacher detail RPC retains raw score/comment/reviewer/correction audit payload.
- Student read RPC exposes only their own submitted review data plus finalized aggregate `/300`; received raw reviewer data is not exposed.

### Missing-review penalty
- If a reviewer has one or more incomplete REQUIRED obligations, penalty is exactly 2,000 GOLD once for that reviewer in that round.
- Penalty is not multiplied by missing obligation count.
- Economy ledger uses existing `create_transaction` aggregate root.
- Insufficient balance / unavailable wallet condition does not abort round FINALIZE.
- States: NO_PENALTY / POSTED / PENDING_FUNDS / WAIVED.
- Teacher can retry PENDING_FUNDS.
- Teacher can waive POSTED/PENDING_FUNDS; posted penalty is reversed through the existing reversal ledger.

### Guild3 VOID
- Review/revision history is preserved.
- Existing Guild4 round becomes ineligible for monthly scoring.
- Score rollups are marked EXCLUDED.
- POSTED penalty is reversed; PENDING/unevaluated penalty is waived.
- Reconciliation is triggered by the Guild3 peer-opening transition to VOIDED.

## Not implemented intentionally

The final **Guild2 monthly Peer /300 adapter** is not connected yet because the current locked source documents do not define how multiple Guild4 rounds in the same month combine into one monthly Peer score.

The missing decision is specifically:
- equal average of finalized rounds, or
- weighted average using each source Guild3 mission's weight, or
- another normalization.

Implementing one without user confirmation would invent a scoring rule that is not present in the locked specification.

## Static validation performed
- PRE-FLIGHT contains no mutating SQL statements: PASS
- POSTCHECK contains no mutating SQL statements: PASS
- APPLY is one atomic transaction: PASS
- Dollar-quoted function bodies balanced: PASS
- No destructive `DROP ... CASCADE`: PASS
- Locked literals/constraints checked:
  - +48h deadline: PASS
  - score 1–10: PASS
  - comment min 20: PASS
  - no self-review: PASS
  - 2,000 GOLD once-per-round penalty model: PASS
  - POSTED/PENDING_FUNDS/WAIVED: PASS
  - reviewer bias cap ±1.5: PASS
  - target median cap ±2: PASS
  - append-only review history: PASS
  - Guild3 VOID reconciliation trigger: PASS

## Production apply status
NOT APPLIED.

Run in this order only after reviewing the PRE-FLIGHT output:
1. `supabase/PREFLIGHT_GUILD4_A_BACKEND.sql`
2. `supabase/APPLY_GUILD4_A_BACKEND.sql`
3. `supabase/POSTCHECK_GUILD4_A_BACKEND.sql`

This package is **not Guild4 COMPLETE** and should not be called COMPLETE until the monthly adapter, frontend, build, and E2E pass.
