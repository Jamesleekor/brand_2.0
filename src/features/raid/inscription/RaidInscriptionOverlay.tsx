// RAID_INSCRIPTION_V1_20261118 — 학생 전투 화면의 「주문 각인」 오버레이
// 모집(지원 버튼) → 각인자 공개·카운트다운 → 입력(선발: 키보드 / 나머지: 응원 관전) → 결과(3초).
// 오버레이가 화면 전체의 포인터 입력을 가로채므로 각인 중 보스 공격 탭이 나가지 않는다(서버도 별도로 막음).
// 학생 크롬북은 무음 운영이라 소리를 내지 않는다(효과음은 4단계 중계 화면에서).
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  raidStudentRpc,
  type RaidInscriptionActionResult,
  type RaidInscriptionPlayer,
  type RaidInscriptionProgressResult,
  type RaidInscriptionPublicState,
} from '@/lib/rpc/raid_student_rpc';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import InscriptionStage, { INSCRIPTION_STAGE_STYLE } from './InscriptionStage';
import {
  INSCRIPTION_DEFAULTS,
  formatSeconds,
  inscriptionDifficultyLabel,
  inscriptionKeys,
  inscriptionShowsOverlay,
  parseServerMs,
} from './inscriptionCore';
import { useInscriptionTyping } from './useInscriptionTyping';

const FONT_NUM = "'Barlow Condensed', 'Rajdhani', ui-sans-serif, system-ui, sans-serif";
const FONT_SERIF = "'Noto Serif KR', 'Nanum Myeongjo', serif";
const PROGRESS_REPORT_MS = 300;

/**
 * 각인 오버레이가 서버에 보내는 요청.
 * 실제 전투에서는 생략(기본값 = 서버 RPC)하고, 교사용 리허설은 브라우저 안의 가상 서버를 넘겨 같은 화면을 그대로 쓴다.
 */
export interface RaidInscriptionActions {
  volunteer: () => Promise<RpcResult<RaidInscriptionActionResult>>;
  report: (attemptIndex: number, typedCount: number) => Promise<RpcResult<RaidInscriptionProgressResult>>;
  submit: (attemptIndex: number, typed: string, elapsedMs: number) => Promise<RpcResult<RaidInscriptionActionResult>>;
}

