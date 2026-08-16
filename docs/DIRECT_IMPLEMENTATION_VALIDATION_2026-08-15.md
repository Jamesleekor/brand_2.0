# Direct implementation validation — 2026-08-15

## Source basis

- Latest user-supplied `brand_2.0` ZIP after Codex TEST classroom implementation.
- Production preflight exports supplied in the same conversation.
- Previously reviewed Guild 3 FINAL SQL files used as the exact source for reconcile definitions.

## SQL validation performed

### Guild 3 reconcile

The nine production-critical function definitions copied into `20260815_05_guild3_production_reconcile_and_read_api.sql` were byte-compared with the previously reviewed FINAL SQL and are identical:

- `teacher_create_guild3_mission`
- `teacher_update_guild3_mission_draft`
- `teacher_update_guild3_mission_presentation`
- `teacher_publish_guild3_mission`
- `teacher_cancel_guild3_mission`
- `teacher_set_guild3_instance_special_rule_note`
- `student_get_guild3_mission_board`
- `guild3_mission_month_is_ready`
- `guild2_refresh_monthly_gs_summary`

The incremental migration adds only purpose-specific read APIs needed by the frontend on top of those reviewed definitions.

### Real-classroom cleanup

Compared cleanup coverage against both production preflight inventories:

- all 47 Guild/Arcade/core operational relations are either reset or explicitly preserved as master/baseline;
- all 76 broader classroom-scoped relations are either reset or explicitly preserved as master/catalog/view data;
- the only broader inventory objects not reset are master/catalog/baseline objects and `v_ai_usage_summary` view.

FK delete ordering was checked against the 233 production FK dependency records. A real ordering defect was found and fixed: `arcade_monthly_snapshots` must be deleted before `arcade_monthly_finalizations` because snapshots reference finalizations. Auction `current_item_id/current_bid_id` cyclic pointers are explicitly nulled before destructive child cleanup.

A dynamic catalog guard checks every current FK referencing `transactions(id)` before deleting target transactions. Any unhandled remaining child reference aborts and rolls back the whole cleanup.

## Frontend validation performed

All new/modified TypeScript/TSX files pass TypeScript parser/transpile syntax validation and local `@/` import-path existence checks.

A full `npm run build` could not be completed in this sandbox because the uploaded ZIP intentionally excluded `node_modules` and the environment cannot reach `registry.npmjs.org` (`EAI_AGAIN`) to restore dependencies. The failure occurs at missing external type definitions before project source type-checking. Run `npm ci && npm run build` on the user's normal development machine before deployment.

## Not yet validated

- Production execution of the new reconcile migration.
- Destructive real-classroom cleanup execution (intentionally not executed here).
- Browser E2E with TEST TEACHER and TEST01~TEST05.

Therefore Guild 3 must remain IMPLEMENTED / E2E PENDING, not COMPLETE.
