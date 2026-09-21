import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner, Modal } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  achievementA3Rpc,
  type AchievementHelperDirectoryItem,
  type AchievementHelperRecordSection,
  type AchievementHelperStudentRecord,
} from '@/lib/rpc/achievement_a3_rpc';
import { cn } from '@/lib/utils/cn';

export interface HelperRecordTarget {
  studentId: number;
  studentName: string;
  suggestedSections?: AchievementHelperRecordSection[];
  initialSection?: AchievementHelperRecordSection;
}

interface Props {
  enabled: boolean;
  onOpenRecord: (target: HelperRecordTarget) => void;
}

const SECTIONS: ReadonlyArray<{ value: AchievementHelperRecordSection; label: string; emoji: string }> = [
  { value: 'OVERVIEW', label: '종합', emoji: '🧭' },
  { value: 'ECONOMY', label: '경제', emoji: '💰' },
  { value: 'P2P', label: '개인거래', emoji: '🤝' },
  { value: 'AUCTION', label: '경매', emoji: '🔨' },
  { value: 'ARCADE', label: '아케이드', emoji: '🕹️' },
  { value: 'GUILD', label: '길드', emoji: '🛡️' },
  { value: 'SHARDS', label: '편린', emoji: '💎' },
  { value: 'DAILY', label: '일퀘·출결', emoji: '✅' },
  { value: 'ACCESS', label: '접속', emoji: '🕒' },
  { value: 'DIMENSION', label: '차원관문', emoji: '🌌' },
  { value: 'ACHIEVEMENTS', label: '업적', emoji: '🏆' },
];

export function AchievementHelperRecordRoom({ enabled, onOpenRecord }: Props) {
  const [search, setSearch] = useState('');
  const directory = useQuery<AchievementHelperDirectoryItem[]>({
    queryKey: ['achievement-helper-directory'],
    queryFn: async () => {
      const r = await achievementA3Rpc.helperDirectory(supabase);
      if (r.success === false) throw new Error(r.error);
      return r.data ?? [];
    },
    enabled,
    staleTime: 15_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = directory.data ?? [];
    if (!q) return base;
    return base.filter((row) => `${row.student_name} ${row.brand_name ?? ''} ${row.tier ?? ''}`.toLowerCase().includes(q));
  }, [directory.data, search]);

  if (directory.isLoading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  if (directory.isError) {
    return (
      <div className="rounded-card-lg border border-danger/40 bg-danger-bg/30 p-4">
        <div className="font-black text-danger">⚠️ 학생 기록실을 불러오지 못했습니다</div>
        <p className="mt-2 text-xs font-semibold text-slate-200">{errorMessage(directory.error)}</p>
        <button className="btn-secondary mt-3 text-xs" type="button" onClick={() => void directory.refetch()}>다시 시도</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-card-lg border border-bv/30 bg-bv/10 p-4">
        <div className="text-sm font-black text-bv-100">🔐 업적 검증용 읽기 전용 기록실</div>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-300">
          같은 학급 학생의 업적 검증 관련 시스템 기록을 조회할 수 있습니다. 기록 수정·삭제·보상 지급은 할 수 없습니다.
        </p>
        <div className="mt-2 rounded-card-sm border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-200">
          서비스 구매자가 남긴 <b>평점·리뷰</b>, 공식 <b>평가·활동 증명</b>, 개인 우편·상담 등 업적 검증에 불필요한 사적 내용은 제공되지 않습니다.
        </div>
      </section>

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="학생 이름·브랜드명 검색"
          className="input-field min-w-0 flex-1 text-sm text-white placeholder:text-slate-400"
        />
        <button type="button" className="btn-secondary !px-3 !py-2 text-xs" onClick={() => void directory.refetch()}>
          새로고침
        </button>
      </div>

      <div className="text-[11px] font-black text-slate-300">학생 {rows.length}명</div>
      {rows.length === 0 ? (
        <EmptyState emoji="🔎" title="검색 결과가 없습니다" description="다른 이름이나 브랜드명으로 검색해보세요." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <DirectoryCard key={row.student_id} row={row} onOpen={() => onOpenRecord({ studentId: row.student_id, studentName: row.student_name })} />
          ))}
        </div>
      )}
    </div>
  );
}

function DirectoryCard({ row, onOpen }: { row: AchievementHelperDirectoryItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-card-lg border border-line bg-bg-card p-4 text-left transition hover:border-bv/45 hover:bg-bg-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-lg text-white">{row.student_name}</div>
          <div className="mt-0.5 truncate text-xs font-bold text-bv-100">{row.brand_name || '브랜드명 없음'} · {row.tier || '티어 없음'}</div>
        </div>
        <span className="rounded-pill border border-bv/30 bg-bv/10 px-2.5 py-1 text-[10px] font-black text-bv-100">기록 열기</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniMetric label="BV 순위" value={`#${row.bv_rank}`} />
        <MiniMetric label="업적" value={`${row.achievement_count}개`} sub={`#${row.achievement_rank}`} />
        <MiniMetric label="신용점수" value={row.credit_score == null ? '-' : formatNumber(row.credit_score)} />
        <MiniMetric label="누적 기부" value={`${formatNumber(row.donation_gold)}G`} sub={`#${row.donation_rank}`} />
        <MiniMetric label="1인1역 경험" value={`${row.primary_job_count}종`} />
        <MiniMetric label="아케이드" value={`${row.arcade_official_run_count}회`} />
      </div>
    </button>
  );
}

function MiniMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card-sm bg-bg-deep p-2">
      <div className="text-[9px] font-black text-slate-300">{label}</div>
      <div className="mt-0.5 truncate text-xs font-black text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[9px] font-bold text-bv-100">{sub}</div>}
    </div>
  );
}

export function HelperRecordModal({ target, onClose }: { target: HelperRecordTarget | null; onClose: () => void }) {
  const initial = target?.initialSection ?? target?.suggestedSections?.[0] ?? 'OVERVIEW';
  const [section, setSection] = useState<AchievementHelperRecordSection>(initial);

  // A new target remount is forced by the caller's key. This keeps state simple and predictable.
  const record = useQuery<AchievementHelperStudentRecord>({
    queryKey: ['achievement-helper-student-record', target?.studentId, section],
    queryFn: async () => {
      if (!target) throw new Error('학생을 선택해주세요.');
      const r = await achievementA3Rpc.helperStudentRecord(supabase, {
        p_student_id: target.studentId,
        p_section: section,
        p_limit: 150,
        p_offset: 0,
      });
      if (r.success === false) throw new Error(r.error);
      return r.data;
    },
    enabled: Boolean(target),
    staleTime: 10_000,
    retry: 1,
  });

  const suggested = new Set(target?.suggestedSections ?? []);

  return (
    <Modal isOpen={Boolean(target)} onClose={onClose} title={`${target?.studentName ?? ''} · 업적 검증 기록`} emoji="📚" size="full">
      <div className="space-y-3">
        <div className="rounded-card-md border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-200">
          읽기 전용입니다. 평점·리뷰와 공식 평가·활동 증명은 이 기록실에서도 노출되지 않습니다.
        </div>

        {suggested.size > 0 && (
          <div className="rounded-card-md border border-bv/25 bg-bv/5 px-3 py-2 text-[11px] font-bold text-slate-200">
            💡 현재 업적과 직접 관련된 기록: {SECTIONS.filter((x) => suggested.has(x.value)).map((x) => `${x.emoji} ${x.label}`).join(' · ')}
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {SECTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSection(item.value)}
              className={cn(
                'flex flex-shrink-0 items-center gap-1 rounded-pill border px-3 py-1.5 text-[10px] font-black',
                section === item.value
                  ? 'border-bv/60 bg-bv text-white'
                  : suggested.has(item.value)
                    ? 'border-bv/35 bg-bv/10 text-bv-100'
                    : 'border-line bg-bg-deep text-slate-200',
              )}
            >
              {item.emoji} {item.label}
            </button>
          ))}
        </div>

        {record.isLoading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : record.isError ? (
          <div className="rounded-card-lg border border-danger/40 bg-danger-bg/30 p-4">
            <div className="font-black text-danger">⚠️ 기록을 불러오지 못했습니다</div>
            <p className="mt-2 text-xs font-semibold text-slate-200">{errorMessage(record.error)}</p>
            <button type="button" className="btn-secondary mt-3 text-xs" onClick={() => void record.refetch()}>다시 시도</button>
          </div>
        ) : record.data ? (
          <RecordSectionView record={record.data} />
        ) : null}
      </div>
    </Modal>
  );
}

