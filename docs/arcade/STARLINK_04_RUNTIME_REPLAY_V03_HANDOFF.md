# Starlink #04 — 60-second runtime / deterministic replay handoff
**Rule version:** `starlink_04_v0.3`  
**Game:** `starlink_04`  
**Implementation branch:** `starlink-step2a-core-schema`  
**Status:** Pure TS + internal SQL replay implemented. **NOT production-deployed, NOT student-playable.**

## 1. Completed

- TS `starlinkRuntime.ts`: creates gameplay state, consumes typed logical input events, advances a wall clock, tracks phase, accumulates official score/stats, and replays a normal complete 60-second run.
- SQL `20261012_01_starlink_04_full_run_replay.sql`: internal, immutable, non-browser-executable `public.arcade_starlink_04_replay(bigint,jsonb,integer)`. Independently replays the same run through SQL board/path/scoring helpers.
- Golden SQL postcheck and TS tests: 2-clear fixture, terminal-during-settle, premature submission, locked input, actual dead-board reshuffle, real 350ms pause and combo freeze.
- Existing Arcade and Rakaruka game/UI behavior was **not activated or replaced**.

## 2. Event contract

```ts
type StarlinkInputEvent =
  | { type: 'PATH_START'; elapsed_ms: number; cell: number }
  | { type: 'CELL_ENTER'; elapsed_ms: number; cell: number }
  | { type: 'PATH_RELEASE'; elapsed_ms: number }
  | { type: 'PATH_CANCEL'; elapsed_ms: number };
```

`PATH_CANCEL` is the explicit extension for browser `pointercancel` or lost capture: it never removes stars or awards points. The browser must not report this as `PATH_RELEASE`.

Event `elapsed_ms` is monotonically nondecreasing *wall elapsed* (integer milliseconds) after authoritative PLAYING start. Max 5000 events per run, range 0..180000. Client handles pixel→logical cell mapping; server validates logical path geometry.

## 3. Clock and phase

```text
PLAYING
  -> valid PATH_RELEASE:
        score + official stats commit immediately
        SETTLING [release wall, release wall+200)
  -> if board after refill is dead:
        RESHUFFLING [settle_end, settle_end+350)
  -> PLAYING
  -> GAME_OVER at ACTIVE 60000ms
```

- During SETTLING: input locked; **active clock and combo clock run**.
- During RESHUFFLING: input locked; **active clock and combo clock both freeze**.
- When the wall deadline for ACTIVE 60000 falls inside SETTLING (or exactly at its end), the already-awarded score/stats remain, while refill/dead-check/reshuffle are skipped.
- `game_end_wall_ms = 60000 + 350 * number_of_completed_reshuffle_pauses_before_terminal`.
- Scoring only occurs on a legal `PATH_RELEASE` strictly before active 60000.
- Invalid input inside a lock is rejected; valid logged input at/after GAME_OVER never earns points.

## 4. Official stats

```ts
{
  totalRemovedStars,
  normalClearCount,
  loopCount,
  maxLinkLength,
  maxCombo,
  largestLoopRemovedCount,
  reshuffleCount
}
```

`maxLinkLength` counts the longest **successfully committed** directly dragged unique path, not total stars removed by a loop. Cancellation/short path has no contribution.

## 5. Golden fixtures

### A. Two clears — seed 6059
- Clear 1: `[22,29,30,36]` released at wall 250 → 300 points.
- Clear 2: `[3,9,10]` released at wall 500 → combo 2 / 157 points.
- Final: **457 points**, two normal clears, seven stars removed, maxCombo 2, no reshuffle.
- End wall: 60000.
- Refill state: `1054902790`.

### B. Actual dead board — seed 8
- Nine deterministic 3-link clears; dead board occurs after clear 8.
- Reshuffle pause begins wall `1940`, ends `2290`. Clear 9 begins at exactly wall `2290`.
- Clear 9 release wall `2320`, active commit `1970`; combo continues, no 350ms penalty.
- Final: **1618 points**, 9 normal clears, 27 stars, maxCombo 9, 1 reshuffle.
- End wall: **60350**.
- Refill state: `627960630`. Reshuffle state: `3318130477`.

### C. Terminal during settle
- Four-star valid clear released at wall 59999 → 300 awarded points.
- GAME_OVER wall 60000, board remains initial; refill RNG is **not consumed**.
- If release happens at wall 60000 → 0 awarded points.

## 6. Security/trust boundary — MUST do before activation

The SQL function is **only an internal pure replay primitive**; it is **not** an authenticated student submission endpoint, and a client-provided duration is not a trusted wall clock.

The next integration must:

1. Bind `gameplay_seed`, `run_nonce`, pinned `rule_version_id`, student/classroom/verification attempt to the authorized server-side run.
2. Use server-stamped `play_started_at` (teacher verification attempt consumed atomically on PLAYING transition).
3. Record authoritative `submission_received_at`, evaluate a physically possible elapsed-time envelope; reject submissions arriving materially earlier than `replay.game_end_wall_ms`. Use <=100ms fixed timestamp tolerance if justified.
4. Produce authoritative `game_over_at` and ranking-period membership from **server-owned** timestamps, never client `elapsed_ms`.
5. Recalculate score/stats from SQL replay, validate all event structure and output shape, and commit score/stats/source-run atomically and idempotently.
6. Keep the same source `run_id` for the entire official score + stats bundle.
7. On official challenge, enforce seed A/B/C pack, frozen threshold and 80% success policy from common Arcade Core.
8. Only then enable student route/game and teacher controls after operational end-to-end tests.

Do **not** expose `arcade_starlink_04_replay` directly to `anon` or `authenticated` clients, accept posted final scores, or activate preregistered `starlink_04` before the true server validator is integrated.

## 7. CI

`.github/workflows/starlink-dev-check.yml` runs:
- `npm run test:starlink`
- `npm run test:tikatuka`
- `npm run build`
- Ephemeral PostgreSQL migrations `05 → 06 → 20261012_01` and all associated Golden SQL postchecks.

**Scope note:** tests establish deterministic equality for the fixtures and guarded boundaries above; they are not a formal proof of all possible input traces or a substitute for server-stamped submit integration.
