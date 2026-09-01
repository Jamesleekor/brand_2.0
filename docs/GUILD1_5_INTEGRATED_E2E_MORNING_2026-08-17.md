# Guild1~5 Integrated Morning E2E
## v23 nightly-stabilized candidate · 2026-08-17

This checklist is intentionally split into a short smoke path and an optional destructive/full fixture path.
Production classroom data must not be reset for this test.

---

## A. Local gate first

PowerShell:

```powershell
cd C:\brand_2.0
npm ci
npm run build
npm run dev
```

Pass:
- build succeeds;
- no TypeScript compile error;
- no blank route;
- browser console/network has no new Guild 4xx/5xx on initial load.

If `tsconfig.tsbuildinfo` changes only because of build, restore it before a checkpoint if it is not intentionally tracked as source.

---

# B. Five-minute non-destructive smoke on current TEST state

Use the existing TEST classroom. Do **not** press reset unless you intentionally want to rebuild the fixture.

## B1. Student Guild header / FINAL state

Login TEST01.

Open `/guild`.

Expected:
- current guild card loads;
- current member count is correct;
- if the current month already has Guild5 FINAL, `길드점수` subtitle = `FINAL`;
- `월간결산` subtitle = `FINAL` only when current-month Guild5 FINAL exists;
- if current month is reopened/no FINAL, `월간결산` = `마감 전`.

## B2. Conquest popup clipping regression

Open `/guild/conquest`.

Desktop:
- click all three territory markers;
- especially territory #3 (right/lower coastal stronghold);
- the detail panel must show all fields through the bottom edge;
- panel must not be clipped by the world map card;
- close button works;
- marker location/dotted line remains unchanged.

Narrow/mobile viewport:
- click marker;
- detail panel appears below the map in normal flow;
- no clipping even when the panel is taller than the map.

## B3. Guild Score

Open `/guild/scores`.

Expected when FINAL exists:
- FINAL snapshot values are shown;
- final rank matches conquest/monthly page;
- individual contribution components match the finalized monthly snapshot.

Teacher `/teacher/guild/scores`:
- copy must describe Guild2 as DRAFT calculator;
- it must no longer claim Mission/Peer/Arcade are unconnected.

## B4. Monthly result

Open `/guild/monthly`.

Expected:
- FINAL version number displayed;
- final guild GS/rank equals conquest page;
- conquest result matches chosen territory;
- past version/month remains snapshot-based.

---

# C. Integrated Guild1 → Guild5 regression

Run this only when you want a full functional pass.

## C1. Guild1 membership

Teacher `/teacher/guild`:
- 5 TEST fixture students remain in the primary TEST GUILD;
- no student has two active memberships;
- element is visible for all five;
- membership history remains intact.

Create/use one Guild Session:
- participant list is the session-time snapshot;
- PRESENT/ABSENT/EXCUSED save;
- student view reflects attendance;
- later membership changes must not rewrite old session participants.

PASS □

## C2. Guild2 draft calculation

Teacher `/teacher/guild/scores`:
- recalculate current month;
- no unresolved roster context for the five TEST students;
- Session max 150;
- Observation max 150;
- Mission max 300;
- Peer max 300;
- Arcade applied max +90;
- final contribution max 990;
- Guild GS draft = individual subtotal + Mission GS + compensation + adjustment.

Verify at least one student row and the guild subtotal manually.

PASS □

## C3. Guild3 Mission source

Use a disposable TEST mission if a fresh run is desired.

Flow:
1. DRAFT
2. publish → ACTIVE
3. guild submission/revision
4. activity record
5. close
6. CLEARED/FAILED per guild
7. S/A/B/C/F grade
8. FINALIZE

Expected:
- DRAFT reveals teaser only;
- published detail is visible;
- submission revisions preserved;
- activity text constraint enforced;
- FINAL contributes Mission /300 and official Mission GS according to normalized weight;
- Guild2 draft refreshes.

