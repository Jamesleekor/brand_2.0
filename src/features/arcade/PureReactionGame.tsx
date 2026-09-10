import { useCallback, useEffect, useRef, useState } from 'react';
import { arcadeStudentRpc, type ArcadeRunBootstrap, type ArcadeRunSubmissionResult } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';
import {
  advancePureReactionRuntime,
  createPureReactionRuntime,
  formatReactionAverage,
  generatePureReactionWaits,
  parsePureReactionConfig,
  pureReactionSummary,
  recordPureReactionInput,
  type PureReactionGameConfig,
  type PureReactionOutcome,
  type PureReactionRuntime,
} from '@/features/arcade/pure_reaction_engine';

export interface PureReactionPlaySummary {
  durationMs: number;
  reactions: number[];
  outcome: PureReactionOutcome;
  averageReactionMsX10: number | null;
  previewScore: number | null;
}

type OuterPhase = 'COUNTDOWN' | 'STARTING' | 'PLAYING' | 'SUBMITTING' | 'RESULT' | 'ERROR';

interface Props {
  bootstrap: ArcadeRunBootstrap;
  myRank: number | null;
  myBestScore: number | null;
  isRankingUpdating: boolean;
  onRecorded: (result: ArcadeRunSubmissionResult, summary: PureReactionPlaySummary) => void;
  onExit: () => void;
  onInlineError: (message: string) => void;
}

