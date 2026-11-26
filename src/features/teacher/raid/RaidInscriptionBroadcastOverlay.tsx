// RAID_INSCRIPTION_BROADCAST_20261126 — 교사 16:9 중계 화면의 「주문 각인」 연출
// 서버(teacher_get_raid_broadcast_state)가 이미 보내 주는 inscription / corruption 상태를 그대로 그린다.
// 모집 → 각인자 공개·카운트다운 → 각인자 진행 막대 → 결과(성공: 보스 피해·방벽 회복 / 실패: 타락 대상).
// 선발 방식(무작위/선생님 선택)은 학생·중계 화면에 나타내지 않는다(기존 규칙 유지).
// 서버 쓰기는 하지 않는다 — 화면 표시 전용.
import type {
  RaidCorruptionPublicState,
  RaidInscriptionPlayer,
  RaidInscriptionPublicState,
} from '@/lib/rpc/raid_student_rpc';
import { cn } from '@/lib/utils/cn';
import {
  INSCRIPTION_DEFAULTS,
  formatSeconds,
  inscriptionDifficultyLabel,
  inscriptionKeys,
  parseServerMs,
} from '@/features/raid/inscription/inscriptionCore';

const FONT_NUM = "'Barlow Condensed', 'Rajdhani', ui-sans-serif, system-ui, sans-serif";
const FONT_SERIF = "'Noto Serif KR', 'Nanum Myeongjo', serif";
/** 결과 배너를 중계 화면에 남겨 두는 시간(학생 화면 3초보다 조금 길게) */
const RESULT_VISIBLE_MS = 5500;

const OUTCOME_REASON_LABEL: Record<string, string> = {
  ALL_COMPLETED: '각인자 전원이 주문을 완성했어요',
  TIME_UP: '제한 시간 안에 모두 완성하지 못했어요',
  NO_VOLUNTEERS: '지원자가 없어 주문을 막지 못했어요',
  TEACHER_CANCELLED: '선생님이 각인을 취소했어요',
  RAID_ENDED: '레이드가 끝났어요',
};

export default function RaidInscriptionBroadcastOverlay({
  inscription,
  corruption,
  serverNow,
}: {
  inscription: RaidInscriptionPublicState | null | undefined;
  corruption: RaidCorruptionPublicState | null | undefined;
  /** 서버 시각 기준 현재(ms). 중계 화면의 250ms 시계로 다시 그려진다. */
  serverNow: number;
}) {
  const state = inscription ?? null;
  return (
    <>
      {state && <InscriptionLayer state={state} serverNow={serverNow} />}
      <CorruptionStrip corruption={corruption} />
    </>
  );
}

function InscriptionLayer({ state, serverNow }: { state: RaidInscriptionPublicState; serverNow: number }) {
  if (state.phase === 'PENDING') {
    return (
      <div className="pointer-events-none absolute left-1/2 top-[31%] z-[44] -translate-x-1/2 rounded-full border border-violet-300/50 bg-violet-950/80 px-5 py-2 text-lg font-black text-violet-50 backdrop-blur">
        ✒ 주문 각인 대기 중 · 격돌이 끝나면 바로 시작돼요
      </div>
    );
  }

  if (state.phase === 'RESOLVED' || state.phase === 'CANCELLED') {
    const resolvedAt = parseServerMs(state.resolved_at);
    if (resolvedAt == null || serverNow - resolvedAt > RESULT_VISIBLE_MS) return null;
    return <BroadcastResult state={state} />;
  }

  if (state.phase !== 'VOLUNTEERING' && state.phase !== 'SELECTED' && state.phase !== 'PLAYING') return null;

  return (
    <div
      className="absolute inset-0 z-[45] text-white"
      style={{ background: 'radial-gradient(circle at center, rgba(76,29,149,0.62), rgba(9,10,22,0.92) 72%)' }}
    >
      <style>{`
        @keyframes inscBroadcastIn { 0% { opacity: 0; transform: scale(1.35); letter-spacing: .45em; } 100% { opacity: 1; transform: scale(1); letter-spacing: .08em; } }
        @media (prefers-reduced-motion: reduce) { .insc-b-anim { animation: none !important; } }
      `}</style>
      <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-violet-300/45 bg-black/60 px-4 py-1 text-sm font-black tracking-[0.2em] text-violet-100">
        INSCRIPTION · {inscriptionDifficultyLabel(state.difficulty)} · {Number(state.letter_count ?? 0)}글자
      </div>

      {state.phase === 'VOLUNTEERING' && <BroadcastVolunteer state={state} serverNow={serverNow} />}
      {state.phase === 'SELECTED' && <BroadcastSelected state={state} serverNow={serverNow} />}
      {state.phase === 'PLAYING' && <BroadcastPlaying state={state} serverNow={serverNow} />}
    </div>
  );
}

