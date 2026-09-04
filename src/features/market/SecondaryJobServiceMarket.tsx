import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  secondaryJobServiceStudentRpc,
  type ServiceMarketItem,
  type ServiceOption,
} from '@/lib/rpc/secondary_job_service_rpc';
import type { ServiceReputation } from '@/lib/rpc/secondary_job_service_review_rpc';
import { formatNumber } from '@/lib/utils/format';
import { servicePriceSummary } from '@/lib/utils/secondary_job_service_pricing';
import { cn } from '@/lib/utils/cn';
import {
  SERVICE_CATEGORY_LABEL,
  SERVICE_CATEGORY_OPTIONS,
  SERVICE_PAGE_SIZE,
  SERVICE_SORT_OPTIONS,
  effectiveServiceCategory,
  filterServices,
  findServicePage,
  pageCount,
  pageItems,
  sortServices,
  type ServiceCategoryFilter,
  type ServiceSortMode,
} from '@/features/market/secondary_job_service_market_utils';

function reputationLine(reputation: ServiceReputation | null | undefined) {
  if (!reputation) return '☆ 평가 0 · 후기 0';
  const publicAverage = reputation.rating_count >= 5 && reputation.average_rating !== null;
  return publicAverage
    ? `★ ${Number(reputation.average_rating).toFixed(1)} · 후기 ${reputation.visible_review_count}`
    : `☆ 평가 ${reputation.rating_count} · 후기 ${reputation.visible_review_count}`;
}

function pricingModeLabel(service: ServiceMarketItem) {
  if (service.pricing_mode === 'OPTION') return '옵션가격';
  if (service.pricing_mode === 'QUOTE') return '견적형';
  return '고정가격';
}

function CompactServiceCard({
  service,
  reputation,
  onOpen,
}: {
  service: ServiceMarketItem;
  reputation: ServiceReputation | null | undefined;
  onOpen: () => void;
}) {
  return <button
    type="button"
    onClick={onOpen}
    className="h-[180px] w-full rounded-card-md border border-line bg-bg-card p-4 text-left transition hover:border-brand-primary/60 hover:bg-bg-soft focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
  >
    <div className="flex h-full flex-col">
      <div className="line-clamp-2 h-12 font-display text-base leading-[1.4] text-white">{service.title}</div>
      <div className="mt-2 line-clamp-2 h-10 text-xs font-medium leading-5 text-text-secondary">
        {service.subtitle?.trim() || '상세보기에서 서비스 내용을 확인하세요.'}
      </div>
      <div className="mt-2 truncate text-[12px] font-black text-gold">
        🪙 {servicePriceSummary(service)}
      </div>
      <div className={cn(
        'mt-auto truncate border-t border-line/70 pt-2.5 text-[12px] font-black',
        reputation && reputation.rating_count >= 5 && reputation.average_rating !== null ? 'text-gold' : 'text-text-muted',
      )}>
        {reputationLine(reputation)}
      </div>
    </div>
  </button>;
}

function ServicePricingSection({ service }: { service: ServiceMarketItem }) {
  return <section className="rounded-card-md border border-gold/25 bg-gold/5 p-3.5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-2xs font-black text-text-muted">가격 · {pricingModeLabel(service)}</div>
        <div className="mt-1 font-display text-xl text-gold">🪙 {servicePriceSummary(service)}</div>
      </div>
      <div className="rounded-pill bg-bg-deep px-2.5 py-1 text-[10px] font-black text-text-secondary">
        {service.pricing_mode === 'QUOTE' ? '견적 수락 전 미결제' : `수량 단위 · ${service.quantity_unit}`}
      </div>
    </div>
    {service.pricing_mode === 'OPTION' && service.options.length > 0 && (
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {service.options.map((option) => <div key={option.id} className="flex items-center justify-between rounded-card-sm bg-bg-deep px-3 py-2 text-xs">
          <span className="font-bold text-white">{option.name}</span>
          <span className="font-black text-gold">{formatNumber(option.price_gold)} GOLD</span>
        </div>)}
      </div>
    )}
  </section>;
}

