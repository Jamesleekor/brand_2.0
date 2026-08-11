# Guild 1.2 Validation Results

- Changed TS/TSX files parsed/transpiled with TypeScript 5.8.3: 0 syntax/transpile diagnostics.
  - `src/features/guild/GuildAdmin.tsx`
  - `src/features/guild/GuildPage.tsx`
  - `src/stores/ui_store.tsx`
- Full npm build was not executed in this environment because project dependencies are not installed/cached here.
- SQL patch is incremental and does not mutate/delete existing membership history rows.
- SQL uses no `CASCADE`; dependency conflicts fail and roll back.
