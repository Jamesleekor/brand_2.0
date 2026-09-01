import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TeacherShell, StatCard } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal } from '@/components/shared/components';
import { achievementA5Rpc, type AchievementA5Grade, type AchievementA5StudentStatistics } from '@/lib/rpc/achievement_a5_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatNumber, getKstDateString } from '@/lib/utils/format';

const GRADES: AchievementA5Grade[] = ['희귀', '유니크', '에픽', '히든', '유일', '초월'];

const GRADE_CHIP: Record<AchievementA5Grade, string> = {
  희귀: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  유니크: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  에픽: 'border-bv/30 bg-bv/10 text-bv-100',
  히든: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  유일: 'border-danger/30 bg-danger/10 text-red-200',
  초월: 'border-warning/30 bg-warning/10 text-warning',
};

type SortKey = 'period_score' | 'period_count' | 'total_score' | 'total_count' | 'display_name';
type SortDirection = 'asc' | 'desc';
type BreakdownMode = 'period' | 'total';

type DateRange = {
  startDate: string;
  endDate: string;
};

function currentMonthRange(): DateRange {
  const today = getKstDateString();
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}

function previousMonthRange(): DateRange {
  const today = getKstDateString();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
  const mm = String(previousMonth).padStart(2, '0');
  return {
    startDate: `${previousYear}-${mm}-01`,
    endDate: `${previousYear}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function recent30DaysRange(): DateRange {
  const today = getKstDateString();
  const anchor = new Date(`${today}T12:00:00+09:00`);
  const start = new Date(anchor.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { startDate: getKstDateString(start), endDate: today };
}

function createRpcError(message: string, code?: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function formatRangeLabel(startDate: string, endDate: string) {
  return `${startDate.split('-').join('.')} ~ ${endDate.split('-').join('.')}`;
}

function sortValue(row: AchievementA5StudentStatistics, key: SortKey): number | string {
  return key === 'display_name' ? row.display_name : row[key];
}

export default function AchievementStatisticsAdmin() {
  const classroomId = useClassroomId();
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [sortKey, setSortKey] = useState<SortKey>('period_score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('period');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const statisticsQuery = useQuery({
    queryKey: ['achievement-a5-statistics', classroomId, range.startDate, range.endDate],
    enabled: classroomId !== null,
    queryFn: async () => {
      const result = await achievementA5Rpc.teacherStatistics(supabase, {
        p_classroom_id: classroomId!,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
      });
      if (result.success === false) {
        throw createRpcError(result.error, result.type === 'SERVER' ? result.code : undefined);
      }
      return result.data;
    },
  });

  const sortedStudents = useMemo(() => {
    const rows = [...(statisticsQuery.data?.students ?? [])];
    rows.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      let compare = 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        compare = av.localeCompare(bv, 'ko-KR');
      } else {
        compare = Number(av) - Number(bv);
      }
      if (compare === 0) compare = a.display_name.localeCompare(b.display_name, 'ko-KR');
      if (compare === 0) compare = a.student_id - b.student_id;
      return sortDirection === 'asc' ? compare : -compare;
    });
    return rows;
  }, [statisticsQuery.data?.students, sortDirection, sortKey]);

  const applyRange = (next: DateRange = draftRange) => {
    if (!next.startDate || !next.endDate) {
      setRangeError('시작일과 종료일을 모두 입력해주세요.');
      return;
    }
    if (next.startDate > next.endDate) {
      setRangeError('시작일은 종료일보다 늦을 수 없습니다.');
      return;
    }
    setRangeError(null);
    setDraftRange(next);
    setRange(next);
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'display_name' ? 'asc' : 'desc');
  };

  const stats = statisticsQuery.data;
  const periodAverage = stats && stats.period_summary.students_with_achievement > 0
    ? stats.period_summary.achievement_score / stats.period_summary.students_with_achievement
    : 0;

  return (
    <TeacherShell>
      <div className="space-y-5 pb-24 md:pb-0">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl text-brand-gradient">📈 업적 통계·운영</h1>
            <span className="rounded-pill border border-bv/30 bg-bv/10 px-2 py-0.5 text-2xs font-black text-bv">A5</span>
          </div>
          <p className="mt-1 text-sm font-bold text-text-secondary">
            기간별 획득·점수·등급 분포와 누적 현황을 교사용으로 확인합니다.
          </p>
        </header>

        <section className="glass-card p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-2xs font-black text-text-muted">시작일</span>
                <input
                  type="date"
                  value={draftRange.startDate}
                  onChange={(event) => setDraftRange((current) => ({ ...current, startDate: event.target.value }))}
                  className="input-field w-full"
                />
              </label>
              <span className="hidden pb-2 text-text-muted sm:block">~</span>
              <label className="block">
                <span className="mb-1 block text-2xs font-black text-text-muted">종료일</span>
                <input
                  type="date"
                  value={draftRange.endDate}
                  onChange={(event) => setDraftRange((current) => ({ ...current, endDate: event.target.value }))}
                  className="input-field w-full"
                />
              </label>
              <button type="button" className="btn-primary h-[42px]" onClick={() => applyRange()}>
                조회
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <PresetButton label="이번 달" onClick={() => applyRange(currentMonthRange())} />
              <PresetButton label="지난 달" onClick={() => applyRange(previousMonthRange())} />
              <PresetButton label="최근 30일" onClick={() => applyRange(recent30DaysRange())} />
              <button type="button" className="btn-secondary" onClick={() => void statisticsQuery.refetch()}>
                ↻ 새로고침
              </button>
            </div>
          </div>
          {rangeError && <p className="mt-2 text-xs font-bold text-danger">⚠ {rangeError}</p>}
          <p className="mt-3 text-2xs font-bold text-text-muted">
            기간 기준: Asia/Seoul · 회수된 업적은 현재 통계에서 제외됩니다.
          </p>
        </section>

        {statisticsQuery.isError && (
          <section className="rounded-card-lg border border-danger/40 bg-danger-bg p-4">
            <div className="font-extrabold text-danger">통계를 불러오지 못했습니다.</div>
            <div className="mt-1 break-all text-xs text-text-secondary">
              {statisticsQuery.error instanceof Error ? statisticsQuery.error.message : '알 수 없는 오류'}
            </div>
            <button type="button" className="btn-secondary mt-3" onClick={() => void statisticsQuery.refetch()}>
              다시 시도
            </button>
          </section>
        )}

        {statisticsQuery.isLoading && !stats ? (
          <div className="flex min-h-56 items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : stats ? (
          <>
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-black text-gold">선택 기간</div>
                  <div className="text-sm font-extrabold text-text-primary">{formatRangeLabel(stats.period.start_date, stats.period.end_date)}</div>
                </div>
                <div className="text-2xs font-bold text-text-muted">활성 학생 {formatNumber(stats.active_student_count)}명</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard emoji="🏅" label="기간 획득" value={`${formatNumber(stats.period_summary.achievement_count)}개`} color="gold" />
                <StatCard emoji="⭐" label="기간 업적 점수" value={formatNumber(stats.period_summary.achievement_score)} color="bv" />
                <StatCard emoji="🧑‍🤝‍🧑" label="획득 학생" value={`${formatNumber(stats.period_summary.students_with_achievement)}명`} color="success" />
                <StatCard emoji="📐" label="획득 학생 평균 점수" value={periodAverage.toFixed(1)} color="crystal" />
              </div>
            </section>

            <section className="grid gap-3 xl:grid-cols-[1fr_320px]">
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-display text-base text-white">등급별 기간 획득</h2>
                  <span className="text-2xs font-bold text-text-muted">총 {formatNumber(stats.period_summary.achievement_count)}개</span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {GRADES.map((grade) => (
                    <GradeCount key={grade} grade={grade} count={stats.period_summary.grade_breakdown[grade] ?? 0} />
                  ))}
                </div>
              </div>
              <div className="glass-card p-4">
                <h2 className="font-display text-base text-white">전체 누적</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniMetric label="획득" value={`${formatNumber(stats.total_summary.achievement_count)}개`} />
                  <MiniMetric label="점수" value={formatNumber(stats.total_summary.achievement_score)} />
                  <MiniMetric label="획득 학생" value={`${formatNumber(stats.total_summary.students_with_achievement)}명`} />
                  <MiniMetric label="미획득 학생" value={`${formatNumber(Math.max(0, stats.active_student_count - stats.total_summary.students_with_achievement))}명`} />
                </div>
              </div>
            </section>

            <section className="glass-card overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="font-display text-lg text-white">학생별 업적 통계</h2>
                  <p className="mt-1 text-xs font-bold text-text-muted">학생명을 누르면 선택 기간의 획득 및 감사 이력을 확인할 수 있습니다.</p>
                </div>
                <div className="flex items-center gap-1 rounded-card-md border border-line bg-bg-deep p-1">
                  <button
                    type="button"
                    onClick={() => setBreakdownMode('period')}
                    className={cn('rounded-card-sm px-3 py-1.5 text-xs font-black transition-all', breakdownMode === 'period' ? 'bg-bv/20 text-bv' : 'text-text-muted hover:text-text-primary')}
                  >
                    등급: 기간
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreakdownMode('total')}
                    className={cn('rounded-card-sm px-3 py-1.5 text-xs font-black transition-all', breakdownMode === 'total' ? 'bg-bv/20 text-bv' : 'text-text-muted hover:text-text-primary')}
                  >
                    등급: 누적
                  </button>
                </div>
              </div>

              {sortedStudents.length === 0 ? (
                <EmptyState emoji="📊" title="표시할 학생이 없습니다" description="학급 학생 및 업적 데이터를 확인해주세요." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1180px] w-full border-collapse text-left">
                    <thead className="bg-bg-deep/80 text-2xs font-black text-text-muted">
                      <tr>
                        <th className="px-3 py-3 text-center">점수 순위</th>
                        <th className="px-3 py-3"><SortHeader label="학생" sortKey="display_name" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} /></th>
                        <th className="px-3 py-3 text-right"><SortHeader label="기간 획득" sortKey="period_count" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} /></th>
                        <th className="px-3 py-3 text-right"><SortHeader label="기간 점수" sortKey="period_score" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} /></th>
                        <th className="px-3 py-3 text-right"><SortHeader label="누적 획득" sortKey="total_count" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} /></th>
                        <th className="px-3 py-3 text-right"><SortHeader label="누적 점수" sortKey="total_score" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} /></th>
                        {GRADES.map((grade) => <th key={grade} className="px-2 py-3 text-center">{grade}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {sortedStudents.map((row) => {
                        const breakdown = breakdownMode === 'period' ? row.period_grade_breakdown : row.total_grade_breakdown;
                        return (
                          <tr key={row.student_id} className="transition-colors hover:bg-bg-soft/50">
                            <td className="px-3 py-3 text-center">
                              <span className={cn('inline-flex min-w-8 justify-center rounded-pill px-2 py-1 text-xs font-black', row.period_score_rank <= 3 && row.period_score > 0 ? 'border border-gold/30 bg-gold/10 text-gold' : 'text-text-secondary')}>
                                {row.period_score > 0 ? row.period_score_rank : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <button type="button" className="group text-left" onClick={() => setSelectedStudentId(row.student_id)}>
                                <div className="text-sm font-black text-text-primary group-hover:text-gold">{row.display_name}</div>
                                <div className="mt-0.5 text-2xs font-bold text-text-muted">
                                  {row.brand_name && row.brand_name !== row.student_name ? `${row.student_name} · ` : ''}ID {row.student_id}
                                </div>
                              </button>
                            </td>
                            <td className="px-3 py-3 text-right text-sm font-extrabold text-text-primary">{formatNumber(row.period_count)}</td>
                            <td className="px-3 py-3 text-right text-sm font-black text-gold">{formatNumber(row.period_score)}</td>
                            <td className="px-3 py-3 text-right text-sm font-extrabold text-text-secondary">{formatNumber(row.total_count)}</td>
                            <td className="px-3 py-3 text-right text-sm font-black text-bv">{formatNumber(row.total_score)}</td>
                            {GRADES.map((grade) => (
                              <td key={grade} className="px-2 py-3 text-center text-xs font-black text-text-secondary">{formatNumber(breakdown[grade] ?? 0)}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>

      {selectedStudentId !== null && classroomId !== null && (
        <StudentHistoryModal
          classroomId={classroomId}
          studentId={selectedStudentId}
          range={range}
          onClose={() => setSelectedStudentId(null)}
        />
      )}
    </TeacherShell>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="btn-secondary">{label}</button>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep p-3">
      <div className="text-2xs font-black text-text-muted">{label}</div>
      <div className="mt-1 font-display text-lg text-text-primary">{value}</div>
    </div>
  );
}

function GradeCount({ grade, count }: { grade: AchievementA5Grade; count: number }) {
  return (
    <div className={cn('rounded-card-md border px-2 py-3 text-center', GRADE_CHIP[grade])}>
      <div className="text-2xs font-black">{grade}</div>
      <div className="mt-1 font-display text-xl">{formatNumber(count)}</div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-text-primary', active && 'text-gold')}
    >
      <span>{label}</span>
      <span>{active ? (direction === 'desc' ? '▼' : '▲') : '↕'}</span>
    </button>
  );
}

function StudentHistoryModal({
  classroomId,
  studentId,
  range,
  onClose,
}: {
  classroomId: number;
  studentId: number;
  range: DateRange;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'grants' | 'audit'>('grants');
  const query = useQuery({
    queryKey: ['achievement-a5-student-history', classroomId, studentId, range.startDate, range.endDate],
    queryFn: async () => {
      const result = await achievementA5Rpc.teacherStudentHistory(supabase, {
        p_classroom_id: classroomId,
        p_student_id: studentId,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
        p_limit: 200,
      });
      if (result.success === false) {
        throw createRpcError(result.error, result.type === 'SERVER' ? result.code : undefined);
      }
      return result.data;
    },
  });

  const data = query.data;
  return (
    <Modal isOpen onClose={onClose} title={data ? `${data.student.display_name} · 업적 이력` : '학생 업적 이력'} emoji="🗂️" size="full">
      {query.isLoading && !data ? (
        <div className="flex min-h-52 items-center justify-center"><LoadingSpinner size="lg" /></div>
      ) : query.isError ? (
        <div className="rounded-card-lg border border-danger/40 bg-danger-bg p-4">
          <div className="font-extrabold text-danger">학생 이력을 불러오지 못했습니다.</div>
          <div className="mt-1 break-all text-xs text-text-secondary">{query.error instanceof Error ? query.error.message : '알 수 없는 오류'}</div>
          <button type="button" className="btn-secondary mt-3" onClick={() => void query.refetch()}>다시 시도</button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label="학생" value={data.student.display_name} />
            <MiniMetric label="조회 기간" value={`${data.period.start_date.slice(5)} ~ ${data.period.end_date.slice(5)}`} />
            <MiniMetric label="기간 활성 업적" value={`${formatNumber(data.period_active_summary.achievement_count)}개`} />
            <MiniMetric label="기간 활성 점수" value={formatNumber(data.period_active_summary.achievement_score)} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-card-md border border-line bg-bg-deep p-1">
              <button type="button" onClick={() => setTab('grants')} className={cn('rounded-card-sm px-3 py-1.5 text-xs font-black', tab === 'grants' ? 'bg-brand-primary/20 text-gold' : 'text-text-muted')}>
                획득 기록 {data.grants.length}
              </button>
              <button type="button" onClick={() => setTab('audit')} className={cn('rounded-card-sm px-3 py-1.5 text-xs font-black', tab === 'audit' ? 'bg-brand-primary/20 text-gold' : 'text-text-muted')}>
                감사 이벤트 {data.audit_events.length}
              </button>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void query.refetch()}>↻ 새로고침</button>
          </div>

          {tab === 'grants' ? (
            data.grants.length === 0 ? (
              <EmptyState emoji="🏅" title="이 기간의 획득 기록이 없습니다" />
            ) : (
              <div className="overflow-x-auto rounded-card-lg border border-line">
                <table className="min-w-[900px] w-full text-left">
                  <thead className="bg-bg-deep text-2xs font-black text-text-muted">
                    <tr>
                      <th className="px-3 py-3">획득일</th>
                      <th className="px-3 py-3">업적</th>
                      <th className="px-3 py-3">등급</th>
                      <th className="px-3 py-3 text-right">점수</th>
                      <th className="px-3 py-3">상태</th>
                      <th className="px-3 py-3">회수 사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.grants.map((grant) => (
                      <tr key={grant.student_achievement_id} className={cn(grant.is_revoked && 'opacity-65')}>
                        <td className="px-3 py-3 text-xs font-bold text-text-secondary">{formatDateTime(grant.achieved_at)}</td>
                        <td className="px-3 py-3">
                          <div className="text-sm font-black text-text-primary">{grant.achievement_name}</div>
                          <div className="text-2xs font-bold text-text-muted">{grant.achievement_uid}</div>
                        </td>
                        <td className="px-3 py-3"><GradeBadge grade={grant.grade} /></td>
                        <td className="px-3 py-3 text-right text-sm font-black text-gold">{formatNumber(grant.achievement_score)}</td>
                        <td className="px-3 py-3">
                          {grant.is_revoked ? (
                            <span className="rounded-pill border border-danger/30 bg-danger/10 px-2 py-1 text-2xs font-black text-danger">회수됨</span>
                          ) : (
                            <span className="rounded-pill border border-success/30 bg-success/10 px-2 py-1 text-2xs font-black text-success">활성</span>
                          )}
                        </td>
                        <td className="max-w-xs px-3 py-3 text-xs font-bold text-text-secondary">
                          {grant.is_revoked ? (
                            <div>
                              <div>{grant.revoke_reason || '사유 없음'}</div>
                              {grant.revoked_at && <div className="mt-0.5 text-2xs text-text-muted">{formatDateTime(grant.revoked_at)}</div>}
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : data.audit_events.length === 0 ? (
            <EmptyState emoji="🧾" title="이 기간의 감사 이벤트가 없습니다" />
          ) : (
            <div className="space-y-2">
              {data.audit_events.map((event) => (
                <div key={event.event_id} className="rounded-card-md border border-line bg-bg-deep p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-pill border px-2 py-0.5 text-2xs font-black', event.event_type === 'REVOKE' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success')}>
                          {event.event_type}
                        </span>
                        <GradeBadge grade={event.grade} />
                        <span className="text-sm font-black text-text-primary">{event.achievement_name}</span>
                      </div>
                      <div className="mt-1 text-2xs font-bold text-text-muted">{event.achievement_uid} · {event.evaluation_method || '평가 방식 없음'}</div>
                      {event.reason && <div className="mt-2 text-xs font-bold text-text-secondary">사유: {event.reason}</div>}
                    </div>
                    <div className="text-2xs font-bold text-text-muted">{formatDateTime(event.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function GradeBadge({ grade }: { grade: AchievementA5Grade }) {
  return <span className={cn('inline-flex rounded-pill border px-2 py-0.5 text-2xs font-black', GRADE_CHIP[grade])}>{grade}</span>;
}
