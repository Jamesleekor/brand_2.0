# VALIDATION — Guild5 Conquest Interactive Map UI v23
Date: 2026-08-17

## Scope
- Final user-provided conquest map installed at `public/assets/guild/conquest-world-map.webp`.
- Removed the three large conquest cards from the world-map area.
- Added three interactive guild emblem markers.
- Each marker is offset upper-right from the stronghold and linked with a dotted leader line.
- Click/tap toggles a compact territory popover.
- Popover shows final rank, FINAL GS, territory tax rate, and conquest month.
- Added compact full-guild FINAL ranking below the map.
- Added territory tax-rate configuration to Guild5 teacher territory config.
- Added immutable conquest slot/tax/description snapshots.
- Added guild logo snapshot for historical FINAL map markers.
- Existing Guild5 history RPC extended with marker/popover metadata.

## Static validation
- TypeScript `transpileModule` syntax check: PASS for 4 changed TS/TSX files.
- Final map asset: 1672×941 WEBP, 723,044 bytes.
- SQL transaction wrapper: BEGIN=1, COMMIT=1.
- Destructive `DROP TABLE ... CASCADE`: NONE.
- Incremental migration only; existing Guild5 base APPLY must not be rerun.

## Build gate
Full `npm run build` was NOT claimed in this environment because dependency installation did not complete.
Run the normal local build gate after applying the patch.

## Important behavior note
`tax_rate_percent` is currently Guild5 conquest metadata/snapshot for UI/history.
This patch does not create automatic economy tax collection or deductions.
