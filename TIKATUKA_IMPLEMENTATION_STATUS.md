# RAKARUKA / TIKATUKA IMPLEMENTATION STATUS

## Naming
- User-facing game name: **라카루카**
- Internal technical identifiers remain `tikatuka_*` / `Tikatuka*` for compatibility and to avoid destabilizing the already-tested engine, RPC, migration, and persistence contracts.
- The user-facing rename was applied after Phase 7 and passed the full Tikatuka/Rakaruka regression suite and production build.

## Baseline
- Repository: `Jamesleekor/brand_2.0`
- Main baseline: `1b5f058508b1eb2480e45650db41c33175a68278`
- Phase 6 closeout checkpoint: `821cf4b780e5e54c659c7b0e6ce336f6366226b7`
- Phase 7 source closeout checkpoint: `3c42b0d0f114d06a5b5e1721077f99cf3e4df735`
- Rakaruka display rename checkpoint: `d6147e3f66858e64dbefc7c226b5477e2442d1b0`
- Production migration/status checkpoint before RPC smoke: `e2167e760a3933432fe90e17b31f9d1cd531ba10`
- Current branch: `feat/tikatuka-phase7-persistence`
- Specification: `tikatuka_engine_ai_spec_v1.2.md`

## Current phase
- Phase 7 — progress persistence and result integrity — **COMPLETE**
- Production Supabase migration — **APPLIED**
- Authenticated production RPC end-to-end smoke test — **PASS**
- Browser/UI click-through smoke test — **PENDING**
- Merge/deploy of frontend feature branch to `main` — **NOT YET DONE**

## Last known good implementation checkpoint before this status update
- Commit: `e2167e760a3933432fe90e17b31f9d1cd531ba10`
- CI: `npm ci` PASS
- Automated tests: **49/49 PASS**
- Production build: `npm run build` PASS
- User-facing display name: **라카루카**

## Phase 7 delivered
- `supabase/migrations/20260912_01_tikatuka_progress_results.sql` defines server-owned `tikatuka_progress` and `tikatuka_games` persistence.
- Student/classroom identity is derived only from `current_student_id()` / `current_classroom_id()` inside `SECURITY DEFINER` RPCs; the client does not submit either identity.
- RLS is enabled and authenticated direct table access is revoked. Authenticated gameplay uses narrow RPCs only.
- `student_get_tikatuka_progress()` returns highest unlocked difficulty, cleared levels and aggregate play results.
- `student_create_tikatuka_game(difficulty)` verifies that the requested difficulty is already unlocked, then issues a server-owned UUID and engine version before the client game starts.
- `student_submit_tikatuka_result(...)` is idempotent by issued game UUID. An identical repeat submission returns the prior verified result; a conflicting payload for an already-completed UUID is rejected.
- Final board submission contains only die `value` and `kind`; client-only die IDs/provenance owners are not persistence evidence.
- PostgreSQL recomputes every Row score, board score, raw pip total, Row wins/ties and final winner from the submitted final boards before progression can advance.
- Only a server-verified `player` win may advance progression to `min(10, clearedDifficulty + 1)`.
- Losses and draws are persisted but do not unlock a new difficulty.
- UI loads server progression, disables locked levels, marks cleared levels, defaults to the highest unlocked level, and updates progression only from the server response.
- A failed result submission never unlocks a level locally.

## Production DB deployment
- Supabase project: `BRAND_2.0`
- Project id: `tnsmjyzbjgfepubxvstw`
- Migration applied successfully: `tikatuka_progress_results`
- Recorded migration version: `20260912085916`
- Preflight confirmed `tikatuka_progress`, `tikatuka_games`, and the three student RPCs did not already exist.
- Required helpers `current_student_id()`, `current_classroom_id()`, and `gen_random_uuid()` existed before deployment.

### Production postchecks — PASS
- `public.tikatuka_progress`: RLS enabled.
- `public.tikatuka_games`: RLS enabled.
- `authenticated` has no direct SELECT / INSERT / UPDATE / DELETE privilege on either table.
- `student_get_tikatuka_progress()`: `SECURITY DEFINER`, fixed `search_path=public, pg_temp`, authenticated EXECUTE allowed, anon EXECUTE denied.
- `student_create_tikatuka_game(integer)`: same security posture.
- `student_submit_tikatuka_result(...)`: same security posture.
- Internal `tikatuka_*` helper functions are not executable by authenticated/anon roles.
- `tikatuka_progress_set_updated_at` trigger exists and is enabled.
- `tikatuka_games_guard_history` trigger exists and is enabled.
- Immediately after deployment both new tables contained 0 rows, so migration introduced no synthetic student/game records.

## Production authenticated RPC E2E smoke — PASS
The production DB smoke test used only the dedicated test student `테스트요원 / QA-01` (`is_test_account=true`). The JWT subject was injected into a DB transaction so the real `auth.uid() -> current_student_id() -> current_classroom_id()` path and the same public student RPCs used by the frontend were exercised.

All gameplay writes were performed inside one transaction and **ROLLED BACK** after assertions. A final production row-count check confirmed `tikatuka_progress = 0` and `tikatuka_games = 0`, so no smoke-test progression or game history remains in production.

