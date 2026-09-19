# Guild 1.2 Stability Patch

## Why this patch exists

E2E testing on 2026-08-12 confirmed that Guild 1.1 can render guilds, create sessions, record attendance, and show the student guild header/history. It also exposed four issues:

1. MOVE / reassignment could appear unresponsive.
2. Error toasts were rendered behind the shared modal (`toast z=60`, modal `z=1000`), so server errors looked like a dead button.
3. Legacy unique constraints on `guild_members` may block multiple historical membership rows in the same season.
4. `EXCUSED` session attendance was not counted as attendance credit in the student summary.
5. Guild deactivation existed only as an edit-checkbox and was not discoverable.
6. Student guild score cards were too small.

## Changes

### Membership move / assignment
- Replaced the nested two-Modal confirmation flow with a single Modal that changes steps internally.
- Final action shows `적용 중...` while the RPC is running.
- Server/validation errors are displayed inline in the same modal.
- Toast layer is raised above modals (`z-[1200]`).

### Membership history DB compatibility
- `APPLY_GUILD1_2_MEMBERSHIP_HISTORY_COMPAT.sql` drops only known legacy UNIQUE constraints/indexes that are incompatible with multiple historical membership rows:
  - `(student_id, season_id)`
  - `(guild_id, student_id)`
  - `(guild_id, student_id, season_id)`
- No CASCADE is used.
- The Guild 1 partial unique rule remains: only one `left_at IS NULL` row per student.

### Session attendance
- `EXCUSED` remains a distinct stored status and badge.
- For student summary / future contribution credit, `PRESENT` and `EXCUSED` both count as attendance credit.

### Guild activation state
- Guild cards now show an explicit `비활성화` / `활성화` action.
- Deactivation is blocked in the confirmation modal while active members remain.
- Historical records are not deleted by deactivation.

### Student header readability
- Score labels, values, and subtext were enlarged.

## Deferred

Student enrollment/transfer account administration is not implemented by this Guild 1.2 patch. The transfer snapshot E2E case can be tested later when the student-management workflow is available.
