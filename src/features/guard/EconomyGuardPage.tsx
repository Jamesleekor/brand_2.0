import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Coins,
  Flag,
  History,
  Network,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Tags,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { EmptyState, LoadingSpinner, Modal, PageHeader, useRpcCall } from '@/components/shared/components';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatNumber, formatPercent, getKstDateString } from '@/lib/utils/format';
import { supabase } from '@/lib/supabase/client';
import { economyGuardRpc } from '@/lib/rpc/economy_guard_rpc';
import type {
  EconomyGuardAccess,
  EconomyGuardDashboard,
  EconomyGuardEvent,
  EconomyGuardPenaltyReason,
  EconomyGuardPeriodInput,
  EconomyGuardPeriodKind,
  EconomyGuardSourceKind,
} from '@/lib/zod_schemas/economy_guard_schemas';

const TABS = [
  { id: 'stream', label: '거래 스트리밍', icon: Activity },
  { id: 'category', label: '카테고리 통계', icon: Tags },
  { id: 'network', label: '거래 네트워크', icon: Network },
  { id: 'alerts', label: '이상거래 알림센터', icon: AlertTriangle },
  { id: 'inequality', label: '불평등 지수', icon: Scale },
] as const;

type GuardTab = (typeof TABS)[number]['id'];
type ReviewMode = 'NORMAL' | 'FLAG';

const PERIODS: Array<{ value: EconomyGuardPeriodKind; label: string }> = [
  { value: 'week', label: '이번 주' },
  { value: 'month', label: '이번 달' },
  { value: 'all', label: '전체' },
  { value: 'custom', label: '기간 지정' },
];

const PENALTY_REASONS: EconomyGuardPenaltyReason[] = [
  '사유 허위 기재',
  '실물 거래 의심',
  '강압적 거래',
  '소명 거부',
  '기타',
];

function defaultCustomRange() {
  const end = getKstDateString();
  const endDate = new Date(`${end}T00:00:00+09:00`);
  endDate.setDate(endDate.getDate() - 7);
  return { start: getKstDateString(endDate), end };
}

