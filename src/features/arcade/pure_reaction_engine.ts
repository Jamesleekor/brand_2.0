import { xorshift32Next } from '@/features/arcade/focus_reaction_engine';
import type { PureReactionInputEvent } from '@/lib/zod_schemas/arcade_schemas';

export type PureReactionPhase = 'TRIAL_WAITING' | 'GO_ACTIVE' | 'TRIAL_FEEDBACK' | 'GAME_OVER';
export type PureReactionOutcome = 'COMPLETE' | 'FALSE_START_PRE_SIGNAL' | 'FALSE_START_UNDER_120MS' | 'REACTION_TIMEOUT';

export interface PureReactionGameConfig {
  game_code: 'pure_reaction_02';
  trialCount: number;
  waitMinMs: number;
  waitMaxMs: number;
  minValidReactionMs: number;
  responseTimeoutMs: number;
  interTrialFeedbackMs: number;
  countdown_ms: number;
  max_input_events: number;
  max_client_elapsed_ms: number;
  client_end_tolerance_ms: number;
  server_elapsed_tolerance_ms: number;
  visualTheme: 'MAGIC_CORE_IGNITION';
}

export interface PureReactionRuntime {
  trialIndex: number;
  phase: PureReactionPhase;
  cursorMs: number;
  signalElapsedMs: number;
  feedbackEndsAtMs: number | null;
  reactions: number[];
  inputEvents: PureReactionInputEvent[];
  outcome: PureReactionOutcome | null;
  gameOverElapsedMs: number | null;
  lastReactionMs: number | null;
}

export function parsePureReactionConfig(raw: Record<string, unknown>): PureReactionGameConfig {
  const config = raw as Partial<PureReactionGameConfig>;
  if (config.game_code !== 'pure_reaction_02') throw new Error('순수 반응속도 게임 규칙을 읽을 수 없습니다.');
  const expected: Array<[keyof PureReactionGameConfig, number]> = [
    ['trialCount', 5], ['waitMinMs', 1500], ['waitMaxMs', 4500], ['minValidReactionMs', 120],
    ['responseTimeoutMs', 3000], ['interTrialFeedbackMs', 700],
  ];
  for (const [key, value] of expected) if (Number(config[key]) !== value) throw new Error(`게임 규칙 값(${String(key)})이 v0.1과 일치하지 않습니다.`);
  return config as PureReactionGameConfig;
}

export function generatePureReactionWaits(seed: number, config: PureReactionGameConfig): number[] {
  const waits: number[] = [];
  let state = seed >>> 0;
  const span = config.waitMaxMs - config.waitMinMs + 1;
  for (let index = 0; index < config.trialCount; index += 1) {
    state = xorshift32Next(state);
    waits.push(config.waitMinMs + (state % span));
  }
  return waits;
}

export function createPureReactionRuntime(waits: number[]): PureReactionRuntime {
  if (waits.length !== 5) throw new Error('반응 시험 대기시간 5개가 필요합니다.');
  return {
    trialIndex: 0,
    phase: 'TRIAL_WAITING',
    cursorMs: 0,
    signalElapsedMs: waits[0],
    feedbackEndsAtMs: null,
    reactions: [],
    inputEvents: [],
    outcome: null,
    gameOverElapsedMs: null,
    lastReactionMs: null,
  };
}

export function advancePureReactionRuntime(runtime: PureReactionRuntime, config: PureReactionGameConfig, waits: number[], elapsedMs: number) {
  if (runtime.phase === 'GAME_OVER') return;
  if (runtime.phase === 'TRIAL_WAITING' && elapsedMs >= runtime.signalElapsedMs) runtime.phase = 'GO_ACTIVE';
  if (runtime.phase === 'GO_ACTIVE' && elapsedMs >= runtime.signalElapsedMs + config.responseTimeoutMs) {
    runtime.phase = 'GAME_OVER';
    runtime.outcome = 'REACTION_TIMEOUT';
    runtime.gameOverElapsedMs = runtime.signalElapsedMs + config.responseTimeoutMs;
    return;
  }
  if (runtime.phase === 'TRIAL_FEEDBACK' && runtime.feedbackEndsAtMs !== null && elapsedMs >= runtime.feedbackEndsAtMs) {
    const nextTrial = runtime.trialIndex + 1;
    if (nextTrial >= config.trialCount) return;
    runtime.trialIndex = nextTrial;
    runtime.cursorMs = runtime.feedbackEndsAtMs;
    runtime.signalElapsedMs = runtime.cursorMs + waits[nextTrial];
    runtime.feedbackEndsAtMs = null;
    runtime.lastReactionMs = null;
    runtime.phase = elapsedMs >= runtime.signalElapsedMs ? 'GO_ACTIVE' : 'TRIAL_WAITING';
    advancePureReactionRuntime(runtime, config, waits, elapsedMs);
  }
}

export function recordPureReactionInput(runtime: PureReactionRuntime, config: PureReactionGameConfig, waits: number[], elapsedMs: number, source: 'SPACE' | 'POINTER') {
  advancePureReactionRuntime(runtime, config, waits, elapsedMs);
  if (runtime.phase === 'GAME_OVER' || runtime.phase === 'TRIAL_FEEDBACK') return;
  const previous = runtime.inputEvents[runtime.inputEvents.length - 1];
  if (previous && elapsedMs <= previous.elapsed_ms) return;
  runtime.inputEvents.push({ elapsed_ms: elapsedMs, source });

  if (elapsedMs < runtime.signalElapsedMs) {
    runtime.phase = 'GAME_OVER';
    runtime.outcome = 'FALSE_START_PRE_SIGNAL';
    runtime.gameOverElapsedMs = elapsedMs;
    return;
  }

  const reactionMs = elapsedMs - runtime.signalElapsedMs;
  if (reactionMs < config.minValidReactionMs) {
    runtime.phase = 'GAME_OVER';
    runtime.outcome = 'FALSE_START_UNDER_120MS';
    runtime.gameOverElapsedMs = elapsedMs;
    return;
  }
  if (reactionMs >= config.responseTimeoutMs) {
    runtime.phase = 'GAME_OVER';
    runtime.outcome = 'REACTION_TIMEOUT';
    runtime.gameOverElapsedMs = runtime.signalElapsedMs + config.responseTimeoutMs;
    return;
  }

  runtime.reactions.push(reactionMs);
  runtime.lastReactionMs = reactionMs;
  if (runtime.reactions.length === config.trialCount) {
    runtime.phase = 'GAME_OVER';
    runtime.outcome = 'COMPLETE';
    runtime.gameOverElapsedMs = elapsedMs;
    return;
  }
  runtime.phase = 'TRIAL_FEEDBACK';
  runtime.feedbackEndsAtMs = elapsedMs + config.interTrialFeedbackMs;
}

export function pureReactionSummary(reactions: number[]) {
  const sum = reactions.reduce((total, value) => total + value, 0);
  const averageX10 = sum * 2;
  const score = reactions.length === 5 && sum > 0 ? Math.floor(25_000_000_000 / (sum * sum)) : null;
  return { sumReactionMs: sum, averageReactionMsX10: averageX10, score, bestReactionMs: reactions.length ? Math.min(...reactions) : null, worstReactionMs: reactions.length ? Math.max(...reactions) : null };
}

export function formatReactionAverage(averageX10: number | null | undefined) {
  if (averageX10 === null || averageX10 === undefined) return '—';
  return `${(Number(averageX10) / 10).toFixed(1)} ms`;
}
