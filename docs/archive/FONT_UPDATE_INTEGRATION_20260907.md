# B.R.A.N.D. 2.0 Font Update Integration — 2026-09-07

## Baseline

This integration was regenerated against the uploaded latest source:

- `brand_2.0-main (1)(2).zip`

The previous font patch must not be applied over this baseline. This tree already contains the font changes re-integrated on top of the latest source.

## Merge safety result

Three-way comparison used:

1. the earlier arcade-auth final source,
2. the earlier font patch,
3. the latest uploaded source.

All 8 existing files touched by the font patch were byte-identical between (1) and (3), so applying the font changes cannot roll back later work in those files.

Existing files intentionally changed: 8

- `src/App.tsx`
- `src/components/layout/AppShell.tsx`
- `src/features/cosmetic/CosmeticPage.tsx`
- `src/features/dashboard/HomeCustomizationPanel.tsx`
- `src/features/market/MarketPage.tsx`
- `src/lib/rpc/student_rpc.ts`
- `src/lib/zod_schemas/student_schemas.ts`
- `src/styles/globals.css`

New functional font/tool/SQL files: 20. Integration/QA documents: 2. Total added files: 22.
No latest-source file was deleted.

## Product policy

- 27 font families
- fixed price: **300 CRYSTAL** each
- market card preview: tiny lazy-loaded preview WOFF2
- detail modal: free-text preview using the selected family full WOFF2
- owned font selection: Home customization panel
- default font restore supported
- selected theme font is dynamically loaded; all 27 families are not downloaded at app startup
- readability-critical/system UI retains the system font

## DB / RPC state

Production DB already contains the four font migrations. Matching local migration files were added using the exact live migration version numbers:

- `20260906155239_font_cosmetics_phase_a_20260907.sql`
- `20260906162113_activate_font_cosmetics_300_crystal_20260907.sql`
- `20260906162617_harden_cosmetic_rpc_execute_20260907.sql`
- `20260906163105_stage_font_cosmetics_until_frontend_deploy_20260907.sql`

Current intended production state before frontend deployment:

- 27 font catalog rows exist
- price rows are configured as 300 CRYSTAL
- font items remain inactive / hidden
- legacy client-callable `purchase_cosmetic_item(student_id, ...)` and `equip_cosmetic_item(student_id, ...)` execution is blocked for anon/authenticated
- authenticated students use self-scoped RPCs
- font ownership lookup uses `student_get_my_fonts()` and does not send a student id from the browser

Do not manually rerun the four migration files against the current production DB. They are included so source migration history matches the already-applied live history.

## Local asset build

Keep `FONTS.zip` outside Git or at repository root temporarily, then run:

```cmd
py -m pip install fonttools brotli
py tools\webfont\build_webfonts.py FONTS.zip --out public\fonts --brotli-quality 8
```

Expected output:

- 27 family directories
- 45 runtime WOFF2 faces
- 27 preview WOFF2 files

Commit/deploy `public/fonts` together with the frontend font code.

## Frontend build

```cmd
npm ci
npm run build
```

The integration environment completed TS/TSX syntax validation, but its npm registry DNS returned `EAI_AGAIN`, so the full dependency-backed Vite build must be confirmed on the normal development PC.

## Release order

1. Apply this integrated source (or the safe patch generated from it).
2. Generate `public/fonts` from `FONTS.zip`.
3. `npm ci`.
4. `npm run build`.
5. Push/deploy frontend + `public/fonts` successfully.
6. Only after deployment succeeds, execute:
   - `supabase/RELEASE_FONT_COSMETICS_AFTER_FRONTEND_DEPLOY.sql`
7. Run the read-only check:
   - `supabase/POSTCHECK_FONT_COSMETICS_RELEASE_20260907.sql`
8. Student E2E: market preview → purchase 300 CRYSTAL → home equip → refresh/login persistence → default restore.

## Important

If source changes again before this patch is applied, do not force-copy the files. Use the provided safe patch verifier; it aborts without changing anything when any baseline target hash has changed.
