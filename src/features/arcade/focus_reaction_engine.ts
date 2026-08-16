import type { ArcadeInputEvent } from '@/lib/zod_schemas/arcade_schemas';

export type FocusSignalKind = 'GO' | 'NO_GO';

export type FocusJudgementKind = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS' | 'NO_GO' | 'WRONG';

export interface FocusJudgement {
  id: number;
  kind: FocusJudgementKind;
  atElapsedMs: number;
  lane: number | null;
  lifeLost: boolean;
  awardedPoints?: number;
}

export interface FocusSignal {
  signalIndex: number;
  spawnMs: number;
  targetMs: number;
  lane: number;
  signalKind: FocusSignalKind;
  travelMs: number;
  hitWindowMs: number;
}

export interface FocusGameConfig {
  game_code: 'focus_reaction_01';
  lives: number;
  damage_recovery_ms: number;
  combo_multiplier_percent: number[];
  tiers: Record<string, FocusTierConfig>;
  overdrive: FocusOverdriveConfig;
}

interface FocusTierConfig {
  spawn_min_ms: number;
  spawn_max_ms: number;
  travel_ms: number;
  hit_window_ms: number;
  no_go_rate_bp: number;
  burst_chance_bp: number;
  burst_min_length: number;
  burst_max_length: number;
  burst_min_interval_ms: number;
  burst_max_interval_ms: number;
}

interface FocusOverdriveConfig {
  starts_at_ms: number;
  step_ms: number;
  spawn_interval_multiplier_percent: number;
  spawn_min_floor_ms: number;
  spawn_max_floor_ms: number;
  travel_delta_ms: number;
  travel_floor_ms: number;
  hit_window_delta_ms: number;
  hit_window_floor_ms: number;
  no_go_delta_bp: number;
  no_go_cap_bp: number;
  burst_chance_delta_bp: number;
  burst_chance_cap_bp: number;
  burst_interval_delta_ms: number;
  burst_interval_floor_ms: number;
}

export interface FocusRuntimeState {
  currentIndex: number;
  lives: number;
  combo: number;
  maxCombo: number;
  previewScore: number;
  correct: number;
  misses: number;
  noGoErrors: number;
  wrongLaneErrors: number;
  recoveryUntil: number;
  gameOverElapsedMs: number | null;
  inputEvents: ArcadeInputEvent[];
  nextJudgementId: number;
  lastJudgement: FocusJudgement | null;
}

export function parseFocusGameConfig(raw: Record<string, unknown>): FocusGameConfig {
  const config = raw as Partial<FocusGameConfig>;
  if (config.game_code !== 'focus_reaction_01' || !config.tiers || !config.overdrive) {
    throw new Error('게임 규칙 정보를 읽을 수 없습니다.');
  }
  return config as FocusGameConfig;
}

// PostgreSQL의 arcade_xorshift32_next()와 같은 unsigned 32-bit 계산이다.
function xorshift32Next(state: number): number {
  let value = state >>> 0;
  value = (value ^ ((value << 13) >>> 0)) >>> 0;
  value = (value ^ (value >>> 17)) >>> 0;
  value = (value ^ ((value << 5) >>> 0)) >>> 0;
  return value >>> 0;
}

function integerBetween(state: number, min: number, max: number) {
  return min + (state % (max - min + 1));
}

function tierAt(spawnMs: number) {
  if (spawnMs < 60_000) return 'EASY';
  if (spawnMs < 120_000) return 'NORMAL';
  if (spawnMs < 180_000) return 'HARD';
  if (spawnMs < 240_000) return 'VERY_HARD';
  if (spawnMs < 300_000) return 'EXTREME';
  return 'OVERDRIVE';
}

