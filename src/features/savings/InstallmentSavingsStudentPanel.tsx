import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import {
  installmentSavingsRpc,
  type InstallmentProduct,
  type InstallmentQuote,
  type InstallmentRound,
  type InstallmentRoundStatus,
  type InstallmentTerm,
  type StudentInstallmentContract,
} from '@/lib/rpc/installment_savings_rpc';
import { supabase } from '@/lib/supabase/client';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export default function InstallmentSavingsStudentPanel({ assetFreezeActive = false }: { assetFreezeActive?: boolean }) {
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState<InstallmentProduct | null>(null);
  const [withdrawing, setWithdrawing] = useState<StudentInstallmentContract | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detail, setDetail] = useState<StudentInstallmentContract | null>(null);

  const bank = useQuery({
    queryKey: ['s5-installment-student-bank'],
    queryFn: async () => {
      const result = await installmentSavingsRpc.getMyBank(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    refetchInterval: 30_000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['s5-installment-student-bank'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
    ]);
  };

  if (bank.isLoading) return <div className="flex min-h-[360px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (bank.isError || !bank.data) return <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5 text-center"><div className="text-3xl">⚠️</div><div className="mt-2 font-black text-danger">적금 정보를 불러오지 못했습니다.</div><div className="mt-2 break-all text-xs text-text-secondary">{bank.error instanceof Error ? bank.error.message : '알 수 없는 오류'}</div><button className="btn-secondary mt-4" onClick={() => void bank.refetch()}>다시 시도</button></div>;

  const active = bank.data.contracts.filter((c) => c.status === 'ACTIVE');
  const history = bank.data.contracts.filter((c) => c.status !== 'ACTIVE');

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-card-xl border border-crystal/25 bg-gradient-to-br from-bg-card via-bg-card to-crystal/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-crystal">INSTALLMENT SAVINGS</div>
          <h2 className="mt-1 font-display text-2xl text-white">모험가 적금</h2>
          <p className="mt-1 max-w-2xl text-xs font-bold leading-relaxed text-text-secondary">정해진 회차마다 같은 금액을 자동 납입합니다. 잔액이 부족한 회차는 미납 처리되며 나중에 몰아서 출금되지 않습니다.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <HeroStat label="보유 GOLD" value={`🪙 ${formatNumber(bank.data.wallet_gold)}`} />
          <HeroStat label="적금 컬렉션" value={`+${fmtRate(bank.data.collection_bonus_pp)}%p`} accent />
        </div>
      </div>
      {assetFreezeActive && <div className="mt-3 rounded-card-md border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-black text-danger">🧊 자산 동결 중입니다. 신규 적금 가입과 중도해지는 사용할 수 없습니다.</div>}
      <div className="mt-3 rounded-card-md border border-line bg-black/15 px-3 py-2 text-[11px] font-bold leading-relaxed text-text-secondary"><b className="text-white">자동 납입 규칙:</b> 첫 회차는 가입 즉시 처리됩니다. 이후 납입일에 GOLD가 부족하면 해당 회차만 <b className="text-warning">미납</b>되고 계약은 계속 진행됩니다.</div>
    </section>

    <section>
      <div className="mb-2"><h3 className="font-display text-lg text-white">가입 가능한 적금</h3><p className="mt-1 text-xs font-bold text-text-secondary">회차 수·납입 간격·회차당 금액을 확인하고 가입하세요.</p></div>
      {bank.data.products.length === 0 ? <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="📈" title="현재 판매 중인 적금상품이 없어요" description="선생님이 적금상품을 열면 여기에 표시됩니다." /></div> : <div className="grid gap-3 lg:grid-cols-2">{bank.data.products.map((product) => <InstallmentProductCard key={product.id} product={product} frozen={assetFreezeActive} onJoin={() => setJoining(product)} />)}</div>}
    </section>

    <section>
      <div className="mb-2 flex items-center justify-between"><div><h3 className="font-display text-lg text-white">내 적금</h3><p className="mt-1 text-xs font-bold text-text-secondary">납입 성공·미납 회차와 현재 누적 원금을 확인할 수 있습니다.</p></div><span className="rounded-pill border border-line bg-bg-card px-3 py-1.5 text-xs font-black text-text-secondary">ACTIVE {active.length}</span></div>
      {active.length === 0 ? <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="🪙" title="진행 중인 적금이 없어요" description="위 상품에서 납입 일정과 회차당 금액을 정해 시작할 수 있습니다." /></div> : <div className="space-y-3">{active.map((contract) => <InstallmentContractCard key={contract.id} contract={contract} onDetail={() => setDetail(contract)} onWithdraw={() => setWithdrawing(contract)} frozen={assetFreezeActive} />)}</div>}
    </section>

    {history.length > 0 && <section><button type="button" onClick={() => setHistoryOpen((v) => !v)} className="flex w-full items-center justify-between rounded-card-lg border border-line bg-bg-card px-4 py-3 text-left"><div><div className="font-black text-white">📚 지난 적금 기록</div><div className="mt-1 text-xs font-bold text-text-muted">만기·중도해지 {history.length}건</div></div><span className="text-text-secondary">{historyOpen ? '▲' : '▼'}</span></button>{historyOpen && <div className="mt-2 space-y-2">{history.map((contract) => <InstallmentContractCard key={contract.id} contract={contract} onDetail={() => setDetail(contract)} frozen={false} />)}</div>}</section>}

    {joining && <JoinInstallmentModal product={joining} frozen={assetFreezeActive} onClose={() => setJoining(null)} onDone={async () => { setJoining(null); await refresh(); }} />}
    {withdrawing && <WithdrawInstallmentModal contract={withdrawing} onClose={() => setWithdrawing(null)} onDone={async () => { setWithdrawing(null); await refresh(); }} />}
    {detail && <InstallmentDetailModal contract={detail} onClose={() => setDetail(null)} />}
  </div>;
}

function HeroStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="min-w-[138px] rounded-card-md border border-line bg-black/20 px-3 py-2.5 text-right"><div className="text-[10px] font-black text-text-muted">{label}</div><div className={cn('mt-0.5 font-display text-lg', accent ? 'text-success' : 'text-gold')}>{value}</div></div>;
}

