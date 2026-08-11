# Guild 2 SPEC — GS Engine & Individual Contribution

**Status:** DESIGN ACCEPTED / IMPLEMENTATION NEXT  
**Date:** 2026-08-12  
**Depends on:** Guild 1 COMPLETE  
**Future integrations:** Guild 3 Mission, Guild 4 Peer Review, Guild 5 Monthly Closure

---

# 0. Goal

Guild 2는 길드 점수(GS)의 계산 기반과 월간 개인 기여도 구조를 만든다.

이 단계의 목적은 단순히 숫자를 화면에 찍는 것이 아니다.

다음 조건을 만족해야 한다.

- 개인기여도 900 + arcade 90 규칙을 server-side로 표현 가능
- GS가 source별로 추적 가능
- correction/audit가 가능
- 4인 길드 compensation을 수동 설정 가능
- Guild 3 Mission과 Guild 4 Peer Review가 이후 자연스럽게 연결 가능
- 학생에게는 적절한 수준만 공개
- 교사에게는 계산 근거가 충분히 보임
- 월 최종 확정/reopen은 Guild 5가 담당

---

# 1. Terminology

## BASIC CONTRIBUTION

4개 기본 영역의 합.

`basic = peer + mission + session + teacher_observation`

Range:

`0..900`

## ARCADE BONUS

월간 mini-game ranking bonus.

Range after cap:

`0..90`

## FINAL INDIVIDUAL CONTRIBUTION

`final = basic + arcade_bonus`

Range:

`0..990`

## MONTHLY GUILD GS

Conceptually:

`guild_gs = sum(final individual contribution) + guild mission GS + member-count compensation`

member-count compensation은 수동 지정된 길드에만 적용된다.

---

# 2. Personal contribution composition

| Component | Max | Nature |
|---|---:|---|
| Peer review | 300 | corrected peer perception |
| Mission contribution | 300 | guild clear + personal execution |
| Guild session | 150 | attendance responsibility |
| Teacher observation | 150 | logged qualitative contribution |
| **Basic** | **900** | |
| Arcade bonus | **+90** | optional absolute bonus |
| **Absolute max** | **990** | |

각 영역은 의미가 겹치지 않도록 유지한다.

- Peer = 함께 일한 길드원이 느낀 기여
- Mission = 실제 맡은 미션 수행
- Session = 공식 길드 활동 참여
- Teacher observation = 수치화하기 어려운 협력/지원/리더십 등
- Arcade = 별도 게임 성취 보너스

---

# 3. Peer review component — max 300

> Full feature implementation belongs to Guild 4.
> Guild 2 must prepare the data/calculation contract and must not reuse the old formula.

## 3.1 Why raw average is forbidden

Guild size is small:

- one 4-member guild
- four 5-member guilds

Simple trimmed mean would discard too much data.

Simple average is too sensitive to:

- personal friendship
- hostility
- habitual generous scoring
- habitual harsh scoring
- deliberate 1 / 10 extremes

Therefore use score correction rather than deleting evaluators.

## 3.2 Accepted two-stage correction

Let reviewer `r` give raw score `x(r,t)` to target `t`.

All peer scores are 1..10.

### Stage A — reviewer tendency correction

For each reviewer:

`reviewer_mean(r) = mean(all valid raw scores given by reviewer r in the round)`

Find:

`center = median(all reviewer_mean values)`

Reviewer bias:

`raw_bias(r) = reviewer_mean(r) - center`

Cap bias:

`bias(r) = clamp(raw_bias(r), -1.5, +1.5)`

First corrected score:

`a(r,t) = clamp(x(r,t) - bias(r), 1, 10)`

Meaning:

- universally generous reviewers are slightly pulled down
- universally harsh reviewers are slightly pulled up
- individual preference still exists
- correction itself is capped

### Stage B — target-specific extreme influence cap

For target `t`:

`target_median(t) = median(all a(r,t) received by t)`

Allowed band:

`target_median(t) ± 2.0`

Final corrected evaluation:

