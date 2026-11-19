import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Modal, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { formatNumber } from '@/lib/utils/format';
import { Feature4ErrorPanel } from '@/features/feature4/Feature4ErrorPanel';
import { cn } from '@/lib/utils/cn';
import { recordsRpc } from '@/lib/rpc/records_rpc';
import { getMyAttendanceQuestCalendar, type AttendanceQuestCalendar, type AttendanceQuestDay } from '@/lib/rpc/attendance_quest_rpc';
import { AttendanceQuestSummary } from './AttendanceQuestSummary';
import { AttendanceQuestCalendar as QuestCalendarView } from './AttendanceQuestCalendar';
import { AttendanceQuestWeekTable } from './AttendanceQuestWeekTable';
import { AttendanceQuestDayDetail } from './AttendanceQuestDayDetail';
import { AttendanceQuestAchievementCard } from './AttendanceQuestAchievementCard';
import { AQ } from './attendanceQuestModel';
import {
  canMoveWeek,
  defaultSelectedDate,
  monthStartOf,
  mondayOf,
  moveMonth,
  moveWeek,
  parseYmd,
  type NavBounds,
} from './attendanceQuestDates';

interface AttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// =====================================================================
// 출석 · 일일퀘스트 기록 창 (명세 v1.3)
// - 연속 출석·마일스톤·이번 달 보상: 기존 student_get_attendance_dashboard 그대로
// - 날짜별 퀘스트 기록: student_get_my_attendance_quest_calendar (월 단위, 읽기 전용)
// - 날짜 선택은 받은 월 응답 안에서만 처리하고 서버를 다시 부르지 않는다.
// =====================================================================
export function AttendanceModal({ isOpen, onClose }: AttendanceModalProps) {
  const studentId = useStudentId();
  const dashboardQuery = useAttendanceData(studentId, isOpen);

  // 기본 상태: 요청 월(null=서버 현재 월)·선택일·사용자가 의도한 일자
  const [requestedMonth, setRequestedMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [preferredDay, setPreferredDay] = useState<number | null>(null);
  const [bounds, setBounds] = useState<NavBounds | null>(null);
  const lastTodayRef = useRef<string | null>(null);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const weekRef = useRef<HTMLElement | null>(null);

  const calendarQuery = useQuery<AttendanceQuestCalendar>({
    queryKey: ['attendance-quest-calendar', studentId, requestedMonth ?? 'current'],
    queryFn: () => getMyAttendanceQuestCalendar(supabase, requestedMonth),
    enabled: isOpen && studentId !== null,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: 1,
  });
  const data = calendarQuery.data;

  // 다시 열 때는 30초 안이라도 서버에서 다시 확인한다(명세 13장)
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && calendarQuery.data) {
      void calendarQuery.refetch({ cancelRefetch: false });
      void dashboardQuery.refetch({ cancelRefetch: false });
    }
    wasOpenRef.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 창을 닫으면 다음에 다시 열 때 오늘부터 보이게 초기화
  useEffect(() => {
    if (isOpen) return;
    setRequestedMonth(null);
    setSelectedDate(null);
    setPreferredDay(null);
    lastTodayRef.current = null;
  }, [isOpen]);

  // 서버 응답이 오면 범위·오늘 갱신. 첫 열기에는 오늘을 선택. 자정이 지났고 이전 오늘을 보고 있었다면 새 오늘로.
  useEffect(() => {
    if (!data || !isOpen) return;
    const next: NavBounds = {
      rangeStart: data.coverage.earliest_available_date,
      rangeEnd: data.coverage.latest_available_date,
      today: data.kst_today,
      earliestMonth: data.coverage.earliest_month,
      latestMonth: data.coverage.latest_selectable_month,
    };
    setBounds(next);
    const previousToday = lastTodayRef.current;
    lastTodayRef.current = data.kst_today;
    if (selectedDate === null || (previousToday !== null && previousToday !== data.kst_today && selectedDate === previousToday)) {
      const initial = defaultSelectedDate(next);
      setSelectedDate(initial);
      setPreferredDay(parseYmd(initial).d);
      if (requestedMonth !== null && monthStartOf(initial) !== requestedMonth) setRequestedMonth(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isOpen, selectedDate]);

  const viewMonth = requestedMonth ?? data?.month ?? null;
  const dataMatchesView = data !== undefined && viewMonth !== null && data.month === viewMonth;

  const daysByDate = useMemo(() => {
    if (!dataMatchesView || !data) return null;
    const map = new Map<string, AttendanceQuestDay>();
    for (const day of data.days) map.set(day.date, day);
    return map;
  }, [data, dataMatchesView]);

  const weekStart = selectedDate ? mondayOf(selectedDate) : null;
  const week = dataMatchesView && data && weekStart ? data.weeks.find((w) => w.week_start === weekStart) ?? null : null;
  const selectedDay = daysByDate && selectedDate ? daysByDate.get(selectedDate) ?? null : null;
  const today = bounds?.today ?? data?.kst_today ?? '';

  // 오늘이 속한 달은 '서버 현재 월'(null) 조회와 같은 캐시를 쓴다
  const requestMonth = (month: string) => {
    setRequestedMonth(bounds && month === bounds.latestMonth ? null : month);
  };

  const selectDate = (date: string) => {
    if (!bounds) return;
    if (date < bounds.rangeStart || date > bounds.rangeEnd) return;
    setSelectedDate(date);
    setPreferredDay(parseYmd(date).d);
    const month = monthStartOf(date);
    if (month !== viewMonth) requestMonth(month);
  };

  const goMonth = (delta: number) => {
    if (!bounds || !viewMonth || selectedDate === null) return;
    const next = moveMonth(viewMonth, delta, preferredDay ?? parseYmd(selectedDate).d, bounds);
    if (!next) return;
    setSelectedDate(next);
    requestMonth(monthStartOf(next));
  };

  const goWeek = (delta: number) => {
    if (!bounds || selectedDate === null) return;
    const next = moveWeek(selectedDate, delta, bounds);
    if (!next) return;
    setSelectedDate(next);
    setPreferredDay(parseYmd(next).d);
    const month = monthStartOf(next);
    if (month !== viewMonth) requestMonth(month);
  };

  const goToday = () => {
    if (!bounds) return;
    const t = defaultSelectedDate(bounds);
    setSelectedDate(t);
    setPreferredDay(parseYmd(t).d);
    requestMonth(monthStartOf(t));
  };

  const smoothScroll = (el: Element | null) => {
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const dashboard = dashboardQuery.data;
  const canPrevMonth = !!bounds && !!viewMonth && viewMonth > bounds.earliestMonth;
  const canNextMonth = !!bounds && !!viewMonth && viewMonth < bounds.latestMonth;
  const canPrevWeek = !!bounds && selectedDate !== null && canMoveWeek(selectedDate, -1, bounds);
  const canNextWeek = !!bounds && selectedDate !== null && canMoveWeek(selectedDate, 1, bounds);

  const firstLoadError = calendarQuery.isError && !data;
  const refreshFailedWithOldData = calendarQuery.isError && !!data;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="출석 · 일일퀘스트 기록"
      emoji="📅"
      size="record"
      accessibleDialog
      bodyClassName="min-h-0 p-0"
    >
      <div className="px-[14px] min-[701px]:px-[18px] min-[1024px]:px-[22px] py-4 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={cn('text-[11.5px] font-bold', AQ.cream)}>
            {data ? <>조회 {formatFetchedAt(data.fetched_at)}{calendarQuery.isFetching && ' · 갱신 중…'}</> : '기록을 불러오는 중…'}
          </p>
          <button
            type="button"
            onClick={() => { void calendarQuery.refetch(); void dashboardQuery.refetch(); }}
            disabled={calendarQuery.isFetching}
            className={cn('h-9 px-3 rounded-card-md text-xs font-extrabold', AQ.panelSoft, AQ.gold, calendarQuery.isFetching && 'opacity-50')}
          >
            새로고침
          </button>
        </div>

        {refreshFailedWithOldData && (
          <div className="rounded-card-md border border-[#F7AE86]/40 bg-[#3a2418]/60 px-3 py-2 text-[12px] font-bold text-[#F7AE86]">
            이전 조회 기록 · 갱신 실패. 지금 보이는 내용은 최신이 아닐 수 있어요.
          </div>
        )}

        {firstLoadError ? (
          <div className="rounded-card-lg border border-[#F7AE86]/40 bg-[#3a2418]/60 p-4">
            <p className="text-[13px] font-extrabold text-[#F7AE86]">기록을 불러오지 못했어요.</p>
            <p className={cn('text-[12px] font-bold mt-1', AQ.ivory)}>
              {calendarQuery.error instanceof Error ? calendarQuery.error.message : '잠시 후 다시 시도해 주세요.'}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={() => void calendarQuery.refetch()} className={cn('h-10 px-4 rounded-card-md text-xs font-extrabold', AQ.panelSoft, AQ.gold)}>
                다시 시도
              </button>
              {bounds && requestedMonth !== null && (
                <button type="button" onClick={goToday} className={cn('h-10 px-4 rounded-card-md text-xs font-extrabold', AQ.panelSoft, AQ.ivory)}>
                  오늘로 돌아가기
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <AttendanceQuestSummary
              streak={dashboard ? dashboard.streak : null}
              totalAttendance={dashboard ? dashboard.totalAttendance : null}
              week={week}
            />

            <div className="grid gap-[18px] min-[1024px]:grid-cols-[380px_minmax(0,1fr)] min-w-0">
              <div ref={calendarRef} className="min-w-0 scroll-mt-4 space-y-3">
                {viewMonth && selectedDate ? (
                  <QuestCalendarView
                    viewMonth={viewMonth}
                    daysByDate={daysByDate}
                    today={today}
                    selectedDate={selectedDate}
                    canPrevMonth={canPrevMonth}
                    canNextMonth={canNextMonth}
                    onPrevMonth={() => goMonth(-1)}
                    onNextMonth={() => goMonth(1)}
                    onToday={goToday}
                    onSelect={selectDate}
                    onJumpToWeek={() => smoothScroll(weekRef.current)}
                  />
                ) : (
                  <div className={cn('rounded-card-lg h-[360px] animate-pulse', AQ.panel)} aria-hidden="true" />
                )}
                {/* 넓은 화면: 선택일 상세를 달력 아래에 둬서 왼쪽 빈 공간을 채운다 */}
                <AttendanceQuestDayDetail
                  className="hidden min-[1024px]:block"
                  day={selectedDay}
                  today={today}
                  rangeStart={bounds?.rangeStart ?? ''}
                  rangeEnd={bounds?.rangeEnd ?? ''}
                />
              </div>

              <div className="min-w-0 space-y-3">
                {selectedDate && weekStart ? (
                  <AttendanceQuestWeekTable
                    ref={weekRef}
                    weekStart={weekStart}
                    week={week}
                    daysByDate={daysByDate}
                    today={today}
                    selectedDate={selectedDate}
                    canPrevWeek={canPrevWeek}
                    canNextWeek={canNextWeek}
                    onPrevWeek={() => goWeek(-1)}
                    onNextWeek={() => goWeek(1)}
                    onSelect={selectDate}
                    onBackToCalendar={() => smoothScroll(calendarRef.current)}
                  />
                ) : (
                  <div className={cn('rounded-card-lg h-[260px] animate-pulse', AQ.panel)} aria-hidden="true" />
                )}

                {/* 모바일·중간 화면: 표 바로 아래 (달력 → 주간표 → 선택일 → 업적 순서 유지) */}
                <AttendanceQuestDayDetail
                  className="min-[1024px]:hidden"
                  day={selectedDay}
                  today={today}
                  rangeStart={bounds?.rangeStart ?? ''}
                  rangeEnd={bounds?.rangeEnd ?? ''}
                />

                {dataMatchesView && data && <AttendanceQuestAchievementCard achievement={data.achievement} week={week} />}
              </div>
            </div>
          </>
        )}

        <details className={cn('rounded-card-lg px-3.5 py-2 min-w-0', AQ.panel)}>
          <summary className={cn('cursor-pointer select-none min-h-[44px] flex items-center text-[13px] font-extrabold', AQ.ivory)}>
            출석 마일스톤 · 이번 달 출석 보상{dashboard ? `(${dashboard.currentYear}.${String(dashboard.currentMonth).padStart(2, '0')})` : ''}
          </summary>
          <div className="pb-3 pt-1 space-y-4">
            {dashboardQuery.isError ? (
              <Feature4ErrorPanel domain="F4C" error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} />
            ) : !dashboard ? (
              <div className="py-6 flex justify-center"><LoadingSpinner size="lg" /></div>
            ) : (
              <>
                <MilestoneProgress currentStreak={dashboard.streak} achievedMilestones={dashboard.achievedMilestones} />
                <RewardSummary totalGold={dashboard.monthlyRewardGold} totalBv={dashboard.monthlyRewardBv} totalCrystal={dashboard.monthlyRewardCrystal} />
              </>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}

function formatFetchedAt(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(dt);
}

// ---------------------------------------------------------------------
// 아래 StreakBlock·MonthCalendar는 이전 출석 현황 창의 블록이다.
// 기록 창(v1.3)에서는 상단 요약 카드와 새 달력으로 대체되어 화면에 쓰지 않지만, 삭제하지 않고 보존한다.
// ---------------------------------------------------------------------
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

function useAttendanceData(studentId: number | null, isOpen = true) {
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
    enabled: studentId !== null && isOpen,
    staleTime: 30_000,
    refetchOnMount: 'always',
  });
}