function BroadcastVolunteer({ state, serverNow }: { state: RaidInscriptionPublicState; serverNow: number }) {
  const closesAt = parseServerMs(state.volunteer_closes_at);
  const secondsLeft = closesAt == null ? 0 : Math.max(0, (closesAt - serverNow) / 1000);
  const planned = Number(state.planned_player_count ?? 0);
  const keys = inscriptionKeys(state.use_gh);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div
        className="insc-b-anim text-[7rem] font-black leading-none text-white drop-shadow-[0_0_40px_rgba(192,107,255,0.85)]"
        style={{ fontFamily: FONT_SERIF, animation: 'inscBroadcastIn 600ms ease-out both' }}
      >
        ✒ 주문 각인
      </div>
      <div className="text-3xl font-black text-violet-100">
        보스가 금지된 주문을 새기고 있습니다 — 학생 화면에서 「각인 지원」!
      </div>
      {secondsLeft > 0 ? (
        <div className="text-[6rem] font-black tabular-nums leading-none text-yellow-100" style={{ fontFamily: FONT_NUM }}>
          {secondsLeft.toFixed(1)}
        </div>
      ) : (
        <div className="animate-pulse text-[5rem] font-black leading-none text-yellow-100 drop-shadow-[0_0_28px_rgba(250,204,21,0.6)]" style={{ fontFamily: FONT_SERIF }}>
          각인자 선발 중
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="rounded-full border border-yellow-200/50 bg-yellow-500/15 px-6 py-2 text-2xl font-black text-yellow-50">
          지원자 {Number(state.volunteer_count ?? 0)}명
        </div>
        {planned > 0 && (
          <div className="rounded-full border border-violet-200/50 bg-violet-500/15 px-6 py-2 text-2xl font-black text-violet-50">
            각인자 {planned}명 선발
          </div>
        )}
      </div>
      <div className="rounded-full border border-white/15 bg-black/55 px-5 py-1.5 text-lg font-black text-white/85">
        제한 {formatSeconds(Number(state.time_limit_ms ?? 0), 0)}초 · 키 {keys.join(' ')} · 각인자 전원이 완성해야 성공
      </div>
    </div>
  );
}

function BroadcastSelected({ state, serverNow }: { state: RaidInscriptionPublicState; serverNow: number }) {
  const players = state.players ?? [];
  const playStarts = parseServerMs(state.play_starts_at);
  const countdownMs = Number(state.countdown_ms ?? INSCRIPTION_DEFAULTS.countdownMs);
  const msToStart = playStarts == null ? null : playStarts - serverNow;
  const counting = msToStart != null && msToStart <= countdownMs;
  const crowded = players.length > 6;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
      <div className="text-2xl font-black tracking-[0.3em] text-violet-100">주문을 새길 모험가 {players.length}인</div>
      <div className={cn('flex max-w-[1500px] flex-wrap justify-center', crowded ? 'gap-3' : 'gap-5')}>
        {players.map((player) => (
          <div
            key={player.slot}
            className={cn(
              'rounded-card-lg border-4 border-yellow-200/80 bg-black/60 text-center shadow-[0_0_60px_rgba(250,204,21,0.35)]',
              crowded ? 'px-5 py-3' : 'px-8 py-5',
            )}
          >
            <div className={cn('font-black text-yellow-100', crowded ? 'text-3xl' : 'text-5xl')} style={{ fontFamily: FONT_SERIF }}>
              {player.student_name ?? '모험가'}
            </div>
            {player.guild_name && <div className={cn('mt-1 font-black text-violet-100', crowded ? 'text-base' : 'text-xl')}>{player.guild_name}</div>}
          </div>
        ))}
      </div>
      <div className="h-28 text-center">
        {counting && msToStart != null ? (
          <div className="text-[7rem] font-black tabular-nums leading-none text-white drop-shadow-[0_0_24px_rgba(255,224,138,0.8)]" style={{ fontFamily: FONT_NUM }}>
            {msToStart > 0 ? Math.ceil(msToStart / 1000) : '시작!'}
          </div>
        ) : (
          <div className="text-2xl font-black text-violet-100">모두 함께 응원해요! 📣 곧 각인이 시작됩니다</div>
        )}
      </div>
    </div>
  );
}

