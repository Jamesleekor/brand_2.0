import { formatNumber } from '@/lib/utils/format';

export type ServicePricingMode = 'FIXED' | 'OPTION' | 'QUOTE';

type ServicePriceLike = {
  pricing_mode: ServicePricingMode;
  quantity_unit: string;
  price_gold?: number | null;
  service_price_gold?: number | null;
  price_min_gold?: number | null;
  price_max_gold?: number | null;
};

export function servicePriceSummary(service: ServicePriceLike): string {
  if (service.pricing_mode === 'QUOTE') return '견적문의';

  const unit = service.quantity_unit?.trim() || '회';
  const legacyPrice = service.price_gold ?? service.service_price_gold ?? null;
  const min = service.price_min_gold ?? legacyPrice;
  const max = service.price_max_gold ?? legacyPrice;
  if (min === null || max === null) return '가격 확인 필요';

  if (service.pricing_mode === 'OPTION' && min !== max) {
    return `${formatNumber(min)} ~ ${formatNumber(max)} GOLD / ${unit}`;
  }
  return `${formatNumber(min)} GOLD / ${unit}`;
}

export function orderPriceSummary(order: {
  pricing_mode: ServicePricingMode;
  total_price_gold?: number | null;
  price_gold?: number | null;
  service_price_gold?: number | null;
  unit_price_gold?: number | null;
  quantity?: number | null;
  requested_quantity?: number | null;
  quantity_unit: string;
  option_name?: string | null;
}): string {
  const total = order.total_price_gold ?? order.price_gold ?? null;
  const unit = order.quantity_unit?.trim() || '회';

  if (order.pricing_mode === 'QUOTE' && total === null) {
    const requested = order.requested_quantity;
    return requested ? `견적 대기 · 희망 ${formatNumber(requested)}${unit}` : '견적 대기 · 미결제';
  }

  if (total === null) return '금액 미정';
  const detail = order.unit_price_gold !== null && order.unit_price_gold !== undefined && order.quantity
    ? ` · ${formatNumber(order.unit_price_gold)} × ${formatNumber(order.quantity)}${unit}`
    : '';
  const option = order.option_name ? ` · ${order.option_name}` : '';
  return `${formatNumber(total)} GOLD${detail}${option}`;
}
