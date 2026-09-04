import { EmptyState } from '@/components/shared/components';
import { MonthlyMvpGallery } from '@/components/shared/MonthlyMvpGallery';
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
      <div className="rounded-card-md border border-line bg-bg-deep/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-pill border border-gold/35 bg-gold/10 px-2.5 py-1 text-2xs font-black text-gold">공식 기록 보관소</span>
          <span className="text-xs text-text-muted font-bold">Test Agent는 공식 집계에서 제외</span>
        </div>
        <div className="text-sm font-extrabold text-text-primary mt-2">학급의 명예와 확정 기록</div>
        <div className="text-xs text-text-secondary mt-1">
          월간 MVP, 교사가 보존한 명예 기록, 공식 랭킹과 FINAL snapshot만 전시합니다. 진행 중인 기록은 개인 기록실과 각 콘텐츠 화면에서 확인합니다.
        </div>
      </div>

      <MonthlyMvpGallery variant="records" />

      <section>
        <SectionTitle emoji="🏆" title="명예의 전당" description="시즌·MVP·특별 기록 중 오래 남길 가치가 있는 교사 확정 기록" />
        {!data?.hall.length ? (
          <EmptyState emoji="🏛️" title="아직 전시된 명예 기록이 없어요" description="선생님이 명예의 전당 기록을 활성화하면 이곳에 전시됩니다." />
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

      <section>
        <SectionTitle emoji="📊" title="최신 공식 랭킹" description={data?.date ? `${data.date} 기준 · 각 부문 TOP 5` : '선생님이 확정한 가장 최근 랭킹 snapshot'} />
        {grouped.size === 0 ? (
          <EmptyState emoji="📊" title="아직 공식 랭킹 snapshot이 없어요" description="선생님이 기록 갱신을 실행하면 공식 참가자만 포함한 랭킹이 생성됩니다." />
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {Array.from(grouped.entries()).map(([type, rows]) => (
              <div key={type} className="bg-bg-card border border-line rounded-card-md p-3">
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

      <RecordsHonorOfficialPanels />

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