export default function RaidInscriptionOverlay({
  raidId,
  inscription,
  serverOffsetMs,
  attackBlocked,
  myParticipantId,
  onInscriptionUpdate,
  onRefresh,
  actions,
}: {
  raidId: number;
  inscription: RaidInscriptionPublicState | null | undefined;
  serverOffsetMs: number;
  attackBlocked: boolean;
  myParticipantId: number | null;
  onInscriptionUpdate: (next: RaidInscriptionPublicState | null) => void;
  /** 서버 시계를 한 번 밀어 주고(전투 틱) 화면 상태를 새로 받는다. 단계가 바뀌는 순간에 부른다. */
  onRefresh: () => void;
  /** 리허설 전용. 넘기지 않으면 실제 서버 RPC를 쓴다. */
  actions?: RaidInscriptionActions;
}) {
  const serverActions = useMemo<RaidInscriptionActions>(() => ({
    volunteer: () => raidStudentRpc.volunteerInscription(supabase, raidId),
    report: (attemptIndex, typedCount) => raidStudentRpc.reportInscriptionProgress(supabase, raidId, attemptIndex, typedCount),
    submit: (attemptIndex, typed, elapsedMs) => raidStudentRpc.submitInscription(supabase, raidId, attemptIndex, typed, elapsedMs),
  }), [raidId]);
  const act = actions ?? serverActions;
  // 전투 화면이 100ms마다 다시 그려지므로 여기서는 따로 프레임 루프를 돌리지 않는다.
  const serverNow = Date.now() + serverOffsetMs;
  const state = inscription ?? null;

  // 단계가 바뀌어야 하는 순간(모집 마감 · 입력 시작 · 시간 초과 · 결과 끝)에 서버를 한 번 깨운다.
  // 상태 조회만으로는 서버 단계가 넘어가지 않기 때문(전투 틱이 넘김).
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const nudgeAt = (() => {
    if (!state) return null;
    if (state.phase === 'VOLUNTEERING') return parseServerMs(state.volunteer_accept_until);
    if (state.phase === 'SELECTED') return parseServerMs(state.play_starts_at);
    if (state.phase === 'PLAYING') {
      const deadline = parseServerMs(state.play_deadline_at);
      return deadline == null ? null : deadline + INSCRIPTION_DEFAULTS.latencySlackMs;
    }
    if (state.phase === 'RESOLVED' || state.phase === 'CANCELLED') return parseServerMs(state.resume_at);
    return null;
  })();
  useEffect(() => {
    if (nudgeAt == null) return;
    const wait = nudgeAt - (Date.now() + serverOffsetMs) + 80;
    if (wait < -15000) return; // 아주 오래전 일이면 다시 깨우지 않는다(정기 확인에 맡김)
    const timer = window.setTimeout(() => refreshRef.current(), Math.max(0, wait));
    return () => window.clearTimeout(timer);
    // serverOffsetMs는 자주 조금씩 바뀌므로 다시 예약하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudgeAt, state?.id, state?.phase]);

  if (!state || !inscriptionShowsOverlay(state, serverNow)) return null;

  if (state.phase === 'RESOLVED') return <InscriptionResultBanner state={state} myParticipantId={myParticipantId} />;
  if (state.phase === 'CANCELLED') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[30%] z-[80] flex justify-center px-4">
        <div className="rounded-card-lg border-2 border-white/30 bg-black/75 px-8 py-4 text-center text-lg font-black text-white backdrop-blur">
          주문 각인이 취소되었어요. 곧 전투가 다시 시작돼요.
        </div>
      </div>
    );
  }

  const me = state.me ?? null;
  const iPlay = Boolean(me?.selected);

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col items-center justify-center text-white"
      style={{ background: 'radial-gradient(circle at center, rgba(76,29,149,0.55), rgba(9,10,22,0.94) 70%)' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <style>{INSCRIPTION_STAGE_STYLE}</style>
      {state.phase === 'VOLUNTEERING' && (
        <VolunteerPanel actions={act} state={state} serverNow={serverNow} attackBlocked={attackBlocked} onInscriptionUpdate={onInscriptionUpdate} />
      )}
      {state.phase === 'SELECTED' && <SelectedPanel state={state} serverNow={serverNow} />}
      {state.phase === 'PLAYING' && (
        iPlay
          ? <PlayerPanel actions={act} state={state} serverOffsetMs={serverOffsetMs} onInscriptionUpdate={onInscriptionUpdate} onRefresh={onRefresh} />
          : <SpectatorPanel state={state} serverNow={serverNow} />
      )}
    </div>
  );
}

function InscriptionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-black tracking-[0.32em] text-[#d4b6ff]">{eyebrow}</div>
      <div
        className="insc-anim mt-1 text-5xl font-black text-white drop-shadow-[0_0_24px_rgba(192,107,255,0.8)] md:text-6xl"
        style={{ fontFamily: FONT_SERIF, animation: 'inscTitleIn 520ms ease-out both' }}
      >
        {title}
      </div>
    </div>
  );
}

