# Economy Guard EG1.1 — Production applied history

Status: **ALREADY APPLIED TO PRODUCTION on 2026-09-03**.

These files are historical/audit copies only. They intentionally use the `.sql.applied` suffix and live outside `supabase/migrations/` so normal migration tooling does not treat them as pending migrations.

## Never rerun blindly

- `01_APPLIED_EG1_1_BASE.sql.applied`
- `02_APPLIED_EG1_1_HOTFIX1.sql.applied`

The base script contains fail-closed Production contract hashes and is a one-time incremental migration. HOTFIX1 replaces only the canonical event projection to correct PostgreSQL NULL boolean semantics for open alerts.

## Verified Production state

After HOTFIX1, the following checks passed:

- structural POSTCHECK: PASS
- actionable events = open alerts
- non-official/Test Agent event leaks = 0
- duplicate canonical event keys = 0
- invalid fingerprints = 0
- inequality population equals official participant population
- Runtime/Auth READ E2E: 12/12 PASS
- Review Write E2E: 14/14 PASS, fully rolled back

## Important historical gap

The older EG1 base SQL (`APPLY_ECONOMY_GUARD_EG1_20260902.sql` and its FIX/HOTFIX series) was applied manually before this source snapshot and is not reconstructed here. Do not pretend this directory is a fresh-install migration chain. Before creating a new environment from zero, perform a dedicated Production-to-source reconciliation for the complete Guard backend.
