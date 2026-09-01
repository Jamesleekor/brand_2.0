# Guild3 Finalization Recovery + Guild4 Sync Discoverability — Validation

Date: 2026-08-16
Baseline: Guild4-B frontend v17
Status: IMPLEMENTED / DB NOT APPLIED / FULL LOCAL BUILD STILL REQUIRED

## Change scope

- Add `teacher_unfinalize_guild3_mission(bigint,text)`.
  - FINALIZED -> CLOSED only when no Guild4 round has been materialized for the mission.
  - Preserves submissions, activity revisions, judgment events, grade events, audit history.
  - Removes only unmaterialized derived Guild4 openings so a later FINALIZE creates clean openings.
- Add `teacher_restore_voided_guild3_mission(bigint,text)`.
  - VOIDED -> FINALIZED only when no Guild4 round exists.
  - Restores VOIDED openings to OPENABLE.
- Preserve CANCELLED as terminal.
- Preserve post-Guild4 correction model: once a Guild4 round exists, finalization undo/VOID restore is blocked and append-only correction must be used.
- Add direct `Guild3 -> G4 sync` button and G4 management shortcut to Guild3 teacher admin.
- Rename destructive VOID UI to `미션 무효화 (VOID)` and add stronger warning.
- Add `최종 확정 취소` and `VOID 취소` UI controls.

## Static validation

- Changed TSX (`GuildMissionAdmin.tsx`) syntax transpile: PASS.
- Changed TS (`guild3_rpc.ts`) syntax transpile: PASS.
- Migration/apply `$$` delimiter balance: PASS.
- No `DROP ... CASCADE`: PASS.
- Full npm build: NOT RUN in artifact environment; run `npm ci && npm run build` locally after applying source.

## Required production sequence

1. `PREFLIGHT_GUILD3_FINALIZATION_UNDO_RESTORE.sql`
2. Review result. Especially `voided_without_g4_round_restorable` and `voided_mission_candidates`.
3. `APPLY_GUILD3_FINALIZATION_UNDO_RESTORE.sql`
4. `POSTCHECK_GUILD3_FINALIZATION_UNDO_RESTORE.sql`
5. Apply frontend v18 source, then local `npm run build`.

Do not rerun older Guild4 APPLY migrations as part of this patch.
