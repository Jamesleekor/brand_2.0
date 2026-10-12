import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { NameplateEffect, type NameplateEffectVariant } from '@/components/shared/NameplateEffect';
import { selectMyCosmetic } from '@/features/font/fontCosmeticRpc';
import {
  NAMEPLATE_EFFECT_CATEGORY,
  nameplateEffectKind,
  useMyNameplateEffects,
  type NameplateEffectKind,
  type OwnedNameplateEffect,
} from '@/hooks/useNameplateEffects';
import { supabase } from '@/lib/supabase/client';
import type { ExpeditionLuxuryItem } from '@/lib/rpc/expedition_rpc';

type PreviewPlace = 'FRIENDS' | 'GUILD' | 'RANKING' | 'RAID';

const EFFECTS: Array<{
  itemUid: string;
  kind: NameplateEffectKind;
  name: string;
  summary: string;
  symbol: string;
  residue: string;
}> = [
  { itemUid: 'NAMEFX_CORONATION_2026', kind: 'CORONATION', name: '황금 대관식', summary: '빛기둥을 타고 강림하는 이름표', symbol: '♛', residue: '금빛 잔불' },
  { itemUid: 'NAMEFX_CONSTELLATION_2026', kind: 'CONSTELLATION', name: '별자리 완성', summary: '별의 선이 이름표를 직조하는 연출', symbol: '✦', residue: '미세 별빛' },
  { itemUid: 'NAMEFX_SHARD_ASSEMBLY_2026', kind: 'SHARD_ASSEMBLY', name: '편린 대조립', summary: '흩어진 여덟 편린의 입체 결합', symbol: '◇', residue: '비취빛 조각' },
  { itemUid: 'NAMEFX_ROYAL_OPENING_2026', kind: 'ROYAL_OPENING', name: '황실 개막', summary: '커튼과 접힌 카드가 함께 열리는 연출', symbol: '❖', residue: '왕관과 금박' },
];

const PLACES: Array<{ key: PreviewPlace; label: string }> = [
  { key: 'FRIENDS', label: '친구창' },
  { key: 'GUILD', label: '길드' },
  { key: 'RANKING', label: '랭킹' },
  { key: 'RAID', label: '레이드 관문' },
];

function variantFor(place: PreviewPlace): NameplateEffectVariant {
  if (place === 'GUILD') return 'guild';
  if (place === 'RANKING') return 'rankingStandard';
  if (place === 'RAID') return 'raidLobby';
  return 'friend';
}

function previewEffect(kind: NameplateEffectKind, name: string, itemUid: string): OwnedNameplateEffect {
  return {
    ownershipId: 0,
    studentId: 0,
    itemId: 0,
    itemUid,
    name,
    resourceUrl: `namefx:${kind.toLowerCase()}`,
    effectKind: kind,
    isEquipped: false,
  };
}

export function isNameplateLuxuryItem(item: ExpeditionLuxuryItem) {
  return item.presentation_kind === 'NAMEPLATE_EFFECT' || nameplateEffectKind(item.item_uid) !== null;
}

