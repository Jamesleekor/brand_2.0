# RAKARUKA / TIKATUKA IMPLEMENTATION STATUS

## Naming / authority
- User-facing game name: **라카루카**.
- Internal technical identifiers remain `tikatuka_*` / `Tikatuka*` for compatibility.
- Active implementation branch: `feat/tikatuka-rakaruka-ui-admin-polish`.
- Historical reference: `tikatuka_engine_ai_spec_v1.2.md`.
- **IMPORTANT:** the explicit 알까기 rule confirmed by the user on 2026-09-12 overrides the old automatic-knock rule in v1.2 or older notes/tests.

## Current implementation state
- Core rules / state machine / AI: implemented.
- Student Game #03 integration: implemented.
- Persistence / difficulty unlock: production DB deployed.
- Teacher Rakaruka progress admin: production DB deployed.
- Corrected explicit 알까기 + readable effects/action history: implemented and user browser-tested successfully before Phase 8.
- **Phase 8 — General Ranking + Official 5-match Challenge: source implemented, production DB deployed, authenticated production DB E2E PASS.**
- Phase 8 frontend local build/browser verification: **PENDING USER CHECK**.
- Main merge/deployment of the current feature branch: **NOT DONE by ChatGPT**.

## Authoritative 알까기 rule
For a normal die the actor chooses exactly one action:
1. **Normal placement:** place it in a non-full row on the actor's own board. This never auto-attacks.
2. **알까기:** if an opponent row contains one or more same-value **normal** dice, select that opponent row instead of placing the die.

Knock semantics:
- The attacking normal die is consumed and is not placed on either board.
- Only the selected opponent row is affected.
- All same-value normal dice in that row are removed.
- Same-value shield dice survive; shields are knock-immune.
- Breaking a normal double/triple in one attack is legal.
- Any successful knock gives exactly one pending same-value shield for the attacker's next own turn.
- A normal die may target an opponent row only when a matching normal die actually exists there.
- An available knock counts as a legal action and prevents Forced Pass.

Shield semantics:
- Shield may be placed in any non-full row on either board.
- It fully occupies/scores on the board where it is placed and participates in double/triple scoring.
- Shield cannot Tazza; it may be held.

## Readability / gameplay UX
Implemented:
- larger fonts / contrast / boards;
- Korean `상단 / 중단 / 하단`, `당신의 턴 / 상대의 턴`;
- 2-second dice reveal and slower AI/event presentation;
- strongly differentiated shield dice;
- double/triple markers;
- only legal opponent rows show `💥 알까기 가능`;
- knock cut-in visualizes attack die → target dice → removal;
- persistent action history for Player/AI rolls, placement, Tazza, Hold, knock, shield and result;
- detailed rules guide.

## Teacher Rakaruka management
Source:
- `TeacherArcadePage.tsx`
- `TeacherTikatukaAdminPage.tsx`

Production RPCs:
- `teacher_get_tikatuka_progress_v1()`
- `teacher_set_tikatuka_progress_v1(integer,integer)`

Teacher may adjust only `highest_unlocked_difficulty`; completed-game history is not rewritten. Server re-checks teacher role and current classroom.

Production migration:
- `20260912122941 · tikatuka_teacher_progress_admin`

## Phase 7 persistence / integrity
Production migration:
- `20260912085916 · tikatuka_progress_results`

Server-owned objects include:
- `tikatuka_progress`
- `tikatuka_games`
- server-issued game UUIDs
- student/classroom identity derived server-side
- final-board structure, row scores, total scores, raw pips, row wins and winner recomputed in PostgreSQL
- idempotent identical result submission / conflicting duplicate rejection
- only verified player win advances progression

Integrity boundary remains important: the server validates the submitted completed board/result but does not replay every client turn from a server-issued RNG seed. Rakaruka ranking introduced in Phase 8 is therefore a class honor ranking, not a currency/BV/Guild reward source.

# Phase 8 — Ranking & Official Challenge

## Confirmed ranking rules
### General-play ranking
- Uses **highest actually cleared difficulty**, derived from server-verified completed games where `server_winner='player'`.
- Does **not** use the teacher-adjustable highest-unlocked field as the ranking value.
- Same highest-cleared level = same rank (`dense_rank`).
- QA/test accounts are excluded from the public leaderboard.

### Official challenge
- One challenge = **exactly 5 completed games**.
- Student chooses any currently unlocked difficulty when starting the challenge.
- The chosen difficulty is fixed for all 5 games.
- Win = **+3**; Draw = **+1**; Loss = **0**.
- All 5 games must be completed before the challenge is finalized.
- Final score must be **at least 3** to be ranking-eligible.
  - 1W 4L = 3 → eligible.
  - 3D 2L = 3 → eligible.
  - 2D 3L = 2 → not eligible.
  - 1D 4L = 1 → not eligible.
  - 5L = 0 → not eligible.
- Ranking priority is **challenge difficulty DESC → points DESC**.
- Same difficulty + same points = same rank (`dense_rank`).
- Therefore **Lv.10 / 1W4L / 3 points outranks Lv.9 / 5W / 15 points**.
- Internal monotonic comparison value is `difficulty * 16 + points`; UI displays Lv + W/D/L + points instead of that raw number.
- Competition period is the current KST month.
- Multiple completed challenge attempts may be made in the same month; only the student's best eligible session (highest difficulty, then points) is used in the monthly leaderboard.

## Phase 8 DB objects
Migration source:
- `supabase/migrations/20260912_03_tikatuka_official_ranking.sql`
- `supabase/migrations/20260912_04_tikatuka_official_difficulty_lock.sql`

Production registry:
- `20260912135952 · tikatuka_official_ranking`
- `20260912140004 · tikatuka_official_difficulty_lock`