function ServiceReviews({ reputation }: { reputation: ServiceReputation | null | undefined }) {
  if (!reputation) {
    return <section>
      <div className="mb-2 text-sm font-black text-text-secondary">평점 · 후기</div>
      <div className="rounded-card-md bg-bg-deep p-3.5 text-sm text-text-muted">아직 등록된 평가나 후기가 없습니다.</div>
    </section>;
  }

  const publicAverage = reputation.rating_count >= 5 && reputation.average_rating !== null;
  return <section>
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <div className="text-sm font-black text-text-secondary">평점 · 후기</div>
        <div className="mt-1 text-base font-black text-white">
          {publicAverage ? <span className="text-gold">★ {Number(reputation.average_rating).toFixed(1)} / 10</span> : '☆ 평균 평점 비공개'}
          <span className="ml-2 text-sm text-text-muted">평가 {reputation.rating_count}건 · 후기 {reputation.visible_review_count}건</span>
        </div>
      </div>
      {!publicAverage && <div className="text-xs font-bold text-text-muted">유효 평가 5건부터 평균 공개</div>}
    </div>

    {!reputation.reviews.length
      ? <div className="rounded-card-md bg-bg-deep p-3.5 text-sm text-text-muted">공개된 후기가 없습니다.</div>
      : <div className="space-y-2">
          {reputation.reviews.map((review, index) => <div key={`${index}-${review.review_text.slice(0, 24)}`} className="rounded-card-md border border-line/70 bg-bg-deep p-3.5">
            {reputation.can_view_individual_ratings && (
              <div className="mb-1 text-xs font-black text-gold">{review.rating === null ? '⭐ 평점 집계 제외' : `⭐ ${review.rating} / 10`}</div>
            )}
            <div className="whitespace-pre-wrap text-sm leading-6 text-text-primary">“{review.review_text}”</div>
          </div>)}
        </div>}
  </section>;
}

function quantityValid(quantity: number) {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 1_000_000;
}

