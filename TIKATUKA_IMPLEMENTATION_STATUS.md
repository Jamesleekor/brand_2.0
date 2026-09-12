# RAKARUKA / TIKATUKA IMPLEMENTATION STATUS

## Naming / priority
- User-facing game name: **라카루카**.
- Internal technical identifiers remain `tikatuka_*` / `Tikatuka*` for compatibility.
- Current implementation branch: `feat/tikatuka-rakaruka-ui-admin-polish`.
- Historical design reference: `tikatuka_engine_ai_spec_v1.2.md`.
- **IMPORTANT OVERRIDE (2026-09-12): the user-corrected explicit 알까기 rule below supersedes the old v1.2 automatic-knock rule and every older note/test that contradicts it.**

## Authoritative 알까기 rule — corrected 2026-09-12
For a **normal die**, the player/AI chooses exactly one of these actions:
1. **Normal placement** — place it in a non-full row on the actor's own board. This never auto-attacks anything.
2. **알까기 attack** — if an opponent row contains one or more **normal** dice with the same value as the current die, select that opponent row instead of placing the die.

Explicit knock semantics:
- The attacking normal die is consumed as the attack and **is not placed on either board**.
- Only the chosen opponent row is affected.
- Every matching-value **normal** die in that row is removed.
- Matching-value **shield** dice survive; shields are knock-immune.
- Removing a double/triple of matching normal dice at once is legal and intentionally valuable.
- A successful knock earns exactly one pending shield of the attacking value for the attacker's next own turn, regardless of whether 1, 2, or 3 dice were removed.
- A normal die may target an opponent row only when that row actually contains a matching normal die.
- An available knock is a legal action and therefore prevents Forced Pass.

Shield semantics remain:
- A shield die can be placed in any non-full row on either board.
- A shield fully occupies/scores on the board where it is placed and participates in double/triple scoring.
- A shield cannot use Tazza; it may be held.

## Current source state
The corrected rule has been implemented through the shared Core path used by live play and AI:
- `engine/rules/placement.ts`
  - normal legal targets = own non-full rows + opponent rows containing a matching normal die;
  - shield legal targets = non-full rows on either board;
  - exports knock-target helpers.
- `engine/rules/knock.ts`
  - resolves only an explicitly selected opponent row;
  - removes matching normals and preserves shields.
- `engine/validateAction.ts`
  - validates explicit opponent-row knock selection instead of blanket-rejecting normal opponent targets.
- `engine/placementResolution.ts`
  - own normal placement emits `DIE_PLACED` and never auto-knocks;
  - opponent normal target consumes the attack die, emits `DICE_KNOCKED`, updates knock stats, and queues the shield reward.
- AI continues to share `getLegalPlacements()` + `resolvePlacementOutcome()`, so Basic AI and Advanced search automatically evaluate explicit knock choices without a separate AI-only rule path.

## Readability / UX implementation
Current branch includes:
- Game #03 integrated into the normal student Arcade selector.
- Larger fonts / higher-contrast labels / larger boards.
- Korean row names `상단 / 중단 / 하단` and turn labels.
- 2-second dice rolling reveal.
- Slower AI thinking and event narration.
- Visually distinct shield dice with large shield styling and `실드` badge.
- Persistent double/triple markers.
- **Explicit knockable-row UI**: when a normal die can knock an opponent row, only the legal opponent rows become clickable and receive a `💥 알까기 가능` marker.
- **Knock impact cut-in**: attacking die visibly flies toward the selected row; removed dice shake/fade; the message states that the attacking die is not placed.
- **Persistent action history**: recent player/AI rolls, placements, Tazza, Hold, knock actions, shield rewards and game result remain readable below the game. Development StrictMode duplicate events are deduplicated by event object identity.
- Detailed corrected rules guide explaining normal placement vs knock as mutually exclusive choices.

## Teacher Arcade management
Implemented source:
- `TeacherArcadePage.tsx` preserves legacy #01/#02 management and exposes 라카루카 management.
- `TeacherTikatukaAdminPage.tsx` shows student highest unlocked level, real cleared levels, W/L/D, games played and last-played time.
- Teacher may adjust only `highest_unlocked_difficulty`; immutable completed-game history is not rewritten.

