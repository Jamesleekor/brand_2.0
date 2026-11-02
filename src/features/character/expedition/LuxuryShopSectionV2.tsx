import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PrestigeFrame } from '@/components/shared/PrestigeFrame';
import { PRESTIGE_BORDER_ARTWORK, prestigeBorderArtwork } from '@/components/shared/prestigeBorderAssets';
import { selectMyCosmetic } from '@/features/font/fontCosmeticRpc';
import { PRESTIGE_BORDER_CATEGORY, useMyPrestigeBorders, type OwnedPrestigeBorder } from '@/hooks/usePrestigeBorders';
import type { ExpeditionLuxuryItem, ExpeditionLuxuryShop } from '@/lib/rpc/expedition_rpc';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { LuxuryNameplateEffects, isNameplateLuxuryItem } from './LuxuryNameplateGallery';
import { LuxuryHiddenShardGallery } from './LuxuryHiddenShardGallery';

type LuxuryClass = 'A' | 'B' | 'C';
type FrameTheme = 'MOON' | 'TREE' | 'DRAGON';
type PreviewPlace = 'FRIENDS' | 'GUILD' | 'RANKING';
type LuxuryPricing = ExpeditionLuxuryItem['pricing'][number];
type PendingLuxuryPurchase = {
  item: ExpeditionLuxuryItem;
  pricing: LuxuryPricing;
};

const CLASS_TABS: Array<{ key: LuxuryClass; title: string; subtitle: string; level: number }> = [
  { key: 'A', title: 'A클래스', subtitle: '히든 편린', level: 1 },
  { key: 'B', title: 'B클래스', subtitle: '명예 테두리', level: 2 },
  { key: 'C', title: 'C클래스', subtitle: '이름 등장 효과', level: 3 },
];

const PRESTIGE_CONCEPT_UID: Record<FrameTheme, string> = {
  MOON: 'PRESTIGE_MOON_2026',
  TREE: 'PRESTIGE_TREE_2026',
  DRAGON: 'PRESTIGE_DRAGON_2026',
};

const CONCEPTS: Array<{ theme: FrameTheme; name: string; subtitle: string; symbol: string }> = [
  { theme: 'MOON', name: '카르코사의 달유리', subtitle: '은빛 달과 푸른 수정', symbol: '☾' },
  { theme: 'TREE', name: '세계수의 서약', subtitle: '잎맥과 에메랄드 빛', symbol: '✧' },
  { theme: 'DRAGON', name: '황금룡의 맹세', subtitle: '황금 비늘과 붉은 불꽃', symbol: '♛' },
];

const PLACES: Array<{ key: PreviewPlace; label: string }> = [
  { key: 'FRIENDS', label: '친구창' },
  { key: 'GUILD', label: '길드' },
  { key: 'RANKING', label: 'BV 랭킹' },
];

const FRAME_PALETTE: Record<FrameTheme, { edge: string; pale: string; glow: string; shade: string; ornament: string }> = {
  MOON: {
    edge: '#9FCFF7', pale: '#F1ECFF', glow: 'rgba(117,190,255,.35)',
    shade: 'linear-gradient(115deg,#111B38,#1E2550 62%,#151D39)', ornament: '☾',
  },
  TREE: {
    edge: '#91DBB1', pale: '#E2FFE5', glow: 'rgba(107,221,153,.3)',
    shade: 'linear-gradient(115deg,#0D302B,#173B32 62%,#142C2D)', ornament: '❧',
  },
  DRAGON: {
    edge: '#FFD18A', pale: '#FFF1D0', glow: 'rgba(255,188,88,.4)',
    shade: 'linear-gradient(115deg,#332019,#493026 62%,#261B23)', ornament: '✦',
  },
};

function themeFor(item: { item_uid: string; name: string }): FrameTheme {
  const code = `${item.item_uid} ${item.name}`.toLowerCase();
  if (/dragon|용|황금/.test(code)) return 'DRAGON';
  if (/tree|forest|world|세계수|숲/.test(code)) return 'TREE';
  return 'MOON';
}

