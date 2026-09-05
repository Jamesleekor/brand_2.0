import { useQuery } from '@tanstack/react-query';
import { MonthlyMvpGallery } from '@/components/shared/MonthlyMvpGallery';
import { LoadingSpinner } from '@/components/shared/components';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { recordsHistoryRpc, type MonthlyMvpArchiveRow } from '@/lib/rpc/records_history_rpc';
import { supabase } from '@/lib/supabase/client';

export function RecordsMonthlyMvpPanel() {
  const archiveQ = useQuery({
    queryKey: ['f4d-monthly-mvp-archive'],
    queryFn: () => recordsHistoryRpc.monthlyMvpArchive(supabase),
    staleTime: 5 * 60 * 1000,
  });

  const rows = archiveQ.data?.rows ?? [];
  const rowsByYear = new Map<number, MonthlyMvpArchiveRow[]>();
  rows.forEach((row) => {
    const yearRows = rowsByYear.get(row.school_year) ?? [];
    yearRows.push(row);
    rowsByYear.set(row.school_year, yearRows);
  });

  const awardCounts = rows.reduce<Map<string, number>>((acc, row) => {
    acc.set(row.winner_display_name, (acc.get(row.winner_display_name) ?? 0) + 1);
    return acc;
  }, new Map());
  const mostAwards = Math.max(0, ...Array.from(awardCounts.values()));
  const leaders = Array.from(awardCounts.entries())
    .filter(([, count]) => count === mostAwards && count > 0)
    .map(([name]) => name);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-card-lg border border-gold/35 bg-[linear-gradient(145deg,rgba(255,217,61,0.11),rgba(177,151,252,0.08)_45%,rgba(15,11,26,0.86))] p-4 sm:p-6">
        <div aria-hidden="true" className="absolute -right-8 -top-10 text-8xl sm:text-9xl opacity-[0.055]">👑</div>
        <div className="relative">
          <div className="text-2xs font-black tracking-[0.20em] text-gold">B.R.A.N.D MONTHLY MVP ARCHIVE</div>
          <h2 className="font-display text-2xl sm:text-3xl text-white mt-1">👑 월간 MVP</h2>
          <p className="text-sm sm:text-base text-gold font-extrabold mt-2">한 달을 대표해 왕관을 쓴 이들의 연대기</p>
          <p className="text-xs sm:text-sm text-text-secondary font-bold mt-3 max-w-3xl leading-relaxed">
            최종 수상자뿐 아니라 그 달의 공식 본선 후보까지 함께 보존합니다. 해가 바뀌어도 월간 MVP의 역사는 사라지지 않습니다.
          </p>
        </div>
      </section>

      {archiveQ.isLoading ? (
        <div className="py-12 flex flex-col items-center gap-3 text-text-muted">
          <LoadingSpinner size="lg" />
          <div className="text-sm font-bold">역대 왕관의 기록을 불러오고 있어요.</div>
        </div>
      ) : archiveQ.isError ? (
        <Feature4ErrorPanel domain="F4D" error={archiveQ.error} onRetry={() => void archiveQ.refetch()} />
      ) : (
        <>
          {mostAwards > 0 && (
            <section className="rounded-card-md border border-gold/25 bg-gold/[0.04] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-2xs text-text-muted font-black">현재 아카이브 기준 최다 수상</div>
                  <div className="text-sm font-extrabold text-text-primary mt-1">{leaders.join(' · ')}</div>
                </div>
                <div className="font-display text-xl text-gold">{mostAwards}회</div>
              </div>
            </section>
          )}

          <section className="space-y-4">
            <div>
              <h3 className="font-display text-lg text-brand-gradient">📜 월간 MVP 연대기</h3>
              <div className="text-xs text-text-muted font-bold mt-1">우승자는 왕관으로, 나머지 공식 본선 진출자는 후보 기록으로 함께 남습니다.</div>
            </div>

            {Array.from(rowsByYear.entries())
              .sort(([a], [b]) => a - b)
              .map(([year, yearRows], index, years) => (
                <div key={year} className="space-y-4">
                  <YearArchive year={year} rows={yearRows} />
                  {index < years.length - 1 && renderGapBetween(year, years[index + 1][0], archiveQ.data?.gap_eras ?? [])}
                </div>
              ))}
          </section>
        </>
      )}

      <details className="group rounded-card-md border border-line bg-bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-text-primary">🖼️ 월간 MVP 갤러리</div>
            <div className="text-xs text-text-muted font-bold mt-1">등록된 이미지와 기존 MVP 전시는 여기에서 함께 볼 수 있습니다.</div>
          </div>
          <span className="text-text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-3 sm:px-4 py-4">
          <MonthlyMvpGallery variant="records" />
        </div>
      </details>
    </div>
  );
}

function YearArchive({ year, rows }: { year: number; rows: MonthlyMvpArchiveRow[] }) {
  const sorted = [...rows].sort((a, b) => a.month_no - b.month_no);

  return (
    <section className="rounded-card-lg border border-line bg-bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-line bg-bg-deep/70 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-display text-lg text-text-primary">{year}년</div>
          <div className="text-2xs text-text-muted font-bold mt-0.5">공식 월간 MVP {sorted.length}회 기록</div>
        </div>
        <span className="rounded-pill border border-gold/25 bg-gold/10 px-2.5 py-1 text-2xs font-black text-gold">OFFICIAL ARCHIVE</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-px bg-line">
        {sorted.map((row) => (
          <MvpMonthCard key={row.period_key} row={row} />
        ))}
      </div>
    </section>
  );
}

function MvpMonthCard({ row }: { row: MonthlyMvpArchiveRow }) {
  const finalists = row.finalists.filter((name) => name !== row.winner_display_name);

  return (
    <article className="bg-bg-card px-3.5 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-black text-text-muted">{row.month_no}월</span>
        {row.finalists.length === 3 && (
          <span className="rounded-pill border border-line bg-bg-deep px-2 py-0.5 text-[9px] font-bold text-text-muted">본선 3인</span>
        )}
      </div>

      <div className="mt-2 rounded-card-md border border-gold/30 bg-gold/[0.06] px-3 py-2.5">
        <div className="text-[10px] font-black text-gold">👑 FINAL MVP</div>
        <div className="font-display text-base text-white mt-0.5">{row.winner_display_name}</div>
      </div>

      <div className="mt-2.5">
        <div className="text-[10px] font-black text-text-muted">본선 후보</div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {finalists.map((name) => (
            <span key={`${row.period_key}-${name}`} className="rounded-pill border border-line bg-bg-deep px-2 py-1 text-[10px] font-bold text-text-secondary">{name}</span>
          ))}
        </div>
      </div>
    </article>
  );
}

function renderGapBetween(startYear: number, endYear: number, gaps: Array<{ start_year: number; end_year: number; title: string; subtitle: string }>) {
  const gap = gaps.find((item) => item.start_year > startYear && item.end_year < endYear);
  if (!gap) return null;

  return (
    <div key={`${gap.start_year}-${gap.end_year}`} className="relative overflow-hidden rounded-card-md border border-dashed border-line bg-bg-deep/80 px-4 py-5 text-center">
      <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line/60" />
      <div className="relative inline-block bg-bg-deep px-5">
        <div className="text-2xs tracking-[0.18em] text-text-muted font-black">{gap.start_year}–{gap.end_year}</div>
        <div className="font-display text-lg text-text-secondary mt-1">{gap.title}</div>
        <div className="text-xs text-text-muted font-bold mt-1">{gap.subtitle}</div>
      </div>
    </div>
  );
}
