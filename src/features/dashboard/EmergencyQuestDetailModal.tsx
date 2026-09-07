import { useEffect, useState } from 'react';
import { Modal } from '@/components/shared/components';
import { formatNumber } from '@/lib/utils/format';

export type EmergencyQuestDetail = {
  id: number;
  title: string;
  description: string;
  expiresAt: string;
  rewardGold: number;
  rewardBv: number;
  rewardCrystal: number;
  requestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  requestNote?: string | null;
};

type Props = {
  isOpen: boolean;
  quest: EmergencyQuestDetail | null;
  isSubmitting: boolean;
  onClose: () => void;
  onRequestCompletion: () => void | Promise<void>;
};

function formatRemaining(expiresAt: string, nowMs: number) {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - nowMs);
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (remainingMs <= 0) return '종료됨';
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}일 ${remainingHours}시간 남음` : `${days}일 남음`;
  }
  if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
  return `${Math.max(1, minutes)}분 남음`;
}

export function EmergencyQuestDetailModal({
  isOpen,
  quest,
  isSubmitting,
  onClose,
  onRequestCompletion,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  if (!quest) return null;

  const expiresAtMs = new Date(quest.expiresAt).getTime();
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  const pending = quest.requestStatus === 'PENDING';
  const approved = quest.requestStatus === 'APPROVED';
  const rejected = quest.requestStatus === 'REJECTED';
  const disabled = expired || pending || approved || isSubmitting;

  const buttonLabel = isSubmitting
    ? '요청 보내는 중...'
    : pending
      ? '⏳ 선생님 확인 대기 중'
      : approved
        ? '✅ 승인 완료'
        : expired
          ? '⏰ 퀘스트 종료'
          : rejected
            ? '다시 완료 요청 보내기'
            : '완료 요청 보내기';

  const rewards = [
    quest.rewardGold > 0 ? { emoji: '🪙', label: 'GOLD', value: quest.rewardGold } : null,
    quest.rewardCrystal > 0 ? { emoji: '💎', label: 'CRYSTAL', value: quest.rewardCrystal } : null,
    quest.rewardBv > 0 ? { emoji: '⭐', label: 'BV', value: quest.rewardBv } : null,
  ].filter((reward): reward is { emoji: string; label: string; value: number } => reward !== null);

  return (
    <Modal isOpen={isOpen} onClose={isSubmitting ? () => undefined : onClose} title="돌발 퀘스트" emoji="⚡" size="md">
      <div className="space-y-4">
        <section className="rounded-card-lg border border-line-brand bg-gradient-to-br from-danger/15 to-brand-primary/10 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-brand-primary/30 bg-brand-primary/10 px-2.5 py-1 text-[10px] font-black tracking-widest text-brand-glow">
              EMERGENCY QUEST
            </span>
            <span className="rounded-pill border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-extrabold text-white/70">
              ⏱ {formatRemaining(quest.expiresAt, nowMs)}
            </span>
          </div>
          <h3 className="text-lg font-black leading-snug text-white break-keep">{quest.title}</h3>
        </section>

        <section>
          <div className="mb-2 text-[10px] font-black tracking-[0.16em] text-brand-glow">MISSION</div>
          <div className="whitespace-pre-wrap break-words rounded-card-md border border-line bg-bg-card/80 p-4 text-sm font-semibold leading-7 text-text-primary">
            {quest.description}
          </div>
        </section>

        <section>
          <div className="mb-2 text-[10px] font-black tracking-[0.16em] text-brand-glow">REWARD</div>
          {rewards.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {rewards.map((reward) => (
                <div key={reward.label} className="flex items-center gap-2 rounded-card-md border border-line bg-bg-deep/65 px-3 py-2.5">
                  <span className="text-lg">{reward.emoji}</span>
                  <div className="min-w-0">
                    <div className="text-[9px] font-black tracking-wider text-text-muted">{reward.label}</div>
                    <div className="text-sm font-black text-white">+{formatNumber(reward.value)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-card-md border border-line bg-bg-deep/65 px-3 py-2.5 text-xs font-bold text-text-secondary">
              별도 보상 없음
            </div>
          )}
        </section>

        {pending && (
          <div className="rounded-card-md border border-warning/35 bg-warning/10 px-3.5 py-3 text-xs font-bold leading-5 text-warning">
            ⏳ 완료 요청을 보냈습니다. 선생님의 확인을 기다리는 중입니다.
          </div>
        )}

        {approved && (
          <div className="rounded-card-md border border-success/35 bg-success/10 px-3.5 py-3 text-xs font-bold leading-5 text-success">
            ✅ 완료 요청이 승인되었습니다.
          </div>
        )}

        {rejected && (
          <div className="rounded-card-md border border-danger/35 bg-danger/10 px-3.5 py-3">
            <div className="text-xs font-black text-danger">↩️ 이전 완료 요청이 반려되었습니다.</div>
            {quest.requestNote && (
              <div className="mt-1.5 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-text-secondary">
                선생님 메모: {quest.requestNote}
              </div>
            )}
            <div className="mt-1 text-[11px] font-semibold text-text-muted">
              퀘스트를 다시 확인한 뒤 재요청할 수 있습니다.
            </div>
          </div>
        )}

        <div className="border-t border-line pt-4">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
            <button type="button" onClick={onClose} disabled={isSubmitting}
              className="rounded-pill border border-line bg-bg-deep px-4 py-3 text-sm font-black text-text-secondary transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
              닫기
            </button>
            <button type="button" onClick={() => { void onRequestCompletion(); }} disabled={disabled}
              className="rounded-pill bg-gradient-to-r from-brand-primary to-gold px-4 py-3 text-sm font-black text-white shadow-brand-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
              {buttonLabel}
            </button>
          </div>
          {!pending && !approved && !expired && (
            <p className="mt-2 text-center text-[11px] font-semibold leading-5 text-text-muted">
              퀘스트를 실제로 수행한 뒤 완료 요청을 보내세요. 보상은 선생님 승인 후 지급됩니다.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
