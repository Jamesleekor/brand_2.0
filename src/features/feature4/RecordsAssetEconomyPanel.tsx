import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { useFinancialLifetimeSummary } from '@/hooks/useFinancialLifetimeSummary';
import { savingsRpc, type StudentDeposit, type StudentSavingsBank } from '@/lib/rpc/savings_rpc';
import {
  installmentSavingsRpc,
  type StudentInstallmentBank,
  type StudentInstallmentContract,
} from '@/lib/rpc/installment_savings_rpc';
import {
  secondaryJobServiceStudentRpc,
  type ServiceMarketBoard,
  type ServicePurchaseOrder,
  type ServiceSaleOrder,
} from '@/lib/rpc/secondary_job_service_rpc';
import type { LegacyAssetHistoryRow } from '@/lib/rpc/records_rpc';
import { formatDateTime, formatDelta, formatNumber } from '@/lib/utils/format';

export interface RecordsLiveTransaction {
  id: number;
  value_token: 'GOLD' | 'BV' | 'CRYSTAL';
  amount: number;
  balance_after: number;
  source_type: string;
  tax_amount: number;
  memo: string | null;
  created_at: string;
}

type EconomyFilter = 'ALL' | 'TRANSACTION' | 'FINANCE' | 'TAX_DONATION';

type Props = {
  live: RecordsLiveTransaction[];
  liveTotal: number;
  legacy: LegacyAssetHistoryRow[];
  legacyTotal: number;
};

const SOURCE_LABELS: Record<string, { emoji: string; label: string }> = {
  DAILY_QUEST: { emoji: '⚔️', label: '일일퀘스트' },
  ATTENDANCE_BONUS: { emoji: '📅', label: '출석 보상' },
  ATTENDANCE_STREAK: { emoji: '🔥', label: '연속 출석' },
  CLASS_PARTICIPATION: { emoji: '🙋', label: '수업 참여' },
  ASSIGNMENT_SUBMIT: { emoji: '📝', label: '과제 제출' },
  ASSIGNMENT_EXCELLENCE: { emoji: '🌟', label: '과제 우수' },
  ACHIEVEMENT_RECOGNITION: { emoji: '🏆', label: '업적 보상' },
  PRIMARY_JOB_WAGE: { emoji: '💼', label: '1인1역 급여' },
  GUILD_MISSION_REWARD: { emoji: '🛡️', label: '길드 보상' },
  TEACHER_GRANT: { emoji: '🎁', label: '교사 지급' },
  SNACK_PURCHASE: { emoji: '🍪', label: '간식 구매' },
  COSMETIC_PURCHASE: { emoji: '🎨', label: '꾸미기 구매' },
  AUCTION_PAYMENT: { emoji: '🔨', label: '경매 낙찰' },
  AUCTION_REFUND: { emoji: '↩️', label: '경매 환불' },
  DEPOSIT_PRINCIPAL: { emoji: '🏦', label: '예금 가입' },
  DEPOSIT_MATURITY: { emoji: '💰', label: '예금 환급' },
  EARLY_WITHDRAWAL_PENALTY: { emoji: '⚠️', label: '중도해지 위약금' },
  EXCHANGE_PAY: { emoji: '🔁', label: '화폐 교환 지급' },
  EXCHANGE_RECEIVE: { emoji: '🔄', label: '화폐 교환 수령' },
  DONATION: { emoji: '💝', label: '복지기금 기부' },
  P2P_SEND: { emoji: '↗️', label: '송금' },
  P2P_RECEIVE: { emoji: '↘️', label: '송금 수령' },
  REVERSAL: { emoji: '↩️', label: '거래 취소·복구' },
  TEACHER_DEDUCT: { emoji: '➖', label: '교사 차감' },
  CORRECTION: { emoji: '🔧', label: '정정' },
  OTHER: { emoji: '📌', label: '기타 경제 활동' },
};

