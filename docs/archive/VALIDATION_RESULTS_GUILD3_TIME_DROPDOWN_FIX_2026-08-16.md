# Guild3 time dropdown fix — validation results

Date: 2026-08-16
Baseline: brand_2.0_chatgpt_20260815_v9
Scope: Guild3 Mission editor time input fix and create/save guard review

## Changed file
- src/features/guild/GuildMissionAdmin.tsx

## What changed
1. Replaced `input type="time"` controls for:
   - 결과 제출 마감
   - 활동 기록 마감
   with explicit hour/minute dropdowns.
2. Allowed hour selection from 0~23 and minute selection from 0~59.
3. Preserved existing behavior where activity-record deadline may be left fully blank, in which case the backend auto-applies `mission due_at + 24 hours`.
4. Tightened partial-input validation:
   - result due date/time must be complete
   - activity-record deadline must be either fully blank or fully complete
5. Re-checked save path so the save button always:
   - blocks duplicate clicks during mutation
   - shows inline validation message for missing fields
   - shows inline/server error text on failure
   - shows success toast on completion

## Validation performed
- TypeScript syntax/transpile check for `src/features/guild/GuildMissionAdmin.tsx`: PASS
  - verified with `typescript.transpileModule`
- `npm run build`: NOT VERIFIED IN THIS ENVIRONMENT
  - blocked because the bundled `node_modules` inside the provided ZIP is incomplete/truncated, causing TypeScript library resolution failures unrelated to this specific code change.

## Recommended user verification
1. Open Teacher > Guild 3 > 미션 만들기
2. Confirm date + hour + minute dropdowns are clickable
3. Create mission with:
   - 결과 제출 마감: required
   - 활동 기록 마감: blank
4. Create mission with:
   - 결과 제출 마감: required
   - 활동 기록 마감: fully filled
5. Confirm save succeeds and no silent no-response occurs
