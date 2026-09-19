# RAKARUKA / TIKATUKA IMPLEMENTATION STATUS

## Naming / authority
- User-facing game name: **라카루카**.
- Internal technical identifiers remain `tikatuka_*` / `Tikatuka*` for compatibility.
- Active branch: `feat/tikatuka-rakaruka-ui-admin-polish`.
- Historical reference: `tikatuka_engine_ai_spec_v1.2.md`.
- **Authoritative overrides:**
  1. Explicit 알까기 replaces the old automatic-knock rule.
  2. Official challenge is teacher-gated and **one 5-game attempt per student per Arcade ranking period**. Earlier unlimited/month-calendar retry notes are obsolete.
  3. Rakaruka ranking periods use `public.arcade_ranking_periods` exactly like Arcade #01/#02; direct KST calendar-month scoping is obsolete.

## Current source state
Implemented:
- Core/state machine/AI and corrected explicit 알까기.
- Student Game #03 selector integration.
- Server progression and difficulty unlock persistence.
- Teacher progress admin.
- Slow readable presentation, shield styling, knock cut-in and action history.
- General ranking and official 5-game ranking.
- Teacher Official Day OPEN/CLOSED gate and single-attempt policy.
- **Rakaruka ranking/official panel moved out of the live game and onto the common Arcade game-selection page.**
- **Rakaruka now uses the same `랭킹 기간 선택` control as Game #01/#02.**
- Live-game player/turn/opponent strip compacted with presentation-only CSS.
- Live-game redundant normal/shield explanatory paragraph removed from view because the detailed rule guide already covers it.
- Recent action history moved above the live game and compacted to the latest six events.

Frontend local build after the latest selector/layout changes: **PENDING USER CHECK**.
ChatGPT must not run `npm ci`, `npm run build`, or CI unless the user explicitly changes that instruction.

## Authoritative 알까기 rule
For a normal die choose exactly one:
1. place it in a non-full row on the actor's own board; this never auto-attacks;
2. if an opponent row contains one or more same-value normal dice, click that opponent row to attack instead of placing the die.

Attack semantics:
- attacking die is consumed and not placed;
- only the selected opponent row is affected;
- all same-value normal dice in that row are removed;
- same-value shield dice survive;
- double/triple matching normals may be removed together;
- any successful attack grants exactly one pending same-value shield for the attacker's next own turn.

Shield:
- may be placed on either board;
- scores and participates in double/triple on the board where it is placed;
- immune to knock;
- cannot Tazza; may be held.

## Ranking rules
### General ranking
- Uses highest **actually cleared** difficulty from verified player wins inside the selected Arcade ranking period.
- Teacher-adjustable unlocked difficulty is not the ranking value.
- Same cleared Lv = same `dense_rank`.
- Test accounts excluded from public ranking.

### Official ranking
- Teacher must OPEN Official Day.
- Student chooses any unlocked difficulty.
- One attempt = exactly 5 completed games at that fixed difficulty.
- W +3 / D +1 / L +0.
- All five games required.
- 3+ points qualifies; 0–2 does not.
- The attempt is consumed when the session starts, even if it later fails to qualify.
- Exactly one attempt per student per **Arcade ranking period id**.
- Ranking order: difficulty DESC → points DESC; exact ties share rank.
- Lv.10 / 3 points outranks Lv.9 / 15 points.
- Closing Official Day blocks new sessions only; already-started sessions may finish.

## Common Arcade period alignment
Rakaruka now scopes rankings to `public.arcade_ranking_periods`.

Student selector behavior:
- Game #01/#02/#03 all show the same `랭킹 기간 선택` buttons.
- Historical visible periods can be selected for leaderboard viewing.
- New Rakaruka play/official challenge starts only in an ACTIVE period.
- General ranking filters completed Rakaruka games to `starts_at <= completed_at < ends_at_exclusive`.
- Official sessions and Official Day windows are keyed by `arcade_period_id`.

Current production ACTIVE example when migration was tested:
- period id 12
- `2026년 9월 Arcade`
- kind `MONTHLY`
- contribution month `2026-09`

## Monthly bonus display
Rakaruka's difficulty-progress card on the Arcade selector now displays the same common Arcade Top-10 bonus reference:
- 1st +30
- 2nd +27
- 3rd +24
- 4–6th +18
- 7–10th +15