`b(r,t) = clamp(a(r,t), target_median(t)-2, target_median(t)+2)`

Then clamp final value again to `1..10`.

Final rating:

`peer_rating(t) = mean(all b(r,t))`

Contribution points:

`peer_points(t) = peer_rating(t) / 10 × 300`

## 3.3 Audit

Teacher must be able to inspect:

- reviewer
- target
- raw score
- reviewer tendency correction
- stage-A score
- target median
- final corrected score
- comment
- submission time

Scores whose final correction differs significantly from raw should be visually reviewable by teacher.

Do not delete the original score.

## 3.4 Student visibility

Student sees only:

`동료평가 N / 300`

and generic explanation:

“길드원들의 평가를 종합·보정하여 반영한 점수입니다.”

Student does NOT see:

- evaluator identity
- evaluator-by-evaluator score
- raw average
- correction amount
- target median
- correction algorithm intermediate values
- which reviewer was adjusted

Teacher-selected published feedback is separate from score visibility.

## 3.5 Future Guild 4 rules already accepted

Guild 4 will also implement:

- no self-review
- one guildmate at a time
- 1..10
- comment minimum 20 characters
- progress indicator
- participant/obligation snapshot when review round opens
- membership changes must not change obligations
- deadline visible
- teacher “end now / reveal”
- at deadline reveal using evaluations actually completed
- non-evaluator penalty: 2,000 GOLD
- teacher sees all authors/scores/comments
- student default sees only aggregate score
- teacher can select comments to publish

Guild 2 must not implement a different participant model that would conflict with this.

---

# 4. Mission contribution component — max 300

> Full mission lifecycle belongs to Guild 3.
> Guild 2 must define the scoring contract now.

## 4.1 Monthly normalization

Mission count varies by month.
Some months may have 2 missions, others 3 or more.

Therefore do NOT assign a fixed 100/150 per mission.

Each mission gets a positive **weight**.

For month with missions `i = 1..n`:

`mission_max_i = 300 × weight_i / sum(all monthly mission weights)`

The monthly mission contribution maximum is always 300.

Weight represents mission scale/contribution weight, not merely “difficulty”.

## 4.2 80% guild result + 20% personal execution

For each mission's normalized personal max:

Guild clear base:

- mission CLEARED: +80%p
- mission FAILED: +0%p

Teacher personal execution grade:

| Grade | Personal factor |
|---|---:|
| S | +20%p |
| A | +15%p |
| B | +10%p |
| C | +5%p |
| F | +0%p |

Per-student mission score:

`mission_max_i × (clear_factor + grade_factor)`

Where:

- clear_factor = `0.80` if cleared else `0`
- S = `0.20`
- A = `0.15`
- B = `0.10`
- C = `0.05`
- F = `0`

Examples:

Cleared + S = 100%  
Cleared + A = 95%  
Cleared + B = 90%  
Cleared + C = 85%  
Cleared + F = 80%

Failed + S = 20%  
Failed + A = 15%  
Failed + B = 10%  
Failed + C = 5%  
Failed + F = 0%

**Accepted rule:** even if the guild mission fails, a student can preserve the personal 0..20% portion.

This is because individual contribution measures the individual, not only the team's final outcome.

## 4.3 Student mission activity record

Do NOT create per-mission teacher checklists.

Teacher workload must stay low.

Student submits one short activity record describing what they actually did.

Required UI text:

> 이번 미션에서 내가 실제로 한 일을 **구체적으로** 적어주세요.  
> *(길드 개인 기여도 점수에 일부 반영됩니다.)*

The word **구체적으로** must be visually emphasized.

Recommended example shown below input:

Bad:
`자료조사를 했다.`

Good:
`태풍 피해 사례 4개를 조사하고, 그중 3개를 발표자료 2~3쪽에 정리했다.`

This is evidence, not a self-selected grade.

Student does NOT select S/A/B/C/F.

## 4.4 Teacher grading UX

Teacher sees:

- student
- mission
- student's activity record
- quick `[S] [A] [B] [C] [F]` buttons

Teacher clicks one grade.

No per-student custom checklist.

