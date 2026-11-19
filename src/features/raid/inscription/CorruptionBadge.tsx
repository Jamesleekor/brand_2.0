// RAID_INSCRIPTION_V1_20261118 — 「타락」 표시
// * 내가 타락 중: 화면 가장자리를 보라색으로 물들이고, 남은 시간과 "공격하면 보스가 회복돼요" 경고를 띄운다.
// * 다른 친구가 타락 중: 작은 알림 칩만 띄운다.
// 그리기만 한다(pointer-events: none). 회복 처리는 서버가 한다.
import type { RaidCorruptionPublicState } from '@/lib/rpc/raid_student_rpc';
import { parseServerMs } from './inscriptionCore';

export default function CorruptionBadge({
  corruption,
  myParticipantId,
  serverNow,
}: {
  corruption: RaidCorruptionPublicState | null | undefined;
  myParticipantId: number | null;
  serverNow: number;
}) {
  if (!corruption) return null;
  const label = corruption.label || '타락';
  const started = (corruption.active ?? []).filter((entry) => {
    const startsAt = parseServerMs(entry.starts_at);
    const until = parseServerMs(entry.until);
    return startsAt != null && until != null && startsAt <= serverNow && serverNow < until;
  });

  const meStarts = parseServerMs(corruption.me?.starts_at);
  const meUntil = parseServerMs(corruption.me?.until);
  const meActive = meStarts != null && meUntil != null && meStarts <= serverNow && serverNow < meUntil;
  const others = started.filter((entry) => entry.participant_id !== myParticipantId);
  if (!meActive && others.length === 0) return null;

  return (
    <>
      <style>{'@keyframes corruptPulse{0%,100%{opacity:.85}50%{opacity:.55}}@media (prefers-reduced-motion: reduce){.corrupt-anim{animation:none!important}}'}</style>
      {meActive && meUntil != null && (
        <>
          <div
            className="corrupt-anim pointer-events-none absolute inset-0 z-[34]"
            style={{
              boxShadow: 'inset 0 0 120px 30px rgba(126,34,206,0.75), inset 0 0 40px 6px rgba(239,68,68,0.35)',
              animation: 'corruptPulse 1.4s ease-in-out infinite',
            }}
          />
          <div className="pointer-events-none absolute left-1/2 top-[19%] z-[37] -translate-x-1/2 px-3">
            <div className="rounded-card-lg border-2 border-[#c9a6ff] bg-[#1b0f2e]/90 px-5 py-2.5 text-center shadow-[0_0_36px_rgba(176,120,255,0.6)]">
              <div className="text-lg font-black text-[#f1e8ff]">
                😈 {label} 상태 · <span className="tabular-nums">{Math.max(0, (meUntil - serverNow) / 1000).toFixed(1)}</span>초
              </div>
              <div className="mt-0.5 text-sm font-black text-[#ffb4a8]">지금 공격하면 보스가 회복돼요! 잠시 손을 멈추세요.</div>
            </div>
          </div>
        </>
      )}
      {!meActive && others.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-[19%] z-[37] -translate-x-1/2">
          <div className="rounded-full border border-[#c9a6ff]/70 bg-[#1b0f2e]/85 px-3 py-1 text-xs font-black text-[#e6d9ff]">
            😈 {label} 중 {others.length}명 · {others.map((entry) => entry.student_name ?? '모험가').slice(0, 4).join(', ')}{others.length > 4 ? ' 외' : ''}
          </div>
        </div>
      )}
    </>
  );
}

/** 지금 내가 타락 중인지(공격 예상 대미지 숫자를 띄우지 않을 때 쓴다) */
export function isMyCorruptionActive(corruption: RaidCorruptionPublicState | null | undefined, serverNow: number): boolean {
  const startsAt = parseServerMs(corruption?.me?.starts_at);
  const until = parseServerMs(corruption?.me?.until);
  return startsAt != null && until != null && startsAt <= serverNow && serverNow < until;
}
