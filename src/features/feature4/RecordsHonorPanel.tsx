import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { RecordsHonorOfficialPanels } from '@/features/feature4/RecordsHonorOfficialPanels';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { supabase } from '@/lib/supabase/client';
import { recordsHistoryRpc, type HallKey, type HallOfGloryEntry } from '@/lib/rpc/records_history_rpc';
import { formatNumber } from '@/lib/utils/format';

const RANK_LABEL: Record<string, string> = {
  TIER: '티어',
  BRAND_VALUE: '브랜드 가치',
  GOLD_ASSET: 'GOLD 자산',
  CRYSTAL_ASSET: 'CRYSTAL 자산',
  ACHIEVEMENT_COUNT: '업적 수',
  CONTRIBUTION: '기여도',
};

type HallDefinition = {
  key: HallKey;
  emoji: string;
  title: string;
  subtitle: string;
  special?: boolean;
};

const HALLS: HallDefinition[] = [
  { key: 'PIONEERS', emoji: '🚪', title: 'B.R.A.N.D의 개척자', subtitle: '누가 처음 문을 열었는가' },
  { key: 'THRONE', emoji: '👑', title: '정점의 왕좌', subtitle: '현재까지 숫자로 증명된 절대 정점' },
  { key: 'REPEATED_CROWNS', emoji: '♛', title: '왕관을 거듭 쓴 자', subtitle: '월간 MVP 무대에 반복해서 이름을 올린 이들' },
  { key: 'ASCENT', emoji: '☄️', title: '비상의 궤적', subtitle: '가장 가파른 성장의 순간' },
  { key: 'GOLDEN_CHRONICLE', emoji: '🪙', title: '황금의 연대기', subtitle: 'B.R.A.N.D 경제를 움직이고 나눈 기록' },
  { key: 'GUILD_HEGEMONY', emoji: '⚔️', title: '길드 패권사', subtitle: '길드의 승리와 기여가 남긴 역사' },
  { key: 'ARCADE_RULERS', emoji: '🕹️', title: '아케이드의 지배자', subtitle: 'FINALIZED 기록으로 증명되는 게임의 왕좌' },
  { key: 'CONSTELLATION', emoji: '🌌', title: '위업의 성좌', subtitle: '희귀하고 높은 업적을 세운 이들의 특별관', special: true },
  { key: 'SOVEREIGN_PROOF', emoji: '🏆', title: '제왕의 증명', subtitle: '여러 영역에서 동시에 가치를 증명한 이들의 특별관', special: true },
];

