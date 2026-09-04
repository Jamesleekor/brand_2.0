import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Modal, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { cn } from '@/lib/utils/cn';
import { recordsRpc } from '@/lib/rpc/records_rpc';

interface AttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AttendanceModal({ isOpen, onClose }: AttendanceModalProps) {
  const studentId = useStudentId();
  const { data, isLoading, isError, error, refetch } = useAttendanceData(studentId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="출석 현황" emoji="📅" size="md">
      {isError ? (
        <Feature4ErrorPanel domain="F4C" error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>
      ) : (
        <div className="space-y-5">
          <StreakBlock streak={data.streak} totalAttendance={data.totalAttendance} />
          <MonthCalendar year={data.currentYear} month={data.currentMonth} attendedDates={data.attendedDates} today={data.today} />
          <MilestoneProgress currentStreak={data.streak} achievedMilestones={data.achievedMilestones} />
          <RewardSummary totalGold={data.monthlyRewardGold} totalBv={data.monthlyRewardBv} totalCrystal={data.monthlyRewardCrystal} />
        </div>
      )}
    </Modal>
  );
}

function StreakBlock({ streak, totalAttendance }: { streak: number; totalAttendance: number }) {
  return (
    <div className="bg-gradient-to-br from-brand-primary/20 to-gold/15 border border-line-brand rounded-card-lg p-4 flex items-center gap-4">
      <div className="text-5xl drop-shadow-[0_4px_12px_rgba(255,140,66,0.5)]">🔥</div>
      <div className="flex-1">
        <div className="text-2xs font-black uppercase tracking-widest text-text-secondary mb-1">연속 출석</div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl text-white tracking-tighter leading-none">{streak}</span>
          <span className="text-base text-text-secondary font-extrabold">일째</span>
        </div>
        <div className="text-2xs text-text-muted font-bold mt-1">누적 출석 인정 {formatNumber(totalAttendance)}일</div>
      </div>
    </div>
  );
}

interface MonthCalendarProps {
  year: number;
  month: number;
  attendedDates: number[];
  today: number;
}

function MonthCalendar({ year, month, attendedDates, today }: MonthCalendarProps) {
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const days: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: lastDate }, (_, i) => i + 1),
  ];
  const attendedSet = new Set(attendedDates);

  return (
    <div>
      <div className="text-sm font-extrabold text-text-primary mb-3 flex items-center gap-2"><span>📆</span><span>{year}년 {month}월</span></div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={cn('text-center text-2xs font-extrabold py-1', i === 0 ? 'text-danger' : i === 6 ? 'text-bv' : 'text-text-muted')}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="aspect-square" />;
          const isAttended = attendedSet.has(day);
          const isToday = day === today;
          return (
            <motion.div
              key={day}
              whileHover={{ scale: 1.05 }}
              className={cn(
                'aspect-square rounded-card-sm flex items-center justify-center text-xs font-extrabold transition-all relative',
                isToday && 'ring-2 ring-brand-primary ring-offset-2 ring-offset-bg-base',
                isAttended ? 'bg-gradient-to-br from-brand-primary to-gold text-white shadow-brand-sm' : 'bg-bg-deep text-text-muted',
              )}
            >
              {day}
              {isAttended && <span className="absolute -top-0.5 -right-0.5 text-2xs">✨</span>}
            </motion.div>
          );
        })}
      </div>
      <div className="text-2xs text-text-muted font-bold mt-2">출석·지각·인정결석은 서버 기준에 따라 출석 인정일로 표시됩니다.</div>
    </div>
  );
}

const MILESTONES = [3, 7, 14, 28];