function OrderControls({
  service,
  gold,
  request,
  onRequestChange,
  buyerNote,
  onBuyerNoteChange,
  quantity,
  onQuantityChange,
  selectedOptionId,
  onSelectedOptionIdChange,
  busy,
  onOrder,
}: {
  service: ServiceMarketItem;
  gold: number;
  request: string;
  onRequestChange: (value: string) => void;
  buyerNote: string;
  onBuyerNoteChange: (value: string) => void;
  quantity: number;
  onQuantityChange: (value: number) => void;
  selectedOptionId: number | null;
  onSelectedOptionIdChange: (value: number | null) => void;
  busy: boolean;
  onOrder: () => void;
}) {
  const requestReady = request.trim().length >= 10;
  const option: ServiceOption | null = service.pricing_mode === 'OPTION'
    ? service.options.find((item) => item.id === selectedOptionId) ?? null
    : null;
  const unitPrice = service.pricing_mode === 'FIXED' ? service.price_gold : option?.price_gold ?? null;
  const total = unitPrice === null ? null : unitPrice * quantity;
  const validQuantity = quantityValid(quantity);
  const totalValid = total === null || (total >= 1 && total <= 1_000_000);
  const affordable = service.pricing_mode === 'QUOTE' || (total !== null && total <= gold);
  const optionReady = service.pricing_mode !== 'OPTION' || option !== null;
  const ready = requestReady && validQuantity && totalValid && affordable && optionReady;

  return <section className="rounded-card-md border border-line bg-bg-card p-3.5">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-sm font-black text-white">{service.pricing_mode === 'QUOTE' ? '견적 요청' : '주문'}</div>
      <div className={cn('text-xs font-black', service.can_buy ? 'text-success' : 'text-warning')}>
        {service.can_buy ? (service.pricing_mode === 'QUOTE' ? '견적 요청 가능' : '주문 가능') : '현재 이용 불가'}
      </div>
    </div>

    {!service.can_buy ? <div className="rounded-card-sm border border-warning/30 bg-warning-bg p-3 text-xs font-bold leading-5 text-warning">
      {service.blocked_reason || '현재 이 서비스를 이용할 수 없습니다.'}
    </div> : <>
      <div className="mb-3 rounded-card-sm bg-bg-deep p-2.5 text-xs leading-5 text-text-secondary">
        {service.pricing_mode === 'QUOTE'
          ? '견적을 요청하거나 판매자가 견적을 제안하는 동안에는 GOLD가 이동하지 않습니다. 구매자가 최종 견적을 수락하는 순간에만 총액이 보류됩니다.'
          : '결제한 GOLD는 거래 완료 전까지 보류되며, 납품 후 구매 확정 시 판매자에게 정산됩니다.'}
      </div>

      {service.pricing_mode === 'OPTION' && <label className="block">
        <span className="text-xs font-bold text-text-secondary">가격 옵션</span>
        <select
          className="input-field mt-1 w-full"
          value={selectedOptionId ?? ''}
          onChange={(event) => onSelectedOptionIdChange(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">옵션을 선택하세요</option>
          {service.options.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatNumber(item.price_gold)} GOLD / {service.quantity_unit}</option>)}
        </select>
      </label>}

      <div className={cn('grid gap-2', service.pricing_mode === 'OPTION' ? 'mt-3 sm:grid-cols-2' : 'sm:grid-cols-2')}>
        <label className="block">
          <span className="text-xs font-bold text-text-secondary">{service.pricing_mode === 'QUOTE' ? '희망 수량' : '수량'} ({service.quantity_unit})</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            step={1}
            className="input-field mt-1 w-full"
            value={quantity}
            onChange={(event) => onQuantityChange(Number(event.target.value))}
          />
        </label>
        <div className="rounded-card-md bg-bg-deep p-3">
          <div className="text-2xs font-black text-text-muted">{service.pricing_mode === 'QUOTE' ? '현재 결제금액' : '예상 총 결제금액'}</div>
          <div className="mt-1 font-display text-lg text-gold">
            {service.pricing_mode === 'QUOTE' ? '견적 확정 전 0 GOLD' : total === null ? '옵션 선택 필요' : `${formatNumber(total)} GOLD`}
          </div>
          {unitPrice !== null && <div className="mt-1 text-2xs text-text-muted">단가 {formatNumber(unitPrice)} × {formatNumber(quantity)}{service.quantity_unit}</div>}
        </div>
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-bold text-text-secondary">구체적인 요청 내용 (10~500자)</span>
        <textarea
          rows={5}
          maxLength={500}
          value={request}
          onChange={(event) => onRequestChange(event.target.value)}
          className="input-field mt-1 w-full resize-none"
          placeholder="원하는 결과, 내용, 조건을 구체적으로 적어주세요."
        />
      </label>
      <div className="mt-1 flex items-center justify-between text-2xs">
        <span className={!requestReady ? 'text-warning' : 'text-text-muted'}>{!requestReady ? '요청 내용을 10자 이상 입력해주세요.' : '요청 내용을 확인해주세요.'}</span>
        <span className="text-text-muted">{request.trim().length}/500</span>
      </div>

      {service.pricing_mode === 'QUOTE' && <label className="mt-3 block">
        <span className="text-xs font-bold text-text-secondary">추가 메모 (선택, 최대 500자)</span>
        <textarea
          rows={3}
          maxLength={500}
          value={buyerNote}
          onChange={(event) => onBuyerNoteChange(event.target.value)}
          className="input-field mt-1 w-full resize-none"
          placeholder="예산, 일정 등 판매자에게 추가로 전달할 내용을 적을 수 있어요."
        />
      </label>}

      {!validQuantity && <div className="mt-2 text-xs font-bold text-warning">수량은 1~1,000,000 범위의 정수여야 합니다.</div>}
      {!totalValid && <div className="mt-2 text-xs font-bold text-warning">총 거래금액은 1~1,000,000 GOLD 범위여야 합니다.</div>}
      {!affordable && total !== null && <div className="mt-2 text-xs font-bold text-warning">보유 GOLD가 부족합니다. 현재 {formatNumber(gold)} GOLD를 사용할 수 있습니다.</div>}

      <button className="btn-primary mt-3 w-full" disabled={busy || !ready} onClick={onOrder}>
        {service.pricing_mode === 'QUOTE'
          ? '💬 견적 요청하기'
          : `🪙 ${formatNumber(total ?? 0)} GOLD 결제하고 주문하기`}
      </button>
    </>}
  </section>;
}

