import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { TeacherShell, StatCard } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { studentRpc, teacherRpc } from '@/lib/rpc/student_rpc';
import { formatNumber } from '@/lib/utils/format';
import { useClassroomId } from '@/stores/auth_store';
import { useToastStore } from '@/stores/ui_store';
import { cn } from '@/lib/utils/cn';
import { formatAuctionTime, useAuctionCountdown, useLiveAuctionState } from '@/features/auction/useLiveAuction';
import type { LiveAuctionItem } from '@/features/auction/types';

function rpcErrorMessage(result: unknown, fallback = '서버가 요청을 처리하지 못했습니다.'): string {
  if (result && typeof result === 'object' && 'error' in result) {
    const value = (result as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

export default function AuctionAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { state, auction, items, currentItem, recentBids, isLoading, isError, error, refetch } = useLiveAuctionState(true);
  const { call, isLoading: isMutating } = useRpcCall();
  const showToast = useToastStore((s) => s.show);
  const [createOpen, setCreateOpen] = useState(false);
  const [itemEditor, setItemEditor] = useState<{ mode: 'add' | 'edit'; item?: LiveAuctionItem } | null>(null);
  const [roundSummary, setRoundSummary] = useState<LiveAuctionItem[] | null>(null);
  const [auctionActionError, setAuctionActionError] = useState<string | null>(null);
  const [criticalBusy, setCriticalBusy] = useState(false);
  const [startRoundConfirmOpen, setStartRoundConfirmOpen] = useState(false);
  const [pendingStartItem, setPendingStartItem] = useState<LiveAuctionItem | null>(null);
  const [itemResult, setItemResult] = useState<{ itemName:string; winnerName:string|null; finalPrice:number|null; status:string } | null>(null);
  const [historyDetailId, setHistoryDetailId] = useState<number | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const openCreateAuction = () => {
    // 버튼 클릭은 절대 조용히 실패하지 않는다. 학급 컨텍스트 검증은 모달 내부에서 한다.
    setCreateOpen(true);
  };
  const finalizeKeyRef = useRef('');

  const countdown = useAuctionCountdown(
    state?.server_now,
    currentItem,
    auction?.paused_at,
    auction?.pause_remaining_seconds,
  );

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

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['live-auction-state', classroomId] });
    void queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['auction-history', classroomId] });
  };


  const historyQuery = useQuery({
    queryKey: ['auction-history', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const result = await teacherRpc.getAuctionHistory(supabase, { p_classroom_id: classroomId! });
      if (!result.success) throw new Error(rpcErrorMessage(result));
      return result.data ?? [];
    },
  });

  // 경매 시작 계열은 공통 toast hook에만 의존하지 않는다.
  // 클릭 → 앱 내부 확인창 → RPC → 서버 재조회 → 성공/실패 표시를 한 경로에서 보장한다.
  const runCriticalAuctionAction = async (
    label: string,
    rpc: () => Promise<any>,
    successTitle: string,
  ): Promise<boolean> => {
    if (criticalBusy) return false;
    setCriticalBusy(true);
    setAuctionActionError(null);
    try {
      const result = await rpc();
      if (!result?.success) {
        const message = rpcErrorMessage(result);
        setAuctionActionError(`${label}: ${message}`);
        showToast({ title: `${label} 실패`, description: message, variant: 'error' });
        return false;
      }
      showToast({ title: successTitle, variant: 'success' });
      await refetch();
      invalidate();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuctionActionError(`${label}: ${message}`);
      showToast({ title: `${label} 오류`, description: message, variant: 'error' });
      return false;
    } finally {
      setCriticalBusy(false);
    }
  };

  if (isLoading) {
    return <TeacherShell><div className="py-16 flex justify-center"><LoadingSpinner size="lg" /></div></TeacherShell>;
  }
  if (isError) {
    return <TeacherShell><div className="bg-danger-bg border border-danger/40 rounded-card-lg p-5"><h2 className="font-display text-lg text-white">경매 상태를 불러오지 못했습니다</h2><p className="text-sm text-text-primary mt-2 break-all">{error instanceof Error ? error.message : '알 수 없는 오류'}</p><button type="button" onClick={() => void refetch()} className="btn-secondary mt-4">다시 불러오기</button></div></TeacherShell>;
  }

  const completedCount = items.filter((item) => item.final_status !== null).length;
  const pendingItems = items.filter((item) => item.final_status === null && !item.is_current);
  const canComplete = Boolean(auction && auction.status === 'IN_PROGRESS' && !currentItem && items.length > 0 && completedCount === items.length);

  return (
    <TeacherShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-brand-gradient tracking-tight">🔨 실시간 온라인 경매</h1>
            <p className="text-sm text-text-secondary font-bold mt-1">
              서버 타이머 · 실시간 입찰 · GOLD 예약 · 원자적 낙찰
            </p>
          </div>
          <div className="flex gap-2">
            {auction?.status === 'IN_PROGRESS' && (
              <button
                type="button"
                onClick={() => window.open('/teacher/auction/screen', '_blank', 'noopener,noreferrer')}
                className="btn-secondary"
              >
                🖥️ 중계 화면
              </button>
            )}
            {!auction && (
              <button type="button" onClick={openCreateAuction} className="btn-primary">
                + 새 경매 준비
              </button>
            )}
          </div>
        </div>

        {auctionActionError && (
          <div className="bg-danger-bg border border-danger/50 rounded-card-md p-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-danger">⚠️ 경매 제어 오류</div>
              <div className="text-sm text-white mt-1 break-all">{auctionActionError}</div>
            </div>
            <button type="button" onClick={() => setAuctionActionError(null)} className="text-white/80 text-sm font-black">닫기</button>
          </div>
        )}

        {!auction ? (
          <div className="bg-bg-card border border-line rounded-card-lg">
            <EmptyState
              emoji="📅"
              title="준비 중이거나 진행 중인 경매가 없습니다"
              description="경매 회차를 만든 뒤 상품을 등록하고 시작하세요."
              action={<button type="button" onClick={openCreateAuction} className="btn-primary">새 경매 준비</button>}
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard emoji="📦" label="전체 상품" value={items.length} color="bv" />
              <StatCard emoji="⚡" label="진행 중" value={currentItem ? 1 : 0} color="gold" />
              <StatCard emoji="✅" label="종료" value={completedCount} color="success" />
              <StatCard emoji="⏳" label="대기" value={pendingItems.length} color="crystal" />
              <StatCard emoji="🔁" label="상태 버전" value={auction.state_version} color="bv" />
            </div>

            <section className="bg-bg-card border border-line rounded-card-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-2xs font-black px-2 py-1 rounded-pill',
                    auction.status === 'SCHEDULED' ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success',
                  )}>
                    {auction.status === 'SCHEDULED' ? '준비 중' : '진행 중'}
                  </span>
                  <h2 className="font-display text-lg text-white">{auction.round_number}회차 · {auction.school_year}</h2>
                </div>
                <p className="text-xs text-text-muted font-bold mt-1">
                  기본 {auction.initial_duration_seconds}초 · 마지막 입찰 최소 {auction.extension_seconds}초 보장
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {auction.status === 'SCHEDULED' && (
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => {
                      if (!confirm('준비 중인 경매 회차와 등록 상품을 모두 삭제할까요?')) return;
                      void call(
                        () => teacherRpc.deleteScheduledAuction(supabase, { p_auction_id: auction.id }),
                        { successTitle: '준비 경매 삭제 완료', onSuccess: invalidate },
                      );
                    }}
                    className="py-2.5 px-4 rounded-card-md border border-danger/40 bg-danger-bg text-danger text-sm font-black"
                  >
                    회차 삭제
                  </button>
                )}
                {auction.status === 'SCHEDULED' && (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      type="button"
                      disabled={criticalBusy}
                      onClick={() => {
                        setAuctionActionError(null);
                        if (items.length === 0) {
                          showToast({ title: '경매 상품을 먼저 등록해주세요', description: '상품이 1개 이상 있어야 경매 회차를 시작할 수 있습니다.', variant: 'warning' });
                          return;
                        }
                        setStartRoundConfirmOpen(true);
                      }}
                      className="btn-primary"
                    >
                      🚀 경매 회차 시작
                    </button>
                    {items.length === 0 && <span className="text-xs text-warning font-bold">상품 1개 이상 등록 후 시작</span>}
                  </div>
                )}
                {canComplete && (
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => {
                      if (!confirm('모든 상품이 종료되었습니다. 이번 경매를 완료 처리할까요?')) return;
                      void call(
                        () => teacherRpc.completeLiveAuction(supabase, { p_auction_id: auction.id }),
                        { successTitle: '경매 완료', onSuccess: () => { setRoundSummary(items.filter((item) => item.final_status !== null)); invalidate(); } },
                      );
                    }}
                    className="btn-primary"
                  >
                    🏁 경매 완료
                  </button>
                )}
              </div>
            </section>

            {currentItem && (
              <TeacherCurrentItem
                item={currentItem}
                remainingSeconds={countdown.remainingSeconds}
                isPaused={countdown.isPaused}
                recentBids={recentBids.filter((bid) => bid.auction_item_id === currentItem.id)}
                isMutating={isMutating}
                onPause={() => void call(
                  () => teacherRpc.pauseLiveAuctionItem(supabase, { p_item_id: currentItem.id }),
                  { successTitle: '경매 일시정지', onSuccess: invalidate },
                )}
                onResume={() => void call(
                  () => teacherRpc.resumeLiveAuctionItem(supabase, { p_item_id: currentItem.id }),
                  { successTitle: '경매 재개', onSuccess: invalidate },
                )}
                onCloseNow={() => {
                  if (!confirm('현재 상태로 즉시 종료할까요? 최고 입찰자가 있으면 즉시 낙찰됩니다.')) return;
                  const snapshot = currentItem;
                  void call(
                    () => teacherRpc.closeLiveAuctionItemNow(supabase, { p_item_id: snapshot.id }),
                    { successTitle: '상품 정산 완료', onSuccess: (result:any) => {
                      const sold = result?.status === 'SOLD';
                      void (async () => {
                        let winnerName: string | null = null;
                        if (sold && result?.winner_student_id) {
                          const { data: winner } = await supabase.from('students').select('name,brand_name').eq('id', Number(result.winner_student_id)).maybeSingle();
                          winnerName = winner?.brand_name || winner?.name || snapshot.top_bid?.brand_name || snapshot.top_bid?.student_name || null;
                        }
                        setItemResult({ itemName:snapshot.item_name, winnerName, finalPrice:sold?Number(result?.final_price??snapshot.current_price):null, status:result?.status??'UNKNOWN' });
                      })();
                      invalidate();
                    } },
                  );
                }}
                onFail={() => {
                  if (!confirm('입찰이 없는 현재 시도를 유찰 처리할까요?')) return;
                  void call(
                    () => teacherRpc.failLiveAuctionItem(supabase, { p_item_id: currentItem.id, p_note: '교사 수동 유찰' }),
                    { successTitle: '유찰 처리 완료', onSuccess: invalidate },
                  );
                }}
              />
            )}

            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="font-display text-lg text-white">📋 상품 목록</h2>
                  <p className="text-xs text-text-muted font-bold">진행 중인 상품이 없을 때 목록을 관리할 수 있습니다.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPresetOpen(true)} disabled={auction.status !== 'SCHEDULED' || Boolean(currentItem) || isMutating} className="btn-secondary">📚 상품 프리셋</button>
                  <button
                    type="button"
                    onClick={() => setItemEditor({ mode: 'add' })}
                    disabled={Boolean(currentItem) || isMutating}
                    className="btn-primary"
                  >
                    + 상품 추가
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="bg-bg-card border border-line rounded-card-lg">
                  <EmptyState emoji="📦" title="등록된 상품이 없습니다" description="상품을 추가한 뒤 경매 회차를 시작하세요." />
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <TeacherItemRow
                      key={item.id}
                      item={item}
                      index={index}
                      total={items.length}
                      auctionInProgress={auction.status === 'IN_PROGRESS'}
                      hasCurrentItem={Boolean(currentItem)}
                      isMutating={isMutating}
                      isCriticalBusy={criticalBusy}
                      onEdit={() => setItemEditor({ mode: 'edit', item })}
                      onStart={() => {
                        setAuctionActionError(null);
                        setPendingStartItem(item);
                      }}
                      onDelete={() => {
                        if (!confirm(`“${item.item_name}”을 삭제할까요?`)) return;
                        void call(
                          () => teacherRpc.deleteLiveAuctionItem(supabase, { p_item_id: item.id }),
                          { successTitle: '상품 삭제 완료', onSuccess: invalidate },
                        );
                      }}
                      onMove={(direction) => void call(
                        () => teacherRpc.moveLiveAuctionItem(supabase, { p_item_id: item.id, p_direction: direction }),
                        { silent: true, onSuccess: invalidate },
                      )}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        <AuctionHistorySection rows={historyQuery.data ?? []} isLoading={historyQuery.isLoading} onOpen={setHistoryDetailId} />
      </div>

      {createOpen && (
        <CreateAuctionModal
          classroomId={classroomId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}

      {itemEditor && auction && (
        <AuctionItemModal
          auctionId={auction.id}
          item={itemEditor.item}
          onClose={() => setItemEditor(null)}
          onSaved={() => {
            setItemEditor(null);
            invalidate();
          }}
        />
      )}

      {startRoundConfirmOpen && auction && (
        <Modal isOpen onClose={() => !criticalBusy && setStartRoundConfirmOpen(false)} title="경매 회차 시작 확인" emoji="🚀" size="sm">
          <div className="space-y-4">
            <div className="bg-bg-deep border border-line rounded-card-md p-3">
              <div className="text-base font-extrabold text-white">{auction.round_number}회차 경매</div>
              <div className="text-sm text-text-primary mt-1">등록 상품 {items.length}개를 학생에게 공개하고 경매 회차를 시작합니다.</div>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={criticalBusy} onClick={() => setStartRoundConfirmOpen(false)} className="btn-secondary flex-1">취소</button>
              <button type="button" disabled={criticalBusy} onClick={async () => {
                const ok = await runCriticalAuctionAction('경매 회차 시작', () => teacherRpc.startLiveAuction(supabase, { p_auction_id: auction.id }), '실시간 경매를 시작했어요');
                if (ok) setStartRoundConfirmOpen(false);
              }} className="btn-primary flex-1">{criticalBusy ? '시작 중...' : '경매 시작'}</button>
            </div>
          </div>
        </Modal>
      )}

      {pendingStartItem && (
        <Modal isOpen onClose={() => !criticalBusy && setPendingStartItem(null)} title="상품 입찰 시작 확인" emoji="⚡" size="sm">
          <div className="space-y-4">
            <div className="bg-bg-deep border border-line rounded-card-md p-3">
              <div className="text-base font-extrabold text-white">{pendingStartItem.item_name}</div>
              <div className="text-sm text-text-primary mt-1">{pendingStartItem.current_attempt}차 입찰을 시작합니다.</div>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={criticalBusy} onClick={() => setPendingStartItem(null)} className="btn-secondary flex-1">취소</button>
              <button type="button" disabled={criticalBusy} onClick={async () => {
                const item = pendingStartItem;
                const ok = await runCriticalAuctionAction('상품 입찰 시작', () => teacherRpc.startLiveAuctionItem(supabase, { p_item_id: item.id }), '상품 입찰을 시작했어요');
                if (ok) setPendingStartItem(null);
              }} className="btn-primary flex-1">{criticalBusy ? '시작 중...' : '입찰 시작'}</button>
            </div>
          </div>
        </Modal>
      )}

      {roundSummary && (
        <AuctionRoundSummaryModal items={roundSummary} onClose={() => setRoundSummary(null)} />
      )}

      {itemResult && <AuctionItemResultModal result={itemResult} onClose={() => setItemResult(null)} />}
      {historyDetailId && <AuctionHistoryDetailModal auctionId={historyDetailId} onClose={() => setHistoryDetailId(null)} />}
      {presetOpen && auction && classroomId && <AuctionPresetModal classroomId={classroomId} auctionId={auction.id} existingItems={items} onClose={() => setPresetOpen(false)} onChanged={() => { setPresetOpen(false); invalidate(); }} />}
    </TeacherShell>
  );
}

