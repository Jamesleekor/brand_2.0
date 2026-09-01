import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import {
  inventoryMarketRpc,
  type EconomyHistoryKind,
  type TeacherEconomyHistoryRow,
} from '@/lib/rpc/inventory_market_rpc';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime, formatDelta, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

const PAGE_SIZE = 100;

const KIND_FILTERS: { value: EconomyHistoryKind; label: string; emoji: string }[] = [
  { value: 'ALL', label: '전체', emoji: '📚' },
  { value: 'ASSET', label: '자산', emoji: '💰' },
  { value: 'PURCHASE', label: '구매', emoji: '🛒' },
  { value: 'SALE', label: '판매', emoji: '🪙' },
  { value: 'USE', label: '사용', emoji: '✨' },
  { value: 'INVENTORY', label: '기타 아이템', emoji: '📦' },
];

const KIND_META: Record<Exclude<EconomyHistoryKind, 'ALL'>, { label: string; emoji: string; cls: string }> = {
  ASSET: { label: '자산', emoji: '💰', cls: 'border-bv/30 bg-bv/10 text-bv' },
  PURCHASE: { label: '구매', emoji: '🛒', cls: 'border-danger/30 bg-danger-bg text-danger' },
  SALE: { label: '판매', emoji: '🪙', cls: 'border-success/30 bg-success-bg text-success' },
  USE: { label: '사용', emoji: '✨', cls: 'border-crystal/30 bg-crystal/10 text-crystal' },
  INVENTORY: { label: '아이템', emoji: '📦', cls: 'border-warning/30 bg-warning-bg text-warning' },
};

