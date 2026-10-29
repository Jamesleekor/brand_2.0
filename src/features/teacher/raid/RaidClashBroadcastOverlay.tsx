// RAID_CLASH_V1_20261028 — 교사 16:9 중계 화면의 격돌 연출
// 영상 송출이 아니라, 서버의 공통 시각·판정 기록으로 학생 화면과 같은 고리를 직접 그린다.
// 모집 → 대표 공개(이름 셔플은 연출일 뿐, 실제 추첨은 서버가 이미 끝냄) → 고리 8개 → 결과.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { RaidClashPublicState, RaidClashSession } from '@/lib/rpc/raid_student_rpc';
import { cn } from '@/lib/utils/cn';
import ClashStage, { type ClashStageJudgment, useClashClock } from '@/features/raid/clash/ClashStage';
import { ClashBuffOverlay } from '@/features/raid/clash/RaidClashOverlay';
import {
  CLASH_DIFFICULTY_LABEL,
  CLASH_JUDGMENT_STYLE,
  clashBestJudgments,
  clashNowMs,
  clashOutcomeCopy,
  clashPlannedCount,
  clashPlayers,
  clashSlotJudgments,
  clashTeamRule,
  toLocalNotes,
} from '@/features/raid/clash/clashCore';

const RESULT_VISIBLE_MS = 5500;
const SHUFFLE_MS = 1700;

export default function RaidClashBroadcastOverlay({
  clash,
  serverOffsetMs,
  names,
  forceFinishing,
  onForceFinish,
}: {
  clash: RaidClashPublicState | null | undefined;
  serverOffsetMs: number;
  names: string[];
  forceFinishing: boolean;
  onForceFinish: () => void;
}) {
  const session = clash?.session ?? null;
  // 격돌 진행 중에만 프레임 단위로 다시 그린다(이름 셔플·카운트다운). 결과 이후는 중계 화면의 250ms 갱신으로 충분.
  useClashClock(Boolean(session?.frozen));
  const serverNow = clashNowMs() + serverOffsetMs;
  if (!session || session.phase === 'CANCELLED') return null;

  if (session.phase === 'RESOLVED') {
    const resolvedAt = session.resolved_at ? Date.parse(session.resolved_at) : Number.NaN;
    const showBanner = Number.isFinite(resolvedAt) && serverNow - resolvedAt <= RESULT_VISIBLE_MS;
    return (
      <>
        <ClashBuffOverlay session={session} serverNow={serverNow} />
        {showBanner && <BroadcastResult session={session} />}
      </>
    );
  }

  return (
    <div className="absolute inset-0 z-[45] bg-[radial-gradient(circle_at_center,rgba(8,47,73,0.62),rgba(2,6,23,0.9))] text-white">
      <style>{`
        @keyframes clashBroadcastIn { 0% { opacity: 0; transform: scale(1.4); letter-spacing: .5em; } 100% { opacity: 1; transform: scale(1); letter-spacing: .1em; } }
        @media (prefers-reduced-motion: reduce) { .clash-b-anim { animation: none !important; } }
      `}</style>
      <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-sky-300/40 bg-black/60 px-4 py-1 text-sm font-black tracking-[0.2em] text-sky-100">
        CLASH · {CLASH_DIFFICULTY_LABEL[session.profile.difficulty]}
      </div>

      {session.phase === 'VOLUNTEERING' && <BroadcastVolunteer session={session} serverNow={serverNow} />}
      {session.phase === 'SELECTED' && <BroadcastSelection session={session} names={names} serverNow={serverNow} />}
      {session.phase === 'PLAYING' && <BroadcastPlay session={session} serverOffsetMs={serverOffsetMs} />}

      <button
        type="button"
        onClick={onForceFinish}
        disabled={forceFinishing}
        className="absolute bottom-4 right-1/2 translate-x-1/2 rounded-card-md border border-red-300/40 bg-red-950/70 px-3 py-1.5 text-[11px] font-black text-red-100 opacity-60 hover:opacity-100"
        title="격돌이 멈췄을 때만 사용하세요. 남은 노트는 MISS로 처리됩니다."
      >
        {forceFinishing ? '종료 처리 중…' : '⏹ 격돌 강제 종료'}
      </button>
    </div>
  );
}

