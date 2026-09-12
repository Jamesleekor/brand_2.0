# RAKARUKA / TIKATUKA IMPLEMENTATION STATUS

## Naming / authority
- User-facing game name: **라카루카**.
- Internal technical identifiers remain `tikatuka_*` / `Tikatuka*` for compatibility.
- Active implementation branch: `feat/tikatuka-rakaruka-ui-admin-polish`.
- Historical reference: `tikatuka_engine_ai_spec_v1.2.md`.
- **IMPORTANT RULE OVERRIDES:**
  1. The explicit 알까기 rule confirmed on 2026-09-12 overrides the old automatic-knock rule.
  2. The **Official Day single-attempt policy confirmed on 2026-09-13 overrides the earlier Phase-8 unlimited same-month retry design.**

## Current implementation state
- Core rules / state machine / AI: implemented.
- Student Game #03 integration: implemented.
- Persistence / difficulty unlock: production DB deployed.
- Teacher Rakaruka progress admin: production DB deployed.
- Corrected explicit 알까기 + effects/action history: implemented and browser-tested by user.
- General ranking + official 5-match ranking: implemented.
- **Official Day teacher gate + one attempt per student/current KST month: source implemented, production DB deployed, DB E2E PASS / ROLLED BACK.**
- Latest frontend local build/browser verification after Official Day changes: **PENDING USER CHECK**.
- Main merge/deployment: **NOT DONE by ChatGPT**.

# Authoritative gameplay rules

## 알까기
For a normal die the actor chooses exactly one action:
1. **Normal placement:** place it in a non-full row on the actor's own board. This never auto-attacks.
2. **알까기:** if an opponent row contains one or more same-value normal dice, select that opponent row instead of placing the die.

Knock semantics:
- attacking normal die is consumed and is not placed;
- only the selected opponent row is affected;
- all same-value normal dice in that row are removed;
- same-value shields survive;
- normal double/triple may be broken in one attack;
- a successful knock gives exactly one same-value pending shield for next own turn;
- only rows containing a matching normal die are legal knock targets.

Shield semantics:
- shield may be placed in any non-full row on either board;
- it scores on the board where placed and participates in double/triple;
- shield cannot Tazza; it may be held.

# Readability / gameplay UX
Implemented:
- larger fonts / contrast / boards;
- Korean row and turn labels;
- 2-second dice reveal and slower AI/event narration;
- strongly differentiated shield dice;
- double/triple markers;
- `💥 알까기 가능` only on legal opponent rows;
- knock impact cut-in;
- persistent action history;
- detailed rules guide.

# Teacher Rakaruka management
Source:
- `TeacherArcadePage.tsx`
- `TeacherTikatukaAdminPage.tsx`
- `TeacherTikatukaOfficialWindowCard.tsx`

Teacher progress RPCs:
- `teacher_get_tikatuka_progress_v1()`
- `teacher_set_tikatuka_progress_v1(integer,integer)`

Official Day RPCs:
- `teacher_get_tikatuka_official_window_v1()`
- `teacher_set_tikatuka_official_window_v1(boolean)`

Teacher may adjust only `highest_unlocked_difficulty`; completed-game history is not rewritten. Server re-checks teacher role/current classroom.

Official Day admin behavior:
- default state is **CLOSED** when no window row exists;
- teacher can OPEN/CLOSE from Rakaruka admin;
- OPEN allows students who have not used their attempt to start;
- CLOSE prevents **new** challenge starts;
- CLOSE does **not** cancel students who already started; their remaining matches continue;
- admin panel shows started/completed participant counts.

# Phase 7 persistence / integrity
Production migration:
- `20260912085916 · tikatuka_progress_results`

Teacher admin migration:
- `20260912122941 · tikatuka_teacher_progress_admin`

Server-owned persistence includes:
- `tikatuka_progress`
- `tikatuka_games`
- server-issued game UUIDs
- server-derived student/classroom identity
- final-board/score/winner recomputation
- idempotent identical submission / conflicting duplicate rejection
- verified player win only advances progression.

Integrity boundary: server validates completed board/result but does not replay every turn from a server-issued RNG seed. Ranking is class honor ranking, not BV/currency/Guild reward source.

# Phase 8 — Ranking

## General ranking
- Uses highest **actually cleared** difficulty from verified completed wins.
- Does not use teacher-adjustable highest-unlocked as ranking value.
- Same highest-cleared Lv = same rank (`dense_rank`).
- Test accounts excluded from public leaderboard.

## Official ranking — authoritative 2026-09-13
- Current competition period key = current **KST month**.
- Official challenge is available only when teacher opens **Official Day**.
- Each student gets **exactly one challenge session per period**.
- One session = exactly **5 completed games**.
- Student chooses any currently unlocked difficulty at challenge start.
- Chosen difficulty is fixed for all 5 games.
- Win +3 / Draw +1 / Loss 0.
- All 5 games must finish before finalization.
- Minimum 3 points for ranking eligibility.
  - 1W4L = 3 → eligible.
  - 3D2L = 3 → eligible.
  - 2D3L = 2 → not eligible.
  - 1D4L = 1 → not eligible.
  - 5L = 0 → not eligible.
- **The one attempt is consumed regardless of whether the final record qualifies. No retry.**
- Ranking priority: difficulty DESC → points DESC.
- Same difficulty + same points = same rank.
- Therefore Lv.10 / 1W4L / 3 points outranks Lv.9 / 5W / 15 points.
- Internal comparison value may use `difficulty * 16 + points`; UI shows Lv + W/D/L + points.

