import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import {
  inventoryMarketRpc,
  type ItemHistoryFilter,
  type StudentItemHistoryRow,
} from '@/lib/rpc/inventory_market_rpc';
import { supabase } from '@/lib/supabase/client';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { formatDateTime, formatDelta, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

const PAGE_SIZE = 30;

const FILTERS: { value: ItemHistoryFilter; label: string; emoji: string }[] = [
  { value: 'ALL', label: '전체', emoji: '📜' },
  { value: 'PURCHASE', label: '구매', emoji: '🛒' },
  { value: 'SALE', label: '판매', emoji: '🪙' },
  { value: 'USE', label: '사용', emoji: '✨' },
];

const EVENT_META = {
  PURCHASE: { label: '구매', emoji: '🛒', cls: 'border-danger/30 bg-danger-bg text-danger' },
  SALE: { label: '판매', emoji: '🪙', cls: 'border-success/30 bg-success-bg text-success' },
  USE: { label: '사용', emoji: '✨', cls: 'border-crystal/30 bg-crystal/10 text-crystal' },
} as const;

export default function StudentItemHistoryPanel() {
  const [filter, setFilter] = useState<ItemHistoryFilter>('ALL');

  const query = useInfiniteQuery({
    queryKey: ['inventory-item-history', filter],
    queryFn: async ({ pageParam = 0 }) => {
      const result = await inventoryMarketRpc.myItemHistory(supabase, {
        p_limit: PAGE_SIZE,
        p_offset: pageParam * PAGE_SIZE,
        p_event_type: filter,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0);
      return loaded < lastPage.total_count ? pages.length : undefined;
    },
    refetchInterval: 15_000,
  });

  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  const totalCount = query.data?.pages[0]?.total_count ?? 0;

  return (
    <section className="space-y-4 pb-6">
      <div className="rounded-card-lg border border-line bg-gradient-to-br from-bg-card to-bg-deep p-4">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-crystal">ITEM HISTORY</div>
        <h2 className="mt-1 font-display text-xl text-white">📜 내 아이템 내역</h2>
        <p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">
          내가 시장에서 구매·판매하거나 실제로 사용한 아이템 기록입니다. SUPER PASS 소진도 사용 내역에 남습니다.
        </p>
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                filter === item.value
                  ? 'border-crystal/50 bg-crystal/15 text-white'
                  : 'border-line bg-bg-deep text-text-secondary',
              )}
            >
              {item.emoji} {item.label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-right text-[10px] font-bold text-text-muted">총 {formatNumber(totalCount)}건</div>
      </div>

      {query.isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center"><LoadingSpinner size="lg" /></div>
      ) : query.isError ? (
        <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5">
          <div className="font-black text-danger">아이템 내역을 불러오지 못했습니다.</div>
          <div className="mt-1 break-all text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</div>
          <button type="button" onClick={() => void query.refetch()} className="btn-secondary mt-3">다시 불러오기</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card">
          <EmptyState emoji="📜" title="아직 아이템 내역이 없어요" description="아이템을 구매·판매·사용하면 여기에 기록됩니다." />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => <HistoryCard key={row.inventory_event_id} row={row} />)}
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="btn-secondary w-full"
            >
              {query.isFetchingNextPage ? '불러오는 중…' : '이전 내역 더 보기'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryCard({ row }: { row: StudentItemHistoryRow }) {
  const meta = EVENT_META[row.event_type];
  const isSuperPassUse = row.raw_event_type === 'CONSUME_RESERVED';
  const fulfillmentLabel = row.fulfillment_status === 'PENDING'
    ? '제과점 수령 대기'
    : row.fulfillment_status === 'DELIVERED'
      ? '제과점 지급 완료'
      : row.fulfillment_status === 'CANCELLED'
        ? '수령 취소'
        : null;

  return (
    <article className="flex gap-3 rounded-card-lg border border-line bg-bg-card p-3 sm:p-4">
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-card-md border border-line bg-bg-deep">
        {row.image_url ? (
          <img src={resolveAssetUrl(row.image_url, 'icon')} alt={row.item_name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl">📦</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{row.item_name}</div>
            <div className="mt-0.5 text-[10px] font-bold text-text-muted">{formatDateTime(row.created_at)}</div>
          </div>
          <span className={cn('rounded-pill border px-2 py-1 text-[10px] font-black', meta.cls)}>
            {meta.emoji} {isSuperPassUse ? 'SUPER PASS 사용' : meta.label}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold">
          <span className="text-text-secondary">수량 <strong className="text-white">×{row.quantity}</strong></span>
          {row.gold_delta !== 0 && (
            <span className={row.gold_delta > 0 ? 'text-success' : 'text-danger'}>
              {formatDelta(row.gold_delta)} GOLD
            </span>
          )}
          {fulfillmentLabel && <span className="text-warning">{fulfillmentLabel}</span>}
        </div>
      </div>
    </article>
  );
}