export function PureReactionGame({ bootstrap, myRank, myBestScore, isRankingUpdating, onRecorded, onExit, onInlineError }: Props) {
  const [outerPhase, setOuterPhase] = useState<OuterPhase>('COUNTDOWN');
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const [version, setVersion] = useState(0);
  const [serverResult, setServerResult] = useState<ArcadeRunSubmissionResult | null>(null);
  const runtimeRef = useRef<PureReactionRuntime | null>(null);
  const configRef = useRef<PureReactionGameConfig | null>(null);
  const waitsRef = useRef<number[]>([]);
  const startedRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const captureSummary = useCallback((runtime: PureReactionRuntime): PureReactionPlaySummary => {
    const calc = pureReactionSummary(runtime.reactions);
    return { durationMs: runtime.gameOverElapsedMs ?? 0, reactions: [...runtime.reactions], outcome: runtime.outcome ?? 'REACTION_TIMEOUT', averageReactionMsX10: runtime.reactions.length === 5 ? calc.averageReactionMsX10 : null, previewScore: calc.score };
  }, []);

  const submit = useCallback(async (runtime: PureReactionRuntime) => {
    if (submittedRef.current || runtime.gameOverElapsedMs === null) return;
    submittedRef.current = true;
    const summary = captureSummary(runtime);
    setOuterPhase('SUBMITTING');
    const rpc = await arcadeStudentRpc.submitPureReactionRun(supabase, {
      p_run_id: bootstrap.run_id,
      p_input_events: runtime.inputEvents,
      p_client_game_over_elapsed_ms: runtime.gameOverElapsedMs,
    });
    if (!rpc.success) {
      setOuterPhase('ERROR');
      onInlineError('반응속도 기록을 서버에서 확인하지 못했습니다. 선생님에게 알려주세요.');
      return;
    }
    setServerResult(rpc.data);
    setOuterPhase('RESULT');
    onRecorded(rpc.data, summary);
  }, [bootstrap.run_id, captureSummary, onInlineError, onRecorded]);

  const begin = useCallback(async () => {
    setOuterPhase('STARTING');
    const rpc = await arcadeStudentRpc.beginRun(supabase, { p_run_id: bootstrap.run_id });
    if (!rpc.success) {
      setOuterPhase('ERROR');
      onInlineError('게임을 시작하지 못했습니다. 준비 시간이 끝난 뒤 다시 시도해주세요.');
      return;
    }
    try {
      const config = parsePureReactionConfig(rpc.data.config);
      const waits = generatePureReactionWaits(rpc.data.schedule_seed, config);
      configRef.current = config;
      waitsRef.current = waits;
      runtimeRef.current = createPureReactionRuntime(waits);
      startedRef.current = performance.now();
      setVersion((value) => value + 1);
      setOuterPhase('PLAYING');
    } catch (error) {
      setOuterPhase('ERROR');
      onInlineError(error instanceof Error ? error.message : '게임 규칙을 읽을 수 없습니다.');
    }
  }, [bootstrap.run_id, onInlineError]);

  useEffect(() => {
    if (outerPhase !== 'COUNTDOWN') return;
    const localStartedAt = performance.now();
    const serverRemaining = Math.max(0, new Date(bootstrap.countdown_ends_at).getTime() - Date.now());
    const waitMs = Math.max(5_200, serverRemaining + 200);
    let frame = 0;
    const tick = (now: number) => {
      const remaining = Math.max(0, waitMs - (now - localStartedAt));
      setCountdownSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      if (remaining > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const timer = window.setTimeout(() => void begin(), waitMs);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [bootstrap.countdown_ends_at, begin, outerPhase]);

  useEffect(() => {
    if (outerPhase !== 'PLAYING') return;
    let frame = 0;
    const tick = (now: number) => {
      const runtime = runtimeRef.current;
      const config = configRef.current;
      const started = startedRef.current;
      if (!runtime || !config || started === null) return;
      advancePureReactionRuntime(runtime, config, waitsRef.current, Math.floor(now - started));
      setVersion((value) => value + 1);
      if (runtime.gameOverElapsedMs !== null) { void submit(runtime); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [outerPhase, submit]);

  const input = useCallback((source: 'SPACE' | 'POINTER') => {
    if (outerPhase !== 'PLAYING') return;
    const runtime = runtimeRef.current;
    const config = configRef.current;
    const started = startedRef.current;
    if (!runtime || !config || started === null) return;
    const elapsedMs = Math.floor(performance.now() - started);
    recordPureReactionInput(runtime, config, waitsRef.current, elapsedMs, source);
    setVersion((value) => value + 1);
    if (runtime.gameOverElapsedMs !== null) void submit(runtime);
  }, [outerPhase, submit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || outerPhase !== 'PLAYING') return;
      event.preventDefault();
      input('SPACE');
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [input, outerPhase]);

  const runtime = runtimeRef.current;
  const displayPhase = runtime?.phase ?? 'TRIAL_WAITING';
  const isGo = outerPhase === 'PLAYING' && displayPhase === 'GO_ACTIVE';
  const isFeedback = outerPhase === 'PLAYING' && displayPhase === 'TRIAL_FEEDBACK';
  const trial = Math.min(5, (runtime?.trialIndex ?? 0) + 1);
  void version;

  if (outerPhase === 'COUNTDOWN' || outerPhase === 'STARTING') return <section className="glass-card p-8 text-center"><div className="text-xs font-black tracking-[0.2em] text-brand-primary">PURE REACTION #02</div><div className="mt-5 font-display text-7xl text-gold">{outerPhase === 'STARTING' ? 'GO' : countdownSeconds}</div><h2 className="mt-4 font-display text-2xl text-white">마력핵 동기화 중</h2><p className="mt-2 text-sm text-text-secondary">빛이 폭발하는 순간 Space 또는 화면을 누르세요. 미리 누르면 즉시 실격입니다.</p></section>;

  if (outerPhase === 'RESULT' && serverResult) return <PureReactionResult bootstrap={bootstrap} result={serverResult} summary={captureSummary(runtime!)} myRank={myRank} myBestScore={myBestScore} isRankingUpdating={isRankingUpdating} onExit={onExit} />;
  if (outerPhase === 'ERROR') return <section className="glass-card border-danger/40 p-6 text-center"><div className="text-4xl">⚠️</div><h2 className="mt-3 font-display text-2xl text-danger">기록 확인 오류</h2><button className="btn-secondary mt-5" onClick={onExit}>Arcade로 돌아가기</button></section>;

  return <section className="glass-card overflow-hidden border-brand-primary/30 select-none">
    <div className="flex items-center justify-between border-b border-line bg-bg-deep px-4 py-3"><div><div className="text-[10px] font-black tracking-[0.18em] text-brand-primary">PURE REACTION</div><div className="font-display text-lg text-white">TRIAL {trial} / 5</div></div><div className="flex gap-1">{Array.from({ length: 5 }, (_, i) => <span key={i} className={`text-lg ${i < (runtime?.reactions.length ?? 0) ? 'text-success' : i === runtime?.trialIndex ? 'text-gold' : 'text-text-muted'}`}>●</span>)}</div></div>
    <button type="button" disabled={outerPhase !== 'PLAYING' || isFeedback} onPointerDown={(event) => { event.preventDefault(); input('POINTER'); }} className="relative flex h-[430px] w-full touch-manipulation items-center justify-center overflow-hidden bg-slate-950 focus:outline-none disabled:cursor-default" aria-label="반응 입력 영역">
      <div className={`absolute h-72 w-72 rounded-full border transition-none ${isGo ? 'border-white/90 bg-white/10 shadow-[0_0_120px_40px_rgba(255,255,255,.35)]' : 'border-violet-500/30 bg-violet-950/20 shadow-[0_0_55px_rgba(139,92,246,.15)]'}`} />
      <div className={`absolute h-56 w-56 rounded-full border-2 transition-none ${isGo ? 'scale-110 border-cyan-100 bg-cyan-300/20 shadow-[0_0_75px_25px_rgba(103,232,249,.65)]' : 'border-violet-400/35 bg-violet-900/10'}`} />
      <div className={`absolute h-40 w-40 rotate-45 border-2 transition-none ${isGo ? 'border-white bg-white/15 shadow-[0_0_70px_rgba(255,255,255,.8)]' : 'border-violet-400/25'}`} />
      <div className={`relative z-10 flex h-28 w-28 items-center justify-center rounded-full border-2 font-display transition-none ${isGo ? 'scale-110 border-white bg-cyan-100 text-slate-950 shadow-[0_0_55px_20px_rgba(255,255,255,.85)]' : 'border-violet-400/50 bg-slate-950 text-violet-300'}`}>{isGo ? <span className="text-2xl">IGNITE!</span> : <span className="text-xs tracking-[.2em]">WAIT</span>}</div>
      {isFeedback && runtime?.lastReactionMs !== null && <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60"><div className="font-display text-6xl text-gold">{runtime.lastReactionMs} ms</div></div>}
      {outerPhase === 'SUBMITTING' && <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg-deep/90"><div className="text-center"><div className="text-4xl animate-pulse">📡</div><h2 className="mt-3 font-display text-2xl text-gold">기록 검증 중</h2><p className="mt-2 text-sm text-text-secondary">서버가 5회 반응과 부정 출발 여부를 다시 계산합니다.</p></div></div>}
    </button>
    <div className="bg-bg-deep px-4 py-3 text-center text-xs text-text-secondary">Space 또는 화면 터치 · 신호 위치는 항상 고정 · 소리 신호 없음 · 피드백 중 입력은 무시됩니다.</div>
  </section>;
}

function PureReactionResult({ bootstrap, result, summary, myRank, myBestScore, isRankingUpdating, onExit }: { bootstrap: ArcadeRunBootstrap; result: ArcadeRunSubmissionResult; summary: PureReactionPlaySummary; myRank: number | null; myBestScore: number | null; isRankingUpdating: boolean; onExit: () => void }) {
  const accepted = result.accepted;
  const averageX10 = accepted ? Number(result.stats?.average_reaction_ms_x10 ?? summary.averageReactionMsX10 ?? 0) : null;
  const trials = accepted && Array.isArray(result.stats?.trial_reaction_ms) ? (result.stats?.trial_reaction_ms as number[]) : summary.reactions;
  const title = accepted ? 'REACTION COMPLETE' : result.code === 'REACTION_TIMEOUT' ? '반응 실패 · GAME OVER' : '⚠ FALSE START · GAME OVER';
  return <section className={`glass-card overflow-hidden border ${accepted ? 'border-success/40' : 'border-danger/40'}`}>
    <div className={`p-6 text-center ${accepted ? 'bg-success/10' : 'bg-danger/10'}`}><div className="text-5xl">{accepted ? '⚡' : '⚠️'}</div><h2 className={`mt-3 font-display text-3xl ${accepted ? 'text-success' : 'text-danger'}`}>{title}</h2><p className="mt-2 text-sm text-text-secondary">{accepted ? '서버가 5회의 반응 기록을 검증했습니다.' : result.message ?? '이번 도전은 공식 점수에 반영되지 않습니다.'}</p></div>
    {accepted && <><div className="grid gap-3 p-5 sm:grid-cols-2"><ResultStat label="평균 반응속도" value={formatReactionAverage(averageX10)} /><ResultStat label="SCORE" value={`${Number(result.official_score ?? 0).toLocaleString('ko-KR')}`} /></div><div className="mx-5 grid grid-cols-5 gap-2">{trials.map((value, index) => <div key={index} className="rounded-card-md border border-line bg-bg-deep p-2 text-center"><div className="text-[10px] text-text-muted">{index + 1}회</div><div className="mt-1 font-black text-white">{value} ms</div></div>)}</div><div className="mx-5 mt-4 rounded-card-md border border-line bg-bg-deep p-3 text-center text-xs text-text-secondary">{bootstrap.is_prerelease_test ? '사전 테스트 기록은 랭킹에 반영되지 않습니다.' : bootstrap.run_context === 'VERIFICATION' ? '인증 도전 결과입니다.' : isRankingUpdating ? '현재 순위를 계산하고 있습니다.' : <>현재 순위 <b className="text-gold">{myRank ? `${myRank}위` : 'Top 10 밖'}</b>{myBestScore !== null && <> · 내 최고 SCORE <b className="text-white">{myBestScore.toLocaleString('ko-KR')}</b></>}</>}</div></>}
    <div className="grid gap-2 p-5 sm:grid-cols-2"><button className="btn-primary" onClick={onExit}>다시 도전</button><button className="btn-secondary" onClick={onExit}>Arcade로 돌아가기</button></div>
  </section>;
}

function ResultStat({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep p-4 text-center"><div className="text-[11px] font-black text-text-muted">{label}</div><div className="mt-1 font-display text-3xl text-gold">{value}</div></div>; }
