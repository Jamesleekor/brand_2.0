import type { ServiceMarketItem } from '@/lib/rpc/secondary_job_service_rpc';
import type { ServiceReputation } from '@/lib/rpc/secondary_job_service_review_rpc';
import type { ServiceCategory } from '@/lib/zod_schemas/secondary_job_service_schemas';

export type ServiceCategoryFilter = 'ALL' | ServiceCategory;
export type ServiceSortMode = 'BALANCED' | 'RATING' | 'NEWEST' | 'REVIEWS';

export const SERVICE_CATEGORY_OPTIONS: Array<{ value: ServiceCategoryFilter; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: '청소', label: '청소·정리' },
  { value: '학습', label: '학습' },
  { value: '제작', label: '그림·제작' },
  { value: '1인1역', label: '1인1역' },
  { value: '생활도움', label: '생활 도움' },
  { value: '기타', label: '기타' },
];

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  청소: '청소·정리',
  학습: '학습',
  제작: '그림·제작',
  '1인1역': '1인1역',
  생활도움: '생활 도움',
  기타: '기타',
};

export const SERVICE_SORT_OPTIONS: Array<{ value: ServiceSortMode; label: string }> = [
  { value: 'BALANCED', label: '균형 노출순' },
  { value: 'RATING', label: '평점 높은순' },
  { value: 'NEWEST', label: '최신 등록순' },
  { value: 'REVIEWS', label: '후기 많은순' },
];

export const SERVICE_PAGE_SIZE = 8;

export function effectiveServiceCategory(service: ServiceMarketItem): ServiceCategory {
  return service.service_category ?? '기타';
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function kstDateKey(serverNow: string) {
  const date = new Date(serverNow);
  if (Number.isNaN(date.getTime())) return '1970-01-01';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function dateOrdinal(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return 0;
  const [, year, month, day] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000);
}

function sellerDiversifiedBase(items: ServiceMarketItem[]) {
  const buckets = new Map<number, ServiceMarketItem[]>();
  items.forEach((item) => {
    const bucket = buckets.get(item.seller_student_id) ?? [];
    bucket.push(item);
    buckets.set(item.seller_student_id, bucket);
  });

  const sellerOrder = [...buckets.keys()].sort((a, b) => {
    const hashDiff = stableHash(`seller:${a}`) - stableHash(`seller:${b}`);
    return hashDiff || a - b;
  });

  sellerOrder.forEach((sellerId) => {
    buckets.get(sellerId)?.sort((a, b) => {
      const hashDiff = stableHash(`service:${a.id}`) - stableHash(`service:${b.id}`);
      return hashDiff || a.id - b.id;
    });
  });

  const output: ServiceMarketItem[] = [];
  let round = 0;
  while (output.length < items.length) {
    let added = false;
    sellerOrder.forEach((sellerId) => {
      const item = buckets.get(sellerId)?.[round];
      if (item) {
        output.push(item);
        added = true;
      }
    });
    if (!added) break;
    round += 1;
  }
  return output;
}

export function balancedOrder(items: ServiceMarketItem[], serverNow: string) {
  if (items.length <= 1) return [...items];

  const dateKey = kstDateKey(serverNow);
  const diversified = sellerDiversifiedBase(items);
  const totalPages = Math.max(1, Math.ceil(diversified.length / SERVICE_PAGE_SIZE));
  const pageRotation = dateOrdinal(dateKey) % totalPages;
  const offset = (pageRotation * SERVICE_PAGE_SIZE) % diversified.length;
  const remaining = [...diversified.slice(offset), ...diversified.slice(0, offset)];
  const output: ServiceMarketItem[] = [];

  while (remaining.length) {
    const page: ServiceMarketItem[] = [];
    const pageSellers = new Set<number>();

    while (page.length < SERVICE_PAGE_SIZE && remaining.length) {
      const diversifiedIndex = remaining.findIndex((item) => !pageSellers.has(item.seller_student_id));
      const index = diversifiedIndex >= 0 ? diversifiedIndex : 0;
      const [item] = remaining.splice(index, 1);
      page.push(item);
      pageSellers.add(item.seller_student_id);
    }

    page.sort((a, b) => {
      const hashDiff = stableHash(`${dateKey}:${a.id}`) - stableHash(`${dateKey}:${b.id}`);
      return hashDiff || a.id - b.id;
    });
    output.push(...page);
  }

  return output;
}

export function filterServices(items: ServiceMarketItem[], category: ServiceCategoryFilter) {
  if (category === 'ALL') return items;
  return items.filter((item) => effectiveServiceCategory(item) === category);
}

export function sortServices(
  items: ServiceMarketItem[],
  mode: ServiceSortMode,
  serverNow: string,
  reputationByService: Map<number, ServiceReputation>,
) {
  const balanced = balancedOrder(items, serverNow);
  if (mode === 'BALANCED') return balanced;

  const balancedRank = new Map<number, number>(balanced.map((item, index) => [item.id, index]));
  const stableRank = (item: ServiceMarketItem) => balancedRank.get(item.id) ?? Number.MAX_SAFE_INTEGER;

  if (mode === 'NEWEST') {
    return [...items].sort((a, b) => {
      const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return timeDiff || stableRank(a) - stableRank(b) || b.id - a.id;
    });
  }

  if (mode === 'REVIEWS') {
    return [...items].sort((a, b) => {
      const reviewDiff = (reputationByService.get(b.id)?.visible_review_count ?? 0)
        - (reputationByService.get(a.id)?.visible_review_count ?? 0);
      return reviewDiff || stableRank(a) - stableRank(b) || a.id - b.id;
    });
  }

  return [...items].sort((a, b) => {
    const aRep = reputationByService.get(a.id);
    const bRep = reputationByService.get(b.id);
    const aPublished = (aRep?.rating_count ?? 0) >= 5 && aRep?.average_rating !== null && aRep?.average_rating !== undefined;
    const bPublished = (bRep?.rating_count ?? 0) >= 5 && bRep?.average_rating !== null && bRep?.average_rating !== undefined;

    if (aPublished !== bPublished) return aPublished ? -1 : 1;
    if (aPublished && bPublished) {
      const ratingDiff = Number(bRep?.average_rating ?? 0) - Number(aRep?.average_rating ?? 0);
      if (ratingDiff) return ratingDiff;
    }
    return stableRank(a) - stableRank(b) || a.id - b.id;
  });
}

export function pageCount(items: ServiceMarketItem[]) {
  return Math.max(1, Math.ceil(items.length / SERVICE_PAGE_SIZE));
}

export function pageItems(items: ServiceMarketItem[], page: number) {
  const safePage = Math.max(1, Math.min(page, pageCount(items)));
  const start = (safePage - 1) * SERVICE_PAGE_SIZE;
  return items.slice(start, start + SERVICE_PAGE_SIZE);
}

export function findServicePage(items: ServiceMarketItem[], serviceId: number) {
  const index = items.findIndex((item) => item.id === serviceId);
  return index < 0 ? null : Math.floor(index / SERVICE_PAGE_SIZE) + 1;
}
