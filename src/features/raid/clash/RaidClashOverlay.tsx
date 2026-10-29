// RAID_CLASH_V1_20261028 — 학생 전투 화면의 격돌 오버레이
// 모집(지원 버튼) → 대표 공개 → QTE(대표: 키보드 입력 / 나머지: 응원 관전) → 결과.
// 오버레이가 화면 전체의 포인터 입력을 가로채므로 격돌 중 보스 공격 탭이 나가지 않는다(서버도 별도로 막음).
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  raidStudentRpc,
  type RaidClashActionResult,
  type RaidClashJudgment,
  type RaidClashKeyCode,
  type RaidClashPublicState,
  type RaidClashSession,
} from '@/lib/rpc/raid_student_rpc';
import type { RpcResult } from '@/lib/rpc/student_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import ClashStage, { type ClashStageJudgment } from './ClashStage';
import {
  CLASH_JUDGMENT_STYLE,
  clashBestJudgments,
  clashNowMs,
  clashOutcomeCopy,
  clashPlannedCount,
  clashPlayers,
  clashPoints,
  clashSlotJudgments,
  clashTeamRule,
  toLocalNotes,
} from './clashCore';
import { useClashPlayer, type ClashJudgedInput } from './useClashPlayer';

const RESULT_VISIBLE_MS = 4500;

/**
 * 격돌 오버레이가 서버에 보내는 세 가지 요청.
 * 실제 전투에서는 생략(기본값 = 서버 RPC)하고, 교사용 리허설은 브라우저 안의 가상 서버를 넘겨 같은 화면을 그대로 쓴다.
 */
export interface RaidClashActions {
  volunteer: () => Promise<RpcResult<RaidClashActionResult>>;
  ready: () => Promise<RpcResult<RaidClashActionResult>>;
  submit: (noteIndex: number, keyCode: RaidClashKeyCode | null, offsetMs: number | null) => Promise<RpcResult<RaidClashActionResult>>;
}

