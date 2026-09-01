import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EmptyState, LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { formatNumber } from '@/lib/utils/format';
import { useStudentId } from '@/stores/auth_store';
import { useToastStore } from '@/stores/ui_store';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils/cn';
import { formatAuctionTime, useAuctionCountdown, useLiveAuctionState, useServerDeadlineCountdown } from './useLiveAuction';
import type { AuctionSuperPassState, LiveAuctionItem } from './types';

export default function StudentAuctionView() {
  const studentId = useStudentId();
  const { wallet } = useWallet();
  const { state, auction, items, currentItem, recentBids, superPass, isLoading, refetch } = useLiveAuctionState(false);
  const { call, isLoading: isSubmitting } = useRpcCall();
  const showToast = useToastStore((s) => s.show);
  const [bidAmount, setBidAmount] = useState<number | ''>('');
  const finalizeKeyRef = useRef('');
  const superPassResolveKeyRef = useRef('');
  const lastOwnSuperPassRef = useRef<{ roundId: number; itemId: number; attempt: number } | null>(null);
  const passOutcomeNotifiedRef = useRef(new Set<number>());

  const countdown = useAuctionCountdown(
    state?.server_now,
    currentItem,
    auction?.paused_at,
    auction?.pause_remaining_seconds,
  );

  const superPassCountdown = useServerDeadlineCountdown(
    state?.server_now,
    superPass?.status === 'APPLYING' ? superPass.application_ends_at : null,
  );

  useEffect(() => {
    if (!currentItem) {
      setBidAmount('');
      return;
    }
    setBidAmount(Math.max(currentItem.current_price + 1, Math.ceil(currentItem.current_price * 1.1)));
  }, [currentItem?.id, currentItem?.current_price]);

  useEffect(() => {
    if (!currentItem || !countdown.isExpired || countdown.isPaused) return;
    const key = `${currentItem.id}:${currentItem.bidding_ends_at}`;
    if (finalizeKeyRef.current === key) return;
    finalizeKeyRef.current = key;

    void call(
      () => studentRpc.finalizeLiveAuctionItemIfExpired(supabase, { p_item_id: currentItem.id }),
      { silent: true, onSuccess: () => void refetch() },
    );
  }, [call, countdown.isExpired, countdown.isPaused, currentItem, refetch]);

  useEffect(() => {
    if (!currentItem || superPass?.status !== 'APPLYING' || !superPassCountdown.isExpired) return;
    const key = `${superPass.round_id}:${superPass.application_ends_at}`;
    if (superPassResolveKeyRef.current === key) return;
    superPassResolveKeyRef.current = key;

    void call(
      () => studentRpc.resolveAuctionSuperPassPhaseIfExpired(supabase, { p_item_id: currentItem.id }),
      { silent: true, onSuccess: () => void refetch() },
    );
  }, [call, currentItem, refetch, superPass, superPassCountdown.isExpired]);

  useEffect(() => {
    if (currentItem && superPass && (superPass.current_student_applied || superPass.current_student_priority_eligible)) {
      lastOwnSuperPassRef.current = {
        roundId: superPass.round_id,
        itemId: currentItem.id,
        attempt: superPass.attempt_number,
      };
    }

    const last = lastOwnSuperPassRef.current;
    if (!last || passOutcomeNotifiedRef.current.has(last.roundId)) return;

    if (superPass?.round_id === last.roundId) {
      if (superPass.current_student_entry_status === 'INVALID_RELEASED') {
        passOutcomeNotifiedRef.current.add(last.roundId);
        showToast({
          title: 'SUPER PASS 반환',
          description: '정산 조건이 충족되지 않아 예약했던 PASS가 반환되었습니다.',
          variant: 'info',
        });
      }
      return;
    }

    const item = items.find((candidate) => candidate.id === last.itemId);
    if (!item) return;
    const attemptAdvanced = item.current_attempt > last.attempt;
    const finished = item.final_status !== null;
    if (!attemptAdvanced && !finished && currentItem?.id === last.itemId) return;

    passOutcomeNotifiedRef.current.add(last.roundId);
    const won = item.final_status === 'SOLD' && item.result?.winner_student_id === studentId;
    showToast({
      title: won ? 'SUPER PASS 소진' : 'SUPER PASS 반환',
      description: won
        ? '우선권으로 낙찰되어 예약했던 SUPER PASS 1개가 소진되었습니다.'
        : '이번 시도의 승자가 아니므로 예약했던 SUPER PASS가 반환되었습니다.',
      variant: won ? 'success' : 'info',
    });
  }, [currentItem, items, showToast, studentId, superPass]);

  const quickAmount = currentItem
    ? Math.max(currentItem.current_price + 1, Math.ceil(currentItem.current_price * 1.1))
    : 0;
  const amTopBidder = Boolean(currentItem?.top_bid && currentItem.top_bid.student_id === studentId);
  const reservedGold = amTopBidder ? currentItem?.current_price ?? 0 : 0;
  const availableGold = Math.max(0, (wallet?.gold ?? 0) - reservedGold);
  const isApplyingSuperPass = superPass?.status === 'APPLYING';
  const isPriorityBidding = superPass?.status === 'PRIORITY_BIDDING';
  const canBid = Boolean(
    currentItem &&
      studentId &&
      currentItem.bidding_ends_at &&
      !isApplyingSuperPass &&
      (!isPriorityBidding || superPass?.current_student_priority_eligible) &&
      !auction?.paused_at &&
      !countdown.isExpired &&
      !amTopBidder,
  );

  const placeBid = async (quick: boolean) => {
    if (!currentItem || !studentId) return;
    const amount = quick ? null : Number(bidAmount);
    await call(
      () =>
        studentRpc.placeLiveAuctionBid(supabase, {
          p_auction_item_id: currentItem.id,
          p_student_id: studentId,
          p_bid_amount: amount,
          p_quick_bid: quick,
        }),
      {
        successTitle: quick ? '즉시 입찰 성공' : '입찰 성공',
        successDescription: `${formatNumber(quick ? quickAmount : Number(amount))} GOLD`,
        onSuccess: () => void refetch(),
      },
    );
  };

  const applySuperPass = async () => {
    if (!currentItem) return;
    await call(
      () => studentRpc.applyAuctionSuperPass(supabase, { p_item_id: currentItem.id }),
      {
        successTitle: 'SUPER PASS 신청 완료',
        successDescription: 'PASS 1개가 예약되었습니다. 낙찰자만 최종 소진됩니다.',
        onSuccess: () => void refetch(),
      },
    );
  };

  if (isLoading) {
    return <div className="py-12 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (!auction) {
    return (
      <EmptyState
        emoji="🔨"
        title="진행 중인 실시간 경매가 없어요"
        description="선생님이 경매를 시작하면 이 화면에 상품과 타이머가 나타납니다."
      />
    );
  }

  const completedItems = items.filter((item) => item.final_status !== null);

  return (
    <div className="space-y-3">
      <div className="rounded-card-md border border-gold/30 bg-gold/10 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black text-gold">🔨 {auction.round_number}회차 실시간 경매</p>
          <p className="text-2xs text-text-muted font-bold mt-0.5">
            마지막 최고 입찰 뒤 최소 {auction.extension_seconds}초가 보장됩니다.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-black text-white">보유 {formatNumber(wallet?.gold ?? 0)} GOLD</p>
          {reservedGold > 0 && (
            <p className="text-2xs text-warning font-bold">최고 입찰 예약 {formatNumber(reservedGold)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(180px,0.75fr)_minmax(340px,1.6fr)_minmax(200px,0.9fr)] gap-3">
        <AuctionSequence items={items} currentItemId={currentItem?.id ?? null} />

        <div className="min-w-0">
          {!currentItem ? (
            <div className="bg-bg-card border border-line rounded-card-lg p-8 min-h-[360px] flex items-center justify-center">
              <EmptyState
                emoji="⏳"
                title="다음 상품을 기다리는 중"
                description="선생님이 상품을 시작하면 입찰 버튼이 활성화됩니다."
              />
            </div>
          ) : (
            <CurrentAuctionCard
              item={currentItem}
              remainingSeconds={countdown.remainingSeconds}
              isPaused={countdown.isPaused}
              bidAmount={bidAmount}
              setBidAmount={setBidAmount}
              quickAmount={quickAmount}
              canBid={canBid}
              amTopBidder={amTopBidder}
              availableGold={availableGold}
              isSubmitting={isSubmitting}
              onQuickBid={() => void placeBid(true)}
              onCustomBid={() => void placeBid(false)}
              recentBids={recentBids.filter((bid) => bid.auction_item_id === currentItem.id).slice(0, 6)}
              superPass={superPass}
              superPassRemainingSeconds={superPassCountdown.remainingSeconds}
              superPassExpired={superPassCountdown.isExpired}
              walletGold={wallet?.gold ?? 0}
              onApplySuperPass={() => void applySuperPass()}
            />
          )}
        </div>

        <CompletedAuctionList items={completedItems} />
      </div>
    </div>
  );
}

function AuctionSequence({ items, currentItemId }: { items: LiveAuctionItem[]; currentItemId: number | null }) {
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-3">
      <h3 className="font-display text-sm text-white mb-3">📋 진행 순서</h3>
      <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
        {items.map((item, index) => {
          const status = item.final_status === 'SOLD'
            ? '낙찰'
            : item.final_status === 'FAILED_FINAL'
              ? '최종 유찰'
              : item.id === currentItemId
                ? '진행 중'
                : item.current_attempt > 1
                  ? `${item.current_attempt}차 대기`
                  : '대기';
          return (
            <div
              key={item.id}
              className={cn(
                'rounded-card-md border p-2.5 flex items-center gap-2 transition-all',
                item.id === currentItemId
                  ? 'border-gold/50 bg-gold/10'
                  : 'border-line bg-bg-deep/40',
              )}
            >
              <span className="w-6 h-6 rounded-full bg-bg-soft flex items-center justify-center text-2xs font-black text-text-muted">
                {index + 1}
              </span>
              <span className="text-xl">{item.emoji || '🎁'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold text-text-primary truncate">{item.item_name}</p>
                <p className="text-2xs text-text-muted font-bold">{status}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface CurrentAuctionCardProps {
  item: LiveAuctionItem;
  remainingSeconds: number;
  isPaused: boolean;
  bidAmount: number | '';
  setBidAmount: (value: number | '') => void;
  quickAmount: number;
  canBid: boolean;
  amTopBidder: boolean;
  availableGold: number;
  isSubmitting: boolean;
  onQuickBid: () => void;
  onCustomBid: () => void;
  superPass: AuctionSuperPassState | null;
  superPassRemainingSeconds: number;
  superPassExpired: boolean;
  walletGold: number;
  onApplySuperPass: () => void;
  recentBids: Array<{
    id: number;
    student_name: string;
    brand_name: string | null;
    bid_amount: number;
    created_at: string;
    invalidated_at: string | null;
  }>;
}

function CurrentAuctionCard(props: CurrentAuctionCardProps) {
  const {
    item, remainingSeconds, isPaused, bidAmount, setBidAmount, quickAmount,
    canBid, amTopBidder, availableGold, isSubmitting, onQuickBid, onCustomBid, recentBids,
    superPass, superPassRemainingSeconds, superPassExpired, walletGold, onApplySuperPass,
  } = props;
  const enteredAmount = Number(bidAmount || 0);
  const customValid = canBid && enteredAmount > item.current_price && enteredAmount <= availableGold;

  return (
    <motion.section
      key={`${item.id}-${item.current_attempt}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden bg-gradient-to-br from-brand-primary/15 via-bg-card to-gold/10 border border-gold/35 rounded-card-lg"
    >
      <div className="p-5 text-center border-b border-line">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="rounded-pill bg-brand-primary/20 text-brand-glow px-2 py-1 text-2xs font-black">
            {item.current_attempt}차 시도
          </span>
          <span className="rounded-pill bg-bg-deep text-text-secondary px-2 py-1 text-2xs font-black">
            {item.category}
          </span>
          {superPass?.status === 'APPLYING' && (
            <span className="rounded-pill bg-gold/15 text-gold px-2 py-1 text-2xs font-black">SUPER PASS 신청</span>
          )}
          {superPass?.status === 'PRIORITY_BIDDING' && (
            <span className="rounded-pill bg-brand-primary/25 text-brand-glow px-2 py-1 text-2xs font-black">SUPER PASS 우선경매</span>
          )}
        </div>
        {item.image_url ? (
          <img src={item.image_url} alt="" className="w-28 h-28 object-cover rounded-card-lg mx-auto mb-3 border border-line" />
        ) : (
          <div className="text-7xl mb-3 drop-shadow-[0_0_24px_rgba(255,196,64,0.35)]">{item.emoji || '🎁'}</div>
        )}
        <h2 className="font-display text-2xl text-white tracking-tight">{item.item_name}</h2>
        {item.description && <p className="text-xs text-text-secondary mt-2 break-keep">{item.description}</p>}
      </div>

      <div className="grid grid-cols-2 border-b border-line">
        <div className="p-4 text-center border-r border-line">
          <p className="text-2xs font-bold text-text-muted mb-1">{superPass?.status === 'APPLYING' ? '최소 낙찰가' : '현재 최고가'}</p>
          <p className="font-mono text-2xl font-black text-gold">{formatNumber(item.current_price)}</p>
          <p className="text-2xs text-text-muted">GOLD</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xs font-bold text-text-muted mb-1">{superPass?.status === 'APPLYING' ? '신청 마감' : '남은 시간'}</p>
          <p className={cn(
            'font-mono text-3xl font-black tabular-nums',
            isPaused ? 'text-warning' : (superPass?.status === 'APPLYING' ? superPassRemainingSeconds : remainingSeconds) <= 5 ? 'text-danger animate-pulse' : 'text-brand-glow',
          )}>
            {isPaused ? 'PAUSE' : formatAuctionTime(superPass?.status === 'APPLYING' ? superPassRemainingSeconds : remainingSeconds)}
          </p>
        </div>
      </div>

      <div className="p-4">
        {item.previous_sale_price !== null && (
          <div className="rounded-card-md p-2.5 text-center mb-3 border border-line bg-bg-deep/50">
            <span className="text-2xs text-text-muted font-bold">지난 회차 낙찰가 </span>
            <strong className="font-mono text-xs text-text-secondary">{formatNumber(item.previous_sale_price)} GOLD</strong>
          </div>
        )}

        {superPass?.status === 'APPLYING' ? (
          <div className="space-y-3">
            <div className="rounded-card-md border border-gold/35 bg-gold/10 p-4 text-center">
              <p className="font-display text-lg text-white">🎫 SUPER PASS 우선권 신청</p>
              <p className="text-xs text-text-secondary font-bold mt-1">
                신청자가 1명이면 {formatNumber(superPass.minimum_price)} GOLD에 즉시 낙찰, 2명 이상이면 신청자끼리 먼저 경쟁합니다.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-card-md bg-bg-deep/60 border border-line p-2.5">
                  <p className="text-2xs text-text-muted font-bold">현재 신청자</p>
                  <p className="font-mono text-xl font-black text-gold">{superPass.applicant_count}명</p>
                </div>
                <div className="rounded-card-md bg-bg-deep/60 border border-line p-2.5">
                  <p className="text-2xs text-text-muted font-bold">내 SUPER PASS</p>
                  <p className="font-mono text-xl font-black text-brand-glow">{superPass.available_quantity}개</p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onApplySuperPass}
              disabled={isSubmitting || superPassExpired || superPass.current_student_applied || superPass.available_quantity < 1 || walletGold < superPass.minimum_price}
              className="w-full py-3.5 rounded-card-md bg-gradient-to-r from-gold/90 to-brand-primary text-white font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {superPass.current_student_applied
                ? '✓ SUPER PASS 신청 완료 · 1개 예약 중'
                : superPass.available_quantity < 1
                  ? 'SUPER PASS가 없습니다'
                  : walletGold < superPass.minimum_price
                    ? '최소 낙찰가 이상의 GOLD가 필요합니다'
                    : superPassExpired
                      ? '신청 마감 처리 중…'
                      : '🎫 SUPER PASS 신청'}
            </button>
            <p className="text-2xs text-text-muted font-bold text-center">
              신청 시 PASS 1개만 예약됩니다. 승자만 소진되고 나머지는 자동 반환됩니다.
            </p>
          </div>
        ) : (
          <>
            {superPass?.status === 'PRIORITY_BIDDING' && !superPass.current_student_priority_eligible && (
              <div className="rounded-card-md p-3 text-center mb-3 border border-warning/35 bg-warning/10">
                <p className="text-sm font-black text-warning">SUPER PASS 신청자 전용 우선경매</p>
                <p className="text-2xs text-text-secondary font-bold mt-1">신청하지 않은 학생은 이번 우선경매에 입찰할 수 없습니다.</p>
              </div>
            )}
            {superPass?.status === 'PRIORITY_BIDDING' && superPass.current_student_priority_eligible && (
              <div className="rounded-card-md p-3 text-center mb-3 border border-success/35 bg-success-bg">
                <p className="text-sm font-black text-success">✓ 우선 입찰 자격 활성</p>
                <p className="text-2xs text-text-secondary font-bold mt-1">예약한 SUPER PASS는 패배 시 자동 반환됩니다.</p>
              </div>
            )}
            <div className={cn(
              'rounded-card-md p-3 text-center mb-3 border',
              amTopBidder ? 'bg-success-bg border-success/40' : 'bg-bg-deep/70 border-line',
            )}>
              <p className="text-2xs font-bold text-text-muted">현재 최고 입찰자</p>
              <p className={cn('text-sm font-black mt-1', amTopBidder ? 'text-success' : 'text-text-primary')}>
                {item.top_bid
                  ? `${item.top_bid.brand_name || item.top_bid.student_name}${amTopBidder ? ' — 나' : ''}`
                  : '아직 입찰자가 없습니다'}
              </p>
            </div>

            <button
              type="button"
              onClick={onQuickBid}
              disabled={!canBid || isSubmitting || quickAmount > availableGold}
              className="w-full py-3 rounded-card-md bg-gradient-to-r from-brand-primary to-gold text-white font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⚡ 즉시 입찰 · {formatNumber(quickAmount)} GOLD
            </button>

            <div className="flex gap-2 mt-2">
              <input
                type="number"
                value={bidAmount}
                onChange={(event) => setBidAmount(event.target.value === '' ? '' : Number(event.target.value))}
                min={item.current_price + 1}
                max={10_000_000}
                disabled={superPass?.status === 'PRIORITY_BIDDING' && !superPass.current_student_priority_eligible}
                className="login-input font-mono flex-1 min-w-0 disabled:opacity-40"
                aria-label="직접 입찰가"
              />
              <button
                type="button"
                onClick={onCustomBid}
                disabled={!customValid || isSubmitting}
                className="px-4 rounded-card-md bg-bg-soft border border-brand-primary/50 text-brand-glow text-xs font-black disabled:opacity-40"
              >
                이 가격으로 입찰
              </button>
            </div>
            <p className="text-2xs text-text-muted font-bold mt-2 text-center">
              사용 가능 {formatNumber(availableGold)} GOLD · 최고 입찰액은 정산까지 예약됩니다.
            </p>
          </>
        )}
      </div>

      {recentBids.length > 0 && (
        <div className="border-t border-line p-4">
          <h3 className="text-xs font-black text-text-secondary mb-2">최근 입찰</h3>
          <AnimatePresence initial={false}>
            <div className="space-y-1.5">
              {recentBids.map((bid, index) => (
                <motion.div
                  key={bid.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    'flex items-center justify-between text-xs rounded-card-md px-2.5 py-2',
                    index === 0 ? 'bg-gold/10 text-gold' : 'bg-bg-deep/50 text-text-secondary',
                  )}
                >
                  <span className="font-bold truncate mr-2">{bid.brand_name || bid.student_name}</span>
                  <span className="font-mono font-black">{formatNumber(bid.bid_amount)}</span>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  );
}

function CompletedAuctionList({ items }: { items: LiveAuctionItem[] }) {
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-3">
      <h3 className="font-display text-sm text-white mb-3">🏆 종료된 상품</h3>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-8">아직 종료된 상품이 없어요.</p>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {[...items].reverse().map((item) => (
            <div key={item.id} className="bg-bg-deep/50 border border-line rounded-card-md p-2.5">
              <div className="flex items-start gap-2">
                <span className="text-xl">{item.emoji || '🎁'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-text-primary truncate">{item.item_name}</p>
                  {item.result ? (
                    <>
                      <p className="text-2xs text-success font-bold mt-0.5">
                        {item.result.winner_brand_name || item.result.winner_name}
                      </p>
                      <p className="font-mono text-xs text-gold font-black">{formatNumber(item.result.final_price)} GOLD</p>
                    </>
                  ) : (
                    <p className="text-2xs text-danger font-bold mt-1">최종 유찰</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
