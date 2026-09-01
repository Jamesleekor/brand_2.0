import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import {
  inventoryMarketRpc,
  type StudentInventoryItem,
  type StudentMarketItem,
  type StudentMarketStore,
} from '@/lib/rpc/inventory_market_rpc';
import type { MarketItemType } from '@/lib/zod_schemas/inventory_market_schemas';
import { supabase } from '@/lib/supabase/client';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { savingsRpc } from '@/lib/rpc/savings_rpc';

const TYPE_META: Record<MarketItemType, { label: string; emoji: string }> = {
  SNACK: { label: '간식', emoji: '🍪' },
  CONSUMABLE: { label: '꾸미기 아이템', emoji: '🎨' },
  TICKET: { label: '이용권', emoji: '🎟️' },
  AUCTION_PASS: { label: '경매 아이템', emoji: '⚡' },
  SPECIAL: { label: '특별 아이템', emoji: '🎁' },
};

type ItemFilter = 'ALL' | MarketItemType;

export function StudentMarketStorePanel() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ItemFilter>('ALL');
  const [search, setSearch] = useState('');
  const [buying, setBuying] = useState<StudentMarketItem | null>(null);

  const query = useQuery<StudentMarketStore>({
    queryKey: ['inventory-market-store'],
    queryFn: async () => {
      const result = await inventoryMarketRpc.myStore(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 10_000,
  });

  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.items ?? []).filter((item) => {
      if (filter !== 'ALL' && item.item_type !== filter) return false;
      if (!needle) return true;
      return [item.name, item.description, TYPE_META[item.item_type].label]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [filter, query.data?.items, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-market-store'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-my-bag'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-item-history'] }),
    ]);
  };

  if (query.isError) {
    return <MarketLoadError title="시장을 불러오지 못했습니다" error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.isLoading || !query.data) {
    return <div className="flex min-h-[360px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <section className="space-y-4 pb-6">
      <div className="overflow-hidden rounded-card-lg border border-line bg-gradient-to-br from-bg-card to-bg-deep p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gold">B.R.A.N.D MARKET</div>
            <h2 className="mt-1 font-display text-xl text-white">모험가의 시장</h2>
            <p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">재고가 줄수록 가격이 비선형적으로 상승하며, 시즌2 가격은 기본가의 최대 1.5배입니다.</p>
          </div>
          <div className="min-w-[150px] rounded-card-md border border-gold/25 bg-black/20 px-4 py-3 text-right">
            <div className="text-[10px] font-black text-text-muted">보유 GOLD</div>
            <div className="mt-0.5 font-display text-xl text-gold">🪙 {formatNumber(query.data.gold)}</div>
          </div>
        </div>
        {query.data.asset_freeze_active && (
          <div className="mt-3 rounded-card-md border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-black text-danger">🔒 자산 동결 중이라 현재 시장 구매·판매가 제한됩니다.</div>
        )}
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['ALL','SNACK','CONSUMABLE','TICKET','AUCTION_PASS','SPECIAL'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black transition-all',
                filter === key ? 'border-brand-primary/50 bg-brand-primary/20 text-white' : 'border-line bg-bg-deep text-text-secondary hover:text-white',
              )}
            >
              {key === 'ALL' ? '전체' : `${TYPE_META[key].emoji} ${TYPE_META[key].label}`}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="아이템 이름이나 설명 검색"
          className="mt-2 w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-text-primary outline-none focus:border-brand-primary/60"
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card">
          <EmptyState emoji="🏪" title="판매 중인 아이템이 없어요" description="선생님이 상품을 등록하면 이곳에 나타납니다." />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <MarketItemCard
              key={item.id}
              item={item}
              gold={query.data.gold}
              frozen={query.data.asset_freeze_active}
              onBuy={() => setBuying(item)}
            />
          ))}
        </div>
      )}

      {buying && (
        <PurchaseModal
          item={buying}
          gold={query.data.gold}
          frozen={query.data.asset_freeze_active}
          onClose={() => setBuying(null)}
          onDone={async () => {
            setBuying(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function MarketItemCard({ item, gold, frozen, onBuy }: { item: StudentMarketItem; gold: number; frozen: boolean; onBuy: () => void }) {
  const ratio = item.base_stock > 0 ? Math.max(0, Math.min(1, item.current_stock / item.base_stock)) : 0;
  const baseRise = item.base_price_gold > 0 ? ((item.effective_price_gold / item.base_price_gold) - 1) * 100 : 0;
  const weeklyRemaining = item.weekly_purchase_limit === null
    ? null
    : Math.max(0, item.weekly_purchase_limit - item.weekly_purchased_quantity);
  const unavailable = frozen || item.current_stock <= 0 || item.effective_price_gold > gold || weeklyRemaining === 0;

  return (
    <motion.article whileHover={{ y: -2 }} className="group overflow-hidden rounded-card-lg border border-line bg-bg-card shadow-sm transition-all hover:border-brand-primary/35">
      <div className="relative aspect-square overflow-hidden bg-bg-deep">
        <ItemImage item={item} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute left-2 top-2 rounded-pill border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-black text-white backdrop-blur-sm">
          {TYPE_META[item.item_type].emoji} {TYPE_META[item.item_type].label}
        </div>
        <div className="absolute right-2 top-2 rounded-pill border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-black text-white backdrop-blur-sm">
          재고 {item.current_stock}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50"><div className="h-full bg-brand-primary transition-all" style={{ width: `${ratio * 100}%` }} /></div>
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-black text-white">{item.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-8 text-[11px] font-medium leading-4 text-text-secondary">{item.description || '설명이 등록되지 않은 아이템입니다.'}</p>

        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <div className="font-display text-lg text-gold">🪙 {formatNumber(item.effective_price_gold)}</div>
            <div className="mt-0.5 text-[10px] font-bold text-text-muted">기본 {formatNumber(item.base_price_gold)} · <span className={baseRise > 0 ? 'text-danger' : 'text-success'}>{baseRise > 0 ? `▲ ${baseRise.toFixed(1)}%` : '기본가'}</span></div>
          </div>
          <div className="text-right text-[9px] font-bold text-text-muted">
            최고 {formatNumber(item.highest_price_gold)}
          </div>
        </div>

        {weeklyRemaining !== null && (
          <div className="mt-2 rounded-card-sm bg-bg-deep px-2 py-1.5 text-[10px] font-bold text-text-secondary">이번 주 남은 구매 {weeklyRemaining}개 / {item.weekly_purchase_limit}개</div>
        )}

        <button
          type="button"
          disabled={unavailable}
          onClick={onBuy}
          className="mt-3 w-full rounded-pill bg-gradient-to-r from-brand-primary to-gold py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {frozen ? '자산 동결' : item.current_stock <= 0 ? '품절' : item.effective_price_gold > gold ? 'GOLD 부족' : weeklyRemaining === 0 ? '주간 한도 도달' : '구매'}
        </button>
      </div>
    </motion.article>
  );
}

function PurchaseModal({ item, gold, frozen, onClose, onDone }: { item: StudentMarketItem; gold: number; frozen: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const weeklyRemaining = item.weekly_purchase_limit === null ? 100 : Math.max(0, item.weekly_purchase_limit - item.weekly_purchased_quantity);
  const affordable = item.effective_price_gold > 0 ? Math.floor(gold / item.effective_price_gold) : 0;
  const maxQty = Math.max(0, Math.min(100, item.current_stock, weeklyRemaining, affordable));
  const [quantity, setQuantity] = useState(Math.min(1, maxQty));
  const total = item.effective_price_gold * quantity;

  const buy = async () => {
    if (quantity < 1 || quantity > maxQty || frozen) return;
    const result = await call(
      () => inventoryMarketRpc.purchase(supabase, { p_item_id: item.id, p_quantity: quantity }),
      { successTitle: `${item.name} 구매 완료!`, successDescription: `${quantity}개 · ${formatNumber(total)} GOLD` },
    );
    if (result) await onDone();
  };

  return (
    <Modal isOpen onClose={onClose} title="아이템 구매" emoji="🛒">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-card-md border border-line bg-bg-deep p-3">
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-card-md bg-bg-card"><ItemImage item={item} className="h-full w-full object-cover" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-white">{item.name}</div>
            <div className="mt-1 text-xs font-bold text-text-secondary">개당 <span className="text-gold">{formatNumber(item.effective_price_gold)} GOLD</span></div>
            <div className="mt-1 text-[10px] font-bold text-text-muted">현재 재고 {item.current_stock}개{item.weekly_purchase_limit !== null ? ` · 이번 주 남은 한도 ${weeklyRemaining}개` : ''}</div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-black text-text-secondary">구매 수량</div>
          <div className="flex items-center justify-center gap-3">
            <button type="button" className="h-10 w-10 rounded-card-md border border-line bg-bg-deep text-xl font-black text-white" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
            <input type="number" min={1} max={maxQty} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))} className="h-10 w-24 rounded-card-md border border-line bg-bg-deep text-center font-display text-lg text-white outline-none" />
            <button type="button" className="h-10 w-10 rounded-card-md border border-line bg-bg-deep text-xl font-black text-white" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}>＋</button>
          </div>
        </div>

        <div className="rounded-card-md border border-gold/20 bg-gold/5 p-3 text-center">
          <div className="text-[10px] font-black text-text-muted">총 결제</div>
          <div className="mt-1 font-display text-xl text-gold">🪙 {formatNumber(total)} GOLD</div>
          <div className="mt-1 text-[10px] font-bold text-text-secondary">구매 후 시장 재고에 따라 다음 시세가 다시 계산됩니다.</div>
        </div>

        <button type="button" disabled={isLoading || maxQty < 1 || frozen} onClick={() => void buy()} className="btn-primary w-full disabled:opacity-40">{isLoading ? '구매 처리 중…' : '구매 확정'}</button>
      </div>
    </Modal>
  );
}

export function StudentInventoryPanel() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ItemFilter>('ALL');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<{ kind: 'USE' | 'SELL'; item: StudentInventoryItem } | null>(null);

  const query = useQuery({
    queryKey: ['inventory-my-bag'],
    queryFn: async () => {
      const result = await inventoryMarketRpc.myInventory(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 15_000,
  });

  const economyTerms = useQuery({
    queryKey: ['s4-economy-terms-market'],
    queryFn: async () => {
      const result = await savingsRpc.getEconomyTerms(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (query.data?.items ?? []).filter((item) => {
      if (filter !== 'ALL' && item.item_type !== filter) return false;
      if (!needle) return true;
      return [item.name, item.description, TYPE_META[item.item_type].label]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [filter, query.data?.items, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-my-bag'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-market-store'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-item-history'] }),
    ]);
  };

  if (query.isError) return <MarketLoadError title="내 가방을 불러오지 못했습니다" error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <div className="flex min-h-[360px] items-center justify-center"><LoadingSpinner size="lg" /></div>;

  const totalOwned = query.data.items.reduce((sum, item) => sum + item.owned_quantity, 0);
  const reserved = query.data.items.reduce((sum, item) => sum + item.reserved_quantity, 0);

  return (
    <section className="space-y-4 pb-6">
      <div className="rounded-card-lg border border-line bg-gradient-to-br from-bg-card to-bg-deep p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-crystal">INVENTORY</div>
            <h2 className="mt-1 font-display text-xl text-white">🎒 내 가방</h2>
            <p className="mt-1 text-xs font-bold text-text-secondary">구매한 아이템은 실제 게임 인벤토리처럼 이곳에 보관됩니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <BagStat label="보유" value={totalOwned} />
            <BagStat label="예약" value={reserved} />
          </div>
        </div>
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['ALL','SNACK','CONSUMABLE','TICKET','AUCTION_PASS','SPECIAL'] as const).map((key) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={cn('flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black', filter === key ? 'border-crystal/50 bg-crystal/15 text-white' : 'border-line bg-bg-deep text-text-secondary')}>
              {key === 'ALL' ? '전체' : `${TYPE_META[key].emoji} ${TYPE_META[key].label}`}
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="가방에서 아이템 검색" className="mt-2 w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-crystal/50" />
      </div>

      {items.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="🎒" title="가방이 비어 있어요" description="시장에서 아이템을 구매하면 이곳에 보관됩니다." /></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => <InventoryCard key={item.item_id} item={item} feeRate={economyTerms.data?.market_sell.effective_fee_rate ?? 0.10} buffReductionPp={economyTerms.data?.market_sell.buff_reduction_pp ?? 0} onAction={(kind) => setAction({ kind, item })} />)}
        </div>
      )}

      {action && (
        <InventoryActionModal
          action={action.kind}
          item={action.item}
          feeRate={economyTerms.data?.market_sell.effective_fee_rate ?? 0.10}
          buffReductionPp={economyTerms.data?.market_sell.buff_reduction_pp ?? 0}
          onClose={() => setAction(null)}
          onDone={async () => { setAction(null); await refresh(); }}
        />
      )}
    </section>
  );
}

function BagStat({ label, value }: { label: string; value: number }) {
  return <div className="min-w-[64px] rounded-card-md border border-line bg-black/20 px-3 py-2"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="font-display text-lg text-white">{value}</div></div>;
}

function InventoryCard({ item, feeRate, buffReductionPp, onAction }: { item: StudentInventoryItem; feeRate: number; buffReductionPp: number; onAction: (kind: 'USE' | 'SELL') => void }) {
  const canNormalUse = item.is_usable && (item.use_mode === 'IMMEDIATE' || item.use_mode === 'BAKERY_FULFILLMENT') && item.available_quantity > 0;
  const canSell = item.is_sellable && item.sellable_quantity > 0 && item.available_quantity > 0;

  return (
    <article className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
      <div className="relative aspect-square overflow-hidden bg-bg-deep">
        <ItemImage item={item} className="h-full w-full object-cover" />
        <div className="absolute left-2 top-2 rounded-pill bg-black/70 px-2 py-1 text-[10px] font-black text-white">{TYPE_META[item.item_type].emoji} {TYPE_META[item.item_type].label}</div>
        <div className="absolute bottom-2 right-2 min-w-9 rounded-pill border border-white/10 bg-black/80 px-2 py-1 text-center font-display text-sm text-white">×{item.owned_quantity}</div>
        {item.reserved_quantity > 0 && <div className="absolute right-2 top-2 rounded-pill bg-warning px-2 py-1 text-[9px] font-black text-black">예약 {item.reserved_quantity}</div>}
      </div>
      <div className="p-3">
        <h3 className="truncate text-sm font-black text-white">{item.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-text-secondary">{item.description || useModeHelp(item)}</p>
        <div className="mt-2 text-[10px] font-bold text-text-muted">사용 가능 {item.available_quantity}개 · 환불 가능 {item.sellable_quantity}개</div>
        {item.sellable_quantity > 0 && <div className="mt-1 text-[10px] font-black text-gold">전량 구매가 기준 {formatNumber(item.full_sellback_value_gold)} G · 수수료 {(feeRate * 100).toFixed(1)}%{buffReductionPp > 0 ? ` (컬렉션 -${Number(buffReductionPp).toFixed(1)}%p)` : ''}</div>}

        {item.use_mode === 'AUCTION_SUPER_PASS' && (
          <div className="mt-2 rounded-card-sm border border-warning/30 bg-warning-bg px-2 py-1.5 text-[10px] font-black text-warning">⚡ 경매 상품 공개 시 사용 여부를 선택합니다.</div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!canNormalUse} onClick={() => onAction('USE')} className="rounded-pill border border-crystal/40 bg-crystal/15 py-2 text-xs font-black text-crystal disabled:cursor-not-allowed disabled:opacity-35">{item.use_mode === 'BAKERY_FULFILLMENT' ? '사용·수령' : item.use_mode === 'AUCTION_SUPER_PASS' ? '경매 전용' : '사용'}</button>
          <button type="button" disabled={!canSell} onClick={() => onAction('SELL')} className="rounded-pill border border-gold/40 bg-gold/10 py-2 text-xs font-black text-gold disabled:cursor-not-allowed disabled:opacity-35">판매</button>
        </div>
      </div>
    </article>
  );
}

function InventoryActionModal({ action, item, feeRate, buffReductionPp, onClose, onDone }: { action: 'USE' | 'SELL'; item: StudentInventoryItem; feeRate: number; buffReductionPp: number; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const maxQty = action === 'SELL' ? Math.min(item.available_quantity, item.sellable_quantity) : item.available_quantity;
  const [quantity, setQuantity] = useState(1);

  const submit = async () => {
    if (quantity < 1 || quantity > maxQty) return;
    if (action === 'SELL') {
      const result = await call(
        () => inventoryMarketRpc.sell(supabase, { p_item_id: item.item_id, p_quantity: quantity }),
        {
          successTitle: `${item.name} 판매 완료`,
          successDescription: '구매 당시 가격(FIFO)을 기준으로 계산한 뒤 판매 수수료를 차감해 지급했습니다.',
        },
      );
      if (result) await onDone();
      return;
    }

    const result = await call(
      () => inventoryMarketRpc.use(supabase, { p_item_id: item.item_id, p_quantity: quantity }),
      {
        successTitle: item.use_mode === 'BAKERY_FULFILLMENT' ? '사용 완료 · 제과점 수령 대기 등록' : `${item.name} 사용 완료`,
        successDescription: item.use_mode === 'BAKERY_FULFILLMENT' ? '제과점 담당 학생에게 화면을 보여주고 실제 간식을 받아가세요.' : `${quantity}개 사용했습니다.`,
      },
    );
    if (result) await onDone();
  };

  return (
    <Modal isOpen onClose={onClose} title={action === 'SELL' ? '아이템 판매' : '아이템 사용'} emoji={action === 'SELL' ? '🪙' : '🎒'}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-card-md border border-line bg-bg-deep p-3">
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-card-md bg-bg-card"><ItemImage item={item} className="h-full w-full object-cover" /></div>
          <div><div className="font-black text-white">{item.name}</div><div className="mt-1 text-xs font-bold text-text-secondary">보유 {item.owned_quantity} · 사용 가능 {item.available_quantity}</div>{item.reserved_quantity > 0 && <div className="mt-1 text-[10px] font-black text-warning">예약 중 {item.reserved_quantity}개는 사용할 수 없습니다.</div>}</div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-10 w-10 rounded-card-md border border-line bg-bg-deep text-xl font-black">−</button>
          <input type="number" min={1} max={maxQty} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))} className="h-10 w-24 rounded-card-md border border-line bg-bg-deep text-center font-display text-lg text-white outline-none" />
          <button type="button" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} className="h-10 w-10 rounded-card-md border border-line bg-bg-deep text-xl font-black">＋</button>
        </div>

        {action === 'SELL' ? (
          <div className="rounded-card-md border border-gold/30 bg-gold/5 p-3 text-xs font-bold leading-relaxed text-text-secondary">
            <div className="font-black text-gold">구매가 기준 환불 − 판매 수수료</div>
            <div className="mt-1">서버가 실제 Purchase Lot을 오래된 순서대로 선택해 총 환불 기준액을 계산하고, 현재 판매 수수료 <b className="text-white">{(feeRate * 100).toFixed(1)}%</b>를 차감합니다.</div>
            {buffReductionPp > 0 && <div className="mt-1 font-black text-success">컬렉션 효과로 수수료 -{Number(buffReductionPp).toFixed(1)}%p 적용</div>}
            <div className="mt-1">수수료는 복지기금으로 적립되며 실제 금액은 판매 확정 시 서버가 계산합니다.</div>
            <div className="mt-1 text-warning">판매해도 이번 주 구매 제한 사용량은 복구되지 않습니다.</div>
          </div>
        ) : item.use_mode === 'BAKERY_FULFILLMENT' ? (
          <div className="rounded-card-md border border-success/30 bg-success-bg p-3 text-xs font-bold leading-relaxed text-text-secondary"><div className="font-black text-success">🍰 제과점 수령 방식</div><div className="mt-1">사용 즉시 가방에서 차감되고 제과점의 ‘수령 대기’에 기록됩니다. 교사 승인은 필요하지 않습니다.</div></div>
        ) : null}

        <button type="button" disabled={isLoading || maxQty < 1} onClick={() => void submit()} className="btn-primary w-full disabled:opacity-40">{isLoading ? '처리 중…' : action === 'SELL' ? '판매 확정' : '사용 확정'}</button>
      </div>
    </Modal>
  );
}

function ItemImage({ item, className }: { item: { image_url: string | null; name: string; item_type: MarketItemType }; className?: string }) {
  if (item.image_url) return <img src={resolveAssetUrl(item.image_url, 'icon')} alt={item.name} loading="lazy" className={className} />;
  return <div className={cn('flex items-center justify-center bg-gradient-to-br from-bg-soft to-bg-deep text-5xl', className)}>{TYPE_META[item.item_type].emoji}</div>;
}

function useModeHelp(item: StudentInventoryItem) {
  if (item.use_mode === 'AUCTION_SUPER_PASS') return '경매 상품 공개 시 우선입찰에 사용할 수 있습니다.';
  if (item.use_mode === 'BAKERY_FULFILLMENT') return '사용 후 제과점에서 실제 상품을 수령합니다.';
  if (item.use_mode === 'IMMEDIATE') return '사용 버튼을 누르면 즉시 소비됩니다.';
  if (item.use_mode === 'MANUAL') return '교사 또는 운영 담당자의 안내에 따라 사용합니다.';
  return '소장용 아이템입니다.';
}

function MarketLoadError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center"><div className="text-3xl">⚠️</div><h3 className="mt-2 font-display text-lg text-white">{title}</h3><p className="mt-2 break-all text-xs text-text-primary">{error instanceof Error ? error.message : '알 수 없는 오류'}</p><button type="button" onClick={onRetry} className="btn-secondary mt-4">다시 불러오기</button></div>;
}
