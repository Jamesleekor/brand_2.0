import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { secondaryJobServiceStudentRpc, type ServiceMarketItem } from '@/lib/rpc/secondary_job_service_rpc';
import type { ServiceReputation } from '@/lib/rpc/secondary_job_service_review_rpc';
import { formatNumber } from '@/lib/utils/format';
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
    className="h-[148px] w-full rounded-card-md border border-line bg-bg-card p-3.5 text-left transition hover:border-brand-primary/60 hover:bg-bg-soft focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
  >
    <div className="flex h-full flex-col">
      <div className="line-clamp-2 h-11 font-display text-[15px] leading-[1.35] text-white">{service.title}</div>
      <div className="mt-2 line-clamp-2 h-10 text-xs font-medium leading-5 text-text-secondary">
        {service.subtitle?.trim() || '상세보기에서 서비스 내용을 확인하세요.'}
      </div>
      <div className={cn(
        'mt-auto truncate border-t border-line/70 pt-2 text-[11px] font-black',
        reputation && reputation.rating_count >= 5 && reputation.average_rating !== null ? 'text-gold' : 'text-text-muted',
      )}>
        {reputationLine(reputation)}
      </div>
    </div>
  </button>;
}

function ServicePricingSection({ service }: { service: ServiceMarketItem }) {
  return <section className="rounded-card-md border border-gold/25 bg-gold/5 p-3.5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-2xs font-black text-text-muted">가격 · 단일형</div>
        <div className="mt-1 font-display text-xl text-gold">🪙 {formatNumber(service.price_gold)} GOLD</div>
      </div>
      <div className="rounded-pill bg-bg-deep px-2.5 py-1 text-[10px] font-black text-text-secondary">1회 기준</div>
    </div>
  </section>;
}

function ServiceReviews({ reputation }: { reputation: ServiceReputation | null | undefined }) {
  if (!reputation) {
    return <section>
      <div className="mb-2 text-xs font-black text-text-secondary">평점 · 후기</div>
      <div className="rounded-card-md bg-bg-deep p-3 text-xs text-text-muted">아직 등록된 평가나 후기가 없습니다.</div>
    </section>;
  }

  const publicAverage = reputation.rating_count >= 5 && reputation.average_rating !== null;
  return <section>
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <div className="text-xs font-black text-text-secondary">평점 · 후기</div>
        <div className="mt-1 text-sm font-black text-white">
          {publicAverage ? <span className="text-gold">★ {Number(reputation.average_rating).toFixed(1)} / 10</span> : '☆ 평균 평점 비공개'}
          <span className="ml-2 text-xs text-text-muted">평가 {reputation.rating_count}건 · 후기 {reputation.visible_review_count}건</span>
        </div>
      </div>
      {!publicAverage && <div className="text-[10px] font-bold text-text-muted">유효 평가 5건부터 평균 공개</div>}
    </div>

    {!reputation.reviews.length
      ? <div className="rounded-card-md bg-bg-deep p-3 text-xs text-text-muted">공개된 후기가 없습니다.</div>
      : <div className="space-y-2">
          {reputation.reviews.map((review, index) => <div key={`${index}-${review.review_text.slice(0, 24)}`} className="rounded-card-md border border-line/70 bg-bg-deep p-3">
            {reputation.can_view_individual_ratings && (
              <div className="mb-1 text-[11px] font-black text-gold">{review.rating === null ? '⭐ 평점 집계 제외' : `⭐ ${review.rating} / 10`}</div>
            )}
            <div className="whitespace-pre-wrap text-xs leading-5 text-text-primary">“{review.review_text}”</div>
          </div>)}
        </div>}
  </section>;
}

