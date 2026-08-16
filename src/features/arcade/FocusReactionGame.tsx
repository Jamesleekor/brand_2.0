import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { arcadeStudentRpc, type ArcadeRunBootstrap, type ArcadeRunSubmissionResult } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';
import {
  advanceFocusRuntime,
  createFocusRuntime,
  focusTierLabel,
  formatFocusTime,
  generateFocusSchedule,
  parseFocusGameConfig,
  recordFocusInput,
  type FocusGameConfig,
  type FocusJudgement,
  type FocusRuntimeState,
  type FocusSignal,
} from '@/features/arcade/focus_reaction_engine';

const LANES = [
  { key: 'D', lane: 0, label: '왼쪽 바람' },
  { key: 'F', lane: 1, label: '왼쪽 빛' },
  { key: 'J', lane: 2, label: '오른쪽 불' },
  { key: 'K', lane: 3, label: '오른쪽 어둠' },
] as const;

const FEEDBACK_DURATION_MS = 850;

type GamePhase = 'COUNTDOWN' | 'STARTING' | 'PLAYING' | 'SUBMITTING' | 'RESULT' | 'ERROR';

interface RuntimeView {
  elapsedMs: number;
  lives: number;
  combo: number;
  previewScore: number;
  currentIndex: number;
  recoveryUntil: number;
  lastJudgement: FocusJudgement | null;
}

export interface FocusPlaySummary {
  durationMs: number;
  previewScore: number;
  maxCombo: number;
  correct: number;
  misses: number;
  noGoErrors: number;
  wrongLaneErrors: number;
  remainingLives: number;
}

interface FocusReactionGameProps {
  bootstrap: ArcadeRunBootstrap;
  myRank: number | null;
  myBestScore: number | null;
  isRankingUpdating: boolean;
  onRecorded: (result: ArcadeRunSubmissionResult, summary: FocusPlaySummary) => void;
  onExit: () => void;
  onInlineError: (message: string) => void;
}