function ServiceDetailModal({
  service,
  reputation,
  sellerName,
  gold,
  request,
  onRequestChange,
  buyerNote,
  onBuyerNoteChange,
  quantity,
  onQuantityChange,
  selectedOptionId,
  onSelectedOptionIdChange,
  busy,
  onOrder,
  onClose,
}: {
  service: ServiceMarketItem | null;
  reputation: ServiceReputation | null | undefined;
  sellerName: string;
  gold: number;
  request: string;
  onRequestChange: (value: string) => void;
  buyerNote: string;
  onBuyerNoteChange: (value: string) => void;
  quantity: number;
  onQuantityChange: (value: number) => void;
  selectedOptionId: number | null;
  onSelectedOptionIdChange: (value: number | null) => void;
  busy: boolean;
  onOrder: () => void;
  onClose: () => void;
}) {
  if (!service) return null;
  const category = SERVICE_CATEGORY_LABEL[effectiveServiceCategory(service)];

  return <Modal isOpen onClose={onClose} title={service.title} emoji="🛍️" size="lg">
    <div className="space-y-4">
      <section>
        <div className="text-sm font-bold leading-6 text-text-secondary">
          {service.subtitle?.trim() || '등록된 부제목이 없습니다. 아래 상세 설명을 확인해주세요.'}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-card-sm bg-bg-deep p-2.5"><div className="text-2xs font-black text-text-muted">판매자</div><div className="mt-1 font-black text-white">{sellerName}</div></div>
          <div className="rounded-card-sm bg-bg-deep p-2.5"><div className="text-2xs font-black text-text-muted">카테고리</div><div className="mt-1 font-black text-white">{category}</div></div>
          <div className="rounded-card-sm bg-bg-deep p-2.5"><div className="text-2xs font-black text-text-muted">가격 방식</div><div className="mt-1 font-black text-white">{pricingModeLabel(service)}</div></div>
          <div className="rounded-card-sm bg-bg-deep p-2.5"><div className="text-2xs font-black text-text-muted">연결 2차직업</div><div className="mt-1 font-black text-white">{service.job_name}</div></div>
        </div>
      </section>

      <section>
        <div className="mb-2 text-xs font-black text-text-secondary">서비스 상세 설명</div>
        <div className="whitespace-pre-wrap rounded-card-md border border-line bg-bg-deep p-3.5 text-sm leading-6 text-text-primary">{service.description}</div>
      </section>

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-card-md bg-bg-deep p-3">
          <div className="text-2xs font-black text-text-muted">예상 소요시간</div>
          <div className="mt-1 text-xs font-bold text-white">{service.delivery_note?.trim() || '별도 안내 없음'}</div>
        </div>
        <div className="rounded-card-md bg-bg-deep p-3">
          <div className="text-2xs font-black text-text-muted">주문 조건</div>
          <div className="mt-1 text-xs font-bold text-white">{service.allow_concurrent_orders ? '여러 학생 동시 주문 가능' : '한 번에 1명만 주문 가능'}</div>
        </div>
      </section>

      <ServicePricingSection service={service} />
      <ServiceReviews reputation={reputation} />
      <OrderControls
        service={service}
        gold={gold}
        request={request}
        onRequestChange={onRequestChange}
        buyerNote={buyerNote}
        onBuyerNoteChange={onBuyerNoteChange}
        quantity={quantity}
        onQuantityChange={onQuantityChange}
        selectedOptionId={selectedOptionId}
        onSelectedOptionIdChange={onSelectedOptionIdChange}
        busy={busy}
        onOrder={onOrder}
      />
    </div>
  </Modal>;
}

