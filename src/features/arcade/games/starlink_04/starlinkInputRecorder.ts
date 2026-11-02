/**
 * Client-side input recorder. It runs the exact same deterministic reducer as
 * the server replay and only records an event when that reducer accepts it,
 * so the submitted event log always replays to the same official score.
 *   - inputs during settle/reshuffle/game-over are dropped (never recorded)
 *   - CELL_ENTER that the locked precedence ignores is not recorded
 *   - timestamps are integer, non-decreasing wall ms since server PLAYING
 */
import {
  advanceStarlinkRun,
  applyStarlinkEvent,
  createStarlinkRun,
  type StarlinkInputEvent,
  type StarlinkRuntimeState,
} from './starlinkRuntime';
import { STARLINK_V03_RULES, type StarlinkGameplayRules } from './starlinkRules';

export const STARLINK_MAX_EVENTS = 5_000;

export type StarlinkRecordOutcome = 'RECORDED' | 'IGNORED' | 'LOCKED' | 'GAME_OVER' | 'LIMIT';

export class StarlinkInputRecorder {
  private stateValue: StarlinkRuntimeState;
  private readonly log: StarlinkInputEvent[] = [];
  private lastMs = 0;

  constructor(gameplaySeed: number, private readonly rules: StarlinkGameplayRules = STARLINK_V03_RULES) {
    this.stateValue = createStarlinkRun(gameplaySeed, rules);
  }

  get state(): StarlinkRuntimeState { return this.stateValue; }
  get events(): readonly StarlinkInputEvent[] { return this.log; }
  get lastEventMs(): number { return this.log.length ? this.log[this.log.length - 1].elapsed_ms : 0; }
  get pathActive(): boolean { return this.stateValue.path.path.length > 0; }

  private clamp(ms: number): number {
    const value = Math.max(this.lastMs, Math.max(0, Math.floor(ms)));
    return Math.min(value, 180_000);
  }

  /** Advance the clock without input. Returns the new state. */
  tick(ms: number): StarlinkRuntimeState {
    const at = this.clamp(ms);
    this.stateValue = advanceStarlinkRun(this.stateValue, at, this.rules);
    this.lastMs = at;
    return this.stateValue;
  }

  private submit(event: StarlinkInputEvent, mustChangePath: boolean): StarlinkRecordOutcome {
    const advanced = advanceStarlinkRun(this.stateValue, event.elapsed_ms, this.rules);
    this.stateValue = advanced;
    this.lastMs = event.elapsed_ms;
    if (advanced.phase === 'GAME_OVER') return 'GAME_OVER';
    if (advanced.phase !== 'PLAYING') return 'LOCKED';
    if (this.log.length >= STARLINK_MAX_EVENTS) return 'LIMIT';
    let next: StarlinkRuntimeState;
    try {
      next = applyStarlinkEvent(advanced, event, this.rules);
    } catch {
      return 'IGNORED';
    }
    if (mustChangePath && next.path === advanced.path) return 'IGNORED';
    this.stateValue = next;
    this.log.push(event);
    return 'RECORDED';
  }

  pathStart(ms: number, cell: number): StarlinkRecordOutcome {
    if (this.pathActive) return 'IGNORED';
    return this.submit({ type: 'PATH_START', elapsed_ms: this.clamp(ms), cell }, false);
  }

  cellEnter(ms: number, cell: number): StarlinkRecordOutcome {
    if (!this.pathActive) return 'IGNORED';
    return this.submit({ type: 'CELL_ENTER', elapsed_ms: this.clamp(ms), cell }, true);
  }

  release(ms: number): StarlinkRecordOutcome {
    if (!this.pathActive) return 'IGNORED';
    return this.submit({ type: 'PATH_RELEASE', elapsed_ms: this.clamp(ms) }, false);
  }

  /** pointercancel / lost capture: never converted into a successful release. */
  cancel(ms: number): StarlinkRecordOutcome {
    if (!this.pathActive) return 'IGNORED';
    return this.submit({ type: 'PATH_CANCEL', elapsed_ms: this.clamp(ms) }, false);
  }

  /** Wall ms to send as p_client_end_wall_ms once the run is over. */
  submissionWallMs(): number | null {
    if (this.stateValue.phase !== 'GAME_OVER' || this.stateValue.finalEndWallMs === null) return null;
    return Math.max(this.stateValue.finalEndWallMs, this.lastEventMs);
  }
}