Important integrity note:
- For Game #01/#02 these values are already persisted through `arcade_monthly_snapshot_entries.raw_bonus` and feed Guild 2.
- **Rakaruka currently displays the same bonus reference, but its ranking has NOT yet been wired into the existing Arcade monthly-snapshot/Guild-2 finalization pipeline. Do not claim Rakaruka bonus is already automatically applied to Guild 2.**

## Selector/live-game UX changes — 2026-09-13
`ArcadePage.tsx`:
- imports and renders `RakarukaCompetitionPanel` under the Rakaruka description card;
- common ranking-period selector is shown for Rakaruka instead of the old separate progress badge;
- removed copy: `월간 Top 10과는 별도의 전략 게임입니다. 승리한 난이도와 다음 단계 해금은 서버에 영구 저장됩니다.`;
- Rakaruka progress card includes common Top-10 bonus numbers;
- live start is disabled when the selected period is not ACTIVE.

`TikatukaGame.tsx`:
- no `RakarukaCompetitionPanel` inside the game;
- recent action history is above the core game;
- rule guide remains below;
- knock cut-in remains.

`tikatuka-layout.css`:
- compacts player/opponent score + Tazza/Hold cards;
- reduces turn-card vertical height;
- hides the duplicate normal/shield paragraph in live play.

## Production migrations
Relevant live migrations:
- `20260912085916 · tikatuka_progress_results`
- `20260912122941 · tikatuka_teacher_progress_admin`
- `20260912135952 · tikatuka_official_ranking`
- `20260912140004 · tikatuka_official_difficulty_lock`
- `20260912153133 · tikatuka_official_day_single_attempt`
- `20260912155213 · tikatuka_align_arcade_periods`

Latest period alignment migration adds:
- `tikatuka_official_sessions.arcade_period_id`
- `tikatuka_official_windows.arcade_period_id`
- one-attempt uniqueness keyed by Arcade period id
- `student_get_tikatuka_competition_v2(bigint)`
- `student_start_tikatuka_official_challenge_v2(bigint,integer)`
- period-scoped payload metadata and ranking filters
- teacher Official Day mapped to the currently ACTIVE Arcade period.

Migration source was corrected after a syntax-only check found that PostgreSQL does not allow the UPDATE target alias inside that `FROM LATERAL` backfill form. Repository source now uses the same correlated scalar-subquery backfill successfully deployed to production.

## Production E2E / postchecks
Period-scoped E2E passed in one transaction and was rolled back:
- student v2 payload for period 12 returned the correct period id/display;
- CLOSED baseline enforced;
- teacher OPEN targeted period 12;
- first student official session at period 12 succeeded;
- second same-period attempt rejected with `PTK45`;
- non-ACTIVE period could not accept a new official challenge (`PTK50`).

Post-rollback production counts:
- official windows: 0
- official sessions: 0
- tagged official games: 0

Earlier Official Day/persistence authenticated E2E also passed and was rolled back.

## Test contract prepared, NOT executed by ChatGPT
`phase8_competition.test.ts` now statically locks:
- period metadata schema;
- 5-game / 3-1-0 / 3-point rules;
- difficulty-first ranking;
- teacher gate / one attempt;
- `arcade_period_id` and exact Arcade-period boundary filtering;
- v2 competition RPC names;
- ranking panel present in `ArcadePage.tsx` and absent from live `TikatukaGame.tsx`;
- removed old separate-strategy copy;
- action history before live core;
- compact layout override existence.

## Next verification handoff
When the user is ready, ask them to update this branch and run only the local verification they agreed to perform. At minimum:
```bash
git fetch origin
git switch feat/tikatuka-rakaruka-ui-admin-polish
git pull
npm run build
```
Do not claim build success until the user reports it.

After build success, browser smoke should check:
1. Arcade selector: #01 → #02 → #03 and common ranking-period buttons.
2. Rakaruka description has no old “별도의 전략 게임” copy.
3. Rakaruka right side shows difficulty progress + common bonus reference.
4. Rakaruka general/official ranking panel is on selector page, not live game.
5. Changing selected Arcade period changes Rakaruka ranking payload.
6. Live game has no ranking panel.
7. Live player/turn/opponent cards are visibly shorter.
8. Duplicate normal/shield paragraph is gone.
9. Recent action history is immediately visible above the game after actions begin.
10. Teacher Official Day OPEN → student one-shot challenge still works.

## Main/deployment boundary
- Do not merge/edit `main` without explicit user instruction.
- Production DB migrations above are already live.
- Frontend remains on `feat/tikatuka-rakaruka-ui-admin-polish` until user local build/browser verification and explicit merge/deploy request.