export function FocusReactionGame({
  bootstrap,
  myRank,
  myBestScore,
  isRankingUpdating,
  onRecorded,
  onExit,
  onInlineError,
}: FocusReactionGameProps) {
  const [phase, setPhase] = useState<GamePhase>('COUNTDOWN');
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const [view, setView] = useState<RuntimeView>({ elapsedMs: 0, lives: 3, combo: 0, previewScore: 0, currentIndex: 0, recoveryUntil: -1, lastJudgement: null });
  const [isHidden, setIsHidden] = useState(false);
  const [finalSummary, setFinalSummary] = useState<FocusPlaySummary | null>(null);
  const [serverResult, setServerResult] = useState<ArcadeRunSubmissionResult | null>(null);
  const runtimeRef = useRef<FocusRuntimeState | null>(null);
  const signalsRef = useRef<FocusSignal[]>([]);
  const configRef = useRef<FocusGameConfig | null>(null);
  const playStartedPerformanceRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const updateView = useCallback((runtime: FocusRuntimeState, elapsedMs: number) => {
    setView({
      elapsedMs,
      lives: Math.max(0, runtime.lives),
      combo: runtime.combo,
      previewScore: runtime.previewScore,
      currentIndex: runtime.currentIndex,
      recoveryUntil: runtime.recoveryUntil,
      lastJudgement: runtime.lastJudgement,
    });
  }, []);

  const captureSummary = useCallback((runtime: FocusRuntimeState): FocusPlaySummary => ({
    durationMs: runtime.gameOverElapsedMs ?? 0,
    previewScore: runtime.previewScore,
    maxCombo: runtime.maxCombo,
    correct: runtime.correct,
    misses: runtime.misses,
    noGoErrors: runtime.noGoErrors,
    wrongLaneErrors: runtime.wrongLaneErrors,
    remainingLives: Math.max(0, runtime.lives),
  }), []);

  const submitGameOver = useCallback(async (runtime: FocusRuntimeState) => {
    if (submittedRef.current || runtime.gameOverElapsedMs === null) return;
    submittedRef.current = true;
    const summary = captureSummary(runtime);
    setFinalSummary(summary);
    setPhase('SUBMITTING');
    const result = await arcadeStudentRpc.submitFocusReactionRun(supabase, {
      p_run_id: bootstrap.run_id,
      p_input_events: runtime.inputEvents,
      p_client_game_over_elapsed_ms: runtime.gameOverElapsedMs,
    });
    if (!result.success) {
      setPhase('ERROR');
      onInlineError('공식 기록을 확인하지 못했어요. 잠시 후 결과 확인 버튼을 눌러주세요.');
      return;
    }
    setServerResult(result.data);
    setPhase('RESULT');
    onRecorded(result.data, summary);
  }, [bootstrap.run_id, captureSummary, onInlineError, onRecorded]);

  const startGame = useCallback(async () => {
    setPhase('STARTING');
    const result = await arcadeStudentRpc.beginRun(supabase, { p_run_id: bootstrap.run_id });
    if (!result.success) {
      setPhase('ERROR');
      onInlineError('게임을 시작하지 못했어요. 준비 시간이 끝난 뒤 다시 시도해주세요.');
      return;
    }
    try {
      const config = parseFocusGameConfig(result.data.config);
      configRef.current = config;
      signalsRef.current = generateFocusSchedule(result.data.schedule_seed, config);
      runtimeRef.current = createFocusRuntime(config);
      playStartedPerformanceRef.current = performance.now();
      updateView(runtimeRef.current, 0);
      setPhase('PLAYING');
    } catch (error) {
      setPhase('ERROR');
      onInlineError(error instanceof Error ? error.message : '게임 규칙 정보를 읽을 수 없습니다.');
    }
  }, [bootstrap.run_id, onInlineError, updateView]);

  // 서버의 COUNTDOWN 시작은 응답을 받기 전에 이미 기록된다. 네트워크·기기 시계 차이로
  // 너무 이르게 begin RPC를 부르지 않도록, 응답을 받은 뒤 최소 5.2초를 기다린다.
  useEffect(() => {
    if (phase !== 'COUNTDOWN') return undefined;
    const localStartedAt = performance.now();
    const serverRemaining = Math.max(0, new Date(bootstrap.countdown_ends_at).getTime() - Date.now());
    const waitMs = Math.max(5_200, serverRemaining + 200);
    let frame = 0;
    const renderCountdown = (now: number) => {
      const remaining = Math.max(0, waitMs - (now - localStartedAt));
      setCountdownSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      if (remaining > 0) frame = requestAnimationFrame(renderCountdown);
    };
    frame = requestAnimationFrame(renderCountdown);
    const timer = window.setTimeout(() => void startGame(), waitMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [bootstrap.countdown_ends_at, phase, startGame]);

  useEffect(() => {
    if (phase !== 'PLAYING') return undefined;
    let frame = 0;
    const tick = (now: number) => {
      const runtime = runtimeRef.current;
      const config = configRef.current;
      const startedAt = playStartedPerformanceRef.current;
      if (!runtime || !config || startedAt === null) return;
      const elapsedMs = Math.floor(now - startedAt);
      advanceFocusRuntime(runtime, config, signalsRef.current, elapsedMs);
      updateView(runtime, elapsedMs);
      if (runtime.gameOverElapsedMs !== null) {
        void submitGameOver(runtime);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, submitGameOver, updateView]);

  useEffect(() => {
    const onVisibility = () => setIsHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const pressLane = useCallback((lane: number) => {
    if (phase !== 'PLAYING') return;
    const runtime = runtimeRef.current;
    const config = configRef.current;
    const startedAt = playStartedPerformanceRef.current;
    if (!runtime || !config || startedAt === null) return;
    const elapsedMs = Math.floor(performance.now() - startedAt);
    recordFocusInput(runtime, config, signalsRef.current, elapsedMs, lane);
    updateView(runtime, elapsedMs);
    if (runtime.gameOverElapsedMs !== null) void submitGameOver(runtime);
  }, [phase, submitGameOver, updateView]);

  useEffect(() => {
    const keyToLane: Record<string, number> = { d: 0, f: 1, j: 2, k: 3 };
    const onKeyDown = (event: KeyboardEvent) => {
      const lane = keyToLane[event.key.toLowerCase()];
      if (lane === undefined || event.repeat) return;
      event.preventDefault();
      pressLane(lane);
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pressLane]);

  const visibleSignals = useMemo(() => {
    const visible: FocusSignal[] = [];
    for (let index = Math.max(0, view.currentIndex - 1); index < Math.min(signalsRef.current.length, view.currentIndex + 16); index += 1) {
      const signal = signalsRef.current[index];
      if (signal.spawnMs > view.elapsedMs) break;
      if (view.elapsedMs <= signal.targetMs + signal.hitWindowMs) visible.push(signal);
    }
    return visible;
  }, [view.currentIndex, view.elapsedMs]);

  const feedback = view.lastJudgement;
  const feedbackVisible = feedback !== null
    && view.elapsedMs - feedback.atElapsedMs <= FEEDBACK_DURATION_MS
    && phase !== 'RESULT';
  const recentLifeLoss = feedbackVisible && feedback?.lifeLost === true;

  if (phase === 'COUNTDOWN' || phase === 'STARTING') {
    return <div className="glass-card border-brand-primary/30 p-6 text-center">
      <div className="text-5xl">🎯</div>
      <h2 className="mt-3 font-display text-2xl text-brand-gradient">집중 반응 시험</h2>
      <div className="mt-5 font-display text-6xl text-gold">{phase === 'STARTING' ? 'GO!' : countdownSeconds}</div>
      <p className="mt-4 text-sm text-text-secondary">D · F · J · K 또는 아래 네 칸을 사용하세요.</p>
      <p className="mt-2 text-xs text-text-muted">준비가 끝나면 실제 시간으로 바로 시작됩니다.</p>
    </div>;
  }

  if (phase === 'ERROR') {
    return <div className="glass-card border-danger/40 p-6 text-center"><div className="text-4xl">⚠️</div><h2 className="mt-3 font-display text-xl text-danger">게임 기록을 확인 중이에요</h2><p className="mt-2 text-sm text-text-secondary">새 게임을 시작하기 전에 화면의 결과 안내를 확인해주세요.</p></div>;
  }

  if (phase === 'RESULT' && finalSummary && serverResult) {
    return <GameResultPanel
      bootstrap={bootstrap}
      result={serverResult}
      summary={finalSummary}
      myRank={myRank}
      myBestScore={myBestScore}
      isRankingUpdating={isRankingUpdating}
      onExit={onExit}
    />;
  }

  return <section className="glass-card overflow-hidden border-brand-primary/30">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg-deep/80 px-4 py-3">
      <div><div className="text-xs font-black text-brand-primary">FOCUS REACTION #01</div><div className="font-display text-xl text-white">{formatFocusTime(view.elapsedMs)} <span className="ml-2 text-sm text-gold">{focusTierLabel(view.elapsedMs)}</span></div></div>
      <div className="flex gap-3 text-right"><div><div className="text-[10px] text-text-muted">LIFE</div><div className={`text-lg tracking-wider ${recentLifeLoss ? 'animate-pulse text-danger' : ''}`}>{'❤'.repeat(view.lives)}<span className="text-text-muted">{'♡'.repeat(Math.max(0, 3 - view.lives))}</span></div></div><div><div className="text-[10px] text-text-muted">COMBO</div><div className="font-display text-lg text-gold">{view.combo}</div></div><div><div className="text-[10px] text-text-muted">예상 점수</div><div className="font-display text-lg text-white">{view.previewScore.toLocaleString('ko-KR')}</div></div></div>
    </div>
    {isHidden && <div className="bg-warning/15 px-4 py-2 text-center text-xs font-black text-warning">화면을 벗어나도 게임 시간은 계속 흐릅니다.</div>}
    <div className={`relative grid h-[360px] grid-cols-4 gap-2 overflow-hidden bg-slate-950 p-3 sm:h-[440px] ${recentLifeLoss ? 'bg-danger/10' : ''}`}>
      {LANES.map((lane) => {
        const laneSignals = visibleSignals.filter((signal) => signal.lane === lane.lane);
        const laneWasJudged = feedbackVisible && feedback?.lane === lane.lane;
        const positiveHit = laneWasJudged && !feedback?.lifeLost;
        const negativeHit = laneWasJudged && feedback?.lifeLost;
        return <button key={lane.key} type="button" disabled={phase !== 'PLAYING'} onPointerDown={(event) => { event.preventDefault(); pressLane(lane.lane); }} className={`relative overflow-hidden rounded-card-md border bg-gradient-to-b from-white/[0.06] to-white/[0.01] transition-[border-color,background-color,transform] duration-75 touch-manipulation focus:outline-none focus:ring-2 focus:ring-gold disabled:cursor-default ${positiveHit ? 'scale-[0.985] border-brand-primary bg-brand-primary/20 shadow-[inset_0_0_32px_rgba(255,107,53,.45)]' : negativeHit ? 'scale-[0.97] border-danger bg-danger/25 shadow-[inset_0_0_36px_rgba(244,63,94,.55)]' : 'border-white/10'}`} aria-label={`${lane.key} 레인`}>
          <span className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-pill border border-white/20 bg-black/40 px-3 py-1 font-display text-xl text-white">{lane.key}</span>
          <span className="absolute bottom-[18%] left-2 right-2 h-1 rounded-pill bg-gold/70 shadow-[0_0_18px_rgba(250,204,21,.8)]" />
          {laneSignals.map((signal) => {
            const progress = Math.min(1.08, Math.max(-0.1, (view.elapsedMs - signal.spawnMs) / signal.travelMs));
            return <span key={signal.signalIndex} className={`absolute left-1/2 z-[5] flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border-2 text-lg shadow-lg transition-none sm:h-12 sm:w-12 ${signal.signalKind === 'NO_GO' ? 'border-danger bg-danger/30 text-danger' : 'border-brand-primary bg-brand-primary/25 text-white'}`} style={{ top: `${Math.max(3, progress * 76)}%` }}>{signal.signalKind === 'NO_GO' ? '✕' : '●'}</span>;
          })}
        </button>;
      })}
      {view.combo > 0 && !feedbackVisible && <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-center"><div className="font-display text-5xl text-gold/80">{view.combo}</div><div className="text-xs font-black tracking-[0.2em] text-gold/70">COMBO</div></div>}
      {feedbackVisible && feedback && <JudgementOverlay key={feedback.id} judgement={feedback} combo={view.combo} />}
      {recentLifeLoss && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-danger/20"><div className="animate-pulse rounded-card-md border border-danger/80 bg-danger/90 px-5 py-3 text-center text-white shadow-[0_0_36px_rgba(244,63,94,.8)]"><div className="font-display text-3xl">LIFE -1</div><div className="mt-1 text-xs font-black">콤보가 초기화되었습니다</div></div></div>}
      {view.elapsedMs <= view.recoveryUntil && <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center bg-danger/10 pb-8"><span className="rounded-pill bg-danger px-4 py-2 text-sm font-black text-white">회복 중 · 잠시 입력할 수 없어요</span></div>}
      {phase === 'SUBMITTING' && <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg-deep/80 p-6 text-center"><div><div className="text-4xl animate-pulse">📡</div><h2 className="mt-3 font-display text-2xl text-gold">게임 종료 · 기록 검증 중</h2><p className="mt-2 text-sm text-text-secondary">점수와 플레이 결과는 잠시 뒤 이 화면에서 보여드릴게요.</p></div></div>}
    </div>
    <div className="grid grid-cols-4 gap-2 bg-bg-deep p-3">{LANES.map((lane) => {
      const laneWasJudged = feedbackVisible && feedback?.lane === lane.lane;
      const hitClass = laneWasJudged ? (feedback?.lifeLost ? 'border-danger bg-danger/20 text-danger' : 'border-brand-primary bg-brand-primary/15 text-brand-primary') : 'border-line bg-bg-card text-white';
      return <button key={lane.key} type="button" disabled={phase !== 'PLAYING'} onPointerDown={(event) => { event.preventDefault(); pressLane(lane.lane); }} className={`rounded-card-md border py-3 font-display text-lg transition duration-75 active:scale-95 active:border-gold disabled:cursor-default ${hitClass}`} aria-label={`${lane.key} 입력`}>{lane.key}</button>;
    })}</div>
    <p className="px-4 pb-4 text-center text-xs text-text-secondary">파란 신호는 같은 레인을 누르고, 빨간 ✕ 신호는 누르지 마세요. Life가 모두 사라지면 서버에 {bootstrap.is_prerelease_test ? '테스트 기록' : '공식 기록'}을 제출합니다.</p>
  </section>;
}

function JudgementOverlay({ judgement, combo }: { judgement: FocusJudgement; combo: number }) {
  const display: Record<FocusJudgement['kind'], { label: string; className: string }> = {
    PERFECT: { label: 'PERFECT!', className: 'text-gold drop-shadow-[0_0_22px_rgba(250,204,21,.9)]' },
    GREAT: { label: 'GREAT!', className: 'text-brand-primary drop-shadow-[0_0_22px_rgba(255,107,53,.9)]' },
    GOOD: { label: 'GOOD', className: 'text-white' },
    MISS: { label: 'MISS', className: 'text-danger' },
    NO_GO: { label: 'NO GO!', className: 'text-danger' },
    WRONG: { label: 'WRONG KEY', className: 'text-danger' },
  };
  const item = display[judgement.kind];
  return <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-center">
    <div className="animate-pulse">
      <div className={`font-display text-3xl tracking-wide sm:text-4xl ${item.className}`}>{item.label}</div>
      {judgement.lifeLost ? <div className="mt-1 text-sm font-black text-danger">라이프를 잃었어요</div> : <><div className="mt-1 font-display text-xl text-white sm:text-2xl">{combo} COMBO</div><div className="mt-1 text-xs font-black text-text-secondary">+{judgement.awardedPoints ?? 0}</div></>}
    </div>
  </div>;
}

function GameResultPanel({ bootstrap, result, summary, myRank, myBestScore, isRankingUpdating, onExit }: { bootstrap: ArcadeRunBootstrap; result: ArcadeRunSubmissionResult; summary: FocusPlaySummary; myRank: number | null; myBestScore: number | null; isRankingUpdating: boolean; onExit: () => void }) {
  const accepted = result.accepted;
  const hasOfficialScore = accepted && result.official_score !== undefined && result.official_score !== null;
  const serverCorrectInputs = Number(result.stats?.correct_inputs ?? 0);
  const localAndServerDisagree = accepted && serverCorrectInputs !== summary.correct;
  return <section className={`glass-card overflow-hidden border ${accepted ? 'border-success/40' : 'border-warning/40'}`}>
    <div className={`p-6 text-center ${accepted ? 'bg-success/10' : 'bg-warning/10'}`}>
      <div className="text-5xl">{accepted ? '🏁' : '⚠️'}</div>
      <h2 className={`mt-3 font-display text-3xl ${accepted ? 'text-success' : 'text-warning'}`}>{accepted ? '게임 종료!' : '기록이 인정되지 않았어요'}</h2>
      <p className="mt-2 text-sm text-text-secondary">{accepted ? (bootstrap.is_prerelease_test ? '사전 테스트 결과입니다. 순위와 Guild 2 점수에는 반영되지 않아요.' : '서버가 다시 계산한 공식 결과입니다.') : result.message ?? '입력 기록 검증 결과를 확인해주세요.'}</p>
    </div>
    <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <ResultStat label="공식 점수" value={hasOfficialScore ? `${Number(result.official_score).toLocaleString('ko-KR')}점` : '기록 거절'} emphasis={hasOfficialScore} />
      <ResultStat label="플레이 시간" value={formatSummaryTime(result.official_duration_ms ?? summary.durationMs)} />
      <ResultStat label="최대 콤보" value={`${Number(result.stats?.max_combo ?? summary.maxCombo)} Combo`} />
      <ResultStat label="서버 인정 입력" value={`${serverCorrectInputs}회`} />
    </div>
    <div className="mx-5 rounded-card-md border border-line bg-bg-deep p-4 text-center">
      {bootstrap.is_prerelease_test ? <p className="text-sm font-bold text-brand-primary">사전 테스트는 랭킹을 계산하지 않습니다.</p> : isRankingUpdating ? <p className="text-sm text-text-secondary">현재 순위를 계산하고 있어요...</p> : <p className="text-sm text-text-secondary">현재 내 순위 <b className="ml-1 font-display text-2xl text-gold">{myRank === null ? '집계 중' : `${myRank}위`}</b>{myBestScore !== null && <span className="ml-3">내 최고점 <b className="text-white">{myBestScore.toLocaleString('ko-KR')}점</b></span>}</p>}
    </div>
    {localAndServerDisagree && <div className="mx-5 mt-4 rounded-card-md border border-warning/40 bg-warning/10 p-3 text-center text-xs text-warning">화면 판정은 {summary.correct}회였지만 서버는 {serverCorrectInputs}회만 인정했습니다. 사전 테스트 여부와 무관한 검증 차이이므로, 이 안내가 보이면 결과 화면을 캡처해 알려주세요.</div>}
    <div className="grid gap-2 px-5 pt-4 text-xs text-text-secondary sm:grid-cols-3"><span>Miss {Number(result.stats?.misses ?? summary.misses)}</span><span>NO GO 오입력 {Number(result.stats?.no_go_errors ?? summary.noGoErrors)}</span><span>잘못된 레인 {Number(result.stats?.wrong_lane_errors ?? summary.wrongLaneErrors)}</span></div>
    <div className="p-5 text-center"><button className="btn-primary min-w-48" onClick={onExit}>결과 확인 완료</button></div>
  </section>;
}

function ResultStat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className="rounded-card-md border border-line bg-bg-deep p-3 text-center"><div className="text-[11px] font-black text-text-muted">{label}</div><div className={`mt-1 font-display text-xl ${emphasis ? 'text-gold' : 'text-white'}`}>{value}</div></div>;
}

function formatSummaryTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