If student submitted no activity record:

- personal execution defaults to F / 0% bonus
- teacher may explicitly override when there is a valid exceptional reason

## 4.5 Student visibility

Student sees:

- monthly mission contribution score `/300`
- each mission's own S/A/B/C/F grade
- own activity record

Student does NOT see detailed point arithmetic for each mission.

---

# 5. Guild session component — max 150

Guild session attendance is distinct from school attendance.

Accepted formula:

`session_points = max(0, 150 - 30 × ABSENT count)`

Status treatment:

- PRESENT: no deduction
- EXCUSED: no deduction
- ABSENT: -30

Typical month has 3–4 sessions, but formula does not change with session count.

Only sessions for which the student belongs to the session participant snapshot should be considered for that student's session history.

Student visibility is transparent:

- session score `/150`
- “일반 불참 N회 × -30”
- per-session status list

---

# 6. Teacher observation component — max 150

Teacher records meaningful guild contribution actions.

Categories:

- 협력
- 리더십
- 책임
- 지원
- 문제해결
- 기타

Each accepted log:

`+10 points`

Monthly score:

`min(number_of_logs × 10, 150)`

Maximum scoring logs:

15 equivalent scoring events / month.

Additional audit logs may be retained, but score stays capped at 150.

Each log should contain:

- student
- category
- short evidence/reason memo
- timestamp
- teacher/actor
- optional “학생에게 공개” flag

The memo is a record of why the log exists, not a long rubric.

## 6.1 Student visibility

Student sees:

- `길드 기여 기록 N / 150`
- recognized action count
- category counts
  - 협력 ×2
  - 책임 ×3
  - etc.

Teacher memo text is private by default.

Only entries explicitly marked public are visible to student.

---

# 7. Arcade bonus — max +90

The Arcade project initially contains 6 mini-games and may grow later.

Each game's monthly ranking snapshot awards absolute personal contribution points:

| Rank | Bonus |
|---|---:|
| 1 | +30 |
| 2 | +27 |
| 3 | +24 |
| 4–6 | +18 |
| 7–10 | +15 |
| 11+ | 0 |

Student's monthly raw arcade sum may exceed 90.

Applied bonus:

`arcade_bonus = min(sum(all game monthly bonuses), 90)`

Example:

Four game wins:

`30 + 30 + 30 + 30 = 120`

Applied:

`+90`

## 7.1 Integration principles

- Rankings are monthly snapshot results, not live contribution changes.
- Game count may increase without changing the 90 cap.
- Use stable game identifier/code rather than fixed six columns.
- Store rank and awarded raw points per game/month/student for audit.
- Applied capped total is separate from raw total.
- Arcade score does NOT participate in 4-member compensation average.

## 7.2 Student visibility

Arcade is objective and can be transparent.

Show:

- game
- monthly rank
- raw bonus
- raw monthly sum
- capped applied bonus

Example:

`획득 117 / 반영 +90`

---

# 8. Basic and final contribution

For student `s`:

`basic_s = peer_s + mission_s + session_s + teacher_s`

Range:

`0..900`

`arcade_s = min(raw_arcade_s, 90)`

`final_s = basic_s + arcade_s`

Range:

`0..990`

Do not use BV increase in the new formula.

Do not use old alpha/participation/attendance weight constants.

---

# 9. Four-member guild compensation

## 9.1 Why not ×1.25

The current 4-member guild is not simply a normal 5-member guild missing one random member.
Its average student capability is intentionally higher.

Therefore converting it to a full five-person equivalent with ×1.25 is considered over-compensation.

## 9.2 Accepted model: half-member compensation

Only a teacher-designated compensation guild receives:

`compensation = 0.5 × average BASIC contribution of the scoring roster`

Equivalent idea:

**4.5-person treatment, not 5-person treatment.**

Arcade is excluded.

## 9.3 Manual designation

Do NOT automatically enable compensation because current member count is 4.

Teacher must explicitly set:

`인원 보정 대상 길드`

for the relevant guild/season.

Suggested persisted semantics:

