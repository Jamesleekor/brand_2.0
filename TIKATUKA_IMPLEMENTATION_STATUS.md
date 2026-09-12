# TIKATUKA IMPLEMENTATION STATUS

## Baseline
- Repository: `Jamesleekor/brand_2.0`
- Main baseline: `1b5f058508b1eb2480e45650db41c33175a68278`
- Phase 3 final checkpoint: `d4ee74a1ee8970fb97c8cea12d95a10e47d94f73`
- Current branch: `feat/tikatuka-phase4-basic-ai`
- Specification: `tikatuka_engine_ai_spec_v1.2.md`

## Current phase
- Phase 4 — basic AI — **COMPLETE**

## Last known good source checkpoint
- Commit: `e1304a9419ef4696b62f528c56f9358431780f33`
- CI: `npm ci` PASS
- Tikatuka automated tests: **19/19 PASS**
- Production build: `npm run build` PASS

## Checkpoints
- [x] Phase 4-A: dedicated branch created from Phase 3 final checkpoint.
- [x] Phase 4-B: atomic PLACE logic split into RNG-free `resolvePlacementOutcome()` and reused by the live reducer; 14/14 prior tests and production build PASS.
- [x] Phase 4-C: placement-only AI, evaluation, difficulty profiles, bounded mistake selection, and Phase 4 tests added; 19/19 total tests and production build PASS.
- [x] Phase 4-D: regression scope checked; `main` remains on the Phase 0 baseline and no Arcade UI/Supabase/other-game source was modified.

## Phase 4 delivered
- `resolvePlacementOutcome()` is the single deterministic placement-resolution path shared by live play and AI simulation.
- AI candidate simulation does not advance the opponent turn and does not consume `gameRng`.
- Basic AI generates only legal placements from the Core engine.
- Immediate AI evaluation includes board score, row control, double/triple structure, combo potential, shield ownership/block value, duplicate vulnerability, and terminal result value according to difficulty profile features.
- Shield evaluation penalizes gifting an opponent a strong combo, including directly completing a triple.
- Difficulty profiles reserve final v1.2 search depths (Lv1–4 depth 0, Lv5–7 depth 1, Lv8–10 depth 2) while Phase 4 intentionally executes immediate evaluation only.
- Mistakes are bounded to near-best candidates instead of arbitrary bad moves; Lv10 candidate pool is top-1.
- `aiRng` alone controls AI mistake selection; AI decision randomness cannot perturb the future `gameRng` sequence.

## Automated coverage added in Phase 4
- Obvious two-die knock ranks above non-knocking placements.
- High-level shield AI avoids directly completing the opponent's 5-triple.
- Low-level bounded mistake selection works while Lv10 remains top-1.
- AI decision RNG is isolated from actual game RNG.
- Difficulty profile search-depth targets are preserved for the advanced-AI phase without being executed early.

## Regression scope
Compared with Phase 3 final checkpoint, Phase 4 changes are limited to:
- `src/features/arcade/tikatuka/ai/*`
- `src/features/arcade/tikatuka/engine/placementResolution.ts`
- small reducer/index refactor to reuse the same placement outcome function
- Tikatuka Phase 4 tests and test registration
- this status document

No Phase 4 changes were made to:
- `ArcadePage.tsx`
- existing Game #01 / Game #02 implementations
- Supabase RPC/schema/migrations
- production DB
- `main`

## Infrastructure note
CI still succeeds with the repository's existing setup. GitHub Actions/Supabase emit the pre-existing Node-version deprecation/engine warnings; they are not caused by Tikatuka and are not changed during this phase.

## Recovery rule
If a later session is interrupted, do not continue from memory. Read this file, fetch the active implementation branch HEAD, verify CI status, and resume only from the most recent successful checkpoint.

## Safety rules
1. Never edit `main` directly during phased implementation.
2. Keep phase/checkpoint commits recoverable.
3. Do not stack new work on failing tests or build.
4. `gameRng` and `aiRng` remain separate.
5. AI simulation must reuse Core rules; do not reimplement scoring/knock/shield rules inside AI.
6. UI/Supabase integration remains deferred to its assigned later phase.

## Next phase
- Phase 5 — advanced AI: Tazza EV, HOLD decision, difficulty-aware skill use, search/state hashing, repetition protection, and Expectimax depth 1–2 under node/time safety limits.