New table:
- `public.tikatuka_official_sessions`

New `tikatuka_games` fields:
- `official_session_id`
- `official_match_number`

Student RPCs:
- `student_get_tikatuka_competition_v1()`
- `student_start_tikatuka_official_challenge_v1(integer)`

Server trigger flow:
1. A verified game transitions `READY → COMPLETED`.
2. If an ACTIVE challenge exists for the same student/classroom/month/difficulty and the game was issued after challenge start, the game is tagged with session id + match number.
3. AFTER completion, the session receives +3/+1/+0 from `server_winner` only.
4. Fifth counted game automatically marks the session COMPLETED.
5. While a challenge is ACTIVE, a BEFORE INSERT trigger rejects a new Rakaruka game at any other difficulty with `PTK43`.

Security postcheck — PASS:
- `tikatuka_official_sessions` has RLS enabled.
- `authenticated` has no direct SELECT/INSERT/UPDATE/DELETE on the table.
- Competition RPCs are executable by `authenticated`, denied to `anon`.
- Internal payload/trigger functions are not executable by authenticated clients.
- New functions are `SECURITY DEFINER` with fixed `search_path=public, pg_temp`.
- Trigger order on `tikatuka_games` is present as intended:
  - `a_tikatuka_capture_official_completion` BEFORE UPDATE
  - existing `tikatuka_games_guard_history` BEFORE UPDATE/DELETE
  - `tikatuka_guard_active_official_difficulty` BEFORE INSERT
  - `z_tikatuka_advance_official_session` AFTER UPDATE

## Phase 8 production E2E — PASS / ROLLED BACK
Dedicated production test student QA-01 (`is_test_account=true`) was used with real authenticated identity helpers inside one transaction.

Verified:
1. competition payload initially had no active challenge;
2. Lv.2 official challenge creation succeeded;
3. a second ACTIVE challenge was rejected with `PTK42`;
4. trying to issue Lv.3 while the Lv.2 challenge was active was rejected with `PTK43`;
5. five real server-issued game UUIDs at Lv.2 were completed through the existing `student_submit_tikatuka_result` validation path;
6. match numbers were tagged 1→5;
7. 1W4L produced exactly 3 points;
8. the fifth game automatically completed the challenge;
9. the resulting recent challenge was `qualified=true`;
10. QA account did not appear in the public general or official leaderboard;
11. a second Lv.1 five-match session with 1D4L produced 1 point and `qualified=false`;
12. ordering contract confirmed Lv.10/3 points ranks above Lv.9/15 points.

The entire smoke transaction was **ROLLBACK**. Final production counts returned to the exact baseline:
- official sessions total: 0
- games tagged to official sessions: 0
- QA Rakaruka games: 5 (unchanged baseline)
- QA official sessions: 0

## Phase 8 frontend
Added:
- `src/lib/zod_schemas/tikatuka_competition_schemas.ts`
- competition RPC methods in `src/lib/rpc/tikatuka_rpc.ts`
- `src/features/arcade/tikatuka/ui/RakarukaCompetitionPanel.tsx`
- ranking/official challenge panel inside the Rakaruka page
- active challenge progress (`x/5`, W/D/L, points)
- general leaderboard and official leaderboard
- recent personal challenge results
- challenge start difficulty selection limited to unlocked levels
- UI prevents starting a challenge while a live game is in progress; server independently protects difficulty integrity.

Phase 8 source checkpoint before this docs update:
- `42df8e20246909e82672a92e915cc60ff6d4f006`

## Phase 8 test contract prepared
Added `phase8_competition.test.ts` and registered it in `run-tests.ts`.
The test contract checks:
- frontend competition payload schema;
- five-game completion requirement;
- win3/draw1/loss0 formula;
- minimum 3-point qualification;
- difficulty-first `dense_rank` ordering;
- `difficulty*16+points` monotonic ordering;
- test account exclusion;
- only server-completed games advance a session;
- PTK43 active-difficulty lock.

**These frontend/static tests have not been run by ChatGPT.**

## User verification boundary
The user explicitly instructed ChatGPT **not to run `npm ci`, `npm run build`, or CI**. Keep following that instruction.

When the user is ready to verify the current Phase 8 frontend, ask them to run locally:
```bash
git fetch origin
git switch feat/tikatuka-rakaruka-ui-admin-polish
git pull
npm ci
npm run build
```
Do not claim the latest frontend build passes until the user reports the result.

After a successful build, browser smoke should verify:
1. Rakaruka page shows the new `라카루카 랭킹 & 공인 기록` panel.
2. General ranking uses actual highest cleared Lv and same Lv shares rank.
3. Start an official challenge at an unlocked lower/equal difficulty.
4. Active challenge shows 0/5 then increments after each server-saved result.
5. Other-difficulty game start is blocked while challenge is ACTIVE.
6. 5 games finalize the challenge automatically.
7. 3+ points shows `공인 성립`; 0–2 points shows `미인정`.
8. Public official ranking sorts difficulty first, then points, with exact ties sharing rank.
9. A later better same-month session becomes the student's ranking record.

## Main / deployment boundary
- Do not edit or merge `main` without explicit user instruction.
- Production Phase 7, teacher-admin, and Phase 8 ranking migrations are applied.
- Current frontend remains on `feat/tikatuka-rakaruka-ui-admin-polish` until user local verification and explicit merge/deploy instruction.

## Recovery rule
After any interruption:
1. Read this file first.
2. Fetch current branch HEAD.
3. Preserve the corrected explicit-knock rule above.
4. Treat Phase 8 ranking rules in this file as authoritative.
5. Do not run npm/build/CI unless the user explicitly asks; current instruction is that the user will run it locally.