function settingsAt(config: FocusGameConfig, spawnMs: number): FocusTierConfig {
  const tier = tierAt(spawnMs);
  if (tier !== 'OVERDRIVE') return config.tiers[tier];

  const extreme = config.tiers.EXTREME;
  const overdrive = config.overdrive;
  const steps = Math.max(0, Math.floor((spawnMs - overdrive.starts_at_ms) / overdrive.step_ms));
  let spawnMin = extreme.spawn_min_ms;
  let spawnMax = extreme.spawn_max_ms;
  for (let index = 0; index < steps; index += 1) {
    spawnMin = Math.max(overdrive.spawn_min_floor_ms, Math.floor((spawnMin * overdrive.spawn_interval_multiplier_percent) / 100));
    spawnMax = Math.max(overdrive.spawn_max_floor_ms, Math.floor((spawnMax * overdrive.spawn_interval_multiplier_percent) / 100));
  }
  return {
    ...extreme,
    spawn_min_ms: spawnMin,
    spawn_max_ms: spawnMax,
    travel_ms: Math.max(overdrive.travel_floor_ms, extreme.travel_ms + steps * overdrive.travel_delta_ms),
    hit_window_ms: Math.max(overdrive.hit_window_floor_ms, extreme.hit_window_ms + steps * overdrive.hit_window_delta_ms),
    no_go_rate_bp: Math.min(overdrive.no_go_cap_bp, extreme.no_go_rate_bp + steps * overdrive.no_go_delta_bp),
    burst_chance_bp: Math.min(overdrive.burst_chance_cap_bp, extreme.burst_chance_bp + steps * overdrive.burst_chance_delta_bp),
    burst_min_interval_ms: Math.max(overdrive.burst_interval_floor_ms, extreme.burst_min_interval_ms + steps * overdrive.burst_interval_delta_ms),
    burst_max_interval_ms: Math.max(
      Math.max(overdrive.burst_interval_floor_ms, extreme.burst_min_interval_ms + steps * overdrive.burst_interval_delta_ms),
      extreme.burst_max_interval_ms + steps * overdrive.burst_interval_delta_ms,
    ),
  };
}

export function generateFocusSchedule(seed: number, config: FocusGameConfig, untilMs = 3_600_000): FocusSignal[] {
  const signals: FocusSignal[] = [];
  let state = seed >>> 0;
  let spawnMs = 0;
  let index = 0;
  let lastLane = -1;
  let sameLaneCount = 0;

  const pickLane = () => {
    state = xorshift32Next(state);
    let lane = state % 4;
    if (lane === lastLane && sameLaneCount >= 2) {
      state = xorshift32Next(state);
      lane = (lastLane + 1 + (state % 3)) % 4;
    }
    if (lane === lastLane) sameLaneCount += 1;
    else {
      lastLane = lane;
      sameLaneCount = 1;
    }
    return lane;
  };

  const pushSignal = (settings: FocusTierConfig, kind: FocusSignalKind, lane: number) => {
    index += 1;
    signals.push({
      signalIndex: index,
      spawnMs,
      targetMs: spawnMs + settings.travel_ms,
      lane,
      signalKind: kind,
      travelMs: settings.travel_ms,
      hitWindowMs: settings.hit_window_ms,
    });
  };

  while (true) {
    const settings = settingsAt(config, spawnMs);
    state = xorshift32Next(state);
    spawnMs += integerBetween(state, settings.spawn_min_ms, settings.spawn_max_ms);
    if (spawnMs + settings.travel_ms > untilMs) break;

    const lane = pickLane();
    state = xorshift32Next(state);
    const kind: FocusSignalKind = state % 10_000 < settings.no_go_rate_bp ? 'NO_GO' : 'GO';
    pushSignal(settings, kind, lane);

    if (tierAt(spawnMs) !== 'EASY' && settings.burst_chance_bp > 0) {
      state = xorshift32Next(state);
      if (state % 10_000 < settings.burst_chance_bp) {
        state = xorshift32Next(state);
        const burstLength = integerBetween(state, settings.burst_min_length, settings.burst_max_length);
        for (let burst = 0; burst < burstLength; burst += 1) {
          state = xorshift32Next(state);
          spawnMs += integerBetween(state, settings.burst_min_interval_ms, settings.burst_max_interval_ms);
          if (spawnMs + settings.travel_ms > untilMs) return signals;
          pushSignal(settings, 'GO', pickLane());
        }
      }
    }
  }
  return signals;
}

export function createFocusRuntime(config: FocusGameConfig): FocusRuntimeState {
  return {
    currentIndex: 0,
    lives: config.lives,
    combo: 0,
    maxCombo: 0,
    previewScore: 0,
    correct: 0,
    misses: 0,
    noGoErrors: 0,
    wrongLaneErrors: 0,
    recoveryUntil: -1,
    gameOverElapsedMs: null,
    inputEvents: [],
    nextJudgementId: 1,
    lastJudgement: null,
  };
}

function recordJudgement(
  state: FocusRuntimeState,
  judgement: Omit<FocusJudgement, 'id'>,
) {
  state.lastJudgement = { id: state.nextJudgementId, ...judgement };
  state.nextJudgementId += 1;
}