function RecordSectionView({ record }: { record: AchievementHelperStudentRecord }) {
  if (record.section === 'OVERVIEW') return <OverviewRecordView record={record} />;
  if (record.section === 'ECONOMY') return <EconomyRecordView record={record} />;
  if (record.section === 'P2P') return <P2PRecordView record={record} />;
  if (record.section === 'DAILY') return <DailyRecordView record={record} />;
  if (record.section === 'AUCTION') return <AuctionRecordView record={record} />;
  if (record.section === 'ARCADE') return <ArcadeRecordView record={record} />;
  if (record.section === 'GUILD') return <GuildRecordView record={record} />;
  if (record.section === 'SHARDS') return <ShardsRecordView record={record} />;

  const entries = Object.entries(record.data ?? {});
  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}
      {entries.length === 0 ? (
        <EmptyState emoji="📭" title="기록이 없습니다" description="이 영역에 아직 저장된 기록이 없습니다." />
      ) : entries.map(([key, value]) => (
        <RecordGroup key={key} label={humanize(key)} value={value} />
      ))}
    </div>
  );
}

function PrivacyNotice({ text }: { text: string }) {
  return (
    <div className="rounded-card-md border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] font-black leading-relaxed text-warning">
      🔐 {text}
    </div>
  );
}

function OverviewRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const metrics = [
    { label: '업적', value: `${numberValue(data.achievement_count)}개`, sub: '현재 유효 업적' },
    { label: '신용점수', value: nullableNumberText(data.credit_score), sub: '최근 산정값' },
    { label: '누적 기부', value: `${formatNumber(numberValue(data.donation_gold))}G`, sub: '기부 행동 기록' },
    { label: 'BV 차감', value: `${numberValue(data.bv_deduction_count)}건`, sub: '확인 가능한 차감 기록' },
    { label: '1인1역 경험', value: `${numberValue(data.primary_job_count)}종`, sub: '서로 다른 역할' },
    { label: '아케이드', value: `${numberValue(data.arcade_official_run_count)}회`, sub: '공식 기록 플레이' },
    { label: 'BV 순위', value: data.bv_rank == null ? '-' : `#${numberValue(data.bv_rank)}`, sub: '현재 학급 순위' },
  ];

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}
      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-white">검증용 핵심 요약</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">현재 자산이 아니라 업적 판단에 자주 쓰이는 기록만 모았습니다.</div>
          </div>
          <span className="rounded-pill border border-bv/25 bg-bv/10 px-2.5 py-1 text-[9px] font-black text-bv-100">자산 비공개</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-card-md border border-line/70 bg-bg-deep px-3 py-2.5">
              <div className="text-[9px] font-black text-slate-400">{metric.label}</div>
              <div className="mt-0.5 text-base font-black text-white">{metric.value}</div>
              <div className="mt-0.5 text-[9px] font-bold text-slate-500">{metric.sub}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EconomyRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const summary = recordValue(data.summary);
  const transactions = arrayValue(data.transactions);
  const deposits = arrayValue(data.deposits);
  const installments = arrayValue(data.installment_savings);
  const loans = arrayValue(data.loans);
  const creditHistory = arrayValue(data.credit_history);
  const marketPurchases = arrayValue(data.market_purchases);

  const summaryMetrics = [
    { label: '저축 이용', value: `${numberValue(summary.savings_use_count)}회` },
    { label: '만기 완료', value: `${numberValue(summary.savings_matured_count)}회` },
    { label: '누적 이자', value: `${formatNumber(numberValue(summary.interest_total))}G` },
    { label: '대출 이용', value: `${numberValue(summary.loan_use_count)}회` },
    { label: '시장 구매', value: `${numberValue(summary.market_purchase_count)}건` },
    { label: '누적 구매액', value: `${formatNumber(numberValue(summary.market_purchase_total))}G` },
    { label: '누적 세금', value: `${formatNumber(numberValue(summary.tax_total))}G` },
    { label: '신용점수', value: nullableNumberText(summary.latest_credit_score) },
  ];

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-white">경제 활동 요약</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">잔액과 원금은 숨기고, 업적 판단에 필요한 이용·구매·이자·세금 기록만 집계합니다.</div>
          </div>
          <span className="rounded-pill border border-bv/25 bg-bv/10 px-2.5 py-1 text-[9px] font-black text-bv-100">검증용 집계</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summaryMetrics.map((metric) => (
            <div key={metric.label} className="rounded-card-md border border-line/70 bg-bg-deep px-3 py-2">
              <div className="text-[9px] font-black text-slate-400">{metric.label}</div>
              <div className="mt-0.5 text-sm font-black text-white">{metric.value}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <CompactPanel title="저축 기록" count={deposits.length + installments.length} empty="저축 이용 기록이 없습니다.">
          <div className="divide-y divide-line/60">
            {deposits.map((item, index) => <SavingsRow key={`deposit-${index}`} item={item} kind="예금" />)}
            {installments.map((item, index) => <SavingsRow key={`installment-${index}`} item={item} kind="적금" />)}
          </div>
        </CompactPanel>

        <CompactPanel title="대출 이용 기록" count={loans.length} empty="대출 이용 기록이 없습니다.">
          <div className="divide-y divide-line/60">
            {loans.map((item, index) => <LoanRow key={index} item={item} />)}
          </div>
        </CompactPanel>
      </div>

      <EconomyRowsPanel
        title="시장 구매·사용 기록"
        rows={marketPurchases}
        empty="시장 활동 기록이 없습니다."
        initialCount={10}
        renderRow={(item, index) => <MarketRow key={index} item={item} />}
      />

      <EconomyRowsPanel
        title="최근 자금 변동"
        rows={transactions}
        empty="자금 변동 기록이 없습니다."
        initialCount={12}
        renderRow={(item, index) => <TransactionRow key={index} item={item} />}
      />

      <CompactPanel title="신용점수 추이" count={creditHistory.length} empty="신용점수 기록이 없습니다.">
        <div className="flex flex-wrap gap-1.5 p-2">
          {creditHistory.slice(0, 14).map((item, index) => {
            const row = recordValue(item);
            return (
              <div key={index} className="min-w-[88px] rounded-card-sm border border-line/70 bg-bg-deep px-2.5 py-2">
                <div className="text-[9px] font-black text-slate-400">{shortDate(row.date)}</div>
                <div className="mt-0.5 text-sm font-black text-white">{nullableNumberText(row.total_score)}</div>
                <div className="text-[9px] font-bold text-bv-100">{textValue(row.grade) || '-'}</div>
              </div>
            );
          })}
        </div>
      </CompactPanel>
    </div>
  );
}