function ServiceDetailModal({
  service,
  reputation,
  sellerName,
  request,
  onRequestChange,
  busy,
  onBuy,
  onClose,
}: {
  service: ServiceMarketItem | null;
  reputation: ServiceReputation | null | undefined;
  sellerName: string;
  request: string;
  onRequestChange: (value: string) => void;
  busy: boolean;
  onBuy: () => void;
  onClose: () => void;
}) {
  if (!service) return null;
  const category = SERVICE_CATEGORY_LABEL[effectiveServiceCategory(service)];
  const requestReady = request.trim().length >= 10;

  return <Modal isOpen onClose={onClose} title={service.title} emoji="🛍️" size="lg">
    <div className="space-y-4">
      <section>
        <div className="text-sm font-bold leading-6 text-text-secondary">
          {service.subtitle?.trim() || '등록된 부제목이 없습니다. 아래 상세 설명을 확인해주세요.'}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-card-sm bg-bg-deep p-2.5"><div className="text-2xs font-black text-text-muted">판매자</div><div className="mt-1 font-black text-white">{sellerName}</div></div>
          <div className="rounded-card-sm bg-bg-deep p-2.5"><div className="text-2xs font-black text-text-muted">카테고리</div><div className="mt-1 font-black text-white">{category}</div></div>
          <div className="col-span-2 rounded-card-sm bg-bg-deep p-2.5 sm:col-span-1"><div className="text-2xs font-black text-text-muted">연결 2차직업</div><div className="mt-1 font-black text-white">{service.job_name}</div></div>
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

      <section className="rounded-card-md border border-line bg-bg-card p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-black text-white">주문</div>
          <div className={cn('text-[11px] font-black', service.can_buy ? 'text-success' : 'text-warning')}>
            {service.can_buy ? '주문 가능' : '현재 주문 불가'}
          </div>
        </div>

        {service.can_buy ? <>
          <div className="mb-3 rounded-card-sm bg-bg-deep p-2.5 text-[11px] leading-5 text-text-secondary">
            결제한 GOLD는 거래 완료 전까지 보류되며, 납품 후 구매 확정 시 판매자에게 정산됩니다.
          </div>
          <label className="block">
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
            <span className={!requestReady ? 'text-warning' : 'text-text-muted'}>{!requestReady ? '요청 내용을 10자 이상 입력해주세요.' : '주문 요청을 확인한 뒤 결제해주세요.'}</span>
            <span className="text-text-muted">{request.trim().length}/500</span>
          </div>
          <button className="btn-primary mt-3 w-full" disabled={busy || !requestReady} onClick={onBuy}>🪙 {formatNumber(service.price_gold)} GOLD 결제하고 주문하기</button>
        </> : <div className="rounded-card-sm border border-warning/30 bg-warning-bg p-3 text-xs font-bold leading-5 text-warning">
          {service.blocked_reason || '현재 이 서비스를 주문할 수 없습니다.'}
        </div>}
      </section>
    </div>
  </Modal>;
}

export function SecondaryJobServiceMarket({
  items,
  reputations,
  studentNames,
  serverNow,
  busy,
  onDone,
  deepLinkServiceId,
  onDeepLinkHandled,
}: {
  items: ServiceMarketItem[];
  reputations: Map<number, ServiceReputation>;
  studentNames: Map<number, string>;
  serverNow: string;
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
    setRequest('');
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
    setSelectedId(serviceId);
    setRequest('');
  };

  const closeService = () => {
    setSelectedId(null);
    setRequest('');
  };

  const buy = async () => {
    if (!selected || !selected.can_buy || request.trim().length < 10) return;
    await call(() => secondaryJobServiceStudentRpc.buy(supabase, {
      p_service_id: selected.id,
      p_buyer_request: request,
    }), {
      successTitle: '서비스 주문 완료',
      successDescription: `${formatNumber(selected.price_gold)} GOLD가 거래 완료 전까지 보류됩니다.`,
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
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:min-h-[306px] lg:grid-cols-4 lg:grid-rows-2">
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
      request={request}
      onRequestChange={setRequest}
      busy={actionBusy}
      onBuy={buy}
      onClose={closeService}
    />
  </div>;
}
