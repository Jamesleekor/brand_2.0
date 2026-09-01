import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  primaryJobAdminRpc,
  type PrimaryJobAdminBoard,
  type PrimaryJobBoardStudent,
  type PrimaryJobSaveRow,
} from '@/lib/rpc/primary_job_admin_rpc';
import { formatNumber } from '@/lib/utils/format';
import { useToastStore } from '@/stores/ui_store';

const ROLE_SUGGESTIONS = [
  '환경(교실 앞)', '환경(교실 뒤)', '환경(신발장)', '환경(창문 A,B)',
  '분리수거', '시간표관리자', '청소함 관리자', '환기 관리자',
  '심부름센터', '인원 관리자', '일정 알리미', '제과점',
  '급식도우미', '제출 관리관', '1분단 환경관리', '2분단 환경관리',
  '3분단 환경관리', '일퀘관리인', '자산관리인', '태블릿관리자',
  '분쟁+기록관', '업적도우미',
] as const;

interface DraftRow {
  studentId: number;
  studentName: string;
  displayName: string;
  brandName: string | null;
  jobName: string;
  dailyWage: string;
  assignedArea: string;
  assignedAt: string | null;
  originallyActive: boolean;
}

interface CustomRoleDraft {
  studentId: number;
  value: string;
  wage: string;
  oldRole: string;
  oldWage: string;
}

function toDraft(student: PrimaryJobBoardStudent): DraftRow {
  return {
    studentId: Number(student.student_id),
    studentName: student.student_name,
    displayName: student.display_name || student.brand_name || student.student_name,
    brandName: student.brand_name,
    jobName: student.job_name ?? '',
    dailyWage: student.daily_wage == null ? '' : String(student.daily_wage),
    assignedArea: student.assigned_area ?? '',
    assignedAt: student.assigned_at,
    originallyActive: Boolean(student.is_active),
  };
}

function normalizeRole(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR');
}