export function SecondaryJobServiceMarket({
  items,
  reputations,
  studentNames,
  serverNow,
  gold,
  busy,
  onDone,
  deepLinkServiceId,
  onDeepLinkHandled,
}: {
  items: ServiceMarketItem[];
  reputations: Map<number, ServiceReputation>;
  studentNames: Map<number, string>;
  serverNow: string;
  gold: number;
  busy: boolean;
  onDone: () => void;
  deepLinkServiceId: number | null;
  onDeepLinkHandled: () => void;
}) {
  const { call, isLoading: rpcLoading } = useRpcCall();
  const actionBusy = busy || rpcLoading;
  const [category, setCategory] = useState<ServiceCategoryFilter>('ALL');
  const [sortMode, setSortMode] = useState<ServiceSortMode>('BALANCED');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [request, setRequest] = useState('');
  const [buyerNote, setBuyerNote] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const handledDeepLinkRef = useRef<number | null>(null);

  const filtered = useMemo(() => filterServices(items, category), [items, category]);
  const sorted = useMemo(
    () => sortServices(filtered, sortMode, serverNow, reputations),
    [filtered, sortMode, serverNow, reputations],
  );
  const totalPages = pageCount(sorted);
  const visibleItems = useMemo(() => pageItems(sorted, page), [sorted, page]);
  const selected = selectedId === null ? null : items.find((item) => item.id === selectedId) ?? null;
  const selectedReputation = selected ? reputations.get(selected.id) : null;
  const selectedSellerName = selected ? studentNames.get(selected.seller_student_id) ?? selected.seller_name : '';

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const resetOrderForm = (service: ServiceMarketItem | null) => {
    setRequest('');
    setBuyerNote('');
    setQuantity(1);
    setSelectedOptionId(service?.pricing_mode === 'OPTION' ? service.options[0]?.id ?? null : null);
  };

  useEffect(() => {
    if (!deepLinkServiceId || handledDeepLinkRef.current === deepLinkServiceId) return;
    const service = items.find((item) => item.id === deepLinkServiceId);
    if (!service) return;

    const deepLinkOrder = sortServices(items, 'BALANCED', serverNow, reputations);
    const targetPage = findServicePage(deepLinkOrder, deepLinkServiceId) ?? 1;
    handledDeepLinkRef.current = deepLinkServiceId;
    setCategory('ALL');
    setSortMode('BALANCED');
    setPage(targetPage);
    setSelectedId(deepLinkServiceId);
    resetOrderForm(service);
    onDeepLinkHandled();
  }, [deepLinkServiceId, items, onDeepLinkHandled, reputations, serverNow]);

  const changeCategory = (next: ServiceCategoryFilter) => {
    setCategory(next);
    setPage(1);
  };

  const changeSort = (next: ServiceSortMode) => {
    setSortMode(next);
    setPage(1);
  };

  const openService = (serviceId: number) => {
    const service = items.find((item) => item.id === serviceId) ?? null;
    setSelectedId(serviceId);
    resetOrderForm(service);
  };

  const closeService = () => {
    setSelectedId(null);
    resetOrderForm(null);
  };

  const order = async () => {
    if (!selected || !selected.can_buy || request.trim().length < 10 || !quantityValid(quantity)) return;
    const option = selected.pricing_mode === 'OPTION'
      ? selected.options.find((item) => item.id === selectedOptionId) ?? null
      : null;
    if (selected.pricing_mode === 'OPTION' && !option) return;

    const unitPrice = selected.pricing_mode === 'FIXED' ? selected.price_gold : option?.price_gold ?? null;
    const total = unitPrice === null ? null : unitPrice * quantity;
    if (selected.pricing_mode !== 'QUOTE' && (total === null || total < 1 || total > 1_000_000 || total > gold)) return;

    await call(() => secondaryJobServiceStudentRpc.order(supabase, {
      p_service_id: selected.id,
      p_option_id: selected.pricing_mode === 'OPTION' ? option?.id ?? null : null,
      p_quantity: quantity,
      p_buyer_request: request,
      p_buyer_note: selected.pricing_mode === 'QUOTE' ? buyerNote.trim() || null : null,
    }), {
      successTitle: selected.pricing_mode === 'QUOTE' ? '견적 요청 완료' : '서비스 주문 완료',
      successDescription: selected.pricing_mode === 'QUOTE'
        ? '판매자가 견적을 제안할 때까지 GOLD는 이동하지 않습니다.'
        : `${formatNumber(total ?? 0)} GOLD가 거래 완료 전까지 보류됩니다.`,
      onSuccess: () => {
        closeService();
        onDone();
      },
    });
  };

  if (!items.length) {
    return <EmptyState emoji="🛍️" title="판매 중인 서비스가 없어요" description="2차직업을 가진 학생이 서비스를 등록하면 여기에 표시됩니다." />;
  }

  return <div className="space-y-3">
    <div className="flex flex-col gap-2 rounded-card-md border border-line bg-bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {SERVICE_CATEGORY_OPTIONS.map((option) => <button
          type="button"
          key={option.value}
          onClick={() => changeCategory(option.value)}
          className={cn(
            'shrink-0 rounded-pill border px-2.5 py-1.5 text-[11px] font-black transition',
            category === option.value
              ? 'border-brand-primary bg-brand-primary/15 text-white'
              : 'border-line bg-bg-deep text-text-secondary hover:text-white',
          )}
        >{option.label}</button>)}
      </div>
      <select
        aria-label="서비스 정렬"
        className="input-field min-w-[150px] text-xs lg:w-auto"
        value={sortMode}
        onChange={(event) => changeSort(event.target.value as ServiceSortMode)}
      >
        {SERVICE_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>

    {!sorted.length ? <EmptyState emoji="🧭" title="이 카테고리에 등록된 서비스가 없어요" description="다른 카테고리를 선택해보세요." /> : <>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:min-h-[370px] lg:grid-cols-4 lg:grid-rows-2">
        {visibleItems.map((service) => <CompactServiceCard
          key={service.id}
          service={service}
          reputation={reputations.get(service.id)}
          onOpen={() => openService(service.id)}
        />)}
      </div>

      <div className="flex items-center justify-center gap-4 pt-1">
        <button
          type="button"
          className="btn-secondary !h-8 !w-8 !p-0"
          aria-label="이전 서비스 페이지"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >‹</button>
        <div className="min-w-[72px] text-center text-xs font-black text-text-secondary">{page} / {totalPages}</div>
        <button
          type="button"
          className="btn-secondary !h-8 !w-8 !p-0"
          aria-label="다음 서비스 페이지"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
        >›</button>
      </div>
      <div className="text-center text-[10px] font-bold text-text-muted">페이지당 최대 {SERVICE_PAGE_SIZE}개 · 균형 노출순은 매일 한국 시간 기준으로 순환합니다.</div>
    </>}

    <ServiceDetailModal
      service={selected}
      reputation={selectedReputation}
      sellerName={selectedSellerName}
      gold={gold}
      request={request}
      onRequestChange={setRequest}
      buyerNote={buyerNote}
      onBuyerNoteChange={setBuyerNote}
      quantity={quantity}
      onQuantityChange={setQuantity}
      selectedOptionId={selectedOptionId}
      onSelectedOptionIdChange={setSelectedOptionId}
      busy={actionBusy}
      onOrder={order}
      onClose={closeService}
    />
  </div>;
}