function InstallmentProductCard({ product, frozen, onJoin }: { product: InstallmentProduct; frozen: boolean; onJoin: () => void }) {
  const best = useMemo(() => product.terms.reduce<InstallmentTerm | null>((a, b) => !a || b.effective_weekly_interest_rate > a.effective_weekly_interest_rate ? b : a, null), [product.terms]);
  return <motion.article whileHover={{ y: -2 }} className="rounded-card-lg border border-line bg-bg-card p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-base font-black text-white">{product.product_name}</h4><p className="mt-1 text-xs font-bold leading-relaxed text-text-secondary">{product.description || '정해진 회차마다 같은 금액을 모으는 적금상품입니다.'}</p></div>{best && <div className="flex-shrink-0 rounded-card-md border border-success/30 bg-success-bg px-3 py-2 text-right"><div className="text-[9px] font-black text-success">최대 주간금리</div><div className="font-display text-lg text-success">{fmtRate(best.effective_weekly_interest_rate)}%</div></div>}</div>
    <div className="mt-3 flex flex-wrap gap-1.5">{product.terms.map((term) => <span key={term.id} className="rounded-pill border border-line bg-bg-deep px-2.5 py-1.5 text-[11px] font-black text-text-secondary"><span className="text-white">{term.total_rounds}회</span> · {term.interval_weeks}주 간격 · <span className="text-success">주 {fmtRate(term.effective_weekly_interest_rate)}%</span></span>)}</div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Mini label="회차 최소" value={`${formatNumber(product.min_installment_amount)} G`} /><Mini label="회차 최대" value={`${formatNumber(product.max_installment_amount)} G`} /><Mini label="중도해지" value={`${fmtRate(product.early_withdrawal_penalty_rate * 100)}%`} /></div>
    <button disabled={frozen} onClick={onJoin} className="btn-primary mt-3 w-full disabled:opacity-40">{frozen ? '자산 동결 중' : '납입 조건 선택하기'}</button>
  </motion.article>;
}

