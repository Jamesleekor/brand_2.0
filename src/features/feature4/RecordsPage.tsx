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
import { achievementA1Rpc } from '@/lib/rpc/achievement_a1_rpc';
import { inventoryMarketRpc } from '@/lib/rpc/inventory_market_rpc';
import { recordsRpc, type AttendanceDashboard, type AttendanceHistoryRow } from '@/lib/rpc/records_rpc';

type MainTab = 'HONOR' | 'MY';
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
  const [myTab, setMyTab] = useState<MyTab>('ASSET');

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

  const myQ = useQuery({
    queryKey: ['f4d-my-records', studentId],
    enabled: mainTab === 'MY' && !!studentId,
    queryFn: async () => {
      const [
        liveTxResult,
        liveTxCountResult,
        legacy,
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
        <div className="rounded-card-md border border-gold/20 bg-bg-card p-2 grid grid-cols-2 gap-2">
          <MainTabButton active={mainTab === 'HONOR'} onClick={() => setMainTab('HONOR')} emoji="🏆" title="명예 기록" subtitle="MVP · 공식 확정 기록" />
          <MainTabButton active={mainTab === 'MY'} onClick={() => setMainTab('MY')} emoji="📜" title="내 기록" subtitle="나의 발자취 · 6개 분야" />
        </div>

        {mainTab === 'HONOR' ? (
          <RecordsHonorPanel data={honorQ.data} grouped={grouped} studentId={studentId} />
        ) : myQ.isLoading ? (
          <div className="py-14 flex flex-col items-center gap-3 text-text-muted">
            <LoadingSpinner size="lg" />
            <div className="text-sm font-bold">나의 발자취를 모으고 있어요.</div>
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
      className={`rounded-card-md p-3 text-left border transition ${active ? 'border-gold/50 bg-gold/10 shadow-brand-glow' : 'border-line bg-bg-deep hover:border-gold/25'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{emoji}</span>
        <span className={`font-display text-base ${active ? 'text-gold' : 'text-text-primary'}`}>{title}</span>
      </div>
      <div className="text-2xs text-text-muted font-bold mt-1 hidden sm:block">{subtitle}</div>
    </button>
  );
}

function MyRecords({ data, myTab, setMyTab }: { data: any; myTab: MyTab; setMyTab: (tab: MyTab) => void }) {
  const attendanceDashboard = data.attendanceDashboard as AttendanceDashboard;
  const attendanceHistory = data.attendanceHistory as { total_count: number; rows: AttendanceHistoryRow[] };
  const latestStreak = attendanceDashboard.current_streak;

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
      <section className="relative overflow-hidden rounded-card-lg border border-bv/30 bg-bg-card p-4 sm:p-5">
        <div className="absolute -right-8 -top-10 text-8xl opacity-[0.06] pointer-events-none">📜</div>
        <div className="relative">
          <div className="text-2xs font-black text-bv tracking-widest">MY BRAND HISTORY</div>
          <h2 className="font-display text-xl sm:text-2xl text-brand-gradient mt-1">나의 발자취</h2>
          <p className="text-xs sm:text-sm text-text-secondary font-bold mt-2 max-w-2xl">
            시즌 1에서 이어진 기록과 B.R.A.N.D 2.0의 현재 기록을 한곳에서 확인합니다. 과거 아카이브와 현재 운영 기록은 서로 섞지 않고 출처를 구분해 보여줍니다.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <RecordStat emoji="🏆" label="획득 업적" value={`${formatNumber(data.achievements.length)}개`} />
            <RecordStat emoji="🧾" label="2.0 자산 거래" value={`${formatNumber(data.liveTransactionCount)}건`} />
            <RecordStat emoji="🕰️" label="시즌 1 자산 기록" value={`${formatNumber(data.legacy.total)}건`} />
            <RecordStat emoji="🔥" label="최근 연속 출석" value={`${formatNumber(latestStreak)}일`} />
          </div>
        </div>
      </section>

      <nav aria-label="나의 기록 분야" className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
        {nav.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setMyTab(item.key)}
            aria-pressed={myTab === item.key}
            className={`min-w-0 rounded-card-md border px-1.5 py-2.5 sm:px-3 transition ${myTab === item.key ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-bg-card text-text-secondary hover:border-gold/25'}`}
          >
            <div className="text-lg sm:text-xl">{item.emoji}</div>
            <div className="text-[11px] sm:text-sm font-black mt-1 truncate">{item.label}</div>
            <div className="text-[9px] sm:text-2xs text-text-muted font-bold mt-0.5 truncate">{item.count == null ? '기록 보기' : `${formatNumber(item.count)}건`}</div>
          </button>
        ))}
      </nav>

      {myTab === 'ASSET' && <RecordsAssetEconomyPanel live={data.liveTransactions} liveTotal={data.liveTransactionCount} legacy={data.legacy.rows} legacyTotal={data.legacy.total} />}
      {myTab === 'ACHIEVEMENT' && <RecordsAchievementPanel rows={data.achievements} />}
      {myTab === 'ITEM' && <RecordsItemPanel rows={data.itemHistory.rows} total={data.itemHistory.total_count} />}
      {myTab === 'ATTENDANCE' && <RecordsAttendancePanel rows={attendanceHistory.rows} dashboard={attendanceDashboard} total={attendanceHistory.total_count} />}
      {myTab === 'GUILD' && <RecordsGuildPanel />}
      {myTab === 'ARCADE' && <RecordsArcadePanel />}
    </div>
  );
}

function RecordStat({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep/80 p-3">
      <div className="flex items-center gap-1.5 text-2xs text-text-muted font-black"><span>{emoji}</span><span>{label}</span></div>
      <div className="font-display text-base sm:text-lg text-text-primary mt-1">{value}</div>
    </div>
  );
}
