import { useMemo, useState } from 'react';
import type { AttendanceDashboard, AttendanceHistoryRow } from '@/lib/rpc/records_rpc';
import { formatNumber } from '@/lib/utils/format';

const PAGE_SIZE = 12;
type AttendanceFilter = 'ALL' | AttendanceHistoryRow['status'];

const ATTENDANCE_LABEL: Record<AttendanceHistoryRow['status'], { label: string; className: string }> = {
  PRESENT: { label: '출석', className: 'text-success border-success/30 bg-success/10' },
  LATE: { label: '지각', className: 'text-warning border-warning/30 bg-warning/10' },
  ABSENT: { label: '결석', className: 'text-danger border-danger/30 bg-danger/10' },
  EXCUSED: { label: '인정결석', className: 'text-text-secondary border-line bg-bg-deep' },
};

export function RecordsAttendancePanel({
  rows,
  dashboard,
  total,
}: {
  rows: AttendanceHistoryRow[];
  dashboard: AttendanceDashboard;
  total: number;
}) {
  const [filter, setFilter] = useState<AttendanceFilter>('ALL');
  const [page, setPage] = useState(0);

  const counts = useMemo(() => ({
    PRESENT: rows.filter((row) => row.status === 'PRESENT').length,
    LATE: rows.filter((row) => row.status === 'LATE').length,
    ABSENT: rows.filter((row) => row.status === 'ABSENT').length,
    EXCUSED: rows.filter((row) => row.status === 'EXCUSED').length,
  }), [rows]);

  const filtered = useMemo(
    () => filter === 'ALL' ? rows : rows.filter((row) => row.status === filter),
    [rows, filter],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const changeFilter = (next: AttendanceFilter) => {
    setFilter(next);
    setPage(0);
  };

  return (
    <section className="space-y-3">
      <div className="rounded-card-md border border-line bg-bg-deep/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge label="B.R.A.N.D 2.0" />
          <span className="text-xs text-text-muted font-bold">서버 확정 출석 기록</span>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          현재 연속 출석과 누적 출석은 서버 대시보드의 공식값을 사용합니다. 아래 상태별 숫자는 현재 불러온 최근 {formatNumber(rows.length)}건 범위의 분포입니다.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Mini label="누적 출석 인정" value={`${formatNumber(dashboard.total_attendance)}일`} />
        <Mini label="현재 연속 출석" value={`${formatNumber(dashboard.current_streak)}일`} />
        <Mini label="지각(표시범위)" value={`${formatNumber(counts.LATE)}일`} />
        <Mini label="결석(표시범위)" value={`${formatNumber(counts.ABSENT)}일`} />
        <Mini label="인정결석(표시범위)" value={`${formatNumber(counts.EXCUSED)}일`} />
      </div>

      <div className="bg-bg-card border border-line rounded-card-md p-4 space-y-4">
        <div>
          <h3 className="font-display text-lg text-text-primary">📅 출석 타임라인</h3>
          <p className="text-xs text-text-secondary mt-1">교사가 확정한 본인의 기록을 최신 날짜부터 상태별로 확인합니다.</p>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          <FilterButton active={filter === 'ALL'} onClick={() => changeFilter('ALL')} label="전체" count={rows.length} />
          <FilterButton active={filter === 'PRESENT'} onClick={() => changeFilter('PRESENT')} label="출석" count={counts.PRESENT} />
          <FilterButton active={filter === 'LATE'} onClick={() => changeFilter('LATE')} label="지각" count={counts.LATE} />
          <FilterButton active={filter === 'ABSENT'} onClick={() => changeFilter('ABSENT')} label="결석" count={counts.ABSENT} />
          <FilterButton active={filter === 'EXCUSED'} onClick={() => changeFilter('EXCUSED')} label="인정" count={counts.EXCUSED} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-text-muted font-bold">
          <span>검색 결과 {formatNumber(filtered.length)}건</span>
          {total > rows.length && <span>전체 {formatNumber(total)}건 중 최근 {formatNumber(rows.length)}건 범위</span>}
        </div>

        {!pageRows.length ? (
          <CompactEmpty text="선택한 상태의 출석 기록이 없습니다." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {pageRows.map((row) => {
              const state = ATTENDANCE_LABEL[row.status];
              return (
                <div key={row.id} className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-text-primary">{formatDateOnly(row.attendance_date)}</div>
                    <div className="text-2xs text-text-muted font-bold mt-1">
                      연속 {formatNumber(row.streak_days)}일 · 누적 {formatNumber(row.total_attendance)}일
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-pill border px-2.5 py-1 text-xs font-black ${state.className}`}>{state.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {filtered.length > PAGE_SIZE && <Pager page={safePage} pageCount={pageCount} onPage={setPage} />}
      </div>
    </section>
  );
}

function FilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-card-sm border px-2 py-2 text-xs font-black transition ${active ? 'border-gold/40 bg-gold/10 text-gold' : 'border-line bg-bg-deep text-text-secondary'}`}
    >
      <span>{label}</span>
      <span className="ml-1 text-2xs opacity-70">{formatNumber(count)}</span>
    </button>
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

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-card border border-line rounded-card-md p-3">
      <div className="text-2xs text-text-muted font-bold">{label}</div>
      <div className="font-display text-lg text-gold mt-1">{value}</div>
    </div>
  );
}

function SourceBadge({ label }: { label: string }) {
  return <span className="rounded-pill border border-gold/35 bg-gold/10 px-2.5 py-1 text-2xs font-black text-gold">{label}</span>;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep px-4 py-8 text-center text-sm text-text-muted font-bold">{text}</div>;
}

function formatDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}