export default function EconomyHistoryPanel({ classroomId }: { classroomId: number | null }) {
  const [kind, setKind] = useState<EconomyHistoryKind>('ALL');
  const [studentId, setStudentId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [kind, studentId, search, dateFrom, dateTo]);

  const query = useQuery({
    queryKey: ['teacher-economy-history', classroomId, kind, studentId, search, dateFrom, dateTo, page],
    queryFn: async () => {
      if (!classroomId) return null;
      const result = await inventoryMarketRpc.teacherEconomyHistory(supabase, {
        p_classroom_id: classroomId,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_student_id: studentId,
        p_kind: kind,
        p_search: search.trim() || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      });
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: classroomId !== null,
    refetchInterval: 15_000,
  });

  if (!classroomId) return <EmptyState emoji="📚" title="학급 정보를 찾을 수 없습니다" />;

  const rows = query.data?.rows ?? [];
  const total = query.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-4">
      <div className="rounded-card-lg border border-line bg-gradient-to-br from-bg-card to-bg-deep p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">AUDIT LEDGER</div>
            <h2 className="mt-1 font-display text-xl text-white">📚 통합 히스토리</h2>
            <p className="mt-1 max-w-3xl text-xs font-bold leading-relaxed text-text-secondary">
              기존 Google Sheet의 ‘히스토리’ 역할을 하는 읽기 전용 감사원장입니다. BV·GOLD·CRYSTAL 변동과 시장 구매·판매·아이템 사용을 한 시간축에서 확인합니다.
            </p>
          </div>
          <button type="button" onClick={() => void query.refetch()} className="btn-secondary whitespace-nowrap">
            ↻ 새로고침
          </button>
        </div>
      </div>

      <div className="rounded-card-lg border border-line bg-bg-card p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setKind(filter.value)}
              className={cn(
                'flex-shrink-0 rounded-pill border px-3 py-2 text-xs font-black',
                kind === filter.value
                  ? 'border-brand-primary/50 bg-brand-primary/20 text-white'
                  : 'border-line bg-bg-deep text-text-secondary',
              )}
            >
              {filter.emoji} {filter.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[180px_1fr_150px_150px]">
          <select
            value={studentId ?? ''}
            onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none"
          >
            <option value="">전체 학생</option>
            {(query.data?.students ?? []).map((student) => (
              <option key={student.id} value={student.id}>{student.name}{student.brand_name ? ` · ${student.brand_name}` : ''}</option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="학생 · 브랜드 · 아이템 · 비고 검색"
            className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-brand-primary/60"
          />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-bold text-white outline-none" />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-bold text-text-muted">
          <span>총 {formatNumber(total)}건</span>
          {(search || studentId || dateFrom || dateTo || kind !== 'ALL') && (
            <button
              type="button"
              className="text-text-secondary hover:text-white"
              onClick={() => { setKind('ALL'); setStudentId(null); setSearch(''); setDateFrom(''); setDateTo(''); }}
            >
              필터 초기화
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex min-h-[420px] items-center justify-center"><LoadingSpinner size="lg" /></div>
      ) : query.isError ? (
        <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-5">
          <div className="font-black text-danger">히스토리를 불러오지 못했습니다.</div>
          <div className="mt-1 break-all text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-card-lg border border-line bg-bg-card"><EmptyState emoji="📚" title="조건에 맞는 기록이 없습니다" /></div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-card-lg border border-line bg-bg-card lg:block">
            <div className="grid grid-cols-[145px_170px_105px_150px_145px_minmax(240px,1fr)] border-b border-line bg-bg-deep px-3 py-2 text-[10px] font-black text-text-muted">
              <div>시간</div><div>학생 / 브랜드</div><div>구분</div><div>변동</div><div>변동 후 잔액</div><div>비고</div>
            </div>
            {rows.map((row) => <DesktopRow key={row.event_key} row={row} />)}
          </div>

          <div className="space-y-2 lg:hidden">
            {rows.map((row) => <MobileRow key={row.event_key} row={row} />)}
          </div>

          <div className="flex items-center justify-center gap-3">
            <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn-secondary disabled:opacity-35">이전</button>
            <span className="text-xs font-black text-text-secondary">{page + 1} / {pageCount}</span>
            <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="btn-secondary disabled:opacity-35">다음</button>
          </div>
        </>
      )}
    </section>
  );
}

function DesktopRow({ row }: { row: TeacherEconomyHistoryRow }) {
  return (
    <div className={cn('grid grid-cols-[145px_170px_105px_150px_145px_minmax(240px,1fr)] items-center gap-0 border-b border-line/70 px-3 py-2.5 text-xs last:border-b-0', row.is_reversed && 'opacity-55')}>
      <div className="font-bold text-text-muted">{formatDateTime(row.occurred_at)}</div>
      <StudentCell row={row} />
      <KindBadge row={row} />
      <div><DeltaCell row={row} /></div>
      <div><BalanceCell row={row} /></div>
      <MemoCell row={row} />
    </div>
  );
}

function MobileRow({ row }: { row: TeacherEconomyHistoryRow }) {
  return (
    <article className={cn('rounded-card-lg border border-line bg-bg-card p-3', row.is_reversed && 'opacity-55')}>
      <div className="flex items-start justify-between gap-3">
        <StudentCell row={row} />
        <KindBadge row={row} />
      </div>
      <div className="mt-2 text-[10px] font-bold text-text-muted">{formatDateTime(row.occurred_at)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-card-md bg-bg-deep p-2.5">
        <div><div className="text-[9px] font-black text-text-muted">변동</div><div className="mt-0.5"><DeltaCell row={row} /></div></div>
        <div><div className="text-[9px] font-black text-text-muted">변동 후 잔액</div><div className="mt-0.5"><BalanceCell row={row} /></div></div>
      </div>
      <div className="mt-2"><MemoCell row={row} /></div>
    </article>
  );
}

function StudentCell({ row }: { row: TeacherEconomyHistoryRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-black text-white">{row.student_name}</div>
      <div className="truncate text-[10px] font-bold text-text-muted">{row.brand_name || '브랜드명 없음'}</div>
    </div>
  );
}

function KindBadge({ row }: { row: TeacherEconomyHistoryRow }) {
  const meta = KIND_META[row.kind];
  const label = row.raw_event_type === 'CONSUME_RESERVED' ? 'PASS 사용' : meta.label;
  return <span className={cn('inline-flex w-fit rounded-pill border px-2 py-1 text-[10px] font-black', meta.cls)}>{meta.emoji} {label}</span>;
}

function DeltaCell({ row }: { row: TeacherEconomyHistoryRow }) {
  if (row.kind === 'USE' || row.kind === 'INVENTORY') {
    return <span className={row.quantity_delta < 0 ? 'font-black text-danger' : 'font-black text-success'}>{formatDelta(row.quantity_delta)}개</span>;
  }
  if (!row.value_token) return <span className="text-text-muted">—</span>;
  return (
    <div>
      <div className={cn('font-black', row.asset_delta >= 0 ? 'text-success' : 'text-danger')}>{formatDelta(row.asset_delta)} {row.value_token}</div>
      {row.quantity > 0 && row.item_name && <div className="mt-0.5 text-[10px] font-bold text-text-muted">{row.item_name} ×{row.quantity}</div>}
    </div>
  );
}

function BalanceCell({ row }: { row: TeacherEconomyHistoryRow }) {
  if (row.balance_after === null || !row.value_token) return <span className="text-text-muted">—</span>;
  return <span className="font-black text-text-primary">{formatNumber(row.balance_after)} {row.value_token}</span>;
}

function MemoCell({ row }: { row: TeacherEconomyHistoryRow }) {
  return (
    <div className="min-w-0">
      <div className="break-words font-bold text-text-secondary">{row.memo || row.item_name || row.source_type}</div>
      <div className="mt-0.5 flex flex-wrap gap-2 text-[9px] font-bold text-text-muted">
        <span>{row.source_type}</span>
        {row.tax_amount > 0 && <span>세금 {formatNumber(row.tax_amount)}</span>}
        {row.is_reversed && <span className="text-danger">취소된 원거래</span>}
      </div>
    </div>
  );
}
