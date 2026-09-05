import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { RecordsAssetEconomyPanel } from '@/features/feature4/RecordsAssetEconomyPanel';
import { RecordsAchievementPanel } from '@/features/feature4/RecordsAchievementPanel';
import { RecordsItemPanel } from '@/features/feature4/RecordsItemPanel';
import { RecordsAttendancePanel } from '@/features/feature4/RecordsAttendancePanel';
import { RecordsGuildPanel } from '@/features/feature4/RecordsGuildPanel';
import { RecordsArcadePanel } from '@/features/feature4/RecordsArcadePanel';
import { RecordsHonorPanel } from '@/features/feature4/RecordsHonorPanel';
import { RecordsMonthlyMvpPanel } from '@/features/feature4/RecordsMonthlyMvpPanel';
import { achievementA1Rpc } from '@/lib/rpc/achievement_a1_rpc';
import { inventoryMarketRpc } from '@/lib/rpc/inventory_market_rpc';
import {
  recordsRpc,
  type AttendanceDashboard,
  type AttendanceHistoryRow,
  type RecordsLegacySummary,
} from '@/lib/rpc/records_rpc';

type MainTab = 'HONOR' | 'MVP' | 'MY';
type MyTab = 'ASSET' | 'ACHIEVEMENT' | 'ITEM' | 'ATTENDANCE' | 'GUILD' | 'ARCADE';

type LiveTransaction = {
  id: number;
  value_token: 'GOLD' | 'BV' | 'CRYSTAL';
  amount: number;
  balance_after: number;
  source_type: string;
  tax_amount: number;
  memo: string | null;
  created_at: string;
};

