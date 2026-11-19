// 출석·일일퀘스트 기록 창 — 선택일 상세 (명세 9장)
import type { AttendanceQuestDay } from '@/lib/rpc/attendance_quest_rpc';
import { QUEST_CODES } from '@/lib/rpc/attendance_quest_rpc';
import { cn } from '@/lib/utils/cn';
import { AQ, QUEST_LABEL, attendanceText, dayTitle, failureText, isNotParticipant, isOutOfRange } from './attendanceQuestModel';
import { parseYmd } from './attendanceQuestDates';

interface Props {
  day: AttendanceQuestDay | null;
  today: string;
  rangeStart: string;
  rangeEnd: string;
  className?: string;
}

export function AttendanceQuestDayDetail({ day, today, rangeStart, rangeEnd, className }: Props) {
  if (!day) {
    return <div className={cn('rounded-card-lg h-[52px] animate-pulse', AQ.panel, className)} aria-hidden="true" />;
  }

  const att = attendanceText(day);
  const view = describe(day, today, rangeStart, rangeEnd);

  return (
    <section
      className={cn('rounded-card-lg px-3.5 py-3 min-w-0', view.tone, className)}
      aria-live="polite"
      aria-label="선택한 날짜의 기록"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className={cn('text-[13.5px] font-extrabold whitespace-nowrap', view.titleClass)}>
          {dayTitle(day.date)}
          {view.titleSuffix && <span> · {view.titleSuffix}</span>}
        </h4>
        {view.right && <span className={cn('text-[12.5px] font-extrabold [word-break:keep-all]', view.rightClass)}>{view.right}</span>}
      </div>
      {att && <p className={cn('text-[12.5px] font-bold mt-1', AQ.cream)}>{att}</p>}
      {view.message && <p className={cn('text-[12.5px] font-bold mt-1 [word-break:keep-all] [overflow-wrap:anywhere]', AQ.ivory)}>{view.message}</p>}
      {day.day_state === 'CHECK_NEEDED' && hasKnownChecks(day) && (
        <p className={cn('text-[12px] font-bold mt-1', AQ.cream)}>
          확인된 기록:{' '}
          {QUEST_CODES.filter((c) => day.checks[c] === 'PASS' || day.checks[c] === 'FAIL')
            .map((c) => `${QUEST_LABEL[c]} ${day.checks[c] === 'PASS' ? '완료' : '미달'}`)
            .join(' · ')}
        </p>
      )}
      {day.source === 'LEGACY_TEACHER_RECORD' && (
        <p className={cn('text-[11.5px] font-bold mt-1.5', AQ.cream)}>2학기 첫 주 기록 · 이전 시스템에서 옮긴 자료</p>
      )}
    </section>
  );
}

function hasKnownChecks(day: AttendanceQuestDay): boolean {
  return QUEST_CODES.some((c) => day.checks[c] === 'PASS' || day.checks[c] === 'FAIL');
}

interface DetailView {
  tone: string;
  titleClass: string;
  titleSuffix?: string;
  right?: string;
  rightClass?: string;
  message?: string;
}

function koMonthDay(value: string): string {
  const { m, d } = parseYmd(value);
  return `${m}월 ${d}일`;
}

function describe(day: AttendanceQuestDay, today: string, rangeStart: string, rangeEnd: string): DetailView {
  switch (day.day_state) {
    case 'CLEAR':
      return {
        tone: 'bg-[#16302a]/70 border border-[#8BE6C2]/35',
        titleClass: AQ.mint,
        titleSuffix: '전체 완료',
        message: '일일퀘스트 4개를 모두 완료했어요.',
      };
    case 'PARTIAL':
      return {
        tone: 'bg-[#3a2418]/70 border border-[#F7AE86]/40',
        titleClass: AQ.apricot,
        titleSuffix: '미달 항목',
        right: `${failureText(day)} 미완료`,
        rightClass: AQ.apricot,
      };
    case 'PENDING':
      return {
        tone: cn('border border-[#CDBEFF]/35', 'bg-[#251f3d]/80'),
        titleClass: AQ.lavender,
        titleSuffix: day.date === today ? '정산 대기' : '확정 전',
        message: '운영국 확정 전이에요. 이 화면의 확정 집계에는 아직 포함되지 않아요.',
      };
    case 'FUTURE':
      return {
        tone: AQ.panel,
        titleClass: AQ.ivory,
        titleSuffix: '예정',
        message: '아직 오지 않은 날이에요.',
      };
    case 'CHECK_NEEDED':
      return {
        tone: 'bg-[#33290f]/70 border border-[#FFD873]/40',
        titleClass: AQ.check,
        titleSuffix: '확인 필요',
        message: '기록 확인이 필요해요. 운영국에 문의해 주세요.',
      };
    case 'CLOSED':
    default:
      if (isOutOfRange(day)) {
        return {
          tone: AQ.panel,
          titleClass: AQ.ivory,
          message: day.date < rangeStart
            ? `2학기(${koMonthDay(rangeStart)}) 이전 기록은 이 창에서 볼 수 없어요.`
            : day.date > rangeEnd
              ? `2학기 기록은 ${koMonthDay(rangeEnd)}까지예요.`
              : '재학 기간 밖의 날짜예요.',
        };
      }
      if (isNotParticipant(day)) {
        return { tone: AQ.panel, titleClass: AQ.ivory, titleSuffix: '대상 아님', message: '이 날짜는 일일퀘스트 대상이 아니었어요.' };
      }
      if (day.closure_kind === 'WEEKEND') {
        return { tone: AQ.panel, titleClass: AQ.ivory, titleSuffix: '주말', message: '주말이에요.' };
      }
      return {
        tone: AQ.panel,
        titleClass: AQ.ivory,
        titleSuffix: '휴업일',
        message: day.closure_label ? `휴업일이에요(${day.closure_label}).` : '휴업일이에요.',
      };
  }
}
