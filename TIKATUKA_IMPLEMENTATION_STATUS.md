# TIKATUKA IMPLEMENTATION STATUS

## Baseline
- Repository: `Jamesleekor/brand_2.0`
- Main baseline: `1b5f058508b1eb2480e45650db41c33175a68278`
- Phase 6 closeout checkpoint: `821cf4b780e5e54c659c7b0e6ce336f6366226b7`
- Current branch: `feat/tikatuka-phase7-persistence`
- Specification: `tikatuka_engine_ai_spec_v1.2.md`

## Current phase
- Phase 7 — progress persistence and result integrity — **SOURCE IMPLEMENTATION COMPLETE**
- Production DB migration deployment — **NOT YET APPLIED**

## Last known good implementation checkpoint
- Commit: `865a6e8414a2ecdc946534462de786cc3357c919`
- CI: `npm ci` PASS
- Tikatuka automated tests: **49/49 PASS**
- Production build: `npm run build` PASS

## Checkpoints
- [x] Phase 7-A: dedicated branch created exactly from the Phase 6 closeout checkpoint; existing Arcade/Supabase identity and RPC security patterns inspected before editing.
- [x] Phase 7-B: server-owned progression and server-issued Tikatuka game UUID migration added with RLS/direct-table access lockdown and narrow authenticated RPCs.
- [x] Phase 7-C: Zod persistence contracts, RPC client, engine-result serializer and persistence regression tests added; an initial `Difficulty` inference mismatch was fixed at the schema boundary before continuing.
- [x] Phase 7-D: Phase 6 all-level test selector replaced with persisted locked/unlocked progression; game start now requires a server-issued UUID and completed games automatically submit for server verification before navigation/replay is enabled.
- [x] Phase 7-E: production TypeScript union-narrowing issue under repository `strict=false` settings fixed without weakening runtime response validation; final 49/49 tests + production build PASS.
- [x] Phase 7-F: migration function signatures/ACL/trigger flow statically audited, Phase 6→7 diff scope verified, and `main` stability rechecked.

## Phase 7 delivered
- `supabase/migrations/20260912_01_tikatuka_progress_results.sql` defines server-owned `tikatuka_progress` and `tikatuka_games` persistence.
- Student/classroom identity is derived only from `current_student_id()` / `current_classroom_id()` inside `SECURITY DEFINER` RPCs; the client does not submit either identity.
- RLS is enabled and authenticated direct table access is revoked. Authenticated gameplay uses narrow RPCs only.
- `student_get_tikatuka_progress()` returns highest unlocked difficulty, cleared levels and aggregate play results.
- `student_create_tikatuka_game(difficulty)` verifies that the requested difficulty is already unlocked, then issues a server-owned UUID and engine version before the client game starts.
- `student_submit_tikatuka_result(...)` is idempotent by issued game UUID. An identical repeat submission returns the prior verified result; a conflicting payload for an already-completed UUID is rejected.
- Result submission includes simplified final 3×3 boards containing only die `value` and `kind`; client-only die IDs/provenance owners are not part of persistence evidence.
- Server validation requires exactly three rows × three dice per side and validates die values/kinds.
- PostgreSQL recomputes every Row score, board score, raw pip total, Row wins/ties and final winner from the submitted final boards, then requires those values to match the engine result summary before persistence/progression can advance.
- Result counters are checked for nonnegative values, knock/shield consistency and difficulty-specific Tazza/HOLD upper bounds.
- Only a server-verified `player` win may advance progression, and progression can advance only to `min(10, clearedDifficulty + 1)` via `greatest(currentUnlock, nextDifficulty)`.
- Losses and draws are persisted but do not unlock a new difficulty.
- Production UI now loads server progression, disables locked levels, marks cleared levels, defaults to the highest unlocked level, and shows wins/play-count statistics.
- The engine now starts only after `student_create_tikatuka_game()` succeeds and uses the returned server UUID as its `gameId`.
- When the engine reaches `game_over`, the UI waits for event presentation to finish, submits the result, and updates progression only from the server response.
- A failed result submission never unlocks a level locally. The result screen provides an explicit retry path and prevents starting/leaving for another game until the issued result is successfully reconciled.
- Successful progression can display an explicit newly-unlocked level banner.
- Existing Game #01/#02 run/ranking/verification code and Tikatuka Core/advanced-AI code were not modified in Phase 7.

## Result-integrity boundary
Phase 7 materially improves integrity but does **not** claim full authoritative server replay.

