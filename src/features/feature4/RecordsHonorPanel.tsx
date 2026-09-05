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

const HALLS: Array<{ key: HallKey; emoji: string; title: string; subtitle: string; special?: boolean }> = [
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
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-card-lg border border-gold/35 bg-[linear-gradient(145deg,rgba(255,217,61,0.11),rgba(177,151,252,0.07)_45%,rgba(15,11,26,0.88))] p-4 sm:p-6">
        <div aria-hidden="true" className="absolute -right-8 -top-10 text-8xl sm:text-9xl opacity-[0.055]">🏛️</div>
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-gold/35 bg-gold/10 px-2.5 py-1 text-2xs font-black tracking-[0.14em] text-gold">HALL OF GLORY</span>
            <span className="text-xs text-text-muted font-bold">B.R.A.N.D 전 시즌 통합 역사관</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl text-white mt-3">🏛️ 영광의 전당</h2>
          <p className="text-sm sm:text-base text-gold font-extrabold mt-2">시간을 넘어 B.R.A.N.D에 이름을 새긴 이들의 기록</p>
          <p className="text-xs sm:text-sm text-text-secondary font-bold mt-3 max-w-3xl leading-relaxed">
            지금의 순위가 아니라, 여러 해가 지나도 기억할 가치가 있는 최초의 도전과 절대 기록, 성장, 길드의 승리와 특별한 위업을 전시합니다.
          </p>
          <div className="text-2xs text-text-muted font-bold mt-3">공식 참가자 기준으로 기록을 산정합니다.</div>
        </div>
      </section>

      {historyQ.isLoading ? (
        <div className="py-12 flex flex-col items-center gap-3 text-text-muted">
          <LoadingSpinner size="lg" />
          <div className="text-sm font-bold">B.R.A.N.D의 역사를 펼치고 있어요.</div>
        </div>
      ) : historyQ.isError ? (
        <Feature4ErrorPanel domain="F4D" error={historyQ.error} onRetry={() => void historyQ.refetch()} />
      ) : (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="font-display text-lg text-brand-gradient">🏛️ 역사 전시관</h2>
              <div className="text-xs text-text-muted font-bold mt-1">7개 핵심관과 2개 특별관을 따라 B.R.A.N.D의 주요 위업을 살펴봅니다.</div>
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              {HALLS.map((hall) => (
                <HallSection key={hall.key} hall={hall} entries={entriesByHall.get(hall.key) ?? []} />
              ))}
            </div>
          </section>

          {(historyQ.data?.gap_eras ?? []).map((gap) => (
            <section key={`${gap.start_year}-${gap.end_year}`} className="relative overflow-hidden rounded-card-md border border-dashed border-line bg-bg-deep/75 px-4 py-5 text-center">
              <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line/60" />
              <div className="relative inline-block bg-bg-deep px-5">
                <div className="text-2xs tracking-[0.18em] text-text-muted font-black">{gap.start_year}–{gap.end_year}</div>
                <div className="font-display text-lg text-text-secondary mt-1">{gap.title}</div>
                <div className="text-xs text-text-muted font-bold mt-1">{gap.subtitle}</div>
              </div>
            </section>
          ))}
        </>
      )}

      <details className="group rounded-card-md border border-line bg-bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-text-primary">📜 공식 확정 원장 참고</div>
            <div className="text-xs text-text-muted font-bold mt-1">길드·Arcade의 FINALIZED 기록은 역사관의 근거 자료로 접어둡니다.</div>
          </div>
          <span className="text-text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-4 py-4">
          <RecordsHonorOfficialPanels />
        </div>
      </details>

      <details className="group rounded-card-md border border-line bg-bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-text-primary">📚 현재 시즌 참고 기록</div>
            <div className="text-xs text-text-muted font-bold mt-1">최신 랭킹·학급 통계는 역사 전시의 보조 자료로 접어둡니다.</div>
          </div>
          <span className="text-text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-4 py-4 space-y-5">
          <section>
            <SectionTitle emoji="📊" title="최신 공식 랭킹" description={data?.date ? `${data.date} 기준 · 각 부문 TOP 5` : '선생님이 확정한 가장 최근 랭킹 snapshot'} />
            {grouped.size === 0 ? (
              <EmptyState emoji="📊" title="아직 공식 랭킹 snapshot이 없어요" description="선생님이 기록 갱신을 실행하면 공식 참가자만 포함한 랭킹이 생성됩니다." />
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {Array.from(grouped.entries()).map(([type, rows]) => (
                  <div key={type} className="bg-bg-deep border border-line rounded-card-md p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-black text-bv">{RANK_LABEL[type] || type}</div>
                      <OfficialBadge compact />
                    </div>
                    {rows.slice(0, 5).map((rank: any) => (
                      <div key={`${type}-${rank.student_id}`} className={`flex justify-between items-center text-xs py-1.5 px-2 rounded-card-sm ${rank.student_id === studentId ? 'bg-gold/10' : ''}`}>
                        <span className={rank.student_id === studentId ? 'text-gold font-black' : 'text-text-secondary font-bold'}>
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
                  <span className="text-2xs text-text-muted font-bold">{data.stats.stat_date} 기준</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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

function HallSection({
  hall,
  entries,
}: {
  hall: { key: HallKey; emoji: string; title: string; subtitle: string; special?: boolean };
  entries: HallOfGloryEntry[];
}) {
  const grouped = new Map<string, HallOfGloryEntry[]>();
  entries.forEach((entry) => {
    const rows = grouped.get(entry.record_type) ?? [];
    rows.push(entry);
    grouped.set(entry.record_type, rows);
  });

  return (
    <section className={`rounded-card-lg border p-3 sm:p-4 ${hall.special ? 'border-gold/30 bg-[linear-gradient(145deg,rgba(255,217,61,0.06),rgba(177,151,252,0.06),rgba(15,11,26,0.78))]' : 'border-line bg-bg-card'}`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl" aria-hidden="true">{hall.emoji}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base text-text-primary">{hall.title}</h3>
            {hall.special && <span className="rounded-pill border border-gold/30 bg-gold/10 px-2 py-0.5 text-[9px] font-black text-gold">특별관</span>}
          </div>
          <div className="text-2xs text-text-muted font-bold mt-0.5">{hall.subtitle}</div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mt-3 rounded-card-md border border-dashed border-line bg-bg-deep/60 px-3 py-4 text-center">
          <div className="text-xs font-extrabold text-text-secondary">아직 역사가 쓰이지 않은 전시관</div>
          <div className="text-2xs text-text-muted font-bold mt-1">공식 조건을 충족한 기록이 탄생하면 이곳에 이름이 새겨집니다.</div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {Array.from(grouped.entries()).map(([recordType, rows]) => (
            <RecordGroup key={recordType} rows={rows} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordGroup({ rows }: { rows: HallOfGloryEntry[] }) {
  const first = rows[0];
  const isRanking = rows.length > 1 && rows.some((row) => row.rank_position != null);

  if (!isRanking) {
    return <RecordCard entry={first} />;
  }

  return (
    <div className="rounded-card-md border border-line bg-bg-deep/70 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-line">
        <div className="text-xs font-black text-text-primary">{first.title}</div>
        {first.subtitle && <div className="text-2xs text-text-muted font-bold mt-0.5">{first.subtitle}</div>}
      </div>
      <div className="divide-y divide-line/70">
        {rows.map((entry) => (
          <div key={entry.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              {entry.rank_position != null && <span className="w-5 shrink-0 text-center text-2xs font-black text-gold">{entry.rank_position}</span>}
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-text-primary truncate">{entry.subject_display_name}</div>
                <div className="text-[10px] text-text-muted font-bold truncate">{entry.period_label || entry.season_label || entry.school_year || ''}</div>
              </div>
            </div>
            <div className="shrink-0 text-right text-xs font-mono font-bold text-gold">{formatRecordValue(entry)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordCard({ entry }: { entry: HallOfGloryEntry }) {
  const empty = entry.subject_kind === 'EMPTY_THRONE';

  return (
    <div className={`rounded-card-md border px-3 py-3 ${empty ? 'border-dashed border-gold/25 bg-gold/[0.03]' : 'border-line bg-bg-deep/70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <OfficialBadge compact />
            {(entry.period_label || entry.season_label || entry.school_year) && (
              <span className="text-[10px] text-text-muted font-bold">{entry.period_label || entry.season_label || entry.school_year}</span>
            )}
          </div>
          <div className="text-xs font-black text-text-primary mt-2">{entry.title}</div>
          {entry.subtitle && <div className="text-2xs text-text-muted font-bold mt-1">{entry.subtitle}</div>}
        </div>
        {empty && <span aria-hidden="true" className="text-xl opacity-60">♔</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className={`text-sm font-extrabold ${empty ? 'text-text-muted' : 'text-gold'}`}>{entry.subject_display_name}</div>
        <div className="text-xs font-mono font-bold text-text-secondary text-right">{formatRecordValue(entry)}</div>
      </div>
    </div>
  );
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
      <div className="text-xs text-text-muted font-bold mt-1">{description}</div>
    </div>
  );
}

function OfficialBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`rounded-pill border border-gold/30 bg-gold/10 text-gold font-black ${compact ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-2xs'}`}>
      공식 확정 기록
    </span>
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