- enabled boolean
- factor = 0.50
- season/guild scope
- changed_by
- changed_at

The setting does not automatically change when actual member count changes.

This matters because a student may transfer out during Season 2.

## 9.4 Rounding

Accepted presentation/calculation rule:

Round compensation to the nearest **10 GS**.

Example:

373.75 -> 370  
376 -> 380

Use one server-side rounding implementation.

## 9.5 Mission headcount

There is **no generic system-level “headcount-sensitive mission” compensation**.

If a mission's structure makes 4 members disadvantageous or advantageous,
the teacher handles it in the mission design/rules itself.

Do not add automatic mission headcount correction.

---

# 10. Guild mission GS

Separate from the student's 300-point mission-contribution component.

The team mission result itself contributes to Guild GS.

Season 2 target:

**sum of all monthly full-clear mission GS = 5,000**

Mission count may vary.

Weights should allow the 5,000 monthly pool to be distributed by mission scale.

Concept:

`mission_gs_max_i = 5000 × weight_i / sum(monthly mission weights)`

The exact partial-clear/scoring state model belongs to Guild 3.
Do NOT invent partial-credit rules in Guild 2.

Guild 2 only needs to be able to ingest/aggregate the official mission GS values when Guild 3 supplies them.

---

# 11. Monthly Guild GS

For a normal guild:

`monthly_gs = sum(final individual contributions) + monthly mission GS`

For a manually compensated guild:

`monthly_gs = sum(final individual contributions) + monthly mission GS + compensation`

Where:

`compensation = round_to_nearest_10(0.5 × average BASIC contribution)`

5-member design ceiling:

- basic: 900 × 5 = 4,500
- mission full clear: 5,000
- subtotal: 9,500
- arcade maximum: +90 × 5 = +450
- theoretical absolute: 9,950

Therefore “10,000 GS” is the practical perfect-month ceiling.

---

# 12. Relationship between personal mission contribution and guild mission GS

Mission influences GS in two distinct ways intentionally.

1. **Individual mission contribution (inside 900)**
   - did this student actually perform?
   - team clear 80% + personal grade 20%

2. **Guild mission GS (monthly pool 5,000)**
   - did the team achieve the mission outcome?

This is not considered accidental double counting.
They measure different things.

---

# 13. Student contribution UI

Do NOT expose every calculation input.

Use layered transparency.

## 13.1 Header

Example:

`8월 개인 기여도`
`742점`

`기본 697 / 900`
`아케이드 +45 / 90`

Current month badge:

`집계 중`

Finalized month:

`확정`

Finalization/reopen belongs to Guild 5.

## 13.2 Component cards

Show:

- 동료평가 `N / 300`
- 미션 기여 `N / 300`
- 길드 세션 `N / 150`
- 길드 기여 기록 `N / 150`
- 아케이드 보너스 `+N / 90`

## 13.3 Detail policy

### Peer
Only final component score + generic explanation.

### Mission
Mission grades and own activity records.
No detailed formula breakdown.

### Session
Full status history and deduction reason.

### Observation
Count + category distribution.
Private notes hidden unless explicitly published.

### Arcade
Detailed rank/bonus/cap.

---

# 14. Teacher Guild 2 UI

Teacher needs a month-scoped Guild 2 operations view.

Minimum:

## 14.1 Monthly score overview

For each guild:

- draft current GS
- individual subtotal
- mission GS subtotal
- compensation amount
- total
- draft rank
- compensation enabled badge

For each student:

- peer /300
- mission /300
- session /150
- teacher /150
- basic /900
- arcade raw
- arcade applied /90
- final /990
- component readiness/status

Unavailable future components must say e.g.:

- `미션 기능 연결 전`
- `동료평가 연결 전`

Do not fabricate zero as if it were a completed evaluation.
Store/show readiness separately from numeric 0.

## 14.2 Teacher observation logging

Fast workflow:

- select student
- category
- short reason
- public/private
- save

Recent logs visible and reversible/correctable with audit history.

## 14.3 Compensation setting

Teacher can explicitly toggle compensation for a guild/season.