const DEPOSIT_STATUS: Record<StudentDeposit['status'], string> = {
  ACTIVE: '진행 중',
  MATURED: '만기 완료',
  EARLY_WITHDRAWN: '중도 해지',
};

const INSTALLMENT_STATUS: Record<StudentInstallmentContract['status'], string> = {
  ACTIVE: '진행 중',
  MATURED: '만기 완료',
  EARLY_WITHDRAWN: '중도 해지',
};

const SERVICE_STATUS: Record<string, string> = {
  QUOTE_REQUESTED: '견적 요청',
  QUOTE_OFFERED: '견적 제안',
  REQUESTED: '주문 요청',
  ACCEPTED: '수락',
  DELIVERED: '전달 완료',
  REVISION_REQUESTED: '수정 요청',
  COMPLETED: '거래 완료',
  REJECTED: '거절',
  CANCELLED: '취소',
  DISPUTED: '분쟁',
};

export function RecordsAssetEconomyPanel({ live, liveTotal, legacy, legacyTotal }: Props) {
  const [filter, setFilter] = useState<EconomyFilter>('ALL');
  const financial = useFinancialLifetimeSummary();

  const economyQ = useQuery({
    queryKey: ['f4d-my-economy-records', financial.studentId],
    enabled: financial.studentId !== null,
    staleTime: 15_000,
    queryFn: async () => {
      const [savingsResult, installmentResult, serviceResult] = await Promise.all([
        savingsRpc.getMyBank(supabase),
        installmentSavingsRpc.getMyBank(supabase),
        secondaryJobServiceStudentRpc.board(supabase),
      ]);

      if (savingsResult.success === false) throw new Error(savingsResult.error || '예금 기록을 불러오지 못했습니다.');
      if (installmentResult.success === false) throw new Error(installmentResult.error || '적금 기록을 불러오지 못했습니다.');
      if (serviceResult.success === false) throw new Error(serviceResult.error || '서비스 거래 기록을 불러오지 못했습니다.');

      return {
        savings: savingsResult.data,
        installments: installmentResult.data,
        services: serviceResult.data,
      };
    },
  });

  const taxDonationTransactions = useMemo(
    () => live.filter((row) => Number(row.tax_amount) > 0 || row.source_type === 'DONATION'),
    [live],
  );

  const showTransactions = filter === 'ALL' || filter === 'TRANSACTION';
  const showFinance = filter === 'ALL' || filter === 'FINANCE';
  const showTaxDonation = filter === 'ALL' || filter === 'TAX_DONATION';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1.5 rounded-card-md border border-line bg-bg-card p-1.5">
        <FilterButton active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="전체" />
        <FilterButton active={filter === 'TRANSACTION'} onClick={() => setFilter('TRANSACTION')} label="거래" />
        <FilterButton active={filter === 'FINANCE'} onClick={() => setFilter('FINANCE')} label="금융" />
        <FilterButton active={filter === 'TAX_DONATION'} onClick={() => setFilter('TAX_DONATION')} label="세금·기부" />
      </div>

      {showTaxDonation && (
        <LifetimeSummary
          data={financial.data}
          isLoading={financial.isLoading}
          error={financial.error}
          onRetry={() => void financial.refetch()}
        />
      )}

      {showTransactions && (
        <>
          <LiveLedger live={live} liveTotal={liveTotal} />
          <ServiceHistory state={economyQ} />
          <LegacyLedger rows={legacy} total={legacyTotal} />
        </>
      )}

      {showFinance && <FinanceHistory state={economyQ} />}

      {filter === 'TAX_DONATION' && (
        <TaxDonationLedger rows={taxDonationTransactions} liveTotal={liveTotal} />
      )}
    </div>
  );
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-card-sm px-2 py-2 text-xs font-black transition ${active ? 'bg-gold/15 text-gold border border-gold/35' : 'text-text-secondary border border-transparent hover:bg-bg-deep'}`}
    >
      {label}
    </button>
  );
}

function LifetimeSummary({
  data,
  isLoading,
  error,
  onRetry,
}: {
  data: ReturnType<typeof useFinancialLifetimeSummary>['data'];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (isLoading) {
    return <InlineLoading text="누적 세금·기부 기록을 불러오는 중..." />;
  }
  if (error) {
    return <Feature4ErrorPanel domain="F4D" error={error} onRetry={onRetry} />;
  }
  if (!data) return null;

  return (
    <section className="rounded-card-md border border-gold/25 bg-bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge label="전체 기간 누적" />
        <span className="text-xs text-text-muted font-bold">시즌 1 이관 기준 + B.R.A.N.D 2.0 확정 거래</span>
      </div>
      <h3 className="font-display text-lg text-text-primary mt-2">🏛️ 세금·기부 누적 기록</h3>
      <p className="text-xs text-text-secondary mt-1">이관 기준선과 2.0 전환 이후 거래를 중복 없이 합산한 서버 공식 누적값입니다.</p>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <StatCard label="누적 납세" value={`${formatNumber(data.tax_paid_total)} GOLD`} />
        <StatCard label="누적 기부" value={`${formatNumber(data.donation_total)} GOLD`} />
      </div>

      <div className="grid sm:grid-cols-2 gap-2 mt-3">
        <BreakdownCard
          title="납세 구성"
          archive={data.baseline_tax_paid}
          current={data.season2_tax_paid}
        />
        <BreakdownCard
          title="기부 구성"
          archive={data.baseline_donation_total}
          current={data.season2_donation_total}
        />
      </div>
    </section>
  );
}

function BreakdownCard({ title, archive, current }: { title: string; archive: number; current: number }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-3">
      <div className="text-xs font-black text-text-primary">{title}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs font-bold text-text-secondary">
        <span>시즌 1 기준 {formatNumber(archive)}</span>
        <span>B.R.A.N.D 2.0 {formatNumber(current)}</span>
      </div>
    </div>
  );
}

function LiveLedger({ live, liveTotal }: { live: RecordsLiveTransaction[]; liveTotal: number }) {
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <SourceBadge label="B.R.A.N.D 2.0" />
          <span className="text-xs text-text-muted font-bold">현재 운영 원장</span>
        </div>
        <h3 className="font-display text-lg text-text-primary mt-2">🧾 최근 자산 거래</h3>
        <p className="text-xs text-text-secondary mt-1">2.0 거래 원장의 최근 50건입니다. 취소된 원본 거래는 제외하고, 취소·복구 자체가 별도 거래로 기록된 경우에는 표시합니다.</p>
      </div>
      {live.length === 0 ? <CompactEmpty text="아직 B.R.A.N.D 2.0 자산 거래가 없습니다." /> : (
        <div className="divide-y divide-line/60">
          {live.map((row) => <LiveTransactionRow key={row.id} row={row} />)}
        </div>
      )}
      {liveTotal > live.length && <CountFooter total={liveTotal} shown={live.length} />}
    </section>
  );
}

function LiveTransactionRow({ row }: { row: RecordsLiveTransaction }) {
  const source = SOURCE_LABELS[row.source_type] ?? { emoji: '📌', label: row.source_type };
  const amountClass = row.amount > 0 ? 'text-success' : row.amount < 0 ? 'text-danger' : 'text-text-secondary';
  return (
    <div className="py-3 flex gap-3 items-start">
      <div className="w-9 h-9 rounded-full bg-bg-deep border border-line flex items-center justify-center shrink-0">{source.emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="text-sm font-extrabold text-text-primary">{source.label}</div>
          <div className={`font-mono text-sm font-black ${amountClass}`}>{formatDelta(Number(row.amount))} {row.value_token}</div>
        </div>
        <div className="text-xs text-text-secondary mt-1 break-words">{row.memo || '상세 메모 없음'}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted font-bold mt-1.5">
          <span>{formatDateTime(row.created_at)}</span>
          <span>잔액 {formatNumber(Number(row.balance_after))}</span>
          {Number(row.tax_amount) > 0 && <span>세금 {formatNumber(Number(row.tax_amount))}</span>}
        </div>
      </div>
    </div>
  );
}

function ServiceHistory({ state }: { state: ReturnType<typeof useEconomyStateShape> }) {
  if (state.isLoading) return <InlineLoading text="서비스 거래 기록을 불러오는 중..." />;
  if (state.isError) return <Feature4ErrorPanel domain="F4D" error={state.error} onRetry={() => void state.refetch()} />;
  if (!state.data) return null;

  const rows = normalizeServiceOrders(state.data.services);
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2"><SourceBadge label="B.R.A.N.D 2.0" /><span className="text-xs text-text-muted font-bold">2차직업 서비스</span></div>
        <h3 className="font-display text-lg text-text-primary mt-2">🤝 서비스 구매·판매 기록</h3>
        <p className="text-xs text-text-secondary mt-1">서비스 시장에서 내가 구매자 또는 판매자로 참여한 주문만 표시합니다.</p>
      </div>
      {rows.length === 0 ? <CompactEmpty text="아직 서비스 구매·판매 기록이 없습니다." /> : (
        <div className="divide-y divide-line/60">
          {rows.map((row) => (
            <div key={`${row.role}-${row.id}`} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-2xs font-black text-bv">{row.role === 'BUY' ? '구매' : '판매'} · {SERVICE_STATUS[row.status] ?? row.status}</div>
                  <div className="text-sm font-extrabold text-text-primary mt-1 break-words">{row.serviceTitle}</div>
                  <div className="text-xs text-text-secondary mt-1">상대: {row.counterparty}</div>
                </div>
                {row.totalPrice !== null && <span className="text-xs font-black text-gold">{formatNumber(row.totalPrice)} GOLD</span>}
              </div>
              <div className="text-2xs text-text-muted font-bold mt-2">{formatDateTime(row.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function normalizeServiceOrders(board: ServiceMarketBoard) {
  const purchases = board.my_orders.map((row: ServicePurchaseOrder) => ({
    id: row.id,
    role: 'BUY' as const,
    serviceTitle: row.service_title,
    counterparty: row.seller_name,
    status: row.status,
    totalPrice: servicePrice(row),
    createdAt: row.created_at,
  }));
  const sales = board.my_sales.map((row: ServiceSaleOrder) => ({
    id: row.id,
    role: 'SELL' as const,
    serviceTitle: row.service_title,
    counterparty: row.buyer_name,
    status: row.status,
    totalPrice: servicePrice(row),
    createdAt: row.created_at,
  }));
  return [...purchases, ...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function servicePrice(row: ServicePurchaseOrder | ServiceSaleOrder) {
  const value = row.total_price_gold ?? row.price_gold;
  return value === null ? null : Number(value);
}

function FinanceHistory({ state }: { state: ReturnType<typeof useEconomyStateShape> }) {
  if (state.isLoading) return <InlineLoading text="예금·적금 기록을 불러오는 중..." />;
  if (state.isError) return <Feature4ErrorPanel domain="F4D" error={state.error} onRetry={() => void state.refetch()} />;
  if (!state.data) return null;

  return (
    <div className="space-y-4">
      <DepositHistory bank={state.data.savings} />
      <InstallmentHistory bank={state.data.installments} />
    </div>
  );
}

function DepositHistory({ bank }: { bank: StudentSavingsBank }) {
  const rows = [...bank.deposits].sort((a, b) => b.start_date.localeCompare(a.start_date));
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="flex flex-wrap items-center gap-2"><SourceBadge label="B.R.A.N.D 2.0" /><span className="text-xs text-text-muted font-bold">예금 계약 원장</span></div>
      <h3 className="font-display text-lg text-text-primary mt-2">🏦 예금 기록</h3>
      <p className="text-xs text-text-secondary mt-1">진행 중인 예금과 만기·중도해지된 과거 계약을 함께 표시합니다.</p>
      {rows.length === 0 ? <CompactEmpty text="예금 가입 기록이 없습니다." /> : (
        <div className="grid md:grid-cols-2 gap-2 mt-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-card-md border border-line bg-bg-deep p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-2xs font-black text-bv">{DEPOSIT_STATUS[row.status]}</div>
                  <div className="text-sm font-extrabold text-text-primary mt-1 break-words">{row.product_name_snapshot}</div>
                </div>
                <span className="text-xs font-black text-gold">{formatNumber(row.principal)} GOLD</span>
              </div>
              <div className="text-2xs text-text-secondary font-bold mt-2">{row.deposit_weeks}주 · 적용금리 {formatPercent(row.effective_interest_rate_snapshot)}</div>
              <div className="text-2xs text-text-muted mt-1">{formatDateOnly(row.start_date)} → {formatDateOnly(row.maturity_date)}</div>
              {row.status !== 'ACTIVE' && <div className="text-2xs text-text-muted mt-1">지급 이자 {formatNumber(row.interest_paid)} GOLD</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InstallmentHistory({ bank }: { bank: StudentInstallmentBank }) {
  const rows = [...bank.contracts].sort((a, b) => b.start_date.localeCompare(a.start_date));
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="flex flex-wrap items-center gap-2"><SourceBadge label="B.R.A.N.D 2.0" /><span className="text-xs text-text-muted font-bold">적금 계약 원장</span></div>
      <h3 className="font-display text-lg text-text-primary mt-2">📈 적금 기록</h3>
      <p className="text-xs text-text-secondary mt-1">계약 상태와 실제 납입 회차·원금을 서버 계약 기록 기준으로 표시합니다.</p>
      {rows.length === 0 ? <CompactEmpty text="적금 가입 기록이 없습니다." /> : (
        <div className="grid md:grid-cols-2 gap-2 mt-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-card-md border border-line bg-bg-deep p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-2xs font-black text-bv">{INSTALLMENT_STATUS[row.status]}</div>
                  <div className="text-sm font-extrabold text-text-primary mt-1 break-words">{row.product_name_snapshot}</div>
                </div>
                <span className="text-xs font-black text-gold">회차당 {formatNumber(row.installment_amount)}</span>
              </div>
              <div className="text-2xs text-text-secondary font-bold mt-2">납입 {row.paid_rounds}/{row.total_rounds}회 · 누적 원금 {formatNumber(row.actual_principal)} GOLD</div>
              <div className="text-2xs text-text-muted mt-1">{formatDateOnly(row.start_date)} → {formatDateOnly(row.maturity_date)}</div>
              <div className="text-2xs text-text-muted mt-1">적용 주간금리 {formatPercent(row.effective_weekly_interest_rate)}{row.missed_rounds > 0 ? ` · 미납 ${row.missed_rounds}회` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TaxDonationLedger({ rows, liveTotal }: { rows: RecordsLiveTransaction[]; liveTotal: number }) {
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="flex items-center gap-2"><SourceBadge label="B.R.A.N.D 2.0" /><span className="text-xs text-text-muted font-bold">최근 거래 50건 기준</span></div>
      <h3 className="font-display text-lg text-text-primary mt-2">🧾 최근 세금·기부 거래</h3>
      <p className="text-xs text-text-secondary mt-1">누적값은 위 공식 요약이 기준이며, 이 목록은 최근 거래 원장에서 세금이 부과됐거나 기부로 기록된 행만 보여주는 참고 타임라인입니다.</p>
      {rows.length === 0 ? <CompactEmpty text="최근 50건 안에 세금·기부 거래가 없습니다." /> : (
        <div className="divide-y divide-line/60 mt-2">{rows.map((row) => <LiveTransactionRow key={row.id} row={row} />)}</div>
      )}
      {liveTotal > 50 && <div className="text-2xs text-warning font-bold mt-3">과거 전체 세금·기부 합계는 위 누적 공식값을 확인하세요.</div>}
    </section>
  );
}

function LegacyLedger({ rows, total }: { rows: LegacyAssetHistoryRow[]; total: number }) {
  return (
    <section className="bg-bg-card border border-bv/25 rounded-card-md p-4">
      <div className="flex flex-wrap items-center gap-2"><SourceBadge label="시즌 1 아카이브" tone="bv" /><span className="text-xs text-text-muted font-bold">이관된 과거 기록</span></div>
      <h3 className="font-display text-lg text-text-primary mt-2">🕰️ 시즌 1 자산 기록</h3>
      <p className="text-xs text-text-secondary mt-1">2.0 거래와 합쳐 재작성하지 않고 원본 이관 기록을 별도 증거로 보존합니다.</p>
      {rows.length === 0 ? <CompactEmpty text="이관된 시즌 1 자산 기록이 없습니다." /> : (
        <div className="divide-y divide-line/60 mt-2">
          {rows.map((row) => (
            <div key={row.source_row} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-extrabold text-text-primary break-words">{row.memo || '시즌 1 자산 변동'}</div>
                  <div className="text-2xs text-text-muted font-bold mt-1">{formatDateOnly(row.event_date)}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {Number(row.gold_delta) !== 0 && <DeltaPill label="GOLD" value={Number(row.gold_delta)} />}
                  {Number(row.bv_delta) !== 0 && <DeltaPill label="BV" value={Number(row.bv_delta)} tone="bv" />}
                  {Number(row.gold_delta) === 0 && Number(row.bv_delta) === 0 && <span className="text-2xs text-text-muted border border-line rounded-pill px-2 py-1">변동 0</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted mt-2">
                <span>기록 후 GOLD {formatNumber(Number(row.balance_after_gold))}</span>
                <span>BV {formatNumber(Number(row.balance_after_bv))}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {total > rows.length && <CountFooter total={total} shown={rows.length} />}
    </section>
  );
}

function useEconomyStateShape() {
  return useQuery<{
    savings: StudentSavingsBank;
    installments: StudentInstallmentBank;
    services: ServiceMarketBoard;
  }>({ queryKey: ['__records-economy-shape-only'], enabled: false, queryFn: async () => { throw new Error('shape only'); } });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-3">
      <div className="text-2xs text-text-muted font-bold">{label}</div>
      <div className="font-display text-lg text-gold mt-1">{value}</div>
    </div>
  );
}

function SourceBadge({ label, tone = 'gold' }: { label: string; tone?: 'gold' | 'bv' }) {
  return <span className={`rounded-pill border px-2.5 py-1 text-2xs font-black ${tone === 'gold' ? 'border-gold/35 bg-gold/10 text-gold' : 'border-bv/35 bg-bv/10 text-bv'}`}>{label}</span>;
}

function DeltaPill({ label, value, tone = 'gold' }: { label: string; value: number; tone?: 'gold' | 'bv' }) {
  const signClass = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-text-muted';
  return <span className={`rounded-pill border px-2 py-1 text-2xs font-black ${tone === 'gold' ? 'border-gold/25 bg-gold/5' : 'border-bv/25 bg-bv/5'} ${signClass}`}>{label} {formatDelta(value)}</span>;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep px-4 py-8 text-center text-sm text-text-muted font-bold mt-3">{text}</div>;
}

function InlineLoading({ text }: { text: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card px-4 py-8 flex items-center justify-center gap-3 text-sm text-text-muted font-bold">
      <LoadingSpinner />
      <span>{text}</span>
    </div>
  );
}

function CountFooter({ total, shown }: { total: number; shown: number }) {
  return <div className="text-2xs text-text-muted font-bold mt-3 text-right">총 {formatNumber(total)}건 중 최근 {formatNumber(shown)}건 표시</div>;
}

function formatDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function formatPercent(value: number) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '0%';
  return `${number.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%`;
}