function BroadcastPlaying({ state, serverNow }: { state: RaidInscriptionPublicState; serverNow: number }) {
  const players = state.players ?? [];
  const letterCount = Math.max(1, Number(state.letter_count ?? 8));
  const timeLimitMs = Number(state.time_limit_ms ?? 20000);
  const deadline = parseServerMs(state.play_deadline_at);
  const timeLeftMs = deadline == null ? 0 : Math.max(0, deadline - serverNow);
  const ratio = timeLimitMs > 0 ? Math.max(0, Math.min(1, timeLeftMs / timeLimitMs)) : 0;
  const danger = ratio <= 0.25;
  const doneCount = players.filter((player) => player.completed).length;
  return (
    <div className="flex h-full flex-col items-center gap-5 px-10 pt-20">
      <div className="text-3xl font-black text-yellow-100">✒ 모험가 {players.length}명이 주문을 새기는 중!</div>
      <div className="flex w-full max-w-3xl flex-col items-center gap-2">
        <div className={cn('text-[5rem] font-black tabular-nums leading-none', danger ? 'text-red-200' : 'text-yellow-100')} style={{ fontFamily: FONT_NUM }}>
          {formatSeconds(timeLeftMs)}초
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full border border-white/20 bg-black/60">
          <div
            className="h-full rounded-full"
            style={{
              width: `${ratio * 100}%`,
              background: danger ? 'linear-gradient(90deg,#b8261a,#ff6a45)' : 'linear-gradient(90deg,#7b3fe0,#c06bff 65%,#ffd18a)',
            }}
          />
        </div>
      </div>
      <div className="rounded-full border border-violet-200/50 bg-black/60 px-6 py-1.5 text-2xl font-black text-violet-50">
        완성 {doneCount} / {players.length}명 · 모두 완성해야 성공
      </div>
      <PlayersBoard players={players} letterCount={letterCount} />
    </div>
  );
}

