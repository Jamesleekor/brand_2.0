// BRAND_ASSET_ARREARS_ADMIN_V1
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  assetArrearsRpc,
  type AssetArrearsBoard,
  type AssetArrearsStudent,
  type AssetArrearsCollectResult,
} from '@/lib/rpc/asset_arrears_rpc';
import { useClassroomId } from '@/stores/auth_store';
import { formatDateTime, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type SortMode = 'OUTSTANDING_DESC' | 'NAME' | 'OLDEST';

function oldestCreatedAt(student: AssetArrearsStudent): number {
  const times = student.details
    .map((item) => new Date(item.created_at).getTime())
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.min(...times) : Number.MAX_SAFE_INTEGER;
}

export default function AssetArrearsAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('OUTSTANDING_DESC');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [collectingStudentId, setCollectingStudentId] = useState<number | null>(null);
  const [lastCollect, setLastCollect] = useState<{
    studentName: string;
    result: AssetArrearsCollectResult;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const arrearsQuery = useQuery<AssetArrearsBoard>({
    queryKey: ['teacher-asset-arrears', classroomId],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 불러오지 못했습니다.');
      return assetArrearsRpc.getState(supabase, classroomId);
    },
    enabled: classroomId !== null,
    staleTime: 15_000,
  });

  const board = arrearsQuery.data;
  const students = board?.students ?? [];
  const totalArrearCount = students.reduce((sum, student) => sum + Number(student.arrear_count ?? 0), 0);

  const visibleStudents = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('ko-KR');
    const rows = students.filter((student) => {
      if (!normalized) return true;
      return `${student.student_name} ${student.brand_name ?? ''}`
        .toLocaleLowerCase('ko-KR')
        .includes(normalized);
    });

    return rows.slice().sort((a, b) => {
      if (sortMode === 'NAME') {
        return a.student_name.localeCompare(b.student_name, 'ko-KR');
      }
      if (sortMode === 'OLDEST') {
        return oldestCreatedAt(a) - oldestCreatedAt(b);
      }
      return Number(b.outstanding_total) - Number(a.outstanding_total)
        || a.student_name.localeCompare(b.student_name, 'ko-KR');
    });
  }, [students, search, sortMode]);

  const toggleExpanded = (studentId: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const collectStudent = async (student: AssetArrearsStudent) => {
    if (!classroomId || collectingStudentId !== null) return;

    const ok = window.confirm(
      `${student.student_name} 학생의 미납금을 수동징수할까요?\n\n`
      + `현재 GOLD: ${formatNumber(student.current_gold)} G\n`
      + `총 미납: ${formatNumber(student.outstanding_total)} G\n\n`
      + `경매 입찰 예약액과 균형발전 분담금 예약액은 보호되며, 실제 사용 가능한 GOLD 범위에서 오래된 미납부터 징수됩니다.`
    );
    if (!ok) return;

    setCollectingStudentId(student.student_id);
    setActionError(null);
    try {
      const result = await assetArrearsRpc.collectStudent(supabase, classroomId, student.student_id);
      setLastCollect({ studentName: student.student_name, result });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teacher-asset-arrears', classroomId] }),
        queryClient.invalidateQueries({ queryKey: ['student-asset-arrears'] }),
        queryClient.invalidateQueries({ queryKey: ['teacher-asset-students', classroomId] }),
        queryClient.invalidateQueries({ queryKey: ['teacher-dashboard', classroomId] }),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '미납금 수동징수 중 오류가 발생했습니다.');
    } finally {
      setCollectingStudentId(null);
    }
  };

  return (
    <TeacherShell>
      <div className="space-y-5 pb-20 md:pb-4">
        <header>
          <h1 className="font-display text-2xl text-brand-gradient tracking-tight">
            💸 미납금 관리
          </h1>
          <p className="mt-1 text-sm font-bold text-text-secondary">
            학생별 GOLD 미납 현황을 확인하고, 가능한 범위에서 오래된 미납부터 수동징수합니다.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            label="미납 학생"
            value={`${formatNumber(board?.student_count ?? 0)}명`}
            emoji="👥"
            tone="danger"
          />
          <SummaryCard
            label="전체 미납금"
            value={`${formatNumber(board?.total_outstanding ?? 0)} G`}
            emoji="💸"
            tone="gold"
          />
          <SummaryCard
            label="미납 건수"
            value={`${formatNumber(totalArrearCount)}건`}
            emoji="🧾"
            tone="bv"
          />
        </section>

        {lastCollect && (
          <section className="rounded-card-lg border border-success/30 bg-success-bg p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-success">✅ 수동징수 처리 완료</div>
                <p className="mt-1 text-xs font-bold text-text-secondary">
                  {lastCollect.studentName} · 이번 징수 {formatNumber(lastCollect.result.collected_total)} G
                  {' · '}남은 전체 미납 {formatNumber(lastCollect.result.remaining_outstanding)} G
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLastCollect(null)}
                className="text-xs font-black text-text-muted hover:text-white"
              >
                닫기 ✕
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniMetric label="징수 전 GOLD" value={`${formatNumber(lastCollect.result.current_gold_before)} G`} />
              <MiniMetric label="징수 가능액" value={`${formatNumber(lastCollect.result.available_gold_before)} G`} />
              <MiniMetric label="경매 예약" value={`${formatNumber(lastCollect.result.auction_reserved_gold)} G`} />
              <MiniMetric label="분담금 예약" value={`${formatNumber(lastCollect.result.equalization_reserved_gold)} G`} />
            </div>
          </section>
        )}

        {actionError && (
          <section className="rounded-card-lg border border-danger/30 bg-danger-bg p-4 text-sm font-bold text-danger">
            {actionError}
          </section>
        )}

        <section className="rounded-card-lg border border-line bg-bg-card p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">🔎</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="학생 이름 또는 BRAND 이름 검색"
                className="input-field w-full pl-9"
              />
            </div>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="input-field sm:w-44"
            >
              <option value="OUTSTANDING_DESC">미납액 큰 순</option>
              <option value="NAME">이름순</option>
              <option value="OLDEST">오래된 미납 우선</option>
            </select>
            <button
              type="button"
              onClick={() => void arrearsQuery.refetch()}
              disabled={arrearsQuery.isFetching}
              className="btn-secondary whitespace-nowrap"
            >
              {arrearsQuery.isFetching ? '새로고침 중...' : '↻ 새로고침'}
            </button>
          </div>
          <p className="mt-2 text-2xs font-bold text-text-muted">
            자동상환은 기존 정책대로 GOLD 유입 시 오래된 미납부터 진행됩니다. 수동징수도 같은 우선순서를 사용합니다.
          </p>
        </section>

        {arrearsQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : arrearsQuery.isError ? (
          <section className="rounded-card-lg border border-danger/30 bg-danger-bg p-5 text-center">
            <div className="text-sm font-black text-danger">미납금 현황을 불러오지 못했습니다.</div>
            <p className="mt-1 text-xs font-bold text-text-secondary">
              {arrearsQuery.error instanceof Error ? arrearsQuery.error.message : '알 수 없는 오류'}
            </p>
            <button type="button" onClick={() => void arrearsQuery.refetch()} className="btn-secondary mt-4">
              다시 불러오기
            </button>
          </section>
        ) : students.length === 0 ? (
          <EmptyState
            emoji="✅"
            title="현재 미납금이 없습니다"
            description="모든 학생의 GOLD 미납금이 정리되어 있습니다."
          />
        ) : visibleStudents.length === 0 ? (
          <EmptyState
            emoji="🔎"
            title="검색 결과가 없습니다"
            description="다른 학생 이름이나 BRAND 이름으로 검색해보세요."
          />
        ) : (
          <section className="space-y-3">
            {visibleStudents.map((student) => (
              <StudentArrearsCard
                key={student.student_id}
                student={student}
                expanded={expandedIds.has(student.student_id)}
                collecting={collectingStudentId === student.student_id}
                collectDisabled={collectingStudentId !== null}
                onToggle={() => toggleExpanded(student.student_id)}
                onCollect={() => void collectStudent(student)}
              />
            ))}
          </section>
        )}
      </div>
    </TeacherShell>
  );
}

