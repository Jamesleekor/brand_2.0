# Guild5 Student FINAL UI Integration — Validation Results

Date: 2026-08-16
Base: v21 Guild5 test-score build
Target: v22 student Guild UI integration

## Scope

- Activate student `길드점수` route (`/guild/scores`).
- Render Guild2 DRAFT values before monthly close.
- Render Guild5 immutable FINAL snapshot after monthly close.
- Main Guild header prefers current-month Guild5 FINAL snapshot over Guild2 DRAFT.
- Main personal contribution card switches to current-month FINAL snapshot when available.
- Activate `점령` route (`/guild/conquest`) with temporary swappable world-map asset.
- Temporary map asset path is fixed at `public/assets/guild/conquest-world-map.webp`.
- No database migration / RPC change in this patch.

## Static validation

- TypeScript `transpileModule` syntax check: PASS
  - `src/App.tsx`
  - `src/features/guild/GuildPage.tsx`
  - `src/features/guild/GuildScorePage.tsx`
  - `src/features/guild/GuildConquestPage.tsx`
- Local import target existence check: PASS
- Placeholder WebP integrity: PASS, 1600x900
- ZIP integrity check: PASS

## Build gate

Full `npm run build` must be executed on the user's local working tree after applying v22. This environment does not currently contain the project node_modules tree.

## Expected student behavior

### Before Guild5 FINAL
- Main header: Guild2 Draft GS + `준비 중`.
- Guild score tab: `DRAFT`, current rank and component breakdown.

### After Guild5 FINAL
- Main header: Guild5 final GS + `최종 N위 · FINAL vN`.
- `길드 GS 확정`: `확정` + finalization date.
- Personal contribution card: Guild5 final contribution snapshot.
- Guild score tab: final Guild GS breakdown + final personal contribution + final ranking.
- Conquest tab: final top-3 territory results over the swappable map background.