/** 각인자 진행판(최대 12명). 글자 칸으로 몇 글자를 쳤는지 보여 준다. */
function PlayersBoard({ players, letterCount }: { players: RaidInscriptionPlayer[]; letterCount: number }) {
  if (players.length === 0) return null;
  const crowded = players.length > 4;
  return (
    <div className={cn('grid w-full max-w-[1500px] gap-3', crowded ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2')}>
      {players.map((player) => {
        const typed = player.completed ? letterCount : Math.max(0, Math.min(letterCount, Number(player.typed_count ?? 0)));
        return (
          <div
            key={player.slot}
            className={cn(
              'rounded-card-lg border-2 bg-black/65 px-4 py-3',
              player.completed ? 'border-yellow-200 shadow-[0_0_40px_rgba(250,204,21,0.35)]' : 'border-violet-300/50',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={cn('truncate font-black', crowded ? 'text-2xl' : 'text-3xl', player.completed ? 'text-yellow-100' : 'text-white')}>
                  {player.student_name ?? '모험가'}
                </div>
                {player.guild_name && <div className="truncate text-sm font-black text-violet-200">{player.guild_name}</div>}
              </div>
              <div className="flex-none text-right">
                {player.completed ? (
                  <div className="text-2xl font-black text-yellow-100">✓ {formatSeconds(Number(player.completed_ms ?? 0))}초</div>
                ) : (
                  <div className="font-mono text-2xl font-black text-white">{typed}/{letterCount}</div>
                )}
                {Number(player.mistakes ?? 0) > 0 && (
                  <div className="text-sm font-black text-red-200">새 주문 {Number(player.mistakes)}번</div>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: letterCount }, (_, index) => (
                <span
                  key={index}
                  className="h-3 min-w-0 flex-1 rounded-sm"
                  style={{
                    background: index < typed
                      ? (player.completed ? '#ffe08a' : '#c06bff')
                      : 'rgba(255,255,255,0.12)',
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BroadcastResult({ state }: { state: RaidInscriptionPublicState }) {
  const cancelled = state.phase === 'CANCELLED';
  const success = !cancelled && state.outcome === 'SUCCESS';
  const corrupted = state.corrupted ?? [];
  const label = state.corruption_label || '타락';
  const reason = state.outcome_reason ? OUTCOME_REASON_LABEL[state.outcome_reason] ?? null : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[24%] z-[60] flex justify-center">
      <div
        className={cn(
          'rounded-card-lg border-4 px-14 py-8 text-center backdrop-blur',
          cancelled
            ? 'border-white/40 bg-black/80 text-white'
            : success
              ? 'border-yellow-200 bg-gradient-to-b from-yellow-500/40 to-amber-950/85 text-yellow-50 shadow-[0_0_120px_rgba(250,204,21,0.6)]'
              : 'border-violet-300 bg-gradient-to-b from-violet-600/45 to-[#12081f]/90 text-violet-50 shadow-[0_0_110px_rgba(168,85,247,0.55)]',
        )}
      >
        <div className="text-lg font-black tracking-[0.35em]">INSCRIPTION RESULT</div>
        <div className="mt-2 text-8xl font-black leading-none" style={{ fontFamily: FONT_SERIF }}>
          {cancelled ? '각인 취소' : success ? '주문 봉인 성공' : '주문 각인 실패'}
        </div>
        {reason && <div className="mt-3 text-2xl font-black">{reason}</div>}
        {success && (
          <div className="mt-3 font-mono text-2xl font-black">
            보스 피해 {Number(state.boss_damage ?? 0).toLocaleString('ko-KR')} · 공명방벽 +{Number(state.barrier_heal ?? 0).toLocaleString('ko-KR')}
          </div>
        )}
        {!success && !cancelled && corrupted.length > 0 && (
          <div className="mt-3 text-2xl font-black">
            😈 {label}: {corrupted.map((item) => item.student_name ?? '모험가').join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

/** 지금 타락 중인 모험가(실패 뒤 일정 시간). 회복량은 선생님 패널에서만 보이므로 여기서는 이름과 남은 시간만. */
function CorruptionStrip({ corruption }: { corruption: RaidCorruptionPublicState | null | undefined }) {
  const active = (corruption?.active ?? []).filter((item) => item.started && Number(item.seconds_remaining ?? 0) > 0);
  if (active.length === 0) return null;
  const label = corruption?.label || '타락';
  return (
    <div className="pointer-events-none absolute left-1/2 top-[31%] z-[44] flex -translate-x-1/2 flex-wrap items-center justify-center gap-2">
      <div className="rounded-full border border-violet-300/60 bg-violet-950/85 px-4 py-1.5 text-lg font-black text-violet-50 shadow-[0_0_30px_rgba(168,85,247,0.4)] backdrop-blur">
        😈 {label} 중 — 공격하면 보스가 회복해요
      </div>
      {active.map((item) => (
        <div key={item.participant_id} className="rounded-full border border-violet-200/50 bg-black/70 px-3 py-1.5 text-base font-black text-white">
          {item.student_name ?? '모험가'} <span className="font-mono text-violet-200">{Math.ceil(Number(item.seconds_remaining ?? 0))}초</span>
        </div>
      ))}
    </div>
  );
}
