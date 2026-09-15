# B.R.A.N.D 2.0 — Raid UI / Result / Impact V2
Last update: 2026-09-15

## Production DB
Already applied:
- `20260915052828 raid_v1_result_ranking_detail`
- `20260915052932 raid_v1_battle_feedback_context`

Do NOT manually run those SQL files again on Production.

## Requested changes implemented

### Raid Portal
When Raid status is `LOBBY_OPEN`:
- Boss image/video is hidden.
- Boss description is hidden.
- Only boss name, element, and total HP are exposed.
- Right-side media pane becomes a sealed Raid Gate information panel.
- Boss visual is revealed only after battle starts.

### Raid Lobby
- Equipped Shard avatar size increased by about 20%.
- Guild cluster spacing increased to reduce overlap.
- Chat-lock text changed to:
  `현재는 채팅을 할 수 없습니다`
- Student-facing world text uses `운영국`, not `선생님`.

### World terminology rule
For B.R.A.N.D in-world/student-facing copy:
- do not use `선생님`
- do not use `TEACHER`
- use `운영국`

The patch also records this rule in repository `AGENTS.md` when present.

### Raid Result — Ranking
Ranking now provides:
- 순위
- 길드
- 이름
- 피해량
- 치명타율
- 기여도
- 보유 편린
- 공명력
- 보상

`치명타율` is the final Crit probability snapshotted at Raid start.
`기여도` is:
`student total damage / all participant total damage × 100`

Visual changes:
- modal widened
- header font increased from ~11px to 14px
- ranking values increased to ~15–16px
- rank number enlarged
- name/damage gap tightened with fixed table column widths

Personal Battle Record additionally shows total Raid damage contribution %.

### Combat feedback
No sound or boss-reaction animation is required.

Added:
- localized hit-ring effect at touch point
- Crit damage number ≈ 2× normal visual size
- Crit label `치명타!`
- high-damage feedback:
  - `강력한 일격!`
  - `압도적 일격!`

The high-damage threshold is adaptive:
- server now returns `damage_coefficient` and `crit_multiplier`
- expected normal hit = `snapshot resonance × damage coefficient`
- strong-hit labels compare actual damage against the configured expected Crit reference

This means the feedback still scales correctly if the same Boss is re-released with different combat coefficients.

## Player-facing wording updated
- Pause: `운영국에서 전투를 재개할 때까지...`
- Attack block: `운영국에 확인해주세요.`
- Lobby start: `운영국에서 레이드를 시작하면...`
- Chat locked: `현재는 채팅을 할 수 없습니다`

## Files replaced
- `src/features/raid/RaidPortalPage.tsx`
- `src/features/raid/RaidLobbyPage.tsx`
- `src/features/raid/RaidBattlePage.tsx`
- `src/features/raid/RaidResultModal.tsx`
- `src/lib/rpc/raid_student_rpc.ts`

## Safety
- backup directory: `_patch_backup/raid_ui_impact_result_v2_<timestamp>`
- no SQL execution from local patch
- no npm install/build
- no Git commit/push
