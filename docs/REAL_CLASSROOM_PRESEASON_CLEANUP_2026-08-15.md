# Real classroom pre-season cleanup — execution notes

Target is hard-coded inside the SQL:

- `classroom_id = 1`
- `school_year = 2026`
- `name = '5학년 4반'`

The SQL is intentionally manual-only: `supabase/APPLY_REAL_CLASSROOM_PRESEASON_CLEANUP.sql`.

## Preserved

- real classroom
- all student rows and Supabase Auth links
- Guild Season baseline
- exactly five Guild definitions
- classroom/base configuration
- master/catalog/definition tables such as achievements, assignments, quest definitions, item/product catalogs, school terms, etc.
- Arcade game/rule master definitions

## Cleared/reset

- temporary Guild membership/element assignments and membership audit history
- Guild sessions and Guild 2 operational scoring history
- Guild 3 operational mission evidence
- real-classroom Arcade test runs/access/period snapshots
- student operational histories (attendance/submissions/achievement acquisition/quest completion/mail/feed/ranking/etc.)
- auction/economic/student ownership/activity history
- real-classroom transactions
- wallet balances to zero baseline
- welfare-fund operational totals to zero baseline

The SQL walks the actual transaction FK catalog before transaction deletion. If any target transaction is still referenced by a table not cleaned above, it raises an exception and the whole transaction rolls back.

## Important

Run this only after TEST classroom login/isolation is verified and after deciding that the real classroom will no longer be used for development testing. Season 1 data migration can then target this clean baseline around 2026-08-23.
