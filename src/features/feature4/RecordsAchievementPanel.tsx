import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/components';
import type { AchievementCatalogRow } from '@/lib/rpc/achievement_a1_rpc';
import { formatDate, formatNumber } from '@/lib/utils/format';

const PAGE_SIZE = 8;

export function RecordsAchievementPanel({ rows }: { rows: AchievementCatalogRow[] }) {
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('ALL');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const grades = useMemo(() => Array.from(new Set(rows.map((row) => row.grade).filter(Boolean))), [rows]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (grade !== 'ALL' && row.grade !== grade) return false;
      if (!keyword) return true;
      return `${row.name} ${row.condition_text}`.toLocaleLowerCase().includes(keyword);
    });
  }, [rows, search, grade]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const changeSearch = (value: string) => { setSearch(value); setPage(0); };
  const changeGrade = (value: string) => { setGrade(value); setPage(0); };

  if (!rows.length) {
    return <EmptyState emoji="🏆" title="아직 획득한 업적이 없어요" description="업적을 달성하면 획득 시점과 보상이 이곳에 쌓입니다." />;
  }

  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-text-primary">🏆 획득 업적</h3>
          <p className="text-xs text-text-secondary mt-1">현재 업적 SSOT 기준으로 획득한 기록을 검색하고 상세 조건을 확인합니다.</p>
        </div>
        <Link to="/achievement" className="btn-secondary text-xs">업적도감 열기</Link>
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="relative block">
          <span className="sr-only">업적 검색</span>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">🔎</span>
          <input
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="업적 이름·조건 검색"
            className="w-full rounded-card-md border border-line bg-bg-deep py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-bv/60"
          />
        </label>
        <select
          value={grade}
          onChange={(event) => changeGrade(event.target.value)}
          className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-xs font-black text-text-secondary outline-none focus:border-bv/60"
          aria-label="업적 등급 필터"
        >
          <option value="ALL">전체 등급</option>
          {grades.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between gap-3 text-2xs text-text-muted font-bold">
        <span>전체 {formatNumber(rows.length)}개 · 검색 결과 {formatNumber(filtered.length)}개</span>
        {(search || grade !== 'ALL') && <button type="button" onClick={() => { changeSearch(''); changeGrade('ALL'); }} className="text-bv font-black">필터 초기화</button>}
      </div>

      {!pageRows.length ? (
        <CompactEmpty text="조건에 맞는 업적이 없습니다." />
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {pageRows.map((row) => {
            const open = selectedId === row.id;
            return (
              <article key={row.id} className={`rounded-card-md border bg-bg-deep p-3 transition ${open ? 'border-bv/50' : 'border-line'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-2xs font-black text-bv">{row.grade}{row.is_equipped ? ' · 장착 중' : ''}</div>
                    <div className="text-sm font-extrabold text-text-primary mt-1 break-words">{row.name}</div>
                  </div>
                  <span className="text-lg">{row.is_secret ? '🌌' : '🏅'}</span>
                </div>
                <div className={`text-xs text-text-secondary mt-2 ${open ? '' : 'line-clamp-2'}`}>{row.condition_text}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {row.reward_bv > 0 && <RewardChip text={`+${formatNumber(row.reward_bv)} BV`} />}
                  {row.reward_gold > 0 && <RewardChip text={`+${formatNumber(row.reward_gold)} GOLD`} />}
                  {row.reward_crystal > 0 && <RewardChip text={`+${formatNumber(row.reward_crystal)} CRYSTAL`} />}
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="text-2xs text-text-muted font-bold">{row.achieved_at ? formatDate(row.achieved_at, { year: true }) : '획득일 미기록'}</div>
                  <button type="button" onClick={() => setSelectedId(open ? null : row.id)} className="text-2xs font-black text-bv">{open ? '접기' : '상세보기'}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <Pager page={safePage} pageCount={pageCount} onPage={setPage} />
      )}
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

function RewardChip({ text }: { text: string }) {
  return <span className="rounded-pill border border-gold/20 bg-gold/5 px-2 py-1 text-2xs text-gold font-black">{text}</span>;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep px-4 py-8 text-center text-sm text-text-muted font-bold">{text}</div>;
}
