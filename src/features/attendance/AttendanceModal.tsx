// =====================================================================
// B.R.A.N.D 2.0 — 출석 모달 (월별 출석판)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생이 출석 버튼을 누르면 월별 출석 현황 표시.
// 출석 기록 자체는 교사 전용(record_attendance)이며 학생은 조회만 합니다.
// 이 모달은 "확인" 용도.
// 
// 표시:
//   - 이번 달 출석한 날짜
//   - 다음 마일스톤까지 며칠 (3·7·14·28일)
//   - 받은 보상 누적
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Modal, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { formatNumber, getKstDateString } from '@/lib/utils/format';
import { feature4QueryError } from '@/lib/feature4_debug';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// AttendanceModal — 메인 컴포넌트
// =====================================================================

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
        <div className="py-8 flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* streak 강조 */}
          <StreakBlock streak={data.streak} />
          
          {/* 월별 출석 캘린더 */}
          <MonthCalendar 
            year={data.currentYear}
            month={data.currentMonth}
            attendedDates={data.attendedDates}
            today={data.today}
          />
          
          {/* 마일스톤 진행 */}
          <MilestoneProgress 
            currentStreak={data.streak}
            achievedMilestones={data.achievedMilestones}
          />
          
          {/* 이번 달 보상 누적 */}
          <RewardSummary 
            totalGold={data.monthlyRewardGold}
            totalBv={data.monthlyRewardBv}
          />
        </div>
      )}
    </Modal>
  );
}

// =====================================================================
// Streak 강조 블록
// =====================================================================