Show formula:

`평균 기본기여도 × 0.5 → 10점 단위 반올림`

Do not infer from current headcount.

---

# 15. Data / ledger design requirements

Before writing migration, inspect existing production definitions for:

- `guild_gs`
- `guild_individual_contributions`
- `guild_activity_logs`
- `guild_missions`
- `guild_mission_logs`
- `guild_peer_reviews`
- `guild_seasons`
- `guilds`
- relevant old functions
- existing enums
- RLS / GRANT

Reuse compatible legacy tables where safe.
Do not assume they match old docs exactly.

## 15.1 GS ledger

Accepted principle:

**GS changes must be auditable and append-only.**

If no compatible ledger exists, introduce an append-only GS event ledger.

Conceptual fields:

- id
- classroom_id
- season_id
- year_month
- guild_id
- source_type
- source_id
- student_id nullable
- points signed
- reason/metadata
- idempotency key
- reversal_of / correction relation
- created_by
- created_at

Do not UPDATE/DELETE a posted ledger event to “correct” it.

Correction:

- append compensating/reversal event
- append corrected event

`guild_gs` can remain a monthly summary/cache/snapshot derived from official events.

## 15.2 Individual contribution aggregate

`guild_individual_contributions` may be reused/expanded if compatible.

Monthly aggregate needs to represent at least:

- student
- year_month
- season
- guild/scoring context
- peer_points
- mission_points
- session_points
- teacher_observation_points
- basic_total
- arcade_raw_total
- arcade_applied
- final_total
- calculated_at
- readiness/status for each source
- calculation/version metadata

Raw source evidence should live in source tables/ledgers, not be lost when aggregate recalculates.

## 15.3 Formula version

Persist a formula/version identifier.

Example concept:

`GUILD_CONTRIBUTION_V2_2026`

Do not silently recalculate historical months with a future formula.

---

# 16. Month lifecycle boundary

Guild 2 calculates **draft/current** monthly scores.

Guild 5 later owns:

- monthly close preview
- finalize
- final rank
- reopen
- correction after finalization
- conquest result integration

Therefore Guild 2 must not create an irreversible final-close UX that competes with Guild 5.

However its schema must be ready for a finalized snapshot later.

---

# 17. Membership/move boundary

Guild 1 preserves membership history.

Guild 2 must not flatten history into “current guild only” data.

Final monthly roster snapshot semantics for mid-month moves/transfer will be finalized with monthly-close logic.

Until Guild 5:

- current month calculations may be clearly marked provisional
- source events should preserve enough guild/student context to reconstruct the correct final allocation
- do not rewrite past source events when membership changes

Do not invent a destructive “move all month's contribution to current guild” rule.

---

# 18. Security

Score writes must be server-side.

Teacher-only operations:

- observation log create/correct
- compensation config
- manual recalculation
- any temporary administrative imports
- official GS adjustment

Student can read only intended contribution information.

Peer raw details require stricter privacy than normal guild data.

Internal calculation helpers:

- no PUBLIC/anon execute
- authenticated only if directly intended
- otherwise internal/service-role only

Every SECURITY DEFINER function:

- fixed search_path
- role check
- classroom check
- scope validation

---

# 19. Realtime / cache

After source changes:

- affected student contribution refresh
- affected guild draft GS refresh
- teacher overview refresh
- student own contribution refresh

Use query invalidation and/or Realtime without duplicate subscriptions.

A failed mutation must not leave UI pretending the score changed.

---

# 20. Compatibility work required before implementation

Known stale frontend artifacts:

## 20.1 `SYSTEM_CONSTANTS.GUILD_GS_WEIGHTS`

Current code contains old values such as:

- alpha/BV increase
- participation
- attendance

They are obsolete.

Do not use them for Guild 2.

Replace/remove only after checking imports.

## 20.2 `calculate_individual_contribution`

Legacy RPC/wrapper exists.

Before replacement:

- inspect actual PostgreSQL signature
- inspect defaults
- inspect dependencies
- inspect grants
- inspect callers