export default function PrimaryJobAdmin() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const { call, isLoading: isSaving } = useRpcCall();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [customRoleDraft, setCustomRoleDraft] = useState<CustomRoleDraft | null>(null);

  const boardQuery = useQuery<PrimaryJobAdminBoard>({
    queryKey: ['teacher-primary-job-board'],
    queryFn: async () => {
      const result = await primaryJobAdminRpc.getBoard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!boardQuery.data || dirty) return;
    setRows(boardQuery.data.students.map(toDraft));
  }, [boardQuery.data, dirty]);

  const summary = useMemo(() => {
    const assigned = rows.filter((r) => r.jobName.trim().length > 0);
    const wageNumbers = assigned
      .map((r) => Number(r.dailyWage))
      .filter((v) => Number.isFinite(v) && v >= 0);
    const total = wageNumbers.reduce((sum, v) => sum + v, 0);
    return {
      studentCount: rows.length,
      assignedCount: assigned.length,
      unassignedCount: Math.max(rows.length - assigned.length, 0),
      totalDailyWage: total,
      averageDailyWage: wageNumbers.length ? total / wageNumbers.length : 0,
    };
  }, [rows]);

  // The loaded board is the previous/current assignment snapshot. Its role+wage pairs act
  // as reusable monthly presets, so rotating students does not require retyping wages.
  const rolePresetWages = useMemo(() => {
    const presets = new Map<string, string>();
    for (const student of boardQuery.data?.students ?? []) {
      const name = student.job_name?.trim();
      if (!name || student.daily_wage == null) continue;
      const key = normalizeRole(name);
      if (!presets.has(key)) presets.set(key, String(student.daily_wage));
    }
    return presets;
  }, [boardQuery.data]);

  const roleOptions = useMemo(() => {
    const names = new Map<string, string>();
    const add = (name: string | null | undefined) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      const key = normalizeRole(trimmed);
      if (!names.has(key)) names.set(key, trimmed);
    };

    // Put actual classroom roles first, then known suggestions, then unsaved custom roles.
    for (const student of boardQuery.data?.students ?? []) add(student.job_name);
    for (const suggestion of ROLE_SUGGESTIONS) add(suggestion);
    for (const row of rows) add(row.jobName);
    return [...names.values()];
  }, [boardQuery.data, rows]);

  const duplicateJobs = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const key = normalizeRole(row.jobName);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ko-KR');
    return rows.filter((row) => {
      if (onlyUnassigned && row.jobName.trim()) return false;
      if (!q) return true;
      return `${row.studentName} ${row.displayName} ${row.jobName}`
        .toLocaleLowerCase('ko-KR')
        .includes(q);
    });
  }, [rows, search, onlyUnassigned]);

  const patchRow = (studentId: number, patch: Partial<DraftRow>) => {
    setRows((current) => current.map((row) => row.studentId === studentId ? { ...row, ...patch } : row));
    setDirty(true);
  };

  const applyRoleChange = (
    studentId: number,
    nextRoleRaw: string,
    previous?: { role: string; wage: string },
    newWageOverride?: string,
  ) => {
    const nextRole = nextRoleRaw.trim();
    setRows((current) => {
      const target = current.find((row) => row.studentId === studentId);
      if (!target) return current;

      const oldRole = previous?.role ?? target.jobName;
      const oldWage = previous?.wage ?? target.dailyWage;
      const nextKey = normalizeRole(nextRole);
      const occupiedBy = nextKey
        ? current.find((row) => row.studentId !== studentId && normalizeRole(row.jobName) === nextKey)
        : undefined;

      // Selecting an occupied role swaps the whole role+wage pair. This is the fastest
      // monthly rotation workflow and prevents accidental duplicate assignments.
      if (occupiedBy) {
        return current.map((row) => {
          if (row.studentId === studentId) {
            return { ...row, jobName: occupiedBy.jobName, dailyWage: occupiedBy.dailyWage };
          }
          if (row.studentId === occupiedBy.studentId) {
            return { ...row, jobName: oldRole, dailyWage: oldRole.trim() ? oldWage : '' };
          }
          return row;
        });
      }

      const presetWage = nextKey ? rolePresetWages.get(nextKey) : undefined;
      return current.map((row) => row.studentId === studentId
        ? {
            ...row,
            jobName: nextRole,
            dailyWage: nextRole ? (presetWage ?? newWageOverride ?? (normalizeRole(oldRole) === nextKey ? oldWage : '')) : '',
          }
        : row);
    });
    setDirty(true);
  };

  const resetDraft = () => {
    if (!boardQuery.data) return;
    setRows(boardQuery.data.students.map(toDraft));
    setDirty(false);
    setCustomRoleDraft(null);
  };

  const save = async () => {
    const invalid = rows.find((row) => {
      if (!row.jobName.trim()) return false;
      const wage = Number(row.dailyWage);
      return row.dailyWage.trim() === '' || !Number.isInteger(wage) || wage < 0;
    });
    if (invalid) {
      showToast({
        title: `${invalid.studentName}의 일급을 확인해주세요`,
        description: '1인1역을 배정한 학생은 0 이상의 정수 일급이 필요합니다.',
        variant: 'warning',
      });
      return;
    }

    const payload: PrimaryJobSaveRow[] = rows.map((row) => ({
      student_id: row.studentId,
      job_name: row.jobName.trim(),
      daily_wage: row.jobName.trim() ? Number(row.dailyWage) : null,
      // No longer shown in the UI, but preserve existing data instead of destructively clearing it.
      assigned_area: row.assignedArea.trim() || null,
    }));

    const saved = await call(() => primaryJobAdminRpc.saveBoard(supabase, payload), {
      successTitle: '1인1역 배정을 저장했어요',
      successDescription: `${summary.assignedCount}명 배정 · 일일 총급여 ${formatNumber(summary.totalDailyWage)}`,
    });
    if (!saved) return;

    await queryClient.invalidateQueries({ queryKey: ['teacher-primary-job-board'] });
    await queryClient.invalidateQueries({ queryKey: ['bakery-i2-access'] });
    await queryClient.invalidateQueries({ queryKey: ['bakery-i2-dashboard'] });
    const refreshed = await boardQuery.refetch();
    if (refreshed.data) setRows(refreshed.data.students.map(toDraft));
    setDirty(false);
  };

  return (
    <TeacherShell>
      <div className="space-y-5 pb-28 md:pb-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-brand-gradient tracking-tight">🧑‍💼 1인1역 관리</h1>
            <p className="mt-1 text-sm font-bold text-text-secondary">
              역할과 일급은 재사용하고, 매달 학생 배정만 빠르게 바꿉니다. 저장된 일급은 추후 일일퀘스트 보상 계산의 기준값으로 사용할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={!dirty || isSaving} onClick={resetDraft}>변경 취소</button>
            <button className="btn-primary" disabled={!dirty || isSaving || rows.length === 0} onClick={() => void save()}>
              {isSaving ? '저장 중...' : '💾 전체 저장'}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <SummaryCard emoji="✅" label="배정 완료" value={`${summary.assignedCount} / ${summary.studentCount || 24}`} tone="success" />
          <SummaryCard emoji="🕳️" label="미배정" value={summary.unassignedCount} tone={summary.unassignedCount ? 'warning' : 'success'} />
          <SummaryCard emoji="💰" label="일일 총급여" value={formatNumber(summary.totalDailyWage)} tone="gold" />
          <SummaryCard emoji="📊" label="평균 일급" value={summary.averageDailyWage.toFixed(1)} tone="bv" />
        </section>

        {summary.studentCount !== 0 && summary.studentCount !== 24 && (
          <div className="rounded-card-md border border-warning/40 bg-warning-bg/30 px-4 py-3 text-sm font-bold text-warning">
            현재 활성 학생이 {summary.studentCount}명입니다. 화면은 실제 활성 학생 수를 기준으로 저장하며, 전입·전출 학생은 자동으로 제외됩니다.
          </div>
        )}

        <section className="rounded-card-lg border border-gold/25 bg-gold/5 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-text-secondary">
            <span className="font-black text-gold">빠른 월별 재배치</span>
            <span>역할 선택 → 이전 담당자의 일급 자동 적용</span>
            <span>이미 배정된 역할 선택 → 두 학생 역할·일급 자동 교환</span>
            <span className="text-text-muted">· 새 역할만 ‘직접 입력’을 한 번 사용하면 됩니다.</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs font-bold text-text-muted">
            <span>일급 참고: 초급 80~100</span>
            <span>중급 100~120</span>
            <span>상급 120~140</span>
            <span>최상급 140~180</span>
          </div>
        </section>

        <section className="bg-bg-card border border-line rounded-card-lg overflow-hidden">
          <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg text-white">24명 배정 보드</h2>
              <p className="text-xs text-text-muted mt-1">역할을 비우면 해임됩니다. 담당구역/메모는 화면에서 제거했으며 기존 저장값은 보존합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                className="input-field w-[190px]"
                placeholder="학생·역할 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className={onlyUnassigned ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setOnlyUnassigned((v) => !v)}
              >
                미배정만
              </button>
            </div>
          </div>

          {boardQuery.isLoading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner size="lg" /></div>
          ) : boardQuery.isError ? (
            <EmptyState emoji="⚠️" title="1인1역 정보를 불러오지 못했습니다" description={boardQuery.error instanceof Error ? boardQuery.error.message : '잠시 후 다시 시도해주세요.'} action={<button className="btn-secondary" onClick={() => void boardQuery.refetch()}>다시 불러오기</button>} />
          ) : rows.length === 0 ? (
            <EmptyState emoji="👥" title="활성 학생이 없습니다" description="현재 학급의 활성 학생 정보를 먼저 확인해주세요." />
          ) : (
            <>
              <div className="grid lg:grid-cols-2 gap-2.5 p-3 bg-bg-deep/35">
                {visibleRows.map((row) => {
                  const duplicate = row.jobName.trim() && duplicateJobs.has(normalizeRole(row.jobName));
                  const customEditing = customRoleDraft?.studentId === row.studentId;
                  return (
                    <div
                      key={row.studentId}
                      className={`rounded-card-md border p-3 transition-colors ${row.jobName.trim() ? 'border-line bg-bg-card hover:border-line-strong' : 'border-warning/20 bg-warning-bg/10'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="font-extrabold text-white truncate max-w-[84px]" title={row.displayName}>{row.studentName}</span>
                          <span className={`text-2xs font-black px-2 py-0.5 rounded-pill ${row.jobName.trim() ? 'bg-success-bg text-success' : 'bg-bg-deep text-text-muted'}`}>
                            {row.jobName.trim() ? '배정' : '미배정'}
                          </span>
                        </div>
                        {row.jobName.trim() && (
                          <button
                            className="text-2xs font-black text-danger hover:underline"
                            onClick={() => patchRow(row.studentId, { jobName: '', dailyWage: '' })}
                          >
                            해임
                          </button>
                        )}
                      </div>

                      {customEditing ? (
                        <div className="grid grid-cols-[minmax(0,1fr)_78px_auto] gap-2 items-center">
                          <input
                            autoFocus
                            className="input-field w-full"
                            placeholder="새 역할명"
                            maxLength={80}
                            value={customRoleDraft.value}
                            onChange={(e) => setCustomRoleDraft({ ...customRoleDraft, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                applyRoleChange(row.studentId, customRoleDraft.value, { role: customRoleDraft.oldRole, wage: customRoleDraft.oldWage }, customRoleDraft.wage);
                                setCustomRoleDraft(null);
                              }
                              if (e.key === 'Escape') setCustomRoleDraft(null);
                            }}
                          />
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="input-field w-full font-mono text-center"
                            placeholder="일급"
                            value={customRoleDraft.wage}
                            onChange={(e) => setCustomRoleDraft({ ...customRoleDraft, wage: e.target.value })}
                          />
                          <div className="flex gap-1">
                            <button
                              className="btn-primary px-2.5"
                              title="직접 입력 완료"
                              onClick={() => {
                                applyRoleChange(row.studentId, customRoleDraft.value, { role: customRoleDraft.oldRole, wage: customRoleDraft.oldWage }, customRoleDraft.wage);
                                setCustomRoleDraft(null);
                              }}
                            >✓</button>
                            <button className="btn-secondary px-2.5" title="취소" onClick={() => setCustomRoleDraft(null)}>×</button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[minmax(0,1fr)_78px_auto] gap-2 items-center">
                          <select
                            className="input-field w-full min-w-0"
                            value={row.jobName}
                            onChange={(e) => applyRoleChange(row.studentId, e.target.value)}
                          >
                            <option value="">미배정</option>
                            {roleOptions.map((name) => <option key={normalizeRole(name)} value={name}>{name}</option>)}
                          </select>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`${row.studentName} 일급`}
                            className="input-field w-full font-mono text-center"
                            placeholder="일급"
                            value={row.dailyWage}
                            disabled={!row.jobName.trim()}
                            onChange={(e) => patchRow(row.studentId, { dailyWage: e.target.value })}
                          />
                          <button
                            className="btn-secondary px-2.5 whitespace-nowrap"
                            title="목록에 없는 역할 직접 입력"
                            onClick={() => setCustomRoleDraft({
                              studentId: row.studentId,
                              value: row.jobName,
                              wage: row.dailyWage,
                              oldRole: row.jobName,
                              oldWage: row.dailyWage,
                            })}
                          >
                            직접
                          </button>
                        </div>
                      )}

                      {duplicate && <div className="text-2xs font-bold text-warning mt-1.5">같은 역할명이 중복 배정되어 있습니다.</div>}
                    </div>
                  );
                })}
              </div>
              {visibleRows.length === 0 && <EmptyState emoji="🔎" title="조건에 맞는 학생이 없습니다" />}
            </>
          )}
        </section>

        {dirty && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-xl rounded-card-xl border border-gold/40 bg-bg-overlay/95 backdrop-blur-card shadow-card p-3 flex items-center justify-between gap-3 md:bottom-6">
            <div className="min-w-0">
              <div className="text-sm font-black text-white">저장되지 않은 변경사항이 있습니다.</div>
              <div className="text-2xs text-text-muted truncate">배정 {summary.assignedCount}명 · 일일 총급여 {formatNumber(summary.totalDailyWage)}</div>
            </div>
            <button className="btn-primary flex-shrink-0" disabled={isSaving} onClick={() => void save()}>{isSaving ? '저장 중...' : '전체 저장'}</button>
          </div>
        )}
      </div>
    </TeacherShell>
  );
}

function SummaryCard({ emoji, label, value, tone }: { emoji: string; label: string; value: string | number; tone: 'success' | 'warning' | 'gold' | 'bv' }) {
  const toneClass = {
    success: 'border-success/30 text-success',
    warning: 'border-warning/30 text-warning',
    gold: 'border-gold/30 text-gold',
    bv: 'border-bv/30 text-bv',
  }[tone];
  return (
    <div className={`bg-bg-card border rounded-card-lg p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xl">{emoji}</span>
        <span className="text-2xs font-black uppercase tracking-wider text-text-muted">{label}</span>
      </div>
      <div className="font-display text-xl mt-3 tracking-tight">{value}</div>
    </div>
  );
}
