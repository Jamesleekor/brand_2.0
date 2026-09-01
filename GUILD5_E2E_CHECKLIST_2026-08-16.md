# Guild5 E2E Checklist — 2026-08-16

## Gate
1. Run `PREFLIGHT_GUILD5_MONTHLY_CLOSURE.sql` and require every non-INFO row PASS.
2. Run `APPLY_GUILD5_MONTHLY_CLOSURE.sql` once.
3. Run `POSTCHECK_GUILD5_MONTHLY_CLOSURE.sql` and require every non-INFO row PASS.
4. Local `npm run build` must pass before COMPLETE.

## TEST fixture setup
- Teacher → Guild5 monthly close.
- `TEST 5길드 준비` → active guild count becomes 5. TEST01~05 remain in TEST GUILD.
- Selected month receives deterministic TEST Draft GS for empty simulation guilds: TEST GUILD 2 = 900, 3 = 750, 4 = 600, 5 = 450. Repeated clicks must not stack duplicate seed events.
- Configure exactly 3 territory names.
- Refresh preview.

## Close preview / readiness
- Session, teacher observation, mission, peer, arcade, official Mission GS, compensation config, territories all display explicit readiness.
- Any NOT_READY blocks FINALIZE.
- Only Mission / Peer have emergency override controls; reason required.
- Override is `OVERRIDDEN` using current calculable values, not forced zero.

## FINAL v1
- FINALIZE creates immutable student snapshots and guild snapshots.
- Guild2 DRAFT total and Guild5 FINAL total match at close.
- Rank uses: GS → close roster BV sum → official Mission GS → deterministic tie value.
- Student page shows final rank/GS/contribution and no draft recomputation.
- Guild3/Guild4 corrections after FINAL are blocked.

## Conquest
- Exactly top3 have turns.
- Rank1 ACTIVE first; rank2/3 WAITING.
- Manual selection advances one rank at a time.
- TEST-only `48시간 만료 테스트` auto-assigns an available territory and records AUTO.
- No territory can be selected twice in one version.
- 4th/5th receive no territory.

## REOPEN / v2
- REOPEN requires reason and preserves v1 snapshot/history.
- Guild3/Guild4 correction becomes available again.
- Re-finalize creates v2; v1 remains.
- If rank changed and v1 had no territory assignment: new sequence starts using new rank.
- If rank changed and any v1 territory was assigned: v2 becomes `RECONQUEST_REQUIRED`; explicit reconquest required.

## History / reset
- Student history uses only current FINAL snapshots.
- Cumulative Guild GS is sum of monthly FINAL snapshots only.
- Hall of Fame monthly guild winner points at current Guild5 FINAL version.
- TEST reset removes Guild5 first, then existing Guild4→Guild3→Guild2/Arcade flow, and removes TEST GUILD 2~5 simulation guilds.

## Season lock
- Lock button is unavailable until Guild season lifecycle is CLOSED.
- After lock, month REOPEN and Guild3/Guild4 mutations are blocked.
