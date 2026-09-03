# B.R.A.N.D 2.0 — Economy Guard EG1.1 implementation state

Date: 2026-09-03
Status: Backend verified / frontend integrated / local user build pending

## Production backend

EG1.1 is an audit layer over authoritative economy sources. It does not move GOLD/BV and does not rewrite P2P or service-order history.

Canonical sources:

- `P2P_TRANSFER`
- `SERVICE_ORDER`

One service order is one Guard event. Escrow and payout transactions are ledger mechanics and are not counted as separate student trades.

Official monitoring excludes Live Test Agent and all non-official participants through `public.is_official_participant(student_id)`.

### Production verification completed

- focused read-only preflight: PASS
- EG1.1 rollback rehearsal: PASS
- EG1.1 apply: APPLIED
- HOTFIX1 rollback rehearsal: PASS
- HOTFIX1 apply: APPLIED
- postcheck V2: PASS
- runtime/auth read E2E: 12/12 PASS
- review-write E2E: 14/14 PASS (ROLLBACK)

### Review lifecycle

- `NORMAL_CONFIRMED`
- `FINAL_FLAGGED`

Normal decisions store an anomaly fingerprint. If a mutable service order changes and its anomaly basis changes, the old normal decision remains audit history but the event becomes `review_is_stale=true` and reopens for review.

Final flagging records an audit penalty and notification only. It does not automatically reverse the transaction, recover GOLD, or reduce BV.

## Frontend integration

Routes:

- Guard/student: `/guard`
- Teacher oversight: `/teacher/economy-guard`

Tabs:

1. 거래 스트리밍
2. 카테고리 통계
3. 거래 네트워크
4. 이상거래 알림센터
5. 불평등 지수

Refresh policy:

- dashboard polling: 30 seconds
- access refresh: 60 seconds
- refetch on window focus
- manual refresh button
- inequality snapshot: best-effort on first authorized entry and manual refresh; DB enforces one snapshot per class/day

Access is always determined by `economy_guard_get_access()` / server RPC checks. Frontend visibility is UX only.

## Files added

- `src/features/guard/EconomyGuardPage.tsx`
- `src/lib/rpc/economy_guard_rpc.ts`
- `src/lib/zod_schemas/economy_guard_schemas.ts`

## Existing files changed

- `src/App.tsx`
- `src/components/layout/Navigation.tsx`
- `src/components/teacher/TeacherShell.tsx`
- `src/features/teacher/TeacherDashboard.tsx`
- `src/features/feature4/OperationsAdmin.tsx`
- `src/lib/rpc/error_handler.ts`

`OperationsAdmin` hides `is_test_account=true` students from Guard appointment candidates. This is only an UX defense; Production also rejects such appointments server-side and `guard_terms` has a defense-in-depth trigger.

## Applied SQL history

Already-applied SQL is deliberately kept outside `supabase/migrations/`:

- `supabase/applied_history/economy_guard_eg1_1_20260903/01_APPLIED_EG1_1_BASE.sql.applied`
- `supabase/applied_history/economy_guard_eg1_1_20260903/02_APPLIED_EG1_1_HOTFIX1.sql.applied`

Do not rerun either file against Production.

## Local validation rule

ChatGPT/Codex does **not** run `npm ci`, `npm install`, or `npm run build` for this project. The user runs the build locally and returns any TypeScript/Vite errors for correction.

Current remote/static check performed: TypeScript `transpileModule` syntax pass for every changed TS/TSX file. A full type-aware build remains pending because dependencies are intentionally not installed in the working environment.

## Remaining before feature completion

1. User runs `npm run build` locally.
2. Fix any reported TypeScript/Vite errors.
3. Browser smoke test with teacher, ordinary student, active Guard, and Live Test Agent.
4. AI Edge Function remains a later phase; current deterministic briefing is the fallback/source of truth.
5. Credit Bridge remains deferred until the actual Production credit formula is audited read-only.