export function LuxuryNameplateEffects({
  items,
  studentName,
  isOpen,
  loading,
  error,
  busyAction,
  onBuy,
}: {
  items: ExpeditionLuxuryItem[];
  studentName: string;
  isOpen: boolean;
  loading: boolean;
  error: boolean;
  busyAction: string | null;
  onBuy: (item: ExpeditionLuxuryItem, pricingId: number) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const myEffectsQuery = useMyNameplateEffects();
  const [selectedUid, setSelectedUid] = useState(EFFECTS[0].itemUid);
  const [place, setPlace] = useState<PreviewPlace>('FRIENDS');
  const [replayKey, setReplayKey] = useState(0);
  const [busyOwnershipId, setBusyOwnershipId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const concept = EFFECTS.find((entry) => entry.itemUid === selectedUid) ?? EFFECTS[0];
  const catalogItem = items.find((item) => item.item_uid === concept.itemUid) ?? null;
  const effect = previewEffect(concept.kind, catalogItem?.name ?? concept.name, concept.itemUid);

  const selectEffect = async (owned: OwnedNameplateEffect) => {
    if (busyOwnershipId !== null) return;
    setBusyOwnershipId(owned.ownershipId);
    setNotice(null);
    try {
      const result = await selectMyCosmetic(
        supabase,
        NAMEPLATE_EFFECT_CATEGORY,
        owned.isEquipped ? null : owned.ownershipId,
      );
      if (result.success === false) {
        setNotice(result.error || '이름 효과를 변경하지 못했습니다.');
        return;
      }
      setNotice(owned.isEquipped ? '이름 등장 효과를 해제했습니다.' : `${owned.name} 장착 완료!`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-nameplate-effects'] }),
        queryClient.invalidateQueries({ queryKey: ['equipped-nameplate-effects'] }),
      ]);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '이름 효과 변경 중 오류가 발생했습니다.');
    } finally {
      setBusyOwnershipId(null);
    }
  };

  const choose = (itemUid: string) => {
    setSelectedUid(itemUid);
    setReplayKey((value) => value + 1);
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-black tracking-[0.18em] text-[#EBD29A]">C CLASS · NAMEPLATE EFFECT</div>
          <h3 className="mt-1 text-xl font-black text-white">이름 등장 효과</h3>
          <p className="mt-1 text-[13px] font-semibold text-[#F6EFE7]">등장 방식은 서로 다르고, 연출이 끝난 뒤에도 각 상품의 상징 잔광이 남습니다.</p>
        </div>
        <button type="button" onClick={() => setReplayKey((value) => value + 1)} className="rounded-full border border-[#FFD58A]/60 bg-[#FFD58A]/10 px-3 py-2 text-[13px] font-black text-white">
          ↻ 다시 재생
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="이름 등장 효과 선택">
        {EFFECTS.map((entry, index) => (
          <button
            key={entry.itemUid}
            type="button"
            onClick={() => choose(entry.itemUid)}
            aria-pressed={selectedUid === entry.itemUid}
            className={`min-w-0 rounded-xl border px-3 py-3 text-left transition-colors ${selectedUid === entry.itemUid ? 'border-[#FFD58A] bg-[#FFD58A]/15' : 'border-white/20 bg-white/[0.04] hover:bg-white/10'}`}
          >
            <span className="block text-[11px] font-black tracking-[0.12em] text-[#FFD58A]">C-0{index + 1} {entry.symbol}</span>
            <span className="mt-1 block truncate text-[15px] font-black text-white">{items.find((item) => item.item_uid === entry.itemUid)?.name ?? entry.name}</span>
            <span className="mt-1 block text-[11px] font-semibold leading-4 text-[#E7D7C4]">{entry.summary}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="이름 효과 적용 위치 선택">
        {PLACES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => { setPlace(entry.key); setReplayKey((value) => value + 1); }}
            aria-pressed={place === entry.key}
            className={`rounded-full border px-3 py-2 text-[13px] font-black ${place === entry.key ? 'border-[#FFD58A] bg-[#FFD58A]/20 text-white' : 'border-white/20 text-[#F6EFE7]'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div ref={previewRef} className="mt-3 overflow-visible rounded-2xl border border-white/15 bg-[#080B14] px-4 py-8 sm:px-8">
        <NameplateEffect effect={effect} variant={variantFor(place)} replayKey={`${replayKey}-${place}-${selectedUid}`} className={place === 'RAID' ? 'mx-auto w-[160px]' : 'mx-auto max-w-[540px]'}>
          <NameplatePreviewCard place={place} name={studentName || '학생 이름'} />
        </NameplateEffect>
        <p className="mt-5 text-center text-[12px] font-semibold text-[#E7D7C4]">{concept.summary} · 연출 종료 후 {concept.residue} 유지</p>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
        <h4 className="text-lg font-black text-white">내 이름 등장 효과</h4>
        {notice && <p role="status" className="mt-2 rounded-xl border border-[#D9B977]/35 bg-white/[0.05] p-3 text-sm font-bold text-white">{notice}</p>}
        {myEffectsQuery.isLoading ? (
          <p className="mt-2 text-sm font-semibold text-[#F6EFE7]">보유 효과를 확인하는 중입니다.</p>
        ) : myEffectsQuery.isError ? (
          <button type="button" onClick={() => void myEffectsQuery.refetch()} className="mt-2 rounded-full border border-white/30 px-3 py-2 text-sm font-bold text-white">보유 내역 다시 불러오기</button>
        ) : (myEffectsQuery.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-[#F6EFE7]">보유한 이름 등장 효과가 없습니다.</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(myEffectsQuery.data ?? []).map((owned) => (
              <div key={owned.ownershipId} className="rounded-xl border border-white/20 bg-white/[0.04] p-3">
                <div className="flex items-center gap-2">
                  <NameplateGlyph kind={owned.effectKind} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-white">{owned.name}</div>
                    {owned.isEquipped && <div className="mt-0.5 text-[11px] font-black text-[#B9E9D0]">장착 중</div>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => choose(owned.itemUid)} className="flex-1 rounded-full border border-white/30 px-2 py-2 text-[12px] font-black text-white">미리보기</button>
                  <button type="button" disabled={busyOwnershipId !== null} onClick={() => void selectEffect(owned)} className="flex-1 rounded-full border border-[#FFD58A]/60 bg-[#FFD58A]/15 px-2 py-2 text-[12px] font-black text-white disabled:opacity-50">
                    {busyOwnershipId === owned.ownershipId ? '처리 중…' : owned.isEquipped ? '해제' : '장착'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
        <h4 className="text-lg font-black text-white">C클래스 판매 상품</h4>
        {loading ? (
          <p className="mt-3 text-sm font-semibold text-[#F6EFE7]">상품을 불러오는 중입니다.</p>
        ) : error ? (
          <p className="mt-3 text-sm font-semibold text-[#F6EFE7]">상품 정보를 확인할 수 없습니다.</p>
        ) : !isOpen ? (
          <p className="mt-3 rounded-xl border border-white/15 bg-white/[0.04] p-4 text-sm font-semibold text-[#F6EFE7]">명품관 개방 월드효과가 활성화되면 구매할 수 있습니다. 미리보기는 지금 이용할 수 있습니다.</p>
        ) : items.length === 0 ? (
          <p className="mt-3 rounded-xl border border-white/15 bg-white/[0.04] p-4 text-sm font-semibold text-[#F6EFE7]">현재 판매 중인 C클래스 상품이 없습니다.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {items.map((item) => {
              const kind = nameplateEffectKind(item.item_uid);
              if (!kind) return null;
              return (
                <article key={item.item_id} className="min-w-0 overflow-hidden rounded-xl border border-[#D9B977]/35 bg-[#0D101C]">
                  <button type="button" onClick={() => choose(item.item_uid)} className="flex w-full flex-col items-start p-3 text-left hover:bg-white/[0.05]">
                    <div className="flex w-full justify-center py-3"><NameplateGlyph kind={kind} large /></div>
                    <span className="text-[11px] font-black text-[#FFD58A]">GROUP {item.luxury_group} · Lv.{item.required_effect_level}</span>
                    <span className="mt-1 text-base font-black text-white">{item.name}</span>
                    <span className="mt-1 text-[12px] font-semibold leading-5 text-[#F6EFE7]">{item.description}</span>
                    <span className="mt-2 text-[12px] font-black text-[#B9E9D0]">미리보기 선택 →</span>
                  </button>
                  <div className="space-y-2 border-t border-white/10 p-3">
                    {item.owned ? (
                      <div className="rounded-full border border-[#91DBB1]/50 px-3 py-2 text-center text-sm font-black text-[#B9E9D0]">보유 중</div>
                    ) : item.pricing.length === 0 ? (
                      <div className="text-[13px] font-semibold text-[#F6EFE7]">가격 준비 중</div>
                    ) : item.pricing.map((pricing) => (
                      <button key={pricing.pricing_id} type="button" disabled={busyAction !== null} onClick={() => void onBuy(item, pricing.pricing_id)} className="w-full rounded-full border border-[#FFD58A]/60 bg-[#FFD58A]/15 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
                        {pricing.value_token === 'CRYSTAL' ? '💎' : '🪙'} {pricing.price.toLocaleString('ko-KR')} 구매
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function NameplateGlyph({ kind, large = false }: { kind: NameplateEffectKind; large?: boolean }) {
  const meta = EFFECTS.find((entry) => entry.kind === kind) ?? EFFECTS[0];
  const palette = kind === 'CONSTELLATION'
    ? 'border-violet-300/60 bg-violet-400/15 text-violet-100 shadow-[0_0_18px_rgba(167,139,250,.28)]'
    : kind === 'SHARD_ASSEMBLY'
      ? 'border-emerald-200/60 bg-emerald-400/15 text-emerald-100 shadow-[0_0_18px_rgba(110,231,183,.25)]'
      : kind === 'ROYAL_OPENING'
        ? 'border-rose-300/50 bg-gradient-to-br from-rose-900/60 to-amber-500/15 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.25)]'
        : 'border-amber-200/60 bg-amber-400/15 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)]';
  return <div className={`grid shrink-0 place-items-center rounded-xl border font-display ${palette} ${large ? 'h-16 w-16 text-3xl' : 'h-11 w-11 text-xl'}`}>{meta.symbol}</div>;
}

function NameplatePreviewCard({ place, name }: { place: PreviewPlace; name: string }) {
  if (place === 'RAID') {
    return (
      <div className="w-[160px] rounded-card-md border border-cyan-200/25 bg-[#07111f]/92 px-2 py-1.5 text-center shadow-xl backdrop-blur">
        <div className="truncate text-[14px] font-black text-white">{name}</div>
        <div className="mt-0.5 truncate text-[12px] font-bold text-cyan-100">◆ 소속 길드</div>
      </div>
    );
  }

  return (
    <div className={`grid w-full items-center rounded-[14px] border border-white/25 bg-[linear-gradient(125deg,#252d43,#101622_72%)] shadow-xl ${place === 'GUILD' ? 'min-h-[108px] grid-cols-[58px_minmax(0,1fr)] gap-4 px-4 py-4' : place === 'RANKING' ? 'min-h-[84px] grid-cols-[46px_minmax(0,1fr)_auto] gap-3 px-3 py-3' : 'min-h-[88px] grid-cols-[58px_minmax(0,1fr)] gap-4 px-4 py-3'}`}>
      <div className={`grid place-items-center bg-gradient-to-br from-[#fff9d9] via-[#9d82df] to-[#3d5377] text-xl text-white shadow-lg ${place === 'RANKING' ? 'h-11 w-11 rounded-xl' : 'h-14 w-14 [clip-path:polygon(50%_0,88%_18%,100%_55%,78%_80%,50%_100%,22%_80%,0_55%,12%_18%)]'}`}>✦</div>
      <div className="min-w-0 text-left">
        <div className={`${place === 'RANKING' ? 'text-[18px]' : 'text-[21px]'} truncate font-black text-white`}>{name}</div>
        <div className="mt-1 truncate text-[12px] font-black text-[#F3DBA4]">장착 칭호 · 미리보기</div>
        <div className="mt-0.5 truncate text-[12px] font-bold text-[#D5EDFF]">소속 길드 · 미리보기</div>
      </div>
      {place === 'RANKING' && <div className="text-right text-[12px] font-black text-[#EFDCAB]">BV<br />75,000</div>}
    </div>
  );
}
