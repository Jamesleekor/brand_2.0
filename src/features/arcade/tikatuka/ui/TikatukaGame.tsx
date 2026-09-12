import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chooseAdvancedAIAction } from '../ai';
import {
  AI_SKILL_PROFILE,
  PLAYER_HOLD_CHARGES,
  PLAYER_TAZZA_CHARGES,
  SeededRandomSource,
  calculateBoardScore,
  calculateRowScore,
  canHold,
  canUseTazza,
  createInitialTikatukaState,
  dispatchTikatukaAction,
  getLegalPlacements,
  type Die,
  type Difficulty,
  type EngineDependencies,
  type GameAction,
  type GameEvent,
  type GameState,
  type Placement,
  type RowId,
  type Side,
} from '../engine';
import {
  createTikatukaSubmissionInput,
  getTikatukaDefaultDifficulty,
  isTikatukaDifficultyCleared,
  isTikatukaDifficultyUnlocked,
} from '../progress/submission';
import {
  difficultyLabel,
  getAiThinkingDelayRange,
  getEventPresentation,
  type TikatukaEventPresentation,
} from './presentation';
import { tikatukaRpcErrorMessage, tikatukaStudentRpc } from '@/lib/rpc/tikatuka_rpc';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import type { TikatukaProgress, TikatukaSubmissionResponse } from '@/lib/zod_schemas/tikatuka_schemas';

const DIFFICULTIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const satisfies readonly Difficulty[];
const ROWS = ['top', 'middle', 'bottom'] as const satisfies readonly RowId[];

interface TikatukaGameProps {
  onExit: () => void;
}

interface ActiveAnimation {
  event: GameEvent;
  presentation: TikatukaEventPresentation;
}

function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] === 0 ? 1 : buffer[0];
}

function randomUiInt(minInclusive: number, maxInclusive: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + (buffer[0] % span);
}

function createProductionDependencies(gameId: string): EngineDependencies {
  let dieCounter = 0;
  return {
    gameRng: new SeededRandomSource(randomSeed()),
    aiRng: new SeededRandomSource(randomSeed()),
    createId: () => `${gameId}-die-${++dieCounter}`,
  };
}

