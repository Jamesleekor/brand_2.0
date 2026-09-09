import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import {
  inventoryMarketRpc,
  type SnackExchangeOption,
  type SnackExchangeOptionsBoard,
  type StudentInventoryItem,
} from '@/lib/rpc/inventory_market_rpc';
import { supabase } from '@/lib/supabase/client';
import { resolveAssetUrl } from '@/lib/assets/asset_urls';
import { cn } from '@/lib/utils/cn';

export function SnackTicketExchangeModal({
  item,
  onClose,
  onDone,
}: {
  item: StudentInventoryItem;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { call, isLoading } = useRpcCall();
  const [snackId, setSnackId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  const optionsQuery = useQuery<SnackExchangeOptionsBoard>({
    queryKey: ['snack-ticket-exchange-options', item.item_id],
    queryFn: async () => {
      const result = await inventoryMarketRpc.snackExchangeOptions(supabase, item.item_id);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  const selected = (optionsQuery.data?.items ?? []).find((row) => row.item_id === snackId) ?? null;
  const ticketAvailable = Math.min(item.available_quantity, optionsQuery.data?.available_ticket_quantity ?? item.available_quantity);
  const maxQty = selected ? Math.max(0, Math.min(100, ticketAvailable, selected.current_stock)) : 0;

  const choose = (option: SnackExchangeOption) => {
    setSnackId(option.item_id);
    setQuantity(1);
  };

  const exchange = async () => {
    if (!selected || quantity < 1 || quantity > maxQty) return;
    const result = await call(
      () => inventoryMarketRpc.exchangeSnackTicket(supabase, {
        p_ticket_item_id: item.item_id,
        p_snack_item_id: selected.item_id,
        p_quantity: quantity,
      }),
      {
        successTitle: '간식 교환 완료!',
        successDescription: `${item.name} ${quantity}개 → ${selected.name} ${quantity}개`,
      },
    );
    if (!result) return;
    await onDone();
  };

  return (
    <Modal isOpen onClose={onClose} title="간식 교환" emoji="🍪" size="lg">
      <div className="space-y-4">
        <div className="rounded-card-md border border-gold/30 bg-gold/5 p-3">
          <div className="font-display text-lg text-amber-100">🎟️ {item.name}</div>
          <div className="mt-1 text-xs font-bold text-text-secondary">사용 가능 {ticketAvailable}개 · 이용권 1개당 간식 1개</div>
          <div className="mt-1 text-[10px] font-bold text-text-muted">교환한 간식은 내 가방에 들어오며, 이후 제과점 수령 방식으로 사용할 수 있습니다. GOLD는 사용하지 않습니다.</div>
        </div>

        {optionsQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : optionsQuery.isError ? (
          <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-danger">
            {optionsQuery.error instanceof Error ? optionsQuery.error.message : '교환 가능한 간식을 불러오지 못했습니다.'}
          </div>
        ) : (optionsQuery.data?.items ?? []).length === 0 ? (
          <div className="rounded-card-lg border border-line bg-bg-deep">
            <EmptyState emoji="🍪" title="교환 가능한 간식이 없습니다" description="현재 재고가 1개 이상 남아 있는 간식이 없습니다." />
          </div>
        ) : (
          <div>
            <div className="mb-2 text-xs font-black text-text-secondary">교환할 간식을 선택하세요</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(optionsQuery.data?.items ?? []).map((option) => (
                <button
                  key={option.item_id}
                  type="button"
                  onClick={() => choose(option)}
                  className={cn(
                    'overflow-hidden rounded-card-md border bg-bg-deep text-left transition-all',
                    snackId === option.item_id ? 'border-gold/60 ring-1 ring-gold/30' : 'border-line hover:border-gold/30',
                  )}
                >
                  <div className="aspect-square bg-bg-card">
                    {option.image_url ? (
                      <img src={resolveAssetUrl(option.image_url, 'icon')} alt={option.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl">🍪</div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <div className="truncate text-xs font-black text-white">{option.name}</div>
                    <div className="mt-1 text-[10px] font-bold text-gold">재고 {option.current_stock}개</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="rounded-card-md border border-line bg-bg-deep p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black text-white">{selected.name}</div>
                <div className="mt-1 text-[10px] font-bold text-text-muted">최대 {maxQty}개 교환 가능</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-9 w-9 rounded-card-md border border-line bg-bg-card text-lg font-black text-white">−</button>
                <input
                  type="number"
                  min={1}
                  max={maxQty}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Math.min(maxQty, Number(event.target.value) || 1)))}
                  className="h-9 w-16 rounded-card-md border border-line bg-bg-card text-center font-display text-base text-white outline-none"
                />
                <button type="button" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} className="h-9 w-9 rounded-card-md border border-line bg-bg-card text-lg font-black text-white">＋</button>
              </div>
            </div>
          </div>
        )}

        <button type="button" disabled={isLoading || !selected || maxQty < 1} onClick={() => void exchange()} className="btn-primary w-full disabled:opacity-40">
          {isLoading ? '교환 중…' : selected ? `🎟️ ${quantity}개 → 🍪 ${quantity}개 교환` : '교환할 간식을 선택하세요'}
        </button>
      </div>
    </Modal>
  );
}
