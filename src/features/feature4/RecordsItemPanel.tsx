import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/components';
import type { StudentItemHistoryRow } from '@/lib/rpc/inventory_market_rpc';
import { formatDateTime, formatDelta, formatNumber } from '@/lib/utils/format';

const PAGE_SIZE = 10;

type EventFilter = 'ALL' | 'PURCHASE' | 'SALE' | 'USE';

const EVENT_LABEL: Record<string, { emoji: string; label: string }> = {
  PURCHASE: { emoji: '🛒', label: '구매' },
  SALE: { emoji: '💰', label: '판매' },
  USE: { emoji: '🎯', label: '사용' },
};

export function RecordsItemPanel({ rows, total }: { rows: StudentItemHistoryRow[]; total: number }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<EventFilter>('ALL');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (filter !== 'ALL' && row.event_type !== filter) return false;
      if (!keyword) return true;
      return row.item_name.toLocaleLowerCase().includes(keyword);
    });
  }, [rows, search, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (!rows.length) {
    return <EmptyState emoji="🎒" title="아직 아이템 이용 기록이 없어요" description="구매·판매·사용 기록이 생기면 이곳에 쌓입니다." />;
  }

  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-text-primary">🎒 아이템 이용 기록</h3>
          <p className="text-xs text-text-secondary mt-1">시장·인벤토리 Event 기록의 최근 내역을 검색하고 유형별로 확인합니다.</p>
        </div>
        <Link to="/market/history" className="btn-secondary text-xs">전체 아이템 기록</Link>
      </div>

      <label className="relative block">
        <span className="sr-only">아이템 기록 검색</span>
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">🔎</span>
        <input
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          placeholder="아이템 이름 검색"
          className="w-full rounded-card-md border border-line bg-bg-deep py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-bv/60"
        />
      </label>

      <div className="grid grid-cols-4 gap-1.5">
        {(['ALL', 'PURCHASE', 'SALE', 'USE'] as EventFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => { setFilter(value); setPage(0); }}
            className={`rounded-card-sm border px-2 py-2 text-xs font-black ${filter === value ? 'border-gold/40 bg-gold/10 text-gold' : 'border-line bg-bg-deep text-text-secondary'}`}
          >
            {value === 'ALL' ? '전체' : EVENT_LABEL[value].label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-text-muted font-bold">
        <span>불러온 {formatNumber(rows.length)}건 · 검색 결과 {formatNumber(filtered.length)}건</span>
        {total > rows.length && <span>전체 {formatNumber(total)}건 중 최근 {formatNumber(rows.length)}건 범위</span>}
      </div>

      {!pageRows.length ? (
        <CompactEmpty text="조건에 맞는 아이템 기록이 없습니다." />
      ) : (
        <div className="divide-y divide-line/60">
          {pageRows.map((row) => {
            const event = EVENT_LABEL[row.event_type] ?? { emoji: '📦', label: row.event_type };
            const open = selectedId === row.inventory_event_id;
            return (
              <article key={row.inventory_event_id} className="py-3 flex gap-3">
                <div className="w-9 h-9 rounded-full bg-bg-deep border border-line flex items-center justify-center shrink-0">{event.emoji}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-text-primary break-words">{row.item_name}</div>
                    <div className="text-xs font-black text-gold">{event.label} · {formatNumber(Math.abs(row.quantity))}개</div>
                  </div>
                  <div className="text-2xs text-text-muted font-bold mt-1.5">{formatDateTime(row.created_at)}</div>
                  <div className="flex flex-wrap gap-2 mt-1 text-2xs font-bold text-text-secondary">
                    {row.gold_delta !== 0 && <span>GOLD {formatDelta(row.gold_delta)}</span>}
                    {row.fulfillment_status && <span>전달 {fulfillmentLabel(row.fulfillment_status)}</span>}
                  </div>
                  {open && (
                    <div className="mt-2 rounded-card-sm border border-line bg-bg-deep px-3 py-2 text-2xs text-text-secondary">
                      Event #{row.inventory_event_id} · 수량 변동 {formatDelta(row.quantity)}
                      {row.fulfillment_status ? ` · 전달 상태 ${fulfillmentLabel(row.fulfillment_status)}` : ''}
                    </div>
                  )}
                  <button type="button" onClick={() => setSelectedId(open ? null : row.inventory_event_id)} className="text-2xs font-black text-bv mt-2">{open ? '접기' : '상세보기'}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > PAGE_SIZE && <Pager page={safePage} pageCount={pageCount} onPage={setPage} />}
    </section>
  );
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
      <button type="button" className="btn-secondary text-xs" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>← 이전</button>
      <span className="text-2xs text-text-muted font-black">{page + 1} / {pageCount}</span>
      <button type="button" className="btn-secondary text-xs" disabled={page + 1 >= pageCount} onClick={() => onPage(Math.min(pageCount - 1, page + 1))}>다음 →</button>
    </div>
  );
}

function fulfillmentLabel(value: string) {
  if (value === 'PENDING') return '대기';
  if (value === 'DELIVERED') return '완료';
  if (value === 'CANCELLED') return '취소';
  return value;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep px-4 py-8 text-center text-sm text-text-muted font-bold">{text}</div>;
}