Production DB:
- Phase 7 migration `tikatuka_progress_results` applied as version `20260912085916`.
- Teacher admin migration `tikatuka_teacher_progress_admin` applied as version `20260912122941`.
- `teacher_get_tikatuka_progress_v1()` and `teacher_set_tikatuka_progress_v1(integer,integer)` are live.
- Both are `SECURITY DEFINER`, executable by `authenticated`, denied to `anon`, and re-check teacher role/current classroom server-side.

## Persistence / integrity
Phase 7 remains complete:
- server-owned `tikatuka_progress` and `tikatuka_games`;
- server-issued game UUID;
- authenticated student/classroom derived server-side;
- final-board structure, scores, raw pips, row wins and winner recomputed in PostgreSQL;
- identical duplicate submission is idempotent; conflicting duplicate rejected;
- only verified player victory advances progression;
- no official Arcade ranking/Guild/currency rewards are connected because full turn-by-turn authoritative replay is not yet implemented.

The corrected explicit-knock rule does not require a DB schema change: final boards and knock/shield counters use the existing persistence contract. The invariant `shieldsEarned == knockCount` still matches the corrected rule.

## Production smoke history
Before the explicit-knock correction, production persistence/RPC smoke completed successfully using only the dedicated QA test student, inside a transaction that was rolled back. The final production row-count check returned zero smoke-test rows. This validates the persistence/RPC boundary, not the newly corrected browser/Core knock behavior.

## Test-contract updates prepared
Tests have been rewritten (but **not executed after the latest rule correction**, per user instruction) to lock:
- own-board normal placement never auto-knocks;
- normal opponent target is legal only when matching normal dice exist;
- explicit knock consumes the attack die and does not emit `DIE_PLACED`;
- matching normals are all removed, shields survive;
- successful knock queues one same-value shield;
- Basic AI can choose a high-value opponent-row knock;
- UI action narration/history describes explicit knock correctly;
- current slower AI/event timing contracts.

Remaining Phase 5 search/turn-simulation/persistence tests were reviewed for old automatic-knock assumptions; no structural rewrite was required because they either do not depend on knock behavior or consume the shared legal-placement/resolution functions.

## Verification boundary — IMPORTANT
The user explicitly requested that ChatGPT **not run `npm ci`, `npm run build`, or CI for this final correction cycle**. Therefore:
- The latest explicit-knock Core/AI/UI source is **CODED but not yet locally build-verified**.
- Do not claim the current HEAD passes the suite/build until the user runs it and reports success.
- The last historical successful automated checkpoint predates this corrected-knock rule and must not be used as evidence that the new rule compiles.

## Next verification handoff
When source work is complete, the user should run locally on this branch:
```bash
git fetch origin
git switch feat/tikatuka-rakaruka-ui-admin-polish
git pull
npm ci
npm run build
```
If build succeeds, run the existing Tikatuka/Rakaruka test command if desired and then `npm run dev` for browser smoke.

Manual browser checks for the corrected rule:
1. Place a normal die on your own row while opponent has the same number elsewhere/same row → **nothing on opponent board disappears**.
2. With a normal die matching opponent normal dice, only matching opponent rows show **`알까기 가능`**.
3. Click a marked opponent row → attack die is **not added to your board**; matching normals in selected row are removed.
4. A matching shield in that row survives.
5. Opponent double/triple made only of matching normals can be removed together.
6. Knock cut-in visibly shows attack die → targets → removal.
7. Next own turn receives exactly one same-value shield.
8. Action history clearly records both AI and player actions.
9. AI can itself choose an explicit knock and the history/cut-in makes that action understandable.
10. Teacher 라카루카 admin page loads and highest-unlock adjustment works against the already-applied production RPCs.

## Main / deployment boundary
- Do not edit or merge `main` without explicit user instruction.
- Production DB migrations are already applied.
- Frontend corrected-knock implementation remains on `feat/tikatuka-rakaruka-ui-admin-polish` until local build/browser verification and an explicit merge request.

## Recovery rule
After any interruption:
1. Read this file first.
2. Fetch current branch HEAD.
3. Treat the corrected explicit-knock rule above as higher priority than v1.2/older conversations/tests.
4. Do not run npm/build/CI unless the user asks; current user instruction is that they will do it locally.
