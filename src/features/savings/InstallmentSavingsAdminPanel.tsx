import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { StatCard } from '@/components/teacher/TeacherShell';
import {
  installmentSavingsRpc,
  type InstallmentContractStatus,
  type InstallmentProductStatus,
  type TeacherInstallmentHistoryBoard,
  type TeacherInstallmentHistoryRow,
  type TeacherInstallmentProduct,
} from '@/lib/rpc/installment_savings_rpc';
import { supabase } from '@/lib/supabase/client';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type Tab = 'PRODUCTS' | 'ACTIVE' | 'HISTORY';
type StatusFilter = 'ALL' | InstallmentContractStatus;
type TermDraft = { key: string; total_rounds: string; interval_weeks: string; base_weekly_interest_rate: string };
type ProductDraft = {
  product_id: number | null;
  product_name: string;
  description: string;
  min_installment_amount: string;
  max_installment_amount: string;
  penalty_percent: string;
  terms: TermDraft[];
};

const PAGE_SIZE = 100;

const freshDraft = (): ProductDraft => ({
  product_id: null,
  product_name: '',
  description: '',
  min_installment_amount: '100',
  max_installment_amount: '3000',
  penalty_percent: '5',
  terms: [
    { key: crypto.randomUUID(), total_rounds: '4', interval_weeks: '1', base_weekly_interest_rate: '1' },
    { key: crypto.randomUUID(), total_rounds: '8', interval_weeks: '1', base_weekly_interest_rate: '1.5' },
  ],
});