function VolunteerPanel({
  actions,
  state,
  serverNow,
  attackBlocked,
  onInscriptionUpdate,
}: {
  actions: RaidInscriptionActions;
  state: RaidInscriptionPublicState;
  serverNow: number;
  attackBlocked: boolean;
  onInscriptionUpdate: (next: RaidInscriptionPublicState | null) => void;
}) {
  // 오버레이가 처음 보인 순간부터 약 1초 동안 버튼을 잠근다(연타하던 손이 실수로 누르지 않게).
  const [mountedAt] = useState(() => Date.now());
  const [unlocked, setUnlocked] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const delayMs = Number(state.volunteer_button_delay_ms ?? INSCRIPTION_DEFAULTS.volunteerButtonDelayMs);

  useEffect(() => {
    const timer = window.setTimeout(() => setUnlocked(true), Math.max(0, delayMs - (Date.now() - mountedAt)));
    return () => window.clearTimeout(timer);
  }, [delayMs, mountedAt]);

  const closesAt = parseServerMs(state.volunteer_closes_at);
  const secondsLeft = closesAt == null ? 0 : Math.max(0, (closesAt - serverNow) / 1000);
  const closed = secondsLeft <= 0;
  const volunteered = Boolean(state.me?.volunteered);

  const volunteer = async () => {
    if (!unlocked || sending || volunteered) return;
    setSending(true);
    setMessage(null);
    const result = await actions.volunteer();
    setSending(false);
    if (result.success === false) {
      setMessage('지원을 보내지 못했어요. 한 번 더 눌러 주세요.');
      return;
    }
    if (result.data.inscription) onInscriptionUpdate(result.data.inscription);
    if (!result.data.accepted) {
      setMessage(result.data.reason === 'CLOSED' ? '모집 시간이 끝났어요.' : '지금은 지원할 수 없어요.');
    }
  };

  const keys = inscriptionKeys(state.use_gh);
  return (
    <div className="flex flex-col items-center gap-5 px-4">
      <InscriptionTitle eyebrow="INSCRIPTION" title="✒ 주문 각인" />
      <p className="max-w-xl text-center text-lg font-black text-[#e6d9ff]">
        보스가 금지된 주문을 새기고 있습니다. 주문을 받아 적어 끊어 낼 모험가를 모집합니다!
      </p>
      <div className="text-6xl font-black tabular-nums text-[#ffe08a]" style={{ fontFamily: FONT_NUM }}>{secondsLeft.toFixed(1)}</div>

      {attackBlocked ? (
        <div className="rounded-card-md border border-amber-300/40 bg-amber-950/70 px-4 py-2 text-sm font-black text-amber-100">지금은 지원할 수 없는 상태예요.</div>
      ) : volunteered ? (
        <div className="rounded-card-lg border-2 border-emerald-300/70 bg-emerald-950/75 px-8 py-4 text-xl font-black text-emerald-100 shadow-[0_0_28px_rgba(16,185,129,0.35)]">
          ✅ 지원 완료! 선발을 기다려 주세요
        </div>
      ) : closed ? (
        <div className="rounded-card-md border border-[#c9a6ff]/40 bg-[#1b1430]/80 px-5 py-3 text-lg font-black text-[#e6d9ff]">각인자 선발 중…</div>
      ) : (
        <button
          type="button"
          onClick={() => void volunteer()}
          disabled={!unlocked || sending}
          className={cn(
            'rounded-card-lg border-2 px-10 py-5 text-2xl font-black transition',
            unlocked
              ? 'border-[#ffe08a] bg-gradient-to-b from-[#9b5cf6] to-[#4c1d95] text-white shadow-[0_0_36px_rgba(192,107,255,0.6)] hover:scale-[1.03]'
              : 'cursor-wait border-[#c9a6ff]/40 bg-[#1b1430]/80 text-[#e6d9ff]',
          )}
        >
          {sending ? '보내는 중…' : unlocked ? '✒ 각인 지원' : '잠시만요…'}
        </button>
      )}

      <div className="text-center text-sm font-black text-[#e6d9ff]">
        현재 지원자 {Number(state.volunteer_count ?? 0)}명 · 지원자 중 {Number(state.planned_player_count ?? 0)}명이 주문을 새겨요
      </div>
      <div className="rounded-full border border-white/15 bg-black/55 px-4 py-1.5 text-xs font-black text-white/85">
        {inscriptionDifficultyLabel(state.difficulty)} · {Number(state.letter_count ?? 0)}글자 · 제한 {formatSeconds(Number(state.time_limit_ms ?? 0), 0)}초 · 키 {keys.join(' ')}
      </div>
      {message && <div className="rounded-card-md border border-red-300/40 bg-red-950/75 px-4 py-2 text-sm font-black text-red-100">{message}</div>}
    </div>
  );
}

