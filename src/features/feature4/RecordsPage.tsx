import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader, EmptyState, LoadingSpinner } from '@/components/shared/components';
import { MonthlyMvpGallery } from '@/components/shared/MonthlyMvpGallery';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatDate, formatDateTime, formatDelta, formatNumber } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { RecordsAssetEconomyPanel } from '@/features/feature4/RecordsAssetEconomyPanel';
import { RecordsGuildPanel } from '@/features/feature4/RecordsGuildPanel';
import { RecordsArcadePanel } from '@/features/feature4/RecordsArcadePanel';
import { achievementA1Rpc, type AchievementCatalogRow } from '@/lib/rpc/achievement_a1_rpc';
import { inventoryMarketRpc, type StudentItemHistoryRow } from '@/lib/rpc/inventory_market_rpc';
import {
  recordsRpc,
  type AttendanceDashboard,
  type AttendanceHistoryRow,
  type LegacyAssetHistoryRow,
} from '@/lib/rpc/records_rpc';

const RANK_LABEL: Record<string, string> = {
  TIER: '티어',
  BRAND_VALUE: '브랜드 가치',
  GOLD_ASSET: 'GOLD 자산',
  CRYSTAL_ASSET: 'CRYSTAL 자산',
  ACHIEVEMENT_COUNT: '업적 수',
  CONTRIBUTION: '기여도',
};

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

const SOURCE_LABELS: Record<string, { emoji: string; label: string }> = {
  DAILY_QUEST: { emoji: '⚔️', label: '일일퀘스트' },
  ATTENDANCE_BONUS: { emoji: '📅', label: '출석 보상' },
  ATTENDANCE_STREAK: { emoji: '🔥', label: '연속 출석' },
  CLASS_PARTICIPATION: { emoji: '🙋', label: '수업 참여' },
  ASSIGNMENT_SUBMIT: { emoji: '📝', label: '과제 제출' },
  ASSIGNMENT_EXCELLENCE: { emoji: '🌟', label: '과제 우수' },
  ACHIEVEMENT_RECOGNITION: { emoji: '🏆', label: '업적 보상' },
  PRIMARY_JOB_WAGE: { emoji: '💼', label: '1인1역 급여' },
  GUILD_MISSION_REWARD: { emoji: '🛡️', label: '길드 보상' },
  TEACHER_GRANT: { emoji: '🎁', label: '교사 지급' },
  SNACK_PURCHASE: { emoji: '🍪', label: '간식 구매' },
  COSMETIC_PURCHASE: { emoji: '🎨', label: '꾸미기 구매' },
  AUCTION_PAYMENT: { emoji: '🔨', label: '경매 낙찰' },
  AUCTION_REFUND: { emoji: '↩️', label: '경매 환불' },
  DEPOSIT_PRINCIPAL: { emoji: '🏦', label: '예금 가입' },
  DEPOSIT_MATURITY: { emoji: '💰', label: '예금 만기' },
  DONATION: { emoji: '💝', label: '기부' },
  P2P_SEND: { emoji: '↗️', label: '송금' },
  P2P_RECEIVE: { emoji: '↘️', label: '송금 수령' },
  TEACHER_DEDUCT: { emoji: '➖', label: '교사 차감' },
  CORRECTION: { emoji: '🔧', label: '정정' },
  OTHER: { emoji: '📌', label: '기타' },
};

const ATTENDANCE_LABEL: Record<AttendanceHistoryRow['status'], { label: string; className: string }> = {
  PRESENT: { label: '출석', className: 'text-success border-success/30 bg-success/10' },
  LATE: { label: '지각', className: 'text-warning border-warning/30 bg-warning/10' },
  ABSENT: { label: '결석', className: 'text-danger border-danger/30 bg-danger/10' },
  EXCUSED: { label: '인정결석', className: 'text-text-secondary border-line bg-bg-deep' },
};

