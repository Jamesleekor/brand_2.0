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
- Current branch: `feat/tikatuka-phase7-persistence`
- Specification: `tikatuka_engine_ai_spec_v1.2.md`

## Current phase
- Phase 7 — progress persistence and result integrity — **COMPLETE**
- Production Supabase migration — **APPLIED**
- Authenticated student end-to-end smoke test — **PENDING**
- Merge/deploy of frontend feature branch to `main` — **NOT YET DONE**

## Last known good implementation checkpoint before this status update
- Commit: `d6147e3f66858e64dbefc7c226b5477e2442d1b0`
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

## Current deployment boundary
- Production DB: **ready**; Phase 7 migration is applied.
- Feature branch frontend: **ready for local authenticated testing**.
- `main`: **unchanged** at the recorded baseline; the Rakaruka frontend has not yet been merged/deployed from this feature branch.
- A hosted production frontend will not show Rakaruka until the feature branch is merged/deployed.

## Remaining smoke test
Use a real authenticated student account against the feature branch frontend and verify:
1. Initial progress loads with only Lv1 available.
2. Lv2 cannot be started before Lv1 is cleared.
3. A verified Lv1 player win unlocks Lv2.
4. Refresh preserves the unlocked level.
5. Loss/draw does not unlock another level.
6. Result submission reconciles successfully and retry works after a transient failure.
7. Logout/invalid auth cannot call the student RPCs.
8. A duplicate identical result remains idempotent.

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
