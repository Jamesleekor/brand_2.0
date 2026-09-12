# TIKATUKA IMPLEMENTATION STATUS

## Baseline
- Repository: `Jamesleekor/brand_2.0`
- Main baseline: `1b5f058508b1eb2480e45650db41c33175a68278`
- Phase 4 final checkpoint: `4d0e782d977cac3dff5d1e23dc42e36823bbc44f`
- Current branch: `feat/tikatuka-phase5-advanced-ai`
- Specification: `tikatuka_engine_ai_spec_v1.2.md`

## Current phase
- Phase 5 — advanced AI — **COMPLETE**

## Last known good source checkpoint
- Commit: `e582b5130563db83f96c86955d88136fcd9fda1b`
- CI: `npm ci` PASS
- Tikatuka automated tests: **40/40 PASS**
- Production build: `npm run build` PASS

## Checkpoints
- [x] Phase 5-A: dedicated branch created from Phase 4 final checkpoint.
- [x] Phase 5-B: canonical `stateHash`, active-path cycle guard, node limit and hard-time-budget guard added and CI-verified.
- [x] Phase 5-C: RNG-free Tazza expected-value evaluation added; all six reroll values are enumerated uniformly without peeking/advancing `gameRng`.
- [x] Phase 5-D: HOLD / Forced Pass / held-die / pending-shield / random-next-turn search simulation added without consuming real RNG.
- [x] Phase 5-E: final advanced action ranking added for PLACE / TAZZA / HOLD with difficulty-aware depth 0/1/2 search and opponent minimizing responses; CI PASS.
- [x] Phase 5-F: regression tests added for shield-Tazza prohibition and held-normal next-turn Tazza reset; total 40/40 tests + production build PASS; Phase 4 diff and `main` stability verified.

## Phase 5 delivered
- Canonical AI state hash excludes irrelevant identifiers/statistics while retaining all rule-relevant board, die, skill, pending, held and turn data.
- Search has active-path repetition protection plus `maxNodes=5000` and `hardTimeBudgetMs=100` production safeguards.
- Tazza decision uses uniform 1..6 expected value and never inspects the actual future `gameRng` result.
- A low die can correctly be kept when it has strong knock/combo value; a high useful die is not rerolled merely because Tazza is available.
- HOLD search preserves the exact die, spends the HOLD resource only for voluntary HOLD, and models the opponent intervening turn before that die returns.
- Next-turn search obeys `heldDie > pendingShield > normal roll`; random normal roll is represented as six 1/6 chance branches rather than consuming `gameRng`.
- Forced Pass remains distinct from HOLD and preserves the exact die without spending a HOLD charge.
- Search depth is measured by future completed turns, so HOLD cannot create unbounded same-board recursion.
- Future AI turns maximize AI evaluation; future Player turns minimize it; random rolls are chance nodes.
- Difficulty profile is active: Lv1–4 depth 0, Lv5–7 depth 1, Lv8–10 depth 2.
- AI skill availability remains the confirmed v1.2 table: Tazza from Lv4, HOLD from Lv7, with Lv8–10 having Tazza 2 / HOLD 1.
- Remaining Tazza/HOLD charges have small option value so the search avoids wasting scarce skills for negligible gains.
- Root mistakes remain bounded to near-best candidates and use only `aiRng`; Lv10 top-1 policy does not consume mistake RNG.
- AI search does not perturb actual game RNG sequence.

## Automated coverage after Phase 5
- Core rules/state-machine tests remain green.
- AI state hash equivalence/difference cases.
- Active-path cycle guard and node/time budget cutoffs.
- Tazza low-roll/high-roll/strong-knock EV cases.
- Tazza hypothetical evaluation does not mutate live state or consume RNG.
- HOLD exact-die/resource/stat simulation.
- held-die and pending-shield deterministic next-turn priority.
- normal next-roll six-way 1/6 chance branching.
- Forced Pass exact-die preservation without HOLD cost.
- Difficulty-gated action availability: placement-only early levels, Tazza from Lv4, HOLD from Lv7.
- Lv8 depth-2 constrained search completes inside node limits.
- Search does not alter game RNG sequence.
- Lv10 top-1 policy avoids unnecessary `aiRng` consumption.
- Shield current die never exposes Tazza.
- Held normal returns next own turn with `tazzaUsedThisTurn=false` and may use remaining Tazza.

## Regression scope
Compared with the Phase 4 final checkpoint, Phase 5 changes are limited to:
- `src/features/arcade/tikatuka/ai/*`
- `src/features/arcade/tikatuka/tests/phase5_*`
- Tikatuka test registration
- this status document

No Phase 5 changes were made to:
- `ArcadePage.tsx`
- existing Game #01 / Game #02 implementations
- Supabase RPC/schema/migrations
- production DB
- `main`

`main` was rechecked at Phase 5 closeout and remains `1b5f058508b1eb2480e45650db41c33175a68278`.

## Infrastructure note
CI succeeds with the repository's existing setup. GitHub Actions/Supabase still emit the pre-existing Node-version deprecation/engine warnings. The project currently builds successfully despite those warnings; do not mix a Node-runtime migration into the Tikatuka feature phases.

## Recovery rule
If a later session is interrupted, do not continue from memory. Read this file, fetch the active implementation branch HEAD, verify the latest CI result, and resume only from the most recent successful checkpoint.

## Safety rules
1. Never edit `main` directly during phased implementation.
2. Keep phase/checkpoint commits recoverable.
3. Do not stack new work on failing tests or build.
4. `gameRng`, `aiRng`, and UI randomness stay separate.
5. AI simulation must reuse Core rules; do not duplicate score/knock/shield logic in AI.
6. Search must never read or advance future `gameRng` for decision making.
7. UI/Supabase integration remains deferred to its assigned phase.

## Next phase
- Phase 6 — UI / Arcade integration: create the Tikatuka React game surface, connect the existing Core engine and advanced AI, implement event-driven animations/thinking delay, and integrate the game entry into the Arcade page without touching persistence yet.