Avoid the previous “cannot remove parameter defaults” problem.

If introducing a new function name/version is safer, prefer explicit versioned migration over dangerous drop.

## 20.3 old mission evaluation model

Legacy `evaluate_guild_mission_log` schema contains qualitative/synergy/BV-style fields.

Do not assume this matches Season 2 mission contribution.

Guild 3 will supersede the behavioral model.

---

# 21. Suggested implementation split

## Guild 2A — Core

Implement now:

- preflight
- formula-version foundation
- individual monthly aggregate foundation
- GS append-only ledger foundation
- draft GS aggregation
- session component
- teacher observation log + UI
- manual compensation setting
- student/teacher score breakdown UI
- readiness states for missing components

## Guild 2B — Arcade adapter

Implement when Arcade can provide monthly snapshot data, or implement a safe import interface now:

- per game/month/student ranking result
- raw bonus
- cap 90
- integration into aggregate

Do not hard-code exactly 6 games.

## Later adapters

Guild 3:

- mission normalized 300
- activity record
- teacher grade
- official mission GS

Guild 4:

- peer 300 correction pipeline

Guild 5:

- close/final/reopen
- final roster snapshot
- rankings
- conquest

---

# 22. Required preflight for Codex

Before any Guild 2 migration, report the actual/current definitions of:

- all guild-related tables listed above
- columns + types + nullability
- constraints/indexes
- existing score-related enums
- `calculate_individual_contribution`
- `evaluate_guild_mission_log`
- any function writing `guild_gs`
- any function writing `guild_individual_contributions`
- grants
- RLS

If direct DB access is unavailable, create one SQL preflight file and STOP before guessing.

---

# 23. E2E checklist for Guild 2 core

At minimum:

## Calculation

- [ ] PRESENT does not reduce session points
- [ ] EXCUSED does not reduce session points
- [ ] ABSENT reduces 30
- [ ] session component floors at 0
- [ ] observation 1 log = +10
- [ ] 15 logs = 150
- [ ] >15 scoring logs remains 150
- [ ] arcade rank mapping correct
- [ ] arcade raw >90 caps at 90
- [ ] basic excludes arcade
- [ ] final includes arcade
- [ ] old BV increase does not affect new contribution

## 4-member compensation

- [ ] normal guild gets no compensation
- [ ] designated guild gets avg basic ×0.5
- [ ] arcade excluded from average
- [ ] result rounded nearest 10
- [ ] changing actual current member count does not auto-toggle setting
- [ ] disabling setting removes draft compensation

## Ledger

- [ ] score event has source/reason
- [ ] duplicate idempotency event blocked
- [ ] correction uses append/reversal, not destructive edit
- [ ] aggregate matches ledger

## UI

- [ ] student sees total + five components
- [ ] peer raw details not exposed
- [ ] observation private notes hidden
- [ ] public observation note visible
- [ ] session detail transparent
- [ ] arcade cap visible
- [ ] missing future component says “not ready”, not misleading completed zero
- [ ] teacher sees calculation details/audit

## Security

- [ ] student cannot create observation log
- [ ] student cannot toggle compensation
- [ ] student cannot write GS
- [ ] student cannot execute internal scoring helper
- [ ] teacher limited to own classroom
- [ ] anon cannot call scoring writes

## Regression

- [ ] Guild 1 membership move still works
- [ ] Guild 1 remove/reassign still works
- [ ] Guild session create/attendance still works
- [ ] past session snapshot unchanged after membership move
- [ ] guild activation/deactivation unchanged
- [ ] `npm run build` passes

Transfer E2E remains deferred until student-management workflow exists.

---

# 24. Definition of done for Guild 2

Guild 2 is COMPLETE only when:

- production-compatible incremental migration applied
- append-only GS audit model works
- session/teacher components work
- manual 4-member compensation works
- student/teacher breakdown UI works
- future mission/peer components have safe integration contracts
- no stale BV-based formula is used
- build passes
- Guild 1 regression passes
- E2E accepted by user

Do not mark Guild 2 complete merely because tables exist.