export function TikatukaGame({ onExit }: TikatukaGameProps) {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const progressQueryKey = useMemo(() => ['arcade', 'tikatuka', 'progress', studentId] as const, [studentId]);
  const progressQuery = useQuery({
    queryKey: progressQueryKey,
    enabled: Boolean(studentId),
    queryFn: async () => {
      const rpc = await tikatukaStudentRpc.getProgress(supabase);
      if (!rpc.success) throw new Error(tikatukaRpcErrorMessage(rpc));
      return rpc.data;
    },
    retry: 1,
  });

  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [eventQueue, setEventQueue] = useState<GameEvent[]>([]);
  const [activeAnimation, setActiveAnimation] = useState<ActiveAnimation | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<TikatukaSubmissionResponse | null>(null);
  const [gameStartHighestUnlocked, setGameStartHighestUnlocked] = useState<Difficulty | null>(null);
  const depsRef = useRef<EngineDependencies | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const aiTimerRef = useRef<number | null>(null);
  const aiScheduledRef = useRef(false);
  const progressInitializedRef = useRef(false);
  const submissionInFlightRef = useRef<string | null>(null);
  const submittedGameIdRef = useRef<string | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    progressInitializedRef.current = false;
  }, [studentId]);

  useEffect(() => {
    const progress = progressQuery.data;
    if (!progress) return;
    if (!progressInitializedRef.current || !isTikatukaDifficultyUnlocked(progress, difficulty)) {
      setDifficulty(getTikatukaDefaultDifficulty(progress));
      progressInitializedRef.current = true;
    }
  }, [difficulty, progressQuery.data]);

  const animationBusy = activeAnimation !== null || eventQueue.length > 0;

  const enqueueEvents = useCallback((events: readonly GameEvent[]) => {
    if (!events.length) return;
    setEventQueue((previous) => [...previous, ...events]);
  }, []);

  useEffect(() => {
    if (activeAnimation !== null || eventQueue.length === 0) return;
    const [next, ...rest] = eventQueue;
    setEventQueue(rest);
    setActiveAnimation({ event: next, presentation: getEventPresentation(next) });
  }, [activeAnimation, eventQueue]);

  useEffect(() => {
    if (activeAnimation === null) return undefined;
    const timer = window.setTimeout(
      () => setActiveAnimation(null),
      activeAnimation.presentation.durationMs,
    );
    return () => window.clearTimeout(timer);
  }, [activeAnimation]);

  const applyAction = useCallback((state: GameState, action: GameAction, actor: Side) => {
    const deps = depsRef.current;
    if (!deps) return;
    try {
      const transition = dispatchTikatukaAction(state, action, deps, actor);
      gameStateRef.current = transition.nextState;
      setGameState(transition.nextState);
      enqueueEvents(transition.events);
      setError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '라카루카 액션을 처리하지 못했습니다.';
      setError(message);
    }
  }, [enqueueEvents]);

  const startGame = useCallback(async (nextDifficulty: Difficulty = difficulty) => {
    if (isStarting) return;
    const progress = progressQuery.data;
    if (!studentId || !progress) {
      setError('라카루카 진행도를 불러온 뒤 게임을 시작할 수 있습니다.');
      return;
    }
    if (!isTikatukaDifficultyUnlocked(progress, nextDifficulty)) {
      setError(`Lv.${nextDifficulty}은 아직 해금되지 않았습니다.`);
      return;
    }

    setIsStarting(true);
    setError(null);
    const issued = await tikatukaStudentRpc.createGame(supabase, { p_difficulty: nextDifficulty });
    setIsStarting(false);
    if (!issued.success) {
      setError(tikatukaRpcErrorMessage(issued));
      if (issued.error.code === 'PTK03') void progressQuery.refetch();
      return;
    }

    queryClient.setQueryData(progressQueryKey, issued.data.progress);
    setGameStartHighestUnlocked(issued.data.progress.highest_unlocked_difficulty);
    if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
    aiTimerRef.current = null;
    aiScheduledRef.current = false;
    setAiThinking(false);
    setEventQueue([]);
    setActiveAnimation(null);
    setSubmission(null);
    setSubmitError(null);
    setIsSubmitting(false);
    submissionInFlightRef.current = null;
    submittedGameIdRef.current = null;

    const gameId = issued.data.game_id;
    const deps = createProductionDependencies(gameId);
    depsRef.current = deps;
    const initial = createInitialTikatukaState(gameId, nextDifficulty);
    const transition = dispatchTikatukaAction(initial, { type: 'START_GAME', difficulty: nextDifficulty }, deps, 'player');
    gameStateRef.current = transition.nextState;
    setGameState(transition.nextState);
    enqueueEvents(transition.events);
  }, [difficulty, enqueueEvents, isStarting, progressQuery, progressQueryKey, queryClient, studentId]);

  const resetToSetup = useCallback((preferHighest: boolean) => {
    if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
    aiTimerRef.current = null;
    aiScheduledRef.current = false;
    setAiThinking(false);
    setEventQueue([]);
    setActiveAnimation(null);
    setGameState(null);
    gameStateRef.current = null;
    depsRef.current = null;
    setError(null);
    setSubmission(null);
    setSubmitError(null);
    setIsSubmitting(false);
    setGameStartHighestUnlocked(null);
    submissionInFlightRef.current = null;
    submittedGameIdRef.current = null;
    if (preferHighest && progressQuery.data) setDifficulty(getTikatukaDefaultDifficulty(progressQuery.data));
  }, [progressQuery.data]);

  useEffect(() => () => {
    if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
  }, []);

  const aiDecisionKey = gameState
    ? `${gameState.turnNumber}:${gameState.turn.currentDie?.id ?? 'none'}:${gameState.turn.tazzaUsedThisTurn ? 1 : 0}:${gameState.sides.ai.skills.tazzaRemaining}:${gameState.sides.ai.skills.holdRemaining}`
    : 'idle';

  useEffect(() => {
    const state = gameStateRef.current;
    if (!state || state.phase !== 'awaiting_action' || state.currentSide !== 'ai' || animationBusy || aiScheduledRef.current) return undefined;
    const deps = depsRef.current;
    if (!deps) return undefined;

    aiScheduledRef.current = true;
    setAiThinking(true);
    const range = getAiThinkingDelayRange(state.difficulty);
    const delay = randomUiInt(range.minMs, range.maxMs);

    const timer = window.setTimeout(() => {
      aiTimerRef.current = null;
      aiScheduledRef.current = false;
      setAiThinking(false);
      const current = gameStateRef.current;
      if (!current || current.phase !== 'awaiting_action' || current.currentSide !== 'ai') return;
      try {
        const choice = chooseAdvancedAIAction(current, deps.aiRng);
        applyAction(current, choice.action, 'ai');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'AI가 수를 결정하지 못했습니다.');
      }
    }, delay);
    aiTimerRef.current = timer;

    return () => {
      if (aiTimerRef.current === timer) {
        window.clearTimeout(timer);
        aiTimerRef.current = null;
        aiScheduledRef.current = false;
        setAiThinking(false);
      }
    };
  }, [aiDecisionKey, animationBusy, applyAction]);

  const submitCompletedGame = useCallback(async (state: GameState) => {
    if (state.phase !== 'game_over' || state.result === null) return;
    if (submittedGameIdRef.current === state.gameId || submissionInFlightRef.current === state.gameId) return;

    submissionInFlightRef.current = state.gameId;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const input = createTikatukaSubmissionInput(state);
      const rpc = await tikatukaStudentRpc.submitResult(supabase, input);
      if (!rpc.success) {
        setSubmitError(tikatukaRpcErrorMessage(rpc));
        return;
      }

      submittedGameIdRef.current = state.gameId;
      setSubmission(rpc.data);
      queryClient.setQueryData(progressQueryKey, rpc.data.progress);
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : '라카루카 결과를 서버에 제출하지 못했습니다.');
    } finally {
      if (submissionInFlightRef.current === state.gameId) submissionInFlightRef.current = null;
      setIsSubmitting(false);
    }
  }, [progressQueryKey, queryClient]);

  const resultReady = Boolean(gameState?.phase === 'game_over' && gameState.result && !animationBusy && !aiThinking);
  useEffect(() => {
    if (!resultReady || !gameState || submitError || submission?.game_id === gameState.gameId) return;
    void submitCompletedGame(gameState);
  }, [gameState, resultReady, submission?.game_id, submitCompletedGame, submitError]);

  const retrySubmission = useCallback(() => {
    const state = gameStateRef.current;
    if (!state || state.phase !== 'game_over' || !state.result) return;
    setSubmitError(null);
    void submitCompletedGame(state);
  }, [submitCompletedGame]);

  const playerCanAct = Boolean(
    gameState
      && gameState.phase === 'awaiting_action'
      && gameState.currentSide === 'player'
      && !animationBusy
      && !aiThinking,
  );

  const legalPlacements = useMemo(() => {
    if (!gameState || !playerCanAct || gameState.turn.currentDie === null) return [] as Placement[];
    return getLegalPlacements(gameState, 'player', gameState.turn.currentDie);
  }, [gameState, playerCanAct]);

  const isLegalPlacement = useCallback((targetSide: Side, row: RowId) => legalPlacements.some(
    (placement) => placement.targetSide === targetSide && placement.row === row,
  ), [legalPlacements]);

  const place = useCallback((targetSide: Side, row: RowId) => {
    const state = gameStateRef.current;
    if (!state || !playerCanAct || !isLegalPlacement(targetSide, row)) return;
    applyAction(state, { type: 'PLACE_DIE', targetSide, row }, 'player');
  }, [applyAction, isLegalPlacement, playerCanAct]);

  const useTazza = useCallback(() => {
    const state = gameStateRef.current;
    if (!state || !playerCanAct || !canUseTazza(state, 'player')) return;
    applyAction(state, { type: 'USE_TAZZA' }, 'player');
  }, [applyAction, playerCanAct]);

  const hold = useCallback(() => {
    const state = gameStateRef.current;
    if (!state || !playerCanAct || !canHold(state, 'player')) return;
    applyAction(state, { type: 'HOLD' }, 'player');
  }, [applyAction, playerCanAct]);

  if (!gameState) {
    return <SetupScreen
      difficulty={difficulty}
      progress={progressQuery.data ?? null}
      progressLoading={progressQuery.isLoading || progressQuery.isFetching}
      progressError={progressQuery.isError ? (progressQuery.error instanceof Error ? progressQuery.error.message : '진행도를 불러오지 못했습니다.') : null}
      isStarting={isStarting}
      onDifficulty={setDifficulty}
      onStart={() => void startGame(difficulty)}
      onRetryProgress={() => void progressQuery.refetch()}
      onExit={onExit}
      error={error}
    />;
  }

  const showResult = gameState.phase === 'game_over' && !animationBusy && !aiThinking;
  if (showResult && gameState.result) {
    return <ResultScreen
      state={gameState}
      submission={submission}
      previousHighestUnlocked={gameStartHighestUnlocked}
      isSubmitting={isSubmitting}
      submitError={submitError}
      onRetrySubmit={retrySubmission}
      onRematch={() => void startGame(gameState.difficulty)}
      onChangeDifficulty={() => resetToSetup(true)}
      onExit={onExit}
    />;
  }

  const tazzaAvailable = playerCanAct && canUseTazza(gameState, 'player');
  const holdAvailable = playerCanAct && canHold(gameState, 'player');
  const currentDie = animationBusy ? null : gameState.turn.currentDie;

  return <section className="relative overflow-hidden rounded-card-xl border border-white/10 bg-[#090d14] shadow-2xl">
    <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_15%_15%,rgba(52,211,153,0.08),transparent_34%),radial-gradient(circle_at_85%_15%,rgba(248,113,113,0.08),transparent_34%),radial-gradient(circle_at_50%_80%,rgba(250,204,21,0.05),transparent_38%)]" />
    <div className="relative p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="text-[10px] font-black tracking-[0.22em] text-gold">TACTICAL DICE DUEL</div>
          <h2 className="mt-1 font-display text-2xl text-white">🎲 라카루카</h2>
          <p className="mt-1 text-xs text-text-secondary">Lv.{gameState.difficulty} · {difficultyLabel(gameState.difficulty)} · 서버 발급 게임</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={() => resetToSetup(false)}>난이도 변경</button>
          <button className="btn-secondary text-xs" onClick={onExit}>나가기</button>
        </div>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatusCard title="PLAYER" accent="player" score={calculateBoardScore(gameState.sides.player.board)} sideState={gameState.sides.player} />
        <TurnCenter state={gameState} currentDie={currentDie} aiThinking={aiThinking} animation={activeAnimation} />
        <StatusCard title="AI" accent="ai" score={calculateBoardScore(gameState.sides.ai.board)} sideState={gameState.sides.ai} />
      </div>

      {error && <div className="mt-3 rounded-card-md border border-danger/40 bg-danger/10 p-3 text-xs font-bold text-danger">{error}</div>}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Board title="PLAYER BOARD" side="player" state={gameState} canPlace={(row) => isLegalPlacement('player', row)} onPlace={(row) => place('player', row)} activeEvent={activeAnimation?.event ?? null} />
        <Board title="AI BOARD" side="ai" state={gameState} canPlace={(row) => isLegalPlacement('ai', row)} onPlace={(row) => place('ai', row)} activeEvent={activeAnimation?.event ?? null} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <button type="button" disabled={!tazzaAvailable} onClick={useTazza} className="rounded-card-md border border-gold/35 bg-gold/10 px-4 py-3 text-left transition enabled:hover:border-gold/70 enabled:hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-35">
          <div className="text-xs font-black text-gold">🃏 타짜의 손놀림</div>
          <div className="mt-1 text-[11px] text-text-secondary">남은 횟수 {gameState.sides.player.skills.tazzaRemaining} · 일반 주사위 1회 재굴림</div>
        </button>
        <button type="button" disabled={!holdAvailable} onClick={hold} className="rounded-card-md border border-brand-primary/35 bg-brand-primary/10 px-4 py-3 text-left transition enabled:hover:border-brand-primary/70 enabled:hover:bg-brand-primary/15 disabled:cursor-not-allowed disabled:opacity-35">
          <div className="text-xs font-black text-brand-primary">✋ HOLD</div>
          <div className="mt-1 text-[11px] text-text-secondary">남은 횟수 {gameState.sides.player.skills.holdRemaining} · 현재 주사위를 다음 자기 턴으로</div>
        </button>
        <div className="flex items-center justify-center rounded-card-md border border-line bg-bg-deep/80 px-4 py-3 text-center text-xs text-text-secondary">턴 {gameState.turnNumber}</div>
      </div>

      <div className="mt-4 rounded-card-md border border-white/10 bg-white/[0.025] p-3 text-[11px] leading-relaxed text-text-muted">
        일반 주사위는 내 보드에만 놓을 수 있습니다. 실드 주사위는 양쪽 보드의 빈 Row 어디든 놓을 수 있으며 점수와 더블/트리플에 완전히 참여합니다. 종료 결과는 서버가 최종 3×3 보드를 다시 계산한 뒤 저장합니다.
      </div>
    </div>
  </section>;
}

