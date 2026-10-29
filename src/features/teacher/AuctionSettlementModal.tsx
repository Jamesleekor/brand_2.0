// =====================================================================
// B.R.A.N.D 2.0 — 경매 낙찰품 정리 화면 (교사 운영 패널)
// 2026-10-30
// ---------------------------------------------------------------------
// 흐름
//   1) 같은 카테고리 상품을 2개 이상 가진 학생 → 남는 상품마다
//      "무료 양도(친구 선택)" 또는 "강제 분배"를 고른다. (1개는 반드시 남김)
//   2) 무료 양도를 받아 2개가 된 친구도 다시 정리해야 한다.
//   3) 모두 1개 이하가 되면 "최종 확정" → 서버가 랜덤 추첨 + 대금 징수 + 수수료 지급.
//   4) 최종 배치표에서 자리·1인1역·급식순서 결과를 본다.
//
// 이 화면은 계산을 하지 않는다. 버튼을 누르면 서버가 처리하고
// 서버가 돌려준 최신 상태를 그대로 보여준다.
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner, Modal } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { formatNumber } from '@/lib/utils/format';
import { useToastStore } from '@/stores/ui_store';
import { cn } from '@/lib/utils/cn';
import {
  auctionSettlementRpc,
  type SettlementCategory,
  type SettlementItem,
  type SettlementState,
  type SettlementStudent,
} from '@/lib/rpc/auction_settlement_rpc';
import type { RpcResult } from '@/lib/rpc/student_rpc';

const CATEGORIES: SettlementCategory[] = ['자리', '1인1역', '급식순서'];
const CATEGORY_EMOJI: Record<SettlementCategory, string> = { 자리: '💺', '1인1역': '🧹', 급식순서: '🍽️' };
type Tab = SettlementCategory | 'BOARD';

function errorText(result: RpcResult<unknown>): string {
  // 'error' in result 로 먼저 확인해야 TypeScript가 "실패 결과"라고 이해한다.
  if ('error' in result && typeof result.error === 'string' && result.error.trim()) return result.error;
  return '서버가 요청을 처리하지 못했습니다.';
}

function priceSourceLabel(item: SettlementItem): string {
  if (item.price_source === 'FINAL_PRICE') return '낙찰가';
  if (item.price_source === 'PREVIOUS_SALE') return '이전 회차 낙찰가';
  return '시작가 (이전 낙찰 기록 없음)';
}

/** 최종 배치표에 붙는 작은 상태 배지 */
function statusBadge(item: SettlementItem): { label: string; className: string } {
  switch (item.disposition) {
    case 'HOLD':
      return item.transfer_count > 0
        ? { label: '무료 양도', className: 'bg-crystal/20 text-crystal-200 border-crystal/40' }
        : { label: '낙찰', className: 'bg-success-bg text-success border-success/40' };
    case 'FORCED_PENDING':
      return { label: '강제 분배 대기', className: 'bg-warning-bg text-warning border-warning/40' };
    case 'UNSOLD_PENDING':
      return { label: '유찰 · 분배 대기', className: 'bg-warning-bg text-warning border-warning/40' };
    case 'FORCED_ASSIGNED':
      return { label: '강제 분배', className: 'bg-bv/20 text-bv-200 border-bv/40' };
    case 'UNSOLD_ASSIGNED':
      return { label: '유찰품 분배', className: 'bg-bv/20 text-bv-200 border-bv/40' };
    default:
      return { label: '미배정', className: 'bg-danger-bg text-danger border-danger/40' };
  }
}

/** 지금 이 상품을 "가지고 있는" 학생 (확정 후에는 최종 주인) */
function ownerOf(item: SettlementItem): number | null {
  if (item.disposition === 'HOLD' || item.disposition === 'FORCED_ASSIGNED' || item.disposition === 'UNSOLD_ASSIGNED') {
    return item.holder_student_id;
  }
  return null;
}