export function RecordsHonorPanel({ data, grouped, studentId }: { data: any; grouped: Map<string, any[]>; studentId: number | null }) {
  const historyQ = useQuery({
    queryKey: ['f4d-hall-of-glory'],
    queryFn: () => recordsHistoryRpc.hallOfGlory(supabase),
    staleTime: 5 * 60 * 1000,
  });

  const entriesByHall = new Map<HallKey, HallOfGloryEntry[]>();
  (historyQ.data?.entries ?? []).forEach((entry) => {
    const rows = entriesByHall.get(entry.hall_key) ?? [];
    rows.push(entry);
    entriesByHall.set(entry.hall_key, rows);
  });

  return (
    <div id="hall-of-glory-top" className="space-y-7 sm:space-y-9">
      <section className="relative overflow-hidden rounded-card-lg border border-gold/40 bg-[radial-gradient(circle_at_85%_15%,rgba(255,217,61,0.13),transparent_28%),linear-gradient(145deg,rgba(255,217,61,0.11),rgba(177,151,252,0.07)_48%,rgba(15,11,26,0.94))] px-5 py-6 sm:px-8 sm:py-9">
        <div aria-hidden="true" className="absolute -right-10 -top-14 text-[10rem] opacity-[0.045] sm:text-[13rem]">🏛️</div>
        <div className="relative max-w-4xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-gold/35 bg-gold/10 px-3 py-1 text-2xs font-black tracking-[0.16em] text-gold">HALL OF GLORY</span>
            <span className="text-xs font-bold text-text-muted">B.R.A.N.D 전 시즌 통합 역사관</span>
          </div>
          <h2 className="mt-4 font-display text-3xl text-white sm:text-4xl [word-break:keep-all]">🏛️ 영광의 전당</h2>
          <p className="mt-2 text-base font-extrabold text-gold sm:text-lg [word-break:keep-all]">시간을 넘어 B.R.A.N.D에 이름을 새긴 이들의 기록</p>
          <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-text-secondary [word-break:keep-all]">
            순위를 빠르게 훑는 곳이 아니라, 여러 해가 지나도 기억할 가치가 있는 최초의 도전과 절대 기록, 성장, 길드의 승리와 특별한 위업을 한 자리씩 전시하는 공간입니다.
          </p>
          <div className="mt-4 text-2xs font-bold text-text-muted">공식 참가자 기준으로 기록을 산정합니다.</div>
        </div>
      </section>

      {historyQ.isLoading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-text-muted">
          <LoadingSpinner size="lg" />
          <div className="text-sm font-bold">B.R.A.N.D의 역사를 펼치고 있어요.</div>
        </div>
      ) : historyQ.isError ? (
        <Feature4ErrorPanel domain="F4D" error={historyQ.error} onRetry={() => void historyQ.refetch()} />
      ) : (
        <>
          <HallDirectory entriesByHall={entriesByHall} />

          {(historyQ.data?.gap_eras ?? []).map((gap) => (
            <section key={`${gap.start_year}-${gap.end_year}`} className="relative overflow-hidden rounded-card-lg border border-dashed border-line bg-bg-deep/70 px-5 py-6 text-center sm:px-8">
              <div aria-hidden="true" className="absolute inset-x-8 top-1/2 h-px bg-line/50" />
              <div className="relative mx-auto inline-block bg-bg-deep px-6 sm:px-10">
                <div className="text-2xs font-black tracking-[0.2em] text-text-muted">{gap.start_year}–{gap.end_year}</div>
                <div className="mt-1 font-display text-xl text-text-secondary">{gap.title}</div>
                <div className="mt-1 text-xs font-bold text-text-muted">{gap.subtitle}</div>
              </div>
            </section>
          ))}

          <div className="space-y-10 sm:space-y-12">
            {HALLS.map((hall, index) => (
              <HallSection
                key={hall.key}
                hall={hall}
                index={index + 1}
                entries={entriesByHall.get(hall.key) ?? []}
              />
            ))}
          </div>
        </>
      )}

      <details className="group rounded-card-md border border-line bg-bg-card/75">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <div className="text-sm font-extrabold text-text-primary">📜 공식 확정 원장 참고</div>
            <div className="mt-1 text-xs font-bold text-text-muted">길드·Arcade의 FINALIZED 원본은 필요할 때만 펼쳐 확인합니다.</div>
          </div>
          <span className="text-text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-4 py-4">
          <RecordsHonorOfficialPanels />
        </div>
      </details>

      <details className="group rounded-card-md border border-line bg-bg-card/75">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <div className="text-sm font-extrabold text-text-primary">📚 현재 시즌 참고 기록</div>
            <div className="mt-1 text-xs font-bold text-text-muted">최신 랭킹과 학급 통계는 영광의 전당과 분리된 보조 자료입니다.</div>
          </div>
          <span className="text-text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-5 border-t border-line px-4 py-4">
          <section>
            <SectionTitle emoji="📊" title="최신 공식 랭킹" description={data?.date ? `${data.date} 기준 · 각 부문 TOP 5` : '선생님이 확정한 가장 최근 랭킹 snapshot'} />
            {grouped.size === 0 ? (
              <EmptyState emoji="📊" title="아직 공식 랭킹 snapshot이 없어요" description="선생님이 기록 갱신을 실행하면 공식 참가자만 포함한 랭킹이 생성됩니다." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {Array.from(grouped.entries()).map(([type, rows]) => (
                  <div key={type} className="rounded-card-md border border-line bg-bg-deep p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-bv">{RANK_LABEL[type] || type}</div>
                      <OfficialBadge compact />
                    </div>
                    {rows.slice(0, 5).map((rank: any) => (
                      <div key={`${type}-${rank.student_id}`} className={`flex items-center justify-between gap-3 rounded-card-sm px-2 py-1.5 text-xs ${rank.student_id === studentId ? 'bg-gold/10' : ''}`}>
                        <span className={rank.student_id === studentId ? 'font-black text-gold' : 'font-bold text-text-secondary'}>
                          {rank.rank_position}. {rank.student?.name || rank.student?.brand_name}
                          {rank.student_id === studentId && <span className="ml-1 text-2xs">나</span>}
                        </span>
                        <span className="font-mono text-text-primary">{formatNumber(rank.value)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle emoji="📈" title="학급 최신 통계" description="공식 참가자 기준으로 생성된 가장 최근 일일 통계 snapshot" />
            {!data?.stats ? (
              <EmptyState emoji="📈" title="아직 학급 통계 snapshot이 없어요" description="선생님이 기록 갱신을 실행하면 자산·거래 통계가 이곳에 표시됩니다." />
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <OfficialBadge />
                  <span className="text-2xs font-bold text-text-muted">{data.stats.stat_date} 기준</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Mini label="학급 총 GOLD" value={formatNumber(data.stats.total_gold)} />
                  <Mini label="학급 총 BV" value={formatNumber(data.stats.total_bv)} />
                  <Mini label="학급 총 CRYSTAL" value={formatNumber(data.stats.total_crystal)} />
                  <Mini label="snapshot 거래" value={formatNumber(data.stats.transactions_count)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Mini label="Gini GOLD" value={Number(data.stats.gini_gold).toFixed(3)} />
                  <Mini label="Gini BV" value={Number(data.stats.gini_bv).toFixed(3)} />
                </div>
              </div>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}

function HallDirectory({ entriesByHall }: { entriesByHall: Map<HallKey, HallOfGloryEntry[]> }) {
  return (
    <nav aria-label="영광의 전당 전시관 안내" className="rounded-card-lg border border-line bg-bg-card px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xs font-black tracking-[0.18em] text-text-muted">EXHIBITION GUIDE</div>
          <h3 className="mt-1 font-display text-lg text-text-primary">전시관 안내</h3>
        </div>
        <div className="hidden text-2xs font-bold text-text-muted sm:block">보고 싶은 전시관으로 이동</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {HALLS.map((hall, index) => {
          const recordCount = countRecordGroups(entriesByHall.get(hall.key) ?? []);
          return (
            <a
              key={hall.key}
              href={`#hall-${hall.key.toLowerCase()}`}
              className="group flex min-w-[180px] flex-1 items-center gap-2 rounded-card-md border border-line bg-bg-deep/65 px-3 py-2.5 transition hover:border-gold/35 hover:bg-gold/[0.04]"
            >
              <span className="text-lg" aria-hidden="true">{hall.emoji}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-extrabold text-text-primary group-hover:text-gold">{index + 1}. {hall.title}</span>
                <span className="mt-0.5 block text-[10px] font-bold text-text-muted">{recordCount > 0 ? `${recordCount}개의 기록` : '아직 빈 전시관'}</span>
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function HallSection({ hall, entries, index }: { hall: HallDefinition; entries: HallOfGloryEntry[]; index: number }) {
  const grouped = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = grouped.get(entry.record_type) ?? [];
    rows.push(entry);
    grouped.set(entry.record_type, rows);
  });

  const recordGroups = Array.from(grouped.entries());

  return (
    <section
      id={`hall-${hall.key.toLowerCase()}`}
      className={`scroll-mt-24 overflow-hidden rounded-card-lg border ${hall.special ? 'border-gold/35 bg-[radial-gradient(circle_at_92%_0%,rgba(255,217,61,0.08),transparent_26%),linear-gradient(145deg,rgba(255,217,61,0.045),rgba(177,151,252,0.055),rgba(15,11,26,0.88))]' : 'border-line bg-bg-card'}`}
    >
      <header className="relative border-b border-line/80 px-5 py-5 sm:px-7 sm:py-6">
        <div aria-hidden="true" className="absolute right-5 top-1/2 -translate-y-1/2 font-display text-6xl text-white/[0.025] sm:right-8 sm:text-7xl">
          {String(index).padStart(2, '0')}
        </div>
        <div className="relative flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-card-md border text-2xl ${hall.special ? 'border-gold/30 bg-gold/10' : 'border-line bg-bg-deep'}`} aria-hidden="true">
            {hall.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs font-black tracking-[0.15em] text-text-muted">HALL {String(index).padStart(2, '0')}</span>
              {hall.special && <span className="rounded-pill border border-gold/30 bg-gold/10 px-2 py-0.5 text-[9px] font-black text-gold">SPECIAL HALL</span>}
            </div>
            <h3 className="mt-1 font-display text-xl text-text-primary sm:text-2xl [word-break:keep-all]">{hall.title}</h3>
            <p className="mt-1 text-xs font-bold text-text-muted sm:text-sm [word-break:keep-all]">{hall.subtitle}</p>
          </div>
          {recordGroups.length > 0 && (
            <div className="hidden shrink-0 text-right sm:block">
              <div className="font-display text-xl text-gold">{recordGroups.length}</div>
              <div className="text-[10px] font-bold text-text-muted">전시 기록</div>
            </div>
          )}
        </div>
      </header>

      <div className="px-4 py-5 sm:px-7 sm:py-7">
        {recordGroups.length === 0 ? (
          <EmptyHall />
        ) : (
          <div className="space-y-5 sm:space-y-6">
            {recordGroups.map(([recordType, rows], groupIndex) => (
              <RecordGroup key={recordType} rows={rows} exhibitionNo={groupIndex + 1} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyHall() {
  return (
    <div className="rounded-card-lg border border-dashed border-line bg-bg-deep/55 px-5 py-8 text-center sm:py-10">
      <div className="text-3xl opacity-60" aria-hidden="true">◇</div>
      <div className="mt-3 font-display text-base text-text-secondary">아직 주인을 기다리는 전시관</div>
      <div className="mx-auto mt-2 max-w-md text-xs font-bold leading-6 text-text-muted [word-break:keep-all]">
        공식 조건을 충족한 기록이 탄생하면 이 공간에 이름과 기록이 하나의 역사로 새겨집니다.
      </div>
    </div>
  );
}

function RecordGroup({ rows, exhibitionNo }: { rows: HallOfGloryEntry[]; exhibitionNo: number }) {
  const orderedRows = [...rows].sort((a, b) => {
    const rankA = a.rank_position ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank_position ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.sort_order - b.sort_order;
  });

  const first = orderedRows[0];
  const isRanking = orderedRows.length > 1 && orderedRows.some((row) => row.rank_position != null);
  const hasLiveDerived = orderedRows.some((row) => row.source_kind === 'PRODUCTION_DERIVED');
  const hasHistorical = orderedRows.some((row) => row.source_kind !== 'PRODUCTION_DERIVED');

  return (
    <article className="relative overflow-hidden rounded-card-lg border border-line bg-bg-deep/68 px-4 py-4 sm:px-6 sm:py-5">
      <div aria-hidden="true" className="absolute -right-2 -top-4 font-display text-7xl text-white/[0.02]">{String(exhibitionNo).padStart(2, '0')}</div>
      <div className="relative">
        <div className="flex flex-col gap-3 border-b border-line/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-black tracking-[0.16em] text-text-muted">HONOR RECORD {String(exhibitionNo).padStart(2, '0')}</div>
            <h4 className="mt-1 text-sm font-black leading-6 text-text-primary sm:text-base [word-break:keep-all]">{first.title}</h4>
            {first.subtitle && <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-text-muted [word-break:keep-all]">{first.subtitle}</p>}
            {first.description && <p className="mt-2 max-w-3xl text-xs font-semibold leading-6 text-text-secondary [word-break:keep-all]">{first.description}</p>}
          </div>
          <HallRecordBadge live={hasLiveDerived} mixed={hasLiveDerived && hasHistorical} />
        </div>

        {isRanking ? (
          <RankingExhibit rows={orderedRows} />
        ) : (
          <SingleExhibit entry={first} />
        )}
      </div>
    </article>
  );
}

function RankingExhibit({ rows }: { rows: HallOfGloryEntry[] }) {
  const [first, ...rest] = rows;

  return (
    <div className="mt-5 space-y-3">
      <HonorPlaque entry={first} featured />
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {rest.map((entry) => (
            <div key={entry.id} className="min-w-[220px] flex-1">
              <HonorPlaque entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HonorPlaque({ entry, featured = false }: { entry: HallOfGloryEntry; featured?: boolean }) {
  const period = getEntryPeriod(entry);
  const empty = entry.subject_kind === 'EMPTY_THRONE';

  return (
    <div className={`relative overflow-hidden rounded-card-md border ${featured ? 'border-gold/35 bg-[linear-gradient(135deg,rgba(255,217,61,0.08),rgba(18,13,31,0.82))] px-4 py-4 sm:px-5 sm:py-5' : 'border-line bg-bg-card/75 px-4 py-3.5'} ${empty ? 'border-dashed' : ''}`}>
      {featured && <div aria-hidden="true" className="absolute -right-4 -top-8 text-7xl opacity-[0.04]">♛</div>}
      <div className="relative flex items-center gap-3">
        {entry.rank_position != null && (
          <div className={`flex shrink-0 items-center justify-center rounded-full border font-display ${featured ? 'h-11 w-11 border-gold/45 bg-gold/10 text-xl text-gold' : 'h-8 w-8 border-line bg-bg-deep text-sm text-text-secondary'}`}>
            {entry.rank_position}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className={`font-extrabold text-text-primary [word-break:keep-all] ${featured ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'}`}>
            {entry.subject_display_name}
          </div>
          {entry.subject_brand_name && entry.subject_brand_name !== entry.subject_display_name && (
            <div className="mt-0.5 truncate text-[10px] font-bold text-text-muted">{entry.subject_brand_name}</div>
          )}
          {period && <div className="mt-1 text-[10px] font-bold text-text-muted">{period}{entry.source_kind === 'PRODUCTION_DERIVED' ? ' · 현재 공식' : ''}</div>}
        </div>
        <div className={`shrink-0 text-right font-mono font-black text-gold ${featured ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'}`}>
          {formatRecordValue(entry)}
        </div>
      </div>
    </div>
  );
}

function SingleExhibit({ entry }: { entry: HallOfGloryEntry }) {
  const empty = entry.subject_kind === 'EMPTY_THRONE';
  const period = getEntryPeriod(entry);

  return (
    <div className={`mt-5 rounded-card-md border px-4 py-5 sm:px-6 sm:py-6 ${empty ? 'border-dashed border-gold/30 bg-gold/[0.025]' : 'border-gold/25 bg-[linear-gradient(135deg,rgba(255,217,61,0.055),rgba(18,13,31,0.74))]'}`}>
      {empty ? (
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-gold/30 text-2xl text-gold/60" aria-hidden="true">♔</div>
          <div className="min-w-0">
            <div className="font-display text-lg text-text-secondary [word-break:keep-all]">{entry.subject_display_name}</div>
            <div className="mt-1 text-xs font-bold leading-5 text-text-muted [word-break:keep-all]">아직 누구의 이름도 새겨지지 않은 왕좌입니다.</div>
          </div>
          <div className="ml-auto shrink-0 font-mono text-sm font-black text-gold/70">{formatRecordValue(entry)}</div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <div className="text-[10px] font-black tracking-[0.15em] text-text-muted">HONOREE</div>
            <div className="mt-1 font-display text-2xl text-gold sm:text-3xl [word-break:keep-all]">{entry.subject_display_name}</div>
            {entry.subject_brand_name && entry.subject_brand_name !== entry.subject_display_name && (
              <div className="mt-1 text-xs font-bold text-text-muted">{entry.subject_brand_name}</div>
            )}
            {period && <div className="mt-2 text-xs font-bold text-text-secondary">{period}{entry.source_kind === 'PRODUCTION_DERIVED' ? ' · 현재 공식' : ''}</div>}
          </div>
          {entry.value_primary != null && (
            <div className="md:text-right">
              <div className="text-[10px] font-black tracking-[0.15em] text-text-muted">RECORD</div>
              <div className="mt-1 font-mono text-xl font-black text-text-primary sm:text-2xl whitespace-nowrap">{formatRecordValue(entry)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getEntryPeriod(entry: HallOfGloryEntry) {
  if (entry.period_label) return entry.period_label;
  if (entry.season_label) return entry.season_label;
  if (entry.school_year != null) return `${entry.school_year}`;
  return '';
}

function countRecordGroups(entries: HallOfGloryEntry[]) {
  return new Set(entries.map((entry) => entry.record_type)).size;
}

function formatRecordValue(entry: HallOfGloryEntry) {
  if (entry.value_primary == null) return '';

  const value = formatNumber(entry.value_primary);
  const unit = entry.unit ? ` ${entry.unit}` : '';
  if (entry.denominator != null) {
    const rate = entry.comparison_value != null && entry.record_type.includes('RATE')
      ? ` · ${Number(entry.comparison_value).toFixed(2)}%`
      : '';
    return `${value} / ${formatNumber(entry.denominator)}${unit}${rate}`;
  }
  if (entry.record_type === 'CLOSEST_SEASON_WIN' && entry.comparison_value != null) {
    return `${value}${unit} · ${Number(entry.comparison_value).toFixed(4)}%`;
  }
  return `${value}${unit}`;
}

function SectionTitle({ emoji, title, description }: { emoji: string; title: string; description: string }) {
  return (
    <div className="mb-2">
      <h2 className="font-display text-lg text-brand-gradient">{emoji} {title}</h2>
      <div className="mt-1 text-xs font-bold text-text-muted">{description}</div>
    </div>
  );
}

function HallRecordBadge({ live, mixed = false, compact = false }: { live: boolean; mixed?: boolean; compact?: boolean }) {
  const label = mixed ? '역대 · 현재 통합' : live ? '현재 공식 기록' : '공식 확정 기록';
  const tone = live ? 'border-bv/30 bg-bv/10 text-bv' : 'border-gold/30 bg-gold/10 text-gold';
  return (
    <span className={`w-fit shrink-0 rounded-pill border font-black ${tone} ${compact ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-2xs'} whitespace-nowrap`}>
      {label}
    </span>
  );
}

function OfficialBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`rounded-pill border border-gold/30 bg-gold/10 font-black text-gold ${compact ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-2xs'}`}>
      공식 확정 기록
    </span>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card p-3">
      <div className="text-2xs font-bold text-text-muted">{label}</div>
      <div className="mt-1 font-display text-lg text-gold">{value}</div>
    </div>
  );
}
