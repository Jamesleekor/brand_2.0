# Guild3 final UI/order pass — validation results

Date: 2026-08-16
Baseline: brand_2.0_chatgpt_20260816_guild3_fix_v12
Scope: newest-first mission ordering + terminal mission status overlay

## Behavior confirmed before change
- Mission weight defaults to 1 in the DRAFT mission editor.
- Weight is part of the locked mission scoring configuration and is editable only before publish.
- Same-month non-CANCELLED/non-VOIDED missions participate in the monthly weight denominator, including DRAFT missions.

## Changes
1. Student mission board ordering
   - `student_get_guild3_mission_board()` now orders by `coalesce(published_at, created_at) DESC, id DESC`.
   - A mission published later appears above older completed missions even if its due date is later/earlier.
2. Teacher mission list ordering
   - `teacher_list_guild3_missions()` uses the same newest-visible ordering instead of due-date ordering.
3. Student terminal-state visuals
   - FINALIZED: yellow ~50% overlay with large `종료` label centered over the card.
   - CANCELLED: compact card retained to save space, with yellow ~50% overlay and large `취소` label.
   - VOIDED: yellow ~50% overlay with large `무효` label.
4. Mission-list modal follows the same server ordering as the main mission board.

## SQL deployment
Run in this order:
1. `PREFLIGHT_GUILD3_NEWEST_FIRST_READ_ORDER.sql`
2. `APPLY_GUILD3_NEWEST_FIRST_READ_ORDER.sql`
3. `POSTCHECK_GUILD3_NEWEST_FIRST_READ_ORDER.sql`

Incremental migration:
- `supabase/migrations/20260816_02_guild3_newest_first_read_order.sql`

## Validation
- `GuildMissionsPage.tsx` TypeScript/JSX syntax transpile: PASS
- Ordering migration static checks: PASS
- Existing applied migrations were not edited.
- Full npm build: NOT VERIFIED in this environment because dependencies are not installed in the preserved source package.
