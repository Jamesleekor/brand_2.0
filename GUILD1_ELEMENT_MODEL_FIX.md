# Guild 1.1 — Element Model Correction

## Correct rule
- A guild itself has no element.
- Each student membership has an assigned element in `guild_members.element`.
- Supported: EARTH/WATER/FIRE/WIND/LIGHT/DARK (땅/물/불/바람/빛/어둠).
- Membership history and guild-session snapshots preserve the student's element at that time.

## Correction from Guild 1.0
The first Guild 1 build incorrectly promoted member elements into `guilds.element_code`. This patch removes that field and returns `guild_members.element` to the source of truth.

## Guild create hardening
- `teacher_create_guild` no longer accepts an element.
- Existing `season_id` / `guild_uid` legacy columns are still populated.
- If the Guild 1 lifecycle flag has no active season, creation may safely reuse the one season_id unanimously used by existing active guilds in the classroom.
- The create modal calls the RPC directly and shows persistent inline errors; it no longer depends on a shared mutation loading state.

## Apply to an already-installed Guild 1 DB
Run exactly once:
`supabase/APPLY_GUILD1_ELEMENT_MODEL_FIX.sql`

Then optionally run:
`supabase/migrations/20260811_03_guild1_element_model_fix_postcheck.sql`

Do NOT rerun the older Guild 1 foundation SQL just for this correction.
