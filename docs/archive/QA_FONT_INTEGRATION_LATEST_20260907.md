# Font Integration QA — latest baseline — 2026-09-07

## PASS

- Three-way baseline verification: PASS
  - old arcade-auth final vs latest upload: all 8 font-target existing files were byte-identical before merge
- Latest-source preservation: PASS
  - existing files modified intentionally: 8
  - existing files deleted: 0
  - unrelated latest-source files changed: 0
- Safe patch self-test: PASS
  - verified baseline apply: 30 files copied successfully at test time
  - conflict test: modified `src/App.tsx` caused preflight abort before any file copy
- TS/TSX parser validation: PASS
  - 204 files parsed
  - syntax errors: 0
- Local import regression comparison: PASS
  - latest baseline existing unresolved/generated aliases: 8
  - merged source: same 8
  - new unresolved local imports caused by font integration: 0
- Font catalog: PASS
  - families: 27 unique item UIDs
  - runtime weight faces: 45
  - YPairing Bold catalog override includes 700
- Product metadata: PASS
  - 27/27 price = 300
  - 27/27 currency = CRYSTAL
- Legacy cosmetic RPC literals in frontend: 0
- Font ownership browser query: self-scoped `student_get_my_fonts()`
- Python tooling compile: PASS
- Full webfont build from `FONTS.zip`: PASS
  - 27 families
  - 45 runtime WOFF2
  - 27 preview WOFF2
  - total WOFF2 files: 72
  - runtime total: 40.69 MiB
  - preview total: ~0.12 MiB
- Live Supabase pre-release state: PASS
  - font items: 27
  - active font items: 0 (intentionally staged)
  - active price rows at 300 CRYSTAL: 27
  - legacy purchase/equip executable by anon/authenticated: false
  - safe purchase/select/get-my-fonts executable by authenticated: true

## ENVIRONMENT-LIMITED CHECK

`npm ci` could not complete in the assistant execution container because `registry.npmjs.org` repeatedly returned DNS `EAI_AGAIN`. As a result, dependency-backed `npm run build` cannot be truthfully marked PASS here.

This is separate from source parsing: all 204 TS/TSX files parse successfully, and the new local import graph adds no unresolved project-local imports. Final release still requires `npm ci` + `npm run build` on the normal development PC before activating font products.

## RELEASE GATE

Do not run `supabase/RELEASE_FONT_COSMETICS_AFTER_FRONTEND_DEPLOY.sql` until:

1. `public/fonts` has been generated,
2. `npm run build` passes,
3. frontend + font assets are deployed successfully.
