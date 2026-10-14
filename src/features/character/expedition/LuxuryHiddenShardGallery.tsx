import { useState } from 'react';
import type { ExpeditionLuxuryItem } from '@/lib/rpc/expedition_rpc';

type Props = {
  items: ExpeditionLuxuryItem[];
  isOpen: boolean;
  loading: boolean;
  error: boolean;
  busyAction: string | null;
  onBuy: (item: ExpeditionLuxuryItem, pricingId: number) => Promise<void>;
};

export function LuxuryHiddenShardGallery({ items, isOpen, loading, error, busyAction, onBuy }: Props) {
  return (
    <section role="tabpanel" aria-label="A클래스 특별 히든 편린">
      <div className="mb-5">
        <p className="text-[10px] font-bold tracking-[0.2em] text-[#EBD29A]">A CLASS · HIDDEN PORTRAITS</p>
        <h3 className="mt-2 text-xl font-black text-[#FFF3DF]">숨겨진 또 하나의 모습</h3>
        <p className="mt-2 text-xs leading-6 text-[#F1E4D1]">함께하는 편린의 특별한 순간을 소장하세요. 구매한 이미지는 홈 꾸미기에서 기본 이미지와 바꾸어 전시할 수 있습니다.</p>
      </div>
      {loading ? <p role="status" className="py-8 text-sm text-[#F1E4D1]">상품을 불러오고 있습니다.</p>
        : error ? <p role="alert" className="py-8 text-sm text-[#FFD0CC]">상품을 불러오지 못했습니다. 명품관을 다시 열어 주세요.</p>
        : !isOpen ? <p className="py-8 text-sm text-[#F1E4D1]">명품관 개방 기간에 만나볼 수 있습니다.</p>
        : items.length === 0 ? <p className="py-8 text-sm text-[#F1E4D1]">현재 판매 중인 A클래스 상품이 없습니다.</p>
        : <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => <HiddenShardProduct key={item.item_id} item={item} busyAction={busyAction} onBuy={onBuy} />)}
        </div>}
    </section>
  );
}

function HiddenShardProduct({ item, busyAction, onBuy }: Pick<Props, 'busyAction' | 'onBuy'> & { item: ExpeditionLuxuryItem }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hiddenVisual = item.presentation_kind === 'HIDDEN_SHARD_IMAGE';
  const eligible = !hiddenVisual || item.purchase_eligible === true;
  const requirement = item.required_character_name ? `${item.required_character_name} 편린 보유자 전용` : '원본 편린 보유자 전용';
  return (
    <article className="overflow-hidden rounded-2xl border border-[#DCC18E]/30 bg-[#0D1321]">
      <div className="relative flex h-64 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_55%,#384366_0%,#141D30_48%,#0D1321_85%)] px-5 pt-7 sm:h-80">
        <span className="absolute left-4 top-4 rounded-full border border-[#EBD29A]/30 bg-[#0B101E]/80 px-2.5 py-1 text-[9px] font-bold tracking-widest text-[#F3DDAF]">SPECIAL IMAGE</span>
        {item.owned && <span className="absolute right-4 top-4 rounded-full bg-[#142D27] px-2.5 py-1 text-[10px] font-bold text-[#C7F1DA]">소장 중</span>}
        {item.resource_url && failedImage !== item.resource_url
          ? <img src={item.resource_url} alt={item.name} className="h-full w-full object-contain object-bottom" loading="lazy" onError={() => setFailedImage(item.resource_url)} />
          : <p className="text-xs text-[#F1E4D1]">이미지를 불러오지 못했습니다.</p>}
      </div>
      <div className="border-t border-[#DCC18E]/15 p-5">
        <p className="text-[10px] font-bold text-[#EBD29A]">{hiddenVisual ? requirement : 'A클래스 컬렉션'}</p>
        <h4 className="mt-2 text-lg font-black text-[#FFF3DF]">{item.name}</h4>
        <p className="mt-2 text-xs leading-6 text-[#F1E4D1]">{item.description || '나만의 컬렉션에 특별함을 더해 보세요.'}</p>
        <div className="mt-4 space-y-2">
          {item.owned ? <p className="rounded-xl border border-[#B6DDC6]/30 bg-[#B6DDC6]/5 px-3 py-3 text-xs leading-5 text-[#C7F1DA]">{hiddenVisual ? '홈 꾸미기 → 편린 전시에서 이미지를 선택해 주세요.' : '이미 소장한 상품입니다.'}</p>
            : !eligible ? <p className="rounded-xl border border-[#EBD29A]/20 px-3 py-3 text-xs text-[#F1E4D1]">{item.purchase_eligible === false ? `${item.required_character_name || '원본'} 편린을 먼저 보유해 주세요.` : '구매 조건을 확인할 수 없습니다. 명품관을 다시 열어 주세요.'}</p>
            : item.pricing.length === 0 ? <p className="text-xs text-[#F1E4D1]">판매 가격 준비 중</p>
            : item.pricing.map((price) => <button key={price.pricing_id} type="button" disabled={busyAction !== null} onClick={() => void onBuy(item, price.pricing_id)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#F5DFAE]/70 bg-[#E8CD99] px-4 py-3 text-xs font-black text-[#272014] transition hover:bg-[#F5DFAE] disabled:cursor-wait disabled:opacity-50">
              <span>{price.price.toLocaleString('ko-KR')} {price.value_token === 'CRYSTAL' ? '크리스탈' : '골드'}</span><span>{busyAction === `luxury-${item.item_id}` ? '구매 중…' : '구매하기 →'}</span>
            </button>)}
        </div>
      </div>
    </article>
  );
}