function P2PRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const transfers = arrayValue(data.transfers);
  const serviceOrders = arrayValue(data.service_orders);

  const sentTransfers = transfers.filter((item) => textValue(recordValue(item).direction).toUpperCase() === 'SENT');
  const receivedTransfers = transfers.filter((item) => textValue(recordValue(item).direction).toUpperCase() === 'RECEIVED');
  const soldServices = serviceOrders.filter((item) => textValue(recordValue(item).role).toUpperCase() === 'SELLER');
  const boughtServices = serviceOrders.filter((item) => textValue(recordValue(item).role).toUpperCase() === 'BUYER');
  const completedServices = serviceOrders.filter((item) => textValue(recordValue(item).status).toUpperCase() === 'COMPLETED');
  const uniqueCounterparties = new Set([
    ...transfers.map((item) => textValue(recordValue(item).counterparty_name)),
    ...serviceOrders.map((item) => textValue(recordValue(item).counterparty_name)),
  ].filter(Boolean)).size;

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-white">개인거래 요약</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">
              상대 학생과 거래 내용만 간단히 보여줍니다. 평점·리뷰는 계속 비공개입니다.
            </div>
          </div>
          <span className="rounded-pill border border-warning/25 bg-warning/5 px-2.5 py-1 text-[9px] font-black text-warning">평점·리뷰 비공개</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryMetric label="보낸 송금" value={`${sentTransfers.length}건`} />
          <SummaryMetric label="받은 송금" value={`${receivedTransfers.length}건`} />
          <SummaryMetric label="서비스 판매" value={`${soldServices.length}건`} />
          <SummaryMetric label="서비스 구매" value={`${boughtServices.length}건`} />
          <SummaryMetric label="완료 서비스" value={`${completedServices.length}건`} />
          <SummaryMetric label="거래 상대" value={`${uniqueCounterparties}명`} />
        </div>
      </section>

      <ExpandableRowsPanel
        title="송금 내역"
        rows={transfers}
        empty="학생 간 송금 기록이 없습니다."
        initialCount={12}
        renderRow={(item, index) => <P2PTransferRow key={index} item={item} />}
      />

      <ExpandableRowsPanel
        title="P2P 서비스 거래"
        rows={serviceOrders}
        empty="P2P 서비스 거래 기록이 없습니다."
        initialCount={10}
        renderRow={(item, index) => <P2PServiceOrderRow key={index} item={item} />}
      />
    </div>
  );
}

function P2PTransferRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const direction = textValue(row.direction).toUpperCase();
  const sent = direction === 'SENT';
  const status = textValue(row.status).toUpperCase();
  const counterparty = textValue(row.counterparty_name) || '상대 학생';
  const quantity = numberValue(row.quantity);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn(
            'flex-shrink-0 rounded-pill border px-2 py-0.5 text-[9px] font-black',
            sent ? 'border-danger/20 bg-danger/5 text-danger' : 'border-success/25 bg-success/5 text-success',
          )}>
            {sent ? '보냄' : '받음'}
          </span>
          <div className="truncate text-xs font-black text-white">
            {sent ? `${counterparty}에게` : `${counterparty}에게서`}
          </div>
        </div>
        <div className="mt-1 truncate text-[9px] font-bold text-slate-400">
          {p2pTagLabel(textValue(row.tag))}
          {quantity > 1 ? ` · 수량 ${quantity}` : ''}
          {status && status !== 'NORMAL' ? ` · ${p2pTransferStatusLabel(status)}` : ''}
          {' · '}{shortDateTime(row.created_at)}
        </div>
      </div>
      <div className={cn('whitespace-nowrap text-right text-sm font-black', sent ? 'text-danger' : 'text-success')}>
        {sent ? '-' : '+'}{formatNumber(numberValue(row.amount))}G
      </div>
    </div>
  );
}

function P2PServiceOrderRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const role = textValue(row.role).toUpperCase();
  const seller = role === 'SELLER';
  const status = textValue(row.status).toUpperCase();
  const counterparty = textValue(row.counterparty_name) || '상대 학생';
  const quantity = Math.max(numberValue(row.quantity), 1);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn(
            'flex-shrink-0 rounded-pill border px-2 py-0.5 text-[9px] font-black',
            seller ? 'border-success/25 bg-success/5 text-success' : 'border-bv/25 bg-bv/5 text-bv-100',
          )}>
            {seller ? '판매' : '구매'}
          </span>
          <div className="truncate text-xs font-black text-white">{textValue(row.service_title) || 'P2P 서비스'}</div>
        </div>
        <div className="mt-1 truncate text-[9px] font-bold text-slate-400">
          {seller ? `구매자 ${counterparty}` : `판매자 ${counterparty}`} · 수량 {quantity} · {shortDateTime(row.created_at)}
        </div>
      </div>
      <div className="text-right">
        <div className="whitespace-nowrap text-xs font-black text-gold">{formatNumber(numberValue(row.price_gold))}G</div>
        <div className={cn('mt-0.5 text-[9px] font-black', p2pServiceStatusTone(status))}>{p2pServiceStatusLabel(status)}</div>
      </div>
    </div>
  );
}

function DailyRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const attendance = arrayValue(data.attendance);
  const questChecks = arrayValue(data.quest_checks);
  const primaryJobs = arrayValue(data.primary_jobs);
  const secondaryJobs = arrayValue(data.secondary_jobs);

  const latestPrimaryJob = primaryJobs.find((item) => recordValue(item).is_active === true) ?? primaryJobs[0];
  const activeSecondaryJobs = secondaryJobs.filter((item) => recordValue(item).is_active === true);

  const dailyRows = useMemo(() => buildDailyRows(attendance, questChecks), [attendance, questChecks]);
  const attendancePresent = attendance.filter((item) => attendanceStatus(textValue(recordValue(item).status)) === 'PASS').length;
  const attendanceAbsent = attendance.filter((item) => attendanceStatus(textValue(recordValue(item).status)) === 'FAIL').length;
  const latestAttendance = attendance[0] ? recordValue(attendance[0]) : null;
  const currentStreak = numberValue(latestAttendance?.['streak_days']);
  const perfectDays = dailyRows.filter((row) => DAILY_QUEST_CODES.every((code) => row.quests[code] === 'PASS')).length;
  const primaryPassDays = dailyRows.filter((row) => row.quests.PRIMARY_JOB === 'PASS').length;
  const cleaningPassDays = dailyRows.filter((row) => row.quests.CLEANING === 'PASS').length;

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div>
          <div className="text-sm font-black text-white">일퀘·출결 요약</div>
          <div className="mt-0.5 text-[10px] font-bold text-slate-400">
            날짜별 기록을 한 줄로 합쳐 출석·1인1역·청소·준비물 상태를 빠르게 확인합니다.
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryMetric label="출석" value={`${attendancePresent}일`} />
          <SummaryMetric label="결석" value={`${attendanceAbsent}일`} />
          <SummaryMetric label="현재 연속출석" value={`${currentStreak}일`} />
          <SummaryMetric label="일퀘 4종 완벽" value={`${perfectDays}일`} />
          <SummaryMetric label="1인1역 통과" value={`${primaryPassDays}일`} />
          <SummaryMetric label="청소 통과" value={`${cleaningPassDays}일`} />
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DailyJobSummary
            label="현재 1인1역"
            value={latestPrimaryJob ? textValue(recordValue(latestPrimaryJob).job_name) || '역할명 없음' : '배정 기록 없음'}
            sub={latestPrimaryJob ? primaryJobSubtext(recordValue(latestPrimaryJob)) : undefined}
          />
          <DailyJobSummary
            label="현재 2차직업"
            value={activeSecondaryJobs.length ? activeSecondaryJobs.map((item) => textValue(recordValue(item).job_name)).filter(Boolean).join(' · ') : '활동 중인 2차직업 없음'}
            sub={activeSecondaryJobs.length ? `${activeSecondaryJobs.length}개 활동 중` : undefined}
          />
        </div>
      </section>

      <DailyHistoryPanel rows={dailyRows} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ExpandableRowsPanel
          title="1인1역 이력"
          rows={primaryJobs}
          empty="1인1역 배정 이력이 없습니다."
          initialCount={6}
          renderRow={(item, index) => <PrimaryJobHistoryRow key={index} item={item} />}
        />
        <ExpandableRowsPanel
          title="2차직업 이력"
          rows={secondaryJobs}
          empty="2차직업 이력이 없습니다."
          initialCount={6}
          renderRow={(item, index) => <SecondaryJobHistoryRow key={index} item={item} />}
        />
      </div>
    </div>
  );
}

