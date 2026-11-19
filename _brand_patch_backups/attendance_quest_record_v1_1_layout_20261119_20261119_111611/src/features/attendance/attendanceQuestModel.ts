// =====================================================================
// 출석·일일퀘스트 기록 창 — 표시 문구·색상 (명세 6~10장)
// 상태 판정은 서버가 한다. 여기서는 서버 상태를 화면 문구로 바꾸기만 한다.
// =====================================================================

import type { AttendanceQuestDay, AttendanceQuestWeek, DayState, QuestCode } from '@/lib/rpc/attendance_quest_rpc';
import { formatMd, parseYmd, weekdayKo } from './attendanceQuestDates';

/** 어두운 배경 기준 색상. 의미 있는 글자에 흐린 회색을 쓰지 않는다(AGENTS 10.1). */
export const AQ = {
  ivory: 'text-[#F6EEDF]',
  cream: 'text-[#E8DCC6]',
  mint: 'text-[#8BE6C2]',
  apricot: 'text-[#F7AE86]',
  lavender: 'text-[#CDBEFF]',
  gold: 'text-[#F3CB7A]',
  check: 'text-[#FFD873]',
  panel: 'bg-[#1c162b]/85 border border-[#3b3152]',
  panelSoft: 'bg-[#221a33] border border-[#3b3152]',
} as const;

export const QUEST_LABEL: Record<QuestCode, string> = {
  ATTENDANCE: '출석',
  PRIMARY_JOB: '1인1역',
  LEARNING_MATERIALS: '준비물',
  CLEANING: '청소',
};

export function isSettled(day: AttendanceQuestDay): boolean {
  return day.day_state === 'CLEAR' || day.day_state === 'PARTIAL';
}

export function isOutOfRange(day: AttendanceQuestDay): boolean {
  return day.reason_codes.includes('OUT_OF_RANGE') || day.reason_codes.includes('NOT_ENROLLED');
}

/** 달력 칸 토큰(4글자 이내) */
export function calendarToken(day: AttendanceQuestDay, today: string): { text: string; className: string } {
  switch (day.day_state) {
    case 'CLEAR':
      return { text: '4/4', className: AQ.mint };
    case 'PARTIAL':
      return { text: `${day.pass_count ?? 0}/4`, className: AQ.apricot };
    case 'PENDING':
      return day.date === today ? { text: '대기', className: AQ.lavender } : { text: '미확정', className: AQ.lavender };
    case 'FUTURE':
      return { text: '예정', className: AQ.cream };
    case 'CHECK_NEEDED':
      return { text: '확인', className: AQ.check };
    case 'CLOSED':
    default:
      return { text: '—', className: AQ.cream };
  }
}

/** 주간표 셀(항목 행) */
export function weekCell(day: AttendanceQuestDay, code: QuestCode, today: string): { text: string; className: string; srLabel: string } {
  if (isSettled(day)) {
    const v = day.checks[code];
    if (v === 'PASS') return { text: '✓', className: `${AQ.mint} text-[17px]`, srLabel: '완료' };
    if (v === 'FAIL') return { text: '✕', className: `${AQ.apricot} text-[17px]`, srLabel: '미달' };
  }
  return stateCell(day, today);
}

/** 주간표 마지막 행(전체 완료) */
export function weekTotalCell(day: AttendanceQuestDay, today: string): { text: string; className: string; srLabel: string } {
  if (day.day_state === 'CLEAR') return { text: '완료', className: AQ.mint, srLabel: '전체 완료' };
  if (day.day_state === 'PARTIAL') return { text: '미달', className: AQ.apricot, srLabel: '일부 미달' };
  return stateCell(day, today);
}