export default function RecordsPage() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const [mainTab, setMainTab] = useState<MainTab>('HONOR');
  const [myTab, setMyTab] = useState<MyTab>('ASSET');

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
        <div className="px-4 py-4 max-w-5xl mx-auto">
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
      <div className="px-4 py-4 pb-28 max-w-5xl mx-auto space-y-5">
        <div className="rounded-card-md border border-gold/20 bg-bg-card p-2 grid grid-cols-2 gap-2">
          <MainTabButton active={mainTab === 'HONOR'} onClick={() => setMainTab('HONOR')} emoji="🏆" title="명예 기록" subtitle="MVP · 명예의 전당 · 공식 랭킹" />
          <MainTabButton active={mainTab === 'MY'} onClick={() => setMainTab('MY')} emoji="📜" title="내 기록" subtitle="자산·경제 · 업적 · 아이템 · 출석 · 길드 · Arcade" />
        </div>

        {mainTab === 'HONOR' ? (
          <HonorRecords data={q.data} grouped={grouped} studentId={studentId} />
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

function HonorRecords({ data, grouped, studentId }: { data: any; grouped: Map<string, any[]>; studentId: number | null }) {
  return (
    <div className="space-y-5">
      <div className="rounded-card-md border border-line bg-bg-deep/70 px-4 py-3">
        <div className="text-sm font-extrabold text-text-primary">학급의 공식 기록 보관소</div>
        <div className="text-xs text-text-secondary mt-1">월간 MVP와 교사가 확정한 명예 기록, 최신 공식 랭킹 스냅샷을 확인할 수 있습니다.</div>
      </div>

      <MonthlyMvpGallery variant="records" />

      {data?.stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Mini label="학급 총 GOLD" value={formatNumber(data.stats.total_gold)} />
          <Mini label="학급 총 BV" value={formatNumber(data.stats.total_bv)} />
          <Mini label="Gini GOLD" value={Number(data.stats.gini_gold).toFixed(3)} />
          <Mini label="스냅샷 거래" value={formatNumber(data.stats.transactions_count)} />
        </div>
      )}

      <section>
        <SectionTitle emoji="🏆" title="명예의 전당" description="시즌·MVP·특별 기록 중 오래 남길 가치가 있는 공식 기록" />
        {!data?.hall.length ? (
          <EmptyState emoji="🏛️" title="아직 전시된 기록이 없어요" description="선생님이 시즌·MVP·특별 기록을 추가하면 여기에 전시됩니다." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {data.hall.map((entry: any) => (
              <div key={entry.id} className="bg-bg-card border border-gold/25 rounded-card-md p-3">
                <div className="text-2xs text-gold font-black">
                  {entry.category}{entry.period_label ? ` · ${entry.period_label}` : ''}
                </div>
                <div className="text-sm font-extrabold text-text-primary mt-1">{entry.title}</div>
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
        <SectionTitle emoji="📊" title="최신 공식 랭킹" description={data?.date ? `${data.date} 기준 · 각 부문 TOP 5` : '가장 최근에 확정된 랭킹'} />
        {grouped.size === 0 ? (
          <EmptyState emoji="📊" title="아직 공식 랭킹 스냅샷이 없어요" description="선생님이 기록 갱신을 실행하면 생성됩니다." />
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {Array.from(grouped.entries()).map(([type, rows]) => (
              <div key={type} className="bg-bg-card border border-line rounded-card-md p-3">
                <div className="text-xs font-black text-bv mb-2">{RANK_LABEL[type] || type}</div>
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
    </div>
  );
}

function MyRecords({ data, myTab, setMyTab }: { data: any; myTab: MyTab; setMyTab: (tab: MyTab) => void }) {
  const attendanceDashboard = data.attendanceDashboard as AttendanceDashboard;
  const attendanceHistory = data.attendanceHistory as { total_count: number; rows: AttendanceHistoryRow[] };
  const attendance = attendanceHistory.rows;
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

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5 sm:gap-2">
        {nav.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setMyTab(item.key)}
            className={`min-w-0 rounded-card-md border px-1.5 py-2.5 sm:px-3 transition ${myTab === item.key ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-bg-card text-text-secondary hover:border-gold/25'}`}
          >
            <div className="text-lg sm:text-xl">{item.emoji}</div>
            <div className="text-xs sm:text-sm font-black mt-1 truncate">{item.label}</div>
            <div className="text-2xs text-text-muted font-bold mt-0.5">{item.count == null ? '기록 보기' : `${formatNumber(item.count)}건`}</div>
          </button>
        ))}
      </div>

      {myTab === 'ASSET' && <RecordsAssetEconomyPanel live={data.liveTransactions} liveTotal={data.liveTransactionCount} legacy={data.legacy.rows} legacyTotal={data.legacy.total} />}
      {myTab === 'ACHIEVEMENT' && <AchievementHistory rows={data.achievements} />}
      {myTab === 'ITEM' && <ItemHistory rows={data.itemHistory.rows} total={data.itemHistory.total_count} />}
      {myTab === 'ATTENDANCE' && <AttendanceHistory rows={attendance} dashboard={attendanceDashboard} total={attendanceHistory.total_count} />}
      {myTab === 'GUILD' && <RecordsGuildPanel />}
      {myTab === 'ARCADE' && <RecordsArcadePanel />}
    </div>
  );
}

function AssetHistory({ live, liveTotal, legacy, legacyTotal }: { live: LiveTransaction[]; liveTotal: number; legacy: LegacyAssetHistoryRow[]; legacyTotal: number }) {
  return (
    <div className="space-y-4">
      <section className="bg-bg-card border border-line rounded-card-md p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2"><SourceBadge label="B.R.A.N.D 2.0" /><span className="text-xs text-text-muted font-bold">현재 운영 기록</span></div>
            <h3 className="font-display text-lg text-text-primary mt-2">최근 자산 거래</h3>
            <p className="text-xs text-text-secondary mt-1">2.0 전환 이후 서버 거래 원장에 기록된 최근 50건입니다.</p>
          </div>
          <Link to="/wallet" className="btn-secondary text-xs">전체 거래 보기</Link>
        </div>
        {live.length === 0 ? <CompactEmpty text="아직 B.R.A.N.D 2.0 자산 거래가 없습니다." /> : (
          <div className="divide-y divide-line/60">
            {live.map((tx) => <LiveTransactionRow key={tx.id} row={tx} />)}
          </div>
        )}
        {liveTotal > live.length && <div className="text-2xs text-text-muted font-bold mt-3 text-right">총 {formatNumber(liveTotal)}건 중 최근 {live.length}건 표시</div>}
      </section>

      <section className="bg-bg-card border border-bv/25 rounded-card-md p-4">
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2"><SourceBadge label="시즌 1 아카이브" tone="bv" /><span className="text-xs text-text-muted font-bold">이관된 과거 기록</span></div>
          <h3 className="font-display text-lg text-text-primary mt-2">시즌 1 자산 기록</h3>
          <p className="text-xs text-text-secondary mt-1">B.R.A.N.D 1.0에서 보존된 자산 이력입니다. 2.0 거래와 중복 합산하지 않고 별도 증거로 표시합니다.</p>
        </div>
        {legacy.length === 0 ? <CompactEmpty text="이관된 시즌 1 자산 기록이 없습니다." /> : (
          <div className="divide-y divide-line/60">
            {legacy.map((row) => <LegacyAssetRow key={row.source_row} row={row} />)}
          </div>
        )}
        {legacyTotal > legacy.length && <div className="text-2xs text-text-muted font-bold mt-3 text-right">총 {formatNumber(legacyTotal)}건 중 최근 {legacy.length}건 표시</div>}
      </section>
    </div>
  );
}

function LiveTransactionRow({ row }: { row: LiveTransaction }) {
  const source = SOURCE_LABELS[row.source_type] ?? { emoji: '📌', label: row.source_type };
  const tokenLabel = row.value_token === 'GOLD' ? 'GOLD' : row.value_token;
  const amountClass = row.amount > 0 ? 'text-success' : row.amount < 0 ? 'text-danger' : 'text-text-secondary';
  return (
    <div className="py-3 flex gap-3 items-start">
      <div className="w-9 h-9 rounded-full bg-bg-deep border border-line flex items-center justify-center shrink-0">{source.emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="text-sm font-extrabold text-text-primary">{source.label}</div>
          <div className={`font-mono text-sm font-black ${amountClass}`}>{formatDelta(Number(row.amount))} {tokenLabel}</div>
        </div>
        <div className="text-xs text-text-secondary mt-1 break-words">{row.memo || '상세 메모 없음'}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted font-bold mt-1.5">
          <span>{formatDateTime(row.created_at)}</span>
          <span>잔액 {formatNumber(Number(row.balance_after))}</span>
          {Number(row.tax_amount) > 0 && <span>세금 {formatNumber(Number(row.tax_amount))}</span>}
        </div>
      </div>
    </div>
  );
}

function LegacyAssetRow({ row }: { row: LegacyAssetHistoryRow }) {
  const hasBv = Number(row.bv_delta) !== 0;
  const hasGold = Number(row.gold_delta) !== 0;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-text-primary break-words">{row.memo || '시즌 1 자산 변동'}</div>
          <div className="text-2xs text-text-muted font-bold mt-1">{formatDateOnly(row.event_date)}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {hasGold && <DeltaPill label="GOLD" value={Number(row.gold_delta)} />}
          {hasBv && <DeltaPill label="BV" value={Number(row.bv_delta)} tone="bv" />}
          {!hasGold && !hasBv && <span className="text-2xs text-text-muted border border-line rounded-pill px-2 py-1">변동 0</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted mt-2">
        <span>기록 후 GOLD {formatNumber(Number(row.balance_after_gold))}</span>
        <span>BV {formatNumber(Number(row.balance_after_bv))}</span>
      </div>
    </div>
  );
}

function AchievementHistory({ rows }: { rows: AchievementCatalogRow[] }) {
  if (!rows.length) return <EmptyState emoji="🏆" title="아직 획득한 업적이 없어요" description="업적을 달성하면 획득 시점과 보상이 이곳에 쌓입니다." />;
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="flex flex-wrap justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-lg text-text-primary">🏆 획득 업적</h3>
          <p className="text-xs text-text-secondary mt-1">시즌 1에서 이관된 업적과 2.0에서 새로 획득한 업적을 현재 업적 SSOT 기준으로 표시합니다.</p>
        </div>
        <Link to="/achievement" className="btn-secondary text-xs">업적도감 열기</Link>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-card-md border border-line bg-bg-deep p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-2xs font-black text-bv">{row.grade}{row.is_equipped ? ' · 장착 중' : ''}</div>
                <div className="text-sm font-extrabold text-text-primary mt-1 break-words">{row.name}</div>
              </div>
              <span className="text-lg">{row.is_secret ? '🌌' : '🏅'}</span>
            </div>
            <div className="text-xs text-text-secondary mt-2 line-clamp-2">{row.condition_text}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {row.reward_bv > 0 && <RewardChip text={`+${formatNumber(row.reward_bv)} BV`} />}
              {row.reward_gold > 0 && <RewardChip text={`+${formatNumber(row.reward_gold)} GOLD`} />}
              {row.reward_crystal > 0 && <RewardChip text={`+${formatNumber(row.reward_crystal)} CRYSTAL`} />}
            </div>
            <div className="text-2xs text-text-muted font-bold mt-2">{row.achieved_at ? formatDate(row.achieved_at, { year: true }) : '획득일 미기록'}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ItemHistory({ rows, total }: { rows: StudentItemHistoryRow[]; total: number }) {
  const eventLabel: Record<string, { emoji: string; label: string }> = {
    PURCHASE: { emoji: '🛒', label: '구매' },
    SALE: { emoji: '💰', label: '판매' },
    USE: { emoji: '🎯', label: '사용' },
  };
  return (
    <section className="bg-bg-card border border-line rounded-card-md p-4">
      <div className="flex flex-wrap justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-lg text-text-primary">🎒 아이템 이용 기록</h3>
          <p className="text-xs text-text-secondary mt-1">시장·인벤토리의 기존 Lot/Event 기록을 그대로 읽어 최근 이용 내역을 보여줍니다.</p>
        </div>
        <Link to="/market/history" className="btn-secondary text-xs">전체 아이템 기록</Link>
      </div>
      {!rows.length ? <CompactEmpty text="아직 아이템 이용 기록이 없습니다." /> : (
        <div className="divide-y divide-line/60">
          {rows.map((row) => {
            const event = eventLabel[row.event_type] ?? { emoji: '📦', label: row.event_type };
            return (
              <div key={row.inventory_event_id} className="py-3 flex gap-3">
                <div className="w-9 h-9 rounded-full bg-bg-deep border border-line flex items-center justify-center shrink-0">{event.emoji}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-text-primary break-words">{row.item_name}</div>
                    <div className="text-xs font-black text-gold">{event.label} · {formatNumber(Math.abs(row.quantity))}개</div>
                  </div>
                  <div className="text-2xs text-text-muted font-bold mt-1.5">{formatDateTime(row.created_at)}{row.gold_delta !== 0 ? ` · GOLD ${formatDelta(row.gold_delta)}` : ''}</div>
                  {row.fulfillment_status && <div className="text-2xs text-text-secondary mt-1">전달 상태: {fulfillmentLabel(row.fulfillment_status)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {total > rows.length && <div className="text-2xs text-text-muted font-bold mt-3 text-right">총 {formatNumber(total)}건 중 최근 {rows.length}건 표시</div>}
    </section>
  );
}

function AttendanceHistory({
  rows,
  dashboard,
  total,
}: {
  rows: AttendanceHistoryRow[];
  dashboard: AttendanceDashboard;
  total: number;
}) {
  const late = rows.filter((row) => row.status === 'LATE').length;
  const absent = rows.filter((row) => row.status === 'ABSENT').length;
  const excused = rows.filter((row) => row.status === 'EXCUSED').length;

  return (
    <section className="space-y-3">
      <div className="rounded-card-md border border-line bg-bg-deep/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge label="B.R.A.N.D 2.0" />
          <span className="text-xs text-text-muted font-bold">서버 확정 출석 기록</span>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          현재 연속 출석과 누적 출석은 서버의 출석 대시보드 기준으로 표시하며, 아래 타임라인은 본인에게만 허용된 출석 이력을 읽습니다.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Mini label="누적 출석 인정" value={`${formatNumber(dashboard.total_attendance)}일`} />
        <Mini label="현재 연속 출석" value={`${formatNumber(dashboard.current_streak)}일`} />
        <Mini label="지각" value={`${formatNumber(late)}일`} />
        <Mini label="결석" value={`${formatNumber(absent)}일`} />
        <Mini label="인정결석" value={`${formatNumber(excused)}일`} />
      </div>

      <div className="bg-bg-card border border-line rounded-card-md p-4">
        <div className="mb-3">
          <h3 className="font-display text-lg text-text-primary">📅 출석 타임라인</h3>
          <p className="text-xs text-text-secondary mt-1">교사가 확정한 본인의 출석 기록을 최신 날짜부터 표시합니다.</p>
        </div>
        {!rows.length ? <CompactEmpty text="아직 출석 기록이 없습니다." /> : (
          <div className="grid sm:grid-cols-2 gap-2">
            {rows.map((row) => {
              const state = ATTENDANCE_LABEL[row.status];
              return (
                <div key={row.id} className="rounded-card-md border border-line bg-bg-deep px-3 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-text-primary">{formatDateOnly(row.attendance_date)}</div>
                    <div className="text-2xs text-text-muted font-bold mt-1">연속 {formatNumber(row.streak_days)}일 · 누적 {formatNumber(row.total_attendance)}일</div>
                  </div>
                  <span className={`shrink-0 rounded-pill border px-2.5 py-1 text-xs font-black ${state.className}`}>{state.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {total > rows.length && (
          <div className="text-2xs text-text-muted font-bold mt-3 text-right">
            총 {formatNumber(total)}건 중 최근 {rows.length}건 표시
          </div>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ emoji, title, description }: { emoji: string; title: string; description?: string }) {
  return (
    <div className="mb-2">
      <h2 className="font-display text-lg text-brand-gradient">{emoji} {title}</h2>
      {description && <div className="text-xs text-text-muted font-bold mt-1">{description}</div>}
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

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-card border border-line rounded-card-md p-3">
      <div className="text-2xs text-text-muted font-bold">{label}</div>
      <div className="font-display text-lg text-gold mt-1">{value}</div>
    </div>
  );
}

function SourceBadge({ label, tone = 'gold' }: { label: string; tone?: 'gold' | 'bv' }) {
  return <span className={`rounded-pill border px-2.5 py-1 text-2xs font-black ${tone === 'gold' ? 'border-gold/35 bg-gold/10 text-gold' : 'border-bv/35 bg-bv/10 text-bv'}`}>{label}</span>;
}

function DeltaPill({ label, value, tone = 'gold' }: { label: string; value: number; tone?: 'gold' | 'bv' }) {
  const signClass = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-text-muted';
  return <span className={`rounded-pill border px-2 py-1 text-2xs font-black ${tone === 'gold' ? 'border-gold/25 bg-gold/5' : 'border-bv/25 bg-bv/5'} ${signClass}`}>{label} {formatDelta(value)}</span>;
}

function RewardChip({ text }: { text: string }) {
  return <span className="rounded-pill border border-gold/20 bg-gold/5 px-2 py-1 text-2xs text-gold font-black">{text}</span>;
}

function CompactEmpty({ text }: { text: string }) {
  return <div className="rounded-card-md border border-dashed border-line bg-bg-deep px-4 py-8 text-center text-sm text-text-muted font-bold">{text}</div>;
}

function formatDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function fulfillmentLabel(value: string) {
  if (value === 'PENDING') return '전달 대기';
  if (value === 'DELIVERED') return '전달 완료';
  if (value === 'CANCELLED') return '취소';
  return value;
}