function SelectedPanel({ state, serverNow }: { state: RaidInscriptionPublicState; serverNow: number }) {
  const players = state.players ?? [];
  const mySlot = state.me?.selected ? state.me.slot ?? null : null;
  const playStarts = parseServerMs(state.play_starts_at);
  const countdownMs = Number(state.countdown_ms ?? INSCRIPTION_DEFAULTS.countdownMs);
  const msToStart = playStarts == null ? null : playStarts - serverNow;
  const counting = msToStart != null && msToStart <= countdownMs;
  const keys = inscriptionKeys(state.use_gh);
  const crowded = players.length > 6;

  return (
    <div className={cn('flex flex-col items-center px-4', crowded ? 'gap-3' : 'gap-5')}>
      <InscriptionTitle eyebrow="INSCRIBERS" title={`주문을 새길 모험가 ${players.length}인`} />
      <div className={cn('flex max-w-5xl flex-wrap justify-center', crowded ? 'gap-2' : 'gap-3')}>
        {players.map((player) => {
          const mine = mySlot != null && player.slot === mySlot;
          return (
            <div
              key={player.slot}
              className={cn(
                'rounded-card-lg border-2 bg-black/60 text-center',
                crowded ? 'px-3 py-1.5' : 'px-5 py-3',
                mine ? 'border-[#ffe08a] shadow-[0_0_36px_rgba(255,224,138,0.45)]' : 'border-[#c9a6ff]/55',
              )}
            >
              <div className={cn('font-black text-white', crowded ? 'text-base' : 'text-xl')}>{player.student_name ?? '모험가'}{mine ? ' (나)' : ''}</div>
              {!crowded && player.guild_name && <div className="mt-0.5 text-xs font-black text-[#d4b6ff]">{player.guild_name}</div>}
            </div>
          );
        })}
      </div>

      {mySlot != null ? (
        <div className="text-center">
          <div className="text-2xl font-black text-[#ffe08a]">당신이 선택되었습니다!</div>
          <div className="mt-2 text-base font-black text-[#e6d9ff]">
            키보드 <b className="text-white">{keys.join(' · ')}</b> 위에 손가락을 올려 두세요. 화면에 뜨는 알파벳을 순서대로 치면 돼요.
          </div>
          <div className="mt-1 text-sm font-black text-white/75">틀려도 괜찮아요! 새 주문이 나오면 처음부터 다시 치면 됩니다. 한글 입력 상태여도 그대로 쳐요.</div>
        </div>
      ) : (
        <div className="text-xl font-black text-[#e6d9ff]">각인자들을 함께 응원해요! 📣 모두 성공해야 주문이 끊어져요.</div>
      )}

      <div className="h-20 text-center">
        {counting && msToStart != null && (
          <div className="text-7xl font-black tabular-nums text-white drop-shadow-[0_0_20px_rgba(255,224,138,0.8)]" style={{ fontFamily: FONT_NUM }}>
            {msToStart > 0 ? Math.ceil(msToStart / 1000) : '시작!'}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerPanel({
  actions,
  state,
  serverOffsetMs,
  onInscriptionUpdate,
  onRefresh,
}: {
  actions: RaidInscriptionActions;
  state: RaidInscriptionPublicState;
  serverOffsetMs: number;
  onInscriptionUpdate: (next: RaidInscriptionPublicState | null) => void;
  onRefresh: () => void;
}) {
  const me = state.me ?? null;
  const letterCount = Number(state.letter_count ?? 8);
  const timeLimitMs = Number(state.time_limit_ms ?? 20000);
  const keys = inscriptionKeys(state.use_gh);
  // 서버는 내가 완성하면 문자열을 더 보내지 않으므로, 처음 받은 묶음을 이 각인 동안 기억해 둔다.
  const poolRef = useRef<{ id: number; pool: string[] } | null>(null);
  if (me?.sequences && me.sequences.length > 0 && poolRef.current?.id !== state.id) {
    poolRef.current = { id: state.id, pool: me.sequences };
  }
  const pool = poolRef.current?.id === state.id ? poolRef.current.pool : null;

  const playStartsLocal = (parseServerMs(state.play_starts_at) ?? Date.now() + serverOffsetMs) - serverOffsetMs;
  const deadlineLocal = (parseServerMs(state.play_deadline_at) ?? playStartsLocal + timeLimitMs) - serverOffsetMs;
  const now = Date.now();
  const timeLeftMs = Math.max(0, deadlineLocal - now);
  const serverCompleted = Boolean(me?.completed);

  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const latestRef = useRef({ attempt: 0, typed: 0 });
  const sentRef = useRef({ attempt: -1, typed: -1 });

  const typing = useInscriptionTyping({
    active: Boolean(pool) && !serverCompleted && timeLeftMs > 0 && now >= playStartsLocal && !sending,
    resetKey: state.id,
    sequences: pool,
    missLockMs: Number(state.miss_lock_ms ?? INSCRIPTION_DEFAULTS.missLockMs),
    initialAttempt: Number(me?.attempt_index ?? 0),
    initialMistakes: Number(me?.mistakes ?? 0),
    onProgress: (attempt, typed) => {
      latestRef.current = { attempt, typed };
    },
    onComplete: (attempt, sequence) => {
      latestRef.current = { attempt, typed: sequence.length };
      void submitWithRetry(attempt, sequence, Date.now() - playStartsLocal);
    },
  });

  // 새로고침해서 다시 들어온 경우: 서버가 기억하는 시도 번호로 맞춘다
  const { syncFromServer } = typing;
  useEffect(() => {
    if (me?.attempt_index != null) syncFromServer(Number(me.attempt_index), Number(me.mistakes ?? 0));
  }, [me?.attempt_index, me?.mistakes, syncFromServer]);

  // 진행 막대용 보고(0.3초마다, 바뀐 것이 있을 때만)
  useEffect(() => {
    if (!pool || serverCompleted) return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      const latest = latestRef.current;
      const sent = sentRef.current;
      if (inFlight || (latest.attempt === sent.attempt && latest.typed === sent.typed)) return;
      inFlight = true;
      sentRef.current = { ...latest };
      void actions.report(latest.attempt, latest.typed).finally(() => {
        inFlight = false;
      });
    }, PROGRESS_REPORT_MS);
    return () => window.clearInterval(timer);
  }, [actions, pool, serverCompleted]);

  async function submitWithRetry(attempt: number, sequence: string, elapsedMs: number) {
    setSending(true);
    setNotice(null);
    try {
      for (let tryNo = 0; tryNo < 3; tryNo += 1) {
        const result = await actions.submit(attempt, sequence, elapsedMs);
        if (result.success === false) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          continue;
        }
        if (result.data.inscription) onInscriptionUpdate(result.data.inscription);
        if (result.data.accepted) return;
        const reason = result.data.reason;
        if (reason === 'TOO_LATE') {
          setNotice('제한 시간이 지나서 인정되지 않았어요.');
        } else if (reason === 'NOT_PLAYING') {
          onRefresh();
        } else {
          // WRONG_SEQUENCE · TOO_FAST · INVALID: 드문 경우. 다음 주문으로 이어서 친다.
          setNotice('주문이 확인되지 않았어요. 새 주문을 이어서 쳐 주세요!');
          typing.continueAfterReject();
        }
        return;
      }
      setNotice('연결이 불안정해요. 다시 확인하는 중…');
      onRefresh();
    } finally {
      setSending(false);
    }
  }

  const players = state.players ?? [];
  const mySlot = me?.slot ?? null;

  if (serverCompleted) {
    const doneMs = Number(me?.completed_ms ?? 0);
    return (
      <div className="flex w-full flex-col items-center gap-4 px-4">
        <div className="text-xs font-black tracking-[0.28em] text-[#d4b6ff]">INSCRIPTION · 각인 완료</div>
        <div className="text-4xl font-black text-[#ffe08a]" style={{ fontFamily: FONT_SERIF }}>✒ 각인 완성!</div>
        {doneMs > 0 && <div className="text-lg font-black text-white/85">{formatSeconds(doneMs, 2)}초 만에 완성했어요. 다른 친구들을 응원해 주세요!</div>}
        <InscriptionTimer timeLeftMs={timeLeftMs} timeLimitMs={timeLimitMs} />
        <PlayersBoard players={players} letterCount={letterCount} mySlot={mySlot} />
      </div>
    );
  }

  const expired = timeLeftMs <= 0;
  return (
    <div className="flex w-full flex-col items-center gap-4 px-2">
      <div className="text-xs font-black tracking-[0.28em] text-[#d4b6ff]">INSCRIPTION · 주문을 새기세요</div>
      <InscriptionStage
        sequence={typing.sequence}
        letterCount={letterCount}
        typedCount={typing.typedCount}
        wrong={typing.wrong}
        done={typing.done}
        mistakes={typing.mistakes}
        attemptIndex={typing.attemptIndex}
        timeLeftMs={timeLeftMs}
        timeLimitMs={timeLimitMs}
        keys={keys}
        statusText={
          expired ? '시간 종료!' : !pool ? '주문을 받는 중…' : sending ? '서버 확인 중…' : notice
        }
      />
      {notice && expired && <div className="text-sm font-black text-red-100">{notice}</div>}
      <PlayersBoard players={players} letterCount={letterCount} mySlot={mySlot} myTypedCount={typing.typedCount} compact />
    </div>
  );
}

function SpectatorPanel({ state, serverNow }: { state: RaidInscriptionPublicState; serverNow: number }) {
  const players = state.players ?? [];
  const letterCount = Number(state.letter_count ?? 8);
  const timeLimitMs = Number(state.time_limit_ms ?? 20000);
  const deadline = parseServerMs(state.play_deadline_at);
  const timeLeftMs = deadline == null ? 0 : Math.max(0, deadline - serverNow);
  const doneCount = players.filter((player) => player.completed).length;
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4">
      <div className="text-lg font-black text-[#ffe08a]">✒ 모험가 {players.length}명이 주문을 새기는 중! 응원해요 📣</div>
      <InscriptionTimer timeLeftMs={timeLeftMs} timeLimitMs={timeLimitMs} />
      <div className="text-sm font-black text-[#e6d9ff]">완성 {doneCount} / {players.length}명 · 모두 완성해야 성공이에요</div>
      <PlayersBoard players={players} letterCount={letterCount} mySlot={null} />
    </div>
  );
}

