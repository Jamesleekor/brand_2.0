import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { EmptyState, LoadingSpinner, Modal, PageHeader, useRpcCall } from '@/components/shared/components';
import { savingsRpc, type DepositQuote, type SavingsProduct, type SavingsTerm, type StudentDeposit } from '@/lib/rpc/savings_rpc';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import InstallmentSavingsStudentPanel from './InstallmentSavingsStudentPanel';

export default function SavingsBankPage() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState<SavingsProduct | null>(null);
  const [withdrawing, setWithdrawing] = useState<StudentDeposit | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bankMode, setBankMode] = useState<'DEPOSIT' | 'INSTALLMENT'>('DEPOSIT');

  const bank = useQuery({
    queryKey: ['s4-1-savings-bank', studentId],
    enabled: studentId !== null,
    queryFn: async () => {
      const result = await savingsRpc.getMyBank(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 30_000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['s4-1-savings-bank'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
    ]);
  };

  if (bank.isLoading) return <><PageHeader title="B.R.A.N.D 은행" emoji="🏦" /><div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div></>;
  if (bank.isError || !bank.data) return <><PageHeader title="B.R.A.N.D 은행" emoji="🏦" /><div className="m-4 rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center"><div className="text-3xl">⚠️</div><div className="mt-2 font-black text-danger">은행 정보를 불러오지 못했습니다.</div><div className="mt-2 break-all text-xs text-text-secondary">{bank.error instanceof Error ? bank.error.message : '알 수 없는 오류'}</div><button className="btn-secondary mt-4" onClick={() => void bank.refetch()}>다시 시도</button></div></>;

  const activeDeposits = bank.data.deposits.filter((d) => d.status === 'ACTIVE');
  const history = bank.data.deposits.filter((d) => d.status !== 'ACTIVE');

  return (
    <>
      <PageHeader title="B.R.A.N.D 은행" emoji="🏦" />
      <main className="space-y-5 px-4 pb-28 pt-4">
        <div className="flex gap-2 overflow-x-auto rounded-card-lg border border-line bg-bg-card p-2">
          <button type="button" onClick={() => setBankMode('DEPOSIT')} className={cn('min-w-fit rounded-card-md border px-4 py-2.5 text-sm font-black transition-all', bankMode === 'DEPOSIT' ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-transparent text-text-secondary hover:bg-bg-deep hover:text-white')}>🏦 예금</button>
          <button type="button" onClick={() => setBankMode('INSTALLMENT')} className={cn('min-w-fit rounded-card-md border px-4 py-2.5 text-sm font-black transition-all', bankMode === 'INSTALLMENT' ? 'border-line-brand bg-brand-primary/15 text-gold' : 'border-transparent text-text-secondary hover:bg-bg-deep hover:text-white')}>📈 적금</button>
        </div>

        {bankMode === 'DEPOSIT' ? <>
        <section className="overflow-hidden rounded-card-xl border border-gold/25 bg-gradient-to-br from-bg-card via-bg-card to-gold/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gold">SAVINGS BANK</div>
              <h1 className="mt-1 font-display text-2xl text-white">모험가 정기예금</h1>
              <p className="mt-1 max-w-xl text-xs font-bold leading-relaxed text-text-secondary">기간과 금리는 선생님이 상품별로 정합니다. 가입할 때의 상품명·금리·컬렉션 보너스·중도해지 위약금이 계약으로 고정됩니다.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <HeroStat label="보유 GOLD" value={`🪙 ${formatNumber(bank.data.gold)}`} />
              <HeroStat label="예금 컬렉션" value={`+${fmtRate(bank.data.savings_bonus_pp)}%p`} accent />
            </div>
          </div>
          {bank.data.asset_freeze_active && <div className="mt-3 rounded-card-md border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-black text-danger">🧊 자산 동결 중입니다. 새 예금 가입과 중도해지는 잠시 사용할 수 없습니다.</div>}
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between gap-2"><div><h2 className="font-display text-lg text-white">가입 가능한 상품</h2><p className="mt-1 text-xs font-bold text-text-secondary">기간을 선택하면 내 컬렉션 보너스가 더해진 실제 적용금리를 확인할 수 있습니다.</p></div></div>
          {bank.data.products.length === 0 ? <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="🏦" title="현재 판매 중인 예금상품이 없어요" description="선생님이 상품을 열면 이곳에 표시됩니다." /></div> : <div className="grid gap-3 lg:grid-cols-2">{bank.data.products.map((product) => <ProductCard key={product.id} product={product} frozen={bank.data.asset_freeze_active} onJoin={() => setJoining(product)} />)}</div>}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between"><div><h2 className="font-display text-lg text-white">내 예금</h2><p className="mt-1 text-xs font-bold text-text-secondary">현재 유지 중인 계약은 상품이 수정되어도 가입 당시 조건을 유지합니다.</p></div><span className="rounded-pill border border-line bg-bg-card px-3 py-1.5 text-xs font-black text-text-secondary">ACTIVE {activeDeposits.length}</span></div>
          {activeDeposits.length === 0 ? <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="💰" title="진행 중인 예금이 없어요" description="위 상품에서 기간과 금액을 선택해 예금을 시작할 수 있습니다." /></div> : <div className="space-y-3">{activeDeposits.map((deposit) => <DepositCard key={deposit.id} deposit={deposit} frozen={bank.data.asset_freeze_active} onWithdraw={() => setWithdrawing(deposit)} />)}</div>}
        </section>

        {history.length > 0 && <section><button type="button" onClick={() => setHistoryOpen((v) => !v)} className="flex w-full items-center justify-between rounded-card-lg border border-line bg-bg-card px-4 py-3 text-left"><div><div className="font-black text-white">📚 지난 예금 기록</div><div className="mt-1 text-xs font-bold text-text-muted">만기·중도해지 {history.length}건</div></div><span className="text-text-secondary">{historyOpen ? '▲' : '▼'}</span></button>{historyOpen && <div className="mt-2 space-y-2">{history.map((deposit) => <DepositCard key={deposit.id} deposit={deposit} frozen={false} />)}</div>}</section>}
        </> : <InstallmentSavingsStudentPanel assetFreezeActive={bank.data.asset_freeze_active} />}
      </main>

      {joining && <JoinDepositModal product={joining} bankGold={bank.data.gold} frozen={bank.data.asset_freeze_active} studentId={studentId!} onClose={() => setJoining(null)} onDone={async () => { setJoining(null); await refresh(); }} />}
      {withdrawing && <WithdrawModal deposit={withdrawing} onClose={() => setWithdrawing(null)} onDone={async () => { setWithdrawing(null); await refresh(); }} />}
    </>
  );
}

function HeroStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="min-w-[138px] rounded-card-md border border-line bg-black/20 px-3 py-2.5 text-right"><div className="text-[10px] font-black text-text-muted">{label}</div><div className={cn('mt-0.5 font-display text-lg', accent ? 'text-success' : 'text-gold')}>{value}</div></div>;
}

function ProductCard({ product, frozen, onJoin }: { product: SavingsProduct; frozen: boolean; onJoin: () => void }) {
  const best = useMemo(() => product.terms.reduce<SavingsTerm | null>((a, b) => !a || b.effective_interest_rate > a.effective_interest_rate ? b : a, null), [product.terms]);
  return <motion.article whileHover={{ y: -2 }} className="rounded-card-lg border border-line bg-bg-card p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-base font-black text-white">{product.product_name}</h3><p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">{product.description || '안전하게 GOLD를 맡기고 만기 이자를 받는 정기예금입니다.'}</p></div>{best && <div className="flex-shrink-0 rounded-card-md border border-success/30 bg-success-bg px-3 py-2 text-right"><div className="text-[9px] font-black text-success">최대 적용금리</div><div className="font-display text-lg text-success">{fmtRate(best.effective_interest_rate)}%</div></div>}</div>
    <div className="mt-3 flex flex-wrap gap-1.5">{product.terms.map((term) => <span key={term.id} className="rounded-pill border border-line bg-bg-deep px-2.5 py-1.5 text-[11px] font-black text-text-secondary"><span className="text-white">{term.term_weeks}주</span> · {fmtRate(term.base_interest_rate)}% <span className="text-success">→ {fmtRate(term.effective_interest_rate)}%</span></span>)}</div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Mini label="최소" value={`${formatNumber(product.min_amount)} G`} /><Mini label="최대" value={`${formatNumber(product.max_amount)} G`} /><Mini label="중도해지" value={`${fmtRate(product.early_withdrawal_penalty_rate * 100)}%`} /></div>
    <button disabled={frozen} onClick={onJoin} className="btn-primary mt-3 w-full disabled:opacity-40">{frozen ? '자산 동결 중' : '기간·금액 선택하기'}</button>
  </motion.article>;
}

function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep px-2 py-2"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-0.5 text-xs font-black text-white">{value}</div></div>; }

function JoinDepositModal({ product, bankGold, frozen, studentId, onClose, onDone }: { product: SavingsProduct; bankGold: number; frozen: boolean; studentId: number; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const [weeks, setWeeks] = useState(product.terms[0]?.term_weeks ?? 1);
  const [principal, setPrincipal] = useState(Math.min(product.max_amount, Math.max(product.min_amount, 1000)));
  const valid = principal >= product.min_amount && principal <= product.max_amount && principal > 0 && weeks >= 1;

  const quote = useQuery<DepositQuote>({
    queryKey: ['s4-1-deposit-quote', product.id, weeks, principal],
    enabled: valid,
    queryFn: async () => {
      const result = await savingsRpc.getQuote(supabase, { p_product_id: product.id, p_weeks: weeks, p_principal: principal });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
  });

  const submit = async () => {
    if (!quote.data?.can_afford || frozen) return;
    const result = await call(() => savingsRpc.subscribe(supabase, { p_student_id: studentId, p_product_id: product.id, p_principal: principal, p_weeks: weeks }), { successTitle: '예금 가입 완료', successDescription: `${product.product_name} ${weeks}주 계약이 생성되었습니다.` });
    if (result !== null) await onDone();
  };

  return <Modal isOpen onClose={onClose} title="예금 가입" emoji="🏦" size="lg"><div className="space-y-4">
    <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="font-black text-white">{product.product_name}</div><div className="mt-1 text-xs font-bold text-text-secondary">현재 GOLD {formatNumber(bankGold)} · 가입 가능 {formatNumber(product.min_amount)}~{formatNumber(product.max_amount)} GOLD</div></div>
    <div><label className="mb-1.5 block text-xs font-black text-text-secondary">가입 기간</label><div className="flex flex-wrap gap-2">{product.terms.map((term) => <button key={term.id} type="button" onClick={() => setWeeks(term.term_weeks)} className={cn('rounded-card-md border px-3 py-2 text-xs font-black', weeks === term.term_weeks ? 'border-success bg-success-bg text-success' : 'border-line bg-bg-deep text-text-secondary')}>{term.term_weeks}주 · {fmtRate(term.effective_interest_rate)}%</button>)}</div></div>
    <div><label className="mb-1.5 block text-xs font-black text-text-secondary">예치 금액</label><input type="number" min={product.min_amount} max={product.max_amount} step={1} value={principal} onChange={(e) => setPrincipal(Math.max(0, Number(e.target.value) || 0))} className="input-field w-full" /><div className="mt-2 flex flex-wrap gap-1.5">{[product.min_amount, Math.round((product.min_amount + product.max_amount) / 2), product.max_amount].filter((v, i, a) => a.indexOf(v) === i).map((v) => <button key={v} type="button" className="rounded-pill border border-line bg-bg-deep px-2.5 py-1 text-[10px] font-black text-text-secondary" onClick={() => setPrincipal(v)}>{formatNumber(v)} G</button>)}</div></div>
    {!valid ? <div className="rounded-card-md border border-warning/35 bg-warning-bg p-3 text-xs font-black text-warning">가입금액은 {formatNumber(product.min_amount)}~{formatNumber(product.max_amount)} GOLD 범위여야 합니다.</div> : quote.isLoading ? <div className="flex justify-center py-8"><LoadingSpinner /></div> : quote.isError ? <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-danger">견적을 계산하지 못했습니다. {quote.error instanceof Error ? quote.error.message : ''}</div> : quote.data ? <QuoteCard quote={quote.data} /> : null}
    <div className="rounded-card-md border border-line bg-bg-deep p-3 text-[11px] font-bold leading-relaxed text-text-secondary"><div className="font-black text-white">🔒 가입 시 계약 고정</div><div className="mt-1">상품명·기본금리·컬렉션 보너스·최종금리·중도해지 위약금은 가입 순간 서버에 저장됩니다. 선생님이 이후 상품을 수정해도 이 계약은 바뀌지 않습니다.</div></div>
    <button type="button" disabled={isLoading || !quote.data?.can_afford || frozen} onClick={() => void submit()} className="btn-primary w-full disabled:opacity-40">{frozen ? '자산 동결 중' : isLoading ? '가입 처리 중…' : quote.data && !quote.data.can_afford ? 'GOLD가 부족합니다' : '이 조건으로 가입 확정'}</button>
  </div></Modal>;
}

function QuoteCard({ quote }: { quote: DepositQuote }) {
  return <div className="rounded-card-lg border border-success/30 bg-success-bg p-3"><div className="flex items-center justify-between"><div className="text-xs font-black text-success">서버 예상 견적</div><div className="font-display text-lg text-success">{fmtRate(quote.effective_interest_rate)}%</div></div><div className="mt-3 grid grid-cols-2 gap-2"><Mini label="기본 금리" value={`${fmtRate(quote.base_interest_rate)}%`} /><Mini label="컬렉션 보너스" value={`+${fmtRate(quote.collection_bonus_pp)}%p`} /><Mini label="예상 순이자" value={`+${formatNumber(quote.estimated_net_interest)} G`} /><Mini label="예상 만기 수령" value={`${formatNumber(quote.estimated_maturity_payout)} G`} /></div><div className="mt-2 text-[10px] font-bold text-text-secondary">예상 세금 {formatNumber(quote.estimated_tax)} G · 중도해지 시 예상 위약금 {formatNumber(quote.estimated_early_withdrawal_penalty)} G · 만기 {dateText(quote.maturity_date)}</div><div className="mt-1 text-[10px] font-bold text-text-muted">세금은 만기 시점의 학생별 세율로 다시 계산됩니다.</div></div>;
}

function DepositCard({ deposit, frozen, onWithdraw }: { deposit: StudentDeposit; frozen: boolean; onWithdraw?: () => void }) {
  const penalty = Math.floor(deposit.principal * deposit.early_withdrawal_penalty_rate_snapshot);
  const active = deposit.status === 'ACTIVE';
  return <article className="rounded-card-lg border border-line bg-bg-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-white">{deposit.product_name_snapshot}</h3><StatusBadge status={deposit.status} /></div><div className="mt-1 text-xs font-bold text-text-secondary">{deposit.deposit_weeks}주 · {dateText(deposit.start_date)} → {dateText(deposit.maturity_date)}</div></div><div className="text-left sm:text-right"><div className="text-[10px] font-black text-text-muted">원금</div><div className="font-display text-xl text-gold">🪙 {formatNumber(deposit.principal)}</div></div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Mini label="기본 금리" value={`${fmtRate(deposit.base_interest_rate_snapshot)}%`} /><Mini label="컬렉션" value={`+${fmtRate(deposit.collection_bonus_pp_snapshot)}%p`} /><Mini label="계약 금리" value={`${fmtRate(deposit.effective_interest_rate_snapshot)}%`} /><Mini label={active ? '예상 총이자' : '지급 순이자'} value={`${formatNumber(active ? deposit.expected_gross_interest : deposit.interest_paid)} G`} /></div>
    {active && <div className="mt-3 flex flex-col gap-2 rounded-card-md border border-warning/25 bg-warning-bg p-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs font-bold text-text-secondary"><span className="font-black text-warning">중도해지 위약금 {fmtRate(deposit.early_withdrawal_penalty_rate_snapshot * 100)}%</span> · 지금 해지 시 약 {formatNumber(penalty)} GOLD 차감</div>{onWithdraw && <button disabled={frozen} type="button" onClick={onWithdraw} className="btn-secondary whitespace-nowrap disabled:opacity-40">중도해지</button>}</div>}
  </article>;
}

function StatusBadge({ status }: { status: StudentDeposit['status'] }) {
  const meta = status === 'ACTIVE' ? ['진행 중', 'bg-success-bg text-success'] : status === 'MATURED' ? ['만기 완료', 'bg-bv/15 text-bv'] : ['중도해지', 'bg-warning-bg text-warning'];
  return <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black', meta[1])}>{meta[0]}</span>;
}

function WithdrawModal({ deposit, onClose, onDone }: { deposit: StudentDeposit; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const penalty = Math.floor(deposit.principal * deposit.early_withdrawal_penalty_rate_snapshot);
  const payout = deposit.principal - penalty;
  const submit = async () => {
    const result = await call(() => savingsRpc.earlyWithdraw(supabase, { p_deposit_id: deposit.id }), { successTitle: '예금 중도해지 완료', successDescription: `원금에서 계약 위약금 ${formatNumber(penalty)} GOLD가 차감됩니다.` });
    if (result !== null) await onDone();
  };
  return <Modal isOpen onClose={onClose} title="예금 중도해지" emoji="⚠️"><div className="space-y-4"><div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="font-black text-white">{deposit.product_name_snapshot}</div><div className="mt-1 text-xs font-bold text-text-secondary">가입 당시 위약금 {fmtRate(deposit.early_withdrawal_penalty_rate_snapshot * 100)}%가 적용됩니다.</div></div><div className="grid grid-cols-2 gap-2"><Mini label="원금 환급" value={`${formatNumber(deposit.principal)} G`} /><Mini label="위약금" value={`-${formatNumber(penalty)} G`} /><div className="col-span-2 rounded-card-md border border-gold/30 bg-gold/5 px-3 py-3 text-center"><div className="text-[10px] font-black text-text-muted">예상 최종 증감</div><div className="mt-1 font-display text-xl text-gold">+{formatNumber(payout)} GOLD</div></div></div><p className="text-xs font-bold leading-relaxed text-warning">중도해지하면 이자는 지급되지 않으며 되돌릴 수 없습니다. 실제 차감액은 서버가 계약 snapshot으로 다시 계산합니다.</p><div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button><button type="button" className="btn-primary flex-1" disabled={isLoading} onClick={() => void submit()}>{isLoading ? '처리 중…' : '중도해지 확정'}</button></div></div></Modal>;
}

function fmtRate(value: number) { const n = Number(value ?? 0); return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
function dateText(value: string) { return value ? value.split('-').join('.') : '-'; }
