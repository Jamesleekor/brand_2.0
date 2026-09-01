import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock3,
  Coins,
  Cookie,
  DoorClosed,
  DoorOpen,
  History,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';

import { EmptyState, LoadingSpinner, Modal, PageHeader, useRpcCall } from '@/components/shared/components';
import {
  bakeryI2Rpc,
  type BakeryAccess,
  type BakeryDashboard,
  type BakeryHoldingRow,
  type BakeryItemBoardRow,
  type BakeryPendingFulfillment,
} from '@/lib/rpc/bakery_i2_rpc';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatNumber } from '@/lib/utils/format';

const ACCESS_QUERY_KEY = ['bakery-i2-access'] as const;
const DASHBOARD_QUERY_KEY = ['bakery-i2-dashboard'] as const;

type ControlAction = 'OPEN' | 'CLOSE' | null;

export default function BakeryPage() {
  const queryClient = useQueryClient();
  const accessQuery = useQuery<BakeryAccess>({
    queryKey: ACCESS_QUERY_KEY,
    queryFn: async () => {
      const result = await bakeryI2Rpc.getAccess(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const dashboardQuery = useQuery<BakeryDashboard>({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: async () => {
      const result = await bakeryI2Rpc.getDashboard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: accessQuery.data?.can_operate === true,
    refetchInterval: 15_000,
    staleTime: 3_000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY }),
    ]);
  };

  useEffect(() => {
    const classroomId = accessQuery.data?.classroom_id;
    if (!classroomId || !accessQuery.data?.can_operate) return;

    const invalidate = () => {
      void refresh();
    };

    const channel = supabase
      .channel(`bakery-i2:${classroomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_fulfillments', filter: `classroom_id=eq.${classroomId}` },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bakery_sessions', filter: `classroom_id=eq.${classroomId}` },
        invalidate,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // queryClient is stable; refresh intentionally follows current access context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessQuery.data?.can_operate, accessQuery.data?.classroom_id, queryClient]);

  if (accessQuery.isLoading) {
    return <BakeryLoading />;
  }

  if (accessQuery.isError || !accessQuery.data) {
    return (
      <div className="min-h-screen">
        <PageHeader title="제과점" emoji="🧁" />
        <div className="px-4 py-8">
          <LoadError
            title="제과점 상태를 불러오지 못했습니다"
            message={accessQuery.error instanceof Error ? accessQuery.error.message : '잠시 후 다시 시도해주세요.'}
            onRetry={() => void accessQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  if (!accessQuery.data.can_operate) {
    return <NoBakeryAccess access={accessQuery.data} />;
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title="B.R.A.N.D 제과점"
        emoji="🧁"
        right={
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-9 items-center gap-1.5 rounded-pill border border-line bg-bg-card px-3 text-xs font-black text-text-secondary transition hover:border-gold/30 hover:text-white"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', dashboardQuery.isFetching && 'animate-spin')} />
            새로고침
          </button>
        }
      />

      <main className="space-y-4 px-4 pb-10 pt-4">
        {dashboardQuery.isLoading || !dashboardQuery.data ? (
          <BakeryLoading compact />
        ) : dashboardQuery.isError ? (
          <LoadError
            title="제과점 대시보드를 불러오지 못했습니다"
            message={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : '잠시 후 다시 시도해주세요.'}
            onRetry={() => void dashboardQuery.refetch()}
          />
        ) : (
          <BakeryDashboardView
            access={accessQuery.data}
            dashboard={dashboardQuery.data}
            onRefresh={refresh}
          />
        )}
      </main>
    </div>
  );
}

function BakeryDashboardView({
  access,
  dashboard,
  onRefresh,
}: {
  access: BakeryAccess;
  dashboard: BakeryDashboard;
  onRefresh: () => Promise<void>;
}) {
  const [controlAction, setControlAction] = useState<ControlAction>(null);
  const [note, setNote] = useState('');
  const [deliveringId, setDeliveringId] = useState<number | null>(null);
  const [holdingSearch, setHoldingSearch] = useState('');
  const { call, isLoading: controlLoading } = useRpcCall();
  const isOpen = dashboard.status === 'OPEN';

  const handleControl = async () => {
    if (!controlAction) return;
    const isOpening = controlAction === 'OPEN';
    const options = {
      successTitle: isOpening ? '제과점 OPEN' : '제과점 CLOSED',
      successDescription: isOpening
        ? '학생들이 이제 제과점 간식을 사용할 수 있습니다.'
        : '신규 간식 사용은 중단되지만 기존 수령 대기는 지급할 수 있습니다.',
    };
    const result = isOpening
      ? await call(() => bakeryI2Rpc.open(supabase, note), options)
      : await call(() => bakeryI2Rpc.close(supabase, note), options);
    if (!result) return;
    setControlAction(null);
    setNote('');
    await onRefresh();
  };

  const handleDeliver = async (row: BakeryPendingFulfillment) => {
    setDeliveringId(row.id);
    try {
      const result = await call(
        () => bakeryI2Rpc.deliver(supabase, row.id),
        {
          successTitle: `${row.display_name} 지급 완료`,
          successDescription: `${row.item_name} × ${row.quantity} 전달 기록을 저장했습니다.`,
        },
      );
      if (result) await onRefresh();
    } finally {
      setDeliveringId(null);
    }
  };

  return (
    <>
      <BakeryHero access={access} dashboard={dashboard} onControl={setControlAction} />
      <SummaryGrid dashboard={dashboard} />
      <PickupQueue
        rows={dashboard.pending}
        deliveringId={deliveringId}
        onDeliver={handleDeliver}
      />
      <ItemBoard items={dashboard.items} weekStart={dashboard.week_start} />
      <HoldingsBoard rows={dashboard.holdings} search={holdingSearch} onSearch={setHoldingSearch} />
      <RecentDelivered rows={dashboard.recent_delivered} />

      <Modal
        isOpen={controlAction !== null}
        onClose={() => {
          if (!controlLoading) {
            setControlAction(null);
            setNote('');
          }
        }}
        title={controlAction === 'OPEN' ? '제과점 영업 시작' : '제과점 영업 종료'}
        emoji={controlAction === 'OPEN' ? '🟢' : '🔴'}
        size="sm"
      >
        <div className="space-y-4">
          <div
            className={cn(
              'rounded-card-md border p-3 text-sm font-bold leading-relaxed',
              controlAction === 'OPEN'
                ? 'border-success/30 bg-success-bg text-text-primary'
                : 'border-warning/30 bg-warning-bg text-text-primary',
            )}
          >
            {controlAction === 'OPEN'
              ? 'OPEN하면 학생들이 제과점 간식을 사용할 수 있고, 이번 주 첫 OPEN이라면 공식 주간 가격이 기록됩니다.'
              : 'CLOSED하면 신규 간식 사용만 차단됩니다. 이미 들어온 수령 대기 주문은 계속 지급할 수 있습니다.'}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-text-secondary">운영 메모 · 선택</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 200))}
              className="input-field min-h-[88px] w-full resize-none"
              placeholder="예: 점심시간 운영 시작"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleControl()}
            disabled={controlLoading}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-card-md px-4 py-3 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-50',
              controlAction === 'OPEN'
                ? 'bg-gradient-to-r from-success to-crystal'
                : 'bg-gradient-to-r from-danger to-brand-primary',
            )}
          >
            {controlLoading ? <LoadingSpinner size="sm" /> : controlAction === 'OPEN' ? <DoorOpen className="h-4 w-4" /> : <DoorClosed className="h-4 w-4" />}
            {controlAction === 'OPEN' ? 'OPEN 확정' : 'CLOSED 확정'}
          </button>
        </div>
      </Modal>
    </>
  );
}

function BakeryHero({
  access,
  dashboard,
  onControl,
}: {
  access: BakeryAccess;
  dashboard: BakeryDashboard;
  onControl: (action: Exclude<ControlAction, null>) => void;
}) {
  const isOpen = dashboard.status === 'OPEN';
  const pending = dashboard.summary.pending_quantity;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-card-xl border p-5 shadow-card',
        isOpen
          ? 'border-success/35 bg-gradient-to-br from-success/20 via-bg-card to-crystal/10'
          : 'border-warning/30 bg-gradient-to-br from-warning/15 via-bg-card to-bg-deep',
      )}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 text-[120px] opacity-[0.07]">🧁</div>
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-black',
                isOpen
                  ? 'border-success/40 bg-success-bg text-success'
                  : 'border-warning/40 bg-warning-bg text-warning',
              )}
            >
              {isOpen ? <DoorOpen className="h-3.5 w-3.5" /> : <DoorClosed className="h-3.5 w-3.5" />}
              {isOpen ? 'OPEN · 영업 중' : 'CLOSED · 영업 종료'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-black/20 px-2.5 py-1 text-[11px] font-black text-text-secondary">
              <ShieldCheck className="h-3.5 w-3.5 text-bv" />
              {access.is_teacher ? '교사 비상 운영 권한' : access.primary_job_name || '제과점 담당'}
            </span>
          </div>
          <h2 className="mt-3 font-display text-2xl text-white">오늘의 제과점 운영실</h2>
          <p className="mt-1 max-w-xl text-sm font-bold leading-relaxed text-text-secondary">
            {isOpen
              ? '학생의 간식 사용은 즉시 가방에서 차감됩니다. 수령 대기 목록에서 실제 간식을 전달한 뒤 지급 완료만 눌러주세요.'
              : '현재 신규 간식 사용은 서버에서 차단되어 있습니다. 이미 접수된 수령 대기는 CLOSED 상태에서도 지급할 수 있습니다.'}
          </p>
          {isOpen && dashboard.session?.opened_at && (
            <p className="mt-2 text-xs font-bold text-text-muted">
              영업 시작 · {formatDateTime(dashboard.session.opened_at)} · 이번 주 기준일 {dashboard.week_start}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:min-w-[190px]">
          <div className="rounded-card-md border border-line bg-black/20 px-4 py-3 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">PICKUP QUEUE</div>
            <div className="mt-1 font-display text-3xl text-gold">{formatNumber(pending)}</div>
            <div className="text-[11px] font-bold text-text-secondary">현재 수령 대기 수량</div>
          </div>
          <button
            type="button"
            onClick={() => onControl(isOpen ? 'CLOSE' : 'OPEN')}
            className={cn(
              'flex items-center justify-center gap-2 rounded-card-md px-4 py-3 text-sm font-black text-white shadow-card transition active:scale-[0.98]',
              isOpen
                ? 'bg-gradient-to-r from-danger to-brand-primary'
                : 'bg-gradient-to-r from-success to-crystal',
            )}
          >
            {isOpen ? <DoorClosed className="h-4 w-4" /> : <DoorOpen className="h-4 w-4" />}
            {isOpen ? '영업 종료' : '영업 시작'}
          </button>
        </div>
      </div>
    </section>
  );
}

function SummaryGrid({ dashboard }: { dashboard: BakeryDashboard }) {
  const cards = [
    { label: '오늘 시장 판매', value: dashboard.summary.sold_today, icon: ShoppingCart, accent: 'text-gold', help: '구매된 간식 수량' },
    { label: '오늘 사용', value: dashboard.summary.used_today, icon: Cookie, accent: 'text-brand-glow', help: '가방에서 사용한 수량' },
    { label: '수령 대기', value: dashboard.summary.pending_quantity, icon: Clock3, accent: 'text-warning', help: '아직 전달하지 않은 수량' },
    { label: '오늘 지급', value: dashboard.summary.delivered_today, icon: PackageCheck, accent: 'text-success', help: '실제 전달 완료 수량' },
  ];

  return (
    <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="rounded-card-lg border border-line bg-bg-card p-3.5 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black text-text-secondary">{card.label}</span>
              <Icon className={cn('h-4 w-4', card.accent)} />
            </div>
            <div className={cn('mt-1 font-display text-2xl', card.accent)}>{formatNumber(card.value)}</div>
            <div className="mt-0.5 text-[10px] font-bold text-text-muted">{card.help}</div>
          </div>
        );
      })}
    </section>
  );
}

function PickupQueue({
  rows,
  deliveringId,
  onDeliver,
}: {
  rows: BakeryPendingFulfillment[];
  deliveringId: number | null;
  onDeliver: (row: BakeryPendingFulfillment) => Promise<void>;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="overflow-hidden rounded-card-xl border border-gold/25 bg-bg-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-gold" />
            <h3 className="font-display text-base text-white">수령 대기</h3>
            {rows.length > 0 && (
              <span className="rounded-pill bg-danger px-2 py-0.5 text-[10px] font-black text-white">{rows.length}건</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] font-bold text-text-muted">오래 기다린 요청부터 자동 정렬됩니다.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState emoji="✅" title="수령 대기가 없습니다" description="현재 모든 간식이 지급 완료된 상태입니다." />
      ) : (
        <div className="divide-y divide-line">
          {rows.map((row, index) => {
            const liveWait = Math.max(row.wait_seconds, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000));
            const busy = deliveringId === row.id;
            return (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.025, 0.15) }}
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ItemThumb imageUrl={row.image_url} name={row.item_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-display text-base text-white">{row.display_name}</span>
                      {row.brand_name && row.brand_name !== row.student_name && (
                        <span className="text-[10px] font-bold text-text-muted">본명 {row.student_name}</span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs font-extrabold text-text-secondary">{row.item_name} × {row.quantity}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold text-text-muted">
                      <span>요청 {formatDateTime(row.created_at)}</span>
                      <span className={cn('rounded-pill px-2 py-0.5', liveWait >= 600 ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning')}>
                        대기 {formatWait(liveWait)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deliveringId !== null}
                  onClick={() => void onDeliver(row)}
                  className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-card-md bg-gradient-to-r from-success to-crystal px-4 text-sm font-black text-white shadow-card transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <LoadingSpinner size="sm" /> : <CheckCircle2 className="h-4 w-4" />}
                  지급 완료
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ItemBoard({ items, weekStart }: { items: BakeryItemBoardRow[]; weekStart: string }) {
  const activeItems = items.filter((item) => !item.is_archived);
  const archivedItems = items.filter((item) => item.is_archived);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-brand-glow" />
            <h3 className="font-display text-base text-white">상품 운영 현황</h3>
          </div>
          <p className="mt-0.5 text-[11px] font-bold text-text-muted">공식 주간 기준 · {weekStart} 시작 주</p>
        </div>
        <div className="text-[10px] font-black text-text-muted">활성 {activeItems.length} · 보관 {archivedItems.length}</div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card">
          <EmptyState emoji="🍪" title="제과점 상품이 없습니다" description="교사 시장 운영에서 BAKERY_FULFILLMENT 상품을 등록해주세요." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((item) => <BakeryItemCard key={item.item_id} item={item} />)}
        </div>
      )}
    </section>
  );
}

function BakeryItemCard({ item }: { item: BakeryItemBoardRow }) {
  const stockRatio = item.base_stock > 0 ? Math.max(0, Math.min(1, item.current_stock / item.base_stock)) : 0;
  const delta = item.week_over_week_delta_gold;
  const DeltaIcon = delta === null || delta === 0 ? null : delta > 0 ? TrendingUp : TrendingDown;

  return (
    <article className={cn('overflow-hidden rounded-card-lg border bg-bg-card shadow-card', item.is_archived ? 'border-line opacity-65' : 'border-line-strong')}>
      <div className="flex gap-3 p-4">
        <ItemThumb imageUrl={item.image_url} name={item.name} large />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="truncate font-display text-base text-white">{item.name}</h4>
              <p className="mt-0.5 line-clamp-2 text-[11px] font-bold leading-relaxed text-text-muted">{item.description || '설명 없음'}</p>
            </div>
            {item.is_archived ? (
              <span className="shrink-0 rounded-pill border border-line px-2 py-1 text-[9px] font-black text-text-muted">보관</span>
            ) : !item.is_active ? (
              <span className="shrink-0 rounded-pill border border-warning/30 bg-warning-bg px-2 py-1 text-[9px] font-black text-warning">중지</span>
            ) : (
              <span className="shrink-0 rounded-pill border border-success/30 bg-success-bg px-2 py-1 text-[9px] font-black text-success">활성</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniMetric icon={<Coins className="h-3.5 w-3.5 text-gold" />} label="현재 시세" value={`${formatNumber(item.current_price_gold)} G`} />
            <MiniMetric icon={<Boxes className="h-3.5 w-3.5 text-crystal" />} label="현재 재고" value={`${formatNumber(item.current_stock)} / ${formatNumber(item.base_stock)}`} />
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="h-1.5 overflow-hidden rounded-pill bg-bg-deep">
          <div
            className={cn('h-full rounded-pill', stockRatio <= 0.25 ? 'bg-danger' : stockRatio <= 0.5 ? 'bg-warning' : 'bg-success')}
            style={{ width: `${stockRatio * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-4 border-t border-line bg-black/10">
        <TinyStat label="오늘 판매" value={item.sold_today} />
        <TinyStat label="오늘 사용" value={item.used_today} />
        <TinyStat label="대기" value={item.pending_quantity} emphasis={item.pending_quantity > 0} />
        <TinyStat label="오늘 지급" value={item.delivered_today} />
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
        <div className="bg-bg-deep/70 p-3">
          <div className="text-[9px] font-black uppercase tracking-wider text-text-muted">이번 주 OPEN 기준</div>
          {item.week_snapshot_price_gold === null ? (
            <div className="mt-1 text-xs font-bold text-text-muted">아직 snapshot 없음</div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <span className="font-display text-base text-gold">{formatNumber(item.week_snapshot_price_gold)} G</span>
              <span className="text-[10px] font-bold text-text-muted">재고 {item.week_snapshot_stock ?? '-'}</span>
            </div>
          )}
        </div>
        <div className="bg-bg-deep/70 p-3">
          <div className="text-[9px] font-black uppercase tracking-wider text-text-muted">전주 대비</div>
          {delta === null || item.week_over_week_pct === null ? (
            <div className="mt-1 text-xs font-bold text-text-muted">비교 데이터 없음</div>
          ) : (
            <div className="mt-1 flex items-center gap-1.5">
              {DeltaIcon && <DeltaIcon className={cn('h-4 w-4', delta > 0 ? 'text-danger' : 'text-success')} />}
              <span className={cn('font-display text-base', delta > 0 ? 'text-danger' : delta < 0 ? 'text-success' : 'text-text-secondary')}>
                {delta > 0 ? '+' : ''}{formatNumber(delta)} G
              </span>
              <span className="text-[10px] font-bold text-text-muted">({item.week_over_week_pct > 0 ? '+' : ''}{item.week_over_week_pct}%)</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[10px] font-bold text-text-muted">
        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> 보유 학생 {item.holder_count}명</span>
        <span>학생 보유 총 {formatNumber(item.owned_total)}개</span>
      </div>
    </article>
  );
}

function HoldingsBoard({ rows, search, onSearch }: { rows: BakeryHoldingRow[]; search: string; onSearch: (value: string) => void }) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    if (!needle) return rows;
    return rows.filter((row) => [row.display_name, row.student_name, row.item_name].some((value) => value.toLocaleLowerCase('ko-KR').includes(needle)));
  }, [rows, search]);

  const totals = useMemo(() => filtered.reduce((acc, row) => ({ owned: acc.owned + row.owned_quantity, reserved: acc.reserved + row.reserved_quantity, available: acc.available + row.available_quantity }), { owned: 0, reserved: 0, available: 0 }), [filtered]);

  return (
    <section className="overflow-hidden rounded-card-xl border border-line bg-bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-bv" /><h3 className="font-display text-base text-white">학생별 간식 보유량</h3></div>
          <p className="mt-0.5 text-[11px] font-bold text-text-muted">조회 전용 · 일반 학생 Inventory RLS는 확장하지 않습니다.</p>
        </div>
        <label className="relative block sm:w-[220px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={(event) => onSearch(event.target.value)} className="input-field w-full pl-9 text-xs" placeholder="학생·상품 검색" />
        </label>
      </div>

      <div className="grid grid-cols-3 border-b border-line bg-black/10">
        <TinyStat label="검색 보유" value={totals.owned} />
        <TinyStat label="예약" value={totals.reserved} />
        <TinyStat label="사용 가능" value={totals.available} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState emoji="🎒" title="표시할 보유 내역이 없습니다" description={search ? '검색어를 바꿔보세요.' : '학생이 보유한 제과점 상품이 아직 없습니다.'} />
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          {filtered.map((row) => (
            <div key={`${row.student_id}:${row.item_id}`} className="flex flex-col gap-2.5 border-b border-line px-4 py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-white">{row.display_name}</div>
                {row.brand_name && row.brand_name !== row.student_name && <div className="text-[9px] font-bold text-text-muted">{row.student_name}</div>}
              </div>
              <div className="truncate text-[11px] font-bold text-text-secondary">{row.item_name}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black sm:justify-end">
                <span className="rounded-pill bg-bv/15 px-2 py-1 text-bv-100">보유 {row.owned_quantity}</span>
                {row.reserved_quantity > 0 && <span className="rounded-pill bg-warning-bg px-2 py-1 text-warning">예약 {row.reserved_quantity}</span>}
                <span className="rounded-pill bg-success-bg px-2 py-1 text-success">가능 {row.available_quantity}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentDelivered({ rows }: { rows: BakeryDashboard['recent_delivered'] }) {
  return (
    <section className="overflow-hidden rounded-card-xl border border-line bg-bg-card shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <History className="h-4 w-4 text-crystal" />
        <div>
          <h3 className="font-display text-base text-white">최근 지급 기록</h3>
          <p className="mt-0.5 text-[11px] font-bold text-text-muted">최근 30건 · 지급 이력은 수정하지 않습니다.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState emoji="📜" title="아직 지급 기록이 없습니다" />
      ) : (
        <div className="divide-y divide-line">
          {rows.slice(0, 12).map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-bg text-success"><CheckCircle2 className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-white">{row.display_name} · {row.item_name} × {row.quantity}</div>
                <div className="mt-0.5 text-[10px] font-bold text-text-muted">{formatDateTime(row.delivered_at)}{row.note ? ` · ${row.note}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NoBakeryAccess({ access }: { access: BakeryAccess }) {
  return (
    <div className="min-h-screen">
      <PageHeader title="B.R.A.N.D 제과점" emoji="🧁" />
      <main className="px-4 py-8">
        <div className="overflow-hidden rounded-card-xl border border-line bg-bg-card shadow-card">
          <div className="bg-gradient-to-br from-warning/15 via-bg-card to-bg-deep p-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card-xl border border-warning/25 bg-warning-bg text-warning"><ShieldCheck className="h-8 w-8" /></div>
            <h2 className="mt-4 font-display text-xl text-white">제과점 운영 권한이 없습니다</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm font-bold leading-relaxed text-text-secondary">
              제과점은 현재 1인1역에서 <strong className="text-white">제과점 담당</strong>으로 배정된 학생과 교사만 운영할 수 있습니다.
            </p>
            <div className="mx-auto mt-4 max-w-sm rounded-card-md border border-line bg-black/20 p-3 text-left text-xs font-bold text-text-secondary">
              <div className="flex items-center justify-between gap-2"><span>현재 제과점 상태</span><span className={access.status === 'OPEN' ? 'text-success' : 'text-warning'}>{access.status}</span></div>
              <div className="mt-2 flex items-center justify-between gap-2"><span>내 1인1역</span><span className="text-white">{access.primary_job_name || '배정 없음'}</span></div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function BakeryLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', compact ? 'min-h-[360px]' : 'min-h-screen')}>
      <LoadingSpinner size="lg" />
      <p className="text-sm font-bold text-text-secondary">제과점 운영 현황을 불러오는 중...</p>
    </div>
  );
}

function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-card-xl border border-danger/30 bg-danger-bg p-5 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-danger" />
      <h3 className="mt-2 font-display text-base text-white">{title}</h3>
      <p className="mt-1 break-keep text-xs font-bold text-text-secondary">{message}</p>
      <button type="button" onClick={onRetry} className="mt-4 rounded-pill border border-line bg-bg-card px-4 py-2 text-xs font-black text-white">다시 시도</button>
    </div>
  );
}

function ItemThumb({ imageUrl, name, large = false }: { imageUrl: string | null; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const boxClass = cn('shrink-0 overflow-hidden rounded-card-md border border-line bg-bg-deep', large ? 'h-20 w-20' : 'h-14 w-14');

  if (!imageUrl || failed) {
    return (
      <div className={cn(boxClass, 'flex items-center justify-center bg-gradient-to-br from-brand-primary/15 to-gold/10')}>
        <Cookie className={cn('text-gold/70', large ? 'h-8 w-8' : 'h-6 w-6')} />
      </div>
    );
  }

  return (
    <div className={boxClass}>
      <img src={resolveAssetUrl(imageUrl, 'icon')} alt={name} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
    </div>
  );
}

function MiniMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-card-sm border border-line bg-black/15 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] font-black text-text-muted">{icon}{label}</div>
      <div className="mt-0.5 text-xs font-black text-white">{value}</div>
    </div>
  );
}

function TinyStat({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="min-w-0 px-2 py-2.5 text-center">
      <div className="truncate text-[9px] font-black text-text-muted">{label}</div>
      <div className={cn('mt-0.5 font-display text-sm', emphasis ? 'text-warning' : 'text-white')}>{formatNumber(value)}</div>
    </div>
  );
}

function formatWait(seconds: number): string {
  if (seconds < 60) return '1분 미만';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}
