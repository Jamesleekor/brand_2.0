# VALIDATION — Arcade teacher immediate period end

Date: 2026-08-16
Scope: Guild5 E2E blocker only

## Implemented

- New teacher-only RPC `teacher_end_arcade_ranking_period_now(bigint)`.
- Uses PostgreSQL server clock; ACTIVE only; FINALIZED remains immutable.
- Idempotent if the period has already ended.
- `/teacher/arcade` shows `⏹ 랭킹 기간 즉시 종료` only for ACTIVE, not-yet-ended periods.
- Immediate end and monthly FINALIZE remain separate actions.
- Added Zod/RPC wrapper and Korean error mapping.

## Validation

- Changed TS/TSX syntax: PASS via TypeScript `transpileModule`.
- SQL static structure / BEGIN-COMMIT / destructive-operation scan: PASS.
- `npm run build`: NOT VERIFIED in artifact environment because the pre-existing mounted `node_modules` is incomplete and lacks type definition contents (`react`, `node`, `babel__*`, etc.). No dependency files were changed.
- Production DB: NOT APPLIED. Run PRE-FLIGHT -> APPLY -> POSTCHECK first.

## E2E

1. Open a DRAFT period.
2. While ACTIVE and before scheduled end, click immediate end.
3. Confirm the displayed end time moves to now and the immediate-end button disappears.
4. For MONTHLY period, confirm `월간 순위 확정 + Guild 2 반영` becomes enabled.
5. Finalize and confirm Guild5 Arcade readiness becomes READY.
