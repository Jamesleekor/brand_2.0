import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { StatCard, TeacherShell } from '@/components/teacher/TeacherShell';
import {
  savingsRpc,
  type DepositProductStatus,
  type StudentDepositStatus,
  type TeacherDepositHistoryBoard,
  type TeacherDepositHistoryRow,
  type TeacherSavingsProduct,
} from '@/lib/rpc/savings_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import InstallmentSavingsAdminPanel from './InstallmentSavingsAdminPanel';

type TermDraft = { key: string; term_weeks: string; base_interest_rate: string };
type ProductDraft = {
  product_id: number | null;
  product_name: string;
  description: string;
  min_amount: string;
  max_amount: string;
  penalty_percent: string;
  terms: TermDraft[];
};
type AdminTab = 'PRODUCTS' | 'ACTIVE' | 'HISTORY';
type HistoryStatusFilter = 'ALL' | StudentDepositStatus;

const PAGE_SIZE = 100;

const freshDraft = (): ProductDraft => ({
  product_id: null,
  product_name: '',
  description: '',
  min_amount: '500',
  max_amount: '10000',
  penalty_percent: '5',
  terms: [
    { key: crypto.randomUUID(), term_weeks: '1', base_interest_rate: '2' },
    { key: crypto.randomUUID(), term_weeks: '2', base_interest_rate: '5' },
    { key: crypto.randomUUID(), term_weeks: '4', base_interest_rate: '12' },
  ],
});

