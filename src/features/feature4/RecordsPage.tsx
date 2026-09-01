import { useQuery } from '@tanstack/react-query';
import { PageHeader, EmptyState, LoadingSpinner } from '@/components/shared/components';
import { MonthlyMvpGallery } from '@/components/shared/MonthlyMvpGallery';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';

const RANK_LABEL: Record<string, string> = {
  TIER: '티어',
  BRAND_VALUE: '브랜드 가치',
  GOLD_ASSET: 'GOLD 자산',
  CRYSTAL_ASSET: 'CRYSTAL 자산',
  ACHIEVEMENT_COUNT: '업적 수',
  CONTRIBUTION: '기여도',
};

export default function RecordsPage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();

  const q = useQuery({
    queryKey: ['f4d-record-room', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const { data: latest, error: latestError } = await supabase
        .from('rankings')
        .select('as_of_date')
        .eq('classroom_id', classroomId!)
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw feature4QueryError('F4D', 'latest-ranking-date', latestError);

      const date = latest?.as_of_date;
      const [{ data: hall, error: hallError }, { data: ranks, error: ranksError }, { data: stats, error: statsError }] = await Promise.all([
        supabase
          .from('hall_of_fame_entries')
          .select('id,category,period_label,title,subtitle,student_id,rank_position,created_at,student:students!student_id(name,brand_name)')
          .eq('classroom_id', classroomId!)
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false })
          .limit(50),
        date
          ? supabase
              .from('rankings')
              .select('student_id,ranking_type,rank_position,value,student:students!student_id(name,brand_name)')
              .eq('classroom_id', classroomId!)
              .eq('as_of_date', date)
              .order('rank_position', { ascending: true })
          : Promise.resolve({ data: [], error: null } as any),
        supabase
          .from('daily_statistics')
          .select('stat_date,total_gold,total_bv,total_crystal,gini_gold,gini_bv,transactions_count')
          .eq('classroom_id', classroomId!)
          .order('stat_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (hallError) throw feature4QueryError('F4D', 'hall-of-fame', hallError);
      if (ranksError) throw feature4QueryError('F4D', 'latest-rankings', ranksError);
      if (statsError) throw feature4QueryError('F4D', 'latest-statistics', statsError);

      return { hall: hall ?? [], ranks: ranks ?? [], stats, date };
    },
  });

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="기록실" emoji="🏛️" />
        <div className="py-12 flex justify-center"><LoadingSpinner size="lg" /></div>
      </>
    );
  }

  if (q.isError) {
    return (
      <>
        <PageHeader title="기록실" emoji="🏛️" />
        <div className="px-4 py-4 max-w-4xl mx-auto">
          <Feature4ErrorPanel domain="F4D" error={q.error} onRetry={() => void q.refetch()} />
        </div>
      </>
    );
  }

  const grouped = new Map<string, any[]>();
  (q.data?.ranks ?? []).forEach((rank: any) => {
    if (!grouped.has(rank.ranking_type)) grouped.set(rank.ranking_type, []);
    grouped.get(rank.ranking_type)!.push(rank);
  });

  return (
    <>
      <PageHeader title="기록실" emoji="🏛️" />
      <div className="px-4 py-4 pb-28 max-w-4xl mx-auto space-y-5">
        {/* 월간 MVP는 모든 명예 보상 중 최상위 전시이므로 기록실 최상단에 배치 */}
        <MonthlyMvpGallery variant="records" />

        {q.data?.stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Mini label="총 GOLD" value={formatNumber(q.data.stats.total_gold)} />
            <Mini label="총 BV" value={formatNumber(q.data.stats.total_bv)} />
            <Mini label="Gini GOLD" value={Number(q.data.stats.gini_gold).toFixed(3)} />
            <Mini label="스냅샷 거래" value={formatNumber(q.data.stats.transactions_count)} />
          </div>
        )}

        <section>
          <h2 className="font-display text-lg text-brand-gradient mb-2">🏆 명예의 전당</h2>
          {!q.data?.hall.length ? (
            <EmptyState emoji="🏛️" title="아직 전시된 기록이 없어요" description="교사가 시즌·MVP·특별 기록을 추가하면 여기에 전시됩니다." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {q.data.hall.map((entry: any) => (
                <div key={entry.id} className="bg-bg-card border border-gold/25 rounded-card-md p-3">
                  <div className="text-2xs text-gold font-black">
                    {entry.category}{entry.period_label ? ` · ${entry.period_label}` : ''}
                  </div>
                  <div className="text-sm font-extrabold mt-1">{entry.title}</div>
                  {entry.subtitle && <div className="text-xs text-text-secondary mt-1">{entry.subtitle}</div>}
                  <div className="text-2xs text-text-muted mt-2">
                    {entry.student?.brand_name || entry.student?.name || ''}{entry.rank_position ? ` · ${entry.rank_position}위` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-lg text-brand-gradient mb-2">
            📊 최신 공식 랭킹 {q.data?.date && <span className="text-xs text-text-muted">({q.data.date})</span>}
          </h2>
          {grouped.size === 0 ? (
            <EmptyState emoji="📊" title="아직 공식 랭킹 스냅샷이 없어요" description="선생님이 기록 갱신을 실행하면 생성됩니다." />
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {Array.from(grouped.entries()).map(([type, rows]) => (
                <div key={type} className="bg-bg-card border border-line rounded-card-md p-3">
                  <div className="text-xs font-black text-bv mb-2">{RANK_LABEL[type] || type}</div>
                  {rows.slice(0, 5).map((rank: any) => (
                    <div key={`${type}-${rank.student_id}`} className="flex justify-between text-xs py-1">
                      <span className={rank.student_id === studentId ? 'text-gold font-black' : 'text-text-secondary'}>
                        {rank.rank_position}. {rank.student?.brand_name || rank.student?.name}
                      </span>
                      <span className="font-mono">{formatNumber(rank.value)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
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
