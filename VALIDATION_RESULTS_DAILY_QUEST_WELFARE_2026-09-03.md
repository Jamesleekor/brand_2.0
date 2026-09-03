# Daily Quest Manager + Welfare Manual Spend — 2026-09-03

## Scope

1. Daily Quest Manager infinite-loading fix
2. Live Test Agent exclusion from Primary Job readiness / Daily Quest official roster
3. Teacher welfare-fund arbitrary deduction with mandatory reason and recent-use history

## Important npm rule

Per user instruction, AI/Codex/ChatGPT must **not** run `npm ci` or `npm run build` for B.R.A.N.D 2.0. The user runs `npm run build` locally and shares the result. This rule must remain in future handovers.

## Static validation performed

- TypeScript `transpileModule` parse check: 157 TS/TSX source files, 0 syntax diagnostics.
- No `npm ci` executed.
- No `npm run build` executed.
- New SQL contains no `DELETE FROM` and does not mutate source transaction rows.
- New welfare spend uses existing `welfare_fund_movements` as an append-only outflow ledger (`DISTRIBUTE`, positive amount, reason in note).
- SQL dollar-quote/function termination counts checked.

## Production application

Run `supabase/APPLY_DAILY_QUEST_WELFARE_MANUAL_SPEND_2026-09-03.sql` in Supabase SQL Editor.
The apply file explicitly runs `SET ROLE postgres` because this project's SQL Editor session was observed with `session_user=postgres` and `current_role=authenticated`.

The migration preserves the current Production definition of legacy functions that are not stored in this repo and injects only `public.is_official_participant(...)` into their active-student predicates. It aborts the whole transaction if the expected predicate cannot be found.

## Expected postcheck

- all five Daily Quest / Primary Job guards = true
- welfare get_board = true
- welfare spend = true
- official participants in classroom 1 = 24
- live test agents in classroom 1 = 1
- nonofficial unchecked open daily-quest rows = 0

## Local verification after SQL

User runs:

```bash
npm run build
```

Then UI checks:

- appointed Daily Quest Manager opens the manager page without infinite loading
- Primary Job admin board treats the class as 24 official students, not 25
- Welfare panel shows official student count 24
- teacher can deduct a valid amount with a 2–200 character reason
- balance decreases exactly once
- recent welfare use shows amount, reason, timestamp
- amount above balance is rejected


## 2026-09-03 V2 syntax correction
- Fixed the dynamic `DO $patch$` terminator from `END` to `END;`.
- Rechecked all dollar-quoted PL/pgSQL blocks in both apply SQL and migration SQL.
- `npm ci` / `npm run build` were not executed; user runs build locally.