function InscriptionTimer({ timeLeftMs, timeLimitMs }: { timeLeftMs: number; timeLimitMs: number }) {
  const ratio = timeLimitMs > 0 ? Math.max(0, Math.min(1, timeLeftMs / timeLimitMs)) : 0;
  const danger = ratio <= 0.25;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1">
      <div className={cn('text-4xl font-black tabular-nums', danger ? 'text-red-200' : 'text-[#ffe08a]')} style={{ fontFamily: FONT_NUM }}>
        {formatSeconds(timeLeftMs)}초
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full border border-white/15 bg-black/55">
        <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: danger ? 'linear-gradient(90deg,#b8261a,#ff6a45)' : 'linear-gradient(90deg,#7b3fe0,#c06bff 65%,#ffd18a)' }} />
      </div>
    </div>
  );
}

/** 각인자들의 진행 막대(최대 12명) */
function PlayersBoard({
  players,
  letterCount,
  mySlot,
  myTypedCount,
  compact = false,
}: {
  players: RaidInscriptionPlayer[];
  letterCount: number;
  mySlot: number | null;
  /** 입력 중인 내 화면에서는 서버 보고를 기다리지 않고 내 진행을 바로 보여 준다 */
  myTypedCount?: number;
  compact?: boolean;
}) {
  if (players.length === 0) return null;
  return (
    <div className={cn('grid w-full max-w-4xl gap-1.5', players.length > 4 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
      {players.map((player) => {
        const mine = mySlot != null && player.slot === mySlot;
        const typedCount = mine && myTypedCount != null && !player.completed ? myTypedCount : player.typed_count;
        const ratio = letterCount > 0 ? Math.max(0, Math.min(1, typedCount / letterCount)) : 0;
        return (
          <div
            key={player.slot}
            className={cn(
              'flex items-center gap-2 rounded-[10px] border bg-[#120e1e]/85',
              compact ? 'px-2 py-1' : 'px-3 py-1.5',
              mine ? 'border-[#ffe08a]/70' : player.completed ? 'border-[#ffe08a]/40' : 'border-[#2e3a52]',
            )}
          >
            <span className={cn('w-20 truncate font-black', compact ? 'text-[11px]' : 'text-xs', mine ? 'text-[#ffe08a]' : 'text-white')}>
              {player.student_name ?? '모험가'}{mine ? ' (나)' : ''}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-black/60">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${ratio * 100}%`, background: player.completed ? 'linear-gradient(90deg,#e8c98a,#ffe08a)' : 'linear-gradient(90deg,#7b3fe0,#c06bff)' }}
              />
            </div>
            <span className="w-14 text-right font-black tabular-nums text-[11px]" style={{ fontFamily: FONT_NUM }}>
              {player.completed
                ? <span className="text-[#ffe08a]">✓ {player.completed_ms ? formatSeconds(player.completed_ms) : ''}</span>
                : <span className="text-white/75">{typedCount}/{letterCount}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function InscriptionResultBanner({ state, myParticipantId }: { state: RaidInscriptionPublicState; myParticipantId: number | null }) {
  const success = state.outcome === 'SUCCESS';
  const label = state.corruption_label || '타락';
  const seconds = Number(state.corruption_seconds ?? 0);
  const victims = state.corrupted ?? [];
  const iAmCorrupted = myParticipantId != null && victims.some((victim) => victim.participant_id === myParticipantId);
  const failDetail = state.outcome_reason === 'NO_VOLUNTEERS'
    ? '지원자가 없어 보스의 주문이 완성되었어요.'
    : '제한 시간 안에 모두 완성하지 못해 주문이 완성되었어요.';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[24%] z-[80] flex justify-center px-4">
      <div
        className={cn(
          'max-w-2xl rounded-card-lg border-2 px-8 py-5 text-center backdrop-blur',
          success
            ? 'border-[#ffe08a] bg-gradient-to-b from-yellow-500/30 to-[#3a2a0a]/85 text-yellow-50 shadow-[0_0_60px_rgba(255,224,138,0.5)]'
            : 'border-[#c9a6ff] bg-gradient-to-b from-[#7b3fe0]/35 to-[#120e1e]/90 text-[#f1e8ff] shadow-[0_0_56px_rgba(176,120,255,0.5)]',
        )}
      >
        <div className="text-xs font-black tracking-[0.3em]">INSCRIPTION RESULT</div>
        <div className="mt-1 text-5xl font-black" style={{ fontFamily: FONT_SERIF }}>{success ? '각인 성공!' : '각인 실패…'}</div>
        {success ? (
          <div className="mt-2 text-base font-black">
            주문을 끊어 냈어요!
            {Number(state.boss_damage ?? 0) > 0 && <> 보스 <span style={{ fontFamily: FONT_NUM }}>-{Number(state.boss_damage).toLocaleString('ko-KR')}</span></>}
            {Number(state.barrier_heal ?? 0) > 0 && <> · 공명방벽 <span style={{ fontFamily: FONT_NUM }}>+{Number(state.barrier_heal).toLocaleString('ko-KR')}</span></>}
          </div>
        ) : (
          <>
            <div className="mt-2 text-base font-black">{failDetail}</div>
            {victims.length > 0 && (
              <div className="mt-2 text-base font-black">
                😈 {label}: {victims.map((victim) => victim.student_name ?? '모험가').join(', ')}
                <div className="mt-1 text-sm text-white/80">{seconds}초 동안 이 모험가들의 공격은 보스를 회복시켜요.</div>
              </div>
            )}
            {iAmCorrupted && (
              <div className="mt-3 rounded-card-md border border-[#ff9a88]/60 bg-red-950/70 px-4 py-2 text-lg font-black text-red-50">
                당신이 {label} 상태가 되었어요! {seconds}초 동안은 공격을 멈추세요.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
