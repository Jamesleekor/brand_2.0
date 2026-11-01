import type { PrimaryJobArchive, PrimaryJobArchiveEntry } from '@/lib/rpc/primary_job_archive_rpc';

export const ARCHIVE_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
export type ArchiveView = 'month' | 'role' | 'student';

export function archiveStudentKey(entry: PrimaryJobArchiveEntry): string | null {
  if (entry.assignment_status !== 'confirmed' || !entry.student_name) return null;
  return entry.student_id !== null ? `student:${entry.student_id}` : `historical:${entry.student_name}`;
}

export function archiveDefaultMonth(archive: PrimaryJobArchive): number {
  if (ARCHIVE_MONTHS.some((m) => m === archive.current_month)) return archive.current_month;
  return [...archive.months].reverse().find((m) => m.status === 'available' || m.status === 'partial')?.month ?? 3;
}

export function archiveWageLabel(wage: number | null): string {
  return wage === null ? '일급 미등록' : `${wage.toLocaleString('ko-KR')} G`;
}

// Compare the exact same role in the immediately preceding calendar month only.
// A lost month, missing wage, new role or merged role never becomes a zero or an inferred increase.
export function archiveWageDelta(entry: PrimaryJobArchiveEntry, archive: PrimaryJobArchive): string {
  if (entry.daily_wage === null) return '일급 미등록';
  if (entry.month === 3) return '이전 기록 없음';
  const previousMonth = archive.months.find((m) => m.month === entry.month - 1);
  if (!previousMonth || !['available', 'partial'].includes(previousMonth.status)) return '비교 자료 없음';
  const previous = archive.entries.find((e) => e.month === entry.month - 1 && e.job_key === entry.job_key);
  if (!previous || previous.daily_wage === null) return '비교 자료 없음';
  const delta = entry.daily_wage - previous.daily_wage;
  return delta === 0 ? '유지' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toLocaleString('ko-KR')} G`;
}

export function archiveMonthEmptyLabel(archive: PrimaryJobArchive, month: number): string {
  const state = archive.months.find((m) => m.month === month)?.status;
  if (state === 'record_lost') return '기록 분실';
  if (state === 'unregistered' || !state) return '기록 미등록';
  if (state === 'partial') return archivePendingLabel(archive, month);
  return '해당 기록 없음';
}

export function archivePendingLabel(archive: PrimaryJobArchive, month: number): string {
  const entries = archive.entries.filter((entry) => entry.month === month);
  return entries.length > 0 && entries.every((entry) => entry.assignment_status === 'pending')
    ? '담당자 배정 대기' : '담당자 확인 중';
}

export const ROLE_BACKGROUND: Record<string, { description: string; related: string[] }> = {
  '시간표관리자': {
    description: '시간표를 관리하던 역할입니다. 11월에는 일정 알리미와 통합되었습니다.',
    related: ['시간표관리&일정알리미'],
  },
  '일정알리미': {
    description: '학급 일정을 안내하던 역할입니다. 11월에는 시간표 관리와 통합되었습니다.',
    related: ['시간표관리&일정알리미'],
  },
  '시간표관리&일정알리미': {
    description: '11월부터 시간표 관리와 일정 알리미를 통합한 역할입니다. 이전 두 역할의 기록도 각각 확인할 수 있습니다.',
    related: ['시간표관리자', '일정알리미'],
  },
  '사서': {
    description: '학급문고를 관리했던 역할입니다. 이후 기록 업무와 통합되었습니다.',
    related: ['사서및기록관'],
  },
  '사서및기록관': {
    description: '당시에는 학급문고를 관리하던 역할입니다. 이용률이 높지 않아 이후 학급일지 기록관과 통합되었습니다.',
    related: ['사서', '분쟁조정인&학급일지기록관'],
  },
  '분쟁조정인': {
    description: '독립된 1인1역으로 운영되다가 학급일지 기록관과 통합되었습니다.',
    related: ['분쟁조정인&학급일지기록관'],
  },
  '분쟁조정인&학급일지기록관': {
    description: '분쟁조정인과 학급일지 기록관이 통합된 역할입니다. 통합 전 역할은 각각의 당시 기록을 보존합니다.',
    related: ['분쟁조정인', '사서및기록관'],
  },
  '환경(사물함&신발장)': {
    description: '5월에 사물함과 신발장을 함께 관리했던 일시적인 역할입니다. 당시 일급은 120 G입니다.',
    related: ['환경(사물함)', '환경(신발장)'],
  },
  '환경(사물함)': {
    description: '초기에 운영되다가 사라진 역할입니다. 현재 역할 목록과 별도로 과거 기록을 보존합니다.',
    related: ['환경(사물함&신발장)'],
  },
};