What the server now proves:
- the authenticated student was issued this game UUID at an already-unlocked difficulty;
- the UUID cannot be completed twice with conflicting data;
- the submitted final board is structurally valid;
- Row scores, total scores, raw pips, Row wins and final winner are internally consistent with that final board;
- reported skill/knock counters remain inside defined structural/resource bounds;
- only the server may write progression.

What Phase 7 does **not** prove:
- the server does not replay every Player/AI action from turn 1;
- the game RNG seed is not server-issued and replayed server-side;
- therefore a malicious custom client capable of fabricating an internally consistent final board is outside the protection boundary of this phase.

Because of that boundary, Phase 7 deliberately does **not** attach Tikatuka results to official Arcade rankings, Guild 2 scores, currency, or other meaningful rewards. Full anti-cheat reward integration would require a stronger protocol such as server-issued RNG plus an action log/replay validator (or an equivalent authoritative server execution model).

## Automated coverage after Phase 7
- All 44 Phase 2–6 Core/state-machine/AI/UI tests remain green.
- Progress helper tests verify only `difficulty <= highestUnlocked` is playable and cleared-state/default-selection behavior.
- Submission serialization requires an actual completed engine state, preserves the server-issued game UUID and strips die IDs/provenance owner fields.
- Unfinished games and incomplete final rows are rejected before RPC submission.
- Zod validation rejects inconsistent Row win/tie totals at the client boundary.
- Static migration contract tests lock RPC-only table access, authenticated identity helpers, server game issuance, idempotent duplicate behavior, final-board recomputation and player-win-only progression.
- Total Tikatuka automated coverage: **49/49 PASS**.

## Regression scope
Compared with the Phase 6 closeout checkpoint, Phase 7 changes are limited to:
- `supabase/migrations/20260912_01_tikatuka_progress_results.sql`
- `src/lib/zod_schemas/tikatuka_schemas.ts`
- `src/lib/rpc/tikatuka_rpc.ts`
- `src/features/arcade/tikatuka/progress/submission.ts`
- `src/features/arcade/tikatuka/ui/TikatukaGame.tsx`
- `src/features/arcade/tikatuka/tests/phase7_persistence.test.ts`
- Tikatuka test registration
- this status document

No Phase 7 changes were made to:
- Tikatuka Core rules/state machine
- Tikatuka advanced-AI implementation
- `src/features/arcade/ArcadePage.tsx`
- existing `FocusReactionGame` / `PureReactionGame` source
- existing Arcade ranking/verification RPCs
- production DB
- `main`

`main` was rechecked at Phase 7 closeout and remains `1b5f058508b1eb2480e45650db41c33175a68278`.

## Deployment state
The migration file is committed to the Phase 7 branch, but it has **not** been executed against the production Supabase database in this phase. Until that migration is applied, a deployed Phase 7 frontend would not be able to call the new Tikatuka RPCs. Apply/migrate and perform authenticated end-to-end smoke tests as a separate deployment step rather than silently changing production during implementation.

## Infrastructure note
CI succeeds with the repository's existing setup. GitHub Actions/Supabase still emit the pre-existing Node-version deprecation/engine warnings, npm audit warnings and large-bundle warning. The project builds successfully despite those warnings; do not mix Node/runtime dependency migration into the Tikatuka feature implementation.

## Recovery rule
If a later session is interrupted, do not continue from memory. Read this file, fetch the active implementation branch HEAD, verify the latest CI result, and resume only from the most recent successful checkpoint.

## Safety rules
1. Never edit `main` directly during phased implementation.
2. Keep phase/checkpoint commits recoverable.
3. Do not stack new work on failing tests or build.
4. `gameRng`, `aiRng`, and UI randomness stay separate.
5. React/UI must consume Core state and selectors rather than duplicating game-rule logic.
6. AI simulation/search must never read or advance future `gameRng` for decision making.
7. Meaningful progression is server-owned; client state never directly unlocks a level.
8. Do not connect Tikatuka to official ranking/rewards until the chosen integrity boundary is explicitly sufficient for that use case.

## Next step
- Deployment / production integration: merge the reviewed branch when desired, apply `20260912_01_tikatuka_progress_results.sql` to the target Supabase project, then run authenticated student smoke tests for initial Lv1, locked Lv2, verified win→Lv2 unlock, loss/draw no-unlock, duplicate result submission, logout/wrong-user behavior, and refresh persistence.
- If future official rewards/rankings are desired, design a separate full-replay integrity phase before enabling them.
