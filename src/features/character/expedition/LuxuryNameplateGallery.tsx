import { useState } from 'react';
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

import './luxuryNameplateGallery.css';

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
  return item.presentation_kind === 'ENTRANCE_NAME_GLOW'
    || item.presentation_kind === 'NAMEPLATE_EFFECT'
    || nameplateEffectKind(item.item_uid) !== null;
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
    setNotice(null);
  };


  const owned = (myEffectsQuery.data ?? []).find((entry) => entry.itemUid === concept.itemUid);
  const pending = busyOwnershipId !== null || busyAction !== null;
  const knownOwned = Boolean(owned || catalogItem?.owned);
  const purchase = async (pricingId: number) => {
    if (!catalogItem || pending || !isOpen || catalogItem.available_for_purchase !== true || catalogItem.purchase_eligible === false) return;
    setNotice(null);
    try {
      await onBuy(catalogItem, pricingId);
      await queryClient.invalidateQueries({ queryKey: ['my-nameplate-effects'] });
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '구매 중 오류가 발생했습니다.');
    }
  };

  return (
    <section className="lux-c-gallery" aria-label="C클래스 이름 등장 효과 진열관">
      <header className="lux-c-heading">
        <div><p className="lux-c-eyebrow">THE SIGNATURE COLLECTION</p><h3>이름이 등장하는 순간, 나만의 장면.</h3></div>
        <span className="lux-c-edition">C CLASS <i /> 04 EFFECTS</span>
      </header>

      <div className="lux-c-collection" role="group" aria-label="상품 선택">
        {EFFECTS.map((entry, index) => {
          const ownership = (myEffectsQuery.data ?? []).find((row) => row.itemUid === entry.itemUid);
          const product = items.find((row) => row.item_uid === entry.itemUid);
          const status = ownership?.isEquipped ? '장착 중' : ownership || product?.owned ? '보유 중' : '컬렉션';
          return (
            <button type="button" key={entry.itemUid} className="lux-c-product"
              data-theme={entry.kind} aria-pressed={concept.itemUid === entry.itemUid}
              onClick={() => choose(entry.itemUid)}>
              <span className="lux-c-product-top"><span>0{index + 1}</span><span className="lux-c-status" data-equipped={Boolean(ownership?.isEquipped)}>{status}</span></span>
              <span className="lux-c-art"><CollectionEmblem kind={entry.kind} /></span>
              <span className="lux-c-product-name">{product?.name ?? entry.name}</span>
              <span className="lux-c-product-caption">{entry.residue}</span>
              <span className="lux-c-product-line" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className="lux-c-showcase" data-theme={concept.kind}>
        <div className="lux-c-theatre">
          <div className="lux-c-stage-top"><span className="lux-c-eyebrow">LIVE PREVIEW</span><button type="button" className="lux-c-replay" onClick={() => setReplayKey((value) => value + 1)}>↻ 다시 재생</button></div>
          <div className="lux-c-stage" aria-label={concept.name + ' 연출 미리보기'}>
            <div className="lux-c-orbit" aria-hidden="true" />
            <NameplateEffect effect={effect} variant={variantFor(place)} replayKey={concept.itemUid + ':' + place + ':' + replayKey} className={place === 'RAID' ? 'lux-c-preview-fx lux-c-preview-raid' : 'lux-c-preview-fx'}>
              <PreviewNamecard place={place} name={studentName || '학생 이름'} />
            </NameplateEffect>
          </div>
          <div className="lux-c-stage-bottom">
            <div className="lux-c-places" role="group" aria-label="미리보기 화면">
              {PLACES.map((entry) => <button type="button" key={entry.key} aria-pressed={place === entry.key} onClick={() => setPlace(entry.key)}>{entry.label}</button>)}
            </div>
            <p>화면별 형태 예시 · 실제 배치는 화면 크기에 따라 달라집니다.</p>
          </div>
        </div>

        <div className="lux-c-detail" aria-live="polite">
          <p className="lux-c-eyebrow">SIGNATURE NO. 0{EFFECTS.indexOf(concept) + 1}</p>
          <h4>{catalogItem?.name ?? concept.name}</h4>
          <p className="lux-c-description">{concept.summary}. 등장 이후에도 {concept.residue}이 은은하게 이어집니다.</p>
          <dl className="lux-c-specs"><div><dt>종류</dt><dd>이름 등장 효과</dd></div><div><dt>잔여 연출</dt><dd>{concept.residue}</dd></div><div><dt>적용 화면</dt><dd>친구 · 길드 · 랭킹 · 레이드</dd></div></dl>
          <div className="lux-c-purchase">
            {myEffectsQuery.isLoading ? <p role="status">보유 정보를 확인하고 있습니다.</p>
              : myEffectsQuery.isError ? <><p role="alert">보유 정보를 불러오지 못했습니다.</p><button type="button" className="lux-c-secondary" onClick={() => void myEffectsQuery.refetch()}>보유 정보 다시 확인</button></>
              : owned ? <><div className="lux-c-ownership"><span>{owned.isEquipped ? '현재 장착 중' : '내 컬렉션에 소장 중'}</span><span>OWNED</span></div><button type="button" className={owned.isEquipped ? 'lux-c-secondary' : 'lux-c-primary'} disabled={pending} onClick={() => void selectEffect(owned)}>{busyOwnershipId === owned.ownershipId ? '변경 중…' : owned.isEquipped ? '장착 해제' : '이 효과 장착하기'}</button></>
              : knownOwned ? <><p>소장 중인 상품입니다. 장착 정보를 새로 확인해 주세요.</p><button type="button" className="lux-c-secondary" onClick={() => void myEffectsQuery.refetch()}>장착 정보 새로고침</button></>
              : loading ? <p role="status">상품 정보를 불러오고 있습니다.</p>
              : error ? <p role="alert">상품을 불러오지 못했습니다. 명품관을 다시 열어 주세요.</p>
              : !catalogItem ? <p>현재 판매 중인 상품이 아닙니다.</p>
              : catalogItem.pricing.length === 0 ? <p>판매 가격 준비 중</p>
              : catalogItem.pricing.map((pricing) => <button type="button" className="lux-c-primary" key={pricing.pricing_id} disabled={pending || !isOpen || catalogItem.available_for_purchase !== true || catalogItem.purchase_eligible === false} onClick={() => void purchase(pricing.pricing_id)}><span>{pricing.price.toLocaleString('ko-KR')} {pricing.value_token === 'CRYSTAL' ? '크리스탈' : '골드'}</span><span>{busyAction !== null ? '처리 중…' : !isOpen || catalogItem.available_for_purchase !== true ? '개방 대기' : catalogItem.purchase_eligible === false ? '구매 조건 미충족' : '구매하기 →'}</span></button>)}
            {!knownOwned && catalogItem && (!isOpen || catalogItem.available_for_purchase !== true) && <p>해당 클래스 개방 기간에 구매할 수 있습니다.</p>}
            {notice && <p className="lux-c-notice" role="status">{notice}</p>}
          </div>
        </div>
      </div>
      <p className="lux-c-footnote">이름 등장 효과는 한 번에 하나만 장착할 수 있습니다.</p>
    </section>
  );
}

function CollectionEmblem({ kind }: { kind: NameplateEffectKind }) {
  return (
    <svg viewBox="0 0 200 100" fill="none" aria-hidden="true" focusable="false">
      <ellipse cx="100" cy="85" rx="56" ry="6" stroke="currentColor" opacity=".22" />
      {kind === 'CORONATION' ? <g stroke="currentColor" strokeWidth="1.5">
        <path d="M65 64 59 33 80 46 100 21 120 46 141 33 135 64Z" fill="currentColor" fillOpacity=".1" />
        <path d="M65 70H135M74 77H126M100 6V14M49 20 56 25M151 20 144 25M100 38 109 49 100 60 91 49Z" />
        <path d="M75 4V22M125 4V22M100 83V92" opacity=".4" />
      </g> : kind === 'CONSTELLATION' ? <g stroke="currentColor">
        <ellipse cx="100" cy="47" rx="42" ry="32" strokeDasharray="2 6" opacity=".55" />
        <path d="M62 60 83 32 113 22 137 55 113 70 83 32M62 60 113 70 113 22" strokeWidth="1.3" opacity=".8" />
        {[[62,60],[83,32],[113,22],[137,55],[113,70]].map(([x,y])=><path key={x} d={`M${x-4} ${y}h8M${x} ${y-4}v8`} strokeWidth="2" />)}
      </g> : kind === 'SHARD_ASSEMBLY' ? <g stroke="currentColor" strokeWidth="1.3" fill="currentColor" fillOpacity=".1">
        <path d="M100 20 123 47 100 75 77 47Z M100 20V75M77 47H123" />
        <path d="M62 16 76 27 63 37 56 27ZM138 22 150 33 137 41 132 32ZM57 61 70 70 62 83 49 75ZM139 61 151 71 143 83 132 73Z" />
        <path d="M89 7 94 12M115 83 120 89" />
      </g> : <g stroke="currentColor" strokeWidth="1.3">
        <path d="M49 20H151V77M49 20V77M58 22Q80 48 51 67M142 22Q120 48 149 67M61 24Q85 50 57 72M139 24Q115 50 143 72" />
        <path d="M78 44H122V73H78ZM86 30 83 18 93 23 100 13 107 23 117 18 114 30Z" fill="currentColor" fillOpacity=".14" />
        <path d="M94 55 100 48 106 55 100 62Z" />
      </g>}
    </svg>
  );
}

function PreviewNamecard({ place, name }: { place: PreviewPlace; name: string }) {
  return <div className="lux-c-namecard" data-place={place}>
    {place !== 'RAID' && <span className="lux-c-tier" aria-hidden="true">✦</span>}
    <div className="lux-c-namecopy"><strong>{name}</strong>{place !== 'RAID' && <span>장착 칭호 · 미리보기</span>}<small>소속 길드 · 미리보기</small></div>
    {place === 'RANKING' && <span className="lux-c-bv">BV<br />75,000</span>}
  </div>;
}
