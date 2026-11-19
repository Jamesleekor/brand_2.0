// 출석·일일퀘스트 기록 창 — 상단 요약 카드 (명세 8장)
import type { ReactNode } from 'react';
import type { AttendanceQuestWeek } from '@/lib/rpc/attendance_quest_rpc';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { AQ } from './attendanceQuestModel';

interface Props {
  streak: number | null;
  totalAttendance: number | null;
  week: AttendanceQuestWeek | null;
}

export function AttendanceQuestSummary({ streak, totalAttendance, week }: Props) {
  const settled = week?.settled_days ?? 0;
  const failedItems = week ? week.expected_total - week.pass_total : 0;

  return (
    <div className="grid grid-cols-2 min-[1024px]:grid-cols-3 gap-3 min-w-0">
      <Card label="🔥 현재 연속 출석">
        {streak === null ? (
          <Skeleton />
        ) : (
          <>
            <BigValue value={`${streak}`} unit="일째" />
            <Sub>누적 출석 인정 {formatNumber(totalAttendance ?? 0)}일</Sub>
          </>
        )}
      </Card>

      <Card label="🏅 선택 주 전체 완료">
        {!week ? (
          <Skeleton />
        ) : settled === 0 ? (
          <>
            <div className={cn('font-display text-[18px] leading-tight mt-1', AQ.ivory)}>확정 기록 없음</div>
            <Sub>{weekDistributionShort(week)}</Sub>
          </>
        ) : (
          <>
            <BigValue value={`${week.complete_days}`} unit={`일 / 확정 ${settled}일 중`} />
            <Sub>{weekDistributionShort(week)}</Sub>
          </>
        )}
      </Card>

      <Card label="📋 선택 주 퀘스트" className="hidden min-[1024px]:block">
        {!week ? (
          <Skeleton />
        ) : settled === 0 ? (
          <>
            <div className={cn('font-display text-[18px] leading-tight mt-1', AQ.ivory)}>확정 기록 없음</div>
            <Sub>확정된 날짜만 셉니다</Sub>
          </>
        ) : (
          <>
            <BigValue value={`${week.pass_total}`} unit={`/ ${week.expected_total} 완료`} />
            <Sub>확정 기록 기준 · 실패 {failedItems}개</Sub>
          </>
        )}
      </Card>
    </div>
  );
}

/** 미달 1일 · 확인 대기 1일 처럼 0이 아닌 항목만 */
export function weekDistributionShort(week: AttendanceQuestWeek): string {
  const parts: string[] = [];
  if (week.failed_days > 0) parts.push(`미달 ${week.failed_days}일`);
  if (week.unconfirmed_days > 0) parts.push(`확인 대기 ${week.unconfirmed_days}일`);
  if (week.future_days > 0) parts.push(`예정 ${week.future_days}일`);
  if (week.closed_days > 0) parts.push(`휴업 ${week.closed_days}일`);
  if (week.check_needed_days > 0) parts.push(`확인 필요 ${week.check_needed_days}일`);
  return parts.length > 0 ? parts.join(' · ') : '모두 확정';
}

function Card({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-card-lg px-3.5 py-3 min-w-0', AQ.panel, className)}>
      <div className={cn('text-xs font-extrabold', AQ.cream)}>{label}</div>
      {children}
    </div>
  );
}

function BigValue({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-1 mt-1 min-w-0">
      <span className={cn('font-display text-[28px] leading-none tracking-tight', AQ.ivory)}>{value}</span>
      <span className={cn('text-xs font-extrabold whitespace-nowrap', AQ.cream)}>{unit}</span>
    </div>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <div className={cn('text-[11.5px] font-bold mt-1.5 [word-break:keep-all]', AQ.cream)}>{children}</div>;
}

function Skeleton() {
  return (
    <div className="mt-1.5 space-y-2" aria-hidden="true">
      <div className="h-7 w-20 rounded bg-white/10 animate-pulse" />
      <div className="h-3 w-28 rounded bg-white/10 animate-pulse" />
    </div>
  );
}