type DailyQuestCode = 'ATTENDANCE' | 'PRIMARY_JOB' | 'CLEANING' | 'LEARNING_MATERIALS';
type DailyResult = 'PASS' | 'FAIL' | 'UNCHECKED';

interface DailyCombinedRow {
  date: string;
  attendance: DailyResult;
  quests: Record<DailyQuestCode, DailyResult>;
}

const DAILY_QUEST_CODES: DailyQuestCode[] = ['ATTENDANCE', 'PRIMARY_JOB', 'CLEANING', 'LEARNING_MATERIALS'];

function buildDailyRows(attendance: unknown[], questChecks: unknown[]): DailyCombinedRow[] {
  const map = new Map<string, DailyCombinedRow>();

  const ensure = (date: string) => {
    const existing = map.get(date);
    if (existing) return existing;
    const created: DailyCombinedRow = {
      date,
      attendance: 'UNCHECKED',
      quests: {
        ATTENDANCE: 'UNCHECKED',
        PRIMARY_JOB: 'UNCHECKED',
        CLEANING: 'UNCHECKED',
        LEARNING_MATERIALS: 'UNCHECKED',
      },
    };
    map.set(date, created);
    return created;
  };

  for (const item of attendance) {
    const row = recordValue(item);
    const date = textValue(row.date);
    if (!date) continue;
    const result = attendanceStatus(textValue(row.status));
    const target = ensure(date);
    target.attendance = result;
    target.quests.ATTENDANCE = result;
  }

  for (const item of questChecks) {
    const row = recordValue(item);
    const date = textValue(row.quest_date);
    const code = textValue(row.quest_code).toUpperCase() as DailyQuestCode;
    if (!date || !DAILY_QUEST_CODES.includes(code)) continue;
    const result = dailyResult(textValue(row.result));
    const target = ensure(date);
    target.quests[code] = result;
    if (code === 'ATTENDANCE') target.attendance = result;
  }

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function DailyHistoryPanel({ rows }: { rows: DailyCombinedRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 14);

  return (
    <CompactPanel title="날짜별 일퀘·출결" count={rows.length} empty="일퀘·출결 기록이 없습니다.">
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[92px_repeat(4,minmax(86px,1fr))] border-b border-line/70 bg-bg-deep/70 px-3 py-2 text-[9px] font-black text-slate-400">
            <div>날짜</div>
            <div className="text-center">출석</div>
            <div className="text-center">1인1역</div>
            <div className="text-center">청소</div>
            <div className="text-center">준비물</div>
          </div>
          <div className="divide-y divide-line/60">
            {visible.map((row) => (
              <div key={row.date} className="grid grid-cols-[92px_repeat(4,minmax(86px,1fr))] items-center px-3 py-2">
                <div className="text-[10px] font-black text-white">{shortDate(row.date)}</div>
                <DailyStatusCell result={row.quests.ATTENDANCE} />
                <DailyStatusCell result={row.quests.PRIMARY_JOB} />
                <DailyStatusCell result={row.quests.CLEANING} />
                <DailyStatusCell result={row.quests.LEARNING_MATERIALS} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {rows.length > 14 && (
        <ExpandButton expanded={expanded} hiddenCount={rows.length - 14} onClick={() => setExpanded((value) => !value)} />
      )}
    </CompactPanel>
  );
}

function DailyStatusCell({ result }: { result: DailyResult }) {
  const label = result === 'PASS' ? '통과' : result === 'FAIL' ? '미통과' : '미확인';
  return (
    <div className="flex justify-center">
      <span className={cn(
        'inline-flex min-w-[54px] justify-center rounded-pill border px-2 py-1 text-[9px] font-black',
        result === 'PASS'
          ? 'border-success/25 bg-success/5 text-success'
          : result === 'FAIL'
            ? 'border-danger/25 bg-danger/5 text-danger'
            : 'border-line bg-bg-card text-slate-500',
      )}>
        {result === 'PASS' ? '✓ ' : result === 'FAIL' ? '✕ ' : ''}{label}
      </span>
    </div>
  );
}

function DailyJobSummary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card-md border border-line/70 bg-bg-deep px-3 py-2.5">
      <div className="text-[9px] font-black text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xs font-black text-white" title={value}>{value}</div>
      {sub && <div className="mt-0.5 text-[9px] font-bold text-slate-500">{sub}</div>}
    </div>
  );
}

function PrimaryJobHistoryRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const active = row.is_active === true && !row.released_at;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.job_name) || '1인1역'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">
          {shortDate(row.assigned_at)} 시작{row.assigned_area ? ` · ${textValue(row.assigned_area)}` : ''}
        </div>
      </div>
      <div className="text-right">
        {row.daily_wage != null && <div className="text-[10px] font-black text-gold">일급 {formatNumber(numberValue(row.daily_wage))}G</div>}
        <div className={cn('mt-0.5 text-[9px] font-black', active ? 'text-success' : 'text-slate-500')}>
          {active ? '현재 담당' : `${shortDate(row.released_at)} 종료`}
        </div>
      </div>
    </div>
  );
}

function SecondaryJobHistoryRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const active = row.is_active === true && !row.released_at;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.job_name) || '2차직업'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">
          {shortDate(row.approved_at)} 승인{row.tier_at_approval ? ` · ${textValue(row.tier_at_approval)}` : ''}
        </div>
      </div>
      <div className={cn('text-[9px] font-black', active ? 'text-success' : 'text-slate-500')}>
        {active ? '활동 중' : `${shortDate(row.released_at)} 종료`}
      </div>
    </div>
  );
}

function AuctionRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const bids = arrayValue(data.bids);
  const wins = arrayValue(data.wins);

  const bidGroups = useMemo(() => {
    const grouped = new Map<string, {
      auctionId: number;
      roundNumber: number;
      itemName: string;
      startingPrice: number;
      bidCount: number;
      maxBid: number;
      latestAt: string;
      isWinning: boolean;
    }>();

    for (const item of bids) {
      const row = recordValue(item);
      const auctionId = numberValue(row.auction_id);
      const itemName = textValue(row.item_name) || '경매 상품';
      const key = `${auctionId}:${itemName}`;
      const current = grouped.get(key);
      const bidAmount = numberValue(row.bid_amount);
      const createdAt = textValue(row.created_at);
      if (!current) {
        grouped.set(key, {
          auctionId,
          roundNumber: numberValue(row.round_number),
          itemName,
          startingPrice: numberValue(row.starting_price),
          bidCount: 1,
          maxBid: bidAmount,
          latestAt: createdAt,
          isWinning: row.is_winning === true,
        });
      } else {
        current.bidCount += 1;
        current.maxBid = Math.max(current.maxBid, bidAmount);
        current.isWinning = current.isWinning || row.is_winning === true;
        if (new Date(createdAt).getTime() > new Date(current.latestAt).getTime()) current.latestAt = createdAt;
      }
    }
    return Array.from(grouped.values()).sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
  }, [bids]);

  const rounds = new Set(bids.map((item) => numberValue(recordValue(item).auction_id)).filter(Boolean)).size;
  const highestWin = wins.reduce<number>((max, item) => Math.max(max, numberValue(recordValue(item).final_price)), 0);

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div>
          <div className="text-sm font-black text-white">경매 활동 요약</div>
          <div className="mt-0.5 text-[10px] font-bold text-slate-400">같은 상품에서 여러 번 입찰한 기록은 한 줄로 묶었습니다.</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryMetric label="참여 회차" value={`${rounds}회`} />
          <SummaryMetric label="입찰 상품" value={`${bidGroups.length}개`} />
          <SummaryMetric label="낙찰" value={`${wins.length}개`} />
          <SummaryMetric label="최고 낙찰가" value={wins.length ? `${formatNumber(highestWin)}G` : '-'} />
        </div>
      </section>

      <ExpandableRowsPanel
        title="낙찰 기록"
        rows={wins}
        empty="낙찰 기록이 없습니다."
        initialCount={8}
        renderRow={(item, index) => <AuctionWinRow key={index} item={item} />}
      />

      <ExpandableRowsPanel
        title="상품별 입찰 요약"
        rows={bidGroups}
        empty="입찰 기록이 없습니다."
        initialCount={10}
        renderRow={(item, index) => <AuctionBidSummaryRow key={index} item={item} />}
      />
    </div>
  );
}

function AuctionWinRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.item_name) || '경매 상품'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">
          {numberValue(row.round_number)}회차 · {numberValue(row.attempt_number)}차 경매 · {shortDateTime(row.confirmed_at)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-black text-success">{formatNumber(numberValue(row.final_price))}G</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-500">시작 {formatNumber(numberValue(row.starting_price))}G</div>
      </div>
    </div>
  );
}

function AuctionBidSummaryRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.itemName) || '경매 상품'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">
          {numberValue(row.roundNumber)}회차 · 입찰 {numberValue(row.bidCount)}회 · {shortDateTime(row.latestAt)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-black text-bv-100">최고 {formatNumber(numberValue(row.maxBid))}G</div>
        {row.isWinning === true && <div className="mt-0.5 text-[9px] font-black text-success">최종 선두 기록 있음</div>}
      </div>
    </div>
  );
}

function ArcadeRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const runs = arrayValue(data.runs);
  const monthlyRanks = arrayValue(data.monthly_final_ranks);
  const sessions = arrayValue(data.verification_sessions);
  const attempts = arrayValue(data.verification_attempts);

  const verifiedRuns = runs.filter((item) => textValue(recordValue(item).status).toUpperCase() === 'VERIFIED');
  const gameCount = new Set(runs.map((item) => textValue(recordValue(item).game_code)).filter(Boolean)).size;
  const top10Count = monthlyRanks.filter((item) => {
    const rank = numberValue(recordValue(item).rank);
    return rank > 0 && rank <= 10;
  }).length;
  const firstCount = monthlyRanks.filter((item) => numberValue(recordValue(item).rank) === 1).length;
  const successCount = sessions.filter((item) => recordValue(item).success === true).length;

  const attemptsBySession = useMemo(() => {
    const map = new Map<number, unknown[]>();
    for (const item of attempts) {
      const row = recordValue(item);
      const id = numberValue(row.session_id);
      map.set(id, [...(map.get(id) ?? []), item]);
    }
    return map;
  }, [attempts]);

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div>
          <div className="text-sm font-black text-white">아케이드 요약</div>
          <div className="mt-0.5 text-[10px] font-bold text-slate-400">월간 순위와 인증 기록을 먼저 보고, 필요할 때 최근 플레이를 펼쳐보세요.</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryMetric label="공식 플레이" value={`${verifiedRuns.length}회`} />
          <SummaryMetric label="플레이 게임" value={`${gameCount}종`} />
          <SummaryMetric label="월 TOP10" value={`${top10Count}회`} />
          <SummaryMetric label="월 1위" value={`${firstCount}회`} />
          <SummaryMetric label="인증 성공" value={`${successCount}회`} />
        </div>
      </section>

      <ExpandableRowsPanel
        title="월간 최종 순위"
        rows={monthlyRanks}
        empty="월간 최종 순위 기록이 없습니다."
        initialCount={10}
        renderRow={(item, index) => <ArcadeRankRow key={index} item={item} />}
      />

      <ExpandableRowsPanel
        title="기록 인증 도전"
        rows={sessions}
        empty="기록 인증 도전이 없습니다."
        initialCount={8}
        renderRow={(item, index) => (
          <ArcadeVerificationRow key={index} item={item} attempts={attemptsBySession.get(numberValue(recordValue(item).session_id)) ?? []} />
        )}
      />

      <ExpandableRowsPanel
        title="최근 공식 플레이"
        rows={runs}
        empty="아케이드 플레이 기록이 없습니다."
        initialCount={12}
        renderRow={(item, index) => <ArcadeRunRow key={index} item={item} />}
      />
    </div>
  );
}

function ArcadeRankRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const rank = numberValue(row.rank);
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
      <div className={cn(
        'text-center font-display text-lg',
        rank === 1 ? 'text-gold' : rank <= 3 ? 'text-bv-100' : 'text-white',
      )}>
        #{rank || '-'}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.game_name) || textValue(row.game_code) || '아케이드'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">{textValue(row.period) || textValue(row.year_month) || '-'} · {shortDateTime(row.achieved_at)}</div>
      </div>
      <div className="text-right text-xs font-black text-bv-100">{formatNumber(numberValue(row.score))}점</div>
    </div>
  );
}

function ArcadeVerificationRow({ item, attempts }: { item: unknown; attempts: unknown[] }) {
  const row = recordValue(item);
  const success = row.success === true;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.game_code) || '게임'} · {textValue(row.period) || '인증 기간'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">
          기준 {formatNumber(numberValue(row.threshold))}점 · 기준 기록 {formatNumber(numberValue(row.provisional_score))}점
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {attempts.slice(0, 3).map((attempt, index) => {
            const a = recordValue(attempt);
            const outcome = textValue(a.terminal_outcome) || textValue(a.status) || '-';
            return (
              <span key={index} className="rounded-pill border border-line bg-bg-deep px-2 py-0.5 text-[9px] font-black text-slate-300">
                {numberValue(a.opportunity) || index + 1}차 · {arcadeOutcomeLabel(outcome)}
                {a.official_score != null ? ` ${formatNumber(numberValue(a.official_score))}점` : ''}
              </span>
            );
          })}
        </div>
      </div>
      <div className="text-right">
        <span className={cn(
          'inline-flex rounded-pill border px-2 py-1 text-[9px] font-black',
          success ? 'border-success/30 bg-success/10 text-success' : 'border-line bg-bg-deep text-slate-300',
        )}>
          {success ? '인증 성공' : arcadeOutcomeLabel(textValue(row.result_status) || textValue(row.status))}
        </span>
        <div className="mt-1 text-[9px] font-bold text-slate-500">{attempts.length}/{numberValue(row.max_attempts)}회 사용</div>
      </div>
    </div>
  );
}

function ArcadeRunRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const status = textValue(row.status).toUpperCase();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.game_name) || textValue(row.game_code) || '아케이드'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">
          {shortDateTime(row.game_over_at || row.verified_at)} · {textValue(row.run_context) || 'STANDARD'}
          {row.duration_ms != null ? ` · ${durationText(numberValue(row.duration_ms))}` : ''}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-black text-bv-100">{row.official_score == null ? '-' : `${formatNumber(numberValue(row.official_score))}점`}</div>
        <div className={cn('mt-0.5 text-[9px] font-black', status === 'VERIFIED' ? 'text-success' : status === 'REJECTED' ? 'text-danger' : 'text-slate-400')}>
          {arcadeRunStatusLabel(status)}
        </div>
      </div>
    </div>
  );
}

function GuildRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const memberships = arrayValue(data.memberships);
  const attendance = arrayValue(data.session_attendance);
  const monthly = arrayValue(data.monthly_contribution);
  const closed = arrayValue(data.closed_snapshots);
  const missions = arrayValue(data.mission_participation);

  const currentMembership = memberships.find((item) => {
    const row = recordValue(item);
    return row.left_at == null || row.left_at === '';
  });
  const presentCount = attendance.filter((item) => recordValue(item).is_present === true).length;
  const attendanceRate = attendance.length ? Math.round((presentCount / attendance.length) * 100) : 0;

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div>
          <div className="text-sm font-black text-white">길드 활동 요약</div>
          <div className="mt-0.5 text-[10px] font-bold text-slate-400">현재 소속과 공식 월간 기록을 먼저 보여줍니다.</div>
        </div>

        {currentMembership ? <CurrentGuildCard item={currentMembership} /> : (
          <div className="mt-3 rounded-card-md border border-line bg-bg-deep px-3 py-3 text-xs font-bold text-slate-400">현재 소속 길드가 없습니다.</div>
        )}

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryMetric label="소속 이력" value={`${memberships.length}건`} />
          <SummaryMetric label="길드 세션" value={`${attendance.length}회`} />
          <SummaryMetric label="세션 참석률" value={attendance.length ? `${attendanceRate}%` : '-'} />
          <SummaryMetric label="미션 참여" value={`${missions.length}회`} />
        </div>
      </section>

      <ExpandableRowsPanel
        title="월간 공식 기여 기록"
        rows={closed}
        empty="월간 마감 공식 기록이 없습니다."
        initialCount={8}
        renderRow={(item, index) => <GuildClosedSnapshotRow key={index} item={item} />}
      />

      {closed.length === 0 && (
        <ExpandableRowsPanel
          title="월간 기여 기록"
          rows={monthly}
          empty="월간 기여 기록이 없습니다."
          initialCount={8}
          renderRow={(item, index) => <GuildMonthlyRow key={index} item={item} />}
        />
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ExpandableRowsPanel
          title="길드 미션 참여"
          rows={missions}
          empty="길드 미션 참여 기록이 없습니다."
          initialCount={8}
          renderRow={(item, index) => <GuildMissionRow key={index} item={item} />}
        />
        <ExpandableRowsPanel
          title="길드 세션 참석"
          rows={attendance}
          empty="길드 세션 기록이 없습니다."
          initialCount={10}
          renderRow={(item, index) => <GuildAttendanceRow key={index} item={item} />}
        />
      </div>

      <ExpandableRowsPanel
        title="길드 소속 이력"
        rows={memberships}
        empty="길드 소속 이력이 없습니다."
        initialCount={6}
        renderRow={(item, index) => <GuildMembershipRow key={index} item={item} />}
      />
    </div>
  );
}

function CurrentGuildCard({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card-md border border-bv/25 bg-bv/5 px-3 py-2.5">
      <div>
        <div className="text-[9px] font-black text-slate-400">현재 소속</div>
        <div className="mt-0.5 text-sm font-black text-white">{textValue(row.guild_name) || '-'}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-black text-bv-100">{guildElementLabel(textValue(row.element))}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-500">{shortDateTime(row.joined_at)} 가입</div>
      </div>
    </div>
  );
}

function GuildClosedSnapshotRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
      <div className="text-[10px] font-black text-slate-400">{textValue(row.year_month) || '-'}</div>
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.guild_name) || '길드'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-500">
          미션 {formatNumber(numberValue(row.mission_points))} · 세션 {formatNumber(numberValue(row.session_points))} · 아케이드 {formatNumber(numberValue(row.arcade_applied))}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-black text-bv-100">{formatNumber(numberValue(row.final_contribution))}</div>
        <div className="text-[9px] font-bold text-slate-500">최종 기여도</div>
      </div>
    </div>
  );
}

function GuildMonthlyRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
      <div className="text-[10px] font-black text-slate-400">{textValue(row.year_month) || '-'}</div>
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.guild_name) || '길드'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-500">미션 {numberValue(row.mission_participation_count)}회 · 세션 {numberValue(row.session_attendance_count)}회</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-black text-bv-100">{formatNumber(numberValue(row.total_contribution_score))}</div>
        <div className="text-[9px] font-bold text-slate-500">기여 점수</div>
      </div>
    </div>
  );
}

function GuildMissionRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="px-3 py-2.5">
      <div className="truncate text-xs font-black text-white">{textValue(row.title) || `미션 #${numberValue(row.mission_id)}`}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-slate-400">
        <span>{textValue(row.guild_name) || '길드'}</span>
        <span>참여 {shortDateTime(row.snapshot_at)}</span>
        <span>{row.finalized_at ? `확정 ${shortDateTime(row.finalized_at)}` : '미확정'}</span>
      </div>
    </div>
  );
}

function GuildAttendanceRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const present = row.is_present === true;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div>
        <div className="text-xs font-black text-white">{shortDate(row.session_date)}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">{textValue(row.guild_name) || '길드 세션'}</div>
      </div>
      <span className={cn(
        'rounded-pill border px-2 py-1 text-[9px] font-black',
        present ? 'border-success/30 bg-success/10 text-success' : 'border-danger/25 bg-danger/10 text-danger',
      )}>
        {present ? '참석' : '불참'}
      </span>
    </div>
  );
}

function GuildMembershipRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const active = row.left_at == null || row.left_at === '';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.guild_name) || '길드'}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">{guildElementLabel(textValue(row.element))} · 시즌 {numberValue(row.season_id)}</div>
      </div>
      <div className="text-right text-[9px] font-bold text-slate-400">
        <div>{shortDateTime(row.joined_at)} 시작</div>
        <div className={active ? 'font-black text-success' : ''}>{active ? '현재 소속' : `${shortDateTime(row.left_at)} 종료`}</div>
      </div>
    </div>
  );
}

function ShardsRecordView({ record }: { record: AchievementHelperStudentRecord }) {
  const data = record.data ?? {};
  const owned = arrayValue(data.owned_characters);
  const collections = arrayValue(data.completed_collections);
  const acquisitionSources = new Set(owned.map((item) => textValue(recordValue(item).acquired_via)).filter(Boolean)).size;
  const latestAcquired = owned.reduce<string>((latest, item) => {
    const value = textValue(recordValue(item).acquired_at);
    if (!value) return latest;
    if (!latest || new Date(value).getTime() > new Date(latest).getTime()) return value;
    return latest;
  }, '');

  return (
    <div className="space-y-3">
      {record.privacy && <PrivacyNotice text={record.privacy} />}

      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div>
          <div className="text-sm font-black text-white">편린 수집 요약</div>
          <div className="mt-0.5 text-[10px] font-bold text-slate-400">보유 종수와 완성 콜렉션을 한눈에 확인합니다.</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryMetric label="보유 편린" value={`${owned.length}종`} />
          <SummaryMetric label="완성 콜렉션" value={`${collections.length}종`} />
          <SummaryMetric label="획득 경로" value={`${acquisitionSources}종`} />
          <SummaryMetric label="최근 획득" value={latestAcquired ? shortDate(latestAcquired) : '-'} />
        </div>
      </section>

      <CollectionsPanel rows={collections} />
      <OwnedShardsPanel rows={owned} />
    </div>
  );
}

function CollectionsPanel({ rows }: { rows: unknown[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 8);
  return (
    <CompactPanel title="완성 콜렉션" count={rows.length} empty="완성한 콜렉션이 없습니다.">
      <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item, index) => {
          const row = recordValue(item);
          return (
            <div key={index} className="rounded-card-md border border-line/70 bg-bg-deep px-3 py-2.5">
              <div className="truncate text-xs font-black text-white">{textValue(row.name) || textValue(row.collection_uid) || '콜렉션'}</div>
              <div className="mt-0.5 text-[9px] font-bold text-slate-400">{textValue(row.collection_uid) || '-'} · 편린 {numberValue(row.member_count)}종</div>
            </div>
          );
        })}
      </div>
      {rows.length > 8 && (
        <ExpandButton expanded={expanded} hiddenCount={rows.length - 8} onClick={() => setExpanded((value) => !value)} />
      )}
    </CompactPanel>
  );
}

