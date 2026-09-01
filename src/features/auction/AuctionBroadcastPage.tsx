import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { formatAuctionTime, useAuctionCountdown, useLiveAuctionState, useServerDeadlineCountdown } from './useLiveAuction';

export default function AuctionBroadcastPage() {
  const { state, auction, items, currentItem, recentBids, superPass, isLoading, refetch } = useLiveAuctionState(false);
  const finalizeKeyRef = useRef('');
  const superPassResolveKeyRef = useRef('');
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
  const [recentResult, setRecentResult] = useState<any>(null);
  const seenResultRef = useRef<string>('');

  useEffect(() => {
    if (!currentItem || !countdown.isExpired || countdown.isPaused) return;
    const key = `${currentItem.id}:${currentItem.bidding_ends_at}`;
    if (finalizeKeyRef.current === key) return;
    finalizeKeyRef.current = key;
    void studentRpc
      .finalizeLiveAuctionItemIfExpired(supabase, { p_item_id: currentItem.id })
      .then(() => refetch());
  }, [countdown.isExpired, countdown.isPaused, currentItem, refetch]);

  useEffect(() => {
    if (!currentItem || superPass?.status !== 'APPLYING' || !superPassCountdown.isExpired) return;
    const key = `${superPass.round_id}:${superPass.application_ends_at}`;
    if (superPassResolveKeyRef.current === key) return;
    superPassResolveKeyRef.current = key;
    void studentRpc
      .resolveAuctionSuperPassPhaseIfExpired(supabase, { p_item_id: currentItem.id })
      .then(() => refetch());
  }, [currentItem, refetch, superPass, superPassCountdown.isExpired]);


  useEffect(() => {
    const sold = [...items].reverse().find((item) => item.final_status !== null);
    if (!sold) return;
    const key = `${sold.id}:${sold.final_status}:${sold.result?.confirmed_at ?? ''}`;
    if (seenResultRef.current === key) return;
    seenResultRef.current = key;
    setRecentResult(sold);
    const timer = window.setTimeout(() => setRecentResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [items]);

  const enterFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  };

  if (isLoading) {
    return <div className="min-h-screen bg-bg-base flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  const completed = items.filter((item) => item.final_status !== null);

  return (
    <main className="min-h-screen bg-bg-base text-white p-4 lg:p-6 overflow-hidden">
      <header className="flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-sm font-black text-gold tracking-[0.2em] uppercase">B.R.A.N.D LIVE AUCTION</p>
          <h1 className="font-display text-3xl lg:text-5xl text-brand-gradient mt-1">
            {auction ? `${auction.round_number}회차 실시간 경매` : '실시간 경매 대기'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void enterFullscreen()}
          className="px-4 py-2 rounded-card-md border border-line bg-bg-card text-sm font-black text-text-secondary"
        >
          ⛶ 전체 화면
        </button>
      </header>

      {!auction ? (
        <div className="h-[75vh] flex flex-col items-center justify-center border border-line rounded-card-lg bg-bg-card">
          <div className="text-8xl mb-6">🔨</div>
          <p className="font-display text-3xl text-text-primary">교사 화면에서 경매를 시작해주세요</p>
        </div>
      ) : !currentItem ? (
        <div className="h-[75vh] grid grid-cols-[1fr_320px] gap-4">
          <div className="flex flex-col items-center justify-center border border-line rounded-card-lg bg-bg-card">
            <div className="text-8xl mb-6">⏳</div>
            <p className="font-display text-3xl text-text-primary">다음 상품을 준비하고 있습니다</p>
            <p className="text-text-muted mt-3">교사 화면에서 상품 시작 버튼을 눌러주세요.</p>
          </div>
          <CompletedColumn items={completed} />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(220px,0.75fr)_minmax(520px,1.75fr)_minmax(260px,0.9fr)] gap-4 h-[calc(100vh-120px)]">
          <div className="bg-bg-card border border-line rounded-card-lg p-4 overflow-hidden">
            <h2 className="font-display text-xl mb-4">📋 진행 순서</h2>
            <div className="space-y-2 overflow-y-auto h-[calc(100%-48px)] pr-1">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className={cn(
                    'p-3 rounded-card-md border flex items-center gap-3',
                    item.id === currentItem.id ? 'border-gold/60 bg-gold/10' : 'border-line bg-bg-deep/50',
                  )}
                >
                  <span className="w-8 h-8 rounded-full bg-bg-soft grid place-items-center text-sm font-black text-text-muted">{index + 1}</span>
                  <span className="text-3xl">{item.emoji || '🎁'}</span>
                  <div className="min-w-0">
                    <p className="font-black truncate">{item.item_name}</p>
                    <p className="text-xs text-text-muted font-bold">
                      {item.final_status === 'SOLD'
                        ? '낙찰 완료'
                        : item.final_status === 'FAILED_FINAL'
                          ? '최종 유찰'
                          : item.id === currentItem.id
                            ? `${item.current_attempt}차 진행 중`
                            : `${item.current_attempt}차 대기`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <motion.section
            key={`${currentItem.id}-${currentItem.current_attempt}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gradient-to-br from-brand-primary/20 via-bg-card to-gold/15 border border-gold/40 rounded-card-lg flex flex-col overflow-hidden"
          >
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="inline-flex gap-2 mb-4">
                <span className="px-3 py-1 rounded-pill bg-brand-primary/20 text-brand-glow font-black text-sm">
                  {currentItem.current_attempt}차 시도
                </span>
                <span className="px-3 py-1 rounded-pill bg-bg-deep text-text-secondary font-black text-sm">
                  {currentItem.category}
                </span>
                {superPass?.status === 'APPLYING' && (
                  <span className="px-3 py-1 rounded-pill bg-gold/20 text-gold font-black text-sm">🎫 SUPER PASS 신청</span>
                )}
                {superPass?.status === 'PRIORITY_BIDDING' && (
                  <span className="px-3 py-1 rounded-pill bg-brand-primary/30 text-brand-glow font-black text-sm">⚡ SUPER PASS 우선경매</span>
                )}
              </div>
              {currentItem.image_url ? (
                <img src={currentItem.image_url} alt="" className="w-48 h-48 object-cover rounded-card-lg border border-line mb-5" />
              ) : (
                <div className="text-[9rem] leading-none mb-5 drop-shadow-[0_0_40px_rgba(255,196,64,0.45)]">{currentItem.emoji || '🎁'}</div>
              )}
              <h2 className="font-display text-5xl tracking-tight">{currentItem.item_name}</h2>
              {currentItem.description && <p className="text-xl text-text-secondary mt-3 max-w-3xl">{currentItem.description}</p>}
              {currentItem.previous_sale_price !== null && (
                <p className="text-lg text-text-muted mt-3">지난 회차 낙찰가 <strong className="text-text-secondary font-mono">{formatNumber(currentItem.previous_sale_price)} GOLD</strong></p>
              )}
              {superPass?.status === 'APPLYING' && (
                <div className="mt-5 rounded-card-lg border border-gold/35 bg-gold/10 px-6 py-4">
                  <p className="font-display text-2xl text-white">SUPER PASS 우선권 신청 중</p>
                  <p className="text-base text-text-secondary font-bold mt-2">
                    신청자 1명은 최소가 즉시 낙찰 · 2명 이상은 신청자 전용 우선경매
                  </p>
                  <p className="font-mono text-3xl font-black text-gold mt-3">현재 신청 {superPass.applicant_count}명</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 border-t border-line bg-bg-deep/55">
              <div className="p-5 text-center border-r border-line">
                <p className="text-sm text-text-muted font-bold mb-1">{superPass?.status === 'APPLYING' ? '최소 낙찰가' : '현재 최고가'}</p>
                <p className="font-mono text-5xl text-gold font-black tabular-nums">{formatNumber(currentItem.current_price)}</p>
                <p className="text-sm text-text-muted mt-1">GOLD</p>
              </div>
              <div className="p-5 text-center border-r border-line">
                <p className="text-sm text-text-muted font-bold mb-1">{superPass?.status === 'APPLYING' ? 'SUPER PASS 신청자' : '최고 입찰자'}</p>
                <p className="font-display text-3xl text-success truncate mt-4">
                  {superPass?.status === 'APPLYING'
                    ? `${superPass.applicant_count}명`
                    : currentItem.top_bid
                      ? currentItem.top_bid.brand_name || currentItem.top_bid.student_name
                      : '입찰 대기'}
                </p>
              </div>
              <div className="p-5 text-center">
                <p className="text-sm text-text-muted font-bold mb-1">{superPass?.status === 'APPLYING' ? '신청 마감' : '남은 시간'}</p>
                <p className={cn(
                  'font-mono text-6xl font-black tabular-nums mt-1',
                  countdown.isPaused ? 'text-warning' : (superPass?.status === 'APPLYING' ? superPassCountdown.remainingSeconds : countdown.remainingSeconds) <= 5 ? 'text-danger animate-pulse' : 'text-brand-glow',
                )}>
                  {countdown.isPaused ? 'PAUSE' : formatAuctionTime(superPass?.status === 'APPLYING' ? superPassCountdown.remainingSeconds : countdown.remainingSeconds)}
                </p>
              </div>
            </div>
          </motion.section>

          <div className="grid grid-rows-2 gap-4 min-h-0">
            <section className="bg-bg-card border border-line rounded-card-lg p-4 min-h-0 overflow-hidden">
              <h2 className="font-display text-xl mb-3">{superPass?.status === 'APPLYING' ? '🎫 신청 현황' : '⚡ 최근 입찰'}</h2>
              <div className="space-y-2 overflow-y-auto h-[calc(100%-40px)] pr-1">
                {superPass?.status === 'APPLYING' && (
                  <div className="rounded-card-lg border border-gold/30 bg-gold/10 p-5 text-center">
                    <div className="text-5xl">🎫</div>
                    <p className="font-mono text-4xl font-black text-gold mt-3">{superPass.applicant_count}명</p>
                    <p className="text-sm text-text-muted font-bold mt-2">신청자 신원은 공개하지 않습니다.</p>
                  </div>
                )}
                {superPass?.status !== 'APPLYING' && recentBids.filter((bid) => bid.auction_item_id === currentItem.id).slice(0, 10).map((bid, index) => (
                  <div key={bid.id} className={cn(
                    'rounded-card-md px-3 py-2.5 flex items-center justify-between gap-2',
                    index === 0 ? 'bg-gold/15 border border-gold/30' : 'bg-bg-deep/60 border border-line',
                  )}>
                    <span className="font-black truncate">{bid.brand_name || bid.student_name}</span>
                    <span className="font-mono text-gold font-black">{formatNumber(bid.bid_amount)}</span>
                  </div>
                ))}
                {superPass?.status !== 'APPLYING' && recentBids.filter((bid) => bid.auction_item_id === currentItem.id).length === 0 && (
                  <p className="text-text-muted text-center py-10">첫 입찰을 기다리는 중</p>
                )}
              </div>
            </section>
            <CompletedColumn items={completed} compact />
          </div>
        </div>
      )}

      {recentResult && (
        <div className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-3xl rounded-card-lg border border-gold/40 bg-bg-card shadow-card p-6 text-center">
            <div className="text-sm font-black tracking-[0.2em] uppercase text-gold mb-3">최종 확인</div>
            <div className="text-5xl mb-4">{recentResult.emoji || '🎁'}</div>
            <div className="font-display text-4xl text-white">{recentResult.item_name}</div>
            {recentResult.result ? (
              <>
                <div className="text-2xl text-success font-extrabold mt-4">낙찰자 · {recentResult.result.winner_brand_name || recentResult.result.winner_name}</div>
                <div className="font-mono text-4xl text-gold font-black mt-2">{formatNumber(recentResult.result.final_price)} GOLD</div>
              </>
            ) : (
              <div className="text-2xl text-danger font-extrabold mt-4">최종 유찰</div>
            )}
            <button type="button" onClick={() => setRecentResult(null)} className="btn-secondary mt-6">끄기</button>
            <div className="text-xs text-text-muted font-bold mt-2">5초 후 자동으로 닫힙니다.</div>
          </div>
        </div>
      )}

    </main>
  );
}

function CompletedColumn({ items, compact = false }: { items: ReturnType<typeof useLiveAuctionState>['items']; compact?: boolean }) {
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-4 min-h-0 overflow-hidden">
      <h2 className="font-display text-xl mb-3">🏆 낙찰 결과</h2>
      <div className={cn('space-y-2 overflow-y-auto pr-1', compact ? 'h-[calc(100%-40px)]' : 'h-[calc(100%-48px)]')}>
        {[...items].reverse().map((item) => (
          <div key={item.id} className="rounded-card-md bg-bg-deep/60 border border-line p-3 flex gap-3">
            <span className="text-3xl">{item.emoji || '🎁'}</span>
            <div className="min-w-0 flex-1">
              <p className="font-black truncate">{item.item_name}</p>
              {item.result ? (
                <>
                  <p className="text-sm text-success font-bold truncate">{item.result.winner_brand_name || item.result.winner_name}</p>
                  <p className="font-mono text-gold font-black">{formatNumber(item.result.final_price)} GOLD</p>
                </>
              ) : (
                <p className="text-danger font-bold">최종 유찰</p>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-text-muted text-center py-10">아직 낙찰 결과가 없습니다</p>}
      </div>
    </section>
  );
}