function loseLife(
  state: FocusRuntimeState,
  config: FocusGameConfig,
  elapsedMs: number,
  type: 'MISS' | 'NO_GO' | 'WRONG',
  lane: number | null,
) {
  state.lives -= 1;
  state.combo = 0;
  state.recoveryUntil = elapsedMs + config.damage_recovery_ms;
  if (type === 'MISS') state.misses += 1;
  if (type === 'NO_GO') state.noGoErrors += 1;
  if (type === 'WRONG') state.wrongLaneErrors += 1;
  recordJudgement(state, { kind: type, atElapsedMs: elapsedMs, lane, lifeLost: true });
  if (state.lives <= 0) state.gameOverElapsedMs = elapsedMs;
}

function skipRecoveredSignals(state: FocusRuntimeState, signals: FocusSignal[]) {
  while (signals[state.currentIndex] && signals[state.currentIndex].targetMs <= state.recoveryUntil) {
    state.currentIndex += 1;
  }
}

// 프레임 수가 아니라 실제 경과 시간으로, 서버 검증 규칙과 같은 순서로 진행한다.
export function advanceFocusRuntime(state: FocusRuntimeState, config: FocusGameConfig, signals: FocusSignal[], elapsedMs: number) {
  if (state.gameOverElapsedMs !== null) return;
  skipRecoveredSignals(state, signals);
  while (signals[state.currentIndex] && state.gameOverElapsedMs === null) {
    const signal = signals[state.currentIndex];
    const windowEnd = signal.targetMs + signal.hitWindowMs;
    if (elapsedMs <= windowEnd) break;
    if (signal.signalKind === 'NO_GO') {
      state.currentIndex += 1;
      continue;
    }
    state.currentIndex += 1;
    loseLife(state, config, windowEnd, 'MISS', signal.lane);
    skipRecoveredSignals(state, signals);
  }
}

export function recordFocusInput(state: FocusRuntimeState, config: FocusGameConfig, signals: FocusSignal[], elapsedMs: number, lane: number) {
  advanceFocusRuntime(state, config, signals, elapsedMs);
  if (state.gameOverElapsedMs !== null || elapsedMs <= state.recoveryUntil) return;
  const last = state.inputEvents[state.inputEvents.length - 1];
  if (last && elapsedMs <= last.elapsed_ms) return;

  state.inputEvents.push({ elapsed_ms: elapsedMs, lane });
  const signal = signals[state.currentIndex];
  if (!signal) return;
  const windowStart = signal.targetMs - signal.hitWindowMs;
  const windowEnd = signal.targetMs + signal.hitWindowMs;

  if (elapsedMs < windowStart) {
    // 이른 입력은 현재 신호를 포기하고 Life를 잃는다. 서버 검증기도
    // 동일하게 다음 신호로 진행하므로 index를 함께 앞당긴다.
    state.currentIndex += 1;
    loseLife(state, config, elapsedMs, 'WRONG', lane);
    skipRecoveredSignals(state, signals);
    return;
  }
  if (elapsedMs > windowEnd) {
    advanceFocusRuntime(state, config, signals, elapsedMs);
    return;
  }
  if (signal.signalKind === 'NO_GO') {
    state.currentIndex += 1;
    loseLife(state, config, elapsedMs, 'NO_GO', signal.lane);
    skipRecoveredSignals(state, signals);
    return;
  }
  if (lane !== signal.lane) {
    state.currentIndex += 1;
    loseLife(state, config, elapsedMs, 'WRONG', lane);
    skipRecoveredSignals(state, signals);
    return;
  }

  const errorMs = Math.abs(elapsedMs - signal.targetMs);
  state.combo += 1;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  const basePoints = 200 - Math.floor((100 * errorMs) / signal.hitWindowMs);
  const multiplier = state.combo >= 100 ? 140 : state.combo >= 50 ? 130 : state.combo >= 25 ? 120 : state.combo >= 10 ? 110 : 100;
  const awardedPoints = Math.floor((basePoints * multiplier) / 100);
  state.previewScore += awardedPoints;
  state.correct += 1;
  const kind: FocusJudgementKind = errorMs * 100 <= signal.hitWindowMs * 20
    ? 'PERFECT'
    : errorMs * 100 <= signal.hitWindowMs * 50
      ? 'GREAT'
      : 'GOOD';
  recordJudgement(state, { kind, atElapsedMs: elapsedMs, lane, lifeLost: false, awardedPoints });
  state.currentIndex += 1;
  skipRecoveredSignals(state, signals);
}

export function focusTierLabel(elapsedMs: number) {
  const tier = tierAt(elapsedMs);
  return tier === 'VERY_HARD' ? 'VERY HARD' : tier;
}

export function formatFocusTime(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