function MilestoneProgress({ currentStreak, achievedMilestones }: { currentStreak: number; achievedMilestones: number[] }) {
  const achievedSet = new Set(achievedMilestones);
  const nextMilestone = MILESTONES.find((m) => m > currentStreak);
  const daysToNext = nextMilestone ? nextMilestone - currentStreak : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-extrabold text-text-primary flex items-center gap-2"><span>🎯</span><span>마일스톤</span></div>
        {nextMilestone && <div className="text-xs font-bold text-gold">{nextMilestone}일까지 {daysToNext}일 ✨</div>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {MILESTONES.map((day) => {
          const achieved = achievedSet.has(day);
          const isNext = nextMilestone === day;
          return (
            <div key={day} className={cn(
              'rounded-card-sm py-2.5 px-2 text-center border transition-all',
              achieved ? 'bg-gradient-to-br from-brand-primary/30 to-gold/20 border-line-brand' : isNext ? 'bg-bg-card border-brand-primary/50 animate-pulse-border' : 'bg-bg-deep border-line opacity-60',
            )}>
              <div className="font-display text-base text-white">{day}일</div>
              <div className="text-2xs text-text-secondary mt-0.5">{achieved ? '✅' : isNext ? '진행중' : '대기'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RewardSummary({ totalGold, totalBv, totalCrystal }: { totalGold: number; totalBv: number; totalCrystal: number }) {
  return (
    <div className="bg-bg-deep border border-line rounded-card-md p-3.5">
      <div className="text-2xs font-extrabold text-text-secondary uppercase tracking-widest mb-2">이번 달 출석 보상 누적</div>
      <div className="grid grid-cols-3 gap-2">
        <RewardValue emoji="🪙" value={totalGold} label="GOLD" className="text-gold" />
        <RewardValue emoji="⭐" value={totalBv} label="BV" className="text-bv" />
        <RewardValue emoji="💎" value={totalCrystal} label="Crystal" className="text-text-primary" />
      </div>
      <div className="text-2xs text-text-muted font-bold mt-2">일일퀘스트 정산 보상과 실제 마일스톤 지급 거래를 서버가 합산합니다.</div>
    </div>
  );
}

function RewardValue({ emoji, value, label, className }: { emoji: string; value: number; label: string; className: string }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-base">{emoji}</div>
      <div className={`font-display text-base ${className}`}>{formatNumber(value)}</div>
      <div className="text-2xs text-text-secondary font-bold truncate">{label}</div>
    </div>
  );
}

interface AttendanceData {
  streak: number;
  totalAttendance: number;
  currentYear: number;
  currentMonth: number;
  today: number;
  attendedDates: number[];
  achievedMilestones: number[];
  monthlyRewardGold: number;
  monthlyRewardBv: number;
  monthlyRewardCrystal: number;
}

function useAttendanceData(studentId: number | null) {
  return useQuery<AttendanceData>({
    queryKey: ['attendance-dashboard', studentId],
    queryFn: async () => {
      if (!studentId) throw new Error('학생 정보 없음');
      const dashboard = await recordsRpc.myAttendanceDashboard(supabase);
      const [yearText, monthText, dayText] = dashboard.kst_today.split('-');
      const monthlyRewardGold = Number(dashboard.monthly_daily_quest_reward.gold ?? 0) + Number(dashboard.monthly_milestone_reward.gold ?? 0);
      const monthlyRewardBv = Number(dashboard.monthly_daily_quest_reward.bv ?? 0) + Number(dashboard.monthly_milestone_reward.bv ?? 0);
      const monthlyRewardCrystal = Number(dashboard.monthly_daily_quest_reward.crystal ?? 0) + Number(dashboard.monthly_milestone_reward.crystal ?? 0);

      return {
        streak: Number(dashboard.current_streak ?? 0),
        totalAttendance: Number(dashboard.total_attendance ?? 0),
        currentYear: Number(yearText),
        currentMonth: Number(monthText),
        today: Number(dayText),
        attendedDates: dashboard.attended_dates ?? [],
        achievedMilestones: dashboard.achieved_milestones ?? [],
        monthlyRewardGold,
        monthlyRewardBv,
        monthlyRewardCrystal,
      };
    },
    enabled: studentId !== null,
  });
}