export default function InstallmentSavingsAdminPanel() {
  const queryClient = useQueryClient();
  const { call, isLoading: actionLoading } = useRpcCall();
  const [tab, setTab] = useState<Tab>('PRODUCTS');
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [productId, setProductId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TeacherInstallmentHistoryRow | null>(null);

  const board = useQuery({
    queryKey: ['s5-installment-teacher-board'],
    queryFn: async () => {
      const result = await installmentSavingsRpc.teacherBoard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
  });

  const effectiveStatus: StatusFilter = tab === 'ACTIVE' ? 'ACTIVE' : status;
  const history = useQuery({
    queryKey: ['s5-installment-teacher-history', tab, effectiveStatus, productId, search, page],
    enabled: tab !== 'PRODUCTS',
    queryFn: async () => {
      const result = await installmentSavingsRpc.teacherHistory(supabase, {
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_student_id: null,
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
      queryClient.invalidateQueries({ queryKey: ['s5-installment-teacher-board'] }),
      queryClient.invalidateQueries({ queryKey: ['s5-installment-teacher-history'] }),
      queryClient.invalidateQueries({ queryKey: ['s5-installment-student-bank'] }),
    ]);
  };

  const manualReady = isAfter2355Kst();
  const processNow = async () => {
    const result = await call(() => installmentSavingsRpc.teacherProcessNow(supabase), {
      successTitle: '적금 당일 정산을 완료했습니다',
      successDescription: '오늘 납입 대상 회차와 만기 계약을 서버 기준으로 처리했습니다.',
    });
    if (result !== null) await refresh();
  };

  if (board.isLoading) return <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (board.isError || !board.data) return <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center"><div className="text-3xl">⚠️</div><div className="mt-2 font-black text-danger">적금 운영 정보를 불러오지 못했습니다.</div><div className="mt-2 break-all text-xs text-text-secondary">{board.error instanceof Error ? board.error.message : '알 수 없는 오류'}</div><button className="btn-secondary mt-4" onClick={() => void board.refetch()}>다시 시도</button></div>;

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-crystal">S5 INSTALLMENT SAVINGS ADMIN</div><h2 className="mt-1 font-display text-xl text-white">📈 적금 운영</h2><p className="mt-1 text-xs font-bold text-text-secondary">상품·납입 회차·미납·만기·중도해지 이력을 관리합니다.</p></div>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={actionLoading || !manualReady} title={manualReady ? '오늘 적금 회차를 즉시 정산합니다.' : '운영 안전장치: 23:55 KST 이후에만 실행할 수 있습니다.'} onClick={() => void processNow()}>{manualReady ? '⏱ 당일 적금 수동 정산' : '🔒 23:55 이후 수동정산'}</button>{tab === 'PRODUCTS' && <button className="btn-primary" onClick={() => setDraft(freshDraft())}>＋ 새 적금상품</button>}</div>
    </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><StatCard emoji="📈" label="전체 상품" value={board.data.summary.total_products} color="gold" /><StatCard emoji="🟢" label="판매 중" value={board.data.summary.active_products} color="success" /><StatCard emoji="💰" label="활성 적금" value={board.data.summary.active_contracts} color="bv" /><StatCard emoji="📚" label="누적 계약" value={board.data.summary.total_contracts} color="crystal" /><StatCard emoji="⏳" label="대기 회차" value={board.data.summary.pending_rounds} color="gold" /></div>

    <div className="flex gap-2 overflow-x-auto rounded-card-lg border border-line bg-bg-card p-2"><TabButton active={tab === 'PRODUCTS'} emoji="🧾" label="상품 관리" onClick={() => setTab('PRODUCTS')} /><TabButton active={tab === 'ACTIVE'} emoji="💰" label="적금 현황" badge={board.data.summary.active_contracts} onClick={() => { setTab('ACTIVE'); setPage(0); }} /><TabButton active={tab === 'HISTORY'} emoji="📚" label="가입 이력" badge={board.data.summary.total_contracts} onClick={() => { setTab('HISTORY'); setPage(0); }} /></div>

    {tab === 'PRODUCTS' ? <>
      <section className="rounded-card-lg border border-line bg-bg-card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="font-display text-lg text-white">운영 규칙</h3><p className="mt-1 text-xs font-bold text-text-secondary">1~52회 · 납입간격 1~12주 · 총 계약기간 최대 52주 · 주간 기본금리 0~100%.</p></div><div className="rounded-card-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs font-black text-warning">잔액 부족 회차 = 미납 · 추후 자동 보충 없음</div></div></section>
      {board.data.products.length === 0 ? <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="📈" title="아직 적금상품이 없습니다" description="첫 적금상품과 납입 일정을 만들어 학생에게 공개하세요." action={<button className="btn-primary" onClick={() => setDraft(freshDraft())}>첫 적금상품 만들기</button>} /></div> : <div className="grid gap-4 xl:grid-cols-2">{board.data.products.map((product) => <ProductCard key={product.id} product={product} busy={actionLoading} onEdit={() => setDraft(fromProduct(product))} onStatus={async (next) => { const result = await call(() => installmentSavingsRpc.teacherSetStatus(supabase, { p_product_id: product.id, p_status: next }), { successTitle: `적금상품 상태를 ${productStatusText(next)}(으)로 변경했습니다` }); if (result) await refresh(); }} />)}</div>}
    </> : <HistoryPanel mode={tab} data={history.data} loading={history.isLoading || history.isFetching} error={history.isError ? (history.error instanceof Error ? history.error.message : '적금 이력을 불러오지 못했습니다.') : null} status={effectiveStatus} productId={productId} search={search} page={page} products={board.data.products} onStatus={(value) => { setStatus(value); setPage(0); }} onProduct={(value) => { setProductId(value); setPage(0); }} onSearch={(value) => { setSearch(value); setPage(0); }} onPage={setPage} onSelect={setSelected} onRetry={() => void history.refetch()} />}

    {draft && <ProductEditor draft={draft} currentStatus={draft.product_id ? board.data.products.find((p) => p.id === draft.product_id)?.status ?? 'ACTIVE' : 'ACTIVE'} onChange={setDraft} onClose={() => setDraft(null)} onSaved={async () => { setDraft(null); await refresh(); }} />}
    {selected && <ContractModal row={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function TabButton({ active, emoji, label, badge, onClick }: { active: boolean; emoji: string; label: string; badge?: number; onClick: () => void }) { return <button type="button" onClick={onClick} className={cn('flex min-w-fit items-center gap-2 rounded-card-md border px-4 py-2.5 text-sm font-black transition-all', active ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-transparent text-text-secondary hover:bg-bg-deep hover:text-white')}><span>{emoji}</span><span>{label}</span>{badge !== undefined && <span className="rounded-pill bg-bg-deep px-2 py-0.5 text-[9px] text-text-muted">{formatNumber(badge)}</span>}</button>; }

function ProductCard({ product, busy, onEdit, onStatus }: { product: TeacherInstallmentProduct; busy: boolean; onEdit: () => void; onStatus: (status: InstallmentProductStatus) => Promise<void> }) {
  const activeTerms = product.terms.filter((t) => t.is_active);
  return <article className={cn('rounded-card-lg border bg-bg-card p-4', product.status === 'ACTIVE' ? 'border-success/25' : product.status === 'EXPIRED' ? 'border-line opacity-70' : 'border-warning/25')}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black text-white">{product.product_name}</h3><ProductStatusBadge status={product.status} /></div><p className="mt-1 line-clamp-2 text-xs font-bold leading-relaxed text-text-secondary">{product.description || '설명 없음'}</p></div><button className="btn-secondary !px-3 !py-2 text-xs" onClick={onEdit}>수정</button></div><div className="mt-3 flex flex-wrap gap-1.5">{activeTerms.length ? activeTerms.map((term) => <span key={term.id} className="rounded-pill border border-line bg-bg-deep px-2.5 py-1.5 text-[11px] font-black text-text-secondary"><span className="text-white">{term.total_rounds}회</span> · {term.interval_weeks}주 간격 · <span className="text-success">주 {fmtRate(term.base_weekly_interest_rate)}%</span></span>) : <span className="text-xs font-black text-warning">활성 일정 없음</span>}</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Mini label="회차 최소" value={`${formatNumber(product.min_installment_amount)} G`} /><Mini label="회차 최대" value={`${formatNumber(product.max_installment_amount)} G`} /><Mini label="위약금" value={`${fmtRate(product.early_withdrawal_penalty_rate * 100)}%`} /><Mini label="활성/누적" value={`${product.active_contract_count}/${product.total_contract_count}`} /></div><div className="mt-3 flex flex-wrap gap-2">{product.status === 'ACTIVE' ? <button disabled={busy} className="btn-secondary" onClick={() => void onStatus('INACTIVE')}>⏸ 판매 중지</button> : product.status === 'INACTIVE' ? <button disabled={busy || activeTerms.length < 1} className="btn-primary" onClick={() => void onStatus('ACTIVE')}>▶ 다시 판매</button> : null}{product.status !== 'EXPIRED' && <button disabled={busy} className="btn-secondary" onClick={() => { if (confirm(`${product.product_name}을 만료 처리할까요?\n기존 적금 계약과 납입 일정은 유지됩니다.`)) void onStatus('EXPIRED'); }}>⏹ 만료</button>}</div></article>;
}

function HistoryPanel({ mode, data, loading, error, status, productId, search, page, products, onStatus, onProduct, onSearch, onPage, onSelect, onRetry }: { mode: Exclude<Tab,'PRODUCTS'>; data: TeacherInstallmentHistoryBoard | undefined; loading: boolean; error: string | null; status: StatusFilter; productId: string; search: string; page: number; products: TeacherInstallmentProduct[]; onStatus: (value: StatusFilter) => void; onProduct: (value: string) => void; onSearch: (value: string) => void; onPage: (page: number) => void; onSelect: (row: TeacherInstallmentHistoryRow) => void; onRetry: () => void }) {
  if (error) return <section className="rounded-card-lg border border-danger/40 bg-danger-bg p-5"><div className="font-black text-danger">적금 계약 조회 기능을 불러오지 못했습니다.</div><p className="mt-2 break-all text-xs font-bold text-text-secondary">{error}</p><button className="btn-secondary mt-4" onClick={onRetry}>다시 시도</button></section>;
  const hasNext = data ? data.offset + data.rows.length < data.total_count : false;
  return <div className="space-y-4"><section className="rounded-card-lg border border-line bg-bg-card p-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"><div><h3 className="font-display text-lg text-white">{mode === 'ACTIVE' ? '진행 중 적금' : '학생 적금 가입 이력'}</h3><p className="mt-1 text-xs font-bold text-text-secondary">실제 납입 원금과 회차별 납입/미납 상태를 확인합니다.</p></div>{data?.summary && <div className="flex flex-wrap gap-2 text-[10px] font-black"><SummaryPill label="진행" value={data.summary.active_count} tone="success" /><SummaryPill label="만기" value={data.summary.matured_count} tone="bv" /><SummaryPill label="중도해지" value={data.summary.early_withdrawn_count} tone="warning" /><SummaryPill label="활성 원금" value={`${formatNumber(data.summary.active_actual_principal)} G`} tone="gold" /></div>}</div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"><input className="input-field w-full" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="학생·상품·계약번호 검색" /><select className="input-field w-full" value={productId} onChange={(e) => onProduct(e.target.value)}><option value="">전체 상품</option>{products.map((product) => <option key={product.id} value={product.id}>{product.product_name}</option>)}</select>{mode === 'HISTORY' ? <select className="input-field w-full" value={status} onChange={(e) => onStatus(e.target.value as StatusFilter)}><option value="ALL">전체 상태</option><option value="ACTIVE">진행 중</option><option value="MATURED">만기</option><option value="EARLY_WITHDRAWN">중도해지</option></select> : <div className="flex items-center rounded-card-md border border-success/25 bg-success-bg px-3 text-xs font-black text-success">상태: 진행 중</div>}</div></section>
  <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card">{loading && !data ? <div className="flex min-h-[260px] items-center justify-center"><LoadingSpinner size="lg" /></div> : !data?.rows.length ? <EmptyState emoji="📈" title={mode === 'ACTIVE' ? '진행 중인 적금이 없습니다' : '조건에 맞는 적금 이력이 없습니다'} description="필터를 바꾸거나 학생의 적금 가입 후 다시 확인하세요." /> : <><div className="overflow-x-auto"><table className="w-full min-w-[1260px] text-left text-xs"><thead className="border-b border-line bg-bg-deep text-[10px] font-black uppercase tracking-wide text-text-muted"><tr><th className="px-4 py-3">학생</th><th className="px-4 py-3">상품</th><th className="px-4 py-3 text-center">일정</th><th className="px-4 py-3 text-right">회차당</th><th className="px-4 py-3 text-center">납입/미납</th><th className="px-4 py-3 text-right">실제 원금</th><th className="px-4 py-3 text-right">주간금리</th><th className="px-4 py-3 text-right">현재 예상 세전이자</th><th className="px-4 py-3">만기일</th><th className="px-4 py-3">상태</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} onClick={() => onSelect(row)} className="cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-bg-deep/70"><td className="px-4 py-3"><div className="font-black text-white">{row.student_name}</div>{row.student_brand_name && <div className="text-[10px] font-bold text-text-muted">{row.student_brand_name}</div>}</td><td className="px-4 py-3"><div className="max-w-[180px] truncate font-black text-text-primary">{row.product_name_snapshot}</div><div className="text-[9px] font-bold text-text-muted">#{row.installment_uid}</div></td><td className="px-4 py-3 text-center font-black text-white">{row.total_rounds}회 · {row.interval_weeks}주</td><td className="px-4 py-3 text-right font-black text-gold">{formatNumber(row.installment_amount)} G</td><td className="px-4 py-3 text-center"><span className="font-black text-success">{row.paid_rounds}</span> / <span className="font-black text-warning">{row.missed_rounds}</span></td><td className="px-4 py-3 text-right font-black text-gold">{formatNumber(row.actual_principal)} G</td><td className="px-4 py-3 text-right"><div className="font-black text-success">{fmtRate(row.effective_weekly_interest_rate)}%</div><div className="text-[9px] font-bold text-text-muted">기본 {fmtRate(row.base_weekly_interest_rate)} + {fmtRate(row.collection_bonus_pp)}%p</div></td><td className="px-4 py-3 text-right font-black text-white">+{formatNumber(row.projected_gross_interest_from_current_paid_rounds)} G</td><td className="px-4 py-3 font-bold text-text-secondary">{fmtDate(row.maturity_date)}</td><td className="px-4 py-3"><ContractStatusBadge status={row.status} /></td></tr>)}</tbody></table></div><div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-[11px] font-bold text-text-muted">총 {formatNumber(data.total_count)}건{data.rows.length > 0 ? ` · ${formatNumber(data.offset + 1)}~${formatNumber(data.offset + data.rows.length)} 표시` : ''}</div><div className="flex gap-2"><button className="btn-secondary !px-3 !py-2 text-xs" disabled={page === 0 || loading} onClick={() => onPage(Math.max(0,page-1))}>← 이전</button><button className="btn-secondary !px-3 !py-2 text-xs" disabled={!hasNext || loading} onClick={() => onPage(page+1)}>다음 →</button></div></div></>}{loading && data && <div className="border-t border-line px-4 py-2 text-center text-[10px] font-black text-text-muted">갱신 중…</div>}</section></div>;
}

function ContractModal({ row, onClose }: { row: TeacherInstallmentHistoryRow; onClose: () => void }) { return <Modal isOpen onClose={onClose} title="적금 계약 상세" emoji="📜" size="lg"><div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2 rounded-card-md border border-line bg-bg-deep p-3"><div><div className="font-black text-white">{row.student_name}{row.student_brand_name ? ` · ${row.student_brand_name}` : ''}</div><div className="mt-1 text-[10px] font-bold text-text-muted">#{row.installment_uid}</div></div><ContractStatusBadge status={row.status} /></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Detail label="가입 상품" value={row.product_name_snapshot} /><Detail label="가입일" value={fmtDate(row.start_date)} /><Detail label="만기일" value={fmtDate(row.maturity_date)} /><Detail label="회차당" value={`${formatNumber(row.installment_amount)} G`} /><Detail label="납입 일정" value={`${row.total_rounds}회 · ${row.interval_weeks}주 간격`} /><Detail label="납입 성공" value={`${row.paid_rounds}회`} /><Detail label="미납" value={`${row.missed_rounds}회`} /><Detail label="실제 원금" value={`${formatNumber(row.actual_principal)} G`} /></div><section className="rounded-card-lg border border-line bg-bg-deep p-4"><div className="mb-3 text-xs font-black text-text-secondary">가입 당시 금리 snapshot</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Detail label="기본 주간금리" value={`${fmtRate(row.base_weekly_interest_rate)}%`} /><Detail label="컬렉션" value={`+${fmtRate(row.collection_bonus_pp)}%p`} /><Detail label="최종 주간금리" value={`${fmtRate(row.effective_weekly_interest_rate)}%`} /><Detail label="중도해지 위약금" value={`${fmtRate(row.early_withdrawal_penalty_rate * 100)}%`} /></div></section><section><div className="mb-2 text-xs font-black text-text-secondary">회차 원장</div><div className="space-y-2">{row.rounds.map((round) => <div key={round.id} className="flex flex-col gap-1 rounded-card-md border border-line bg-bg-deep px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="font-black text-white">{round.round_no}회차 · {fmtDate(round.due_date)}</div><div className="flex items-center gap-2"><span className="text-xs font-bold text-text-secondary">{round.status === 'PAID' ? `${formatNumber(round.paid_amount)} G` : round.miss_reason || '-'}</span><RoundBadge status={round.status} /></div></div>)}</div></section><button className="btn-secondary w-full" onClick={onClose}>닫기</button></div></Modal>; }

function ProductEditor({ draft, currentStatus, onChange, onClose, onSaved }: { draft: ProductDraft; currentStatus: InstallmentProductStatus; onChange: (draft: ProductDraft) => void; onClose: () => void; onSaved: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const parsedTerms = draft.terms.map((term,index) => ({ total_rounds: Number(term.total_rounds), interval_weeks: Number(term.interval_weeks), base_weekly_interest_rate: Number(term.base_weekly_interest_rate), sort_order: index+1 }));
  const duplicate = parsedTerms.some((term,index) => parsedTerms.findIndex((x) => x.total_rounds === term.total_rounds && x.interval_weeks === term.interval_weeks) !== index);
  const validTerms = parsedTerms.length > 0 && parsedTerms.every((term) => Number.isInteger(term.total_rounds) && term.total_rounds >= 1 && term.total_rounds <= 52 && Number.isInteger(term.interval_weeks) && term.interval_weeks >= 1 && term.interval_weeks <= 12 && term.total_rounds * term.interval_weeks <= 52 && Number.isFinite(term.base_weekly_interest_rate) && term.base_weekly_interest_rate >= 0 && term.base_weekly_interest_rate <= 100) && !duplicate;
  const min = Number(draft.min_installment_amount); const max = Number(draft.max_installment_amount); const penalty = Number(draft.penalty_percent);
  const valid = draft.product_name.trim().length > 0 && Number.isInteger(min) && min > 0 && Number.isInteger(max) && max >= min && max <= 10_000_000 && Number.isFinite(penalty) && penalty >= 0 && penalty <= 100 && validTerms;
  const save = async () => { if (!valid) return; const result = await call(() => installmentSavingsRpc.teacherSaveProduct(supabase, { product_id: draft.product_id, product_name: draft.product_name.trim(), description: draft.description.trim() || null, min_installment_amount: min, max_installment_amount: max, early_withdrawal_penalty_rate: penalty/100, terms: parsedTerms }), { successTitle: draft.product_id ? '적금상품을 수정했습니다' : '새 적금상품을 만들었습니다', successDescription: `${parsedTerms.length}개의 납입 일정이 저장되었습니다.` }); if (result) await onSaved(); };
  return <Modal isOpen onClose={onClose} title={draft.product_id ? '적금상품 수정' : '새 적금상품'} emoji="📈" size="lg"><div className="space-y-4">{draft.product_id && <div className="rounded-card-md border border-line bg-bg-deep p-3 text-xs font-bold text-text-secondary">현재 상태: <b className="text-white">{productStatusText(currentStatus)}</b> · 기존 학생 계약은 수정되지 않습니다.</div>}<Field label="상품명"><input className="input-field w-full" maxLength={100} value={draft.product_name} onChange={(e) => onChange({ ...draft, product_name:e.target.value })} placeholder="예: 모험가 성장 적금" /></Field><Field label="상품 설명"><textarea className="input-field min-h-24 w-full resize-none" maxLength={1000} value={draft.description} onChange={(e) => onChange({ ...draft, description:e.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="회차당 최소 GOLD"><input type="number" min={1} className="input-field w-full" value={draft.min_installment_amount} onChange={(e) => onChange({ ...draft, min_installment_amount:e.target.value })} /></Field><Field label="회차당 최대 GOLD"><input type="number" min={1} className="input-field w-full" value={draft.max_installment_amount} onChange={(e) => onChange({ ...draft, max_installment_amount:e.target.value })} /></Field></div><Field label="중도해지 위약금 (%)"><input type="number" min={0} max={100} step={0.1} className="input-field w-full" value={draft.penalty_percent} onChange={(e) => onChange({ ...draft, penalty_percent:e.target.value })} /></Field><section className="rounded-card-lg border border-line bg-bg-deep p-3"><div className="mb-3 flex items-center justify-between"><div><div className="font-black text-white">납입 일정 · 주간금리</div><div className="mt-1 text-[10px] font-bold text-text-muted">총 계약기간(회차×간격)은 최대 52주입니다.</div></div><button type="button" className="btn-secondary !px-3 !py-2 text-xs" onClick={() => onChange({ ...draft, terms:[...draft.terms,{ key:crypto.randomUUID(), total_rounds:'', interval_weeks:'1', base_weekly_interest_rate:'' }] })}>＋ 일정 추가</button></div><div className="space-y-2">{draft.terms.map((term,index) => <div key={term.key} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"><label className="text-[10px] font-black text-text-muted">총 회차<input type="number" min={1} max={52} className="input-field mt-1 w-full" value={term.total_rounds} onChange={(e) => onChange({ ...draft, terms:draft.terms.map((x,i) => i === index ? { ...x,total_rounds:e.target.value } : x) })} /></label><label className="text-[10px] font-black text-text-muted">간격(주)<input type="number" min={1} max={12} className="input-field mt-1 w-full" value={term.interval_weeks} onChange={(e) => onChange({ ...draft, terms:draft.terms.map((x,i) => i === index ? { ...x,interval_weeks:e.target.value } : x) })} /></label><label className="text-[10px] font-black text-text-muted">주간금리(%)<input type="number" min={0} max={100} step={0.1} className="input-field mt-1 w-full" value={term.base_weekly_interest_rate} onChange={(e) => onChange({ ...draft, terms:draft.terms.map((x,i) => i === index ? { ...x,base_weekly_interest_rate:e.target.value } : x) })} /></label><button type="button" aria-label="일정 삭제" className="mt-5 h-10 w-10 rounded-card-md border border-danger/30 bg-danger-bg text-danger" onClick={() => onChange({ ...draft, terms:draft.terms.filter((_,i) => i !== index) })}>✕</button></div>)}</div>{duplicate && <div className="mt-2 text-xs font-black text-danger">같은 회차/간격 조합이 중복되었습니다.</div>}</section><div className="rounded-card-md border border-success/25 bg-success-bg p-3 text-[11px] font-bold leading-relaxed text-text-secondary"><b className="text-success">Snapshot 보호:</b> 상품·금리·위약금·일정을 나중에 수정해도 기존 적금 계약은 가입 당시 조건을 유지합니다.</div><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onClose}>취소</button><button disabled={!valid || isLoading} className="btn-primary flex-1 disabled:opacity-40" onClick={() => void save()}>{isLoading ? '저장 중…' : '상품 저장'}</button></div></div></Modal>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-black text-text-secondary">{label}</span>{children}</label>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep px-2 py-2 text-center"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-0.5 text-xs font-black text-white">{value}</div></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-card px-3 py-2"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-1 break-words text-xs font-black text-white">{value}</div></div>; }
function ProductStatusBadge({ status }: { status: InstallmentProductStatus }) { const meta = status === 'ACTIVE' ? ['판매중','bg-success-bg text-success'] : status === 'INACTIVE' ? ['판매중지','bg-warning-bg text-warning'] : ['만료','bg-bg-deep text-text-muted']; return <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black',meta[1])}>{meta[0]}</span>; }
function ContractStatusBadge({ status }: { status: InstallmentContractStatus }) { const meta = status === 'ACTIVE' ? ['진행 중','bg-success-bg text-success'] : status === 'MATURED' ? ['만기','bg-bv/15 text-bv'] : ['중도해지','bg-warning-bg text-warning']; return <span className={cn('inline-flex rounded-pill px-2.5 py-1 text-[10px] font-black',meta[1])}>{meta[0]}</span>; }
function RoundBadge({ status }: { status: TeacherInstallmentHistoryRow['rounds'][number]['status'] }) { const meta = status === 'PAID' ? ['납입','bg-success-bg text-success'] : status === 'MISSED' ? ['미납','bg-warning-bg text-warning'] : status === 'CANCELLED' ? ['취소','bg-bg-card text-text-muted'] : ['대기','bg-crystal/10 text-crystal']; return <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black',meta[1])}>{meta[0]}</span>; }
function SummaryPill({ label, value, tone }: { label: string; value: number | string; tone: 'success'|'bv'|'warning'|'gold' }) { const cls = tone === 'success' ? 'bg-success-bg text-success' : tone === 'bv' ? 'bg-bv/15 text-bv' : tone === 'warning' ? 'bg-warning-bg text-warning' : 'bg-gold/10 text-gold'; return <span className={cn('rounded-pill px-2.5 py-1.5',cls)}>{label} {typeof value === 'number' ? formatNumber(value) : value}</span>; }
function productStatusText(status: InstallmentProductStatus) { return status === 'ACTIVE' ? '판매중' : status === 'INACTIVE' ? '판매중지' : '만료'; }
function fmtRate(value: number) { const n = Number(value ?? 0); return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0+$/,'').replace(/\.$/,''); }
function fmtDate(value: string) { return new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ko-KR',{ timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric' }); }
function fromProduct(product: TeacherInstallmentProduct): ProductDraft { return { product_id:product.id, product_name:product.product_name, description:product.description ?? '', min_installment_amount:String(product.min_installment_amount), max_installment_amount:String(product.max_installment_amount), penalty_percent:String(Number(product.early_withdrawal_penalty_rate)*100), terms:product.terms.filter((term) => term.is_active).map((term) => ({ key:crypto.randomUUID(), total_rounds:String(term.total_rounds), interval_weeks:String(term.interval_weeks), base_weekly_interest_rate:String(term.base_weekly_interest_rate) })) }; }
function isAfter2355Kst() { const parts = new Intl.DateTimeFormat('en-GB',{ timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false }).formatToParts(new Date()); const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0); const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0); return hour * 60 + minute >= 23 * 60 + 55; }