PASS □

## C4. Guild4 Peer Review

Teacher sync Guild3 → Guild4.

For a five-person source round:
- 5 participants;
- 20 reviewer→target obligations;
- self-review absent.

Student:
- score 1–10;
- comment ≥20 chars;
- OPEN revision works;
- CLOSED blocks student edit;
- raw incoming reviewer identity/comment is not visible.

Teacher:
- raw review visible;
- EXCUSED works;
- FINALIZED correction is append-only;
- missing any required obligation produces one 2,000 GOLD penalty per reviewer/round;
- insufficient balance → PENDING_FUNDS;
- retry and waive work;
- EXCUSED after a posted penalty reverses it when the last missing obligation disappears.

PASS □

Known follow-up, do not fail the release solely for this:
- G4 already FINALIZED → source G3 mission VOID may remove Mission GS while finalized Peer contribution remains.

## C5. Guild4 → Guild2 adapter

After valid Peer rounds FINALIZED:
- Peer status READY;
- monthly Peer /300 uses Guild3 Mission weights;
- actual zero and NOT_READY are not conflated;
- Mission/Session/Observation/Arcade components do not regress.

PASS □

## C6. Guild5 readiness / FINAL

Teacher `/teacher/guild/monthly-close`.

Before FINAL:
- Session readiness
- Observation readiness
- Mission readiness
- Peer readiness
- Arcade readiness
- official Mission GS
- compensation config
- exactly 3 territory definitions

One required source NOT_READY → FINALIZE blocked.
Mission/Peer emergency override only:
- reason required;
- snapshot state = OVERRIDDEN, not an invented zero.

PASS □

## C7. Guild5 snapshot / ranking

FINALIZE.

Expected:
- closure FINALIZED;
- new version created;
- student snapshots created;
- guild snapshots created;
- ranking stable;
- rank tie-break uses close-time roster BV then official Mission GS then deterministic tie seed;
- current Guild2 values changing later does not rewrite this version.

PASS □

## C8. Conquest

Expected:
- exactly 3 turns;
- rank1 ACTIVE first;
- rank2/rank3 WAITING;
- choose one territory → next rank activates;
- after rank3 assignment all three are assigned;
- rank4/5 have no territory;
- student world map shows matching markers/rank/FINAL GS/tax metadata.

Test auto assignment only in TEST fixture using the dedicated 48-hour expiry test action.

PASS □

## C9. Freeze / reopen

While month FINAL:
- Guild3 correction path blocked;
- Guild4 correction path blocked.

Teacher REOPEN with reason:
- previous FINAL version remains;
- Guild3/Guild4 corrections become possible again;
- re-FINALIZE creates next version rather than overwriting old version.

If ranking changes after reopen:
- no territory chosen yet → new sequence may be generated;
- any territory already chosen → automatic overwrite prohibited, `RECONQUEST_REQUIRED` flow used.

PASS □

---

# D. Security smoke

Student TEST account:
- cannot invoke teacher Guild RPCs;
- cannot read other students' private Guild4 raw reviews;
- cannot access another classroom's Guild data;
- cannot directly write Guild score/snapshot tables.

Teacher:
- intended teacher RPCs work only inside teacher classroom scope.

PASS □

---

# E. Final consistency matrix

For the same finalized month confirm all four surfaces agree:

| Surface | Value |
|---|---|
| `/guild` header | FINAL GS / final rank |
| `/guild/scores` | FINAL GS / final rank / components |
| `/guild/monthly` | same FINAL version snapshot |
| `/guild/conquest` | same rank + territory |

Any disagreement is a blocker before checkpoint.

---

# F. After PASS

PowerShell:

```powershell
git status
git diff --stat
npm run build
git add -A
git commit -m "checkpoint: complete Guild1-5 integrated system"
git push
```

Only checkpoint after the build and integrated smoke pass.
