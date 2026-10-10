import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { PrestigeFrame } from '@/components/shared/PrestigeFrame';
import { PRESTIGE_BORDER_ARTWORK, prestigeBorderArtwork } from '@/components/shared/prestigeBorderAssets';
import { selectMyCosmetic } from '@/features/font/fontCosmeticRpc';
import { PRESTIGE_BORDER_CATEGORY, useMyPrestigeBorders, type OwnedPrestigeBorder } from '@/hooks/usePrestigeBorders';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth_store';
import type { ExpeditionLuxuryItem, ExpeditionLuxuryShop } from '@/lib/rpc/expedition_rpc';

type FrameTheme = 'MOON' | 'TREE' | 'DRAGON';
type PreviewPlace = 'FRIENDS' | 'GUILD' | 'RANKING';

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

const FRAME_PALETTE: Record<FrameTheme, {
  edge: string; pale: string; glow: string; shade: string; ornament: string;
}> = {
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

function PrestigeCard({
  theme, place, name,
}: {
  theme: FrameTheme; place: PreviewPlace; name: string;
}) {
  const colors = FRAME_PALETTE[theme];
  const compact = place === 'RANKING';
  return (
    <div
      className={`relative isolate mx-auto flex w-full items-center rounded-[18px] shadow-lg ${compact ? 'max-w-[360px]' : 'max-w-[520px]'}`}
      style={{ boxShadow: `0 0 24px ${colors.glow}` }}
      aria-label={`${place === 'FRIENDS' ? '친구창' : place === 'GUILD' ? '길드' : 'BV 랭킹'} 프로필 테두리 미리보기`}
    >
      <div className={`relative z-10 flex min-w-0 w-full items-center rounded-[13px] ${compact ? 'gap-2.5 px-2.5 py-2' : 'gap-3 px-3 py-3 sm:px-4'}`} style={{ background: colors.shade }}>
        <div
          className={`flex shrink-0 items-center justify-center rounded-full border-[3px] font-display font-black ${compact ? 'h-12 w-12 text-xl' : 'h-16 w-16 text-[28px] sm:h-[72px] sm:w-[72px]'}`}
          style={{ borderColor: colors.edge, color: colors.pale, background: `radial-gradient(circle, ${colors.glow}, #121827 75%)`, boxShadow: `0 0 14px ${colors.glow}` }}
          aria-label="티어 아이콘 자리"
        >
          {colors.ornament}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className={`truncate font-black leading-tight text-white ${compact ? 'text-[19px]' : 'text-[21px] sm:text-[23px]'}`}>{name}</div>
          <div className="mt-1 truncate text-[14px] font-black leading-tight" style={{ color: colors.edge }}>소속 길드 · 미리보기</div>
          <div className="mt-0.5 truncate text-[14px] font-bold leading-tight" style={{ color: colors.pale }}>장착 칭호 · 미리보기</div>
        </div>
        {place === 'RANKING' && <div className="shrink-0 self-start text-[13px] font-black" style={{ color: colors.edge }}>BV</div>}
      </div>
    </div>
  );
}

export function LuxuryShopSection({
  shop, loading, error, busyAction, onBuy,
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
  const [theme, setTheme] = useState<FrameTheme>('MOON');
  const [place, setPlace] = useState<PreviewPlace>('FRIENDS');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [previewOwned, setPreviewOwned] = useState<OwnedPrestigeBorder | null>(null);
  const [busyBorderId, setBusyBorderId] = useState<number | null>(null);
  const [equipNotice, setEquipNotice] = useState<string | null>(null);
  const items = shop?.items ?? [];
  const selectedItem = items.find((item) => item.item_id === selectedItemId) ?? null;
  const currentTheme = previewOwned
    ? themeFor({ item_uid: previewOwned.itemUid, name: previewOwned.name })
    : selectedItem ? themeFor(selectedItem) : theme;
  const isOpen = shop?.open === true;
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
    } catch (error) {
      setEquipNotice(error instanceof Error ? error.message : '테두리 변경 중 오류가 발생했습니다.');
    } finally {
      setBusyBorderId(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-card-xl border border-[#D9B977]/45 bg-[#171522] shadow-card" aria-labelledby="luxury-shop-title">
      <div className="border-b border-[#D9B977]/25 bg-gradient-to-r from-[#34271E] via-[#23202F] to-[#151F2D] px-4 py-5 sm:px-6">
        <p className="text-[13px] font-black tracking-[0.16em] text-[#FFD58A]">EXPEDITION · LUXURY GALLERY</p>
        <h2 id="luxury-shop-title" className="mt-1 font-display text-2xl font-black text-white">명품관</h2>
        <p className="mt-1 text-sm font-semibold leading-relaxed text-[#F6EFE7]">원정의 명예를 프로필에 남기는 한정 꾸미기. 구매 전 실제 목록 크기로 확인해 보세요.</p>
        <div className="mt-3 inline-flex rounded-full border border-white/25 bg-black/25 px-3 py-1.5 text-[13px] font-black text-[#FFF0C8]">
          {loading ? '개방 상태 확인 중' : error ? '상점 상태를 불러오지 못했습니다' : shop?.trial_open ? `명예 테두리 특별 개방 중 · Lv.${shop.access_level}` : isOpen ? `개방 중 · Lv.${shop?.access_level ?? 0}` : '월드효과 활성화 시 판매 개방'}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-black text-white">명예 테두리 미리보기</h3>
            <p className="mt-0.5 text-[13px] font-semibold text-[#F6EFE7]">이름을 첫 줄에 크게 놓고 길드와 칭호를 바로 아래에 배치했습니다.</p>
          </div>
          <span className="text-[12px] font-bold text-[#E7D7C4]">전시용 시안 · 적용 화면 크기 확인</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="명예 테두리 선택">
          {CONCEPTS.map((concept, index) => (
            <button
              key={concept.theme}
              type="button"
              onClick={() => { setTheme(concept.theme); setSelectedItemId(null); setPreviewOwned(null); }}
              aria-pressed={!selectedItem && !previewOwned && currentTheme === concept.theme}
              className={`min-w-0 rounded-xl border px-2 py-3 text-left transition-colors sm:px-3 ${!selectedItem && !previewOwned && currentTheme === concept.theme ? 'border-[#FFD58A] bg-[#FFD58A]/15' : 'border-white/20 bg-white/[0.04] hover:bg-white/10'}`}
            >
              <span className="block text-[12px] font-black text-[#FFD58A]">0{index + 1} {concept.symbol}</span>
              <span className="mt-1 block truncate text-[13px] font-black text-white sm:text-[15px]">{concept.name}</span>
              <span className="mt-0.5 hidden text-[12px] font-semibold text-[#EEE1D3] sm:block">{concept.subtitle}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2" role="group" aria-label="적용 위치 선택">
          {PLACES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setPlace(entry.key)}
              aria-pressed={place === entry.key}
              className={`rounded-full border px-3 py-2 text-[13px] font-black ${place === entry.key ? 'border-[#FFD58A] bg-[#FFD58A]/20 text-white' : 'border-white/20 text-[#F6EFE7]'}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div ref={previewRef} className="mt-3 rounded-2xl border border-white/15 bg-[#0B0D19] px-3 py-6 sm:px-6 sm:py-8">
          {selectedItem && selectedItem.presentation_kind !== 'PRESTIGE_BORDER_IMAGE' ? (
            <img src={selectedItem.resource_url} alt={`${selectedItem.name} 적용 이미지 미리보기`} className="mx-auto max-h-52 w-full object-contain" />
          ) : (
            <PrestigeFrame border={previewBorder} className="mx-auto max-w-[530px]">
              <PrestigeCard theme={currentTheme} place={place} name={studentName || '학생 이름'} />
            </PrestigeFrame>
          )}
          <p className="mt-3 text-center text-[12px] font-semibold text-[#E7D7C4]">
            {selectedItem && selectedItem.presentation_kind !== 'PRESTIGE_BORDER_IMAGE'
              ? '상품 이미지 미리보기입니다.'
              : '길드·칭호·티어 아이콘은 표시 위치를 보여주는 예시입니다.'}
          </p>
        </div>

        {selectedItem && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#D9B977]/35 bg-white/[0.04] p-3">
            <img src={prestigeBorderArtwork(selectedItem.item_uid, selectedItem.resource_url)} alt={`${selectedItem.name} 상품 이미지`} className="h-16 w-16 rounded-lg object-contain" loading="lazy" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-white">{selectedItem.name}</div>
              <div className="mt-0.5 text-[13px] font-semibold text-[#F6EFE7]">{selectedItem.description}</div>
            </div>
          </div>
        )}

        <div className="mt-7 border-t border-white/15 pt-5">
          <h3 className="text-lg font-black text-white">내 명예 테두리</h3>
          {equipNotice && <p role="status" className="mt-2 rounded-xl border border-[#D9B977]/35 bg-white/[0.05] p-3 text-sm font-bold text-white">{equipNotice}</p>}
          {myBordersQuery.isLoading ? (
            <p className="mt-2 text-sm font-semibold text-[#F6EFE7]">보유 테두리를 확인하는 중입니다.</p>
          ) : myBordersQuery.isError ? (
            <button type="button" onClick={() => void myBordersQuery.refetch()} className="mt-2 rounded-full border border-white/30 px-3 py-2 text-sm font-bold text-white">보유 내역 다시 불러오기</button>
          ) : (myBordersQuery.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm font-semibold text-[#F6EFE7]">보유한 명예 테두리가 없습니다.</p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(myBordersQuery.data ?? []).map((border) => (
                <div key={border.ownershipId} className="rounded-xl border border-white/20 bg-white/[0.04] p-3">
                  <div className="flex items-center gap-2">
                    <img src={border.resourceUrl} alt="" className="h-12 w-12 rounded-md object-contain" loading="lazy" />
                    <div className="min-w-0 flex-1 truncate text-sm font-black text-white">{border.name}</div>
                    {border.isEquipped && <span className="shrink-0 text-[12px] font-black text-[#B9E9D0]">장착 중</span>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => { setPreviewOwned(border); setSelectedItemId(null); setTheme(themeFor({ item_uid: border.itemUid, name: border.name })); previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} className="flex-1 rounded-full border border-white/30 px-2 py-2 text-[13px] font-black text-white">미리보기</button>
                    <button type="button" disabled={busyBorderId !== null} onClick={() => void selectBorder(border)} className="flex-1 rounded-full border border-[#FFD58A]/60 bg-[#FFD58A]/15 px-2 py-2 text-[13px] font-black text-white disabled:opacity-50">
                      {busyBorderId === border.ownershipId ? '처리 중…' : border.isEquipped ? '해제' : '장착'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-7 border-t border-white/15 pt-5">
          <h3 className="text-lg font-black text-white">판매 상품</h3>
          {loading ? (
            <p className="mt-3 text-sm font-semibold text-[#F6EFE7]">상품을 불러오는 중입니다.</p>
          ) : error ? (
            <p className="mt-3 text-sm font-semibold text-[#F6EFE7]">상품 정보를 확인할 수 없습니다. 잠시 후 다시 열어 주세요.</p>
          ) : !isOpen ? (
            <p className="mt-3 rounded-xl border border-white/15 bg-white/[0.04] p-4 text-sm font-semibold text-[#F6EFE7]">명품관 개방 월드효과가 활성화되면 이곳에서 한정 상품을 구매할 수 있습니다. 위 시안은 지금 미리 볼 수 있습니다.</p>
          ) : items.length === 0 ? (
            <p className="mt-3 rounded-xl border border-white/15 bg-white/[0.04] p-4 text-sm font-semibold text-[#F6EFE7]">현재 판매 중인 상품이 없습니다. 다음 입고를 기다려 주세요.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <article key={item.item_id} className="min-w-0 overflow-hidden rounded-xl border border-[#D9B977]/35 bg-[#0D101C]">
                  <button
                    type="button"
                    onClick={() => { setSelectedItemId(item.item_id); setPreviewOwned(null); setTheme(themeFor(item)); previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                    className="flex w-full flex-col items-start p-3 text-left hover:bg-white/[0.05]"
                    aria-label={`${item.name} 미리보기`}
                  >
                    <img src={prestigeBorderArtwork(item.item_uid, item.resource_url)} alt="" className="h-24 w-full object-contain" loading="lazy" />
                    <span className="mt-2 text-[12px] font-black text-[#FFD58A]">GROUP {item.luxury_group} · Lv.{item.required_effect_level}</span>
                    <span className="mt-1 text-base font-black text-white">{item.name}</span>
                    <span className="mt-1 text-[13px] font-semibold text-[#F6EFE7]">{item.description}</span>
                    <span className="mt-2 text-[13px] font-black text-[#B9E9D0]">미리보기 선택 →</span>
                  </button>
                  <div className="space-y-2 border-t border-white/10 p-3">
                    {item.owned ? (
                      <div className="rounded-full border border-[#91DBB1]/50 px-3 py-2 text-center text-sm font-black text-[#B9E9D0]">보유 중</div>
                    ) : item.pricing.length === 0 ? (
                      <div className="text-[13px] font-semibold text-[#F6EFE7]">가격 준비 중</div>
                    ) : item.pricing.map((pricing) => (
                      <button
                        key={pricing.pricing_id}
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void onBuy(item, pricing.pricing_id)}
                        className="w-full rounded-full border border-[#FFD58A]/60 bg-[#FFD58A]/15 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                      >
                        {pricing.value_token === 'CRYSTAL' ? '💎' : '🪙'} {pricing.price.toLocaleString('ko-KR')} 구매
                        {pricing.condition_description && <span className="block text-[12px] font-semibold">{pricing.condition_description}</span>}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
