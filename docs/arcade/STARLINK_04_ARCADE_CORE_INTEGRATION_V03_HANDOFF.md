# B.R.A.N.D 2.0 — Starlink #04 / Arcade Core integration handoff

Date: 2026-10-12
Branch: `starlink-step2a-core-schema`
Game/rules: `starlink_04` / `starlink_04_v0.3`
Deployment status: **NOT deployed to production; game inactive by default**.

## 1. Integration decisions

Starlink deliberately REUSES the existing Arcade lifecycle and persistence:

1. Catalog + common period selection: `ArcadePage.tsx` only shows games where `arcade_games.is_active` AND UI registry marks implemented.
2. Standard begin: `student_create_arcade_run` → shared 5-second countdown → `student_begin_arcade_run`. Student verification uses `student_create_arcade_verification_run` and the same begin.
3. Starlink-only play logic: `StarlinkGame.tsx`, deterministic 60-second reducer (`starlinkRuntime.ts`).
4. Starlink-only submit RPC: `student_submit_starlink_04_run(p_run_id,p_run_nonce,p_input_events,p_client_game_over_elapsed_ms)`.
5. Server-authoritative replay: `arcade_starlink_04_replay` replays board, paths, score, combo and clock pauses from stored server gameplay seed.
6. Commit: **existing** `arcade_runs` and `arcade_run_submissions`, never a parallel Starlink leaderboard table.
7. Certification capture: existing `arcade_capture_verification_attempt(run_id)`. Thus 80% certification, final monthly Top10 and Guild2 bonuses remain the established common pipeline.
8. Teacher force-close: preflight period/game/session locks; after force close, an in-flight Starlink verification submission cannot produce a new VERIFIED record.

Game #01, #02 and Rakaruka submit engines are untouched.

## 2. New files / changes

- `supabase/migrations/20261012_02_starlink_04_arcade_core_submission.sql`: secure student submit endpoint + A/B/C seed-pack preparer registered with existing common dispatcher.
- `src/features/arcade/StarlinkGame.tsx`: countdown, pointer/touch board, active clock HUD, deterministic input logging, submit+retry+abandon/result states.
- `src/lib/zod_schemas/arcade_schemas.ts`: strict bounded 5,000-event, UUID nonce schema.
- `src/lib/rpc/arcade_rpc.ts`: typed submit RPC + Starlink errors.
- `src/features/arcade/ArcadePage.tsx`: mounted playable Starlink with existing result/leaderboard/verification query invalidations.
- `src/features/arcade/arcadeGameRegistry.ts`: implemented flag flipped true, **without** changing DB activation state.
- `supabase/migrations/20261011_01_arcade_starlink_core_schema.sql`: fixed two dollar-quoted trigger declarations (previous migration was not parseable).
- `supabase/tests/starlink_04_core_integration_ephemeral_baseline.sql`: isolated PG fixture.
- `supabase/tests/starlink_04_arcade_core_bridge_e2e.sql`: E2E tests of actual shared persistence/nonce/attempt capture/forced close/seed-pack and reshuffle.
- `.github/workflows/starlink-dev-check.yml`: TS build + Rakaruka regression + all board/path/replay SQL Golden + Core bridge E2E.

## 3. Non-negotiable server validation

- Student/classroom context from `current_student_id()`/`current_classroom_id()`.
- Run/game/version pinned to `starlink_04_v0.3`.
- `run_nonce` must match server-stored run nonce *before* idempotent result disclosure.
- Idempotent retry requires identical payload hash; changed retry returns `P0293`.
- State must be server-side `PLAYING`; terminal/cancelled runs cannot be resurrected.
- Official completion replay computes `game_end_wall_ms`, never accepts client-provided score or stats.
- Client/server clock envelope guards; `game_over_at = server play_started_at + replay game_end_wall_ms` (not trusted device time).
- Verification must have ACTIVE session, consumed attempt, LOCKED seed pack, frozen rule pin and immutable student opportunity seed assignment.
- In-progress verification must not continue after teacher force-close of period/game.
- Common audit `arcade_run_submissions` records the replay metadata and event hash.
- Browser role cannot execute raw replay or seed-pack preparer.

## 4. Seed A/B/C

`arcade_prepare_verification_seed_pack` already dispatches to `arcade_starlink_04_prepare_seed_pack`. Teacher monthly freeze invokes dispatcher under the same transaction. The Starlink preparer:
- Requires frozen `PERIOD_PACK_PERMUTED` scope and v0.3 rule.
- Generates 3 distinct server-side uint32 seeds A/B/C, each preflighted for initial playability.
- Rejects duplicate seed or initial board hash.
- Writes immutable READY slots and refuses partial reinitialization.
- Leaves the already-installed `teacher_start_arcade_verification_session` responsible for one immutable shuffled permutation of A/B/C per student and the `student_begin_arcade_run` routine responsible for revealing the specific seed only when PLAYING starts.

## 5. Database timing / teacher race

For an ongoing verification submission, the Starlink RPC first checks run ownership, then obtains:
- period row `FOR SHARE`,
- period/game row `FOR SHARE`,
- student session row `FOR UPDATE`,
- run row `FOR UPDATE`,
- attempt row `FOR UPDATE`.

This follows the teacher force-close's period→game→session→run→attempt lock hierarchy. Shared locks on period/game allow multiple simultaneous student submissions while excluding teacher force-close until existing atomic submissions finish.

## 6. Tests and rollout readiness

The ephemeral Postgres baseline intentionally mocks only the identity/context and capture helper. It does **not** prove full production migrations, real RLS policy, browser device/input behavior or all possible teacher/student races. These remain explicit staging/E2E rollout requirements.

Before enabling the actual game:
1. Confirm full migration series `20261011_01..06`, `20261012_01`, `20261012_02` on isolated database/staging.
2. Verify authenticated student RLS and student-only nonces on actual roles.
3. Run actual manual 60-second browser tests on desktop + touch device, including temporary loss of focus, tab refresh and pointercancel.
4. Run 24 concurrent student clients/teacher instant force-close test. Verify no deadlocks and no double submission.
5. Freeze sample month and verify A/B/C seed pack readiness, no COUNTDOWN seed leak, three attempts, preflight, technical restore same assigned seed, success/failure at 80%.
6. End/finalize with at least one unfinished Starlink challenge and one unfinished Rakaruka challenge. Verify screenshot/DB that teacher can immediately finalize while preserving existing decided results.
7. Only then explicitly change `arcade_games.is_active=true` and `arcade_verification_game_configs.is_enabled=true`. The prereg migration intentionally sets both **false**.

## 7. Known operational constraints

- HTML UI is mounted only for *active* catalog entries; an unactivated Starlink row is invisible and cannot be played by students.
- E2E tests run in ephemeral PostgreSQL via GitHub Actions, never against students' live data.
- The internal `arcade_starlink_04_replay` is not an endpoint for browsers. Only `student_submit_starlink_04_run` is EXECUTE-granted to authenticated.
- If server submission response is lost, client can resubmit same frozen event payload; it cannot submit altered data once terminal.
- If connection is interrupted during PLAYING and recording cannot be resumed, student abandonment consumes certification opportunity as per shared policy; a teacher technical restore follows existing workflow, not automatic refund.
