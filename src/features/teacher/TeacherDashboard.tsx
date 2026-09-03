// =====================================================================
// B.R.A.N.D 2.0 — 교사 대시보드
// Stage 6-D · 생성일 2026-05-20
// =====================================================================
// 학급 전체 상태 한눈에 보기.
// - 학생 활동 통계
// - 경제 지표 (지니계수·총 자산 분포)
// - 검토 대기 알림
// - 최근 활동 피드
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LoadingSpinner } from '@/components/shared/components';
import { TeacherShell, StatCard } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId, useCurrentStudent } from '@/stores/auth_store';
import { formatNumber, formatRelativeTime } from '@/lib/utils/format';

// =====================================================================
// TeacherDashboard 메인
// =====================================================================

export default function TeacherDashboard() {
  const classroomId = useClassroomId();
  const teacher = useCurrentStudent();
  const { data, isLoading } = useDashboardSummary(classroomId);
  
  return (
    <TeacherShell>
      <div className="space-y-6">
        {/* 인사말 + 학급 정보 */}
        <div>
          <h1 className="font-display text-2xl text-brand-gradient tracking-tight mb-1">
            {teacher?.studentName ?? '선생님'}, 안녕하세요 👋
          </h1>
          <p className="text-sm text-text-secondary font-bold">
            {teacher?.classroomName ?? ''} · 오늘도 좋은 하루 되세요!
          </p>
        </div>
        
        {isLoading || !data ? (
          <div className="py-12 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : (
          <>
            {/* 4개 핵심 지표 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                emoji="👥"
                label="활성 학생"
                value={`${data.activeStudents} / ${data.totalStudents}`}
                color="bv"
              />
              <StatCard
                emoji="🔄"
                label="오늘 거래"
                value={formatNumber(data.todayTransactions)}
                color="gold"
              />
              <StatCard
                emoji="📋"
                label="검토 대기"
                value={data.pendingReviewCount}
                color={data.pendingReviewCount > 0 ? 'danger' : 'success'}
              />
              <StatCard
                emoji="📊"
                label="지니계수"
                value={data.giniIndex.toFixed(3)}
                color={data.giniIndex < 0.3 ? 'success' : data.giniIndex < 0.5 ? 'gold' : 'danger'}
              />
            </div>
            
            {/* 2단 레이아웃 — 검토 + 최근 활동 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 검토 대기 큐 */}
              <PendingReviewPanel
                count={data.pendingReviewCount}
                items={data.pendingItems}
              />
              
              {/* 최근 활동 */}
              <RecentActivityPanel activities={data.recentActivities} />
            </div>
            
            {/* 학급 자산 분포 */}
            <WalletDistributionPanel distribution={data.walletDistribution} />
            
            {/* 빠른 액션 */}
            <QuickActions />
          </>
        )}
      </div>
    </TeacherShell>
  );
}

// =====================================================================
// 검토 대기 큐 패널
// =====================================================================