function TeacherCurrentItem({
  item, remainingSeconds, isPaused, recentBids, isMutating,
  onPause, onResume, onCloseNow, onFail,
}: {
  item: LiveAuctionItem;
  remainingSeconds: number;
  isPaused: boolean;
  recentBids: Array<{ id: number; student_name: string; brand_name: string | null; bid_amount: number }>;
  isMutating: boolean;
  onPause: () => void;
  onResume: () => void;
  onCloseNow: () => void;
  onFail: () => void;
}) {
  return (
    <section className="bg-gradient-to-br from-brand-primary/15 to-gold/10 border border-gold/35 rounded-card-lg p-5">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start">
        <div className="flex gap-4 min-w-0">
          <div className="text-6xl">{item.emoji || '🎁'}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-2xs font-black px-2 py-1 rounded-pill bg-brand-primary/20 text-brand-glow">현재 진행 중</span>
              <span className="text-2xs font-black px-2 py-1 rounded-pill bg-gold/15 text-gold">{item.current_attempt}차</span>
            </div>
            <h2 className="font-display text-2xl text-white truncate">{item.item_name}</h2>
            <p className="text-xs text-text-secondary font-bold mt-1">{item.category} · 입찰 {item.bid_count}회</p>
            <p className="text-sm mt-3">
              최고 입찰자: <strong className="text-success">{item.top_bid ? item.top_bid.brand_name || item.top_bid.student_name : '없음'}</strong>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 min-w-[300px]">
          <div className="bg-bg-deep/60 border border-line rounded-card-md p-3 text-center">
            <p className="text-2xs text-text-muted font-bold">현재가</p>
            <p className="font-mono text-2xl font-black text-gold">{formatNumber(item.current_price)}</p>
          </div>
          <div className="bg-bg-deep/60 border border-line rounded-card-md p-3 text-center">
            <p className="text-2xs text-text-muted font-bold">남은 시간</p>
            <p className={cn('font-mono text-2xl font-black', isPaused ? 'text-warning' : remainingSeconds <= 5 ? 'text-danger' : 'text-brand-glow')}>
              {isPaused ? 'PAUSE' : formatAuctionTime(remainingSeconds)}
            </p>
          </div>
        </div>
      </div>

      {recentBids.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
          {recentBids.slice(0, 4).map((bid) => (
            <div key={bid.id} className="bg-bg-deep/50 rounded-card-md px-3 py-2 flex justify-between gap-2 text-xs">
              <span className="font-bold truncate">{bid.brand_name || bid.student_name}</span>
              <span className="font-mono text-gold font-black">{formatNumber(bid.bid_amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        <button type="button" disabled={isMutating} onClick={isPaused ? onResume : onPause} className="btn-secondary">
          {isPaused ? '▶️ 재개' : '⏸️ 일시정지'}
        </button>
        <button type="button" disabled={isMutating} onClick={onCloseNow} className="btn-primary">🏁 즉시 종료·정산</button>
        <button type="button" disabled={isMutating || item.bid_count > 0} onClick={onFail} className="py-2.5 rounded-card-md border border-danger/40 bg-danger-bg text-danger text-sm font-black disabled:opacity-40">
          ❌ 유찰 처리
        </button>
        <div className="rounded-card-md border border-line bg-bg-deep/50 px-3 py-2 text-center text-2xs text-text-muted font-bold">
          시간이 0이 되면 서버 RPC가 멱등 정산합니다.
        </div>
      </div>
    </section>
  );
}

function TeacherItemRow({
  item, index, total, auctionInProgress, hasCurrentItem, isMutating, isCriticalBusy,
  onEdit, onStart, onDelete, onMove,
}: {
  item: LiveAuctionItem;
  index: number;
  total: number;
  auctionInProgress: boolean;
  hasCurrentItem: boolean;
  isMutating: boolean;
  isCriticalBusy: boolean;
  onEdit: () => void;
  onStart: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const completed = item.final_status !== null;
  return (
    <div className={cn(
      'bg-bg-card border rounded-card-md p-3 flex flex-wrap items-center gap-3',
      item.is_current ? 'border-gold/50' : 'border-line',
    )}>
      <span className="w-8 h-8 rounded-full bg-bg-deep grid place-items-center text-xs font-black text-text-muted">{index + 1}</span>
      <span className="text-3xl">{item.emoji || '🎁'}</span>
      <div className="flex-1 min-w-[180px]">
        <div className="flex items-center gap-2">
          <p className="text-sm font-black text-text-primary truncate">{item.item_name}</p>
          <span className={cn(
            'text-2xs font-black px-2 py-0.5 rounded-pill',
            item.final_status === 'SOLD'
              ? 'bg-success-bg text-success'
              : item.final_status === 'FAILED_FINAL'
                ? 'bg-danger-bg text-danger'
                : item.is_current
                  ? 'bg-gold/15 text-gold'
                  : 'bg-bg-deep text-text-muted',
          )}>
            {item.final_status === 'SOLD'
              ? '낙찰'
              : item.final_status === 'FAILED_FINAL'
                ? '최종 유찰'
                : item.is_current
                  ? '진행 중'
                  : `${item.current_attempt}차 대기`}
          </span>
        </div>
        <p className="text-2xs text-text-muted font-bold mt-1">
          {item.category} · 현재가 {formatNumber(item.current_price)} GOLD
          {item.result && ` · ${item.result.winner_brand_name || item.result.winner_name}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!completed && !item.is_current && auctionInProgress && !hasCurrentItem && (
          <button type="button" disabled={isCriticalBusy} onClick={onStart} className="px-3 py-2 rounded-card-md bg-gradient-to-r from-brand-primary to-gold text-white text-xs font-black disabled:opacity-50">▶ 시작</button>
        )}
        {!completed && !item.is_current && !hasCurrentItem && (
          <>
            <button type="button" disabled={isMutating} onClick={onEdit} className="px-2.5 py-2 rounded-card-md bg-bg-soft border border-line text-xs font-black text-text-secondary">수정</button>
            <button type="button" disabled={isMutating || index === 0} onClick={() => onMove(-1)} className="px-2.5 py-2 rounded-card-md bg-bg-deep border border-line text-xs">↑</button>
            <button type="button" disabled={isMutating || index === total - 1} onClick={() => onMove(1)} className="px-2.5 py-2 rounded-card-md bg-bg-deep border border-line text-xs">↓</button>
            <button type="button" disabled={isMutating} onClick={onDelete} className="px-2.5 py-2 rounded-card-md bg-danger-bg border border-danger/30 text-danger text-xs font-black">삭제</button>
          </>
        )}
      </div>
    </div>
  );
}

function CreateAuctionModal({ classroomId, onClose, onCreated }: { classroomId: number | null; onClose: () => void; onCreated: () => void }) {
  const showToast = useToastStore((s) => s.show);
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [existingInfo, setExistingInfo] = useState<any>(null);
  const now = new Date();
  const [round, setRound] = useState(1);
  const [schoolYear, setSchoolYear] = useState(now.getFullYear());
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [duration, setDuration] = useState(30);
  const [extension, setExtension] = useState(15);

  const submit = async (resetExisting: boolean) => {
    if (!classroomId || isLoading) return;
    setIsLoading(true); setSubmitError(null);
    try {
      const result = await teacherRpc.createOrResetLiveAuction(supabase, {
        p_classroom_id: classroomId, p_round_number: round, p_school_year: schoolYear,
        p_scheduled_date: date, p_initial_duration_seconds: duration, p_extension_seconds: extension,
        p_reset_existing: resetExisting,
      });
      if (!result.success) { const message = rpcErrorMessage(result); setSubmitError(message); showToast({ title:'경매 회차 생성 실패',description:message,variant:'error'}); return; }
      if (result.data?.status === 'EXISTS') { setExistingInfo(result.data); return; }
      showToast({ title: result.data?.status === 'RESET' ? '기존 회차를 초기화하고 새 경매를 준비했어요' : '경매 회차 생성 완료', variant:'success' });
      onCreated();
    } catch (error) {
      const message=error instanceof Error?error.message:String(error); setSubmitError(message); showToast({title:'경매 회차 생성 오류',description:message,variant:'error'});
    } finally { setIsLoading(false); }
  };

  return <Modal isOpen onClose={onClose} title="새 실시간 경매 준비" emoji="🔨" size="md">
    <div className="space-y-4">
      {!classroomId&&<div className="bg-danger-bg border border-danger/40 rounded-card-md p-3"><div className="text-sm font-black text-danger">담당 학급 정보를 찾지 못했습니다.</div></div>}
      <div className="grid grid-cols-2 gap-3"><Field label="회차"><input className="login-input" type="number" min={1} max={99} value={round} onChange={e=>{setRound(Number(e.target.value));setExistingInfo(null);}}/></Field><Field label="학년도"><input className="login-input" type="number" min={2020} max={2100} value={schoolYear} onChange={e=>{setSchoolYear(Number(e.target.value));setExistingInfo(null);}}/></Field></div>
      <Field label="예정일"><input className="login-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="상품 시작 시간(초)"><input className="login-input" type="number" min={10} max={300} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></Field><Field label="마지막 입찰 보장(초)"><input className="login-input" type="number" min={5} max={60} value={extension} onChange={e=>setExtension(Number(e.target.value))}/></Field></div>
      <div className="bg-gold/10 border border-gold/30 rounded-card-md p-3 text-xs text-text-primary break-keep">같은 학년도·회차의 완료 기록이 있으면 먼저 경고하고, 교사가 재확인한 경우에만 기존 낙찰 결제를 환급한 뒤 해당 경매 데이터를 초기화합니다.</div>
      {existingInfo&&<div className="bg-danger-bg border border-danger/50 rounded-card-md p-4"><div className="font-display text-base text-white">⚠️ 해당 회차에는 이미 경매를 진행한 기록이 있습니다.</div><p className="text-sm text-text-primary mt-2">{schoolYear}학년도 {round}회차 기록을 삭제하고 새로 진행하면 기존 낙찰 GOLD 결제는 자동 환급되고 경매 기록은 초기화됩니다.</p><p className="text-sm font-black text-danger mt-2">정말로 데이터를 삭제하고 새로 진행하시겠습니까?</p><div className="flex gap-2 mt-3"><button className="btn-secondary flex-1" onClick={()=>setExistingInfo(null)}>아니오</button><button className="py-2.5 px-4 rounded-card-md bg-danger text-white font-black flex-1" disabled={isLoading} onClick={()=>void submit(true)}>{isLoading?'초기화 중...':'삭제 후 새로 시작'}</button></div></div>}
      {submitError&&<div className="bg-danger-bg border border-danger/40 rounded-card-md p-3 text-sm text-white break-all">⚠️ {submitError}</div>}
      {!existingInfo&&<div className="flex gap-2"><button onClick={onClose} disabled={isLoading} className="btn-secondary flex-1">취소</button><button disabled={isLoading||!classroomId} onClick={()=>void submit(false)} className="btn-primary flex-1">{isLoading?'확인 중...':'생성'}</button></div>}
    </div>
  </Modal>;
}

function AuctionItemModal({ auctionId, item, onClose, onSaved }: { auctionId: number; item?: LiveAuctionItem; onClose: () => void; onSaved: () => void }) {
  const showToast = useToastStore((s) => s.show);
  const { call, isLoading } = useRpcCall();
  const [name, setName] = useState(item?.item_name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '자리');
  const [emoji, setEmoji] = useState(item?.emoji ?? '🎁');
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const [price, setPrice] = useState<number | ''>(item?.starting_price ?? '');

  const submit = () => {
    if (!name.trim() || !price || Number(price) <= 0) {
      showToast({ title: '상품명과 올바른 시작가를 입력해주세요', variant: 'warning' });
      return;
    }
    const common = {
      p_item_name: name.trim(),
      p_description: description.trim() || null,
      p_category: category.trim() || '기타',
      p_emoji: emoji.trim() || '🎁',
      p_image_url: imageUrl.trim() || null,
      p_starting_price: Number(price),
    };

    if (item) {
      void call(
        () => teacherRpc.updateLiveAuctionItem(supabase, { p_item_id: item.id, ...common }),
        { successTitle: '상품 수정 완료', onSuccess: onSaved },
      );
    } else {
      void call(
        () => teacherRpc.addLiveAuctionItem(supabase, {
          p_auction_id: auctionId,
          ...common,
          p_display_order: null,
        }),
        { successTitle: '상품 추가 완료', onSuccess: onSaved },
      );
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={item ? '경매 상품 수정' : '경매 상품 추가'} emoji="📦" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-[90px_1fr] gap-3">
          <Field label="이모지"><input className="login-input text-center text-2xl" value={emoji} maxLength={16} onChange={(e) => setEmoji(e.target.value)} /></Field>
          <Field label="상품명"><input className="login-input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="예: 창가 1열 좌석" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="카테고리"><select className="login-input" value={category} onChange={(e)=>setCategory(e.target.value)}>{['자리','1인1역','급식순서','특별경매','기타'].map(c=><option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="시작가"><input className="login-input font-mono" type="number" min={1} max={10_000_000} value={price} onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))} /></Field>
        </div>
        <Field label="설명"><textarea className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary resize-none" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="이미지 URL(선택)"><input className="login-input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." /></Field>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">취소</button>
          <button type="button" disabled={isLoading} onClick={submit} className="btn-primary flex-1">{item ? '수정 저장' : '상품 추가'}</button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="block text-xs font-bold text-text-secondary mb-1.5">{label}</span>{children}</label>;
}


function AuctionRoundSummaryModal({ items, onClose }: { items: LiveAuctionItem[]; onClose: () => void }) {
  const grouped = items.reduce<Record<string, { studentName: string; purchases: { itemName: string; price: number }[] }>>((acc, item) => {
    if (!item.result) return acc;
    const key = String(item.result.winner_student_id);
    if (!acc[key]) acc[key] = { studentName: item.result.winner_brand_name || item.result.winner_name, purchases: [] };
    acc[key].purchases.push({ itemName: item.item_name, price: item.result.final_price });
    return acc;
  }, {});
  const cards = Object.values(grouped).sort((a, b) => a.studentName.localeCompare(b.studentName, 'ko'));
  return (
    <Modal isOpen onClose={onClose} title="경매 회차 구매 요약" emoji="🧾" size="lg">
      {!cards.length ? (
        <p className="text-sm text-text-secondary font-bold">이번 회차에 낙찰된 상품이 없습니다.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {cards.map((card) => (
            <div key={card.studentName} className="bg-bg-deep border border-line rounded-card-md p-3">
              <div className="text-base font-extrabold text-white mb-2">{card.studentName}</div>
              <div className="space-y-2">
                {card.purchases.map((purchase, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-text-primary">{purchase.itemName}</span>
                    <span className="font-mono text-gold font-black">{formatNumber(purchase.price)} GOLD</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end pt-4">
        <button type="button" className="btn-primary" onClick={onClose}>닫기</button>
      </div>
    </Modal>
  );
}


function AuctionItemResultModal({ result, onClose }: { result:{itemName:string;winnerName:string|null;finalPrice:number|null;status:string}; onClose:()=>void }) {
  useEffect(()=>{ const t=window.setTimeout(onClose,5000); return()=>window.clearTimeout(t); },[onClose]);
  const sold=result.status==='SOLD';
  return <Modal isOpen onClose={onClose} title="상품 정산 결과" emoji="🏆" size="sm"><div className="text-center space-y-3"><div className="font-display text-2xl text-white">{result.itemName}</div>{sold?<><div className="text-lg text-success font-black">낙찰자 · {result.winnerName||'확인 중'}</div><div className="font-mono text-3xl text-gold font-black">{formatNumber(result.finalPrice||0)} GOLD</div></>:<div className="text-lg text-warning font-black">{result.status==='RETRY_READY'?'유찰 · 다음 시도 준비':'정산 상태 · '+result.status}</div>}<button className="btn-secondary w-full" onClick={onClose}>확인</button><div className="text-xs text-text-secondary">5초 후 자동으로 닫힙니다.</div></div></Modal>;
}

function AuctionHistorySection({ rows, isLoading, onOpen }:{rows:any[];isLoading:boolean;onOpen:(id:number)=>void}){
 return <section className="bg-bg-card border border-line rounded-card-lg p-4"><div className="flex items-center justify-between mb-3"><div><h2 className="font-display text-lg text-white">🗂️ 이전 경매 기록</h2><p className="text-xs text-text-secondary mt-1">회차별 낙찰 결과를 언제든 다시 확인할 수 있습니다.</p></div></div>{isLoading?<LoadingSpinner/>:!rows.length?<p className="text-sm text-text-secondary">완료된 경매 기록이 없습니다.</p>:<div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">{rows.map((r:any)=><button key={r.id} onClick={()=>onOpen(r.id)} className="text-left bg-bg-deep border border-line rounded-card-md p-3 hover:border-gold/40"><div className="flex justify-between gap-2"><span className="font-black text-white">{r.school_year} · {r.round_number}회차</span><span className="text-xs text-success font-bold">완료</span></div><div className="text-xs text-text-primary mt-2">상품 {r.item_count}개 · 낙찰 {r.sold_count} · 유찰 {r.failed_count}</div><div className="font-mono text-gold font-black mt-1">총 {formatNumber(Number(r.total_sales||0))} GOLD</div></button>)}</div>}</section>;
}

function AuctionHistoryDetailModal({auctionId,onClose}:{auctionId:number;onClose:()=>void}){
 const q=useQuery({queryKey:['auction-history-detail',auctionId],queryFn:async()=>{const r=await teacherRpc.getAuctionHistoryDetail(supabase,{p_auction_id:auctionId});if(!r.success)throw new Error(rpcErrorMessage(r));return r.data;}});
 const items=q.data?.items??[];
 const grouped: Record<string,{name:string;items:any[]}> = {};
 for (const x of items.filter((item:any)=>item.winner_student_id)) { const k=String(x.winner_student_id); if(!grouped[k]) grouped[k]={name:x.winner_brand_name||x.winner_name,items:[]}; grouped[k].items.push(x); }
 return <Modal isOpen onClose={onClose} title="경매 기록 상세" emoji="🗂️" size="lg">{q.isLoading?<LoadingSpinner/>:q.isError?<div className="text-danger">{q.error instanceof Error?q.error.message:'기록 조회 실패'}</div>:<div className="space-y-4"><div className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-display text-xl text-white">{q.data?.auction?.school_year} · {q.data?.auction?.round_number}회차</div><div className="text-sm text-text-secondary mt-1">판매 상품 {items.length}개</div></div><div className="grid md:grid-cols-2 gap-3">{Object.values(grouped).map((g:any)=><div key={g.name} className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-white mb-2">{g.name}</div>{g.items.map((x:any)=><div key={x.id} className="flex justify-between gap-2 text-sm py-1"><span>{x.item_name}</span><span className="text-gold font-mono font-black">{formatNumber(Number(x.final_price||0))}</span></div>)}</div>)}</div>{items.some((x:any)=>!x.winner_student_id)&&<div className="bg-bg-deep border border-line rounded-card-md p-3"><div className="font-black text-danger mb-2">유찰 상품</div><div className="flex flex-wrap gap-2">{items.filter((x:any)=>!x.winner_student_id).map((x:any)=><span key={x.id} className="text-sm text-text-primary">{x.item_name}</span>)}</div></div>}</div>}</Modal>;
}

function AuctionPresetModal({classroomId,auctionId,existingItems,onClose,onChanged}:{classroomId:number;auctionId:number;existingItems:LiveAuctionItem[];onClose:()=>void;onChanged:()=>void}){
 const showToast=useToastStore(s=>s.show); const qc=useQueryClient();
 const [tab,setTab]=useState<'자리'|'1인1역'|'급식순서'|'특별경매'|'기타'>('자리'); const [price,setPrice]=useState(100); const [presetName,setPresetName]=useState(''); const [presetEmoji,setPresetEmoji]=useState('🎁'); const [busy,setBusy]=useState(false);
 const pq=useQuery({queryKey:['auction-presets',classroomId],queryFn:async()=>{const r=await teacherRpc.getAuctionItemPresets(supabase,{p_classroom_id:classroomId});if(!r.success)throw new Error(rpcErrorMessage(r));return r.data??[];}});
 const existing=new Set(existingItems.map(i=>`${i.category}::${i.item_name}`));
 const bulk=async(items:any[])=>{if(!items.length)return;setBusy(true);try{const r=await teacherRpc.bulkAddLiveAuctionItems(supabase,{p_auction_id:auctionId,p_items:items});if(!r.success){showToast({title:'상품 추가 실패',description:rpcErrorMessage(r),variant:'error'});return;}showToast({title:`${r.data.added}개 상품 추가`,description:r.data.skipped?`중복 ${r.data.skipped}개는 건너뛰었습니다.`:undefined,variant:'success'});onChanged();}finally{setBusy(false);}};
 const fixed=(category:'자리'|'급식순서')=>Array.from({length:24},(_,i)=>({item_name:`${category} ${i+1}번`,category,description:null,emoji:category==='자리'?'💺':'🍽️',image_url:null,starting_price:price}));
 const saved=(pq.data??[]).filter((x:any)=>x.category===tab);
 return <Modal isOpen onClose={onClose} title="경매 상품 프리셋" emoji="📚" size="lg"><div className="space-y-4"><div className="flex gap-1.5 overflow-x-auto">{(['자리','1인1역','급식순서','특별경매','기타'] as const).map(c=><button key={c} onClick={()=>setTab(c)} className={tab===c?'btn-primary':'btn-secondary'}>{c}</button>)}</div>{(tab==='자리'||tab==='급식순서')?<><Field label="일괄 시작가"><input type="number" className="login-input" min={1} value={price} onChange={e=>setPrice(Number(e.target.value))}/></Field><button disabled={busy} onClick={()=>void bulk(fixed(tab).filter(x=>!existing.has(`${x.category}::${x.item_name}`)))} className="btn-primary w-full">{tab} 1~24번 전체 추가</button><div className="grid grid-cols-4 sm:grid-cols-6 gap-2">{fixed(tab).map(x=><button key={x.item_name} disabled={busy||existing.has(`${x.category}::${x.item_name}`)} onClick={()=>void bulk([x])} className="bg-bg-deep border border-line rounded-card-sm p-2 text-xs disabled:opacity-30">{x.item_name}</button>)}</div></>:<><div className="bg-bg-deep border border-line rounded-card-md p-3 space-y-2"><div className="font-black text-white">프리셋 저장</div><div className="grid grid-cols-[1fr_90px_120px] gap-2"><input className="login-input" placeholder={tab==='1인1역'?'예: 칠판관리':'상품명'} value={presetName} onChange={e=>setPresetName(e.target.value)}/><input className="login-input text-center" value={presetEmoji} onChange={e=>setPresetEmoji(e.target.value)}/><input className="login-input" type="number" min={1} value={price} onChange={e=>setPrice(Number(e.target.value))}/></div><button className="btn-secondary w-full" disabled={!presetName.trim()||busy} onClick={async()=>{setBusy(true);try{const r=await teacherRpc.saveAuctionItemPreset(supabase,{p_classroom_id:classroomId,p_category:tab,p_item_name:presetName.trim(),p_description:null,p_emoji:presetEmoji||'🎁',p_image_url:null,p_default_starting_price:price});if(r.success){setPresetName('');await qc.invalidateQueries({queryKey:['auction-presets',classroomId]});showToast({title:'프리셋 저장 완료',variant:'success'});}else showToast({title:'프리셋 저장 실패',description:rpcErrorMessage(r),variant:'error'});}finally{setBusy(false);}}}>프리셋 저장</button></div>{saved.length>0&&<button disabled={busy} className="btn-primary w-full" onClick={()=>void bulk(saved.filter((x:any)=>!existing.has(`${x.category}::${x.item_name}`)).map((x:any)=>({item_name:x.item_name,category:x.category,description:x.description,emoji:x.emoji,image_url:x.image_url,starting_price:Number(x.default_starting_price)})))}>저장된 {tab} 전체 추가</button>}<div className="space-y-2">{saved.map((x:any)=><div key={x.id} className="bg-bg-deep border border-line rounded-card-md p-3 flex items-center gap-2"><span className="text-xl">{x.emoji}</span><div className="flex-1"><div className="font-black text-white">{x.item_name}</div><div className="text-xs text-text-secondary">시작가 {formatNumber(Number(x.default_starting_price))} GOLD</div></div><button disabled={busy||existing.has(`${x.category}::${x.item_name}`)} className="btn-secondary" onClick={()=>void bulk([{item_name:x.item_name,category:x.category,description:x.description,emoji:x.emoji,image_url:x.image_url,starting_price:Number(x.default_starting_price)}])}>추가</button><button disabled={busy} className="text-danger text-xs font-black" onClick={async()=>{const r=await teacherRpc.deleteAuctionItemPreset(supabase,{p_preset_id:Number(x.id)});if(r.success)void qc.invalidateQueries({queryKey:['auction-presets',classroomId]});}}>삭제</button></div>)}</div></>}</div></Modal>;
}
