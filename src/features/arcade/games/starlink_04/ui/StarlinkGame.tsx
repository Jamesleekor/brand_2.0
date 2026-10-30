import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { arcadeErrorMessage, arcadeStudentRpc, type ArcadeRunBootstrap, type ArcadeRunSubmissionResult } from '@/lib/rpc/arcade_rpc';
import { supabase } from '@/lib/supabase/client';
import { parseStarlinkRules } from '../starlinkRules';
import { canCloseStarlinkLoop } from '../starlinkPath';
import { nextStarlinkComboCount, scoreStarlinkLoopClear, scoreStarlinkNormalClear } from '../starlinkScoring';
import { StarlinkInputRecorder } from '../starlinkInputRecorder';
import { cellsAlongSegment, hitCellAt, toBoardLocal, type StarlinkLocalPoint } from '../starlinkPointer';
import type { StarlinkInputEvent, StarlinkRuntimeState } from '../starlinkRuntime';
import { StarlinkRenderer, STARLINK_STAR_STYLES } from './starlinkRenderer';

export interface StarlinkPlaySummary {
  durationMs: number;
  previewScore: number;
  maxCombo: number;
  maxLinkLength: number;
  loopCount: number;
  totalRemovedStars: number;
  reshuffleCount: number;
}

type Phase = 'COUNTDOWN' | 'STARTING' | 'PLAYING' | 'SUBMITTING' | 'RESULT' | 'ERROR';

interface Props {
  bootstrap: ArcadeRunBootstrap;
  myRank: number | null;
  myBestScore: number | null;
  isRankingUpdating: boolean;
  onRecorded: (result: ArcadeRunSubmissionResult, summary: StarlinkPlaySummary) => void;
  onExit: () => void;
  onInlineError: (message: string) => void;
}

interface Hud { score: number; combo: number; remainingMs: number; preview: string | null; loopClosed: boolean; reshuffling: boolean }
interface Payload { events: StarlinkInputEvent[]; endWallMs: number; summary: StarlinkPlaySummary }

const HIT_INSET = 0.10;
const MAX_BOARD_PX = 560;

function summaryOf(state: StarlinkRuntimeState): StarlinkPlaySummary {
  return {
    durationMs: 60_000,
    previewScore: state.score,
    maxCombo: state.stats.maxCombo,
    maxLinkLength: state.stats.maxLinkLength,
    loopCount: state.stats.loopCount,
    totalRemovedStars: state.stats.totalRemovedStars,
    reshuffleCount: state.stats.reshuffleCount,
  };
}

/** Display-only expected score for the current path (spec §28). */
function previewText(state: StarlinkRuntimeState): string | null {
  const path = state.path;
  if (path.currentType === null || path.path.length === 0) return null;
  const activeMs = Math.max(0, state.wallMs - state.pausedTotalMs);
  const combo = nextStarlinkComboCount(state.combo, state.lastCommitActiveMs, Math.max(activeMs, state.lastCommitActiveMs ?? 0));
  if (path.loopClosed) {
    const removed = state.board.filter((t) => t === path.currentType).length;
    return `고리 완성! 별 ${removed}개 제거 +${scoreStarlinkLoopClear(removed, combo).awardedScore.toLocaleString('ko-KR')}`;
  }
  if (path.path.length < 3) return `${path.path.length}개 연결 · 3개부터 제거`;
  return `${path.path.length}개 연결 +${scoreStarlinkNormalClear(path.path.length, combo).awardedScore.toLocaleString('ko-KR')}`;
}