function PendingReviewPanel({ count, items }: { count: number; items: any[] }) {
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2">
          <span>📋</span>
          <span>검토 대기</span>
        </h3>
        <Link
          to="/teacher/review"
          className="text-xs font-bold text-gold hover:text-gold-100"
        >
          전체 보기 →
        </Link>
      </div>
      
      {count === 0 ? (
        <div className="py-6 text-center">
          <span className="text-3xl">✅</span>
          <p className="text-sm text-text-secondary font-bold mt-2">
            모두 처리됐어요!
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((item, idx) => {
            const body = (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-extrabold text-text-primary truncate">
                    {item.type}: {item.title}
                  </div>
                  <div className="text-2xs text-text-muted font-bold truncate">
                    {item.studentName} · {formatRelativeTime(item.createdAt)}
                  </div>
                </div>
                <div className="text-2xs font-black text-warning bg-warning-bg px-2 py-0.5 rounded-pill flex-shrink-0">
                  대기
                </div>
              </>
            );
            const cls = "bg-bg-deep border border-line rounded-card-sm px-3 py-2 flex items-center justify-between gap-2";
            return 'to' in item && item.to ? <Link key={idx} to={item.to} className={`${cls} hover:border-gold/30`}>{body}</Link> : <div key={idx} className={cls}>{body}</div>;
          })}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 최근 활동
// =====================================================================

function RecentActivityPanel({ activities }: { activities: any[] }) {
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2 mb-3">
        <span>💬</span>
        <span>최근 활동</span>
      </h3>
      
      {activities.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-text-muted font-bold">활동이 없어요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activities.slice(0, 6).map((activity, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 py-1.5"
            >
              <span className="text-lg flex-shrink-0">{activity.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-primary truncate">
                  <span className="font-extrabold">{activity.studentName}</span>
                  <span className="text-text-secondary"> · {activity.text}</span>
                </div>
                <div className="text-2xs text-text-muted font-bold">
                  {formatRelativeTime(activity.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 자산 분포
// =====================================================================

function WalletDistributionPanel({ distribution }: { distribution: any }) {
  return (
    <div className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4">
      <h3 className="font-display text-base text-white tracking-tight flex items-center gap-2 mb-3">
        <span>💰</span>
        <span>학급 자산 분포</span>
      </h3>
      
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">
            BV 총합
          </div>
          <div className="font-mono text-xl text-bv font-bold">
            {formatNumber(distribution.totalBv)}
          </div>
          <div className="text-2xs text-text-muted mt-0.5">
            평균 {formatNumber(distribution.avgBv)}
          </div>
        </div>
        
        <div>
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">
            골드 총합
          </div>
          <div className="font-mono text-xl text-gold font-bold">
            {formatNumber(distribution.totalGold)}
          </div>
          <div className="text-2xs text-text-muted mt-0.5">
            평균 {formatNumber(distribution.avgGold)}
          </div>
        </div>
        
        <div>
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">
            복지기금
          </div>
          <div className="font-mono text-xl text-success font-bold">
            {formatNumber(distribution.welfareFund)}
          </div>
          <div className="text-2xs text-text-muted mt-0.5">
            대기 중
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 빠른 액션 버튼들
// =====================================================================

function QuickActions() {
  const actions = [
    { to: '/teacher/control',   icon: '💳', label: '자산 지급·차감',   color: 'from-bv to-brand-primary' },
    { to: '/teacher/control',   icon: '🚨', label: '비상사태 관리',     color: 'from-danger to-brand-primary' },
    { to: '/teacher/auction',   icon: '🔨', label: '경매 시작',         color: 'from-gold to-brand-primary' },
    { to: '/teacher/characters', icon: '✦', label: '편린 운영',         color: 'from-crystal to-brand-primary' },
    { to: '/teacher/market',    icon: '🏪', label: '시장 상품 운영',     color: 'from-gold to-success' },
    { to: '/teacher/primary-jobs', icon: '🧑‍💼', label: '1인1역 관리',      color: 'from-success to-bv' },
    { to: '/teacher/daily-quests', icon: '📋', label: '일일퀘스트 정산',   color: 'from-gold to-bv' },
    { to: '/bakery',            icon: '🧁', label: '제과점 비상 운영',   color: 'from-brand-primary to-crystal' },
    { to: '/teacher/control',   icon: '🤝', label: '복지 분배',         color: 'from-success to-crystal' },
    { to: '/teacher/economy-guard', icon: '🛡️', label: '경제수호대', color: 'from-brand-primary to-gold' },
  ];
  
  return (
    <div>
      <div className="text-xs font-extrabold text-text-secondary uppercase tracking-widest mb-2 px-1">
        빠른 액션
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-10 gap-2">
        {actions.map((action, idx) => (
          <Link key={idx} to={action.to}>
            <motion.div
              whileTap={{ scale: 0.97 }}
              className={`bg-gradient-to-br ${action.color} bg-opacity-20 p-3 rounded-card-md border border-line text-center hover-lift cursor-pointer`}
            >
              <div className="text-2xl mb-1">{action.icon}</div>
              <div className="text-2xs font-black text-white">
                {action.label}
              </div>
            </motion.div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// 데이터 조회
// =====================================================================

function useDashboardSummary(classroomId: number | null) {
  return useQuery({
    queryKey: ['teacher-dashboard', classroomId],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보 없음');
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();
      const seoulToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      
      const [
        studentsRes,
        todayTxRes,
        pendingAchievementsRes,
        pendingJobsRes,
        pendingDailyQuestRes,
        walletsRes,
        recentTxRes,
      ] = await Promise.all([
        // 학생 카운트
        supabase
          .from('students')
          .select('id, transferred_at', { count: 'exact' })
          .eq('classroom_id', classroomId)
          .eq('role', 'STUDENT'),
        
        // 오늘 거래
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('classroom_id', classroomId)
          .gte('created_at', todayIso),
        
        // 검토 대기 업적 신청 — A3 teacher-only read boundary
        supabase.rpc('teacher_get_achievement_review_queue', { p_classroom_id: classroomId }),
        
        // 검토 대기 2차직업 신청
        supabase
          .from('secondary_job_applications')
          .select(`
            id, job_name, created_at,
            student:students!student_id(name, brand_name)
          `)
          .eq('classroom_id', classroomId)
          .eq('status', 'PENDING')
          .order('created_at', { ascending: false })
          .limit(5),
        
        // 오늘 일일퀘스트 관리자 제출본
        supabase
          .from('daily_quest_reports')
          .select('id, quest_date, status, submitted_at')
          .eq('classroom_id', classroomId)
          .eq('quest_date', seoulToday)
          .eq('status', 'SUBMITTED')
          .limit(1),

        // 학급 wallets
        supabase
          .from('wallets')
          .select('bv, gold, student:students!student_id(classroom_id)')
          .limit(100),
        
        // 최근 거래 (활동 피드)
        supabase
          .from('transactions')
          .select(`
            id, source_type, amount, value_token, created_at,
            student:students!student_id(name, brand_name)
          `)
          .eq('classroom_id', classroomId)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      
      // 활성 학생: 전출일이 없는 현재 재학 학생
      const activeStudents = (studentsRes.data ?? [])
        .filter((s: any) => s.transferred_at === null)
        .length;
      
      // 검토 대기 통합
      const achievementBoard = (pendingAchievementsRes.data as any) ?? { applications: [] };
      const pendingItems = [
        ...((achievementBoard.applications ?? []) as any[]).slice(0, 5).map((a: any) => ({
          type: a.application_kind === 'SPECIAL_REPORT' ? '히든 특별보고' : '업적 신청',
          title: a.application_kind === 'SPECIAL_REPORT' ? '히든 업적 특별보고' : (a.achievement_name ?? ''),
          studentName: a.student_name || '학생',
          createdAt: a.created_at,
        })),
        ...(pendingJobsRes.data ?? []).map((j: any) => ({
          type: '2차직업 신청',
          title: j.job_name,
          studentName: j.student?.brand_name || j.student?.name || '학생',
          createdAt: j.created_at,
        })),
        ...(pendingDailyQuestRes.data ?? []).map((r: any) => ({
          type: '일일퀘스트',
          title: `${r.quest_date} 정산 대기`,
          studentName: '일일퀘스트 관리자 제출',
          createdAt: r.submitted_at,
          to: '/teacher/daily-quests',
        })),
      ];
      
      // 자산 분포
      const classroomWallets = (walletsRes.data ?? [])
        .filter((w: any) => w.student?.classroom_id === classroomId);
      const totalBv = classroomWallets.reduce((s, w) => s + Number(w.bv), 0);
      const totalGold = classroomWallets.reduce((s, w) => s + Number(w.gold), 0);
      const avgBv = classroomWallets.length > 0 ? Math.round(totalBv / classroomWallets.length) : 0;
      const avgGold = classroomWallets.length > 0 ? Math.round(totalGold / classroomWallets.length) : 0;
      
      // 지니계수 (간이 계산 — 골드 기준)
      const sortedGolds = classroomWallets.map((w) => Number(w.gold)).sort((a, b) => a - b);
      let giniIndex = 0;
      if (sortedGolds.length > 1) {
        let sumOfDiffs = 0;
        for (let i = 0; i < sortedGolds.length; i++) {
          for (let j = i + 1; j < sortedGolds.length; j++) {
            sumOfDiffs += Math.abs(sortedGolds[i]! - sortedGolds[j]!);
          }
        }
        const meanGold = totalGold / sortedGolds.length;
        if (meanGold > 0) {
          giniIndex = sumOfDiffs / (sortedGolds.length * sortedGolds.length * meanGold);
        }
      }
      
      // 활동 피드
      const recentActivities = (recentTxRes.data ?? []).map((tx: any) => ({
        studentName: tx.student?.brand_name || tx.student?.name || '학생',
        text: getActivityText(tx.source_type, tx.amount, tx.value_token),
        emoji: getActivityEmoji(tx.source_type),
        createdAt: tx.created_at,
      }));
      
      return {
        totalStudents: studentsRes.count ?? 0,
        activeStudents,
        todayTransactions: todayTxRes.count ?? 0,
        pendingReviewCount: pendingItems.length,
        pendingItems,
        walletDistribution: {
          totalBv, avgBv, totalGold, avgGold,
          welfareFund: 0,  // TODO: welfare_fund 테이블 조회
        },
        giniIndex,
        recentActivities,
      };
    },
    enabled: classroomId !== null,
    staleTime: 1000 * 30,
  });
}

function getActivityText(sourceType: string, amount: number, valueToken: string): string {
  const map: Record<string, string> = {
    SNACK_PURCHASE: `간식 구매 (-${Math.abs(amount)} ${valueToken})`,
    P2P_SEND: `P2P 송금 (-${Math.abs(amount)} ${valueToken})`,
    P2P_RECEIVE: `P2P 수령 (+${amount} ${valueToken})`,
    AUCTION_WIN: `경매 낙찰`,
    ACHIEVEMENT_REWARD: `업적 보상 (+${amount} ${valueToken})`,
    DAILY_QUEST: `일일퀘스트 완료 (+${amount} ${valueToken})`,
    ATTENDANCE_BONUS: `출석 보상 (+${amount} ${valueToken})`,
  };
  return map[sourceType] || `${sourceType}`;
}

function getActivityEmoji(sourceType: string): string {
  const map: Record<string, string> = {
    SNACK_PURCHASE: '🍪',
    P2P_SEND: '↗️',
    P2P_RECEIVE: '↘️',
    AUCTION_WIN: '🔨',
    ACHIEVEMENT_REWARD: '🏆',
    DAILY_QUEST: '⚔️',
    ATTENDANCE_BONUS: '📅',
  };
  return map[sourceType] || '·';
}
