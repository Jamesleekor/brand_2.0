// 출석·일일퀘스트 기록 창 — 선택 주 상세표 (명세 4.1·9장)
// 하나의 6열 table. 첫 열 고정폭, 요일 5열 균등. 모든 행의 같은 요일 중심선이 일치해야 한다.
import { forwardRef } from 'react';
import type { AttendanceQuestDay, AttendanceQuestWeek } from '@/lib/rpc/attendance_quest_rpc';
import { QUEST_CODES } from '@/lib/rpc/attendance_quest_rpc';
import { cn } from '@/lib/utils/cn';
import { AQ, QUEST_LABEL, weekCell, weekTotalCell } from './attendanceQuestModel';
import { addDays, formatMd, formatWeekRange, weekdayKo } from './attendanceQuestDates';
import { NavButton } from './AttendanceQuestCalendar';

interface Props {
  weekStart: string;
  week: AttendanceQuestWeek | null;
  daysByDate: Map<string, AttendanceQuestDay> | null;
  today: string;
  selectedDate: string;
  canPrevWeek: boolean;
  canNextWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSelect: (date: string) => void;
  onBackToCalendar: () => void;
}

export const AttendanceQuestWeekTable = forwardRef<HTMLElement, Props>(function AttendanceQuestWeekTable(
  { weekStart, week, daysByDate, today, selectedDate, canPrevWeek, canNextWeek, onPrevWeek, onNextWeek, onSelect, onBackToCalendar },
  ref,
) {
  const dates = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const weekEnd = dates[4];

  return (
    <section ref={ref} className="min-w-0 scroll-mt-4" aria-label="선택 주 일일퀘스트 상세">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 min-w-0">
          <NavButton label="이전 주" disabled={!canPrevWeek} onClick={onPrevWeek}>‹</NavButton>
          <h3 className={cn('font-display text-[17px] tracking-tight px-1 whitespace-nowrap', AQ.ivory)}>
            {formatWeekRange(weekStart, weekEnd)}
          </h3>
          <NavButton label="다음 주" disabled={!canNextWeek} onClick={onNextWeek}>›</NavButton>
        </div>
        <span className={cn('text-[11.5px] font-extrabold px-2 py-1 rounded-card-sm border border-[#F3CB7A]/50 whitespace-nowrap', AQ.gold)}>
          선택한 주
        </span>
      </div>

      <div className={cn('rounded-card-lg overflow-hidden min-w-0', AQ.panel)}>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[76px] min-[701px]:w-[86px]" />
            {dates.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-[#251d37]">
              <th scope="col" className={cn('text-left pl-[10px] min-[701px]:pl-3 py-2 text-[12.5px] font-extrabold whitespace-nowrap', AQ.ivory)}>
                항목
              </th>
              {dates.map((d) => {
                const selected = d === selectedDate;
                return (
                  <th key={d} scope="col" className={cn('px-0.5 py-1', selected && 'bg-[#3a2f52]')}>
                    <button
                      type="button"
                      onClick={() => onSelect(d)}
                      aria-pressed={selected}
                      aria-label={`${formatMd(d)} ${weekdayKo(d)}요일 선택`}
                      className="w-full min-h-[44px] flex flex-col items-center justify-center leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F3CB7A]"
                    >
                      <span className={cn('text-[13px] font-extrabold whitespace-nowrap', AQ.ivory)}>{weekdayKo(d)}</span>
                      <span className={cn('text-[11.5px] font-bold whitespace-nowrap', d === today ? AQ.gold : AQ.cream)}>{formatMd(d)}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {QUEST_CODES.map((code) => (
              <tr key={code} className="border-t border-[#33294a]">
                <th scope="row" className={cn('text-left pl-[10px] min-[701px]:pl-3 py-2.5 text-[12.5px] font-extrabold whitespace-nowrap', AQ.ivory)}>
                  {QUEST_LABEL[code]}
                </th>
                {dates.map((d) => {
                  const day = daysByDate?.get(d);
                  const cell = day ? weekCell(day, code, today) : null;
                  return (
                    <td
                      key={d}
                      onClick={() => onSelect(d)}
                      className={cn('px-0.5 py-2.5 text-center cursor-pointer', d === selectedDate && 'bg-[#2f2644]')}
                    >
                      {cell ? (
                        <span className={cn('font-extrabold whitespace-nowrap text-[12px]', cell.className)}>
                          <span aria-hidden="true">{cell.text}</span>
                          <span className="sr-only">{cell.srLabel}</span>
                        </span>
                      ) : (
                        <span className="inline-block h-3 w-6 rounded bg-white/10 animate-pulse" aria-hidden="true" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-[#3b3152] bg-[#211a31]">
              <th scope="row" className={cn('text-left pl-[10px] min-[701px]:pl-3 py-2.5 text-[12.5px] font-extrabold whitespace-nowrap', AQ.ivory)}>
                전체 완료
              </th>
              {dates.map((d) => {
                const day = daysByDate?.get(d);
                const cell = day ? weekTotalCell(day, today) : null;
                return (
                  <td
                    key={d}
                    onClick={() => onSelect(d)}
                    className={cn('px-0.5 py-2.5 text-center cursor-pointer', d === selectedDate && 'bg-[#2f2644]')}
                  >
                    {cell ? (
                      <span className={cn('font-extrabold whitespace-nowrap text-[12px]', cell.className)}>
                        <span aria-hidden="true">{cell.text}</span>
                        <span className="sr-only">{cell.srLabel}</span>
                      </span>
                    ) : (
                      <span className="inline-block h-3 w-6 rounded bg-white/10 animate-pulse" aria-hidden="true" />
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {week && <WeekDistribution week={week} />}

      <button
        type="button"
        onClick={onBackToCalendar}
        className={cn('min-[1024px]:hidden mt-2 w-full h-11 rounded-card-md text-xs font-extrabold', AQ.panelSoft, AQ.gold)}
      >
        달력으로 ↑
      </button>
    </section>
  );
});

/** 표 바로 아래 주간 분포: 0이 아닌 항목만, 자연스럽게 줄바꿈 (명세 8장) */
function WeekDistribution({ week }: { week: AttendanceQuestWeek }) {
  const tokens: { text: string; className: string }[] = [];
  if (week.settled_days > 0) {
    tokens.push({ text: `확정 ${week.settled_days}일 (완료 ${week.complete_days} · 미달 ${week.failed_days})`, className: AQ.ivory });
    tokens.push({ text: `퀘스트 ${week.pass_total}/${week.expected_total} 완료`, className: cn(AQ.ivory, 'min-[1024px]:hidden') });
  }
  if (week.unconfirmed_days > 0) tokens.push({ text: `확정 전 ${week.unconfirmed_days}일`, className: AQ.lavender });
  if (week.future_days > 0) tokens.push({ text: `예정 ${week.future_days}일`, className: AQ.cream });
  if (week.closed_days > 0) tokens.push({ text: `휴업 ${week.closed_days}일`, className: AQ.cream });
  if (week.check_needed_days > 0) tokens.push({ text: `확인 필요 ${week.check_needed_days}일`, className: AQ.check });

  return (
    <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="선택 주 날짜 분포">
      {tokens.map((t) => (
        <li key={t.text} className={cn('text-[11.5px] font-extrabold px-2 py-1 rounded-card-sm whitespace-nowrap', AQ.panelSoft, t.className)}>
          {t.text}
        </li>
      ))}
      {week.warning_codes.includes('LEGACY_WEEK') && (
        <li className={cn('text-[11.5px] font-bold px-2 py-1 [word-break:keep-all]', AQ.cream)}>
          2학기 첫 주 기록 · 이전 시스템에서 옮긴 자료
        </li>
      )}
    </ul>
  );
}