function SummaryCard({
  label,
  value,
  emoji,
  tone,
}: {
  label: string;
  value: string;
  emoji: string;
  tone: 'danger' | 'gold' | 'bv';
}) {
  const toneClass = {
    danger: 'border-danger/30 text-danger',
    gold: 'border-gold/30 text-gold',
    bv: 'border-bv/30 text-bv',
  }[tone];

  return (
    <div className={cn('rounded-card-lg border bg-bg-card p-4', toneClass)}>
      <div className="flex items-center justify-between">
        <div className="text-2xs font-black uppercase tracking-widest text-text-muted">{label}</div>
        <span className="text-xl">{emoji}</span>
      </div>
      <div className={cn('mt-2 font-display text-2xl tracking-tight', toneClass)}>{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-sm border border-line bg-bg-deep p-2">
      <div className="text-[9px] font-black text-text-muted">{label}</div>
      <div className="mt-0.5 text-xs font-black text-white">{value}</div>
    </div>
  );
}

function StudentArrearsCard({
  student,
  expanded,
  collecting,
  collectDisabled,
  onToggle,
  onCollect,
}: {
  student: AssetArrearsStudent;
  expanded: boolean;
  collecting: boolean;
  collectDisabled: boolean;
  onToggle: () => void;
  onCollect: () => void;
}) {
  const totalAssessed = student.details.reduce((sum, item) => sum + Number(item.assessed_amount), 0);
  const totalPaid = student.details.reduce((sum, item) => sum + Number(item.paid_amount), 0);
  const paidPercent = totalAssessed > 0 ? Math.min(100, Math.max(0, (totalPaid / totalAssessed) * 100)) : 0;

  return (
    <article className="overflow-hidden rounded-card-lg border border-line bg-bg-card">
      <div className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg text-white">{student.student_name}</span>
              {student.brand_name && (
                <span className="rounded-pill border border-line bg-bg-deep px-2 py-0.5 text-[10px] font-black text-text-secondary">
                  {student.brand_name}
                </span>
              )}
              <span className="rounded-pill border border-danger/30 bg-danger-bg px-2 py-0.5 text-[10px] font-black text-danger">
                미납 {formatNumber(student.outstanding_total)} G
              </span>
              <span className="rounded-pill border border-line px-2 py-0.5 text-[10px] font-black text-text-muted">
                {student.arrear_count}건
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-text-secondary">
              <span>현재 GOLD <b className="text-gold">{formatNumber(student.current_gold)} G</b></span>
              <span>누적 납부 <b className="text-success">{formatNumber(totalPaid)} G</b></span>
              <span className="text-text-muted">{expanded ? '상세 접기 ▲' : '상세 보기 ▼'}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-bg-deep">
              <div
                className="h-full rounded-pill bg-success transition-all"
                style={{ width: `${paidPercent}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={onCollect}
            disabled={collectDisabled}
            className="btn-primary min-w-[120px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
          >
            {collecting ? '징수 중...' : '💰 수동징수'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line bg-bg-deep/60 p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-black text-text-secondary">미납 상세 내역</div>
            <div className="text-2xs font-bold text-text-muted">오래된 순</div>
          </div>
          <div className="space-y-2">
            {student.details.map((detail) => (
              <div key={detail.arrear_id} className="rounded-card-md border border-line bg-bg-card p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-xs font-extrabold text-text-primary">{detail.reason}</div>
                    <div className="mt-1 text-[10px] font-bold text-text-muted">{formatDateTime(detail.created_at)}</div>
                  </div>
                  <span className={cn(
                    'w-fit rounded-pill border px-2 py-0.5 text-[9px] font-black',
                    detail.status === 'PARTIAL'
                      ? 'border-warning/30 bg-warning-bg text-warning'
                      : 'border-danger/30 bg-danger-bg text-danger',
                  )}>
                    {detail.status === 'PARTIAL' ? '일부 납부' : '미납'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniMetric label="부과액" value={`${formatNumber(detail.assessed_amount)} G`} />
                  <MiniMetric label="납부액" value={`${formatNumber(detail.paid_amount)} G`} />
                  <MiniMetric label="남은 미납" value={`${formatNumber(detail.outstanding_amount)} G`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
