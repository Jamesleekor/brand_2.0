import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PrestigeFrame } from '@/components/shared/PrestigeFrame';
import { PRESTIGE_BORDER_ARTWORK, prestigeBorderArtwork } from '@/components/shared/prestigeBorderAssets';
import { selectMyCosmetic } from '@/features/font/fontCosmeticRpc';
import { PRESTIGE_BORDER_CATEGORY, useMyPrestigeBorders, type OwnedPrestigeBorder } from '@/hooks/usePrestigeBorders';
import type { ExpeditionLuxuryItem, ExpeditionLuxuryShop } from '@/lib/rpc/expedition_rpc';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import { LuxuryNameplateEffects, isNameplateLuxuryItem } from './LuxuryNameplateEffects';

type LuxuryClass = 'A' | 'B' | 'C';
type FrameTheme = 'MOON' | 'TREE' | 'DRAGON';
type PreviewPlace = 'FRIENDS' | 'GUILD' | 'RANKING';

const CLASS_TABS: Array<{ key: LuxuryClass; title: string; subtitle: string; level: number }> = [
  { key: 'A', title: 'A클래스', subtitle: '기본 명품', level: 1 },
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
  const [activeClass, setActiveClass] = useState<LuxuryClass>('C');
  const [theme, setTheme] = useState<FrameTheme>('MOON');
  const [place, setPlace] = useState<PreviewPlace>('FRIENDS');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [previewOwned, setPreviewOwned] = useState<OwnedPrestigeBorder | null>(null);
  const [busyBorderId, setBusyBorderId] = useState<number | null>(null);
  const [equipNotice, setEquipNotice] = useState<string | null>(null);

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

  return (
    <section className="overflow-hidden rounded-card-xl border border-[#D9B977]/45 bg-[#171522] shadow-card" aria-labelledby="luxury-shop-title">
      <div className="border-b border-[#D9B977]/25 bg-gradient-to-r from-[#34271E] via-[#23202F] to-[#151F2D] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black tracking-[0.16em] text-[#FFD58A]">EXPEDITION · LUXURY GALLERY</p>
            <h2 id="luxury-shop-title" className="mt-1 font-display text-2xl font-black text-white">명품관</h2>
            <p className="mt-1 text-[13px] font-semibold text-[#F6EFE7]">클래스를 선택해 미리보기·보유 상품·판매 상품을 한 화면에서 확인하세요.</p>
          </div>
          <div className="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-[12px] font-black text-[#FFF0C8]">
            {loading ? '확인 중' : error ? '불러오기 실패' : shop?.trial_open ? `특별 개방 · Lv.${shop.access_level}` : isOpen ? `개방 중 · Lv.${shop?.access_level ?? 0}` : '현재 판매 잠김'}
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
                <span className={`mt-1 block text-[10px] font-black ${accessible ? 'text-[#9DDDBD]' : 'text-white/40'}`}>
                  {classCounts[entry.key] > 0 ? `${classCounts[entry.key]}개 판매 중` : accessible ? '입고 준비 중' : `Lv.${entry.level} 개방`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {activeClass === 'A' && (
          <GenericClassCatalog
            title="A클래스 상품"
            description="가볍게 사용할 수 있는 기본 명품 아이템입니다."
            items={aItems}
            isOpen={isOpen}
            loading={loading}
            error={error}
            busyAction={busyAction}
            onBuy={onBuy}
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
                title="B클래스 판매 상품"
                items={borderItems}
                isOpen={isOpen}
                loading={loading}
                error={error}
                busyAction={busyAction}
                onPreview={(item) => { setSelectedItemId(item.item_id); setPreviewOwned(null); setTheme(themeFor(item)); }}
                onBuy={onBuy}
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
              onBuy={onBuy}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function GenericClassCatalog(props: {
  title: string;
  description: string;
  items: ExpeditionLuxuryItem[];
  isOpen: boolean;
  loading: boolean;
  error: boolean;
  busyAction: string | null;
  onBuy: (item: ExpeditionLuxuryItem, pricingId: number) => Promise<void>;
}) {
  return (
    <div role="tabpanel" aria-label={props.title}>
      <div className="mb-3">
        <div className="text-[11px] font-black tracking-[0.16em] text-[#EBD29A]">A CLASS · ESSENTIAL</div>
        <h3 className="mt-1 text-xl font-black text-white">{props.title}</h3>
        <p className="mt-1 text-[12px] font-semibold text-[#DCCFBE]">{props.description}</p>
      </div>
      <CompactProductGrid
        title={props.title}
        items={props.items}
        isOpen={props.isOpen}
        loading={props.loading}
        error={props.error}
        busyAction={props.busyAction}
        onBuy={props.onBuy}
        onPreview={() => undefined}
        columns="sm:grid-cols-2 lg:grid-cols-4"
      />
    </div>
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
      ) : !isOpen ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/15 p-3 text-[12px] font-semibold text-[#DCCFBE]">현재 클래스가 잠겨 있습니다.</p>
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
                  disabled={busyAction !== null}
                  onClick={() => void onBuy(item, pricing.pricing_id)}
                  className="mt-2 w-full rounded-full border border-[#FFD58A]/45 bg-[#FFD58A]/10 px-2 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
                >
                  {pricing.value_token === 'CRYSTAL' ? '💎' : '🪙'} {pricing.price.toLocaleString('ko-KR')} 구매
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