export default function EconomyGuardPage({ embeddedTeacher = false }: { embeddedTeacher?: boolean }) {
  const queryClient = useQueryClient();
  const capturedSnapshot = useRef(false);
  const [tab, setTab] = useState<GuardTab>('stream');
  const [period, setPeriod] = useState<EconomyGuardPeriodKind>('week');
  const initialRange = useMemo(defaultCustomRange, []);
  const [customStartDraft, setCustomStartDraft] = useState(initialRange.start);
  const [customEndDraft, setCustomEndDraft] = useState(initialRange.end);
  const [customStart, setCustomStart] = useState(initialRange.start);
  const [customEnd, setCustomEnd] = useState(initialRange.end);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const accessQuery = useQuery({
    queryKey: ['economy-guard-access'],
    queryFn: async () => {
      const result = await economyGuardRpc.getAccess(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const periodInput = useMemo<EconomyGuardPeriodInput>(() => ({
    p_period: period,
    p_start_date: period === 'custom' ? customStart : null,
    p_end_date: period === 'custom' ? customEnd : null,
  }), [period, customStart, customEnd]);

  const dashboardQuery = useQuery({
    queryKey: ['economy-guard-dashboard', periodInput],
    enabled: accessQuery.data?.can_access === true,
    queryFn: async () => {
      const result = await economyGuardRpc.getDashboard(supabase, periodInput);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  useEffect(() => {
    if (!accessQuery.data?.can_access || capturedSnapshot.current) return;
    capturedSnapshot.current = true;
    void economyGuardRpc.captureInequalitySnapshot(supabase).then((result) => {
      if (result.success === true) {
        void queryClient.invalidateQueries({ queryKey: ['economy-guard-dashboard'] });
      }
    });
  }, [accessQuery.data?.can_access, queryClient]);

  const refresh = useCallback(async () => {
    if (accessQuery.data?.can_access) {
      await economyGuardRpc.captureInequalitySnapshot(supabase);
    }
    await Promise.all([
      accessQuery.refetch(),
      accessQuery.data?.can_access ? dashboardQuery.refetch() : Promise.resolve(),
    ]);
  }, [accessQuery, dashboardQuery]);

  const applyCustomPeriod = () => {
    if (!customStartDraft || !customEndDraft) {
      setPeriodError('시작일과 종료일을 모두 입력해주세요.');
      return;
    }
    if (customStartDraft > customEndDraft) {
      setPeriodError('시작일은 종료일보다 늦을 수 없습니다.');
      return;
    }
    setPeriodError(null);
    setCustomStart(customStartDraft);
    setCustomEnd(customEndDraft);
  };

  if (accessQuery.isLoading) {
    return <GuardLoading embeddedTeacher={embeddedTeacher} />;
  }

  if (accessQuery.isError || !accessQuery.data) {
    return (
      <GuardFrame embeddedTeacher={embeddedTeacher} title="경제수호대">
        <GuardLoadError
          title="경제수호대 권한을 확인하지 못했습니다"
          message={accessQuery.error instanceof Error ? accessQuery.error.message : '잠시 후 다시 시도해주세요.'}
          onRetry={() => void accessQuery.refetch()}
        />
      </GuardFrame>
    );
  }

  if (!accessQuery.data.can_access) {
    return <NoGuardAccess access={accessQuery.data} embeddedTeacher={embeddedTeacher} />;
  }

  return (
    <GuardFrame
      embeddedTeacher={embeddedTeacher}
      title="경제수호대"
      right={
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex h-9 items-center gap-1.5 rounded-pill border border-line bg-bg-card px-3 text-xs font-black text-text-secondary transition hover:border-gold/30 hover:text-white"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', dashboardQuery.isFetching && 'animate-spin')} />
          새로고침
        </button>
      }
    >
      <div className="space-y-4">
        <GuardHero access={accessQuery.data} dashboard={dashboardQuery.data ?? null} />
        <PeriodBar
          period={period}
          onPeriod={setPeriod}
          customStart={customStartDraft}
          customEnd={customEndDraft}
          onCustomStart={setCustomStartDraft}
          onCustomEnd={setCustomEndDraft}
          onApplyCustom={applyCustomPeriod}
          error={periodError}
          periodLabel={dashboardQuery.data?.period.label}
        />

        {dashboardQuery.isError ? (
          <GuardLoadError
            title="경제수호대 대시보드를 불러오지 못했습니다"
            message={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : '잠시 후 다시 시도해주세요.'}
            onRetry={() => void dashboardQuery.refetch()}
          />
        ) : dashboardQuery.isLoading || !dashboardQuery.data ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-card-xl border border-line bg-bg-card">
            <div className="text-center">
              <LoadingSpinner size="lg" />
              <p className="mt-3 text-sm font-bold text-text-secondary">경제 흐름을 분석하는 중...</p>
            </div>
          </div>
        ) : (
          <GuardDashboard
            dashboard={dashboardQuery.data}
            tab={tab}
            onTab={setTab}
            onRefresh={() => void dashboardQuery.refetch()}
          />
        )}
      </div>
    </GuardFrame>
  );
}

function GuardFrame({
  embeddedTeacher,
  title,
  right,
  children,
}: {
  embeddedTeacher: boolean;
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  if (embeddedTeacher) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-gold" />
              <h1 className="font-display text-2xl text-brand-gradient">{title}</h1>
            </div>
            <p className="mt-1 text-sm font-bold text-text-secondary">공식 경제 흐름과 이상거래를 감독합니다.</p>
          </div>
          {right}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PageHeader title={title} emoji="🛡️" right={right} />
      <main className="mx-auto max-w-7xl px-4 pb-10 pt-4">{children}</main>
    </div>
  );
}

function GuardLoading({ embeddedTeacher }: { embeddedTeacher: boolean }) {
  return (
    <GuardFrame embeddedTeacher={embeddedTeacher} title="경제수호대">
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-3 text-sm font-bold text-text-secondary">수호대 권한을 확인하는 중...</p>
        </div>
      </div>
    </GuardFrame>
  );
}

function NoGuardAccess({ access, embeddedTeacher }: { access: EconomyGuardAccess; embeddedTeacher: boolean }) {
  const reason = access.reason === 'NO_ACTIVE_GUARD_TERM'
    ? '현재 활성화된 경제수호대 임기가 없습니다.'
    : access.reason === 'CLASSROOM_UNAVAILABLE'
      ? '감독할 학급 정보를 확인할 수 없습니다.'
      : '경제수호대 접근 권한이 없습니다.';

  return (
    <GuardFrame embeddedTeacher={embeddedTeacher} title="경제수호대">
      <div className="rounded-card-xl border border-line bg-bg-card p-6 text-center shadow-card">
        <div className="text-5xl">🛡️</div>
        <h2 className="mt-3 font-display text-xl text-white">수호대 전용 구역입니다</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-relaxed text-text-secondary">{reason}</p>
        <div className="mx-auto mt-4 inline-flex rounded-pill border border-line bg-bg-deep px-3 py-1 text-2xs font-black text-text-muted">
          {access.reason}
        </div>
      </div>
    </GuardFrame>
  );
}

function GuardLoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-card-xl border border-danger/30 bg-danger-bg p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-danger" />
      <h2 className="mt-2 font-display text-lg text-white">{title}</h2>
      <p className="mt-1 text-sm font-bold text-text-secondary">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-4">다시 시도</button>
    </div>
  );
}

function GuardHero({ access, dashboard }: { access: EconomyGuardAccess; dashboard: EconomyGuardDashboard | null }) {
  const badge = access.is_teacher ? '교사 감독 권한' : access.role_type === 'CHIEF' ? '경제수호대 대장' : '경제수호대 대원';
  const openAlerts = dashboard?.stats.suspect_count ?? 0;

  return (
    <section className="relative overflow-hidden rounded-card-xl border border-gold/25 bg-gradient-to-br from-brand-primary/20 via-bg-card to-gold/10 p-5 shadow-card">
      <div className="pointer-events-none absolute -right-6 -top-12 text-[140px] opacity-[0.06]">🛡️</div>
      <div className="relative grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-black text-gold">
              <ShieldCheck className="h-3.5 w-3.5" /> {badge}
            </span>
            {dashboard && (
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-black',
                openAlerts > 0 ? 'border-danger/30 bg-danger-bg text-danger' : 'border-success/30 bg-success-bg text-success',
              )}>
                <AlertTriangle className="h-3.5 w-3.5" /> 열린 알림 {openAlerts}건
              </span>
            )}
          </div>
          <h2 className="mt-3 font-display text-2xl text-white">B.R.A.N.D 경제 감시실</h2>
          <p className="mt-1 max-w-2xl text-sm font-bold leading-relaxed text-text-secondary">
            학생 간 직접거래와 2차직업 서비스를 하나의 경제 흐름으로 감시합니다. 환불·회수된 기록은 역사로 남기되 현재 통계를 부풀리지 않습니다.
          </p>
          {access.is_teacher && (
            <Link to="/teacher/operations#economy-guard" className="mt-3 inline-flex items-center gap-1.5 rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-black text-gold transition hover:bg-gold/15">
              <ShieldCheck className="h-3.5 w-3.5" /> 수호대 임명·관리 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        {dashboard && (
          <div className="grid grid-cols-2 gap-2 sm:min-w-[280px]">
            <MiniMetric label="유효 경제행위" value={`${formatNumber(dashboard.stats.total_count)}건`} />
            <MiniMetric label="유효 거래액" value={`${formatNumber(dashboard.stats.total_amount)} G`} />
          </div>
        )}
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-black/20 px-3 py-2.5 text-center">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-black text-gold">{value}</div>
    </div>
  );
}

function PeriodBar({
  period,
  onPeriod,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
  onApplyCustom,
  error,
  periodLabel,
}: {
  period: EconomyGuardPeriodKind;
  onPeriod: (value: EconomyGuardPeriodKind) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
  onApplyCustom: () => void;
  error: string | null;
  periodLabel?: string;
}) {
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Clock3 className="h-4 w-4 text-text-muted" />
        {PERIODS.map((item) => (
          <button
            type="button"
            key={item.value}
            onClick={() => onPeriod(item.value)}
            className={cn(
              'rounded-pill border px-3 py-1.5 text-xs font-black transition',
              period === item.value
                ? 'border-line-brand bg-brand-primary/15 text-gold'
                : 'border-line bg-bg-deep text-text-secondary hover:text-white',
            )}
          >
            {item.label}
          </button>
        ))}
        {periodLabel && <span className="ml-auto text-2xs font-bold text-text-muted">현재 조회 · {periodLabel}</span>}
      </div>
      {period === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="min-w-[150px] flex-1">
            <span className="mb-1 block text-2xs font-black text-text-muted">시작일</span>
            <input type="date" className="input-field w-full" value={customStart} onChange={(e) => onCustomStart(e.target.value)} />
          </label>
          <label className="min-w-[150px] flex-1">
            <span className="mb-1 block text-2xs font-black text-text-muted">종료일</span>
            <input type="date" className="input-field w-full" value={customEnd} onChange={(e) => onCustomEnd(e.target.value)} />
          </label>
          <button type="button" className="btn-primary h-[42px]" onClick={onApplyCustom}>기간 적용</button>
          {error && <div className="w-full text-xs font-bold text-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}

function GuardDashboard({
  dashboard,
  tab,
  onTab,
  onRefresh,
}: {
  dashboard: EconomyGuardDashboard;
  tab: GuardTab;
  onTab: (tab: GuardTab) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <SummaryGrid dashboard={dashboard} />
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card-lg border border-line bg-bg-card px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black text-gold"><ShieldCheck className="h-4 w-4" /> AI 심층 브리핑</div>
          <p className="mt-1 text-2xs font-bold text-text-muted">추후 ChatGPT API를 연결해 기간 내 거래 흐름·이상징후·불평등 변화를 종합 분석합니다.</p>
        </div>
        <span className="shrink-0 rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-2xs font-black text-text-muted">준비 중</span>
      </section>
      <div className="overflow-x-auto rounded-card-lg border border-line bg-bg-card p-1.5">
        <div className="flex min-w-max gap-1">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            const badge = item.id === 'alerts' ? dashboard.stats.suspect_count : undefined;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => onTab(item.id)}
                className={cn(
                  'relative flex items-center gap-2 rounded-card-md px-3 py-2 text-xs font-black transition',
                  active ? 'bg-gradient-to-r from-brand-primary/20 to-gold/10 text-gold' : 'text-text-secondary hover:bg-bg-deep hover:text-white',
                )}
              >
                <Icon className="h-4 w-4" /> {item.label}
                {badge !== undefined && badge > 0 && (
                  <span className="rounded-pill bg-danger px-1.5 py-0.5 text-[9px] text-white">{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'stream' && <StreamTab dashboard={dashboard} />}
      {tab === 'category' && <CategoryTab dashboard={dashboard} />}
      {tab === 'network' && <NetworkTab dashboard={dashboard} />}
      {tab === 'alerts' && <AlertCenterTab dashboard={dashboard} onRefresh={onRefresh} />}
      {tab === 'inequality' && <InequalityTab dashboard={dashboard} />}
    </>
  );
}

function SummaryGrid({ dashboard }: { dashboard: EconomyGuardDashboard }) {
  const items = [
    { icon: Activity, label: '유효 경제행위', value: `${formatNumber(dashboard.stats.total_count)}건`, sub: `전체 기록 ${formatNumber(dashboard.stats.visible_count)}건`, tone: 'text-bv' },
    { icon: Coins, label: '유효 거래액', value: `${formatNumber(dashboard.stats.total_amount)} G`, sub: `정산/직접 ${formatNumber(dashboard.stats.settled_amount)} G`, tone: 'text-gold' },
    { icon: WalletCards, label: '에스크로 보류', value: `${formatNumber(dashboard.stats.escrow_held_amount)} G`, sub: '진행 중 서비스', tone: 'text-warning' },
    { icon: AlertTriangle, label: '재검토 필요', value: `${formatNumber(dashboard.stats.suspect_count)}건`, sub: '현재 열린 알림', tone: dashboard.stats.suspect_count ? 'text-danger' : 'text-success' },
    { icon: Flag, label: '최종 적발', value: `${formatNumber(dashboard.stats.final_count)}건`, sub: '감사 기록 보존', tone: 'text-danger' },
    { icon: History, label: '환불·회수', value: `${formatNumber(dashboard.stats.refunded_count + dashboard.stats.reversed_count)}건`, sub: `환불 ${dashboard.stats.refunded_count} · 회수 ${dashboard.stats.reversed_count}`, tone: 'text-text-secondary' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map(({ icon: Icon, label, value, sub, tone }) => (
        <div key={label} className="rounded-card-lg border border-line bg-bg-card p-3 shadow-card">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-text-muted">
            <Icon className={cn('h-3.5 w-3.5', tone)} /> {label}
          </div>
          <div className={cn('mt-2 font-mono text-xl font-black', tone)}>{value}</div>
          <div className="mt-1 text-2xs font-bold text-text-muted">{sub}</div>
        </div>
      ))}
    </div>
  );
}

function StreamTab({ dashboard }: { dashboard: EconomyGuardDashboard }) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'ALL' | EconomyGuardSourceKind>('ALL');
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return dashboard.events.filter((event) => {
      if (source !== 'ALL' && event.source_kind !== source) return false;
      if (!needle) return true;
      return [
        event.sender_name,
        event.sender_brand_name,
        event.receiver_name,
        event.receiver_brand_name,
        event.tag,
        event.description,
        event.event_key,
      ].some((value) => (value ?? '').toLowerCase().includes(needle));
    });
  }, [dashboard.events, search, source]);

  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-4">
      <SectionTitle icon={<Activity className="h-4 w-4" />} title="거래 스트리밍" description="P2P와 2차직업 서비스 주문을 발생 시각 기준으로 함께 봅니다." />
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input className="input-field w-full pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·브랜드·태그·내용 검색" />
        </div>
        <select className="input-field" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="ALL">전체 출처</option>
          <option value="P2P_TRANSFER">직접거래</option>
          <option value="SERVICE_ORDER">2차직업 서비스</option>
        </select>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {filtered.length === 0 ? (
          <div className="md:col-span-2 lg:col-span-3 2xl:col-span-4"><EmptyState emoji="📭" title="표시할 경제행위가 없습니다" description="기간이나 검색 조건을 바꿔보세요." /></div>
        ) : filtered.map((event) => <EventRow key={event.event_key} event={event} compact />)}
      </div>
    </section>
  );
}

function CategoryTab({ dashboard }: { dashboard: EconomyGuardDashboard }) {
  const maxCount = Math.max(1, ...dashboard.stats.tag_stats.map((item) => item.count));
  const tradeRows = dashboard.stats.student_trade_stats;
  const categories = dashboard.stats.service_category_stats;
  const categoryReady = categories.some((item) => item.available);

  return (
    <div className="space-y-4">
      <section className="rounded-card-xl border border-line bg-bg-card p-4">
        <SectionTitle
          icon={<WalletCards className="h-4 w-4" />}
          title="학생별 구매·판매 현황"
          description="선택한 기간의 공식 참가자 전원을 기준으로 구매와 판매 건수·금액을 집계합니다. 환불·회수된 거래는 유효 통계에서 제외합니다."
        />
        <div className="mt-3 overflow-x-auto rounded-card-lg border border-line">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-bg-deep text-2xs font-black text-text-muted">
              <tr>
                <th className="px-3 py-2.5">학생</th>
                <th className="px-3 py-2.5 text-right">구매 건수</th>
                <th className="px-3 py-2.5 text-right">구매 금액</th>
                <th className="px-3 py-2.5 text-right">판매 건수</th>
                <th className="px-3 py-2.5 text-right">판매 금액</th>
                <th className="px-3 py-2.5 text-right">서비스 구매</th>
                <th className="px-3 py-2.5 text-right">서비스 판매</th>
              </tr>
            </thead>
            <tbody>
              {tradeRows.map((row) => (
                <tr key={row.student_id} className="border-t border-line bg-bg-card hover:bg-bg-deep/60">
                  <td className="px-3 py-2.5">
                    <StudentStatIdentity name={row.name} brandName={row.brand_name} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-black text-text-primary">{formatNumber(row.buy_count)}건</td>
                  <td className="px-3 py-2.5 text-right font-mono font-black text-gold">{formatNumber(row.buy_amount)} G</td>
                  <td className="px-3 py-2.5 text-right font-mono font-black text-text-primary">{formatNumber(row.sell_count)}건</td>
                  <td className="px-3 py-2.5 text-right font-mono font-black text-gold">{formatNumber(row.sell_amount)} G</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-mono font-black text-text-secondary">{formatNumber(row.service_buy_count)}건</div>
                    <div className="text-[10px] font-bold text-text-muted">{formatNumber(row.service_buy_amount)} G</div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-mono font-black text-text-secondary">{formatNumber(row.service_sell_count)}건</div>
                    <div className="text-[10px] font-bold text-text-muted">{formatNumber(row.service_sell_amount)} G</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ServiceRankingCard
          title="서비스 판매 수익 TOP"
          description="정산 완료된 2차직업 서비스 판매대금 기준"
          rows={dashboard.stats.service_top_earners}
          emptyTitle="정산 완료된 서비스 판매가 없습니다"
        />
        <ServiceRankingCard
          title="서비스 구매 지출 TOP"
          description="정산 완료된 2차직업 서비스 구매대금 기준"
          rows={dashboard.stats.service_top_spenders}
          emptyTitle="정산 완료된 서비스 구매가 없습니다"
        />
      </div>

      <section className="rounded-card-xl border border-line bg-bg-card p-4">
        <SectionTitle
          icon={<Tags className="h-4 w-4" />}
          title="2차직업 서비스 카테고리"
          description="서비스 등록 카테고리가 연결되면 청소·학습·제작·1인1역·생활도움·기타별 주문 수, 거래액, 구매자·판매자 수를 자동 집계합니다."
        />
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {categories.map((item) => (
            <div key={item.category} className="rounded-card-md border border-line bg-bg-deep p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-text-primary">{item.category}</span>
                <span className={cn(
                  'rounded-pill border px-2 py-0.5 text-[9px] font-black',
                  item.available ? 'border-success/30 bg-success-bg text-success' : 'border-line bg-bg-card text-text-muted',
                )}>
                  {item.available ? '집계 중' : '준비 중'}
                </span>
              </div>
              <div className="mt-3 font-mono text-lg font-black text-gold">{formatNumber(item.amount)} G</div>
              <div className="mt-1 text-[10px] font-bold text-text-muted">
                {item.order_count}건 · 구매자 {item.buyer_count}명 · 판매자 {item.seller_count}명
              </div>
            </div>
          ))}
        </div>
        {!categoryReady && (
          <div className="mt-3 rounded-card-sm border border-dashed border-line bg-bg-deep px-3 py-2 text-2xs font-bold text-text-muted">
            현재 서비스 주문에는 카테고리 snapshot이 아직 없습니다. 서비스 등록 기능에 카테고리가 추가되면 같은 통계 계약으로 즉시 집계되도록 준비되어 있습니다.
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-card-xl border border-line bg-bg-card p-4">
          <SectionTitle icon={<Tags className="h-4 w-4" />} title="거래 태그별 현황" description="현재 P2P 태그와 서비스 기본 태그를 기준으로 거래 구성을 확인합니다." />
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {dashboard.stats.tag_stats.length === 0 ? <EmptyState title="태그 데이터가 없습니다" /> : dashboard.stats.tag_stats.map((item) => (
              <div key={item.tag}>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-sm font-black text-text-primary">{item.tag}</div>
                    <div className="text-2xs font-bold text-text-muted">수량 {formatNumber(item.quantity)} · 평균 {formatNumber(Math.round(item.unit_price))} G</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-black text-gold">{formatNumber(item.amount)} G</div>
                    <div className="text-2xs font-bold text-text-muted">{item.count}건</div>
                  </div>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-bg-deep">
                  <div className="h-full rounded-pill bg-gradient-to-r from-brand-primary to-gold" style={{ width: `${Math.max(4, (item.count / maxCount) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-card-xl border border-line bg-bg-card p-4">
            <SectionTitle icon={<WalletCards className="h-4 w-4" />} title="출처별 비중" description="직접거래와 서비스 경제 사용량을 비교합니다." />
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {dashboard.stats.source_stats.map((item) => (
                <div key={item.source_kind} className="rounded-card-md border border-line bg-bg-deep p-3">
                  <SourceBadge source={item.source_kind} />
                  <div className="mt-2 font-mono text-xl font-black text-gold">{formatNumber(item.effective_amount)} G</div>
                  <div className="mt-1 text-xs font-bold text-text-secondary">유효 {item.effective_count}건 · 기록 {item.visible_count}건</div>
                  <div className="mt-1 text-2xs font-black text-danger">열린 알림 {item.open_alert_count}건</div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-card-xl border border-line bg-bg-card p-4">
            <SectionTitle icon={<Clock3 className="h-4 w-4" />} title="날짜별 활동" description="선택 기간 안에서 거래가 몰린 날을 확인합니다." />
            <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
              {dashboard.stats.date_stats.slice(-14).map((item) => (
                <div key={item.date} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-card-sm border border-line bg-bg-deep px-3 py-2">
                  <span className="text-xs font-black text-text-secondary">{item.date}</span>
                  <span className="text-xs font-bold text-text-muted">{item.count}건</span>
                  <span className="font-mono text-xs font-black text-gold">{formatNumber(item.amount)} G</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StudentStatIdentity({ name, brandName }: { name: string; brandName: string | null }) {
  return (
    <div className="min-w-[120px]">
      <div className="font-black text-text-primary">{name}</div>
      {brandName && <div className="mt-0.5 text-[10px] font-bold text-text-muted">{brandName}</div>}
    </div>
  );
}

function ServiceRankingCard({
  title,
  description,
  rows,
  emptyTitle,
}: {
  title: string;
  description: string;
  rows: EconomyGuardDashboard['stats']['service_top_earners'];
  emptyTitle: string;
}) {
  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-4">
      <SectionTitle icon={<Coins className="h-4 w-4" />} title={title} description={description} />
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <EmptyState title={emptyTitle} /> : rows.map((row, index) => (
          <div key={row.student_id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-card-md border border-line bg-bg-deep px-3 py-2.5">
            <span className="font-mono text-xs font-black text-text-muted">#{index + 1}</span>
            <StudentStatIdentity name={row.name} brandName={row.brand_name} />
            <div className="text-right">
              <div className="font-mono text-sm font-black text-gold">{formatNumber(row.total)} G</div>
              <div className="text-[10px] font-bold text-text-muted">{row.count}건</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NetworkTab({ dashboard }: { dashboard: EconomyGuardDashboard }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <section className="rounded-card-xl border border-line bg-bg-card p-4">
        <SectionTitle icon={<Network className="h-4 w-4" />} title="거래 네트워크" description="같은 구매자→판매자 방향의 P2P와 서비스 거래를 한 연결선으로 합칩니다." />
        <div className="mt-4"><NetworkGraph dashboard={dashboard} /></div>
      </section>
      <section className="rounded-card-xl border border-line bg-bg-card p-4">
        <SectionTitle icon={<ArrowRight className="h-4 w-4" />} title="강한 연결" description="횟수와 거래액이 큰 연결부터 표시합니다." />
        <div className="mt-3 space-y-2">
          {dashboard.network.edges.slice(0, 12).map((edge, idx) => (
            <div key={`${edge.from_student_id}:${edge.to_student_id}`} className="rounded-card-md border border-line bg-bg-deep p-3">
              <div className="flex items-center gap-2 text-sm font-black text-text-primary">
                <span className="text-2xs text-text-muted">#{idx + 1}</span>
                <span className="truncate">{edge.from_name}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="truncate">{edge.to_name}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-2xs font-bold text-text-muted">
                <span>{edge.count}회 · {formatNumber(edge.total)} G</span>
                {edge.p2p_count > 0 && <span className="rounded-pill border border-bv/30 bg-bv/10 px-2 py-0.5 text-bv">P2P {edge.p2p_count}</span>}
                {edge.service_count > 0 && <span className="rounded-pill border border-gold/30 bg-gold/10 px-2 py-0.5 text-gold">서비스 {edge.service_count}</span>}
              </div>
            </div>
          ))}
          {dashboard.network.edges.length === 0 && <EmptyState emoji="🕸️" title="연결 데이터가 없습니다" />}
        </div>
      </section>
    </div>
  );
}

function NetworkGraph({ dashboard }: { dashboard: EconomyGuardDashboard }) {
  const nodes = dashboard.network.nodes.slice(0, 24);
  if (nodes.length === 0) return <EmptyState emoji="🕸️" title="표시할 네트워크가 없습니다" />;

  const width = 720;
  const height = 460;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.37;
  const maxActivity = Math.max(1, ...nodes.map((node) => node.total_activity));
  const nodeIds = new Set(nodes.map((node) => node.student_id));
  const positions = new Map(nodes.map((node, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / nodes.length;
    return [node.student_id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }] as const;
  }));
  const edges = dashboard.network.edges.filter((edge) => nodeIds.has(edge.from_student_id) && nodeIds.has(edge.to_student_id));
  const maxEdge = Math.max(1, ...edges.map((edge) => edge.count));

  return (
    <div className="overflow-x-auto rounded-card-lg border border-line bg-bg-deep p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[620px] w-full" role="img" aria-label="학생 거래 네트워크">
        <defs>
          <marker id="guard-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-text-muted" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = positions.get(edge.from_student_id)!;
          const to = positions.get(edge.to_student_id)!;
          return (
            <line
              key={`${edge.from_student_id}:${edge.to_student_id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="stroke-text-muted/35"
              strokeWidth={1 + (edge.count / maxEdge) * 4}
              markerEnd="url(#guard-arrow)"
            />
          );
        })}
        {nodes.map((node) => {
          const pos = positions.get(node.student_id)!;
          const size = 14 + (node.total_activity / maxActivity) * 11;
          const label = node.brand_name || node.name;
          return (
            <g key={node.student_id}>
              <circle cx={pos.x} cy={pos.y} r={size} className={cn(node.final_flagged ? 'fill-danger/70 stroke-danger' : 'fill-brand-primary/60 stroke-gold/70')} strokeWidth="2" />
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" className="fill-white text-[10px] font-black">{label.slice(0, 5)}</text>
            </g>
          );
        })}
      </svg>
      <div className="px-2 pb-1 text-2xs font-bold text-text-muted">원 크기는 활동량, 선 굵기는 같은 방향 거래 횟수를 나타냅니다. 화살표는 구매자/지급자 → 판매자/수취인 방향입니다.</div>
    </div>
  );
}

function AlertCenterTab({ dashboard, onRefresh }: { dashboard: EconomyGuardDashboard; onRefresh: () => void }) {
  const [reviewEvent, setReviewEvent] = useState<EconomyGuardEvent | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('NORMAL');
  const openAlerts = dashboard.events.filter((event) => event.is_open_alert);
  const finalFlags = dashboard.events.filter((event) => event.penalty !== null);
  const stale = openAlerts.filter((event) => event.review_is_stale);

  const openReview = (event: EconomyGuardEvent, mode: ReviewMode) => {
    setReviewEvent(event);
    setReviewMode(mode);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <AlertMetric label="열린 알림" value={openAlerts.length} tone="danger" />
        <AlertMetric label="재검토" value={stale.length} tone="warning" />
        <AlertMetric label="최종 적발" value={finalFlags.length} tone="muted" />
      </div>

      <section className="rounded-card-xl border border-line bg-bg-card p-4">
        <SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title="처리 대기" description="자동 감지는 판정이 아닙니다. 사건 내용을 확인한 뒤 정상 또는 최종 적발로 기록하세요." />
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {openAlerts.length === 0 ? (
            <div className="lg:col-span-2"><EmptyState emoji="✅" title="열린 이상거래가 없습니다" description="새 거래가 생기면 30초 이내 자동으로 다시 확인합니다." /></div>
          ) : openAlerts.map((event) => (
            <div key={event.event_key} className={cn('flex h-full flex-col rounded-card-lg border p-3', event.review_is_stale ? 'border-warning/35 bg-warning-bg' : 'border-danger/25 bg-bg-deep')}>
              <EventRow event={event} compact embedded />
              <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-3">
                <button type="button" onClick={() => openReview(event, 'NORMAL')} className="btn-secondary inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap">
                  <CheckCircle2 className="h-4 w-4" /> 정상 확인
                </button>
                <button type="button" onClick={() => openReview(event, 'FLAG')} className="btn-danger inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap">
                  <Flag className="h-4 w-4" /> 최종 적발
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {finalFlags.length > 0 && (
        <section className="rounded-card-xl border border-line bg-bg-card p-4">
          <SectionTitle icon={<History className="h-4 w-4" />} title="최종 적발 기록" description="최종 판정은 원거래나 자산을 자동으로 변경하지 않고 감사 이력으로 보존됩니다." />
          <div className="mt-3 grid gap-2 lg:grid-cols-2">{finalFlags.slice(0, 30).map((event) => <EventRow key={event.event_key} event={event} compact />)}</div>
        </section>
      )}

      <ReviewModal
        event={reviewEvent}
        mode={reviewMode}
        onClose={() => setReviewEvent(null)}
        onDone={() => {
          setReviewEvent(null);
          onRefresh();
        }}
      />
    </div>
  );
}

function AlertMetric({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'warning' | 'muted' }) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text-secondary';
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-3 text-center">
      <div className={cn('font-mono text-2xl font-black', toneClass)}>{value}</div>
      <div className="mt-0.5 text-2xs font-black text-text-muted">{label}</div>
    </div>
  );
}

function ReviewModal({ event, mode, onClose, onDone }: { event: EconomyGuardEvent | null; mode: ReviewMode; onClose: () => void; onDone: () => void }) {
  const [memo, setMemo] = useState('');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [reason, setReason] = useState<EconomyGuardPenaltyReason>('사유 허위 기재');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const { call, isLoading } = useRpcCall();

  useEffect(() => {
    setMemo('');
    setReason('사유 허위 기재');
    setSubjectId(event?.sender_id ?? null);
    setInlineError(null);
  }, [event, mode]);

  if (!event) return null;

  const submit = async () => {
    setInlineError(null);
    if (mode === 'FLAG' && !subjectId) {
      setInlineError('최종 적발 대상 학생을 선택해주세요.');
      return;
    }
    if (mode === 'FLAG' && reason === '기타' && memo.trim().length < 2) {
      setInlineError('기타 사유는 2자 이상의 메모가 필요합니다.');
      return;
    }

    const result = mode === 'NORMAL'
      ? await call(
          () => economyGuardRpc.markNormal(supabase, {
            p_source_kind: event.source_kind,
            p_source_id: event.source_id,
            p_memo: memo.trim() || null,
          }),
          {
            successTitle: '정상 거래로 확인했습니다',
            successDescription: event.review_is_stale ? '현재 근거를 기준으로 재검토를 완료했습니다.' : '해당 알림을 닫았습니다.',
            onError: setInlineError,
          },
        )
      : await call(
          () => economyGuardRpc.flagEvent(supabase, {
            p_source_kind: event.source_kind,
            p_source_id: event.source_id,
            p_subject_student_id: subjectId!,
            p_reason: reason,
            p_memo: memo.trim() || null,
          }),
          {
            successTitle: '최종 적발로 기록했습니다',
            successDescription: '감사 이력과 대상 학생 통보가 기록되었습니다.',
            onError: setInlineError,
          },
        );

    if (result) onDone();
  };

  return (
    <Modal isOpen onClose={() => { if (!isLoading) onClose(); }} title={mode === 'NORMAL' ? '정상 거래 확인' : '최종 적발 판정'} emoji={mode === 'NORMAL' ? '✅' : '🚨'} size="lg">
      <div className="space-y-4">
        <div className="rounded-card-md border border-line bg-bg-deep p-3">
          <div className="flex flex-wrap items-center gap-2"><SourceBadge source={event.source_kind} /><StateBadge event={event} /></div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
            <StudentIdentity name={event.sender_name} brandName={event.sender_brand_name} />
            <ArrowRight className="h-4 w-4 text-text-muted" />
            <StudentIdentity name={event.receiver_name} brandName={event.receiver_brand_name} />
            <span className="font-mono text-sm font-black text-gold">{formatNumber(event.amount)} G</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">{event.anomaly_reasons.map((item) => <AnomalyBadge key={item} text={item} />)}</div>
          {event.review_is_stale && <div className="mt-2 rounded-card-sm border border-warning/30 bg-warning-bg px-3 py-2 text-xs font-black text-warning">이 사건은 이전 정상판정 이후 근거가 바뀌어 재검토가 필요합니다.</div>}
        </div>

        {mode === 'FLAG' && (
          <>
            <div>
              <div className="mb-2 text-xs font-black text-text-secondary">적발 대상</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: event.sender_id, label: event.sender_name, brandName: event.sender_brand_name, role: '구매자·지급자' },
                  { id: event.receiver_id, label: event.receiver_name, brandName: event.receiver_brand_name, role: '판매자·수취인' },
                ].map((person) => (
                  <button
                    type="button"
                    key={person.id}
                    onClick={() => setSubjectId(person.id)}
                    className={cn('rounded-card-md border p-3 text-left transition', subjectId === person.id ? 'border-danger/50 bg-danger-bg' : 'border-line bg-bg-deep')}
                  >
                    <div className="text-sm font-black text-text-primary">{person.label}</div>
                    {person.brandName && <div className="mt-0.5 truncate text-[10px] font-bold text-text-muted">{person.brandName}</div>}
                    <div className="mt-0.5 text-2xs font-bold text-text-muted">{person.role}</div>
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black text-text-secondary">최종 적발 사유</span>
              <select className="input-field w-full" value={reason} onChange={(e) => setReason(e.target.value as EconomyGuardPenaltyReason)}>
                {PENALTY_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-black text-text-secondary">판정 메모 {mode === 'FLAG' && reason === '기타' ? '· 필수' : '· 선택'}</span>
          <textarea className="input-field min-h-[100px] w-full resize-none" maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="확인한 내용이나 소명 결과를 기록하세요." />
          <div className="mt-1 text-right text-2xs font-bold text-text-muted">{memo.length}/500</div>
        </label>

        {inlineError && <div className="rounded-card-md border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{inlineError}</div>}

        <div className="flex gap-2">
          <button type="button" disabled={isLoading} onClick={onClose} className="btn-secondary flex-1">취소</button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void submit()}
            className={cn('flex-1', mode === 'NORMAL' ? 'btn-primary' : 'btn-danger')}
          >
            {isLoading ? '처리 중...' : mode === 'NORMAL' ? '정상 확인 확정' : '최종 적발 확정'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InequalityTab({ dashboard }: { dashboard: EconomyGuardDashboard }) {
  const inequality = dashboard.inequality;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <InequalityMetric label="GOLD 지니계수" value={inequality.gini_gold.toFixed(3)} hint={giniLabel(inequality.gini_gold)} />
        <InequalityMetric label="BV 지니계수" value={inequality.gini_bv.toFixed(3)} hint={giniLabel(inequality.gini_bv)} />
        <InequalityMetric label="상위 20% GOLD" value={formatPercent(inequality.top20_gold_share, 1)} hint="전체 GOLD 점유율" />
        <InequalityMetric label="공식 참가자" value={`${inequality.student_count}명`} hint={`총 ${formatNumber(inequality.total_gold)} GOLD`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-card-xl border border-line bg-bg-card p-4">
          <SectionTitle icon={<Scale className="h-4 w-4" />} title="GOLD 로렌츠 곡선" description="대각선에 가까울수록 자산 분포가 균등합니다." />
          <div className="mt-4"><LorenzChart points={inequality.lorenz} /></div>
        </section>
        <section className="rounded-card-xl border border-line bg-bg-card p-4">
          <SectionTitle icon={<Coins className="h-4 w-4" />} title="현재 GOLD 순위" description="Live Test Agent는 공식 통계에서 제외됩니다." />
          <div className="mt-3 max-h-[390px] space-y-1.5 overflow-y-auto pr-1">
            {inequality.ranked.map((row) => (
              <div key={row.student_id} className="grid grid-cols-[36px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-card-sm border border-line bg-bg-deep px-3 py-2">
                <span className="font-mono text-xs font-black text-text-muted">#{row.rank}</span>
                <span className="truncate text-xs font-black text-text-primary">{displayName(row.name, row.brand_name)}</span>
                <span className="font-mono text-xs font-black text-gold">{formatNumber(row.gold)} G</span>
                <span className="hidden font-mono text-2xs font-bold text-bv sm:block">{formatNumber(row.bv)} BV</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-card-xl border border-line bg-bg-card p-4">
        <SectionTitle icon={<History className="h-4 w-4" />} title="불평등 스냅샷" description="대시보드 진입 또는 수동 새로고침 시 하루 한 번의 스냅샷을 보존합니다." />
        {inequality.history.length === 0 ? (
          <EmptyState emoji="📈" title="아직 저장된 스냅샷이 없습니다" description="첫 진입 시 오늘 스냅샷이 생성됩니다." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-2xs font-black uppercase tracking-wider text-text-muted"><tr><th className="px-2 py-2">날짜</th><th className="px-2 py-2">GOLD Gini</th><th className="px-2 py-2">BV Gini</th><th className="px-2 py-2">상위20% GOLD</th></tr></thead>
              <tbody>{inequality.history.map((row) => <tr key={row.snapshot_date} className="border-t border-line"><td className="px-2 py-2 font-black text-text-secondary">{row.snapshot_date}</td><td className="px-2 py-2 font-mono text-gold">{row.gini_gold.toFixed(3)}</td><td className="px-2 py-2 font-mono text-bv">{row.gini_bv.toFixed(3)}</td><td className="px-2 py-2 font-mono text-text-primary">{formatPercent(row.top20_gold_share, 1)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function LorenzChart({ points }: { points: EconomyGuardDashboard['inequality']['lorenz'] }) {
  const safePoints = (points.length ? points : [{ population_share: 0, asset_share: 0 }, { population_share: 1, asset_share: 1 }]).map((point) => ({
    population_share: point.population_share ?? 0,
    asset_share: point.asset_share ?? 0,
  }));
  const polyline = safePoints.map((point) => `${40 + point.population_share * 320},${340 - point.asset_share * 300}`).join(' ');
  return (
    <div className="overflow-x-auto rounded-card-lg border border-line bg-bg-deep p-2">
      <svg viewBox="0 0 400 370" className="mx-auto min-w-[360px] max-w-[520px]" role="img" aria-label="GOLD 로렌츠 곡선">
        <line x1="40" y1="340" x2="360" y2="40" className="stroke-text-muted/40" strokeDasharray="6 6" strokeWidth="2" />
        <polyline points={polyline} fill="none" className="stroke-gold" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="40" y1="340" x2="360" y2="340" className="stroke-line" strokeWidth="2" />
        <line x1="40" y1="340" x2="40" y2="40" className="stroke-line" strokeWidth="2" />
        <text x="200" y="365" textAnchor="middle" className="fill-text-muted text-[11px] font-bold">누적 학생 비율</text>
        <text x="18" y="190" textAnchor="middle" transform="rotate(-90 18 190)" className="fill-text-muted text-[11px] font-bold">누적 GOLD 비율</text>
      </svg>
    </div>
  );
}

function InequalityMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-3">
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-black text-gold">{value}</div>
      <div className="mt-1 text-2xs font-bold text-text-secondary">{hint}</div>
    </div>
  );
}

function EventRow({ event, compact, embedded = false }: { event: EconomyGuardEvent; compact: boolean; embedded?: boolean }) {
  return (
    <div className={cn(
      'rounded-card-md',
      !embedded && 'h-full',
      embedded ? 'bg-transparent' : 'border border-line bg-bg-deep',
      embedded ? 'p-0' : compact ? 'p-3' : 'p-3.5',
    )}>
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source={event.source_kind} />
        <StateBadge event={event} />
        {event.review_is_stale && <span className="rounded-pill border border-warning/30 bg-warning-bg px-2 py-0.5 text-[10px] font-black text-warning">재검토 필요</span>}
        {event.penalty && <span className="rounded-pill border border-danger/30 bg-danger-bg px-2 py-0.5 text-[10px] font-black text-danger">최종 적발</span>}
        <span className="ml-auto text-[10px] font-bold text-text-muted">{formatDateTime(event.occurred_at)}</span>
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <StudentIdentity name={event.sender_name} brandName={event.sender_brand_name} />
        <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" />
        <StudentIdentity name={event.receiver_name} brandName={event.receiver_brand_name} align="right" />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-black text-text-muted">{event.tag || '(태그 없음)'}</div>
          <div className="mt-0.5 truncate font-mono text-[9px] font-bold text-text-muted">{event.event_key}</div>
        </div>
        <span className="shrink-0 font-mono text-base font-black text-gold">{formatNumber(event.amount)} G</span>
      </div>

      {event.quantity > 1 && <div className="mt-1 text-[10px] font-bold text-text-muted">수량 {event.quantity} · 단가 {formatNumber(Math.round(event.unit_price))} G</div>}
      {event.description && <p className={cn('mt-1.5 whitespace-pre-wrap break-words text-xs leading-snug text-text-secondary', compact && 'line-clamp-2')}>{event.description}</p>}
      {event.anomaly_reasons.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{event.anomaly_reasons.map((item) => <AnomalyBadge key={item} text={item} />)}</div>}
      {event.penalty && (
        <div className="mt-2 rounded-card-sm border border-danger/25 bg-danger-bg px-2.5 py-2 text-xs font-bold text-text-secondary">
          <span className="font-black text-danger">{event.penalty.reason}</span> · {event.penalty.subject_name || event.penalty.subject_brand_name || `학생 #${event.penalty.subject_student_id}`}
          {event.penalty.memo ? ` · ${event.penalty.memo}` : ''}
        </div>
      )}
    </div>
  );
}

function StudentIdentity({ name, brandName, align = 'left' }: { name: string; brandName: string | null; align?: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className="truncate text-sm font-black text-text-primary">{name}</div>
      {brandName && <div className="mt-0.5 truncate text-[10px] font-bold text-text-muted">{brandName}</div>}
    </div>
  );
}

function SourceBadge({ source }: { source: EconomyGuardSourceKind }) {
  return source === 'P2P_TRANSFER'
    ? <span className="rounded-pill border border-bv/30 bg-bv/10 px-2 py-0.5 text-[10px] font-black text-bv">직접거래</span>
    : <span className="rounded-pill border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-black text-gold">2차직업 서비스</span>;
}

function StateBadge({ event }: { event: EconomyGuardEvent }) {
  const map: Record<string, { label: string; cls: string; icon: ReactNode }> = {
    ACTIVE: { label: '유효', cls: 'border-success/30 bg-success-bg text-success', icon: <CheckCircle2 className="h-3 w-3" /> },
    ESCROW_ACTIVE: { label: '에스크로', cls: 'border-warning/30 bg-warning-bg text-warning', icon: <Clock3 className="h-3 w-3" /> },
    SETTLED: { label: '정산 완료', cls: 'border-success/30 bg-success-bg text-success', icon: <CheckCircle2 className="h-3 w-3" /> },
    REFUNDED: { label: '환불 기록', cls: 'border-line bg-bg-card text-text-muted', icon: <History className="h-3 w-3" /> },
    REVERSED: { label: '회수 기록', cls: 'border-line bg-bg-card text-text-muted', icon: <XCircle className="h-3 w-3" /> },
  };
  const item = map[event.economic_state] ?? map.ACTIVE!;
  return <span className={cn('inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10px] font-black', item.cls)}>{item.icon}{item.label}</span>;
}

function AnomalyBadge({ text }: { text: string }) {
  return <span className="rounded-pill border border-danger/25 bg-danger-bg px-2 py-0.5 text-[10px] font-black text-danger">{text}</span>;
}

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 font-display text-base text-white">{icon}<span>{title}</span></div>
      <p className="mt-1 text-xs font-bold leading-relaxed text-text-muted">{description}</p>
    </div>
  );
}

function displayName(name: string, brandName: string | null) {
  return brandName || name;
}

function giniLabel(value: number) {
  if (value < 0.2) return '매우 균등한 편';
  if (value < 0.35) return '비교적 균등한 편';
  if (value < 0.5) return '격차 관찰 필요';
  return '격차가 큰 편';
}