function OwnedShardsPanel({ rows }: { rows: unknown[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 16);
  return (
    <CompactPanel title="보유 편린" count={rows.length} empty="보유한 편린이 없습니다.">
      <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visible.map((item, index) => {
          const row = recordValue(item);
          return (
            <div key={index} className="min-w-0 rounded-card-sm border border-line/70 bg-bg-deep px-2.5 py-2">
              <div className="truncate text-[11px] font-black text-white">{textValue(row.name) || textValue(row.character_uid) || '편린'}</div>
              <div className="mt-0.5 truncate text-[9px] font-bold text-bv-100">{textValue(row.epithet) || textValue(row.character_uid) || '-'}</div>
              <div className="mt-1 flex items-center justify-between gap-1 text-[8px] font-bold text-slate-500">
                <span className="truncate">{acquisitionLabel(textValue(row.acquired_via))}</span>
                <span className="whitespace-nowrap">{shortDate(row.acquired_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > 16 && (
        <ExpandButton expanded={expanded} hiddenCount={rows.length - 16} onClick={() => setExpanded((value) => !value)} />
      )}
    </CompactPanel>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line/70 bg-bg-deep px-3 py-2">
      <div className="text-[9px] font-black text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-black text-white">{value}</div>
    </div>
  );
}

function ExpandableRowsPanel({
  title,
  rows,
  empty,
  initialCount,
  renderRow,
}: {
  title: string;
  rows: unknown[];
  empty: string;
  initialCount: number;
  renderRow: (item: unknown, index: number) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, initialCount);
  return (
    <CompactPanel title={title} count={rows.length} empty={empty}>
      <div className="divide-y divide-line/60">{visible.map(renderRow)}</div>
      {rows.length > initialCount && (
        <ExpandButton expanded={expanded} hiddenCount={rows.length - initialCount} onClick={() => setExpanded((value) => !value)} />
      )}
    </CompactPanel>
  );
}

function ExpandButton({ expanded, hiddenCount, onClick }: { expanded: boolean; hiddenCount: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border-t border-line/70 px-3 py-2 text-[10px] font-black text-bv-100 hover:bg-bg-soft"
    >
      {expanded ? '간단히 보기' : `나머지 ${hiddenCount}건 펼치기`}
    </button>
  );
}

function CompactPanel({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-2.5">
        <div className="text-xs font-black text-white">{title}</div>
        <span className="rounded-pill bg-bg-deep px-2 py-0.5 text-[9px] font-black text-slate-300">{count}건</span>
      </div>
      {count === 0 ? <div className="px-3 py-4 text-xs font-semibold text-slate-400">{empty}</div> : children}
    </section>
  );
}

function EconomyRowsPanel({
  title,
  rows,
  empty,
  initialCount,
  renderRow,
}: {
  title: string;
  rows: unknown[];
  empty: string;
  initialCount: number;
  renderRow: (item: unknown, index: number) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, initialCount);
  return (
    <CompactPanel title={title} count={rows.length} empty={empty}>
      <div className="divide-y divide-line/60">{visible.map(renderRow)}</div>
      {rows.length > initialCount && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full border-t border-line/70 px-3 py-2 text-[10px] font-black text-bv-100 hover:bg-bg-soft"
        >
          {expanded ? '간단히 보기' : `나머지 ${rows.length - initialCount}건 펼치기`}
        </button>
      )}
    </CompactPanel>
  );
}

function SavingsRow({ item, kind }: { item: unknown; kind: '예금' | '적금' }) {
  const row = recordValue(item);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-white">{textValue(row.product_name) || `${kind} 상품`}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">{kind} · {shortDate(row.start_date)} → {shortDate(row.maturity_date)}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-black text-bv-100">{statusLabel(row.status)}</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-300">이자 {formatNumber(numberValue(row.interest_paid))}G</div>
      </div>
      {kind === '적금' && (
        <div className="col-span-2 text-[9px] font-semibold text-slate-500">납입 {numberValue(row.paid_rounds)}회 · 미납 {numberValue(row.missed_rounds)}회</div>
      )}
    </div>
  );
}

function LoanRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
      <div>
        <div className="text-xs font-black text-white">{shortDate(row.executed_at)} 이용</div>
        <div className="mt-0.5 text-[9px] font-bold text-slate-400">만기 {shortDate(row.due_date)} · 주간 금리 {percentText(row.weekly_interest_rate)}</div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-black text-bv-100">{statusLabel(row.status)}</div>
        {numberValue(row.overdue_weeks) > 0 && <div className="mt-0.5 text-[9px] font-black text-danger">연체 {numberValue(row.overdue_weeks)}주</div>}
      </div>
    </div>
  );
}

function MarketRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const event = textValue(row.event_type);
  const total = row.total_gold == null ? null : numberValue(row.total_gold);
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-[10px]">
      <div className="font-bold text-slate-400">{shortDateTime(row.created_at)}</div>
      <div className="min-w-0">
        <div className="truncate font-black text-white">{textValue(row.item_name) || '-'}</div>
        <div className="mt-0.5 font-bold text-slate-500">{marketEventLabel(event)} · 수량 {signedNumber(numberValue(row.quantity_delta))}</div>
      </div>
      <div className="text-right font-black text-bv-100">{total == null || total === 0 ? '-' : `${formatNumber(total)}G`}</div>
    </div>
  );
}