export default function RaidClashOverlay({
  raidId,
  clash,
  serverOffsetMs,
  attackBlocked,
  onClashUpdate,
  actions,
}: {
  raidId: number;
  clash: RaidClashPublicState | null | undefined;
  serverOffsetMs: number;
  attackBlocked: boolean;
  onClashUpdate: (next: RaidClashPublicState) => void;
  /** 리허설 전용. 넘기지 않으면 실제 서버 RPC를 쓴다. */
  actions?: RaidClashActions;
}) {
  const serverActions = useMemo<RaidClashActions>(() => ({
    volunteer: () => raidStudentRpc.volunteerClash(supabase, raidId),
    ready: () => raidStudentRpc.readyClash(supabase, raidId),
    submit: (noteIndex, keyCode, offsetMs) => raidStudentRpc.submitClashInput(supabase, raidId, noteIndex, keyCode, offsetMs),
  }), [raidId]);
  const act = actions ?? serverActions;
  const session = clash?.session ?? null;
  // 전투 화면이 100ms마다 다시 그려지므로 여기서는 따로 프레임 루프를 돌리지 않는다(고리는 ClashStage가 직접 그림).
  const serverNow = clashNowMs() + serverOffsetMs;

  if (!session || session.phase === 'CANCELLED') return null;
  if (session.phase === 'RESOLVED') {
    const resolvedAt = session.resolved_at ? Date.parse(session.resolved_at) : Number.NaN;
    if (!Number.isFinite(resolvedAt) || serverNow - resolvedAt > RESULT_VISIBLE_MS) return null;
    return <ClashResultBanner session={session} />;
  }

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(8,47,73,0.55),rgba(2,6,23,0.92))] text-white"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <style>{`
        @keyframes clashTitleIn { 0% { opacity: 0; transform: scale(1.35); letter-spacing: .4em; } 100% { opacity: 1; transform: scale(1); letter-spacing: .08em; } }
        @media (prefers-reduced-motion: reduce) { .clash-anim { animation: none !important; } }
      `}</style>
      {session.phase === 'VOLUNTEERING' && (
        <VolunteerPanel actions={act} session={session} serverNow={serverNow} attackBlocked={attackBlocked} onClashUpdate={onClashUpdate} />
      )}
      {session.phase === 'SELECTED' && (
        <SelectedPanel actions={act} session={session} onClashUpdate={onClashUpdate} />
      )}
      {session.phase === 'PLAYING' && (
        session.i_am_selected
          ? <PlayerPanel actions={act} session={session} serverOffsetMs={serverOffsetMs} onClashUpdate={onClashUpdate} />
          : <SpectatorPanel session={session} serverOffsetMs={serverOffsetMs} />
      )}
    </div>
  );
}

function ClashTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-black tracking-[0.32em] text-sky-200">{eyebrow}</div>
      <div className="clash-anim mt-1 font-display text-5xl text-white drop-shadow-[0_0_24px_rgba(56,189,248,0.75)] md:text-6xl"
        style={{ animation: 'clashTitleIn 520ms ease-out both' }}>
        {title}
      </div>
    </div>
  );
}

function VolunteerPanel({
  actions,
  session,
  serverNow,
  attackBlocked,
  onClashUpdate,
}: {
  actions: RaidClashActions;
  session: RaidClashSession;
  serverNow: number;
  attackBlocked: boolean;
  onClashUpdate: (next: RaidClashPublicState) => void;
}) {
  // 오버레이가 처음 보인 순간부터 약 1초 동안 버튼을 잠근다(연타하던 손이 실수로 누르지 않게).
  const [mountedAt] = useState(() => Date.now());
  const [unlocked, setUnlocked] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const delayMs = Number(session.profile?.volunteer_button_delay_ms ?? 1000);

  useEffect(() => {
    const timer = window.setTimeout(() => setUnlocked(true), Math.max(0, delayMs - (Date.now() - mountedAt)));
    return () => window.clearTimeout(timer);
  }, [delayMs, mountedAt]);

  const closesAt = Date.parse(session.volunteer_closes_at);
  const secondsLeft = Number.isFinite(closesAt) ? Math.max(0, (closesAt - serverNow) / 1000) : 0;
  const closed = secondsLeft <= 0;

  const volunteer = async () => {
    if (!unlocked || sending || session.i_volunteered) return;
    setSending(true);
    setMessage(null);
    const result = await actions.volunteer();
    setSending(false);
    if (result.success === false) {
      setMessage('지원을 보내지 못했어요. 한 번 더 눌러 주세요.');
      return;
    }
    onClashUpdate(result.data.clash);
    if (!result.data.accepted) {
      setMessage(result.data.reason === 'CLOSED' ? '모집 시간이 끝났어요.' : '지금은 지원할 수 없어요.');
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 px-4">
      <ClashTitle eyebrow="CLASH" title="⚔ 격돌 발생!" />
      <p className="text-center text-lg font-black text-sky-100">보스가 힘을 모으고 있습니다. 길드를 대표해 맞설 모험가를 모집합니다!</p>
      <div className="font-mono text-6xl font-black tabular-nums text-yellow-100">{secondsLeft.toFixed(1)}</div>

      {attackBlocked ? (
        <div className="rounded-card-md border border-amber-300/40 bg-amber-950/70 px-4 py-2 text-sm font-black text-amber-100">지금은 지원할 수 없는 상태예요.</div>
      ) : session.i_volunteered ? (
        <div className="rounded-card-lg border-2 border-emerald-300/70 bg-emerald-950/75 px-8 py-4 text-xl font-black text-emerald-100 shadow-[0_0_28px_rgba(16,185,129,0.35)]">
          ✅ 지원 완료! 추첨을 기다려 주세요
        </div>
      ) : closed ? (
        <div className="rounded-card-md border border-sky-300/40 bg-sky-950/70 px-5 py-3 text-lg font-black text-sky-100">추첨 중…</div>
      ) : (
        <button
          type="button"
          onClick={() => void volunteer()}
          disabled={!unlocked || sending}
          className={cn(
            'rounded-card-lg border-2 px-10 py-5 text-2xl font-black transition',
            unlocked
              ? 'border-yellow-200 bg-gradient-to-b from-amber-400 to-orange-600 text-white shadow-[0_0_36px_rgba(250,204,21,0.55)] hover:scale-[1.03]'
              : 'cursor-wait border-sky-300/40 bg-sky-950/70 text-sky-100',
          )}
        >
          {sending ? '보내는 중…' : unlocked ? '⚔ 격돌 지원' : '잠시만요…'}
        </button>
      )}

      <div className="text-sm font-black text-sky-100">현재 지원자 {session.volunteer_count}명 · 지원자 중 {clashPlannedCount(session)}명을 무작위로 뽑습니다</div>
      {message && <div className="rounded-card-md border border-red-300/40 bg-red-950/75 px-4 py-2 text-sm font-black text-red-100">{message}</div>}
    </div>
  );
}

function SelectedPanel({
  actions,
  session,
  onClashUpdate,
}: {
  actions: RaidClashActions;
  session: RaidClashSession;
  onClashUpdate: (next: RaidClashPublicState) => void;
}) {
  const readySentFor = useRef<number | null>(null);

  useEffect(() => {
    if (!session.i_am_selected || readySentFor.current === session.id) return;
    readySentFor.current = session.id;
    void actions.ready().then((result) => {
      if (result.success) onClashUpdate(result.data.clash);
      else readySentFor.current = null;
    });
  }, [actions, onClashUpdate, session.i_am_selected, session.id]);

  // RAID_CLASH_V2_20261029: 대표 최대 3명을 나란히 보여 준다.
  const players = clashPlayers(session);
  const names = players.map((player) => player.student_name ?? '대표').join(', ');
  return (
    <div className="flex flex-col items-center gap-5 px-4">
      <ClashTitle eyebrow="CHAMPIONS" title={players.length > 1 ? `길드의 대표 모험가 ${players.length}인` : '길드의 대표 모험가'} />
      <div className="flex flex-wrap justify-center gap-3">
        {players.map((player) => {
          const mine = session.my_slot != null && player.slot === session.my_slot;
          return (
            <div key={player.slot}
              className={cn(
                'flex items-center gap-3 rounded-card-lg border-2 bg-black/60 px-4 py-3',
                mine ? 'border-yellow-200 shadow-[0_0_40px_rgba(250,204,21,0.45)]' : 'border-yellow-200/50 shadow-[0_0_24px_rgba(250,204,21,0.2)]',
              )}>
              {player.character_image_url ? (
                <img src={player.character_image_url} alt="" className="h-16 w-16 rounded-card-md border border-yellow-200/50 object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-card-md border border-yellow-200/50 bg-yellow-500/15 text-3xl">⚔</div>
              )}
              <div>
                <div className="font-display text-2xl text-yellow-100">{player.student_name ?? '대표 모험가'}{mine ? ' (나)' : ''}</div>
                <div className="mt-0.5 text-xs font-black text-sky-100">{[player.guild_name, player.character_name].filter(Boolean).join(' · ')}</div>
                <div className={cn('mt-1 text-xs font-black', player.ready ? 'text-emerald-200' : 'text-sky-200')}>{player.ready ? '✅ 준비 완료' : '준비 중…'}</div>
              </div>
            </div>
          );
        })}
      </div>
      {session.i_am_selected ? (
        <div className="text-center">
          <div className="text-2xl font-black text-yellow-100">당신이 선택되었습니다!</div>
          <div className="mt-2 text-base font-black text-sky-100">키보드의 <b className="text-white">Q · W · E · R</b> 위에 손가락을 올려 두세요. 줄어드는 고리가 파란 고리와 겹칠 때 누르면 됩니다.</div>
          {players.length > 1 && (
            <div className="mt-1 text-sm font-black text-sky-100">대표 {players.length}명이 같은 고리를 동시에 칩니다. 세 사람의 점수를 합쳐 결과가 정해져요.</div>
          )}
        </div>
      ) : (
        <div className="text-xl font-black text-sky-100">{names} 님을 함께 응원해요! 📣</div>
      )}
    </div>
  );
}

/** RAID_CLASH_V2_20261029: 대표들의 진행 상황과 팀 합계(성공·대성공 기준 포함) */
function TeamBoard({ session, highlightSlot }: { session: RaidClashSession; highlightSlot: number | null }) {
  const players = clashPlayers(session);
  const rule = clashTeamRule(session);
  if (players.length <= 1) return null;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap justify-center gap-2">
        {players.map((player) => {
          const judged = clashSlotJudgments(session, player.slot);
          return (
            <div key={player.slot}
              className={cn('flex items-center gap-2 rounded-full border bg-black/65 px-3 py-1', player.slot === highlightSlot ? 'border-yellow-200/80' : 'border-white/20')}>
              <span className="max-w-[7rem] truncate text-xs font-black text-white">{player.student_name ?? '대표'}</span>
              <span className="flex gap-0.5">
                {judged.map((item, index) => (
                  <span key={index} className="h-2.5 w-2.5 rounded-full border"
                    style={item ? { borderColor: CLASH_JUDGMENT_STYLE[item].color, background: CLASH_JUDGMENT_STYLE[item].color } : { borderColor: 'rgba(186,230,253,0.5)' }} />
                ))}
              </span>
              <span className="font-mono text-xs font-black text-yellow-100">{player.score}</span>
            </div>
          );
        })}
      </div>
      <div className="rounded-full border border-yellow-200/40 bg-black/65 px-3 py-1 font-mono text-xs font-black text-yellow-50">
        팀 합계 {session.score} / {rule.max}점 · 성공 {rule.success} · 대성공 {rule.great}
      </div>
    </div>
  );
}

function ScoreStrip({ judged, score }: { judged: Array<RaidClashJudgment | null>; score: number }) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/65 px-4 py-2">
      <div className="flex gap-1.5">
        {judged.map((item, index) => (
          <span
            key={index}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black"
            style={item ? { borderColor: CLASH_JUDGMENT_STYLE[item].color, background: CLASH_JUDGMENT_STYLE[item].glow, color: CLASH_JUDGMENT_STYLE[item].text } : { borderColor: 'rgba(186,230,253,0.5)', color: '#e0f2fe' }}
            title={item ?? '대기'}
          >
            {item ? item[0] : index + 1}
          </span>
        ))}
      </div>
      <span className="font-mono text-sm font-black text-yellow-100">{judged.filter(Boolean).length}/8 · {score}점</span>
    </div>
  );
}

function PlayerPanel({
  actions,
  session,
  serverOffsetMs,
  onClashUpdate,
}: {
  actions: RaidClashActions;
  session: RaidClashSession;
  serverOffsetMs: number;
  onClashUpdate: (next: RaidClashPublicState) => void;
}) {
  const notes = useMemo(() => toLocalNotes(session, serverOffsetMs), [session, serverOffsetMs]);
  const playStartsAtMs = session.play_starts_at ? Date.parse(session.play_starts_at) - serverOffsetMs : null;
  const [checking, setChecking] = useState(false);

  // useClashPlayer가 최신 콜백을 ref로 들고 있으므로 매 렌더 새 함수여도 된다.
  const onJudged = (input: ClashJudgedInput) => {
    // RAID_CLASH_SFX_20261029: 학생 크롬북은 무음 운영 → 판정음은 중계 화면에서만 낸다.
    setChecking(true);
    void actions
      .submit(input.note.index, input.keyCode, input.offsetMs)
      .then((result) => {
        if (!result.success) return;
        handleServer(result.data);
      })
      .finally(() => setChecking(false));
  };

  const { judgments, applyServerJudgment } = useClashPlayer({
    active: notes.length === 8,
    notes,
    profile: session.profile,
    onJudged,
  });

  function handleServer(data: RaidClashActionResult) {
    if (data.note_index != null && data.judgment) applyServerJudgment(data.note_index, data.judgment);
    onClashUpdate(data.clash);
  }

  // 새로고침 후 다시 들어온 경우: 이미 서버에 기록된 내 판정을 그대로 반영(다시 입력하지 않음)
  // RAID_CLASH_V2_20261029: 대표가 여러 명이므로 내 슬롯의 판정만 반영한다.
  const mySlot = session.my_slot ?? 0;
  useEffect(() => {
    for (const input of session.inputs ?? []) {
      if ((input.slot ?? 0) === mySlot) applyServerJudgment(input.index, input.judgment);
    }
  }, [applyServerJudgment, mySlot, session.inputs]);

  const judgedList = Array.from({ length: 8 }, (_, index) => judgments[index]?.judgment ?? null);
  const score = judgedList.reduce((sum, item) => sum + (item ? clashPoints(item) : 0), 0);
  const me = clashPlayers(session).find((player) => player.slot === mySlot);
  const missedReady = Boolean(me && !me.ready);

  return (
    <div className="flex h-full w-full flex-col items-center pt-6">
      <div className="z-10 flex flex-col items-center gap-2">
        <div className="text-xs font-black tracking-[0.28em] text-sky-200">CLASH · 대표 도전</div>
        <ScoreStrip judged={judgedList} score={score} />
        <TeamBoard session={session} highlightSlot={mySlot} />
        {missedReady && <div className="rounded-full border border-red-300/40 bg-red-950/70 px-3 py-1 text-xs font-black text-red-100">준비 시간 안에 연결되지 않아 이번 격돌은 MISS로 처리됐어요. 친구들을 응원해 주세요!</div>}
        {checking && <div className="text-xs font-black text-sky-100">서버 확인 중…</div>}
      </div>
      <div className="relative min-h-0 w-full flex-1">
        <ClashStage notes={notes} profile={session.profile} judgments={judgments} playStartsAtMs={playStartsAtMs} />
      </div>
      <div className="mb-5 rounded-full border border-sky-300/35 bg-black/60 px-4 py-2 text-sm font-black text-sky-100">
        키보드 Q · W · E · R — 줄어드는 고리가 파란 고리와 겹칠 때!
      </div>
    </div>
  );
}

function SpectatorPanel({ session, serverOffsetMs }: { session: RaidClashSession; serverOffsetMs: number }) {
  const notes = useMemo(() => toLocalNotes(session, serverOffsetMs), [session, serverOffsetMs]);
  const playStartsAtMs = session.play_starts_at ? Date.parse(session.play_starts_at) - serverOffsetMs : null;
  const firstSeen = useRef<Record<number, number>>({});
  const judgments: Partial<Record<number, ClashStageJudgment>> = {};
  // RAID_CLASH_V2_20261029: 노트마다 대표들 중 가장 좋은 판정으로 고리 섬광을 보여 준다.
  for (const [key, judgment] of Object.entries(clashBestJudgments(session))) {
    const index = Number(key);
    if (!judgment) continue;
    firstSeen.current[index] ??= clashNowMs();
    judgments[index] = { judgment, atMs: firstSeen.current[index] };
  }
  const players = clashPlayers(session);
  const single = players.length <= 1;
  const judgedList = single
    ? clashSlotJudgments(session, players[0]?.slot ?? 0)
    : Array.from({ length: 8 }, (_, index) => judgments[index]?.judgment ?? null);
  const names = players.map((player) => player.student_name ?? '대표').join(', ') || '대표';

  return (
    <div className="flex h-full w-full flex-col items-center pt-6">
      <div className="z-10 flex flex-col items-center gap-2">
        <div className="text-lg font-black text-yellow-100">⚔ {names} 님이 격돌 중! 응원해요 📣</div>
        {single ? <ScoreStrip judged={judgedList} score={session.score} /> : <TeamBoard session={session} highlightSlot={null} />}
      </div>
      <div className="relative min-h-0 w-full flex-1 opacity-90">
        <ClashStage notes={notes} profile={session.profile} judgments={judgments} playStartsAtMs={playStartsAtMs} />
      </div>
    </div>
  );
}

function ClashResultBanner({ session }: { session: RaidClashSession }) {
  const weak = Number(session.weak_zone?.multiplier ?? 2);
  const copy = clashOutcomeCopy(session.outcome, Number(session.clash_component ?? 0), weak);
  const tone = copy.tone === 'gold'
    ? 'border-yellow-200 bg-gradient-to-b from-yellow-500/35 to-amber-900/80 text-yellow-50 shadow-[0_0_60px_rgba(250,204,21,0.55)]'
    : copy.tone === 'blue'
      ? 'border-sky-200 bg-gradient-to-b from-sky-500/35 to-blue-950/85 text-sky-50 shadow-[0_0_50px_rgba(56,189,248,0.5)]'
      : 'border-red-300 bg-gradient-to-b from-red-600/35 to-red-950/85 text-red-50 shadow-[0_0_50px_rgba(239,68,68,0.45)]';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[30%] z-[80] flex justify-center px-4">
      <div className={cn('rounded-card-lg border-2 px-8 py-5 text-center backdrop-blur', tone)}>
        <div className="text-xs font-black tracking-[0.3em]">CLASH RESULT</div>
        <div className="mt-1 font-display text-5xl">{copy.title}</div>
        {session.score != null && session.outcome_reason !== 'NO_VOLUNTEER' && (
          <div className="mt-1 font-mono text-lg font-black">{session.score} / {clashTeamRule(session).max}점</div>
        )}
        {session.outcome_reason === 'NO_VOLUNTEER' && (
          <div className="mt-1 text-base font-black">지원자가 없어 보스의 반격을 막지 못했어요.</div>
        )}
        <div className="mt-2 text-base font-black">{copy.detail}</div>
        {session.outcome === 'FAILED' && Number(session.barrier_penalty_amount ?? 0) > 0 && (
          <div className="mt-1 font-mono text-base font-black">공명방벽 -{Number(session.barrier_penalty_amount).toLocaleString('ko-KR')}</div>
        )}
      </div>
    </div>
  );
}

/** 격돌 성공 후 10초 동안 보스 위에 보이는 격돌 약점 영역 + 남은 시간 */
export function ClashBuffOverlay({ session, serverNow }: { session: RaidClashSession | null | undefined; serverNow: number }) {
  if (!session || session.phase !== 'RESOLVED' || !session.weak_zone) return null;
  const buffUntil = session.buff_until ? Date.parse(session.buff_until) : Number.NaN;
  const blockUntil = session.boss_attack_block_until ? Date.parse(session.boss_attack_block_until) : Number.NaN;
  const buffLeft = Number.isFinite(buffUntil) ? (buffUntil - serverNow) / 1000 : 0;
  const blockLeft = Number.isFinite(blockUntil) ? (blockUntil - serverNow) / 1000 : 0;
  if (buffLeft <= 0 && blockLeft <= 0) return null;
  const zone = session.weak_zone;
  const component = Number(session.clash_component ?? 0);
  const great = session.outcome === 'GREAT_SUCCESS';
  return (
    <>
      {buffLeft > 0 && (
        <div
          className={cn(
            'pointer-events-none absolute z-[35] flex items-center justify-center rounded-[32px] border-4',
            great
              ? 'border-yellow-200 bg-yellow-300/12 shadow-[0_0_44px_rgba(250,204,21,0.7),inset_0_0_34px_rgba(250,204,21,0.2)]'
              : 'border-sky-200 bg-sky-300/12 shadow-[0_0_40px_rgba(56,189,248,0.65),inset_0_0_30px_rgba(56,189,248,0.2)]',
          )}
          style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }}
        >
          <div className="rounded-pill border border-white/60 bg-black/75 px-3 py-1.5 text-center">
            <div className={cn('text-[11px] font-black tracking-[0.14em]', great ? 'text-yellow-100' : 'text-sky-100')}>
              격돌 약점 · {Math.round((component + Number(zone.multiplier ?? 2)) * 100)}%
            </div>
            <div className="font-mono text-sm font-black text-white">{buffLeft.toFixed(1)}초</div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute left-1/2 top-[13%] z-[36] flex -translate-x-1/2 gap-2">
        {buffLeft > 0 && (
          <div className={cn('rounded-full border px-3 py-1 text-xs font-black', great ? 'border-yellow-200/70 bg-yellow-500/25 text-yellow-50' : 'border-sky-200/70 bg-sky-500/25 text-sky-50')}>
            ⚔ 격돌 {Math.round(component * 100)}% · {buffLeft.toFixed(1)}초
          </div>
        )}
        {blockLeft > 0 && (
          <div className="rounded-full border border-emerald-200/70 bg-emerald-600/25 px-3 py-1 text-xs font-black text-emerald-50">
            🛡 보스 공격 봉쇄 {blockLeft.toFixed(1)}초
          </div>
        )}
      </div>
    </>
  );
}