export default function RecordsPage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const [mainTab, setMainTab] = useState<MainTab>('HONOR');
  const [myTab, setMyTab] = useState<MyTab | null>(null);

  const honorQ = useQuery({
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
      const [{ data: ranks, error: ranksError }, { data: stats, error: statsError }] = await Promise.all([
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

      if (ranksError) throw feature4QueryError('F4D', 'latest-rankings', ranksError);
      if (statsError) throw feature4QueryError('F4D', 'latest-statistics', statsError);

      return { ranks: ranks ?? [], stats, date };
    },
  });

  const myQ = useQuery({
    queryKey: ['f4d-my-records', studentId],
    enabled: mainTab === 'MY' && !!studentId,
    queryFn: async () => {
      const [
        liveTxResult,
        liveTxCountResult,
        legacy,
        legacySummary,
        achievementsResult,
        itemHistoryResult,
        attendanceDashboard,
        attendanceHistory,
      ] = await Promise.all([
        supabase
          .from('transactions')
          .select('id,value_token,amount,balance_after,source_type,tax_amount,memo,created_at')
          .eq('student_id', studentId!)
          .eq('is_reversed', false)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', studentId!)
          .eq('is_reversed', false),
        recordsRpc.myLegacyAssetHistory(supabase, { p_limit: 100, p_offset: 0 }),
        recordsRpc.myLegacySummary(supabase),
        achievementA1Rpc.studentCatalog(supabase),
        inventoryMarketRpc.myItemHistory(supabase, { p_limit: 30, p_offset: 0 }),
        recordsRpc.myAttendanceDashboard(supabase),
        recordsRpc.myAttendanceHistory(supabase, { p_limit: 100, p_offset: 0 }),
      ]);

      if (liveTxResult.error) throw feature4QueryError('F4D', 'my-live-transactions', liveTxResult.error);
      if (liveTxCountResult.error) throw feature4QueryError('F4D', 'my-live-transaction-count', liveTxCountResult.error);
      if (achievementsResult.success === false) throw new Error(achievementsResult.error || '업적 기록을 불러오지 못했습니다.');
      if (itemHistoryResult.success === false) throw new Error(itemHistoryResult.error || '아이템 기록을 불러오지 못했습니다.');

      const earned = achievementsResult.data
        .filter((row) => row.is_earned)
        .sort((a, b) => (b.achieved_at ?? '').localeCompare(a.achieved_at ?? ''));

      return {
        liveTransactions: (liveTxResult.data ?? []) as LiveTransaction[],
        liveTransactionCount: liveTxCountResult.count ?? 0,
        legacy,
        legacySummary,
        achievements: earned,
        itemHistory: itemHistoryResult.data,
        attendanceDashboard,
        attendanceHistory,
      };
    },
  });

  if (honorQ.isLoading) {
    return (
      <>
        <PageHeader title="기록실" emoji="🏛️" />
        <div className="py-12 flex justify-center"><LoadingSpinner size="lg" /></div>
      </>
    );
  }

  if (honorQ.isError) {
    return (
      <>
        <PageHeader title="기록실" emoji="🏛️" />
        <div className="px-4 py-4 max-w-5xl mx-auto">
          <Feature4ErrorPanel domain="F4D" error={honorQ.error} onRetry={() => void honorQ.refetch()} />
        </div>
      </>
    );
  }

  const grouped = new Map<string, any[]>();
  (honorQ.data?.ranks ?? []).forEach((rank: any) => {
    if (!grouped.has(rank.ranking_type)) grouped.set(rank.ranking_type, []);
    grouped.get(rank.ranking_type)!.push(rank);
  });

  return (
    <>
      <PageHeader title="기록실" emoji="🏛️" />
      <div className="px-3 sm:px-4 py-4 pb-28 max-w-5xl mx-auto space-y-5">
        <div className="rounded-card-md border border-gold/20 bg-bg-card p-2 grid grid-cols-3 gap-2">
          <MainTabButton active={mainTab === 'HONOR'} onClick={() => setMainTab('HONOR')} emoji="🏛️" title="명예 기록" subtitle="전 시즌 위대한 기록" />
          <MainTabButton active={mainTab === 'MVP'} onClick={() => setMainTab('MVP')} emoji="👑" title="월간 MVP" subtitle="2023~ 역대 MVP" />
          <MainTabButton active={mainTab === 'MY'} onClick={() => setMainTab('MY')} emoji="📜" title="나의 발자취" subtitle="나의 B.R.A.N.D 역사" />
        </div>

        {mainTab === 'HONOR' ? (
          <RecordsHonorPanel data={honorQ.data} grouped={grouped} studentId={studentId} />
        ) : mainTab === 'MVP' ? (
          <RecordsMonthlyMvpPanel />
        ) : myQ.isLoading ? (
          <div className="py-14 flex flex-col items-center gap-3 text-text-muted">
            <LoadingSpinner size="lg" />
            <div className="text-sm font-bold">나의 B.R.A.N.D 역사를 모으고 있어요.</div>
          </div>
        ) : myQ.isError ? (
          <Feature4ErrorPanel domain="F4D" error={myQ.error} onRetry={() => void myQ.refetch()} />
        ) : myQ.data ? (
          <MyRecords data={myQ.data} myTab={myTab} setMyTab={setMyTab} />
        ) : null}
      </div>
    </>
  );
}

