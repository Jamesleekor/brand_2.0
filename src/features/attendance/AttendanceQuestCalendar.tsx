// 출석·일일퀘스트 기록 창 — 월간 달력 (명세 4·5·7장)
import type { ReactNode } from 'react';
import type { AttendanceQuestDay } from '@/lib/rpc/attendance_quest_rpc';
import { cn } from '@/lib/utils/cn';
import { AQ, calendarToken, dayAriaLabel, isOutOfRange } from './attendanceQuestModel';
import { addDays, daysInMonth, formatMonthTitle, mondayOf, parseYmd, toYmd, weekdayIndex } from './attendanceQuestDates';

interface Props {
  viewMonth: string;
  daysByDate: Map<string, AttendanceQuestDay> | null;
  today: string;
  selectedDate: string;
  canPrevMonth: boolean;
  canNextMonth: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onSelect: (date: string) => void;
  onJumpToWeek: () => void;
}

const WEEK_HEAD = ['일', '월', '화', '수', '목', '금', '토'];

export function AttendanceQuestCalendar({
  viewMonth,
  daysByDate,
  today,
  selectedDate,
  canPrevMonth,
  canNextMonth,
  onPrevMonth,
  onNextMonth,
  onToday,
  onSelect,
  onJumpToWeek,
}: Props) {
  const { y, m } = parseYmd(viewMonth);
  const lead = weekdayIndex(viewMonth);
  const total = daysInMonth(y, m);
  const selectedWeekStart = mondayOf(selectedDate);
  const selectedWeekEnd = addDays(selectedWeekStart, 4);

  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => toYmd(y, m, i + 1)),
  ];

  return (
    <section className="min-w-0" aria-label="월간 출석·일일퀘스트 달력">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className={cn('font-display text-[19px] tracking-tight whitespace-nowrap', AQ.ivory)}>{formatMonthTitle(viewMonth)}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToday}
            className={cn('h-11 px-3 rounded-card-md text-xs font-extrabold whitespace-nowrap', AQ.panelSoft, AQ.gold)}
          >
            오늘
          </button>
          <NavButton label="이전 달" disabled={!canPrevMonth} onClick={onPrevMonth}>‹</NavButton>
          <NavButton label="다음 달" disabled={!canNextMonth} onClick={onNextMonth}>›</NavButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden="true">
        {WEEK_HEAD.map((d, i) => (
          <div
            key={d}
            className={cn(
              'text-center text-xs font-extrabold py-1',
              i === 0 ? 'text-[#FF9AA2]' : i === 6 ? 'text-[#9CC3FF]' : AQ.cream,
            )}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="min-h-[48px]" aria-hidden="true" />;
          const day = daysByDate?.get(date) ?? null;
          const dayNum = Number(date.slice(8, 10));
          const isSelected = date === selectedDate;
          const inSelectedWeek = date >= selectedWeekStart && date <= selectedWeekEnd;
          const isToday = date === today;

          if (!day) {
            return (
              <div key={date} className="min-h-[48px] rounded-card-sm bg-white/5 animate-pulse" aria-hidden="true" />
            );
          }

          const outOfRange = isOutOfRange(day);
          const token = calendarToken(day, today);
          const showAttendance = day.attendance_recognized === true;

          if (outOfRange) {
            return (
              <div
                key={date}
                className={cn('min-h-[48px] rounded-card-sm flex flex-col items-center justify-center opacity-45', AQ.cream)}
                aria-label={`${m}월 ${dayNum}일, 2학기 기록 범위 밖`}
              >
                <span className="text-[13px] font-extrabold leading-none">{dayNum}</span>
                <span className="text-[11px] font-bold leading-none mt-1">—</span>
              </div>
            );
          }

          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-label={dayAriaLabel(day, today)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'relative min-h-[48px] w-full rounded-card-sm flex flex-col items-center justify-center gap-1 px-0.5 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F3CB7A] focus-visible:outline-offset-1',
                inSelectedWeek ? 'bg-[#2c2340]' : 'bg-[#1a1427]',
                isSelected ? 'ring-2 ring-[#F3CB7A]' : 'ring-1 ring-[#33294a]',
              )}
            >
              {isToday && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#F3CB7A]" aria-hidden="true" />}
              <span className={cn('text-[13px] font-extrabold leading-none whitespace-nowrap', AQ.ivory)}>
                {dayNum}
                {showAttendance && <span className={cn('ml-0.5 text-[12px]', AQ.mint)} aria-hidden="true">✓</span>}
              </span>
              <span className={cn('text-[11.5px] font-extrabold leading-none whitespace-nowrap', token.className)} aria-hidden="true">
                {token.text}
              </span>
            </button>
          );
        })}
      </div>

      <ul className={cn('flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11.5px] font-bold', AQ.cream)} aria-label="달력 표시 설명">
        <li className="whitespace-nowrap"><span className={AQ.mint}>✓</span> 출석 인정</li>
        <li className="whitespace-nowrap"><span className={AQ.mint}>4/4</span> 전체 완료</li>
        <li className="whitespace-nowrap"><span className={AQ.apricot}>3/4</span> 일부 미달</li>
        <li className="whitespace-nowrap"><span className={AQ.lavender}>대기·미확정</span> 정산 전</li>
        <li className="whitespace-nowrap">예정</li>
        <li className="whitespace-nowrap">— 휴업·대상 아님</li>
        <li className="whitespace-nowrap"><span className={AQ.check}>확인</span> 기록 확인 필요</li>
      </ul>
      <p className={cn('text-[11.5px] font-bold mt-1.5 [word-break:keep-all]', AQ.cream)}>
        날짜를 누르면 그 주의 기록과 미달 항목을 볼 수 있어요.
      </p>

      <button
        type="button"
        onClick={onJumpToWeek}
        className={cn('min-[1024px]:hidden mt-3 w-full h-11 rounded-card-md text-xs font-extrabold', AQ.panelSoft, AQ.gold)}
      >
        선택 주 상세 보기 ↓
      </button>
    </section>
  );
}

export function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-11 h-11 rounded-card-md flex items-center justify-center text-lg font-black',
        AQ.panelSoft,
        disabled ? 'opacity-35 cursor-not-allowed' : cn(AQ.ivory, 'hover:bg-[#2c2340]'),
      )}
    >
      {children}
    </button>
  );
}