function stateCell(day: AttendanceQuestDay, today: string): { text: string; className: string; srLabel: string } {
  switch (day.day_state as DayState) {
    case 'PENDING':
      return day.date === today
        ? { text: '대기', className: AQ.lavender, srLabel: '정산 대기' }
        : { text: '미확정', className: AQ.lavender, srLabel: '운영국 확정 전' };
    case 'FUTURE':
      return { text: '예정', className: AQ.cream, srLabel: '예정' };
    case 'CHECK_NEEDED':
      return { text: '확인', className: AQ.check, srLabel: '기록 확인 필요' };
    case 'CLOSED':
    default:
      return isOutOfRange(day)
        ? { text: '—', className: AQ.cream, srLabel: '기록 범위 밖' }
        : { text: '휴업', className: AQ.cream, srLabel: day.closure_label ? `휴업일(${day.closure_label})` : '휴업일' };
  }
}

/** 출결 문구 (명세 6장). 결석이 아닌데 결석으로 쓰지 않는다. */
export function attendanceText(day: AttendanceQuestDay): string | null {
  if (day.attendance_source === 'DAILY_QUEST_FALLBACK') {
    return day.attendance_recognized ? '출석 인정 (일일퀘스트 기준)' : '일일퀘스트 출석 미달';
  }
  if (day.attendance_source === 'WEEKEND_APP_ACCESS') return '주말 접속 출석 ✓';
  switch (day.attendance_status) {
    case 'PRESENT':
      return '출석 인정';
    case 'LATE':
      return '지각 · 출석 인정';
    case 'EXCUSED':
      return '인정 결석 · 출석 인정';
    case 'ABSENT':
      return '결석';
    default:
      return null;
  }
}

export function dayTitle(date: string): string {
  return `${formatMd(date)} ${weekdayKo(date)}요일`;
}

/** 날짜 버튼 접근성 이름: 11월 10일 화요일, 출석 인정, 일일퀘스트 4개 중 3개 완료 */
export function dayAriaLabel(day: AttendanceQuestDay, today: string): string {
  const { m, d } = parseYmd(day.date);
  const parts = [`${m}월 ${d}일 ${weekdayKo(day.date)}요일`];
  const att = attendanceText(day);
  if (att) parts.push(att);
  if (isSettled(day)) parts.push(`일일퀘스트 4개 중 ${day.pass_count ?? 0}개 완료`);
  else parts.push(stateCell(day, today).srLabel);
  if (day.date === today) parts.push('오늘');
  return parts.join(', ');
}

export function failureText(day: AttendanceQuestDay): string {
  return day.failure_codes.map((c) => QUEST_LABEL[c]).join('·');
}

export interface WeekStatusView {
  text: string;
  badge: string;
  className: string;
}

/** LIFE-002 카드의 선택 주 기록 설명 (명세 10.2) */
export function weekRecordView(week: AttendanceQuestWeek): WeekStatusView {
  switch (week.record_status) {
    case 'HAS_FAIL':
      return { badge: '미달 기록 있음', text: '선택한 주에는 미달 기록이 있어요.', className: AQ.apricot };
    case 'ALL_FIVE_CLEAR':
      return { badge: '5일 전체 완료 기록', text: '선택한 주 월~금 5일 모두 전체 완료 기록이 있어요.', className: AQ.mint };
    case 'CHECK_NEEDED':
      return { badge: '확인 필요', text: '선택한 주에 확인이 필요한 기록이 있어요. 운영국에 문의해 주세요.', className: AQ.check };
    case 'CLOSED_DAY_IN_WEEK':
      return week.warning_codes.includes('OUT_OF_RANGE_DAYS')
        ? { badge: '목표 5일 기록 미충족', text: '2학기 기록 범위 밖 날짜가 있는 주예요.', className: AQ.cream }
        : { badge: '목표 5일 기록 미충족', text: '휴업일이 있는 주예요.', className: AQ.cream };
    case 'UNCONFIRMED':
      return { badge: '미확정 기록 있음', text: '운영국 확정 전인 날이 있어요. 확정된 뒤 다시 확인해 주세요.', className: AQ.lavender };
    case 'IN_PROGRESS':
      return { badge: '진행 중', text: '아직 남은 날이 있어요. 확정된 뒤 확인해 주세요.', className: AQ.lavender };
    case 'GOAL_NOT_MET':
    default:
      return { badge: '목표 5일 기록 미충족', text: '선택한 주에서 5일 전체 완료를 확인하지 못했어요.', className: AQ.cream };
  }
}