export function LuxuryShopSectionV2({
  shop,
  loading,
  error,
  busyAction,
  onBuy,
}: {
  shop: ExpeditionLuxuryShop | null;
  loading: boolean;
  error: boolean;
  busyAction: string | null;
  onBuy: (item: ExpeditionLuxuryItem, pricingId: number) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const studentName = useAuthStore((state) => state.context?.studentName);
  const myBordersQuery = useMyPrestigeBorders();
  const [activeClass, setActiveClass] = useState<LuxuryClass>('A');
  const [theme, setTheme] = useState<FrameTheme>('MOON');
  const [place, setPlace] = useState<PreviewPlace>('FRIENDS');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [previewOwned, setPreviewOwned] = useState<OwnedPrestigeBorder | null>(null);
  const [busyBorderId, setBusyBorderId] = useState<number | null>(null);
  const [equipNotice, setEquipNotice] = useState<string | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<PendingLuxuryPurchase | null>(null);
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);

  const items = shop?.items ?? [];
  const aItems = items.filter((item) => item.luxury_group === 'A' && !isNameplateLuxuryItem(item));
  const borderItems = items.filter((item) => item.luxury_group === 'B' && !isNameplateLuxuryItem(item));
  const nameplateItems = items.filter((item) => item.luxury_group === 'C' || isNameplateLuxuryItem(item));
  const classCounts: Record<LuxuryClass, number> = {
    A: aItems.length,
    B: borderItems.length,
    C: nameplateItems.length,
  };
  const isOpen = shop?.open === true;
  const selectedItem = borderItems.find((item) => item.item_id === selectedItemId) ?? null;
  const currentTheme = previewOwned
    ? themeFor({ item_uid: previewOwned.itemUid, name: previewOwned.name })
    : selectedItem ? themeFor(selectedItem) : theme;
  const concept = CONCEPTS.find((entry) => entry.theme === theme) ?? CONCEPTS[0];
  const previewBorder: OwnedPrestigeBorder | null = previewOwned ?? (selectedItem?.presentation_kind === 'PRESTIGE_BORDER_IMAGE'
    ? {
      ownershipId: 0,
      studentId: 0,
      itemId: selectedItem.item_id,
      itemUid: selectedItem.item_uid,
      name: selectedItem.name,
      resourceUrl: prestigeBorderArtwork(selectedItem.item_uid, selectedItem.resource_url),
      isEquipped: false,
    }
    : selectedItem ? null : {
      ownershipId: 0,
      studentId: 0,
      itemId: 0,
      itemUid: PRESTIGE_CONCEPT_UID[concept.theme],
      name: concept.name,
      resourceUrl: PRESTIGE_BORDER_ARTWORK[PRESTIGE_CONCEPT_UID[concept.theme]],
      isEquipped: false,
    });

  const selectBorder = async (border: OwnedPrestigeBorder) => {
    if (busyBorderId !== null) return;
    setBusyBorderId(border.ownershipId);
    setEquipNotice(null);
    try {
      const result = await selectMyCosmetic(
        supabase,
        PRESTIGE_BORDER_CATEGORY,
        border.isEquipped ? null : border.ownershipId,
      );
      if (result.success === false) {
        setEquipNotice(result.error || '테두리를 변경하지 못했습니다.');
        return;
      }
      setEquipNotice(border.isEquipped ? '명예 테두리를 해제했습니다.' : `${border.name} 장착 완료!`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-prestige-borders'] }),
        queryClient.invalidateQueries({ queryKey: ['equipped-prestige-borders'] }),
      ]);
    } catch (caught) {
      setEquipNotice(caught instanceof Error ? caught.message : '테두리 변경 중 오류가 발생했습니다.');
    } finally {
      setBusyBorderId(null);
    }
  };

  const chooseClass = (nextClass: LuxuryClass) => {
    setActiveClass(nextClass);
    setEquipNotice(null);
  };

  const requestPurchase = async (item: ExpeditionLuxuryItem, pricingId: number) => {
    if (busyAction !== null || confirmingPurchase || pendingPurchase) return;
    const pricing = item.pricing.find((entry) => entry.pricing_id === pricingId);
    if (!pricing) return;
    setPendingPurchase({ item, pricing });
  };

  const cancelPurchase = () => {
    if (confirmingPurchase) return;
    setPendingPurchase(null);
  };

  const confirmPurchase = async () => {
    if (!pendingPurchase || confirmingPurchase || busyAction !== null) return;
    const target = pendingPurchase;
    setConfirmingPurchase(true);
    try {
      await onBuy(target.item, target.pricing.pricing_id);
      if (isNameplateLuxuryItem(target.item)) {
        await queryClient.invalidateQueries({ queryKey: ['my-nameplate-effects'] });
      }
      setPendingPurchase(null);
    } finally {
      setConfirmingPurchase(false);
    }
  };

  return (
    <>
    <section className="overflow-hidden rounded-card-xl border border-[#D9B977]/45 bg-[#171522] shadow-card" aria-labelledby="luxury-shop-title">
      <div className="border-b border-[#D9B977]/25 bg-gradient-to-r from-[#34271E] via-[#23202F] to-[#151F2D] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black tracking-[0.16em] text-[#FFD58A]">EXPEDITION · LUXURY GALLERY · 상시 전시 v2</p>
            <h2 id="luxury-shop-title" className="mt-1 font-display text-2xl font-black text-white">명품관</h2>
            <p className="mt-1 text-[13px] font-semibold text-[#F6EFE7]">클래스를 선택해 미리보기·보유 상품·판매 상품을 한 화면에서 확인하세요.</p>
          </div>
          <div className="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-[12px] font-black text-[#FFF0C8]">
            {loading ? '확인 중' : error ? '불러오기 실패' : shop?.trial_open ? `특별 개방 · Lv.${shop.access_level}` : isOpen ? `구매 개방 중 · Lv.${shop?.access_level ?? 0}` : '상시 전시 · 구매 개방 대기'}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2" role="tablist" aria-label="명품관 클래스 선택">
          {CLASS_TABS.map((entry) => {
            const active = activeClass === entry.key;
            const accessible = (shop?.access_level ?? 0) >= entry.level || shop?.trial_open === true;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => chooseClass(entry.key)}
                className={`min-w-0 rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-[#FFD58A] bg-[#FFD58A]/15 shadow-[0_0_18px_rgba(255,213,138,.08)]' : 'border-white/15 bg-black/15 hover:bg-white/[0.06]'}`}
              >
                <span className={`block text-[13px] font-black ${active ? 'text-[#FFE2A7]' : 'text-white'}`}>{entry.title}</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-[#DCCFBE]">{entry.subtitle}</span>
                <span className={`mt-1 block text-[10px] font-black ${accessible ? 'text-[#9DDDBD]' : 'text-[#F1E4D1]'}`}>
                  {classCounts[entry.key] > 0 ? `${classCounts[entry.key]}개 전시 중` : accessible ? '입고 준비 중' : `Lv.${entry.level} 개방`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {activeClass === 'A' && (
          <LuxuryHiddenShardGallery
            items={aItems}
            isOpen={isOpen}
            loading={loading}
            error={error}
            busyAction={busyAction}
            onBuy={requestPurchase}
          />
        )}

        {activeClass === 'B' && (
          <div role="tabpanel" aria-label="B클래스 명예 테두리">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[11px] font-black tracking-[0.16em] text-[#EBD29A]">B CLASS · PRESTIGE BORDER</div>
                <h3 className="mt-1 text-xl font-black text-white">명예 테두리</h3>
              </div>
              <span className="text-[11px] font-bold text-[#DCCFBE]">친구 · 길드 · 랭킹 적용</span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="명예 테두리 선택">
              {CONCEPTS.map((entry) => (
                <button
                  key={entry.theme}
                  type="button"
                  onClick={() => { setTheme(entry.theme); setSelectedItemId(null); setPreviewOwned(null); }}
                  aria-pressed={!selectedItem && !previewOwned && currentTheme === entry.theme}
                  className={`min-w-0 rounded-xl border px-2 py-2.5 text-left transition ${!selectedItem && !previewOwned && currentTheme === entry.theme ? 'border-[#FFD58A] bg-[#FFD58A]/15' : 'border-white/15 bg-white/[0.03] hover:bg-white/[0.07]'}`}
                >
                  <span className="text-[11px] font-black text-[#FFD58A]">{entry.symbol} B CLASS</span>
                  <span className="mt-1 block truncate text-[13px] font-black text-white sm:text-[14px]">{borderItems.find((item) => item.item_uid === PRESTIGE_CONCEPT_UID[entry.theme])?.name ?? entry.name}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="적용 위치 선택">
              {PLACES.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setPlace(entry.key)}
                  aria-pressed={place === entry.key}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-black ${place === entry.key ? 'border-[#FFD58A] bg-[#FFD58A]/20 text-white' : 'border-white/20 text-[#F6EFE7]'}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <div ref={previewRef} className="mt-3 rounded-xl border border-white/10 bg-[#0B0D19] px-3 py-5 sm:px-5">
              <PrestigeFrame border={previewBorder} variant={place === 'FRIENDS' ? 'friend' : place === 'GUILD' ? 'guild' : 'rankingStandard'} className="luxury-prestige-preview mx-auto max-w-[530px]">
                <PrestigePreviewCard theme={currentTheme} place={place} name={studentName || '학생 이름'} />
              </PrestigeFrame>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <h4 className="text-sm font-black text-white">내 명예 테두리</h4>
                {equipNotice && <p role="status" className="mt-2 rounded-lg border border-[#D9B977]/30 bg-white/[0.04] p-2 text-[12px] font-bold text-white">{equipNotice}</p>}
                {myBordersQuery.isLoading ? (
                  <p className="mt-2 text-[12px] font-semibold text-[#DCCFBE]">보유 내역 확인 중…</p>
                ) : (myBordersQuery.data ?? []).length === 0 ? (
                  <p className="mt-2 text-[12px] font-semibold text-[#DCCFBE]">보유한 명예 테두리가 없습니다.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {(myBordersQuery.data ?? []).map((border) => (
                      <div key={border.ownershipId} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/15 p-2">
                        <img src={border.resourceUrl} alt="" className="h-9 w-16 flex-none object-contain" loading="lazy" />
                        <div className="min-w-0 flex-1 truncate text-[12px] font-black text-white">{border.name}</div>
                        <button type="button" onClick={() => { setPreviewOwned(border); setTheme(themeFor({ item_uid: border.itemUid, name: border.name })); }} className="rounded-full border border-white/20 px-2 py-1 text-[11px] font-black text-white">보기</button>
                        <button type="button" disabled={busyBorderId !== null} onClick={() => void selectBorder(border)} className="rounded-full border border-[#FFD58A]/50 bg-[#FFD58A]/10 px-2 py-1 text-[11px] font-black text-white disabled:opacity-50">
                          {busyBorderId === border.ownershipId ? '처리…' : border.isEquipped ? '해제' : '장착'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <CompactProductGrid
                title="B클래스 전시 상품"
                items={borderItems}
                isOpen={isOpen}
                loading={loading}
                error={error}
                busyAction={busyAction}
                onPreview={(item) => { setSelectedItemId(item.item_id); setPreviewOwned(null); setTheme(themeFor(item)); }}
                onBuy={requestPurchase}
                columns="sm:grid-cols-3"
              />
            </div>
          </div>
        )}

        {activeClass === 'C' && (
          <div role="tabpanel" aria-label="C클래스 이름 등장 효과">
            <LuxuryNameplateEffects
              items={nameplateItems}
              studentName={studentName || '학생 이름'}
              isOpen={isOpen}
              loading={loading}
              error={error}
              busyAction={busyAction}
              onBuy={requestPurchase}
            />
          </div>
        )}
      </div>
    </section>
    {pendingPurchase && (
      <LuxuryPurchaseConfirmDialog
        purchase={pendingPurchase}
        isSubmitting={confirmingPurchase || busyAction !== null}
        onCancel={cancelPurchase}
        onConfirm={confirmPurchase}
      />
    )}
    </>
  );
}

function LuxuryPurchaseConfirmDialog({
  purchase,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  purchase: PendingLuxuryPurchase;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const currencyLabel = purchase.pricing.value_token === 'CRYSTAL' ? '크리스탈' : '골드';
  const currencyIcon = purchase.pricing.value_token === 'CRYSTAL' ? '💎' : '🪙';

  useEffect(() => {
    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onCancel]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1800] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="luxury-purchase-confirm-title"
      aria-describedby="luxury-purchase-confirm-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-card-xl border border-[#E9C46A]/55 bg-[#15131E] shadow-[0_24px_80px_rgba(0,0,0,.65)]">
        <div className="border-b border-[#E9C46A]/25 bg-gradient-to-r from-[#3A2B1F] via-[#27202E] to-[#171D2B] px-5 py-4">
          <p className="text-[11px] font-black tracking-[0.16em] text-[#FFD58A]">FINAL PURCHASE CONFIRMATION</p>
          <h3 id="luxury-purchase-confirm-title" className="mt-1 font-display text-xl font-black text-[#FFF7ED]">명품관 구매 최종 확인</h3>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 rounded-card-lg border border-white/10 bg-black/20 p-3">
            {purchase.item.resource_url && (
              <img src={purchase.item.resource_url} alt="" className="h-16 w-16 flex-none object-contain" />
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-black text-[#EBD29A]">{purchase.item.luxury_group} CLASS</p>
              <p className="mt-1 text-base font-black leading-5 text-[#FFF7ED]">{purchase.item.name}</p>
            </div>
          </div>

          <p id="luxury-purchase-confirm-description" className="rounded-card-lg border border-[#FF9B8F]/35 bg-[#5C211C]/25 px-4 py-3 text-sm font-black leading-6 text-[#FFD8D3]">
            구매 후 재판매 또는 환불은 불가능합니다. 정말 구매하시겠습니까?
          </p>

          <div className="flex items-center justify-between rounded-card-lg border border-[#E9C46A]/35 bg-[#E9C46A]/10 px-4 py-3">
            <span className="text-sm font-black text-[#FFF7ED]">최종 가격</span>
            <span className="text-base font-black text-[#FFD58A]">
              {currencyIcon} {purchase.pricing.price.toLocaleString('ko-KR')} {currencyLabel}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-white/10 bg-black/20 p-4">
          <button type="button" onClick={onCancel} disabled={isSubmitting} className="btn-secondary py-3 disabled:opacity-50">
            취소
          </button>
          <button ref={confirmButtonRef} type="button" onClick={() => void onConfirm()} disabled={isSubmitting} className="btn-primary py-3 disabled:opacity-50">
            {isSubmitting ? '구매 처리 중…' : '구매 확정'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CompactProductGrid({
  title,
  items,
  isOpen,
  loading,
  error,
  busyAction,
  onPreview,
  onBuy,
  columns,
}: {
  title: string;
  items: ExpeditionLuxuryItem[];
  isOpen: boolean;
  loading: boolean;
  error: boolean;
  busyAction: string | null;
  onPreview: (item: ExpeditionLuxuryItem) => void;
  onBuy: (item: ExpeditionLuxuryItem, pricingId: number) => Promise<void>;
  columns: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <h4 className="text-sm font-black text-white">{title}</h4>
      {loading ? (
        <p className="mt-3 text-[12px] font-semibold text-[#DCCFBE]">상품을 불러오는 중입니다.</p>
      ) : error ? (
        <p className="mt-3 text-[12px] font-semibold text-[#F5B7B7]">상품 정보를 확인할 수 없습니다.</p>
      ) : items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/15 p-3 text-[12px] font-semibold text-[#DCCFBE]">현재 판매 중인 상품이 없습니다.</p>
      ) : (
        <div className={`mt-3 grid gap-2 ${columns}`}>
          {items.map((item) => (
            <article key={item.item_id} className="min-w-0 rounded-lg border border-white/10 bg-[#0D101C] p-2.5">
              <button type="button" onClick={() => onPreview(item)} className="w-full text-left">
                {item.resource_url && <img src={item.resource_url} alt="" className="mx-auto h-12 w-full object-contain" loading="lazy" />}
                <div className="mt-1 truncate text-[12px] font-black text-white">{item.name}</div>
                <div className="mt-0.5 text-[10px] font-bold text-[#DCCFBE]">{item.owned ? '보유 중' : `GROUP ${item.luxury_group}`}</div>
              </button>
              {!item.owned && item.pricing.slice(0, 1).map((pricing) => (
                <button
                  key={pricing.pricing_id}
                  type="button"
                  disabled={busyAction !== null || !isOpen || item.available_for_purchase !== true || item.purchase_eligible === false}
                  onClick={() => void onBuy(item, pricing.pricing_id)}
                  className="mt-2 w-full rounded-full border border-[#FFD58A]/45 bg-[#FFD58A]/10 px-2 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
                >
                  {pricing.value_token === 'CRYSTAL' ? '💎' : '🪙'} {pricing.price.toLocaleString('ko-KR')} {isOpen && item.available_for_purchase === true ? '구매' : '개방 대기'}
                </button>
              ))}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function PrestigePreviewCard({ theme, place, name }: { theme: FrameTheme; place: PreviewPlace; name: string }) {
  const colors = FRAME_PALETTE[theme];
  const compact = place === 'RANKING';
  return (
    <div className={`relative isolate mx-auto flex w-full items-center rounded-[18px] ${compact ? 'max-w-[360px]' : 'max-w-[520px]'}`} style={{ boxShadow: `0 0 20px ${colors.glow}` }}>
      <div className={`relative z-10 flex min-w-0 w-full items-center rounded-[13px] ${compact ? 'gap-2 px-2.5 py-2' : 'gap-3 px-3 py-3'}`} style={{ background: colors.shade }}>
        <div className={`grid shrink-0 place-items-center rounded-full border-[3px] font-display font-black ${compact ? 'h-11 w-11 text-lg' : 'h-14 w-14 text-2xl'}`} style={{ borderColor: colors.edge, color: colors.pale, background: `radial-gradient(circle, ${colors.glow}, #121827 75%)` }}>{colors.ornament}</div>
        <div className="min-w-0 flex-1 text-left">
          <div className={`truncate font-black text-white ${compact ? 'text-[17px]' : 'text-[20px]'}`}>{name}</div>
          <div className="mt-0.5 truncate text-[12px] font-black" style={{ color: colors.edge }}>소속 길드 · 미리보기</div>
          <div className="truncate text-[12px] font-bold" style={{ color: colors.pale }}>장착 칭호 · 미리보기</div>
        </div>
        {compact && <div className="text-[11px] font-black" style={{ color: colors.edge }}>BV</div>}
      </div>
    </div>
  );
}
