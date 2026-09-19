# Guild 1.1 validation

- Corrected UI model: guild has no element; membership owns element.
- Added DARK / 어둠 to frontend validation and display.
- Guild create modal uses direct RPC + inline persistent error.
- Guild assignment/move modal selects the student's element independently from guild.
- Session snapshot reads `guild_members.element` directly.
- SQL patch removes `guilds.element_code` and replaces create/update/member/session/health RPCs.
- Static TypeScript syntax/transpile validation is run before packaging.
- Full npm build is attempted when dependencies are available in the sandbox; see packaging notes if unavailable.
