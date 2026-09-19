# Nightly Stage 3 — Safe Guild UI / Integration Fixes
## 2026-08-17

Status: COMPLETE
Production DB writes: NONE
Locked Guild rules changed: NO

## Fix 1 — Conquest floating panel clipping
Observed from user screenshot:
- territory #3 floating panel extended below the map;
- both the map wrapper and outer card used `overflow-hidden`, clipping the bottom of the panel.

Implemented:
- outer conquest card no longer clips floating UI;
- map image keeps rounded visual boundaries;
- desktop lower-right territory uses bottom anchoring instead of a low `top` position;
- mobile no longer tries to fit a tall floating panel inside a short 16:9 map: selected territory detail is rendered immediately below the map in normal flow;
- no conquest data, ranking, tax, or snapshot semantics changed.

## Fix 2 — Guild2 teacher copy corrected
Removed obsolete text saying Mission / Peer / Arcade were future connections or Mission GS was not connected.
New wording explicitly states:
- Guild2 = current-month DRAFT calculator;
- connected Mission / Peer / Arcade sources are reflected;
- Guild5 owns the FINAL snapshot.

## Fix 3 — Student monthly-close tab status
Before: `월간결산 / FINAL` was always shown.
After:
- current month has a Guild5 FINAL snapshot → `FINAL`
- otherwise → `마감 전`

## Validation
- `transpileModule` syntax validation: PASS
  - `GuildConquestPage.tsx`
  - `GuildPage.tsx`
  - `GuildScoreAdmin.tsx`
- conquest map asset: 1672×941 WebP, readable
- structural checks for clipping/mobile/status wording: PASS
- full `npm ci --offline`: NOT AVAILABLE because local npm cache lacks `zustand-5.0.14.tgz`.
- therefore a full project build is intentionally left as a morning local-PC gate; no false PASS is recorded.

## Morning visual check
At desktop width:
1. open `/guild/conquest`;
2. click territory #3 marker;
3. confirm all four info cells and any territory description are visible;
4. confirm ranking list is not permanently displaced;
5. close popup and confirm layout returns unchanged.

At narrow/mobile width:
1. click each marker;
2. detail should appear below the map, never clipped;
3. close button should collapse it.