## Phase 8 DB migrations
- `20260912135952 · tikatuka_official_ranking`
- `20260912140004 · tikatuka_official_difficulty_lock`
- `20260912153133 · tikatuka_official_day_single_attempt`

Migration source:
- `supabase/migrations/20260912_03_tikatuka_official_ranking.sql`
- `supabase/migrations/20260912_04_tikatuka_official_difficulty_lock.sql`
- `supabase/migrations/20260913_01_tikatuka_official_day_single_attempt.sql`

Tables:
- `tikatuka_official_sessions`
- `tikatuka_official_windows`

`tikatuka_games` official fields:
- `official_session_id`
- `official_match_number`

Student RPCs:
- `student_get_tikatuka_competition_v1()`
- `student_start_tikatuka_official_challenge_v1(integer)`

Server enforcement:
1. `tikatuka_official_windows` defaults effectively CLOSED when no current-period row exists.
2. Student challenge start while CLOSED → `PTK44`.
3. Unique index `(classroom_id, student_id, period_key)` enforces one attempt per period.
4. Second challenge start → `PTK45`.
5. Active challenge locks newly issued Rakaruka games to its chosen difficulty (`PTK43`).
6. Closing Official Day affects only new session creation; active sessions stay active.
7. Verified `READY → COMPLETED` games only are captured into active session.
8. Fifth counted match automatically completes session.

Security:
- official tables have RLS enabled;
- authenticated client has no direct table CRUD;
- student/teacher use narrow SECURITY DEFINER RPCs;
- anon has no execute on those RPCs;
- internal helpers are not executable by authenticated clients;
- fixed `search_path=public, pg_temp`.

# Production E2E — Official Day single-attempt policy
Performed against production using dedicated QA test identity inside one transaction and **ROLLBACK**.

Verified:
1. default CLOSED blocks student challenge creation with `PTK44`;
2. teacher RPC opens Official Day;
3. first student challenge creation succeeds;
4. payload reports `official_attempt_used=true`, `official_can_start=false` and active challenge;
5. second challenge creation in same period is rejected with `PTK45`;
6. teacher RPC closes Official Day;
7. already-started student can still issue the next game at the active challenge difficulty after closing;
8. student competition payload after close reports CLOSED + used attempt + active challenge;
9. all test mutations rolled back.

Post-rollback production counts:
- `tikatuka_official_windows`: 0
- `tikatuka_official_sessions`: 0
- games tagged to official sessions: 0

Therefore current production starts in CLOSED state until teacher deliberately opens Official Day.

# Phase 8 frontend
Added/updated:
- `tikatuka_competition_schemas.ts`
- competition + Official Day RPC methods in `tikatuka_rpc.ts`
- `RakarukaCompetitionPanel.tsx`
- `TeacherTikatukaOfficialWindowCard.tsx`
- `TeacherTikatukaAdminPage.tsx`

Student UI states:
- CLOSED: no start button; tells student teacher must open Official Day.
- OPEN + unused: unlocked Lv selection + strong one-chance warning + start button.
- ACTIVE: x/5, W/D/L, points, remaining games; continues even if teacher later closes.
- USED/completed: no retry button; shows the single challenge result and qualification state.

Teacher UI:
- OPEN/CLOSED status;
- started/completed counts;
- open/close controls with confirmation;
- warning that closing does not cancel active sessions.

# Test contract
`phase8_competition.test.ts` now checks:
- competition payload gate/attempt fields;
- 5-game 3/1/0 scoring contract;
- minimum 3-point qualification;
- difficulty-first dense ranking;
- PTK43 active-difficulty lock;
- Official Day table;
- one-attempt unique index;
- PTK44 closed-window rejection;
- PTK45 second-attempt rejection;
- teacher Official Day RPC presence.

**These frontend/static tests have not been run by ChatGPT.**

# User verification boundary
The user explicitly instructed ChatGPT **not to run `npm ci`, `npm run build`, or CI**. Keep following that instruction.

When ready for local verification, user should run:
```bash
git fetch origin
git switch feat/tikatuka-rakaruka-ui-admin-polish
git pull
npm run build
```
`npm ci` is needed only if local dependencies are not already installed/current.

Browser smoke after successful build:
1. Teacher Rakaruka admin initially shows Official Day CLOSED.
2. Student Rakaruka panel shows CLOSED and no start action.
3. Teacher presses OPEN.
4. Student panel refreshes to OPEN and offers unlocked Lv selection.
5. Student starts one challenge; active panel shows 0/5.
6. A second start is impossible in UI/server.
7. Teacher may CLOSE while challenge is active; student continues remaining matches.
8. After 5 matches, result becomes eligible at 3+ points or not eligible at 0–2.
9. Student receives no retry button after completion.
10. General and official leaderboards retain confirmed ranking rules.

# Main / deployment boundary
- Do not merge/edit `main` without explicit user instruction.
- Production DB migrations through Official Day single-attempt policy are already applied.
- Frontend remains on `feat/tikatuka-rakaruka-ui-admin-polish` until user local verification and explicit merge/deploy instruction.

# Recovery rule
After interruption:
1. Read this file first.
2. Fetch current branch HEAD.
3. Preserve corrected explicit-knock rule.
4. Preserve Official Day single-attempt policy as authoritative over earlier Phase-8 retry design.
5. Do not run npm/build/CI unless user explicitly asks.