function TransactionRow({ item }: { item: unknown }) {
  const row = recordValue(item);
  const amount = numberValue(row.amount);
  const token = textValue(row.token) || '-';
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-[10px]">
      <div className="font-bold text-slate-400">{shortDateTime(row.created_at)}</div>
      <div className="min-w-0">
        <div className="truncate font-black text-white">{sourceTypeLabel(textValue(row.source_type))}</div>
        <div className="mt-0.5 font-bold text-slate-500">
          {numberValue(row.tax_amount) > 0 ? `세금 ${formatNumber(numberValue(row.tax_amount))}G` : '세금 없음'}
          {row.is_reversed === true ? ' · 취소된 기록' : ''}
        </div>
      </div>
      <div className={cn('text-right font-black', amount < 0 ? 'text-danger' : 'text-success')}>
        {amount > 0 ? '+' : ''}{formatNumber(amount)} {token}
      </div>
    </div>
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function nullableNumberText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return formatNumber(numberValue(value));
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function shortDate(value: unknown): string {
  const text = textValue(value);
  if (!text) return '-';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+09:00` : text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function shortDateTime(value: unknown): string {
  const text = textValue(value);
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function signedNumber(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function percentText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const number = numberValue(value);
  return `${number}%`;
}

function statusLabel(value: unknown): string {
  const status = textValue(value).toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: '이용 중',
    MATURED: '만기 완료',
    PAID: '상환 완료',
    OVERDUE: '연체',
    CANCELLED: '취소',
    REJECTED: '거절',
    CLOSED: '종료',
  };
  return labels[status] ?? (status || '-');
}

function marketEventLabel(value: string): string {
  const labels: Record<string, string> = {
    PURCHASE: '구매',
    USE: '사용',
    TEACHER_GRANT: '교사 지급',
    REFUND: '환불',
    CANCEL: '취소',
  };
  return labels[value.toUpperCase()] ?? (value || '-');
}

function sourceTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    DAILY_QUEST: '일일퀘스트',
    TEACHER_GRANT: '교사 지급',
    RAID_REWARD: '레이드 보상',
    DONATION: '기부',
    P2P_SEND: '개인거래 송금',
    P2P_RECEIVE: '개인거래 수신',
    COSMETIC_PURCHASE: '꾸미기 구매',
    MARKET_PURCHASE: '시장 구매',
    AUCTION: '경매',
    ACHIEVEMENT: '업적 보상',
    OTHER: '기타',
  };
  return labels[value.toUpperCase()] ?? (value || '-');
}

function p2pTagLabel(value: string): string {
  const labels: Record<string, string> = {
    NORMAL: '일반 송금',
    GENERAL: '일반 송금',
    GIFT: '선물',
    PAYMENT: '거래 대금',
    SERVICE: '서비스 거래',
    SETTLEMENT: '정산',
  };
  return labels[value.toUpperCase()] ?? (value || '학생 간 송금');
}

function p2pTransferStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    NORMAL: '정상',
    COMPLETED: '완료',
    CANCELLED: '취소',
    REVERSED: '취소됨',
    FAILED: '실패',
  };
  return labels[value.toUpperCase()] ?? (value || '-');
}

function p2pServiceStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    REQUESTED: '요청',
    ACCEPTED: '수락',
    IN_PROGRESS: '진행 중',
    COMPLETED: '완료',
    CANCELLED: '취소',
    REJECTED: '거절',
    DISPUTED: '확인 필요',
  };
  return labels[value.toUpperCase()] ?? (value || '-');
}

function p2pServiceStatusTone(value: string): string {
  const status = value.toUpperCase();
  if (status === 'COMPLETED') return 'text-success';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'text-danger';
  if (status === 'IN_PROGRESS' || status === 'ACCEPTED') return 'text-bv-100';
  return 'text-slate-400';
}

function dailyResult(value: string): DailyResult {
  const normalized = value.toUpperCase();
  if (normalized === 'PASS' || normalized === 'PRESENT' || normalized === 'SUCCESS') return 'PASS';
  if (normalized === 'FAIL' || normalized === 'ABSENT' || normalized === 'FAILED') return 'FAIL';
  return 'UNCHECKED';
}

function attendanceStatus(value: string): DailyResult {
  return dailyResult(value);
}

function primaryJobSubtext(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.daily_wage != null) parts.push(`일급 ${formatNumber(numberValue(row.daily_wage))}G`);
  if (row.assigned_area) parts.push(textValue(row.assigned_area));
  if (row.assigned_at) parts.push(`${shortDate(row.assigned_at)} 시작`);
  return parts.join(' · ');
}

function durationText(milliseconds: number): string {
  if (!milliseconds) return '-';
  if (milliseconds < 1000) return `${formatNumber(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 1 : 2)}초`;
}

function arcadeRunStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    VERIFIED: '공식 인정',
    REJECTED: '인정 제외',
    PENDING: '검토 중',
    SUBMITTED: '제출',
  };
  return labels[value.toUpperCase()] ?? (value || '-');
}

function arcadeOutcomeLabel(value: string): string {
  const labels: Record<string, string> = {
    SUCCESS: '성공',
    PASSED: '성공',
    PASS: '성공',
    FAILED: '실패',
    FAIL: '실패',
    EXPIRED: '종료',
    ACTIVE: '진행 중',
    CLOSED: '종료',
    REJECTED: '실패',
    VERIFIED: '성공',
  };
  return labels[value.toUpperCase()] ?? (value || '-');
}

function guildElementLabel(value: string): string {
  const labels: Record<string, string> = {
    FIRE: '🔥 불',
    WATER: '💧 물',
    WIND: '🌪️ 바람',
    EARTH: '🌿 땅',
    LIGHT: '✨ 빛',
    DARK: '🌑 어둠',
  };
  return labels[value.toUpperCase()] ?? (value || '속성 없음');
}

function acquisitionLabel(value: string): string {
  const labels: Record<string, string> = {
    RECRUIT: '영입',
    TEACHER_GRANT: '교사 지급',
    EVENT: '이벤트',
    EVENT_REWARD: '이벤트',
    REWARD: '보상',
    SHOP: '상점',
    MARKET: '시장',
    AUCTION: '경매',
    NEWBIE_SUPPORT: '정착 지원',
  };
  return labels[value.toUpperCase()] ?? (value || '기록 없음');
}

function RecordGroup({ label, value }: { label: string; value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black text-bv-100">{label}</div>
          <span className="rounded-pill bg-bg-deep px-2 py-0.5 text-[9px] font-black text-slate-300">{value.length}건</span>
        </div>
        {value.length === 0 ? (
          <div className="mt-2 text-xs font-semibold text-slate-400">기록 없음</div>
        ) : (
          <div className="mt-2 space-y-2">
            {value.map((item, index) => <RecordItem key={index} item={item} />)}
          </div>
        )}
      </section>
    );
  }

  if (isRecord(value)) {
    return (
      <section className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="text-xs font-black text-bv-100">{label}</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(value).map(([key, child]) => (
            <RecordField key={key} label={humanize(key)} value={child} />
          ))}
        </div>
      </section>
    );
  }

  return <RecordField label={label} value={value} />;
}

function RecordItem({ item }: { item: unknown }) {
  if (!isRecord(item)) {
    return <div className="rounded-card-sm bg-bg-deep px-3 py-2 text-xs font-semibold text-white">{displayRecordValue(item)}</div>;
  }
  return (
    <div className="rounded-card-md border border-line/70 bg-bg-deep/80 p-3">
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(item).map(([key, value]) => <RecordField key={key} label={humanize(key)} value={value} compact />)}
      </div>
    </div>
  );
}

function RecordField({ label, value, compact = false }: { label: string; value: unknown; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'rounded-card-sm bg-bg-deep px-3 py-2'}>
      <div className="text-[9px] font-black text-slate-400">{label}</div>
      <div className="mt-0.5 break-words text-xs font-bold text-white">{displayRecordValue(value)}</div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  gold: 'GOLD', crystal: 'CRYSTAL', bv: 'BV', total_asset: '총자산', deposit_principal: '예금 원금',
  installment_principal: '적금 원금', outstanding_loan: '미상환 대출', achievement_count: '업적 수', donation_gold: '누적 기부',
  bv_deduction_count: 'BV 차감 건수', credit_score: '신용점수', token: '화폐', amount: '변동액', balance_after: '변동 후 잔액',
  source_type: '원인', tax_amount: '세금', created_at: '기록 시각', is_reversed: '취소됨', product_name: '상품', principal: '원금',
  interest_rate: '금리', start_date: '시작일', maturity_date: '만기일', status: '상태', interest_paid: '이자', direction: '방향',
  counterparty_name: '거래 상대', service_title: '서비스', price_gold: '가격', quantity: '수량', completed_at: '완료 시각', round_number: '경매 회차',
  item_name: '상품', starting_price: '시작가', bid_amount: '입찰가', final_price: '낙찰가', attempt_number: '시도', game_name: '게임',
  official_score: '공식 점수', rank: '순위', achieved_at: '기록 달성 시각', period: '기간', threshold: '인증 기준', success: '인증 성공',
  opportunity: '도전 차수', guild_name: '길드', session_date: '세션 날짜', is_present: '출석', final_contribution: '최종 기여도',
  mission_points: '미션 점수', session_points: '세션 점수', arcade_applied: '아케이드 반영', character_name: '편린', character_uid: '편린 ID',
  acquired_at: '획득일', acquired_via: '획득 경로', collection_uid: '컬렉션 ID', member_count: '구성 편린 수', date: '날짜', quest_date: '날짜',
  quest_code: '퀘스트', result: '결과', check_source: '검사 출처', job_name: '1인1역', assigned_area: '담당 구역', checked_at: '검사 시각',
  teacher_override: '교사 수정', event_type: '이벤트', occurred_at: '시각', signal_count: '접속 신호 수', affinity: '호감도', opened_at: '열람 시각',
  episode_id: '에피소드 ID', affinity_threshold: '호감도 기준', achievement_uid: '업적 ID', name: '이름', grade: '등급',
  rejection_reason: '반려 사유', period_label: '기간', is_winner: '우승', tier: '티어', student_name: '학생', brand_name: '브랜드명', enrolled_at: '등록일',
};

function humanize(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
}

function displayRecordValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'number') return value.toLocaleString('ko-KR');
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(displayRecordValue).join(', ');
  if (isRecord(value)) return Object.entries(value).map(([k, v]) => `${humanize(k)}: ${displayRecordValue(v)}`).join(' · ');
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('ko-KR');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '잠시 후 다시 시도해주세요.';
}