Verified checks:
1. Fresh progress returns 0 games and only Lv1 unlocked.
2. Lv2 start before clearing Lv1 is rejected with `PTK03`.
3. Lv1 start issues a server UUID at difficulty 1.
4. A server-validated Lv1 player win unlocks Lv2 and records one win in the transaction.
5. A fresh `student_get_tikatuka_progress()` call sees Lv2 unlocked and cleared difficulty `[1]`.
6. Resubmitting the exact same result/game UUID returns `duplicate=true` without increasing games played.
7. Reusing the same completed game UUID with different result data is rejected with `PTK05`.
8. Lv2 can be issued after the verified Lv1 win.
9. A Lv2 loss is accepted but does not unlock Lv3.
10. A Lv2 draw is accepted but does not unlock Lv3.
11. Lv3 remains rejected with `PTK03` after the loss/draw sequence.
12. Logged-out and unmapped-auth contexts are rejected with `PTK01`.

The smoke used structurally valid completed boards so PostgreSQL executed the same final-board validation, row scoring, raw-pip calculation, row-win calculation, winner recomputation, skill/counter bounds, idempotency, and progression code paths used by the production frontend.

## Security-advisor interpretation
- Supabase reports `rls_enabled_no_policy` INFO for the two Tikatuka tables. This is intentional: direct authenticated table privileges are revoked and access is RPC-only.
- Supabase reports the three student RPCs as authenticated-executable `SECURITY DEFINER` functions. This is intentional; each RPC derives the current student/classroom from authenticated server context and anon EXECUTE is revoked.
- No new mutable-search-path finding was produced for the new Tikatuka functions because their search paths are fixed.
- No new anon-executable Tikatuka `SECURITY DEFINER` finding was produced.
- Other advisor warnings/errors are pre-existing project-wide findings and were not introduced by the Rakaruka migration.

## Rakaruka rename
- User-visible Korean name was changed from `타카투카` to `라카루카` throughout `src`.
- Arcade page header/card/start button now display `라카루카`.
- The stale Phase 6 explanatory text on the Arcade card was updated to state that progression and difficulty unlocks are stored on the server.
- Internal TypeScript symbols, directories, SQL tables/functions, migration filename, and RPC names intentionally remain `tikatuka_*` / `Tikatuka*`.
- This compatibility-preserving rename passed **49/49 tests + production build**.

## Result-integrity boundary
Phase 7 materially improves integrity but does **not** claim full authoritative server replay.

The server proves:
- the authenticated student was issued the game UUID at an already-unlocked difficulty;
- the UUID cannot be completed twice with conflicting data;
- the submitted final board is structurally valid;
- Row scores, total scores, raw pips, Row wins and final winner are internally consistent with that final board;
- reported skill/knock counters remain inside defined structural/resource bounds;
- only the server may write progression.

Phase 7 does not prove:
- every Player/AI action from turn 1 is replayed server-side;
- the game RNG seed is server-issued and replayed server-side.

Therefore Rakaruka remains intentionally disconnected from official Arcade rankings, Guild 2 scores, currency, BV, or other meaningful rewards until a stronger authoritative replay protocol is implemented.

## Automated coverage
- Phase 2–6 Core/state-machine/AI/UI regressions remain green.
- Phase 7 progression/persistence contract tests remain green.
- Total automated coverage: **49/49 PASS**.
- Production build: **PASS** after the Rakaruka display rename.
- Production authenticated RPC smoke: **12/12 PASS** with all transactional test writes rolled back.

## Current deployment boundary
- Production DB: **ready**; Phase 7 migration is applied and authenticated RPC E2E passed.
- Feature branch frontend: **ready for browser smoke testing**.
- `main`: **unchanged** at the recorded baseline; the Rakaruka frontend has not yet been merged/deployed from this feature branch.
- A hosted production frontend will not show Rakaruka until the feature branch is merged/deployed.

## Remaining browser smoke test
The remaining check is UI integration rather than DB contract validation. Against the feature branch frontend, verify by clicking through:
1. Arcade card/header/start button display **라카루카**.
2. Initial selector shows only Lv1 available.
3. Starting Lv1 reaches the playable 3x3 board.
4. Tazza/HOLD/shield/AI turns render and controls enable/disable correctly.
5. Game-over result submission resolves without a UI error.
6. A real Lv1 win refreshes the selector with Lv2 unlocked.
7. Refresh/re-entry preserves the server progress.
8. Result-submit retry UI behaves correctly if a transient RPC failure is deliberately induced.

## Recovery rule
If a later session is interrupted, do not continue from memory. Read this file, fetch the active implementation branch HEAD, verify the latest CI result, and resume only from the most recent successful checkpoint.

## Safety rules
1. Never edit `main` directly during phased implementation.
2. Keep phase/checkpoint commits recoverable.
3. Do not stack new work on failing tests or build.
4. `gameRng`, `aiRng`, and UI randomness stay separate.
5. React/UI must consume Core state/selectors rather than duplicating rule logic.
6. AI simulation/search must never read or advance future `gameRng` for decision making.
7. Meaningful progression is server-owned; client state never directly unlocks a level.
8. Do not connect Rakaruka to official ranking/rewards until the integrity boundary is explicitly strengthened for that use case.
