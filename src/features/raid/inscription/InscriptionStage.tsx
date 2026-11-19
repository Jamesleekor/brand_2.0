// RAID_INSCRIPTION_V1_20261118 — 주문 각인 입력 화면(글자 칸 + 남은 시간 + 손가락 위치 안내)
// 실전(선발된 학생) · 연습 모드 · 교사 리허설이 같은 그림을 쓴다. 계산은 하지 않고 그리기만 한다.
import { cn } from '@/lib/utils/cn';
import { formatSeconds } from './inscriptionCore';
import type { InscriptionWrongKey } from './useInscriptionTyping';

const FONT_NUM = "'Barlow Condensed', 'Rajdhani', ui-sans-serif, system-ui, sans-serif";
const HOME_ROW = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];

export const INSCRIPTION_STAGE_STYLE = `
@keyframes inscShake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-7px) } 40% { transform: translateX(7px) } 60% { transform: translateX(-5px) } 80% { transform: translateX(4px) } }
@keyframes inscPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(201,166,255,.55) } 50% { box-shadow: 0 0 0 6px rgba(201,166,255,0) } }
@keyframes inscPop { 0% { transform: scale(1.25) } 100% { transform: scale(1) } }
@keyframes inscTitleIn { 0% { opacity: 0; transform: scale(1.3); letter-spacing: .35em } 100% { opacity: 1; transform: scale(1); letter-spacing: .06em } }
@media (prefers-reduced-motion: reduce) { .insc-anim { animation: none !important; } }
`;

function tileSize(count: number) {
  if (count >= 15) return { box: 'h-11 w-10 text-2xl md:h-12 md:w-11 md:text-3xl', gap: 'gap-1.5' };
  if (count >= 12) return { box: 'h-12 w-11 text-3xl md:h-14 md:w-12 md:text-4xl', gap: 'gap-1.5 md:gap-2' };
  return { box: 'h-14 w-12 text-4xl md:h-16 md:w-14 md:text-[44px]', gap: 'gap-2' };
}