function MainTabButton({ active, onClick, emoji, title, subtitle }: { active: boolean; onClick: () => void; emoji: string; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-0 rounded-card-md p-2.5 sm:p-3 text-left border transition ${active ? 'border-gold/50 bg-gold/10 shadow-brand-glow' : 'border-line bg-bg-deep hover:border-gold/25'}`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="text-lg sm:text-xl">{emoji}</span>
        <span className={`font-display text-xs sm:text-base truncate ${active ? 'text-gold' : 'text-text-primary'}`}>{title}</span>
      </div>
      <div className="text-2xs text-text-muted font-bold mt-1 hidden sm:block truncate">{subtitle}</div>
    </button>
  );
}

function MyRecords({
  data,
  myTab,
  setMyTab,
}: {
  data: any;
  myTab: MyTab | null;
  setMyTab: (tab: MyTab | null) => void;
}) {
  const attendanceDashboard = data.attendanceDashboard as AttendanceDashboard;
  const attendanceHistory = data.attendanceHistory as { total_count: number; rows: AttendanceHistoryRow[] };
  const legacy = data.legacySummary as RecordsLegacySummary;
  const current = legacy.current;

  const nav: Array<{ key: MyTab; emoji: string; label: string; count?: number }> = [
    { key: 'ASSET', emoji: '💰', label: '자산·경제', count: data.liveTransactionCount + data.legacy.total },
    { key: 'ACHIEVEMENT', emoji: '🏆', label: '업적', count: data.achievements.length },
    { key: 'ITEM', emoji: '🎒', label: '아이템', count: data.itemHistory.total_count },
    { key: 'ATTENDANCE', emoji: '📅', label: '출석', count: attendanceHistory.total_count },
    { key: 'GUILD', emoji: '🛡️', label: '길드' },
    { key: 'ARCADE', emoji: '🕹️', label: 'Arcade' },
  ];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-card-lg border border-bv/35 bg-[linear-gradient(145deg,rgba(177,151,252,0.10),rgba(255,217,61,0.05)_55%,rgba(15,11,26,0.84))] p-4 sm:p-5">
        <div className="absolute -right-8 -top-10 text-8xl opacity-[0.06] pointer-events-none">📜</div>
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-2xs font-black text-bv tracking-[0.18em]">MY B.R.A.N.D LEGACY</div>
              <h2 className="font-display text-xl sm:text-2xl text-brand-gradient mt-1">나의 발자취</h2>
            </div>
            <div className="rounded-pill border border-line bg-bg-deep/70 px-3 py-1.5 text-2xs font-bold text-text-muted">
              {legacy.first_recorded_on ? `${legacy.first_recorded_on}부터 기록` : `${legacy.school_year} 기록`}
            </div>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary font-bold mt-2 max-w-3xl">
            지금 가진 것뿐 아니라, B.R.A.N.D에서 내가 실제로 도달했던 최고점과 공식 성취를 함께 남기는 개인 역사관입니다.
          </p>

          <div className="mt-4 rounded-card-md border border-line/80 bg-bg-deep/55 p-3">
            <div className="text-[10px] font-black tracking-[0.14em] text-text-muted">CURRENT STATUS · 현재의 나</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-2">
              <CurrentStat label="티어" value={current.tier || '-'} />
              <CurrentStat label="BV" value={formatNumber(current.bv)} />
              <CurrentStat label="GOLD" value={formatNumber(current.gold)} />
              <CurrentStat label="CRYSTAL" value={formatNumber(current.crystal)} />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-2xs font-black tracking-[0.14em] text-bv">LEGACY HIGHLIGHTS</div>
          <h3 className="font-display text-lg text-text-primary mt-1">대표 발자취</h3>
          <p className="text-xs text-text-secondary mt-1">일시적인 현재 수치가 아니라, 공식 기록 속에서 내가 남긴 대표적인 성취를 요약합니다.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <LegacyHighlight
            label="역대 최고 BV"
            value={formatNumber(legacy.peaks.bv.value)}
            detail={formatRecordDate(legacy.peaks.bv.occurred_on)}
          />
          <LegacyHighlight
            label="역대 최고 GOLD"
            value={formatNumber(legacy.peaks.gold.value)}
            detail={formatRecordDate(legacy.peaks.gold.occurred_on)}
          />
          <LegacyHighlight
            label="유효 업적"
            value={`${formatNumber(legacy.achievements.valid_count)}개`}
            detail={`도감 ${legacy.achievements.completion_percent.toFixed(2)}% · 유일 ${legacy.achievements.unique_count} · 초월 ${legacy.achievements.transcend_count}`}
          />
          <LegacyHighlight
            label="월간 MVP"
            value={`${formatNumber(legacy.mvp.win_count)}회`}
            detail={legacy.mvp.win_count > 0 ? `${formatPeriod(legacy.mvp.first_win_period)} 첫 수상` : '아직 수상 기록 없음'}
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <LegacySecondaryStat
            label="길드 월간 우승 참여"
            value={`${formatNumber(legacy.guild.win_months)}회`}
            detail={legacy.guild.finalized_months > 0 ? `FINAL ${legacy.guild.finalized_months}개월` : '아직 FINAL 기록 없음'}
          />
          <LegacySecondaryStat
            label="Arcade 월간 우승"
            value={`${formatNumber(legacy.arcade.win_count)}회`}
            detail={`TOP3 ${formatNumber(legacy.arcade.top3_count)}회`}
          />
          <LegacySecondaryStat
            label="누적 출석"
            value={`${formatNumber(legacy.attendance.attended_days)}일`}
            detail="출석·지각 포함 공식 출석"
          />
          <LegacySecondaryStat
            label="최고 연속 출석"
            value={`${formatNumber(legacy.attendance.best_streak)}일`}
            detail={attendanceDashboard.current_streak > 0 ? `현재 ${attendanceDashboard.current_streak}일 연속` : '현재 연속 기록 없음'}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-2xs font-black tracking-[0.14em] text-text-muted">SUPPORTING RECORDS</div>
          <h3 className="font-display text-lg text-text-primary mt-1">세부 기록 열람</h3>
          <p className="text-xs text-text-secondary mt-1">대표 성취를 뒷받침하는 세부 기록입니다. 기본은 닫힌 상태이며 필요한 분야만 선택해 확인합니다.</p>
        </div>

        <nav aria-label="나의 세부 기록 분야" className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
          {nav.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMyTab(myTab === item.key ? null : item.key)}
              aria-pressed={myTab === item.key}
              className={`min-w-0 rounded-card-md border px-1.5 py-2.5 sm:px-3 transition ${myTab === item.key ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-bg-card text-text-secondary hover:border-gold/25'}`}
            >
              <div className="text-lg sm:text-xl">{item.emoji}</div>
              <div className="text-[11px] sm:text-sm font-black mt-1 truncate">{item.label}</div>
              <div className="text-[9px] sm:text-2xs text-text-muted font-bold mt-0.5 truncate">{item.count == null ? '기록 보기' : `${formatNumber(item.count)}건`}</div>
            </button>
          ))}
        </nav>
      </section>

      {myTab === 'ASSET' && <RecordsAssetEconomyPanel live={data.liveTransactions} liveTotal={data.liveTransactionCount} legacy={data.legacy.rows} legacyTotal={data.legacy.total} />}
      {myTab === 'ACHIEVEMENT' && <RecordsAchievementPanel rows={data.achievements} />}
      {myTab === 'ITEM' && <RecordsItemPanel rows={data.itemHistory.rows} total={data.itemHistory.total_count} />}
      {myTab === 'ATTENDANCE' && <RecordsAttendancePanel rows={attendanceHistory.rows} dashboard={attendanceDashboard} total={attendanceHistory.total_count} />}
      {myTab === 'GUILD' && <RecordsGuildPanel />}
      {myTab === 'ARCADE' && <RecordsArcadePanel />}
    </div>
  );
}

function CurrentStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-text-muted font-black">{label}</div>
      <div className="text-sm sm:text-base text-text-primary font-extrabold mt-0.5 truncate">{value}</div>
    </div>
  );
}

function LegacyHighlight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-card-lg border border-gold/25 bg-[linear-gradient(145deg,rgba(255,217,61,0.07),rgba(15,11,26,0.72))] p-4 min-h-[118px] flex flex-col justify-between">
      <div className="text-2xs text-text-muted font-black">{label}</div>
      <div>
        <div className="font-display text-xl sm:text-2xl text-gold break-words">{value}</div>
        <div className="text-[10px] sm:text-2xs text-text-muted font-bold mt-1.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}

function LegacySecondaryStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-card p-3 min-h-[92px]">
      <div className="text-2xs text-text-muted font-black">{label}</div>
      <div className="font-display text-lg text-text-primary mt-1">{value}</div>
      <div className="text-[10px] text-text-muted font-bold mt-1 leading-relaxed">{detail}</div>
    </div>
  );
}

function formatRecordDate(value: string | null) {
  if (!value) return '기록 시점 없음';
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day} 기록`;
}

function formatPeriod(value: string | null) {
  if (!value) return '-';
  const [year, month] = value.split('-');
  return `${year}.${month}`;
}