function JoinInstallmentModal({ product, frozen, onClose, onDone }: { product: InstallmentProduct; frozen: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const [termId, setTermId] = useState(product.terms[0]?.id ?? 0);
  const [amount, setAmount] = useState(Math.min(product.max_installment_amount, Math.max(product.min_installment_amount, 500)));
  const term = product.terms.find((t) => t.id === termId) ?? product.terms[0];
  const valid = Boolean(term) && Number.isInteger(amount) && amount >= product.min_installment_amount && amount <= product.max_installment_amount;

  const quote = useQuery<InstallmentQuote>({
    queryKey: ['s5-installment-quote', product.id, termId, amount],
    enabled: valid && termId > 0,
    queryFn: async () => {
      const result = await installmentSavingsRpc.getQuote(supabase, { p_product_id: product.id, p_term_id: termId, p_installment_amount: amount });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
  });

  const submit = async () => {
    if (!valid || frozen) return;
    const result = await call(() => installmentSavingsRpc.subscribe(supabase, { p_product_id: product.id, p_term_id: termId, p_installment_amount: amount }), {
      successTitle: '적금 가입 완료',
      successDescription: `${product.product_name} 계약이 생성되고 첫 회차가 즉시 처리되었습니다.`,
    });
    if (result !== null) await onDone();
  };

  return <Modal isOpen onClose={onClose} title="적금 가입" emoji="📈" size="lg"><div className="space-y-4">
    <div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="font-black text-white">{product.product_name}</div><div className="mt-1 text-xs font-bold text-text-secondary">회차당 {formatNumber(product.min_installment_amount)}~{formatNumber(product.max_installment_amount)} GOLD</div></div>
    <div><label className="mb-1.5 block text-xs font-black text-text-secondary">납입 일정</label><div className="flex flex-wrap gap-2">{product.terms.map((item) => <button key={item.id} type="button" onClick={() => setTermId(item.id)} className={cn('rounded-card-md border px-3 py-2 text-xs font-black', termId === item.id ? 'border-success bg-success-bg text-success' : 'border-line bg-bg-deep text-text-secondary')}>{item.total_rounds}회 · {item.interval_weeks}주마다 · 주 {fmtRate(item.effective_weekly_interest_rate)}%</button>)}</div></div>
    <div><label className="mb-1.5 block text-xs font-black text-text-secondary">회차당 납입액</label><input type="number" min={product.min_installment_amount} max={product.max_installment_amount} step={1} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} className="input-field w-full" /><div className="mt-2 flex flex-wrap gap-1.5">{[product.min_installment_amount, Math.round((product.min_installment_amount + product.max_installment_amount) / 2), product.max_installment_amount].filter((v, i, a) => a.indexOf(v) === i).map((v) => <button key={v} type="button" className="rounded-pill border border-line bg-bg-deep px-2.5 py-1 text-[10px] font-black text-text-secondary" onClick={() => setAmount(v)}>{formatNumber(v)} G</button>)}</div></div>
    {!valid ? <div className="rounded-card-md border border-warning/35 bg-warning-bg p-3 text-xs font-black text-warning">회차당 납입액 범위를 확인하세요.</div> : quote.isLoading ? <div className="flex justify-center py-8"><LoadingSpinner /></div> : quote.isError ? <div className="rounded-card-md border border-danger/35 bg-danger-bg p-3 text-xs font-bold text-danger">견적을 계산하지 못했습니다. {quote.error instanceof Error ? quote.error.message : ''}</div> : quote.data ? <InstallmentQuoteCard quote={quote.data} /> : null}
    <div className="rounded-card-md border border-warning/30 bg-warning-bg p-3 text-[11px] font-bold leading-relaxed text-text-secondary"><b className="text-warning">미납 규칙:</b> 납입일에 잔액이 부족하면 해당 회차는 영구 미납 처리됩니다. 다음 회차에 두 배로 출금하거나 자동 보충하지 않습니다.</div>
    <button type="button" disabled={isLoading || !valid || frozen} onClick={() => void submit()} className="btn-primary w-full disabled:opacity-40">{frozen ? '자산 동결 중' : isLoading ? '가입 처리 중…' : '이 조건으로 적금 시작'}</button>
  </div></Modal>;
}

function InstallmentQuoteCard({ quote }: { quote: InstallmentQuote }) {
  return <div className="rounded-card-lg border border-success/30 bg-success-bg p-3"><div className="flex items-center justify-between"><div className="text-xs font-black text-success">서버 예상 견적</div><div className="font-display text-lg text-success">주 {fmtRate(quote.effective_weekly_interest_rate)}%</div></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><Mini label="총 회차" value={`${quote.total_rounds}회`} /><Mini label="납입 간격" value={`${quote.interval_weeks}주`} /><Mini label="예정 총원금" value={`${formatNumber(quote.planned_total_principal)} G`} /><Mini label="예상 세전이자" value={`+${formatNumber(quote.estimated_full_schedule_gross_interest)} G`} /><Mini label="예상 순이자" value={`+${formatNumber(quote.estimated_full_schedule_net_interest)} G`} /><Mini label="예상 만기수령" value={`${formatNumber(quote.estimated_full_schedule_maturity_payout)} G`} /></div><div className="mt-2 text-[10px] font-bold text-text-secondary">기본 주간금리 {fmtRate(quote.base_weekly_interest_rate)}% + 컬렉션 {fmtRate(quote.collection_bonus_pp)}%p · 만기 {dateText(quote.maturity_date)}</div>{!quote.can_afford_first_round && <div className="mt-2 rounded-card-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-[10px] font-black text-warning">현재 GOLD로 첫 회차를 낼 수 없습니다. 가입하면 1회차는 미납 처리됩니다.</div>}</div>;
}

function InstallmentContractCard({ contract, onDetail, onWithdraw, frozen }: { contract: StudentInstallmentContract; onDetail: () => void; onWithdraw?: () => void; frozen: boolean }) {
  const active = contract.status === 'ACTIVE';
  const pending = contract.rounds.filter((r) => r.status === 'PENDING').length;
  const penalty = Math.floor(contract.actual_principal * contract.early_withdrawal_penalty_rate);
  const projectedGross = projectedInterest(contract);
  return <article className="rounded-card-lg border border-line bg-bg-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-white">{contract.product_name_snapshot}</h4><ContractStatusBadge status={contract.status} /></div><div className="mt-1 text-xs font-bold text-text-secondary">{contract.total_rounds}회 · {contract.interval_weeks}주 간격 · {dateText(contract.start_date)} → {dateText(contract.maturity_date)}</div></div><div className="text-left sm:text-right"><div className="text-[10px] font-black text-text-muted">현재 누적 원금</div><div className="font-display text-xl text-gold">🪙 {formatNumber(contract.actual_principal)}</div></div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5"><Mini label="회차 납입액" value={`${formatNumber(contract.installment_amount)} G`} /><Mini label="납입 성공" value={`${contract.paid_rounds}/${contract.total_rounds}`} /><Mini label="미납" value={`${contract.missed_rounds}회`} /><Mini label="대기" value={`${pending}회`} /><Mini label={active ? '현재 예상 세전이자' : '실지급 순이자'} value={`${formatNumber(active ? projectedGross : contract.interest_paid)} G`} /></div>
    <div className="mt-3 flex flex-wrap gap-1.5">{contract.rounds.map((round) => <RoundChip key={round.id} round={round} />)}</div>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn-secondary" onClick={onDetail}>회차 상세</button>{active && onWithdraw && <button disabled={frozen} type="button" className="btn-secondary disabled:opacity-40" onClick={onWithdraw}>중도해지 · 예상 위약금 {formatNumber(penalty)} G</button>}</div>
  </article>;
}

function InstallmentDetailModal({ contract, onClose }: { contract: StudentInstallmentContract; onClose: () => void }) {
  return <Modal isOpen onClose={onClose} title="적금 회차 상세" emoji="📅" size="lg"><div className="space-y-4"><div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="flex items-center justify-between gap-2"><div><div className="font-black text-white">{contract.product_name_snapshot}</div><div className="mt-1 text-[10px] font-bold text-text-muted">#{contract.installment_uid}</div></div><ContractStatusBadge status={contract.status} /></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Mini label="회차당" value={`${formatNumber(contract.installment_amount)} G`} /><Mini label="실제 원금" value={`${formatNumber(contract.actual_principal)} G`} /><Mini label="계약 주간금리" value={`${fmtRate(contract.effective_weekly_interest_rate)}%`} /><Mini label="중도해지 위약금" value={`${fmtRate(contract.early_withdrawal_penalty_rate * 100)}%`} /></div><div className="space-y-2">{contract.rounds.map((round) => <div key={round.id} className="flex flex-col gap-1 rounded-card-md border border-line bg-bg-deep px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><span className="font-black text-white">{round.round_no}회차</span><RoundStatusBadge status={round.status} /></div><div className="text-xs font-bold text-text-secondary">납입일 {dateText(round.due_date)} · {round.status === 'PAID' ? `${formatNumber(round.paid_amount)} G 납입` : round.status === 'MISSED' ? '미납' : round.status === 'CANCELLED' ? '취소' : '대기'}</div></div>)}</div><button className="btn-secondary w-full" onClick={onClose}>닫기</button></div></Modal>;
}

function WithdrawInstallmentModal({ contract, onClose, onDone }: { contract: StudentInstallmentContract; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, isLoading } = useRpcCall();
  const penalty = Math.floor(contract.actual_principal * contract.early_withdrawal_penalty_rate);
  const refund = contract.actual_principal - penalty;
  const submit = async () => {
    const result = await call(() => installmentSavingsRpc.earlyWithdraw(supabase, { p_contract_id: contract.id }), { successTitle: '적금 중도해지 완료', successDescription: `실제 납입원금 기준 위약금 ${formatNumber(penalty)} GOLD가 차감됩니다.` });
    if (result !== null) await onDone();
  };
  return <Modal isOpen onClose={onClose} title="적금 중도해지" emoji="⚠️"><div className="space-y-4"><div className="rounded-card-md border border-line bg-bg-deep p-3"><div className="font-black text-white">{contract.product_name_snapshot}</div><div className="mt-1 text-xs font-bold text-text-secondary">납입 성공 {contract.paid_rounds}회 · 미납 {contract.missed_rounds}회 · 실제 원금 {formatNumber(contract.actual_principal)} GOLD</div></div><div className="grid grid-cols-2 gap-2"><Mini label="실제 납입원금" value={`${formatNumber(contract.actual_principal)} G`} /><Mini label="위약금" value={`-${formatNumber(penalty)} G`} /><div className="col-span-2 rounded-card-md border border-gold/30 bg-gold/5 px-3 py-3 text-center"><div className="text-[10px] font-black text-text-muted">예상 환급</div><div className="mt-1 font-display text-xl text-gold">+{formatNumber(refund)} GOLD</div></div></div><p className="text-xs font-bold leading-relaxed text-warning">중도해지 시 이자는 지급되지 않고, 아직 오지 않은 회차는 취소됩니다. 되돌릴 수 없습니다.</p><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onClose}>취소</button><button className="btn-primary flex-1" disabled={isLoading} onClick={() => void submit()}>{isLoading ? '처리 중…' : '중도해지 확정'}</button></div></div></Modal>;
}