function BroadcastVolunteer({ session, serverNow }: { session: RaidClashSession; serverNow: number }) {
  const closesAt = Date.parse(session.volunteer_closes_at);
  const secondsLeft = Number.isFinite(closesAt) ? Math.max(0, (closesAt - serverNow) / 1000) : 0;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="clash-b-anim font-display text-[7rem] leading-none text-white drop-shadow-[0_0_40px_rgba(56,189,248,0.85)]"
        style={{ animation: 'clashBroadcastIn 600ms ease-out both' }}>
        ⚔ 격돌 개시
      </div>
      <div className="text-3xl font-black text-sky-100">
        길드의 대표 모험가 {clashPlannedCount(session) > 1 ? `${clashPlannedCount(session)}명을` : '를'} 모집합니다 — 학생 화면에서 「격돌 지원」!
      </div>
      <div className="font-mono text-[6rem] font-black tabular-nums leading-none text-yellow-100">{secondsLeft > 0 ? secondsLeft.toFixed(1) : '추첨 중'}</div>
      <div className="rounded-full border border-yellow-200/50 bg-yellow-500/15 px-6 py-2 text-2xl font-black text-yellow-50">지원자 {session.volunteer_count}명</div>
    </div>
  );
}

function BroadcastSelection({ session, names, serverNow }: { session: RaidClashSession; names: string[]; serverNow: number }) {
  const selectedAt = session.selected_at ? Date.parse(session.selected_at) : Number.NaN;
  const elapsed = Number.isFinite(selectedAt) ? serverNow - selectedAt : SHUFFLE_MS;
  const shuffling = elapsed < SHUFFLE_MS && names.length > 1;
  const shuffleName = shuffling ? names[Math.floor(elapsed / 90) % names.length] : null;
  // RAID_CLASH_V2_20261029: 대표 최대 3명을 나란히 공개한다.
  const players = clashPlayers(session);
  const many = players.length > 1;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-2xl font-black tracking-[0.3em] text-sky-100">{shuffling ? '대표 추첨 중…' : many ? `길드의 대표 모험가 ${players.length}인` : '길드의 대표 모험가'}</div>
      {shuffling ? (
        <div className="font-display text-7xl text-sky-50 opacity-80">{shuffleName}</div>
      ) : (
        <div className="flex flex-wrap items-stretch justify-center gap-6 px-6">
          {players.map((player) => (
            <div key={player.slot}
              className={cn(
                'flex items-center rounded-card-lg border-4 border-yellow-200/80 bg-black/60 shadow-[0_0_80px_rgba(250,204,21,0.45)]',
                many ? 'gap-4 px-6 py-5' : 'gap-8 px-10 py-6',
              )}>
              {player.character_image_url ? (
                <img src={player.character_image_url} alt="" className={cn('rounded-card-lg border-2 border-yellow-200/60 object-cover', many ? 'h-28 w-28' : 'h-44 w-44')} />
              ) : (
                <div className={cn('flex items-center justify-center rounded-card-lg border-2 border-yellow-200/60 bg-yellow-500/15', many ? 'h-28 w-28 text-5xl' : 'h-44 w-44 text-7xl')}>⚔</div>
              )}
              <div>
                <div className={cn('font-display text-yellow-100', many ? 'text-5xl' : 'text-7xl')}>{player.student_name ?? '대표 모험가'}</div>
                <div className={cn('mt-2 font-black text-sky-100', many ? 'text-xl' : 'text-2xl')}>{[player.guild_name, player.character_name].filter(Boolean).join(' · ')}</div>
                {many && <div className={cn('mt-1 text-lg font-black', player.ready ? 'text-emerald-200' : 'text-sky-200')}>{player.ready ? '✅ 준비 완료' : '준비 중…'}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {!shuffling && <div className="text-2xl font-black text-sky-100">모두 함께 응원해요! 곧 격돌이 시작됩니다</div>}
    </div>
  );
}

function BroadcastPlay({ session, serverOffsetMs }: { session: RaidClashSession; serverOffsetMs: number }) {
  const notes = useMemo(() => toLocalNotes(session, serverOffsetMs), [session, serverOffsetMs]);
  const playStartsAtMs = session.play_starts_at ? Date.parse(session.play_starts_at) - serverOffsetMs : null;
  const firstSeen = useRef<Record<number, number>>({});
  const judgments: Partial<Record<number, ClashStageJudgment>> = {};
  // RAID_CLASH_V2_20261029: 고리 섬광은 노트마다 대표들 중 가장 좋은 판정, 줄별 점수는 아래 보드에서.
  for (const [key, judgment] of Object.entries(clashBestJudgments(session))) {
    const index = Number(key);
    if (!judgment) continue;
    firstSeen.current[index] ??= clashNowMs();
    judgments[index] = { judgment, atMs: firstSeen.current[index] };
  }
  const players = clashPlayers(session);
  const rule = clashTeamRule(session);
  return (
    <div className="flex h-full flex-col items-center pt-14">
      <div className="flex flex-col items-center gap-2">
        {players.map((player) => {
          const judged = clashSlotJudgments(session, player.slot);
          return (
            <div key={player.slot} className="flex items-center gap-4">
              {player.character_image_url ? (
                <img src={player.character_image_url} alt="" className="h-12 w-12 rounded-card-md border border-yellow-200/60 object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-card-md border border-yellow-200/60 bg-yellow-500/15 text-2xl">⚔</div>
              )}
              <div className="w-48 truncate font-display text-3xl text-yellow-100">{player.student_name ?? '대표'}</div>
              <div className="flex gap-1.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5">
                {judged.map((item, index) => (
                  <span key={index} className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-black"
                    style={item ? { borderColor: CLASH_JUDGMENT_STYLE[item].color, background: CLASH_JUDGMENT_STYLE[item].glow, color: CLASH_JUDGMENT_STYLE[item].text } : { borderColor: 'rgba(186,230,253,0.5)', color: '#e0f2fe' }}>
                    {item ? item[0] : index + 1}
                  </span>
                ))}
                <span className="ml-2 w-16 self-center text-right font-mono text-xl font-black text-yellow-100">{player.score}점</span>
              </div>
            </div>
          );
        })}
        <div className="mt-1 rounded-full border border-yellow-200/50 bg-black/70 px-5 py-1.5 font-mono text-2xl font-black text-yellow-50">
          {players.length > 1 ? '팀 합계 ' : ''}{session.score} / {rule.max}점 · 성공 {rule.success} · 대성공 {rule.great}
        </div>
      </div>
      <div className="relative min-h-0 w-full flex-1">
        <ClashStage notes={notes} profile={session.profile} judgments={judgments} playStartsAtMs={playStartsAtMs} size="broadcast" />
      </div>
    </div>
  );
}

function BroadcastResult({ session }: { session: RaidClashSession }) {
  const copy = clashOutcomeCopy(session.outcome, Number(session.clash_component ?? 0), Number(session.weak_zone?.multiplier ?? 2));
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[26%] z-[60] flex justify-center">
      <div className={cn(
        'rounded-card-lg border-4 px-14 py-8 text-center backdrop-blur',
        copy.tone === 'gold'
          ? 'border-yellow-200 bg-gradient-to-b from-yellow-500/40 to-amber-950/85 text-yellow-50 shadow-[0_0_120px_rgba(250,204,21,0.6)]'
          : copy.tone === 'blue'
            ? 'border-sky-200 bg-gradient-to-b from-sky-500/40 to-blue-950/85 text-sky-50 shadow-[0_0_100px_rgba(56,189,248,0.55)]'
            : 'border-red-300 bg-gradient-to-b from-red-600/40 to-red-950/85 text-red-50 shadow-[0_0_100px_rgba(239,68,68,0.5)]',
      )}>
        <div className="text-lg font-black tracking-[0.35em]">CLASH RESULT</div>
        <div className="mt-2 font-display text-8xl leading-none">{copy.title}</div>
        {session.outcome_reason === 'NO_VOLUNTEER'
          ? <div className="mt-3 text-2xl font-black">지원자가 없어 보스의 반격을 막지 못했어요</div>
          : <div className="mt-3 font-mono text-3xl font-black">{session.score} / {clashTeamRule(session).max}점 · {clashPlayers(session).map((player) => player.student_name ?? '대표').join(' · ')}</div>}
        <div className="mt-3 text-2xl font-black">{copy.detail}</div>
        {session.outcome === 'FAILED' && Number(session.barrier_penalty_amount ?? 0) > 0 && (
          <div className="mt-2 font-mono text-2xl font-black">공명방벽 -{Number(session.barrier_penalty_amount).toLocaleString('ko-KR')}</div>
        )}
      </div>
    </div>
  );
}

/** 상태 변화(폴링/실시간 재조회)에 맞춰 격돌 효과음을 한 번씩만 낸다. */
export function useClashBroadcastCues(
  clash: RaidClashPublicState | null | undefined,
  play: ClashCuePlayer | null,
) {
  const last = useRef<{ id: number | null; phase: string | null; inputKeys: Set<string>; outcome: string | null }>({ id: null, phase: null, inputKeys: new Set(), outcome: null });
  const [primed, setPrimed] = useState(false);
  const session = clash?.session ?? null;

  useEffect(() => {
    const prev = last.current;
    const id = session?.id ?? null;
    const phase = session?.phase ?? null;
    const inputs = session?.inputs ?? [];
    // RAID_CLASH_V2_20261029: 대표가 여럿이라 "슬롯-노트" 단위로 새 판정을 가려낸다.
    const inputKeys = new Set(inputs.map((item) => `${item.slot ?? 0}-${item.index}`));
    const outcome = session?.outcome ?? null;
    // 화면을 처음 열었을 때 이미 진행 중이던 상태에는 소리를 내지 않는다.
    if (!primed) {
      last.current = { id, phase, inputKeys, outcome };
      setPrimed(true);
      return;
    }
    if (play && session) {
      if (id !== prev.id && phase === 'VOLUNTEERING') play('start');
      if (phase !== prev.phase) {
        if (phase === 'SELECTED') play('reveal');
        if (phase === 'PLAYING') play('countdown');
      }
      if (phase === 'PLAYING' && id === prev.id) {
        const fresh = inputs.filter((item) => !prev.inputKeys.has(`${item.slot ?? 0}-${item.index}`));
        // 한 번에 여러 판정이 들어오면 가장 좋은 판정의 소리 한 번만 낸다.
        // 준비를 못 한 대표의 MISS가 한꺼번에 들어오는 경우(4개 이상 전부 MISS)는 소리를 내지 않는다.
        const rank = { PERFECT: 3, GOOD: 2, BAD: 1, MISS: 0 } as const;
        const best = fresh.reduce<(typeof inputs)[number] | null>((acc, item) => (!acc || rank[item.judgment] > rank[acc.judgment] ? item : acc), null);
        if (best && !(best.judgment === 'MISS' && fresh.length > 3)) {
          play(best.judgment === 'PERFECT' ? 'perfect' : best.judgment === 'GOOD' ? 'good' : best.judgment === 'BAD' ? 'bad' : 'miss');
        }
      }
      if (outcome && outcome !== prev.outcome) {
        play(outcome === 'GREAT_SUCCESS' ? 'great' : outcome === 'SUCCESS' ? 'success' : 'fail');
      }
    }
    last.current = { id, phase, inputKeys, outcome };
  }, [play, primed, session]);
}

export type ClashCuePlayer = (cue: 'start' | 'volunteer_end' | 'reveal' | 'countdown' | 'ring' | 'perfect' | 'good' | 'bad' | 'miss' | 'great' | 'success' | 'fail') => void;