function SetupScreen({ difficulty, progress, progressLoading, progressError, isStarting, onDifficulty, onStart, onRetryProgress, onExit, error }: {
  difficulty: Difficulty;
  progress: TikatukaProgress | null;
  progressLoading: boolean;
  progressError: string | null;
  isStarting: boolean;
  onDifficulty: (difficulty: Difficulty) => void;
  onStart: () => void;
  onRetryProgress: () => void;
  onExit: () => void;
  error: string | null;
}) {
  const aiSkill = AI_SKILL_PROFILE[difficulty];
  const selectedUnlocked = progress ? isTikatukaDifficultyUnlocked(progress, difficulty) : false;
  return <section className="overflow-hidden rounded-card-xl border border-gold/20 bg-gradient-to-br from-[#0a111b] via-[#0b1018] to-[#151009] p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-xs font-black tracking-[0.2em] text-gold">GAME #03 · STRATEGY</div>
        <h2 className="mt-2 font-display text-3xl text-white">🎲 라카루카</h2>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">같은 눈을 모아 점수를 폭발시키고, 상대의 같은 눈은 알까기로 제거하세요. 성공한 알까기는 다음 자기 턴에 같은 눈의 실드 주사위를 줍니다.</p>
      </div>
      <button className="btn-secondary text-xs" disabled={isStarting} onClick={onExit}>아케이드로 돌아가기</button>
    </div>

    {progressLoading && !progress && <div className="mt-5 rounded-card-md border border-line bg-bg-deep p-4 text-sm text-text-secondary">진행도와 해금 상태를 서버에서 확인하고 있습니다...</div>}
    {progressError && <div className="mt-5 rounded-card-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">{progressError}<button className="btn-secondary ml-3 text-xs" onClick={onRetryProgress}>다시 확인</button></div>}
    {error && <div className="mt-5 rounded-card-md border border-danger/40 bg-danger/10 p-4 text-sm font-bold text-danger">{error}</div>}

    {progress && <>
      <div className="mt-5 grid gap-2 sm:grid-cols-4">
        <SetupStat label="현재 해금" value={`Lv.${progress.highest_unlocked_difficulty}`} />
        <SetupStat label="클리어" value={`${progress.cleared_difficulties.length}/10`} />
        <SetupStat label="승리" value={`${progress.wins}회`} />
        <SetupStat label="플레이" value={`${progress.games_played}회`} />
      </div>

      <div className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <div><div className="text-xs font-black text-text-secondary">난이도 선택</div><div className="mt-1 font-display text-xl text-white">Lv.{difficulty} · {difficultyLabel(difficulty)}</div></div>
          <span className="rounded-pill border border-gold/25 bg-gold/10 px-3 py-1 text-[10px] font-black text-gold">이전 단계 승리 시 다음 단계 해금</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {DIFFICULTIES.map((level) => {
            const unlocked = isTikatukaDifficultyUnlocked(progress, level);
            const cleared = isTikatukaDifficultyCleared(progress, level);
            return <button
              key={level}
              type="button"
              disabled={!unlocked || isStarting}
              onClick={() => onDifficulty(level)}
              className={`relative aspect-square rounded-card-md border text-sm font-black transition ${difficulty === level && unlocked ? 'border-gold bg-gold/15 text-gold shadow-[0_0_20px_rgba(250,204,21,0.12)]' : unlocked ? 'border-line bg-bg-deep text-text-secondary hover:border-white/25 hover:text-white' : 'cursor-not-allowed border-white/5 bg-black/20 text-white/20'}`}
            >
              {cleared && <span className="absolute right-1 top-0.5 text-[9px] text-success">✓</span>}
              {unlocked ? level : '🔒'}
            </button>;
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card-md border border-success/25 bg-success/5 p-4">
          <div className="text-xs font-black text-success">PLAYER 지원</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><SetupStat label="타짜" value={`${PLAYER_TAZZA_CHARGES[difficulty]}회`} /><SetupStat label="HOLD" value={`${PLAYER_HOLD_CHARGES[difficulty]}회`} /></div>
        </div>
        <div className="rounded-card-md border border-danger/25 bg-danger/5 p-4">
          <div className="text-xs font-black text-danger">AI 능력</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><SetupStat label="AI 타짜" value={`${aiSkill.tazzaCharges}회`} /><SetupStat label="AI HOLD" value={`${aiSkill.holdCharges}회`} /></div>
        </div>
      </div>

      <div className="mt-5 grid gap-2 text-xs text-text-secondary sm:grid-cols-3">
        <RuleChip title="더블" body="같은 눈 2개 → 그 눈의 3배" />
        <RuleChip title="트리플" body="같은 눈 3개 → 그 눈의 5배" />
        <RuleChip title="승리" body="3개 Row 중 더 많이 이기면 승리" />
      </div>

      <button className="btn-primary mt-6 w-full py-3" disabled={!selectedUnlocked || isStarting || Boolean(progressError)} onClick={onStart}>
        {isStarting ? '서버에서 게임 준비 중...' : `Lv.${difficulty} 게임 시작`}
      </button>
    </>}
  </section>;
}

function SetupStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-card-md bg-bg-deep/80 p-3"><div className="text-[10px] font-black text-text-muted">{label}</div><div className="mt-1 font-display text-lg text-white">{value}</div></div>;
}

function RuleChip({ title, body }: { title: string; body: string }) {
  return <div className="rounded-card-md border border-line bg-bg-deep/60 p-3"><b className="text-white">{title}</b><div className="mt-1 text-[11px] text-text-muted">{body}</div></div>;
}

function StatusCard({ title, accent, score, sideState }: {
  title: string;
  accent: 'player' | 'ai';
  score: number;
  sideState: GameState['sides'][Side];
}) {
  const accentClass = accent === 'player' ? 'text-success border-success/25 bg-success/5' : 'text-danger border-danger/25 bg-danger/5';
  return <div className={`rounded-card-md border p-3 ${accentClass}`}>
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-black">{title}</span><span className="font-display text-xl text-white">{score}</span></div>
    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-text-secondary">
      <span className="rounded-pill bg-black/20 px-2 py-1">타짜 {sideState.skills.tazzaRemaining}</span>
      <span className="rounded-pill bg-black/20 px-2 py-1">HOLD {sideState.skills.holdRemaining}</span>
      {sideState.pendingShieldValue !== null && <span className="rounded-pill bg-gold/15 px-2 py-1 text-gold">다음 🛡️{sideState.pendingShieldValue}</span>}
      {sideState.heldDie && <span className="rounded-pill bg-brand-primary/15 px-2 py-1 text-brand-primary">보관 {sideState.heldDie.kind === 'shield' ? '🛡️' : ''}{sideState.heldDie.value}</span>}
    </div>
  </div>;
}

function TurnCenter({ state, currentDie, aiThinking, animation }: {
  state: GameState;
  currentDie: Die | null;
  aiThinking: boolean;
  animation: ActiveAnimation | null;
}) {
  const playerTurn = state.currentSide === 'player';
  return <div className="flex min-h-[108px] flex-col items-center justify-center rounded-card-md border border-white/10 bg-white/[0.03] p-3 text-center">
    {animation ? <EventBanner animation={animation} /> : aiThinking ? <>
      <div className="flex gap-1"><span className="h-2 w-2 animate-bounce rounded-full bg-danger" /><span className="h-2 w-2 animate-bounce rounded-full bg-danger [animation-delay:120ms]" /><span className="h-2 w-2 animate-bounce rounded-full bg-danger [animation-delay:240ms]" /></div>
      <div className="mt-2 text-xs font-black text-danger">AI 생각 중...</div>
    </> : currentDie ? <>
      <div className={`text-[10px] font-black tracking-[0.16em] ${playerTurn ? 'text-success' : 'text-danger'}`}>{playerTurn ? 'YOUR TURN' : 'AI TURN'}</div>
      <div className="mt-2"><DieView die={currentDie} large /></div>
      <div className="mt-1 text-[10px] text-text-muted">{state.turn.source === 'held' ? 'HOLD에서 복귀' : state.turn.source === 'shield' ? '알까기 보상' : '굴림 결과'}</div>
    </> : <div className="text-xs font-black text-text-muted">처리 중...</div>}
  </div>;
}

function EventBanner({ animation }: { animation: ActiveAnimation }) {
  const toneClass: Record<TikatukaEventPresentation['tone'], string> = {
    neutral: 'text-white',
    player: 'text-success',
    ai: 'text-danger',
    gold: 'text-gold',
    danger: 'text-danger',
    success: 'text-success',
  };
  return <div className="animate-pulse"><div className={`font-display text-sm ${toneClass[animation.presentation.tone]}`}>{animation.presentation.text}</div></div>;
}

function Board({ title, side, state, canPlace, onPlace, activeEvent }: {
  title: string;
  side: Side;
  state: GameState;
  canPlace: (row: RowId) => boolean;
  onPlace: (row: RowId) => void;
  activeEvent: GameEvent | null;
}) {
  const board = state.sides[side].board;
  const sideColor = side === 'player' ? 'text-success' : 'text-danger';
  return <div className="rounded-card-xl border border-white/10 bg-black/20 p-3 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className={`text-xs font-black tracking-[0.14em] ${sideColor}`}>{title}</h3><span className="text-xs font-black text-white">{calculateBoardScore(board)}점</span></div>
    <div className="space-y-2">
      {ROWS.map((row) => <BoardRow key={row} row={row} side={side} state={state} canPlace={canPlace(row)} onPlace={() => onPlace(row)} highlighted={eventTargetsRow(activeEvent, side, row)} />)}
    </div>
  </div>;
}

function BoardRow({ row, side, state, canPlace, onPlace, highlighted }: {
  row: RowId;
  side: Side;
  state: GameState;
  canPlace: boolean;
  onPlace: () => void;
  highlighted: boolean;
}) {
  const rowState = state.sides[side].board.rows[row];
  const duplicateValues = new Set<number>();
  for (const die of rowState.dice) {
    if (rowState.dice.filter((candidate) => candidate.value === die.value).length >= 2) duplicateValues.add(die.value);
  }
  const slots: Array<Die | null> = [rowState.dice[0] ?? null, rowState.dice[1] ?? null, rowState.dice[2] ?? null];
  const rowLabel = row === 'top' ? 'TOP' : row === 'middle' ? 'MID' : 'BOT';

  return <button type="button" disabled={!canPlace} onClick={onPlace} className={`grid w-full grid-cols-[42px_1fr_48px] items-center gap-2 rounded-card-md border p-2 text-left transition ${highlighted ? 'border-gold bg-gold/10 shadow-[0_0_24px_rgba(250,204,21,0.15)]' : canPlace ? 'border-brand-primary/50 bg-brand-primary/5 hover:border-brand-primary hover:bg-brand-primary/10' : 'border-white/10 bg-white/[0.02]'} ${canPlace ? 'cursor-pointer' : 'cursor-default'}`}>
    <span className="text-[10px] font-black text-text-muted">{rowLabel}</span>
    <span className="grid grid-cols-3 gap-2">
      {slots.map((die, index) => <span key={die?.id ?? `${row}-${index}`} className="flex min-h-[52px] items-center justify-center rounded-card-md border border-white/10 bg-black/25">
        {die ? <DieView die={die} linked={duplicateValues.has(die.value)} /> : <span className={`text-lg ${canPlace ? 'text-brand-primary/55' : 'text-white/10'}`}>＋</span>}
      </span>)}
    </span>
    <span className="text-right font-display text-lg text-white">{calculateRowScore(rowState)}</span>
  </button>;
}

function DieView({ die, large = false, linked = false }: { die: Die; large?: boolean; linked?: boolean }) {
  const shield = die.kind === 'shield';
  return <span className={`relative inline-flex items-center justify-center rounded-xl border font-display font-black shadow-inner ${large ? 'h-14 w-14 text-2xl' : 'h-10 w-10 text-lg'} ${shield ? 'border-gold/70 bg-gold/15 text-gold' : 'border-white/25 bg-white/10 text-white'} ${linked ? 'ring-2 ring-gold/55 ring-offset-1 ring-offset-[#090d14]' : ''}`}>
    {shield && <span className="absolute -right-1.5 -top-2 text-xs">🛡️</span>}
    {die.value}
  </span>;
}

function eventTargetsRow(event: GameEvent | null, side: Side, row: RowId): boolean {
  if (!event) return false;
  if (event.type === 'DIE_PLACED') return event.placement.targetSide === side && event.placement.row === row;
  if (event.type === 'DICE_KNOCKED') return event.targetSide === side && event.row === row;
  return false;
}

function ResultScreen({ state, submission, previousHighestUnlocked, isSubmitting, submitError, onRetrySubmit, onRematch, onChangeDifficulty, onExit }: {
  state: GameState;
  submission: TikatukaSubmissionResponse | null;
  previousHighestUnlocked: Difficulty | null;
  isSubmitting: boolean;
  submitError: string | null;
  onRetrySubmit: () => void;
  onRematch: () => void;
  onChangeDifficulty: () => void;
  onExit: () => void;
}) {
  const result = state.result;
  if (!result) return null;
  const playerWon = result.winner === 'player';
  const aiWon = result.winner === 'ai';
  const title = result.winner === 'draw' ? '무승부' : playerWon ? '승리!' : '패배';
  const emoji = result.winner === 'draw' ? '⚖️' : playerWon ? '🏆' : '💀';
  const newlyUnlocked = submission && previousHighestUnlocked !== null
    ? submission.progress.highest_unlocked_difficulty > previousHighestUnlocked
    : false;
  const canContinue = submission !== null && !isSubmitting;

  return <section className={`overflow-hidden rounded-card-xl border p-6 text-center ${playerWon ? 'border-success/35 bg-success/5' : aiWon ? 'border-danger/35 bg-danger/5' : 'border-white/15 bg-white/[0.03]'}`}>
    <div className="text-6xl">{emoji}</div>
    <div className="mt-3 text-xs font-black tracking-[0.18em] text-text-muted">TIKATUKA · Lv.{result.difficulty}</div>
    <h2 className={`mt-2 font-display text-4xl ${playerWon ? 'text-success' : aiWon ? 'text-danger' : 'text-white'}`}>{title}</h2>
    <p className="mt-2 text-sm text-text-secondary">Row 승수 {result.playerRowWins} : {result.aiRowWins} · 동률 Row {result.tiedRows}</p>

    <div className="mx-auto mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
      <ResultStat title="PLAYER" score={result.playerScore} raw={result.playerRawPips} knocks={result.playerKnockCount} shields={result.playerShieldsEarned} />
      <ResultStat title="AI" score={result.aiScore} raw={result.aiRawPips} knocks={result.aiKnockCount} shields={result.aiShieldsEarned} />
    </div>

    {isSubmitting && <div className="mx-auto mt-4 max-w-2xl rounded-card-md border border-brand-primary/35 bg-brand-primary/10 p-3 text-xs font-bold text-brand-primary">최종 보드를 서버에서 다시 계산하고 결과를 저장하고 있습니다...</div>}
    {submitError && <div className="mx-auto mt-4 max-w-2xl rounded-card-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger"><b>결과가 아직 저장되지 않았습니다.</b><div className="mt-1">{submitError}</div><button className="btn-secondary mt-3 text-xs" onClick={onRetrySubmit}>결과 저장 다시 시도</button></div>}
    {submission && <div className="mx-auto mt-4 max-w-2xl rounded-card-md border border-success/35 bg-success/10 p-3 text-xs text-success">
      <b>{submission.duplicate ? '이미 저장된 동일 게임 결과를 확인했습니다.' : '서버 검증 및 결과 저장 완료'}</b>
      <div className="mt-1 text-text-secondary">서버 판정 {submission.server_winner === 'player' ? 'PLAYER 승리' : submission.server_winner === 'ai' ? 'AI 승리' : '무승부'} · 현재 최고 해금 Lv.{submission.progress.highest_unlocked_difficulty}</div>
      {newlyUnlocked && <div className="mt-2 font-display text-lg text-gold">🔓 Lv.{submission.progress.highest_unlocked_difficulty} 해금!</div>}
    </div>}

    <div className="mx-auto mt-5 flex max-w-2xl flex-col gap-2 sm:flex-row">
      <button className="btn-primary flex-1" disabled={!canContinue} onClick={onRematch}>같은 난이도 다시 하기</button>
      <button className="btn-secondary flex-1" disabled={!canContinue} onClick={onChangeDifficulty}>난이도 선택</button>
      <button className="btn-secondary flex-1" disabled={!canContinue} onClick={onExit}>아케이드로</button>
    </div>
    {!canContinue && <p className="mt-3 text-[11px] text-text-muted">서버 저장이 끝나기 전에는 새 게임으로 이동하지 않습니다. 중복 제출은 같은 game UUID로 안전하게 처리됩니다.</p>}
  </section>;
}

function ResultStat({ title, score, raw, knocks, shields }: { title: string; score: number; raw: number; knocks: number; shields: number }) {
  return <div className="rounded-card-md border border-white/10 bg-bg-deep/80 p-4 text-left">
    <div className="text-xs font-black text-text-secondary">{title}</div>
    <div className="mt-1 font-display text-3xl text-white">{score}점</div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-text-muted"><span>원점수 <b className="block text-sm text-white">{raw}</b></span><span>알까기 <b className="block text-sm text-white">{knocks}</b></span><span>실드 <b className="block text-sm text-white">{shields}</b></span></div>
  </div>;
}