function StreakBlock({ streak }: { streak: number }) {
  return (
    <div className="bg-gradient-to-br from-brand-primary/20 to-gold/15 border border-line-brand rounded-card-lg p-4 flex items-center gap-4">
      <div className="text-5xl drop-shadow-[0_4px_12px_rgba(255,140,66,0.5)]">🔥</div>
      <div className="flex-1">
        <div className="text-2xs font-black uppercase tracking-widest text-text-secondary mb-1">
          연속 출석
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl text-white tracking-tighter leading-none">
            {streak}
          </span>
          <span className="text-base text-text-secondary font-extrabold">일째</span>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 월별 캘린더
// =====================================================================

interface MonthCalendarProps {
  year: number;
  month: number;          // 1~12
  attendedDates: number[]; // 출석한 날짜들 (1~31)
  today: number;          // 오늘 날짜
}

function MonthCalendar({ year, month, attendedDates, today }: MonthCalendarProps) {
  // 해당 월 첫 날의 요일 (0=일요일 ~ 6=토요일)
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  // 해당 월의 마지막 날
  const lastDate = new Date(year, month, 0).getDate();
  
  // 캘린더 그리드 (앞쪽 빈 칸 + 1~lastDate)
  const days: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: lastDate }, (_, i) => i + 1),
  ];
  
  const attendedSet = new Set(attendedDates);
  
  return (
    <div>
      <div className="text-sm font-extrabold text-text-primary mb-3 flex items-center gap-2">
        <span>📆</span>
        <span>{year}년 {month}월</span>
      </div>
      
      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={cn(
            'text-center text-2xs font-extrabold py-1',
            i === 0 ? 'text-danger' : i === 6 ? 'text-bv' : 'text-text-muted'
          )}>
            {d}
          </div>
        ))}
      </div>
      
      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="aspect-square" />;
          }
          
          const isAttended = attendedSet.has(day);
          const isToday = day === today;
          
          return (
            <motion.div
              key={day}
              whileHover={{ scale: 1.05 }}
              className={cn(
                'aspect-square rounded-card-sm flex items-center justify-center text-xs font-extrabold transition-all relative',
                isToday && 'ring-2 ring-brand-primary ring-offset-2 ring-offset-bg-base',
                isAttended
                  ? 'bg-gradient-to-br from-brand-primary to-gold text-white shadow-brand-sm'
                  : 'bg-bg-deep text-text-muted'
              )}
            >
              {day}
              {isAttended && (
                <span className="absolute -top-0.5 -right-0.5 text-2xs">✨</span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// 마일스톤 진행
// =====================================================================

interface MilestoneProgressProps {
  currentStreak: number;
  achievedMilestones: number[];  // 이미 받은 마일스톤 일수
}

const MILESTONES = [3, 7, 14, 28];

function MilestoneProgress({ currentStreak, achievedMilestones }: MilestoneProgressProps) {
  const achievedSet = new Set(achievedMilestones);
  
  // 다음 마일스톤
  const nextMilestone = MILESTONES.find((m) => m > currentStreak);
  const daysToNext = nextMilestone ? nextMilestone - currentStreak : 0;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-extrabold text-text-primary flex items-center gap-2">
          <span>🎯</span>
          <span>마일스톤</span>
        </div>
        {nextMilestone && (
          <div className="text-xs font-bold text-gold">
            {nextMilestone}일까지 {daysToNext}일 ✨
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-4 gap-2">
        {MILESTONES.map((day) => {
          const achieved = achievedSet.has(day);
          const isNext = nextMilestone === day;
          
          return (
            <div
              key={day}
              className={cn(
                'rounded-card-sm py-2.5 px-2 text-center border transition-all',
                achieved
                  ? 'bg-gradient-to-br from-brand-primary/30 to-gold/20 border-line-brand'
                  : isNext
                    ? 'bg-bg-card border-brand-primary/50 animate-pulse-border'
                    : 'bg-bg-deep border-line opacity-60'
              )}
            >
              <div className="font-display text-base text-white">{day}일</div>
              <div className="text-2xs text-text-secondary mt-0.5">
                {achieved ? '✅' : isNext ? '진행중' : '대기'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// 보상 누적
// =====================================================================

function RewardSummary({ totalGold, totalBv }: { totalGold: number; totalBv: number }) {
  return (
    <div className="bg-bg-deep border border-line rounded-card-md p-3.5">
      <div className="text-2xs font-extrabold text-text-secondary uppercase tracking-widest mb-2">
        이번 달 출석 보상 누적
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🪙</span>
          <span className="font-display text-base text-gold">
            {formatNumber(totalGold)}
          </span>
          <span className="text-xs text-text-secondary font-bold">골드</span>
        </div>
        <div className="w-px h-5 bg-line" />
        <div className="flex items-center gap-1.5">
          <span className="text-base">⭐</span>
          <span className="font-display text-base text-bv">
            {formatNumber(totalBv)}
          </span>
          <span className="text-xs text-text-secondary font-bold">BV</span>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 데이터 조회
// =====================================================================

interface AttendanceData {
  streak: number;
  currentYear: number;
  currentMonth: number;
  today: number;
  attendedDates: number[];
  achievedMilestones: number[];
  monthlyRewardGold: number;
  monthlyRewardBv: number;
}

function useAttendanceData(studentId: number | null) {
  return useQuery<AttendanceData>({
    queryKey: ['attendance', studentId],
    queryFn: async () => {
      if (!studentId) throw new Error('학생 정보 없음');
      
      const [yearText, monthText, dayText] = getKstDateString().split('-');
      const year = Number(yearText);
      const month = Number(monthText);
      const today = Number(dayText);
      const monthStartDate = `${yearText}-${monthText}-01`;
      const monthStartIso = new Date(`${monthStartDate}T00:00:00+09:00`).toISOString();
      
      // 1. 이번 달 출석 기록
      const { data: attendances, error: attendanceError } = await supabase
        .from('attendances')
        .select('attendance_date, status')
        .eq('student_id', studentId)
        .gte('attendance_date', monthStartDate)
        .in('status', ['PRESENT', 'LATE']);
      if (attendanceError) throw feature4QueryError('F4C', 'attendance-modal-days', attendanceError);
      
      const attendedDates = (attendances ?? [])
        .map((a) => Number((a.attendance_date as string).split('-')[2]));
      
      // 2. streak 계산 (역순으로)
      let streak = 0;
      for (let i = today; i >= 1; i--) {
        if (attendedDates.includes(i)) {
          streak++;
        } else {
          break;
        }
      }
      
      // 3. 마일스톤 달성 여부 (attendance_milestones 테이블)
      const { data: milestones, error: milestoneError } = await supabase
        .from('attendance_milestones')
        .select('milestone_days, achieved_on')
        .eq('student_id', studentId)
        .gte('achieved_on', monthStartDate);
      if (milestoneError) throw feature4QueryError('F4C', 'attendance-modal-milestones', milestoneError);
      
      const achievedMilestones = (milestones ?? []).map((m) => m.milestone_days);
      
      // 4. 이번 달 출석 보상 합계 (transactions)
      const { data: rewardTxs, error: rewardError } = await supabase
        .from('transactions')
        .select('value_token, amount')
        .eq('student_id', studentId)
        .eq('is_reversed', false)
        .in('source_type', ['ATTENDANCE_BONUS', 'ATTENDANCE_STREAK'])
        .gte('created_at', monthStartIso);
      if (rewardError) throw feature4QueryError('F4C', 'attendance-modal-rewards', rewardError);
      
      let monthlyRewardGold = 0;
      let monthlyRewardBv = 0;
      
      (rewardTxs ?? []).forEach((tx) => {
        if (tx.value_token === 'GOLD') monthlyRewardGold += Number(tx.amount);
        else if (tx.value_token === 'BV') monthlyRewardBv += Number(tx.amount);
      });
      
      return {
        streak,
        currentYear: year,
        currentMonth: month,
        today,
        attendedDates,
        achievedMilestones,
        monthlyRewardGold,
        monthlyRewardBv,
      };
    },
    enabled: studentId !== null,
  });
}