export default function InscriptionStage({
  sequence,
  letterCount,
  typedCount,
  wrong,
  done,
  mistakes,
  attemptIndex,
  timeLeftMs,
  timeLimitMs,
  keys,
  showKeyboard = true,
  statusText,
}: {
  sequence: string | null;
  letterCount: number;
  typedCount: number;
  wrong: InscriptionWrongKey | null;
  done: boolean;
  mistakes: number;
  attemptIndex: number;
  /** 남은 시간. null이면 시간 표시를 숨긴다(카운트다운 전 등) */
  timeLeftMs: number | null;
  timeLimitMs: number;
  /** 이번 각인에 쓰는 키(A S D F J K L, 어려움이면 G H 추가) */
  keys: string[];
  showKeyboard?: boolean;
  /** 아래쪽 한 줄 안내(예: 서버 확인 중) */
  statusText?: string | null;
}) {
  const count = sequence?.length ?? letterCount;
  const size = tileSize(count);
  const ratio = timeLeftMs == null || timeLimitMs <= 0 ? 1 : Math.max(0, Math.min(1, timeLeftMs / timeLimitMs));
  const danger = timeLeftMs != null && ratio <= 0.25;
  const nextKey = sequence && !done && !wrong ? sequence[typedCount] ?? null : null;
  const keySet = new Set(keys);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4 px-3">
      {/* 남은 시간 */}
      {timeLeftMs != null && (
        <div className="flex w-full max-w-xl flex-col items-center gap-1.5">
          <div className={cn('text-5xl font-black tabular-nums md:text-6xl', danger ? 'text-red-200' : 'text-[#ffe08a]')} style={{ fontFamily: FONT_NUM }}>
            {formatSeconds(timeLeftMs)}<span className="ml-1 text-2xl text-white/70">초</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-white/15 bg-black/55">
            <div
              className="h-full rounded-full transition-[width] duration-100 ease-linear"
              style={{
                width: `${ratio * 100}%`,
                background: danger ? 'linear-gradient(90deg,#b8261a,#ff6a45)' : 'linear-gradient(90deg,#7b3fe0,#c06bff 65%,#ffd18a)',
              }}
            />
          </div>
        </div>
      )}

      {/* 글자 칸 */}
      <div
        key={`${attemptIndex}-${wrong ? 'w' : 'ok'}`}
        className={cn('insc-anim flex flex-wrap justify-center', size.gap)}
        style={wrong ? { animation: 'inscShake 360ms ease-out both' } : undefined}
      >
        {sequence
          ? sequence.split('').map((letter, index) => {
              const typed = index < typedCount;
              const current = index === typedCount && !done && !wrong;
              const isWrong = wrong != null && index === wrong.pos;
              return (
                <div
                  key={index}
                  className={cn(
                    'insc-anim flex items-center justify-center rounded-[10px] border-2 font-black leading-none',
                    size.box,
                    isWrong
                      ? 'border-red-300 bg-red-600/45 text-red-50 shadow-[0_0_22px_rgba(239,68,68,0.6)]'
                      : typed
                        ? 'border-[#ffe08a] bg-gradient-to-b from-[#e8c98a]/55 to-[#8a5a12]/60 text-[#fff6d6] shadow-[0_0_18px_rgba(255,224,138,0.45)]'
                        : current
                          ? 'border-[#d4b6ff] bg-[#2a1748]/85 text-white'
                          : 'border-[#6f5a99]/55 bg-[#120e1e]/80 text-[#cdbdf0]/80',
                  )}
                  style={{
                    fontFamily: FONT_NUM,
                    animation: current ? 'inscPulse 1.1s ease-in-out infinite' : typed && index === typedCount - 1 ? 'inscPop 160ms ease-out both' : undefined,
                  }}
                >
                  {isWrong ? wrong.key : letter}
                </div>
              );
            })
          : Array.from({ length: count }, (_, index) => (
              <div key={index} className={cn('flex items-center justify-center rounded-[10px] border-2 border-[#6f5a99]/40 bg-[#120e1e]/70 font-black text-[#cdbdf0]/40', size.box)} style={{ fontFamily: FONT_NUM }}>
                ?
              </div>
            ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm font-black">
        {wrong ? (
          <span className="rounded-full border border-red-300/50 bg-red-950/75 px-3 py-1 text-red-100">오타! 새 주문으로 다시 시작해요</span>
        ) : done ? (
          <span className="rounded-full border border-[#ffe08a]/60 bg-[#3a2a0a]/80 px-3 py-1 text-[#ffe08a]">✒ 각인 완성!</span>
        ) : (
          <span className="rounded-full border border-[#c9a6ff]/40 bg-black/55 px-3 py-1 text-[#e6d9ff]">
            {typedCount} / {count}글자
          </span>
        )}
        {mistakes > 0 && <span className="rounded-full border border-white/15 bg-black/55 px-3 py-1 text-white/80">오타 {mistakes}회</span>}
        {statusText && <span className="rounded-full border border-sky-300/30 bg-black/55 px-3 py-1 text-sky-100">{statusText}</span>}
      </div>

      {/* 손가락 위치 안내(키보드 가운데 줄) */}
      {showKeyboard && (
        <div className="mt-1 flex gap-1.5 rounded-[12px] border border-[#2e3a52] bg-[#0b0a14]/80 p-2">
          {HOME_ROW.map((key) => {
            const used = keySet.has(key);
            const next = key === nextKey;
            return (
              <div
                key={key}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-[7px] border text-base font-black md:h-10 md:w-10',
                  !used
                    ? 'border-white/5 bg-white/[0.03] text-white/20'
                    : next
                      ? 'border-[#ffe08a] bg-[#ffe08a]/25 text-[#fff6d6] shadow-[0_0_14px_rgba(255,224,138,0.5)]'
                      : 'border-[#6f5a99]/60 bg-[#1b1430] text-[#d4c4f5]',
                  (key === 'F' || key === 'J') && used && 'underline decoration-2 underline-offset-4',
                  (key === 'G' || key === 'J') && 'ml-2',
                )}
                style={{ fontFamily: FONT_NUM }}
              >
                {key}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