export default function SavingsBankAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading: actionLoading } = useRpcCall();
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [tab, setTab] = useState<AdminTab>('PRODUCTS');
  const [historyStatus, setHistoryStatus] = useState<HistoryStatusFilter>('ALL');
  const [studentId, setStudentId] = useState('');
  const [productId, setProductId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedDeposit, setSelectedDeposit] = useState<TeacherDepositHistoryRow | null>(null);
  const [bankMode, setBankMode] = useState<'DEPOSIT' | 'INSTALLMENT'>('DEPOSIT');

  const board = useQuery({
    queryKey: ['s4-1-savings-admin-board', classroomId],
    enabled: classroomId !== null,
    queryFn: async () => {
      const result = await savingsRpc.teacherBoard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  const effectiveStatus: HistoryStatusFilter = tab === 'ACTIVE' ? 'ACTIVE' : historyStatus;
  const history = useQuery({
    queryKey: ['s4-2-teacher-deposit-history', classroomId, tab, effectiveStatus, studentId, productId, search, page],
    enabled: classroomId !== null && tab !== 'PRODUCTS',
    queryFn: async () => {
      const result = await savingsRpc.teacherHistory(supabase, {
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_student_id: studentId ? Number(studentId) : null,
        p_status: effectiveStatus,
        p_product_id: productId ? Number(productId) : null,
        p_search: search.trim() || null,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['s4-1-savings-admin-board'] }),
      queryClient.invalidateQueries({ queryKey: ['s4-1-savings-bank'] }),
      queryClient.invalidateQueries({ queryKey: ['s4-2-teacher-deposit-history'] }),
    ]);
  };

  const processMatured = async () => {
    const result = await call(() => savingsRpc.processMatured(supabase, classroomId), {
      successTitle: '만기 예금 처리를 완료했습니다',
      successDescription: '처리 가능한 ACTIVE 예금을 서버가 일괄 정산했습니다.',
    });
    if (result !== null) await refresh();
  };

  const resetPage = () => setPage(0);

  if (board.isLoading) return <TeacherShell><div className="flex min-h-[500px] items-center justify-center"><LoadingSpinner size="lg" /></div></TeacherShell>;
  if (board.isError || !board.data) return <TeacherShell><div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center"><div className="text-3xl">⚠️</div><div className="mt-2 font-black text-danger">은행 운영 정보를 불러오지 못했습니다.</div><div className="mt-2 break-all text-xs text-text-secondary">{board.error instanceof Error ? board.error.message : '알 수 없는 오류'}</div><button className="btn-secondary mt-4" onClick={() => void board.refetch()}>다시 시도</button></div></TeacherShell>;

  const activeProducts = board.data.products.filter((p) => p.status === 'ACTIVE').length;
  const activeDeposits = board.data.products.reduce((sum, p) => sum + p.active_deposit_count, 0);
  const totalDeposits = board.data.products.reduce((sum, p) => sum + p.total_deposit_count, 0);

  return <TeacherShell><div className="space-y-6 pb-24">
    <div className="flex gap-2 overflow-x-auto rounded-card-lg border border-line bg-bg-card p-2">
      <button type="button" onClick={() => setBankMode('DEPOSIT')} className={cn('min-w-fit rounded-card-md border px-4 py-2.5 text-sm font-black transition-all', bankMode === 'DEPOSIT' ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-transparent text-text-secondary hover:bg-bg-deep hover:text-white')}>🏦 예금</button>
      <button type="button" onClick={() => setBankMode('INSTALLMENT')} className={cn('min-w-fit rounded-card-md border px-4 py-2.5 text-sm font-black transition-all', bankMode === 'INSTALLMENT' ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-transparent text-text-secondary hover:bg-bg-deep hover:text-white')}>📈 적금</button>
    </div>

    {bankMode === 'DEPOSIT' ? <>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gold">S4.1 + S4.2 SAVINGS ADMIN</div>
        <h1 className="mt-1 font-display text-2xl text-brand-gradient">🏦 은행 운영</h1>
        <p className="mt-1 text-sm font-bold text-text-secondary">상품 설정부터 현재 예금, 전체 가입 이력까지 한 화면에서 관리합니다. 기존 학생 계약은 가입 당시 snapshot을 유지합니다.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={actionLoading} onClick={() => void processMatured()}>⏱ 만기 예금 일괄 정산</button>
        {tab === 'PRODUCTS' && <button className="btn-primary" onClick={() => setDraft(freshDraft())}>＋ 새 예금상품</button>}
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard emoji="🏦" label="전체 상품" value={board.data.products.length} color="gold" />
      <StatCard emoji="🟢" label="판매 중" value={activeProducts} color="success" />
      <StatCard emoji="💰" label="활성 예금" value={activeDeposits} color="bv" />
      <StatCard emoji="📚" label="누적 계약" value={totalDeposits} color="crystal" />
    </div>

    <div className="flex gap-2 overflow-x-auto rounded-card-lg border border-line bg-bg-card p-2">
      <BankTabButton active={tab === 'PRODUCTS'} emoji="🧾" label="상품 관리" onClick={() => setTab('PRODUCTS')} />
      <BankTabButton active={tab === 'ACTIVE'} emoji="💰" label="예금 현황" badge={activeDeposits} onClick={() => { setTab('ACTIVE'); setPage(0); }} />
      <BankTabButton active={tab === 'HISTORY'} emoji="📚" label="가입 이력" badge={totalDeposits} onClick={() => { setTab('HISTORY'); setPage(0); }} />
    </div>

    {tab === 'PRODUCTS' ? <>
      <section className="rounded-card-lg border border-line bg-bg-card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-display text-lg text-white">운영 규칙</h2><p className="mt-1 text-xs font-bold text-text-secondary">기간 {board.data.policy.term_min_weeks}~{board.data.policy.term_max_weeks}주 · 기본금리 {board.data.policy.base_rate_min_percent}~{board.data.policy.base_rate_max_percent}% · 상품은 삭제하지 않고 상태로 종료합니다.</p></div><div className="rounded-card-md border border-success/30 bg-success-bg px-3 py-2 text-xs font-black text-success">기존 계약: 금리·위약금 변경 영향 없음</div></div></section>
      {board.data.products.length === 0 ? <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="🏦" title="아직 예금상품이 없습니다" description="새 예금상품을 만들고 학생에게 판매할 기간과 금리를 설정하세요." action={<button className="btn-primary" onClick={() => setDraft(freshDraft())}>첫 상품 만들기</button>} /></div> : <div className="grid gap-4 xl:grid-cols-2">{board.data.products.map((product) => <AdminProductCard key={product.id} product={product} busy={actionLoading} onEdit={() => setDraft(fromProduct(product))} onStatus={async (status) => { const result = await call(() => savingsRpc.teacherSetStatus(supabase, { p_product_id: product.id, p_status: status }), { successTitle: `상품 상태를 ${statusLabel(status)}(으)로 변경했습니다` }); if (result) await refresh(); }} />)}</div>}
    </> : <DepositHistoryPanel
      mode={tab}
      data={history.data}
      loading={history.isLoading || history.isFetching}
      error={history.isError ? (history.error instanceof Error ? history.error.message : '예금 이력을 불러오지 못했습니다.') : null}
      status={effectiveStatus}
      studentId={studentId}
      productId={productId}
      search={search}
      page={page}
      onStatus={(value) => { setHistoryStatus(value); resetPage(); }}
      onStudent={(value) => { setStudentId(value); resetPage(); }}
      onProduct={(value) => { setProductId(value); resetPage(); }}
      onSearch={(value) => { setSearch(value); resetPage(); }}
      onPage={setPage}
      onSelect={setSelectedDeposit}
      onRetry={() => void history.refetch()}
    />}

    {draft && <ProductEditor draft={draft} currentStatus={draft.product_id ? board.data.products.find((p) => p.id === draft.product_id)?.status ?? 'ACTIVE' : 'ACTIVE'} onChange={setDraft} onClose={() => setDraft(null)} onSaved={async () => { setDraft(null); await refresh(); }} />}
    {selectedDeposit && <DepositContractModal row={selectedDeposit} onClose={() => setSelectedDeposit(null)} />}
    </> : <InstallmentSavingsAdminPanel />}
  </div></TeacherShell>;
}

function BankTabButton({ active, emoji, label, badge, onClick }: { active: boolean; emoji: string; label: string; badge?: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn('flex min-w-fit items-center gap-2 rounded-card-md border px-4 py-2.5 text-sm font-black transition-all', active ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-transparent text-text-secondary hover:bg-bg-deep hover:text-white')}><span>{emoji}</span><span>{label}</span>{badge !== undefined && <span className={cn('rounded-pill px-2 py-0.5 text-[9px]', active ? 'bg-gold/15 text-gold' : 'bg-bg-deep text-text-muted')}>{formatNumber(badge)}</span>}</button>;
}

function DepositHistoryPanel({ mode, data, loading, error, status, studentId, productId, search, page, onStatus, onStudent, onProduct, onSearch, onPage, onSelect, onRetry }: {
  mode: Exclude<AdminTab, 'PRODUCTS'>;
  data: TeacherDepositHistoryBoard | undefined;
  loading: boolean;
  error: string | null;
  status: HistoryStatusFilter;
  studentId: string;
  productId: string;
  search: string;
  page: number;
  onStatus: (status: HistoryStatusFilter) => void;
  onStudent: (value: string) => void;
  onProduct: (value: string) => void;
  onSearch: (value: string) => void;
  onPage: (page: number) => void;
  onSelect: (row: TeacherDepositHistoryRow) => void;
  onRetry: () => void;
}) {
  if (error) return <section className="rounded-card-lg border border-danger/40 bg-danger-bg p-5"><div className="font-black text-danger">예금 계약 조회 기능을 불러오지 못했습니다.</div><p className="mt-2 break-all text-xs font-bold text-text-secondary">{error}</p><p className="mt-2 text-[11px] font-bold text-text-muted">새 S4.2 교사 예금 이력 RPC가 Production에 아직 적용되지 않았다면 SQL Gate 적용 후 다시 시도하세요.</p><button className="btn-secondary mt-4" onClick={onRetry}>다시 시도</button></section>;

  const summary = data?.summary;
  const hasNext = data ? (data.offset + data.rows.length) < data.total_count : false;

  return <div className="space-y-4">
    <section className="rounded-card-lg border border-line bg-bg-card p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="font-display text-lg text-white">{mode === 'ACTIVE' ? '진행 중 예금' : '학생 예금 가입 이력'}</h2>
          <p className="mt-1 text-xs font-bold text-text-secondary">{mode === 'ACTIVE' ? '현재 진행 중인 계약과 만기 예정 정보를 확인합니다.' : '가입 당시 snapshot 기준으로 완료·중도해지 계약까지 추적합니다.'}</p>
        </div>
        {summary && <div className="flex flex-wrap gap-2 text-[10px] font-black"><SummaryPill label="진행" value={summary.active_count} tone="success" /><SummaryPill label="만기" value={summary.matured_count} tone="bv" /><SummaryPill label="중도해지" value={summary.early_withdrawn_count} tone="warning" /><SummaryPill label="진행 원금" value={`${formatNumber(summary.active_principal)} G`} tone="gold" /></div>}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <input className="input-field w-full" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="학생·상품·계약번호 검색" />
        <select className="input-field w-full" value={studentId} onChange={(e) => onStudent(e.target.value)}><option value="">전체 학생</option>{data?.students.map((student) => <option key={student.id} value={student.id}>{student.name}{student.brand_name ? ` · ${student.brand_name}` : ''}</option>)}</select>
        <select className="input-field w-full" value={productId} onChange={(e) => onProduct(e.target.value)}><option value="">전체 상품</option>{data?.products.map((product) => <option key={product.id} value={product.id}>{product.product_name}</option>)}</select>
        {mode === 'HISTORY' ? <select className="input-field w-full" value={status} onChange={(e) => onStatus(e.target.value as HistoryStatusFilter)}><option value="ALL">전체 상태</option><option value="ACTIVE">진행 중</option><option value="MATURED">만기</option><option value="EARLY_WITHDRAWN">중도해지</option></select> : <div className="flex items-center rounded-card-md border border-success/25 bg-success-bg px-3 text-xs font-black text-success">상태: 진행 중</div>}
      </div>
    </section>

    <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
      {loading && !data ? <div className="flex min-h-[260px] items-center justify-center"><LoadingSpinner size="lg" /></div> : !data?.rows.length ? <EmptyState emoji="🏦" title={mode === 'ACTIVE' ? '진행 중인 예금이 없습니다' : '조건에 맞는 가입 이력이 없습니다'} description="필터를 바꾸거나 학생의 예금 가입 후 다시 확인하세요." /> : <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-xs">
            <thead className="border-b border-line bg-bg-deep text-[10px] font-black uppercase tracking-wide text-text-muted"><tr><th className="px-4 py-3">학생</th><th className="px-4 py-3">상품</th><th className="px-4 py-3">가입일</th><th className="px-4 py-3 text-center">기간</th><th className="px-4 py-3 text-right">원금</th><th className="px-4 py-3 text-right">적용금리</th><th className="px-4 py-3 text-right">만기 시 이자</th><th className="px-4 py-3">만기일</th><th className="px-4 py-3">상태</th><th className="px-4 py-3">처리일</th></tr></thead>
            <tbody>{data.rows.map((row) => <tr key={row.id} onClick={() => onSelect(row)} className="cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-bg-deep/70"><td className="px-4 py-3"><div className="font-black text-white">{row.student_name}</div>{row.brand_name && <div className="mt-0.5 text-[10px] font-bold text-text-muted">{row.brand_name}</div>}</td><td className="px-4 py-3"><div className="max-w-[190px] truncate font-black text-text-primary">{row.product_name_snapshot}</div><div className="mt-0.5 text-[9px] font-bold text-text-muted">#{row.deposit_uid}</div></td><td className="px-4 py-3 font-bold text-text-secondary">{fmtDate(row.start_date)}</td><td className="px-4 py-3 text-center font-black text-white">{row.deposit_weeks}주</td><td className="px-4 py-3 text-right font-black text-gold">{formatNumber(row.principal)} G</td><td className="px-4 py-3 text-right"><div className="font-black text-success">{fmtRate(row.effective_interest_rate_snapshot)}%</div><div className="mt-0.5 text-[9px] font-bold text-text-muted">기본 {fmtRate(row.base_interest_rate_snapshot)}% + {fmtRate(row.collection_bonus_pp_snapshot)}%p</div></td><td className="px-4 py-3 text-right"><div className="font-black text-white">+{formatNumber(row.expected_gross_interest)} G</div>{row.actual_net_interest !== null && <div className="mt-0.5 text-[9px] font-black text-bv">실지급 +{formatNumber(row.actual_net_interest)} G</div>}</td><td className="px-4 py-3"><div className={cn('font-bold', row.is_overdue ? 'text-warning' : 'text-text-secondary')}>{fmtDate(row.maturity_date)}</div>{row.is_overdue && <div className="mt-0.5 text-[9px] font-black text-warning">정산 대기</div>}</td><td className="px-4 py-3"><DepositStatusBadge status={row.status} /></td><td className="px-4 py-3 font-bold text-text-muted">{row.processed_at ? fmtDateTime(row.processed_at) : '-'}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-[11px] font-bold text-text-muted">총 {formatNumber(data.total_count)}건 · {formatNumber(data.offset + 1)}~{formatNumber(data.offset + data.rows.length)} 표시</div><div className="flex gap-2"><button className="btn-secondary !px-3 !py-2 text-xs" disabled={page === 0 || loading} onClick={() => onPage(Math.max(0, page - 1))}>← 이전</button><button className="btn-secondary !px-3 !py-2 text-xs" disabled={!hasNext || loading} onClick={() => onPage(page + 1)}>다음 →</button></div></div>
      </>}
      {loading && data && <div className="border-t border-line px-4 py-2 text-center text-[10px] font-black text-text-muted">갱신 중…</div>}
    </section>
  </div>;
}

function DepositContractModal({ row, onClose }: { row: TeacherDepositHistoryRow; onClose: () => void }) {
  return <Modal isOpen onClose={onClose} title="예금 계약 상세" emoji="📜" size="lg"><div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-card-md border border-line bg-bg-deep p-3"><div><div className="font-black text-white">{row.student_name}{row.brand_name ? ` · ${row.brand_name}` : ''}</div><div className="mt-1 text-[10px] font-bold text-text-muted">계약번호 {row.deposit_uid}</div></div><DepositStatusBadge status={row.status} /></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Detail label="가입 당시 상품" value={row.product_name_snapshot} /><Detail label="가입일" value={fmtDate(row.start_date)} /><Detail label="가입 기간" value={`${row.deposit_weeks}주`} /><Detail label="원금" value={`${formatNumber(row.principal)} G`} /><Detail label="만기일" value={fmtDate(row.maturity_date)} /><Detail label="처리일" value={row.processed_at ? fmtDateTime(row.processed_at) : '-'} /></div>
    <section className="rounded-card-lg border border-line bg-bg-deep p-4"><div className="mb-3 text-xs font-black text-text-secondary">가입 당시 금리 snapshot</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Detail label="기본금리" value={`${fmtRate(row.base_interest_rate_snapshot)}%`} /><Detail label="컬렉션 보너스" value={`+${fmtRate(row.collection_bonus_pp_snapshot)}%p`} /><Detail label="최종 적용금리" value={`${fmtRate(row.effective_interest_rate_snapshot)}%`} /><Detail label="중도해지 위약금" value={`${fmtRate(row.early_withdrawal_penalty_rate_snapshot * 100)}%`} /></div></section>
    <section className="rounded-card-lg border border-line bg-bg-deep p-4"><div className="mb-3 text-xs font-black text-text-secondary">만기 계산</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Detail label="예상 세전이자" value={`+${formatNumber(row.expected_gross_interest)} G`} /><Detail label="예상 세전 만기액" value={`${formatNumber(row.expected_gross_maturity_payout)} G`} /><Detail label="실제 지급이자" value={row.actual_net_interest === null ? '-' : `+${formatNumber(row.actual_net_interest)} G`} /></div><p className="mt-3 text-[10px] font-bold leading-relaxed text-text-muted">실제 지급이자는 만기 처리 시 학생별 소득세를 차감한 순이자입니다. 진행 중 계약의 세금은 만기 시점에 확정됩니다.</p></section>
    <button className="btn-secondary w-full" onClick={onClose}>닫기</button>
  </div></Modal>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-card px-3 py-2"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-1 break-words text-xs font-black text-white">{value}</div></div>; }
function SummaryPill({ label, value, tone }: { label: string; value: number | string; tone: 'success' | 'bv' | 'warning' | 'gold' }) { const cls = tone === 'success' ? 'bg-success-bg text-success' : tone === 'bv' ? 'bg-bv/15 text-bv' : tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-gold/10 text-gold'; return <span className={cn('rounded-pill px-2.5 py-1.5', cls)}>{label} {typeof value === 'number' ? formatNumber(value) : value}</span>; }
function DepositStatusBadge({ status }: { status: StudentDepositStatus }) { const meta = status === 'ACTIVE' ? ['진행 중', 'bg-success-bg text-success'] : status === 'MATURED' ? ['만기', 'bg-bv/15 text-bv'] : ['중도해지', 'bg-warning-bg text-warning']; return <span className={cn('inline-flex rounded-pill px-2.5 py-1 text-[10px] font-black', meta[1])}>{meta[0]}</span>; }
function fmtDate(value: string) { return new Date(value).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' }); }
function fmtDateTime(value: string) { return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

function AdminProductCard({ product, busy, onEdit, onStatus }: { product: TeacherSavingsProduct; busy: boolean; onEdit: () => void; onStatus: (status: DepositProductStatus) => Promise<void> }) {
  const activeTerms = product.terms.filter((t) => t.is_active);
  return <article className={cn('rounded-card-lg border bg-bg-card p-4', product.status === 'ACTIVE' ? 'border-success/25' : product.status === 'EXPIRED' ? 'border-line opacity-70' : 'border-warning/25')}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-black text-white">{product.product_name}</h2><ProductStatusBadge status={product.status} /></div><p className="mt-1 line-clamp-2 text-xs font-bold leading-relaxed text-text-secondary">{product.description || '설명 없음'}</p></div><button className="btn-secondary !px-3 !py-2 text-xs" onClick={onEdit}>수정</button></div>
    <div className="mt-3 flex flex-wrap gap-1.5">{activeTerms.length ? activeTerms.map((term) => <span key={term.id} className="rounded-pill border border-line bg-bg-deep px-2.5 py-1.5 text-[11px] font-black text-text-secondary"><span className="text-white">{term.term_weeks}주</span> · <span className="text-success">{fmtRate(term.base_interest_rate)}%</span></span>) : <span className="text-xs font-black text-warning">활성 기간 없음</span>}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Mini label="최소 가입" value={`${formatNumber(product.min_amount)} G`} /><Mini label="최대 가입" value={`${formatNumber(product.max_amount)} G`} /><Mini label="위약금" value={`${fmtRate(product.early_withdrawal_penalty_rate * 100)}%`} /><Mini label="활성/누적" value={`${product.active_deposit_count}/${product.total_deposit_count}`} /></div>
    <div className="mt-3 flex flex-wrap gap-2">{product.status === 'ACTIVE' ? <button disabled={busy} className="btn-secondary" onClick={() => void onStatus('INACTIVE')}>⏸ 판매 중지</button> : product.status === 'INACTIVE' ? <button disabled={busy || activeTerms.length < 1} className="btn-primary" onClick={() => void onStatus('ACTIVE')}>▶ 다시 판매</button> : null}{product.status !== 'EXPIRED' && <button disabled={busy} className="btn-secondary" onClick={() => { if (confirm(`${product.product_name}을 만료 처리할까요?\n기존 학생 예금 계약은 유지되며 신규 가입만 중단됩니다.`)) void onStatus('EXPIRED'); }}>⏹ 만료</button>}</div>
  </article>;
}

function ProductEditor({ draft, currentStatus, onChange, onClose, onSaved }: { draft: ProductDraft; currentStatus: DepositProductStatus; onChange: (draft: ProductDraft) => void; onClose: () => void; onSaved: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const parsedTerms = draft.terms.map((term, index) => ({ term_weeks: Number(term.term_weeks), base_interest_rate: Number(term.base_interest_rate), sort_order: index + 1 }));
  const duplicateWeeks = parsedTerms.some((term, index) => parsedTerms.findIndex((x) => x.term_weeks === term.term_weeks) !== index);
  const validTerms = parsedTerms.length > 0 && parsedTerms.every((term) => Number.isInteger(term.term_weeks) && term.term_weeks >= 1 && term.term_weeks <= 52 && Number.isFinite(term.base_interest_rate) && term.base_interest_rate >= 0 && term.base_interest_rate <= 100) && !duplicateWeeks;
  const minAmount = Number(draft.min_amount);
  const maxAmount = Number(draft.max_amount);
  const penaltyPercent = Number(draft.penalty_percent);
  const valid = draft.product_name.trim().length > 0 && draft.product_name.trim().length <= 100 && Number.isInteger(minAmount) && minAmount > 0 && Number.isInteger(maxAmount) && maxAmount >= minAmount && Number.isFinite(penaltyPercent) && penaltyPercent >= 0 && penaltyPercent <= 100 && validTerms;

  const save = async () => {
    if (!valid) return;
    const result = await call(() => savingsRpc.teacherSaveProduct(supabase, {
      product_id: draft.product_id,
      product_name: draft.product_name.trim(),
      description: draft.description.trim() || null,
      min_amount: minAmount,
      max_amount: maxAmount,
      early_withdrawal_penalty_rate: penaltyPercent / 100,
      terms: parsedTerms,
    }), { successTitle: draft.product_id ? '예금상품을 수정했습니다' : '새 예금상품을 만들었습니다', successDescription: `${parsedTerms.length}개의 가입 기간이 저장되었습니다.` });
    if (result) await onSaved();
  };

  return <Modal isOpen onClose={onClose} title={draft.product_id ? '예금상품 수정' : '새 예금상품'} emoji="🏦" size="lg"><div className="space-y-4">
    {draft.product_id && <div className="rounded-card-md border border-line bg-bg-deep p-3 text-xs font-bold text-text-secondary">현재 상태: <b className="text-white">{statusLabel(currentStatus)}</b> · 저장해도 상태는 자동 변경되지 않습니다.</div>}
    <Field label="상품명"><input className="input-field w-full" maxLength={100} value={draft.product_name} onChange={(e) => onChange({ ...draft, product_name: e.target.value })} placeholder="예: 모험가 정기예금" /></Field>
    <Field label="상품 설명"><textarea className="input-field min-h-24 w-full resize-none" maxLength={1000} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="학생에게 보일 상품 설명" /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="최소 가입 GOLD"><input type="number" min={1} step={1} className="input-field w-full" value={draft.min_amount} onChange={(e) => onChange({ ...draft, min_amount: e.target.value })} /></Field><Field label="최대 가입 GOLD"><input type="number" min={1} step={1} className="input-field w-full" value={draft.max_amount} onChange={(e) => onChange({ ...draft, max_amount: e.target.value })} /></Field></div>
    <Field label="중도해지 위약금 (%)"><input type="number" min={0} max={100} step={0.1} className="input-field w-full" value={draft.penalty_percent} onChange={(e) => onChange({ ...draft, penalty_percent: e.target.value })} /><p className="mt-1 text-[10px] font-bold text-text-muted">학생이 가입하는 순간 이 비율이 계약에 snapshot됩니다.</p></Field>
    <section className="rounded-card-lg border border-line bg-bg-deep p-3"><div className="mb-3 flex items-center justify-between"><div><div className="font-black text-white">가입 기간 · 기본금리</div><div className="mt-1 text-[10px] font-bold text-text-muted">1~52주 / 0~100%. 같은 기간은 중복 등록할 수 없습니다.</div></div><button type="button" className="btn-secondary !px-3 !py-2 text-xs" onClick={() => onChange({ ...draft, terms: [...draft.terms, { key: crypto.randomUUID(), term_weeks: '', base_interest_rate: '' }] })}>＋ 기간 추가</button></div><div className="space-y-2">{draft.terms.map((term, index) => <div key={term.key} className="grid grid-cols-[1fr_1fr_auto] gap-2"><label className="text-[10px] font-black text-text-muted">기간(주)<input type="number" min={1} max={52} step={1} className="input-field mt-1 w-full" value={term.term_weeks} onChange={(e) => onChange({ ...draft, terms: draft.terms.map((x, i) => i === index ? { ...x, term_weeks: e.target.value } : x) })} /></label><label className="text-[10px] font-black text-text-muted">기본금리(%)<input type="number" min={0} max={100} step={0.1} className="input-field mt-1 w-full" value={term.base_interest_rate} onChange={(e) => onChange({ ...draft, terms: draft.terms.map((x, i) => i === index ? { ...x, base_interest_rate: e.target.value } : x) })} /></label><button type="button" aria-label="기간 삭제" className="mt-5 h-10 w-10 rounded-card-md border border-danger/30 bg-danger-bg text-danger" onClick={() => onChange({ ...draft, terms: draft.terms.filter((_, i) => i !== index) })}>✕</button></div>)}</div>{draft.terms.length === 0 && <div className="py-5 text-center text-xs font-bold text-warning">최소 1개의 가입 기간을 추가하세요.</div>}{duplicateWeeks && <div className="mt-2 text-xs font-black text-danger">같은 가입 기간이 중복되었습니다.</div>}</section>
    <div className="rounded-card-md border border-success/25 bg-success-bg p-3 text-[11px] font-bold leading-relaxed text-text-secondary"><b className="text-success">계약 보호:</b> 상품명·기간·금리·위약금을 수정하거나 기간을 삭제해도 이미 가입한 학생의 기존 예금에는 영향을 주지 않습니다.</div>
    <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onClose}>취소</button><button disabled={!valid || isLoading} className="btn-primary flex-1 disabled:opacity-40" onClick={() => void save()}>{isLoading ? '저장 중…' : '상품 저장'}</button></div>
  </div></Modal>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-black text-text-secondary">{label}</span>{children}</label>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep px-2 py-2 text-center"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-0.5 text-xs font-black text-white">{value}</div></div>; }
function ProductStatusBadge({ status }: { status: DepositProductStatus }) { const meta = status === 'ACTIVE' ? ['판매중','bg-success-bg text-success'] : status === 'INACTIVE' ? ['판매중지','bg-warning-bg text-warning'] : ['만료','bg-bg-deep text-text-muted']; return <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black', meta[1])}>{meta[0]}</span>; }
function statusLabel(status: DepositProductStatus) { return status === 'ACTIVE' ? '판매중' : status === 'INACTIVE' ? '판매중지' : '만료'; }
function fmtRate(value: number) { const n = Number(value ?? 0); return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
function fromProduct(product: TeacherSavingsProduct): ProductDraft { const active = product.terms.filter((term) => term.is_active); return { product_id: product.id, product_name: product.product_name, description: product.description ?? '', min_amount: String(product.min_amount), max_amount: String(product.max_amount), penalty_percent: String(Number(product.early_withdrawal_penalty_rate) * 100), terms: active.map((term) => ({ key: crypto.randomUUID(), term_weeks: String(term.term_weeks), base_interest_rate: String(term.base_interest_rate) })) }; }
