import { EmptyState } from '@/components/shared/components';
import { RecordsHonorOfficialPanels } from '@/features/feature4/RecordsHonorOfficialPanels';
import { formatNumber } from '@/lib/utils/format';

const RANK_LABEL: Record<string, string> = {
  TIER: '티어',
  BRAND_VALUE: '브랜드 가치',
  GOLD_ASSET: 'GOLD 자산',
  CRYSTAL_ASSET: 'CRYSTAL 자산',
  ACHIEVEMENT_COUNT: '업적 수',
  CONTRIBUTION: '기여도',
};

export function RecordsHonorPanel({ data, grouped, studentId }: { data: any; grouped: Map<string, any[]>; studentId: number | null }) {
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-card-lg border border-gold/35 bg-[linear-gradient(145deg,rgba(255,217,61,0.10),rgba(177,151,252,0.06)_45%,rgba(15,11,26,0.86))] p-4 sm:p-5">
        <div aria-hidden="true" className="absolute -right-8 -top-10 text-8xl opacity-[0.06]">🏛️</div>
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill border border-gold/35 bg-gold/10 px-2.5 py-1 text-2xs font-black text-gold">B.R.A.N.D HALL OF LEGENDS</span>
            <span className="text-xs text-text-muted font-bold">전 시즌 통합 역사 전시관</span>
          </div>
          <h2 className="font-display text-xl sm:text-2xl text-white mt-3">시대를 넘어 남은 위대한 기록</h2>
          <p className="text-xs sm:text-sm text-text-secondary font-bold mt-2 max-w-3xl">
            현재 반의 순위를 단순히 나열하는 곳이 아니라, B.R.A.N.D의 모든 시즌을 거쳐 특별한 업적과 기록을 남긴 인물과 길드를 기리는 역사 전시관입니다. 후대의 학생들이 이 기록을 보고 새로운 목표에 도전하도록 하는 것이 이 공간의 중심 목적입니다.
          </p>
          <div className="text-2xs text-text-muted font-bold mt-3">Test Agent는 공식 기록 산정에서 제외됩니다.</div>
        </div>
      </section>

      <section>
        <SectionTitle emoji="👑" title="위대한 기록 전시" description="시즌을 넘어 보존할 가치가 있는 인물·길드·특별 기록" />
        {!data?.hall.length ? (
          <EmptyState emoji="🏛️" title="아직 등록된 전설 기록이 없어요" description="역대 B.R.A.N.D 기록 아카이브가 이관되면 이 공간에 시대를 대표하는 기록들이 전시됩니다." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {data.hall.map((entry: any) => (
              <div key={entry.id} className="bg-bg-card border border-gold/25 rounded-card-md p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <OfficialBadge />
                  <span className="text-2xs text-gold font-black">
                    {entry.category}{entry.period_label ? ` · ${entry.period_label}` : ''}
                  </span>
                </div>
                <div className="text-sm font-extrabold text-text-primary mt-2">{entry.title}</div>
                {entry.subtitle && <div className="text-xs text-text-secondary mt-1">{entry.subtitle}</div>}
                <div className="text-xs text-text-muted font-bold mt-2">
                  {entry.student?.name || entry.student?.brand_name || ''}{entry.rank_position ? ` · ${entry.rank_position}위` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <RecordsHonorOfficialPanels />

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