function RoundChip({ round }: { round: InstallmentRound }) { return <span title={`${round.round_no}회차 · ${dateText(round.due_date)}`} className={cn('rounded-pill border px-2 py-1 text-[9px] font-black', round.status === 'PAID' ? 'border-success/30 bg-success-bg text-success' : round.status === 'MISSED' ? 'border-warning/30 bg-warning-bg text-warning' : round.status === 'CANCELLED' ? 'border-line bg-bg-deep text-text-muted' : 'border-crystal/30 bg-crystal/10 text-crystal')}>{round.round_no}회 {roundStatusText(round.status)}</span>; }
function RoundStatusBadge({ status }: { status: InstallmentRoundStatus }) { const cls = status === 'PAID' ? 'bg-success-bg text-success' : status === 'MISSED' ? 'bg-warning-bg text-warning' : status === 'CANCELLED' ? 'bg-bg-card text-text-muted' : 'bg-crystal/10 text-crystal'; return <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black', cls)}>{roundStatusText(status)}</span>; }
function ContractStatusBadge({ status }: { status: StudentInstallmentContract['status'] }) { const meta = status === 'ACTIVE' ? ['진행 중','bg-success-bg text-success'] : status === 'MATURED' ? ['만기 완료','bg-bv/15 text-bv'] : ['중도해지','bg-warning-bg text-warning']; return <span className={cn('rounded-pill px-2 py-1 text-[9px] font-black', meta[1])}>{meta[0]}</span>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-card-md border border-line bg-bg-deep px-2 py-2 text-center"><div className="text-[9px] font-black text-text-muted">{label}</div><div className="mt-0.5 text-xs font-black text-white">{value}</div></div>; }
function roundStatusText(status: InstallmentRoundStatus) { return status === 'PAID' ? '납입' : status === 'MISSED' ? '미납' : status === 'CANCELLED' ? '취소' : '대기'; }
function projectedInterest(contract: StudentInstallmentContract) { return contract.rounds.filter((r) => r.status === 'PAID').reduce((sum, round) => { const weeks = Math.max(0, Math.floor((dateMs(contract.maturity_date) - dateMs(round.due_date)) / 604800000)); return sum + Math.floor(round.paid_amount * Number(contract.effective_weekly_interest_rate) / 100 * weeks); }, 0); }
function dateMs(value: string) { return new Date(`${value}T00:00:00+09:00`).getTime(); }
function fmtRate(value: number) { const n = Number(value ?? 0); return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
function dateText(value: string) { return value ? value.split('-').join('.') : '-'; }