export default function AuctionSettlementModal({ auctionId, onClose }: { auctionId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const queryKey = ['auction-settlement', auctionId];

  const stateQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await auctionSettlementRpc.state(supabase, auctionId);
      if (!r.success) throw new Error(errorText(r));
      return r.data;
    },
  });

  const [tab, setTab] = useState<Tab>('자리');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transferTargets, setTransferTargets] = useState<Record<number, string>>({});

  // 서버 호출 공통 처리: 로딩 → 성공 시 최신 상태로 교체 / 실패 시 화면 안에 오류 표시
  const run = async (label: string, rpc: () => Promise<RpcResult<SettlementState>>, successTitle?: string) => {
    if (busy) return null;
    setBusy(true);
    setActionError(null);
    try {
      const r = await rpc();
      if (!r.success) {
        const message = errorText(r);
        setActionError(`${label}: ${message}`);
        showToast({ title: `${label} 실패`, description: message, variant: 'error' });
        return null;
      }
      queryClient.setQueryData(queryKey, r.data);
      if (successTitle) showToast({ title: successTitle, variant: 'success' });
      return r.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(`${label}: ${message}`);
      showToast({ title: `${label} 오류`, description: message, variant: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const data = stateQuery.data;
  const studentMap = useMemo(() => {
    const m = new Map<number, SettlementStudent>();
    for (const s of data?.students ?? []) m.set(s.id, s);
    return m;
  }, [data?.students]);
  const roster = useMemo(() => (data?.students ?? []).filter((s) => s.in_roster), [data?.students]);
  const nameOf = (id: number | null | undefined) => (id == null ? '—' : studentMap.get(id)?.name ?? `학생#${id}`);

  const title = data ? `${data.auction.school_year} · ${data.auction.round_number}회차 낙찰품 정리` : '낙찰품 정리';

  return (
    <Modal isOpen onClose={onClose} title={title} emoji="🧩" size="wide">
      {stateQuery.isLoading ? (
        <div className="py-12 flex justify-center"><LoadingSpinner size="lg" /></div>
      ) : stateQuery.isError || !data ? (
        <div className="bg-danger-bg border border-danger/40 rounded-card-md p-4">
          <div className="font-black text-white">정리 화면을 불러오지 못했습니다</div>
          <div className="text-sm text-white mt-1 break-all">{stateQuery.error instanceof Error ? stateQuery.error.message : '알 수 없는 오류'}</div>
          <button type="button" className="btn-secondary mt-3" onClick={() => void stateQuery.refetch()}>다시 불러오기</button>
        </div>
      ) : data.categories.length === 0 ? (
        <div className="bg-bg-deep border border-line rounded-card-md p-4 text-white">
          이 회차에는 자리·1인1역·급식순서 상품이 없어 정리할 것이 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {/* 탭: 카테고리 3개 + 최종 배치표 */}
          <div className="flex flex-wrap gap-2">
            {data.categories.map((c) => {
              const unresolved = countUnresolved(data.items, c.category);
              return (
                <button
                  key={c.category}
                  type="button"
                  onClick={() => setTab(c.category)}
                  className={cn(tab === c.category ? 'btn-primary' : 'btn-secondary', 'flex items-center gap-2')}
                >
                  <span>{CATEGORY_EMOJI[c.category]} {c.category}</span>
                  {c.status === 'FINALIZED' ? (
                    <span className="text-2xs font-black px-2 py-0.5 rounded-pill bg-success-bg text-success">확정</span>
                  ) : unresolved > 0 ? (
                    <span className="text-2xs font-black px-2 py-0.5 rounded-pill bg-warning-bg text-warning">정리 {unresolved}명</span>
                  ) : (
                    <span className="text-2xs font-black px-2 py-0.5 rounded-pill bg-crystal/20 text-crystal-200">확정 가능</span>
                  )}
                </button>
              );
            })}
            <button type="button" onClick={() => setTab('BOARD')} className={tab === 'BOARD' ? 'btn-primary' : 'btn-secondary'}>
              📋 최종 배치표
            </button>
          </div>

          {actionError && (
            <div className="bg-danger-bg border border-danger/50 rounded-card-md p-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-danger">⚠️ 처리하지 못했습니다</div>
                <div className="text-sm text-white mt-1 break-all">{actionError}</div>
              </div>
              <button type="button" onClick={() => setActionError(null)} className="text-white text-sm font-black">닫기</button>
            </div>
          )}

          {tab === 'BOARD' ? (
            <FinalBoard data={data} roster={roster} nameOf={nameOf} />
          ) : (
            <CategoryPanel
              key={tab}
              data={data}
              category={tab}
              roster={roster}
              nameOf={nameOf}
              busy={busy}
              transferTargets={transferTargets}
              setTransferTarget={(itemId, value) => setTransferTargets((prev) => ({ ...prev, [itemId]: value }))}
              onTransfer={(item, toId) =>
                void run('무료 양도', () => auctionSettlementRpc.transfer(supabase, item.id, toId), `${item.item_name} → ${nameOf(toId)} 무료 양도`)
                  .then((ok) => { if (ok) setTransferTargets((prev) => ({ ...prev, [item.id]: '' })); })
              }
              onMarkForced={(item) => void run('강제 분배 지정', () => auctionSettlementRpc.markForced(supabase, item.id))}
              onUndo={(item) => void run('되돌리기', () => auctionSettlementRpc.undo(supabase, item.id), '되돌렸습니다')}
              onFinalize={(category) => void run('최종 확정', () => auctionSettlementRpc.finalize(supabase, data.auction.id, category), `${category} 최종 확정 완료`)}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

/** 같은 카테고리에서 보유 상품이 2개 이상인 학생 수 */
function countUnresolved(items: SettlementItem[], category: SettlementCategory): number {
  const counts = new Map<number, number>();
  for (const it of items) {
    if (it.category !== category || it.disposition !== 'HOLD' || it.holder_student_id == null) continue;
    counts.set(it.holder_student_id, (counts.get(it.holder_student_id) ?? 0) + 1);
  }
  let n = 0;
  counts.forEach((c) => { if (c > 1) n += 1; });
  return n;
}

// ---------------------------------------------------------------------
// 카테고리 정리 패널
// ---------------------------------------------------------------------
function CategoryPanel({
  data, category, roster, nameOf, busy, transferTargets, setTransferTarget,
  onTransfer, onMarkForced, onUndo, onFinalize,
}: {
  data: SettlementState;
  category: SettlementCategory;
  roster: SettlementStudent[];
  nameOf: (id: number | null | undefined) => string;
  busy: boolean;
  transferTargets: Record<number, string>;
  setTransferTarget: (itemId: number, value: string) => void;
  onTransfer: (item: SettlementItem, toStudentId: number) => void;
  onMarkForced: (item: SettlementItem) => void;
  onUndo: (item: SettlementItem) => void;
  onFinalize: (category: SettlementCategory) => void;
}) {
  const catState = data.categories.find((c) => c.category === category);
  const isFinal = catState?.status === 'FINALIZED';
  const items = data.items.filter((i) => i.category === category);

  // 학생별 "보유 중(HOLD)" 상품 목록
  const holdByStudent = new Map<number, SettlementItem[]>();
  for (const it of items) {
    if (it.disposition !== 'HOLD' || it.holder_student_id == null) continue;
    const list = holdByStudent.get(it.holder_student_id) ?? [];
    list.push(it);
    holdByStudent.set(it.holder_student_id, list);
  }
  const holdCount = (sid: number) => holdByStudent.get(sid)?.length ?? 0;

  const needResolve = Array.from(holdByStudent.entries())
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  const pending = items.filter((i) => i.disposition === 'FORCED_PENDING' || i.disposition === 'UNSOLD_PENDING');
  const pool = roster.filter((s) => holdCount(s.id) === 0);
  const freeTransfers = items.filter((i) => i.disposition === 'HOLD' && i.transfer_count > 0);
  const assigned = items.filter((i) => i.disposition === 'FORCED_ASSIGNED' || i.disposition === 'UNSOLD_ASSIGNED' || i.disposition === 'UNASSIGNED');

  // ---- 확정된 카테고리: 추첨 결과 + 배치표 ----
  if (isFinal) {
    return (
      <div className="space-y-4">
        <div className="bg-success-bg border border-success/40 rounded-card-md p-3 text-white font-bold">
          ✅ {category} 정리가 최종 확정되었습니다. 이제 바꿀 수 없습니다.
        </div>
        <DrawResults items={assigned} nameOf={nameOf} />
        <CategoryBoard items={items} roster={roster} nameOf={nameOf} />
      </div>
    );
  }

  const canFinalize = needResolve.length === 0;
  const mismatch = pending.length !== pool.length;

  return (
    <div className="space-y-4">
      {/* 1. 정리가 필요한 학생 */}
      <section className="bg-bg-card border border-line rounded-card-lg p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="font-display text-lg text-white">① 정리가 필요한 학생 ({needResolve.length}명)</h3>
          <p className="text-xs text-amber-100">남는 상품마다 무료 양도 또는 강제 분배를 고르세요. 1개는 꼭 남겨야 합니다.</p>
        </div>
        {needResolve.length === 0 ? (
          <p className="text-sm text-success font-bold">모든 학생이 1개 이하입니다. 아래에서 최종 확정할 수 있어요.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-3">
            {needResolve.map(([sid, list]) => (
              <div key={sid} className="bg-bg-deep border border-warning/40 rounded-card-md p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-black text-white">{nameOf(sid)}</span>
                  <span className="text-xs font-black text-warning">{list.length}개 보유 → {list.length - 1}개 정리</span>
                </div>
                <div className="space-y-2">
                  {list.map((item) => {
                    const target = transferTargets[item.id] ?? '';
                    return (
                      <div key={item.id} className="border border-line rounded-card-sm p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white font-bold">{item.emoji ?? ''} {item.item_name}</span>
                          <span className="font-mono text-gold font-black text-sm">{formatNumber(item.base_price)} G</span>
                        </div>
                        {item.transfer_count > 0 && (
                          <div className="text-xs text-crystal-200 mt-0.5">
                            무료 양도로 받음 (최초 낙찰: {nameOf(item.original_winner_student_id)})
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <select
                            className="login-input flex-1 min-w-[150px] !py-1.5 text-sm"
                            value={target}
                            disabled={busy}
                            onChange={(e) => setTransferTarget(item.id, e.target.value)}
                          >
                            <option value="">무료 양도 받을 친구…</option>
                            {roster.filter((s) => s.id !== sid).map((s) => {
                              const n = holdCount(s.id);
                              return (
                                <option key={s.id} value={String(s.id)}>
                                  {s.name} ({n}개{n >= 1 ? ' → 받으면 다시 정리' : ''})
                                </option>
                              );
                            })}
                          </select>
                          <button
                            type="button"
                            disabled={busy || !target}
                            onClick={() => onTransfer(item, Number(target))}
                            className="btn-secondary !py-1.5 text-sm"
                          >
                            🎁 양도
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onMarkForced(item)}
                            className="py-1.5 px-3 rounded-card-md border border-warning/50 bg-warning-bg text-warning text-sm font-black"
                          >
                            🎲 강제 분배
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. 분배 대기 + 받을 학생 */}
      <section className="grid lg:grid-cols-2 gap-3">
        <div className="bg-bg-card border border-line rounded-card-lg p-4">
          <h3 className="font-display text-lg text-white mb-1">② 랜덤 분배 대기 ({pending.length}개)</h3>
          <p className="text-xs text-amber-100 mb-3">받는 학생이 가격을 운영국에 냅니다 (부족하면 미납 기록). 낙찰품은 최초 낙찰자에게 50% 수수료.</p>
          {pending.length === 0 ? (
            <p className="text-sm text-white">대기 중인 상품이 없습니다.</p>
          ) : (
            <div className="space-y-1.5">
              {pending.map((item) => (
                <div key={item.id} className="bg-bg-deep border border-line rounded-card-sm p-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-bold">{item.emoji ?? ''} {item.item_name}</div>
                    <div className="text-xs text-amber-100">
                      {item.origin === 'SOLD'
                        ? `${nameOf(item.forced_by_student_id ?? item.holder_student_id)}의 강제 분배 · 수수료 ${formatNumber(Math.floor(item.base_price / 2))} G → ${nameOf(item.original_winner_student_id)}`
                        : `최종 유찰 · ${priceSourceLabel(item)}`}
                    </div>
                  </div>
                  <span className="font-mono text-gold font-black text-sm">{formatNumber(item.base_price)} G</span>
                  {item.disposition === 'FORCED_PENDING' && (
                    <button type="button" disabled={busy} onClick={() => onUndo(item)} className="btn-secondary !py-1 text-xs">되돌리기</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-bg-card border border-line rounded-card-lg p-4">
          <h3 className="font-display text-lg text-white mb-1">③ 추첨 대상 학생 ({pool.length}명)</h3>
          <p className="text-xs text-amber-100 mb-3">이 카테고리 상품이 0개인 학생입니다. 지금 기준이며, 정리가 진행되면 바뀝니다.</p>
          <div className="flex flex-wrap gap-1.5">
            {pool.length === 0 ? (
              <span className="text-sm text-white">없음</span>
            ) : pool.map((s) => (
              <span key={s.id} className="text-sm font-bold text-white bg-bg-deep border border-line rounded-pill px-2.5 py-1">{s.name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* 3. 무료 양도 기록 (되돌리기) */}
      {freeTransfers.length > 0 && (
        <section className="bg-bg-card border border-line rounded-card-lg p-4">
          <h3 className="font-display text-lg text-white mb-3">🎁 무료 양도 기록</h3>
          <div className="grid md:grid-cols-2 gap-1.5">
            {freeTransfers.map((item) => (
              <div key={item.id} className="bg-bg-deep border border-line rounded-card-sm p-2 flex items-center gap-2">
                <div className="flex-1 text-sm text-white">
                  <span className="font-bold">{item.item_name}</span> : {nameOf(item.original_winner_student_id)} → <span className="font-bold text-crystal-200">{nameOf(item.holder_student_id)}</span>
                  {item.transfer_count > 1 && <span className="text-xs text-amber-100"> (양도 {item.transfer_count}회)</span>}
                </div>
                <button type="button" disabled={busy} onClick={() => onUndo(item)} className="btn-secondary !py-1 text-xs">마지막 양도 취소</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. 최종 확정 */}
      <section className="bg-bg-card border border-gold/40 rounded-card-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white space-y-1">
          <div className="font-black">④ {category} 최종 확정</div>
          {!canFinalize && <div className="text-warning font-bold">아직 2개 이상 가진 학생이 {needResolve.length}명 있습니다.</div>}
          {canFinalize && mismatch && (
            <div className="text-warning font-bold">
              분배 대기 {pending.length}개 / 추첨 대상 {pool.length}명 — 수가 달라서
              {pending.length > pool.length ? ' 주인이 없는 상품이 생깁니다.' : ' 아무것도 받지 못하는 학생이 생깁니다.'}
            </div>
          )}
          <div className="text-amber-100">확정하면 추첨과 골드 이동이 한 번에 처리되고 되돌릴 수 없습니다.</div>
        </div>
        <button
          type="button"
          disabled={busy || !canFinalize}
          onClick={() => {
            const forced = pending.filter((i) => i.origin === 'SOLD').length;
            const unsold = pending.length - forced;
            const ok = confirm(
              `${category} 정리를 최종 확정할까요?\n\n` +
              `· 강제 분배 ${forced}개, 유찰품 ${unsold}개를 추첨 대상 ${pool.length}명에게 랜덤 분배합니다.\n` +
              `· 받은 학생은 가격을 운영국에 냅니다 (부족하면 미납으로 기록).\n` +
              `· 강제 분배된 낙찰품은 최초 낙찰자에게 50% 수수료를 지급합니다 (소득세 없음).\n\n` +
              `확정 후에는 되돌릴 수 없습니다.`,
            );
            if (ok) onFinalize(category);
          }}
          className="btn-primary"
        >
          🎲 추첨하고 최종 확정
        </button>
      </section>

      <CategoryBoard items={items} roster={roster} nameOf={nameOf} />
    </div>
  );
}

// ---------------------------------------------------------------------
// 추첨 결과 (확정 후)
// ---------------------------------------------------------------------
function DrawResults({ items, nameOf }: { items: SettlementItem[]; nameOf: (id: number | null | undefined) => string }) {
  if (items.length === 0) {
    return <div className="bg-bg-card border border-line rounded-card-lg p-4 text-white">랜덤 분배된 상품이 없습니다.</div>;
  }
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-4">
      <h3 className="font-display text-lg text-white mb-3">🎲 랜덤 분배 결과</h3>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="bg-bg-deep border border-line rounded-card-sm p-2 text-sm text-white flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold">{item.emoji ?? ''} {item.item_name}</span>
            {item.disposition === 'UNASSIGNED' ? (
              <span className="text-danger font-black">받을 학생이 없어 미배정</span>
            ) : (
              <>
                <span>→ <span className="font-black text-bv-200">{nameOf(item.holder_student_id)}</span></span>
                <span className="text-gold font-mono font-black">{formatNumber(item.charge_amount)} G</span>
                <span className="text-success">납부 {formatNumber(item.charge_collected)}</span>
                {item.charge_outstanding > 0 && <span className="text-danger font-black">미납 {formatNumber(item.charge_outstanding)}</span>}
                {item.fee_amount > 0 && (
                  <span className="text-crystal-200">수수료 {formatNumber(item.fee_amount)} G → {nameOf(item.fee_student_id)}</span>
                )}
                {item.origin === 'UNSOLD' && <span className="text-amber-100">({priceSourceLabel(item)})</span>}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 카테고리 하나의 배치표 (상품 → 학생)
// ---------------------------------------------------------------------
function CategoryBoard({ items, roster, nameOf }: { items: SettlementItem[]; roster: SettlementStudent[]; nameOf: (id: number | null | undefined) => string }) {
  const sorted = [...items].sort((a, b) => a.display_order - b.display_order || a.id - b.id);
  const owners = new Set(sorted.map(ownerOf).filter((x): x is number => x != null));
  const without = roster.filter((s) => !owners.has(s.id));
  return (
    <section className="bg-bg-card border border-line rounded-card-lg p-4">
      <h3 className="font-display text-lg text-white mb-3">📋 현재 배치</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {sorted.map((item) => {
          const badge = statusBadge(item);
          return (
            <div key={item.id} className="bg-bg-deep border border-line rounded-card-sm p-2">
              <div className="text-xs font-bold text-amber-100 truncate">{item.emoji ?? ''} {item.item_name}</div>
              <div className="font-black text-white mt-0.5 truncate">
                {item.disposition === 'FORCED_PENDING' || item.disposition === 'UNSOLD_PENDING' || item.disposition === 'UNASSIGNED'
                  ? '?'
                  : nameOf(item.holder_student_id)}
              </div>
              <span className={cn('inline-block mt-1 text-2xs font-black px-1.5 py-0.5 rounded-pill border', badge.className)}>{badge.label}</span>
            </div>
          );
        })}
      </div>
      {without.length > 0 && (
        <div className="mt-3 text-sm text-white">
          <span className="font-black text-warning">아직 없는 학생 {without.length}명: </span>
          {without.map((s) => s.name).join(', ')}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 최종 배치표 (3개 카테고리 한눈에) — 상품별 / 학생별
// ---------------------------------------------------------------------
function FinalBoard({ data, roster, nameOf }: { data: SettlementState; roster: SettlementStudent[]; nameOf: (id: number | null | undefined) => string }) {
  const [view, setView] = useState<'ITEM' | 'STUDENT'>('STUDENT');
  const cats = data.categories.map((c) => c.category);
  const allFinal = data.categories.every((c) => c.status === 'FINALIZED');

  // 학생별: 학생 → 카테고리별 상품 이름
  const byStudent = new Map<number, Partial<Record<SettlementCategory, SettlementItem>>>();
  for (const item of data.items) {
    const owner = ownerOf(item);
    if (owner == null) continue;
    const row = byStudent.get(owner) ?? {};
    // 정리 중에는 2개 이상일 수 있으므로 첫 번째만 보이고 아래 경고로 알린다
    if (!row[item.category]) row[item.category] = item;
    byStudent.set(owner, row);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={cn('text-sm font-bold', allFinal ? 'text-success' : 'text-warning')}>
          {allFinal ? '✅ 모든 카테고리가 최종 확정되었습니다.' : '⏳ 아직 확정되지 않은 카테고리가 있어 결과가 바뀔 수 있습니다.'}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setView('STUDENT')} className={view === 'STUDENT' ? 'btn-primary' : 'btn-secondary'}>학생별</button>
          <button type="button" onClick={() => setView('ITEM')} className={view === 'ITEM' ? 'btn-primary' : 'btn-secondary'}>상품별</button>
        </div>
      </div>

      {view === 'STUDENT' ? (
        <div className="bg-bg-card border border-line rounded-card-lg overflow-x-auto">
          <table className="w-full text-sm text-white">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left p-2 font-black">학생</th>
                {cats.map((c) => <th key={c} className="text-left p-2 font-black">{CATEGORY_EMOJI[c]} {c}</th>)}
              </tr>
            </thead>
            <tbody>
              {roster.map((s) => {
                const row = byStudent.get(s.id) ?? {};
                return (
                  <tr key={s.id} className="border-b border-line/50">
                    <td className="p-2 font-black">{s.name}</td>
                    {cats.map((c) => {
                      const item = row[c];
                      if (!item) return <td key={c} className="p-2 text-warning font-bold">—</td>;
                      const badge = statusBadge(item);
                      return (
                        <td key={c} className="p-2">
                          <span className="font-bold">{item.item_name}</span>{' '}
                          {badge.label !== '낙찰' && (
                            <span className={cn('text-2xs font-black px-1.5 py-0.5 rounded-pill border', badge.className)}>{badge.label}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-3">
          {cats.map((c) => {
            const items = data.items.filter((i) => i.category === c).sort((a, b) => a.display_order - b.display_order || a.id - b.id);
            return (
              <section key={c} className="bg-bg-card border border-line rounded-card-lg p-3">
                <h3 className="font-display text-white mb-2">{CATEGORY_EMOJI[c]} {c}</h3>
                <div className="space-y-1">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-2 text-sm text-white border-b border-line/40 py-1">
                      <span>{item.item_name}</span>
                      <span className="font-black">{ownerOf(item) != null ? nameOf(ownerOf(item)) : <span className="text-warning">{statusBadge(item).label}</span>}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