export function StarlinkGame({ bootstrap, myBestScore, onRecorded, onExit, onInlineError }: Props) {
  const [phase, setPhase] = useState<Phase>('COUNTDOWN');
  const [countdown, setCountdown] = useState(5);
  const [hud, setHud] = useState<Hud>({ score: 0, combo: 0, remainingMs: 60_000, preview: null, loopClosed: false, reshuffling: false });
  const [boardPx, setBoardPx] = useState(360);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [canRetrySubmit, setCanRetrySubmit] = useState(false);
  const [serverResult, setServerResult] = useState<ArcadeRunSubmissionResult | null>(null);
  const [summary, setSummary] = useState<StarlinkPlaySummary | null>(null);
  const [wasHidden, setWasHidden] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef(new StarlinkRenderer());
  const recorderRef = useRef<StarlinkInputRecorder | null>(null);
  const nonceRef = useRef<string | null>(null);
  const startPerfRef = useRef<number | null>(null);
  const pointerRef = useRef<{ id: number; last: StarlinkLocalPoint } | null>(null);
  const fxRef = useRef<{ removing: { cells: number[]; until: number; from: number } | null; appearing: { cells: number[]; from: number } | null; lastPhase: string }>({ removing: null, appearing: null, lastPhase: 'PLAYING' });
  const payloadRef = useRef<Payload | null>(null);
  const submittingRef = useRef(false);
  const finishedRef = useRef(false);

  const elapsedNow = () => (startPerfRef.current === null ? 0 : Math.floor(performance.now() - startPerfRef.current));

  // ---- responsive square board -------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const width = wrap.clientWidth;
      const height = typeof window !== 'undefined' ? window.innerHeight - 220 : width;
      setBoardPx(Math.max(260, Math.min(MAX_BOARD_PX, width, height)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, []);

  // ---- leaving the page mid-run --------------------------------------------------
  useEffect(() => {
    if (phase !== 'PLAYING' && phase !== 'SUBMITTING' && phase !== 'STARTING') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const vis = () => { if (document.hidden) setWasHidden(true); };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('visibilitychange', vis); };
  }, [phase]);

  // ---- submit (idempotent: same payload can be re-sent safely) -------------------
  const submit = useCallback(async () => {
    const payload = payloadRef.current;
    if (!payload || !nonceRef.current || submittingRef.current) return;
    submittingRef.current = true;
    setCanRetrySubmit(false);
    setErrorText(null);
    setPhase('SUBMITTING');
    try {
      const rpc = await arcadeStudentRpc.submitStarlinkRun(supabase, {
        p_run_id: bootstrap.run_id,
        p_run_nonce: nonceRef.current,
        p_input_events: payload.events,
        p_client_end_wall_ms: payload.endWallMs,
      });
      if (rpc.success === false) {
        const expired = rpc.type === 'SERVER' && rpc.code === 'P0202';
        setErrorText(expired ? '운영국이 이 도전을 종료해서 기록을 제출할 수 없어요.' : arcadeErrorMessage(rpc));
        setCanRetrySubmit(!expired && rpc.type !== 'VALIDATION');
        setPhase('ERROR');
        onInlineError('스타링크 기록을 서버에 저장하지 못했어요.');
        return;
      }
      setServerResult(rpc.data);
      setPhase('RESULT');
      onRecorded(rpc.data, payload.summary);
    } catch {
      setErrorText('네트워크가 불안정해요. 같은 기록으로 다시 제출할 수 있어요.');
      setCanRetrySubmit(true);
      setPhase('ERROR');
    } finally {
      submittingRef.current = false;
    }
  }, [bootstrap.run_id, onInlineError, onRecorded]);

  const finish = useCallback((recorder: StarlinkInputRecorder) => {
    if (finishedRef.current) return;
    const end = recorder.submissionWallMs();
    if (end === null) return;
    finishedRef.current = true;
    pointerRef.current = null;
    const s = summaryOf(recorder.state);
    setSummary(s);
    payloadRef.current = { events: [...recorder.events], endWallMs: end, summary: s };
    void submit();
  }, [submit]);

  // ---- server PLAYING stamp → board revealed at the same moment ------------------
  const begin = useCallback(async () => {
    setPhase('STARTING');
    const rpc = await arcadeStudentRpc.beginStarlinkRun(supabase, { p_run_id: bootstrap.run_id });
    if (rpc.success === false) {
      setErrorText(arcadeErrorMessage(rpc));
      setPhase('ERROR');
      onInlineError('스타링크를 시작하지 못했어요. 준비 시간이 끝난 뒤 다시 시도해주세요.');
      return;
    }
    try {
      const rules = parseStarlinkRules(rpc.data.config);
      recorderRef.current = new StarlinkInputRecorder(Number(rpc.data.gameplay_seed), rules);
      nonceRef.current = rpc.data.run_nonce;
      startPerfRef.current = performance.now();
      setPhase('PLAYING');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '게임 규칙을 읽지 못했어요.');
      setPhase('ERROR');
    }
  }, [bootstrap.run_id, onInlineError]);

  // ---- shared 5s countdown (board stays hidden; seed does not exist client-side yet)
  useEffect(() => {
    if (phase !== 'COUNTDOWN') return;
    const started = performance.now();
    const serverRemaining = Math.max(0, new Date(bootstrap.countdown_ends_at).getTime() - Date.now());
    const waitMs = Math.max(5_200, serverRemaining + 200);
    let frame = 0;
    const tick = (now: number) => {
      setCountdown(Math.max(0, Math.ceil((waitMs - (now - started)) / 1000)));
      if (now - started < waitMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const timer = window.setTimeout(() => void begin(), waitMs);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [begin, bootstrap.countdown_ends_at, phase]);

  // ---- frame loop: clock + render ------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const px = Math.round(boardPx * dpr);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    let lastHud = 0;
    const loop = () => {
      const recorder = recorderRef.current;
      const now = performance.now();
      if (!recorder || phase === 'COUNTDOWN' || phase === 'STARTING') {
        rendererRef.current.draw(ctx, px, { board: null, path: [], pathType: null, loopClosed: false, loopReady: false, removing: null, appearing: null, veilProgress: null, timeMs: now });
        frame = requestAnimationFrame(loop);
        return;
      }
      const t = elapsedNow();
      const prevPhase = fxRef.current.lastPhase;
      const state = phase === 'PLAYING' ? recorder.tick(t) : recorder.state;
      const fx = fxRef.current;
      // settle finished → new stars fade in (only if not concealed by reshuffle)
      if (prevPhase === 'SETTLING' && state.phase === 'PLAYING' && fx.removing) {
        fx.appearing = { cells: refilledCells(fx.removing.cells), from: now };
        fx.removing = null;
      }
      if (state.phase === 'RESHUFFLING' || state.phase === 'GAME_OVER') { fx.removing = null; fx.appearing = null; }
      fx.lastPhase = state.phase;

      const path = state.path;
      const loopReady = !path.loopClosed && path.path.length >= 5 && canCloseStarlinkLoop(path);
      const removing = state.phase === 'SETTLING' && fx.removing ? { cells: fx.removing.cells, progress: Math.min(1, (now - fx.removing.from) / 200) } : null;
      const appearing = fx.appearing ? { cells: fx.appearing.cells, progress: Math.min(1, (now - fx.appearing.from) / 120) } : null;
      if (appearing && appearing.progress >= 1) fx.appearing = null;
      const concealed = state.phase === 'RESHUFFLING';
      const veil = concealed && state.reshuffleUntilWallMs !== null ? Math.min(1, Math.max(0, 1 - (state.reshuffleUntilWallMs - t) / 350)) : null;
      rendererRef.current.draw(ctx, px, {
        board: concealed ? null : state.board,
        path: path.path,
        pathType: path.currentType,
        loopClosed: path.loopClosed,
        loopReady,
        removing,
        appearing,
        veilProgress: veil,
        timeMs: now,
      });

      if (now - lastHud > 90 || state.phase === 'GAME_OVER') {
        lastHud = now;
        const remainingMs = state.phase === 'GAME_OVER' ? 0 : Math.max(0, 60_000 - Math.max(0, (concealed ? (state.reshuffleUntilWallMs ?? t) - 350 : t) - state.pausedTotalMs));
        setHud({ score: state.score, combo: state.combo, remainingMs, preview: previewText(state), loopClosed: path.loopClosed, reshuffling: concealed });
      }
      if (state.phase === 'GAME_OVER' && phase === 'PLAYING') finish(recorder);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [boardPx, finish, phase]);

  // ---- pointer input (first pointer only; math hit-test on board-local coords) ----
  const rectOf = () => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const loopCloseCell = (recorder: StarlinkInputRecorder) => {
    const p = recorder.state.path;
    return !p.loopClosed && p.path.length >= 5 && canCloseStarlinkLoop(p) ? p.path[0] : null;
  };
  const noteCommit = (recorder: StarlinkInputRecorder, before: number) => {
    const state = recorder.state;
    if (state.clears.length > before && state.pendingRemovedCells) {
      fxRef.current.removing = { cells: [...state.pendingRemovedCells], until: performance.now() + 200, from: performance.now() };
    }
  };
  const feedPoint = (recorder: StarlinkInputRecorder, point: StarlinkLocalPoint, t: number) => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    const rect = rectOf();
    if (!recorder.pathActive) {
      const cell = hitCellAt(point, rect, { insetRatio: HIT_INSET, loopCloseCell: null });
      if (cell !== null) recorder.pathStart(t, cell);
    } else {
      for (const cell of cellsAlongSegment(pointer.last, point, rect, { insetRatio: HIT_INSET, loopCloseCell: loopCloseCell(recorder) })) {
        recorder.cellEnter(t, cell);
      }
    }
    pointer.last = point;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const recorder = recorderRef.current;
    if (phase !== 'PLAYING' || !recorder || pointerRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rectOf();
    const point = toBoardLocal(event.clientX, event.clientY, rect);
    pointerRef.current = { id: event.pointerId, last: point };
    const cell = hitCellAt(point, rect, { insetRatio: HIT_INSET, loopCloseCell: null });
    if (cell !== null) recorder.pathStart(elapsedNow(), cell);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const recorder = recorderRef.current;
    if (!recorder || pointerRef.current?.id !== event.pointerId || phase !== 'PLAYING') return;
    const rect = rectOf();
    const native = event.nativeEvent as PointerEvent;
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const t = elapsedNow();
    for (const sample of samples.length ? samples : [native]) feedPoint(recorder, toBoardLocal(sample.clientX, sample.clientY, rect), t);
  };
  const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>, kind: 'release' | 'cancel') => {
    const recorder = recorderRef.current;
    if (!recorder || pointerRef.current?.id !== event.pointerId) return;
    pointerRef.current = null;
    const before = recorder.state.clears.length;
    if (kind === 'release') recorder.release(elapsedNow()); else recorder.cancel(elapsedNow());
    noteCommit(recorder, before);
  };

  // ---- view ------------------------------------------------------------------------
  const seconds = (hud.remainingMs / 1000).toFixed(1);
  const urgent = hud.remainingMs <= 10_000 && phase === 'PLAYING';
  const finalScore = serverResult?.accepted ? Number(serverResult.official_score ?? 0) : summary?.previewScore ?? 0;
  const isVerification = bootstrap.run_context === 'VERIFICATION';
  const newPb = serverResult?.accepted && !isVerification && !bootstrap.is_prerelease_test && myBestScore !== null && finalScore > myBestScore;

  return <section className="glass-card overflow-hidden border-indigo-300/30 p-3 sm:p-4" style={{ overscrollBehavior: 'contain' }}>
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs font-black tracking-[0.18em] text-indigo-100">STARLINK · 천공의 성좌판{isVerification ? ' · 기록 인증' : bootstrap.is_prerelease_test ? ' · 사전 테스트' : ''}</div>
      {phase !== 'PLAYING' && phase !== 'SUBMITTING' && phase !== 'STARTING' && <button className="btn-secondary text-xs" onClick={onExit}>Arcade로 돌아가기</button>}
    </div>

    <div className="mx-auto mt-3 grid max-w-[560px] grid-cols-3 gap-2 text-center">
      <div className="rounded-card-md border border-amber-200/30 bg-[#0b0f2a] p-2"><div className="text-[10px] font-black text-amber-100">점수</div><div className="font-display text-2xl text-white tabular-nums">{hud.score.toLocaleString('ko-KR')}</div></div>
      <div className="rounded-card-md border border-sky-200/30 bg-[#0b0f2a] p-2"><div className="text-[10px] font-black text-sky-100">시간</div><div className={`font-display text-2xl tabular-nums ${urgent ? 'text-rose-300' : 'text-white'} ${hud.remainingMs <= 5_000 && phase === 'PLAYING' ? 'animate-pulse' : ''}`}>{seconds}</div></div>
      <div className="rounded-card-md border border-fuchsia-200/30 bg-[#0b0f2a] p-2"><div className="text-[10px] font-black text-fuchsia-100">COMBO</div><div className="font-display text-2xl text-white tabular-nums">{hud.combo >= 2 ? `x${hud.combo}` : '—'}</div></div>
    </div>

    <div ref={wrapRef} className="mx-auto mt-3 w-full max-w-[560px]">
      <div className="relative mx-auto select-none" style={{ width: boardPx, height: boardPx }}>
        <canvas
          ref={canvasRef}
          aria-label="스타링크 성좌판"
          className="block rounded-[20px]"
          style={{ width: boardPx, height: boardPx, touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e: ReactPointerEvent<HTMLCanvasElement>) => endPointer(e, 'release')}
          onPointerCancel={(e: ReactPointerEvent<HTMLCanvasElement>) => endPointer(e, 'cancel')}
          onLostPointerCapture={(e: ReactPointerEvent<HTMLCanvasElement>) => endPointer(e, 'cancel')}
          onContextMenu={(e: { preventDefault(): void }) => e.preventDefault()}
        />
        {(phase === 'COUNTDOWN' || phase === 'STARTING') && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-[20px] bg-[#070a1f]/70">
          <div className="text-sm font-black tracking-[0.3em] text-indigo-100">READY</div>
          <div className="mt-2 font-display text-7xl text-white">{phase === 'STARTING' || countdown === 0 ? 'START!' : countdown}</div>
          <p className="mt-3 text-xs font-bold text-indigo-100">별이 나타나면 같은 별을 손가락으로 이어 보세요</p>
        </div>}
        {hud.reshuffling && phase === 'PLAYING' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rounded-pill bg-[#1b1550]/90 px-4 py-2 font-display text-xl text-amber-100">별 재배치!</span></div>}
        {hud.loopClosed && phase === 'PLAYING' && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-pill bg-[#1b1550]/90 px-3 py-1 text-sm font-black text-amber-100">고리 완성!</div>}
        {phase === 'SUBMITTING' && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-[20px] bg-[#070a1f]/75"><div className="font-display text-3xl text-white">시간 종료!</div><div className="mt-2 text-sm font-bold text-indigo-100">서버가 기록을 다시 계산하고 있어요…</div></div>}
      </div>
    </div>

    <div className="mx-auto mt-2 min-h-[24px] max-w-[560px] text-center text-sm font-black text-amber-100">{phase === 'PLAYING' ? (hud.preview ?? '같은 별 3개 이상 · 고유 별 5개 이상으로 둘러싸면 고리') : ''}</div>
    {wasHidden && phase === 'PLAYING' && <p className="mx-auto mt-1 max-w-[560px] text-center text-xs font-bold text-rose-200">화면을 벗어난 동안에도 시간이 흘렀어요.</p>}

    {phase === 'ERROR' && <div className="mx-auto mt-3 max-w-[560px] rounded-card-md border border-rose-300/40 bg-rose-500/10 p-3 text-sm font-bold text-rose-100">
      {errorText ?? '문제가 생겼어요.'}
      {canRetrySubmit && payloadRef.current && <button className="btn-primary mt-3 w-full" onClick={() => void submit()}>같은 기록으로 다시 제출</button>}
    </div>}

    {phase === 'RESULT' && summary && <div className="mx-auto mt-3 max-w-[560px] rounded-card-md border border-amber-200/40 bg-[#0b0f2a] p-4 text-center">
      <div className="font-display text-2xl text-white">시간 종료!</div>
      {newPb && <div className="mt-1 text-sm font-black text-amber-200">개인 최고기록 갱신!</div>}
      <div className="mt-2 text-xs font-black text-amber-100">점수</div>
      <div className="font-display text-4xl text-amber-100 tabular-nums">{finalScore.toLocaleString('ko-KR')}</div>
      {serverResult && !serverResult.accepted && <p className="mt-2 text-xs font-bold text-rose-200">{serverResult.message ?? '공식 기록으로 인정되지 않았어요.'}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs sm:grid-cols-4">
        <Stat label="최장 연결" value={`${summary.maxLinkLength}개`} />
        <Stat label="MAX COMBO" value={String(summary.maxCombo)} />
        <Stat label="고리 완성" value={`${summary.loopCount}회`} />
        <Stat label="제거한 별" value={`${summary.totalRemovedStars}개`} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2"><button className="btn-primary" onClick={onExit}>다시 도전</button><button className="btn-secondary" onClick={onExit}>Arcade로 돌아가기</button></div>
    </div>}

    <div className="mx-auto mt-3 flex max-w-[560px] flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] font-bold text-indigo-100">
      {STARLINK_STAR_STYLES.map((style) => <span key={style.name} style={{ color: style.light }}>● {style.name}</span>)}
    </div>
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md border border-indigo-200/20 bg-[#121845] p-2"><div className="text-[10px] font-black text-indigo-100">{label}</div><div className="font-display text-lg text-white">{value}</div></div>;
}

/** After gravity the new stars occupy the top k cells of each column (k = removed in that column). */
function refilledCells(removed: readonly number[]): number[] {
  const perCol = new Array<number>(7).fill(0);
  for (const cell of removed) perCol[cell % 7] += 1;
  const out: number[] = [];
  perCol.forEach((count, col) => { for (let row = 0; row < count; row += 1) out.push(row * 7 + col); });
  return out;
}
