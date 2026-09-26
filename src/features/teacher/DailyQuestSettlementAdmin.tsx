import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  CalendarPlus2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Coins,
  CornerUpLeft,
  Eye,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import {
  dailyQuestS3Rpc,
  type DailyQuestCheck,
  type DailyQuestCode,
  type DailyQuestLegacyArchive,
  type DailyQuestTeacherBoard,
  type DailyQuestTeacherDayState,
  type DailyQuestTeacherStudent,
} from '@/lib/rpc/daily_quest_s3_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatNumber } from '@/lib/utils/format';

const QUEST_META: Record<DailyQuestCode, { label: string; emoji: string }> = {
  ATTENDANCE: { label: '출석', emoji: '⏰' },
  PRIMARY_JOB: { label: '1인1역', emoji: '🧑‍💼' },
  LEARNING_MATERIALS: { label: '준비물', emoji: '🎒' },
  CLEANING: { label: '청소', emoji: '🧹' },
};

const DAY_STATE_KEY = 'daily-quest-s3-teacher-day-state';
const BOARD_KEY = 'daily-quest-s3-teacher-board';
const LEGACY_KEY = 'daily-quest-s3-teacher-legacy-archive';

export default function DailyQuestSettlementAdmin() {
  const queryClient = useQueryClient();
  const today = seoulDateString();
  const [date, setDate] = useState(today);
  const [showAll, setShowAll] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{ student: DailyQuestTeacherStudent; check: DailyQuestCheck } | null>(null);
  const [overrideResult, setOverrideResult] = useState<'PASS' | 'FAIL'>('PASS');
  const [overrideReason, setOverrideReason] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const { call, isLoading } = useRpcCall();

  const dayStateQuery = useQuery({
    queryKey: [DAY_STATE_KEY, date],
    queryFn: async () => {
      const result = await dailyQuestS3Rpc.getTeacherDayState(supabase, date);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 2_000,
    refetchInterval: 15_000,
  });

  const dayState = dayStateQuery.data;

  const boardQuery = useQuery({
    queryKey: [BOARD_KEY, date],
    queryFn: async () => {
      const result = await dailyQuestS3Rpc.getTeacherBoard(supabase, date);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: dayState?.report_exists === true,
    staleTime: 2_000,
    refetchInterval: 15_000,
  });

  const legacyQuery = useQuery({
    queryKey: [LEGACY_KEY, date],
    queryFn: async () => {
      const result = await dailyQuestS3Rpc.getLegacyArchive(supabase, date);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: dayState?.report_exists !== true && dayState?.is_legacy_archive === true && dayState?.has_legacy_archive === true,
    staleTime: 30_000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [DAY_STATE_KEY, date] }),
      queryClient.invalidateQueries({ queryKey: [BOARD_KEY, date] }),
      queryClient.invalidateQueries({ queryKey: [LEGACY_KEY, date] }),
    ]);
  };

  const changeDate = (next: string) => {
    setDate(next);
    setShowAll(false);
    setOverrideTarget(null);
    setReturnOpen(false);
  };

  const createReport = async () => {
    if (!dayState?.can_create || isLoading) return;
    const result = await call(
      () => dailyQuestS3Rpc.createTeacherReport(supabase, date),
      {
        successTitle: '일일퀘스트 정산표를 만들었어요',
        successDescription: '관리자 제출이 없어도 운영국에서 직접 PASS/FAIL을 기록하고 정산할 수 있습니다.',
      },
    );
    if (!result) return;
    await refresh();
  };

  const board = boardQuery.data;
  const report = board?.report ?? null;

  const visibleStudents = useMemo(() => {
    const students = board?.students ?? [];
    if (showAll) return students;
    return students.filter((student) =>
      student.unchecked_count > 0 ||
      student.fail_count > 0 ||
      student.checks.some((check) => check.teacher_override),
    );
  }, [board?.students, showAll]);

  const openOverride = (student: DailyQuestTeacherStudent, check: DailyQuestCheck, next: 'PASS' | 'FAIL') => {
    setOverrideTarget({ student, check });
    setOverrideResult(next);
    setOverrideReason('');
  };

  const setTeacherCheck = async (student: DailyQuestTeacherStudent, check: DailyQuestCheck, next: 'PASS' | 'FAIL') => {
    if (!report || report.status === 'SETTLED' || check.result === next) return;

    if (check.result === 'UNCHECKED') {
      const result = await call(
        () => dailyQuestS3Rpc.overrideCheck(supabase, check.check_id, next, null),
        { silent: true },
      );
      if (result) await refresh();
      return;
    }

    openOverride(student, check, next);
  };

  const submitOverride = async () => {
    if (!overrideTarget || overrideReason.trim().length < 2) return;
    const result = await call(
      () => dailyQuestS3Rpc.overrideCheck(supabase, overrideTarget.check.check_id, overrideResult, overrideReason),
      {
        successTitle: `${overrideTarget.student.student_name} 기록을 수정했어요`,
        successDescription: `${QUEST_META[overrideTarget.check.quest_code].label} → ${overrideResult}`,
      },
    );
    if (!result) return;
    setOverrideTarget(null);
    setOverrideReason('');
    await refresh();
  };

  const returnReport = async () => {
    if (!report || returnReason.trim().length < 2) return;
    const result = await call(
      () => dailyQuestS3Rpc.returnReport(supabase, report.id, returnReason),
      { successTitle: '관리자에게 수정 요청을 보냈어요' },
    );
    if (!result) return;
    setReturnOpen(false);
    setReturnReason('');
    await refresh();
  };

  const settle = async () => {
    if (!report || report.status === 'SETTLED') return;
    const s = board?.summary;
    const message = [
      `${report.quest_date} 일일퀘스트를 최종 정산합니다.`,
      report.status === 'SUBMITTED' ? '관리자 제출본을 정산합니다.' : '관리자 제출 없이 운영국에서 직접 입력한 결과로 정산합니다.',
      `BV ${formatNumber(s?.expected_total_bv ?? 0)}`,
      `GOLD 총 ${formatNumber(s?.expected_total_gold_gross ?? 0)} / 세금 ${formatNumber(s?.expected_total_tax ?? 0)} / 실수령 ${formatNumber(s?.expected_total_gold_net ?? 0)}`,
      '',
      '이 작업은 실제 학생 지갑과 복지기금을 변경합니다. 계속할까요?',
    ].join('\n');
    if (!window.confirm(message)) return;
    const result = await call(
      () => dailyQuestS3Rpc.settleReport(supabase, report.id),
      {
        successTitle: '일일퀘스트 정산 완료',
        successDescription: '승인된 항목의 BV·GOLD와 컬렉션 보너스를 지급했습니다.',
      },
    );
    if (result) await refresh();
  };

  const dateLoading = dayStateQuery.isLoading;
  const dateError = dayStateQuery.isError ? errorMessage(dayStateQuery.error) : null;
  const activeLoading = dayState?.report_exists ? boardQuery.isLoading : legacyQuery.isLoading;
  const activeError = dayState?.report_exists
    ? (boardQuery.isError ? errorMessage(boardQuery.error) : null)
    : (legacyQuery.isError ? errorMessage(legacyQuery.error) : null);

  return (
    <TeacherShell>
      <div className="space-y-5">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-2xs font-black uppercase tracking-[0.18em] text-gold">
              <ClipboardCheck className="h-4 w-4" /> Daily Quest Settlement
            </div>
            <h1 className="font-display text-2xl text-brand-gradient">일일퀘스트 일자별 정산</h1>
            <p className="mt-1 text-sm font-bold text-white/75">날짜별 공식 원장을 확인하고, 관리자 부재 시 운영국에서 직접 정산표를 생성·입력·확정합니다.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => changeDate(shiftDate(date, -1))}
              className="btn-secondary h-10 w-10 p-0"
              aria-label="이전 날짜"
            >
              <ChevronLeft className="mx-auto h-4 w-4" />
            </button>
            <label className="text-2xs font-black text-white/80">
              날짜
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => changeDate(e.target.value)}
                className="input-field mt-1 block min-w-[170px]"
              />
            </label>
            <button
              type="button"
              disabled={date >= today}
              onClick={() => changeDate(shiftDate(date, 1))}
              className="btn-secondary h-10 w-10 p-0 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="다음 날짜"
            >
              <ChevronRight className="mx-auto h-4 w-4" />
            </button>
            <button type="button" onClick={() => void refresh()} className="btn-secondary flex h-10 items-center gap-2">
              <RefreshCw className={cn('h-4 w-4', (dayStateQuery.isFetching || boardQuery.isFetching || legacyQuery.isFetching) && 'animate-spin')} /> 새로고침
            </button>
          </div>
        </header>

        {dateLoading ? (
          <div className="flex min-h-[45vh] items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : dateError ? (
          <TeacherLoadError message={dateError} onRetry={() => void dayStateQuery.refetch()} />
        ) : !dayState ? null : activeLoading ? (
          <div className="flex min-h-[45vh] items-center justify-center"><LoadingSpinner size="lg" /></div>
        ) : activeError ? (
          <TeacherLoadError message={activeError} onRetry={() => void refresh()} />
        ) : dayState.report_exists && board && report ? (
          <>
            <TeacherQuestHero board={board} />
            <TeacherSummary board={board} />

            {report.status === 'RETURNED' && report.return_reason && (
              <div className="rounded-card-lg border border-warning/40 bg-warning-bg p-4 text-sm font-bold text-white/80">
                <span className="font-black text-warning">반려 사유:</span> {report.return_reason}
              </div>
            )}

            <section className="glass-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <h2 className="font-display text-lg text-white">학생별 결과</h2>
                  <p className="mt-1 text-xs font-bold text-white/65">기본은 실패·미확인·운영국 수정 이력만 표시합니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Eye className="h-4 w-4" /> {showAll ? '예외만 보기' : '전체 24명 보기'}
                </button>
              </div>

              {visibleStudents.length === 0 ? (
                <EmptyState emoji="✅" title="검토할 예외가 없습니다" description="모든 학생의 항목이 PASS이며 운영국 수정 이력도 없습니다." action={<button className="btn-secondary" onClick={() => setShowAll(true)}>전체 결과 보기</button>} />
              ) : (
                <div className="divide-y divide-line/70">
                  {visibleStudents.map((student) => (
                    <TeacherStudentRow
                      key={student.student_id}
                      student={student}
                      canEdit={report.status !== 'SETTLED'}
                      onSet={(check, result) => void setTeacherCheck(student, check, result)}
                    />
                  ))}
                </div>
              )}
            </section>

            <TeacherActionBar
              board={board}
              busy={isLoading}
              onReturn={() => setReturnOpen(true)}
              onSettle={() => void settle()}
            />
          </>
        ) : dayState.is_legacy_archive ? (
          <LegacyArchiveView state={dayState} archive={legacyQuery.data ?? null} />
        ) : (
          <MissingReportPanel
            state={dayState}
            busy={isLoading}
            onCreate={() => void createReport()}
          />
        )}
      </div>

      <Modal
        isOpen={overrideTarget !== null}
        onClose={() => !isLoading && setOverrideTarget(null)}
        title="일일퀘스트 결과 수정"
        emoji="✏️"
        size="sm"
      >
        {overrideTarget && (
          <div className="space-y-4">
            <div className="rounded-card-md border border-line bg-bg-deep p-3">
              <div className="text-sm font-black text-white">{overrideTarget.student.student_name}</div>
              <div className="mt-1 text-xs font-bold text-white/75">
                {QUEST_META[overrideTarget.check.quest_code].emoji} {QUEST_META[overrideTarget.check.quest_code].label} · {overrideTarget.check.result} → {overrideResult}
              </div>
            </div>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              maxLength={200}
              placeholder="수정 사유를 2자 이상 입력하세요"
              className="input-field min-h-24 w-full"
            />
            <button type="button" disabled={isLoading || overrideReason.trim().length < 2} onClick={() => void submitOverride()} className="btn-primary w-full disabled:opacity-50">수정 확정</button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={returnOpen}
        onClose={() => !isLoading && setReturnOpen(false)}
        title="관리자에게 수정 요청"
        emoji="↩️"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm font-bold text-white/75">보고서를 관리자에게 되돌립니다. 반려 후 관리자는 다시 수정하고 재제출할 수 있습니다.</p>
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            maxLength={200}
            placeholder="예: 박○○의 청소 결과를 다시 확인해주세요."
            className="input-field min-h-24 w-full"
          />
          <button type="button" disabled={isLoading || returnReason.trim().length < 2} onClick={() => void returnReport()} className="btn-primary w-full disabled:opacity-50">수정 요청 보내기</button>
        </div>
      </Modal>
    </TeacherShell>
  );
}

function MissingReportPanel({
  state,
  busy,
  onCreate,
}: {
  state: DailyQuestTeacherDayState;
  busy: boolean;
  onCreate: () => void;
}) {
  if (state.can_create) {
    return (
      <section className="rounded-card-xl border border-line-brand bg-gradient-to-br from-brand-primary/15 via-bg-card to-gold/10 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-card-lg border border-gold/30 bg-gold/10 p-3"><CalendarPlus2 className="h-7 w-7 text-gold" /></div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-gold">정산표 미생성</div>
              <h2 className="mt-1 font-display text-xl text-white">{state.quest_date} 일일퀘스트 원장이 아직 없습니다</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-relaxed text-white/75">
                일일퀘스트 관리자 학생이 부재하거나 아직 체크리스트를 만들지 않았어도 운영국에서 직접 오늘의 공식 원장을 생성할 수 있습니다.
                생성만으로 보상은 지급되지 않으며, 모든 판정을 확인한 뒤 최종 정산할 때만 실제 지급이 발생합니다.
              </p>
            </div>
          </div>
          <button type="button" disabled={busy} onClick={onCreate} className="btn-primary flex min-w-[220px] items-center justify-center gap-2 disabled:opacity-50">
            <CalendarPlus2 className="h-4 w-4" /> {busy ? '생성 중...' : '이 날짜 정산표 생성'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-6 text-center">
      <Archive className="mx-auto h-8 w-8 text-bv" />
      <h2 className="mt-3 font-display text-lg text-white">이 날짜에는 지급용 정산표가 없습니다</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-relaxed text-white/75">
        {state.create_block_reason ?? '해당 날짜에는 생성된 일일퀘스트 원장이 없습니다.'}
      </p>
      <div className="mx-auto mt-4 max-w-2xl rounded-card-md border border-bv/25 bg-bv/10 px-4 py-3 text-xs font-bold text-white/80">
        과거 날짜에 현재 1인1역 일급을 복사해 새 보상을 만드는 방식은 사용하지 않습니다. 당시 스냅샷을 확인할 수 없는 날은 지급용 원장을 소급 생성하지 않습니다.
      </div>
    </section>
  );
}

function LegacyArchiveView({ state, archive }: { state: DailyQuestTeacherDayState; archive: DailyQuestLegacyArchive | null }) {
  if (!state.has_legacy_archive || !archive || archive.students.length === 0) {
    return (
      <section className="space-y-4">
        <LegacyReadOnlyBanner date={state.quest_date} />
        <EmptyState emoji="🗃️" title="이 날짜의 구버전 일일퀘스트 기록이 없습니다" description="읽기 전용 아카이브에서 해당 날짜의 지급 기록을 찾지 못했습니다." />
      </section>
    );
  }

  const s = archive.summary;
  return (
    <section className="space-y-4">
      <LegacyReadOnlyBanner date={archive.quest_date} />

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <ArchiveSummaryCard label="기록 학생" value={s.student_count} suffix="명" />
        <ArchiveSummaryCard label="기록 BV 증감" value={s.total_bv} suffix="BV" />
        <ArchiveSummaryCard label="기록 GOLD 증감" value={s.total_gold} suffix="GOLD" />
        <ArchiveSummaryCard label="메모상 세금" value={s.parsed_tax_total} suffix="GOLD" />
      </div>

      <div className="rounded-card-lg border border-warning/25 bg-warning-bg px-4 py-3 text-xs font-bold leading-relaxed text-white/80">
        구버전 원장에는 현재의 4종(출석·1인1역·준비물·청소) PASS/FAIL 세부 판정이 보존되어 있지 않습니다. 따라서 존재하지 않는 판정을 추정하지 않고 당시 지급 기록만 표시합니다.
      </div>

      <div className="glass-card overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="font-display text-lg text-white">구버전 일일퀘스트 지급 기록</h2>
          <p className="mt-1 text-xs font-bold text-white/65">원본: legacy_asset_history · {s.entry_count}건 · 모든 항목 조회 전용</p>
        </div>
        <div className="divide-y divide-line/70">
          {archive.students.map((student) => (
            <div key={student.student_id} className="grid gap-3 p-4 lg:grid-cols-[minmax(150px,1fr)_repeat(3,minmax(110px,0.7fr))_minmax(190px,1.2fr)] lg:items-center">
              <div>
                <div className="text-sm font-black text-white">{student.student_name}</div>
                {student.brand_name && <div className="mt-0.5 text-2xs font-bold text-white/60">{student.brand_name}</div>}
              </div>
              <LegacyMetric label="BV 기록" value={student.total_bv} suffix="BV" />
              <LegacyMetric label="GOLD 기록" value={student.total_gold} suffix="G" />
              <LegacyMetric label="메모상 세금" value={student.parsed_tax_total} suffix="G" />
              <details className="rounded-card-md border border-line bg-bg-deep px-3 py-2">
                <summary className="cursor-pointer text-xs font-black text-gold">원본 {student.entry_count}건 보기</summary>
                <div className="mt-2 space-y-2">
                  {student.entries.map((entry) => (
                    <div key={entry.legacy_id} className="rounded-card-sm border border-line/70 bg-bg-card px-2.5 py-2 text-2xs font-bold text-white/75">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>{entry.source_timestamp_local || (entry.occurred_at ? formatDateTime(entry.occurred_at) : archive.quest_date)}</span>
                        <span className="text-gold">BV {formatSigned(entry.bv_delta)} · GOLD {formatSigned(entry.gold_delta)}</span>
                      </div>
                      {entry.memo && <div className="mt-1 text-white/65">{entry.memo}</div>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LegacyReadOnlyBanner({ date }: { date: string }) {
  return (
    <div className="rounded-card-xl border border-bv/30 bg-gradient-to-br from-bv/15 via-bg-card to-bg-deep p-5">
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 h-6 w-6 flex-none text-bv" />
        <div>
          <div className="text-xs font-black uppercase tracking-[0.15em] text-bv">Legacy Archive · Read Only</div>
          <h2 className="mt-1 font-display text-xl text-white">{date} 구버전 일일퀘스트 기록</h2>
          <p className="mt-2 text-sm font-bold leading-relaxed text-white/75">
            이 기록의 보상은 과거 시스템에서 이미 반영되었습니다. 이 화면은 기록 확인만 수행하며 정산표 생성·재정산·추가 지급 기능을 제공하지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

function ArchiveSummaryCard({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="rounded-card-lg border border-line bg-bg-card p-4">
      <div className="text-2xs font-black uppercase tracking-wide text-white/65">{label}</div>
      <div className="mt-1 font-display text-xl text-white">{formatNumber(value)} <span className="text-xs text-gold">{suffix}</span></div>
    </div>
  );
}

function LegacyMetric({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep px-3 py-2 lg:text-right">
      <div className="text-[10px] font-black text-white/60">{label}</div>
      <div className="mt-0.5 text-xs font-black text-white">{formatSigned(value)} {suffix}</div>
    </div>
  );
}

function TeacherQuestHero({ board }: { board: DailyQuestTeacherBoard }) {
  const report = board.report!;
  const meta = statusMeta(report.status);
  return (
    <section className="rounded-card-xl border border-line-brand bg-gradient-to-br from-brand-primary/20 via-bg-card to-gold/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('rounded-pill border px-2.5 py-1 text-2xs font-black', meta.className)}>{meta.label}</span>
            <span className="text-xs font-bold text-white/65">{report.quest_date}</span>
          </div>
          <h2 className="font-display text-xl text-white">선택 날짜 정산 보고서</h2>
          <p className="mt-1 text-sm font-bold text-white/75">
            {report.submitted_at
              ? `관리자 제출 ${formatDateTime(report.submitted_at)}`
              : report.settled_at
                ? '관리자 제출 없이 운영국 직접 정산'
                : report.manager_student_id === null
                  ? '관리자 미배정 · 운영국이 직접 PASS/FAIL 입력 후 정산할 수 있습니다.'
                  : '관리자 미제출 · 운영국이 직접 PASS/FAIL 입력 후 정산할 수 있습니다.'}
            {report.settled_at ? ` · 정산 ${formatDateTime(report.settled_at)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-card-lg border border-line bg-bg-deep px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-gold" />
          <div><div className="text-2xs font-black text-white/60">보상 권한</div><div className="text-xs font-black text-white">운영국 최종 승인 전용</div></div>
        </div>
      </div>
    </section>
  );
}

function TeacherSummary({ board }: { board: DailyQuestTeacherBoard }) {
  const s = board.summary;
  const items = [
    { label: '예상 BV', value: s.expected_total_bv ?? 0, icon: Sparkles, cls: 'text-bv' },
    { label: 'GOLD 총보상', value: s.expected_total_gold_gross ?? 0, icon: Coins, cls: 'text-gold' },
    { label: '예상 세금', value: s.expected_total_tax ?? 0, icon: ShieldCheck, cls: 'text-warning' },
    { label: 'GOLD 실수령', value: s.expected_total_gold_net ?? 0, icon: CheckCircle2, cls: 'text-success' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-card-lg border border-line bg-bg-card p-4">
          <div className="flex items-center gap-2 text-2xs font-black uppercase tracking-wide text-white/65"><item.icon className={cn('h-4 w-4', item.cls)} />{item.label}</div>
          <div className={cn('mt-1 font-display text-2xl', item.cls)}>{formatNumber(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function TeacherStudentRow({
  student,
  canEdit,
  onSet,
}: {
  student: DailyQuestTeacherStudent;
  canEdit: boolean;
  onSet: (check: DailyQuestCheck, result: 'PASS' | 'FAIL') => void;
}) {
  return (
    <div className="grid gap-3 p-3 xl:grid-cols-[160px_minmax(0,1fr)_185px] xl:items-center">
      <div>
        <div className="text-sm font-black text-white">{student.student_name}</div>
        {student.brand_name && <div className="mt-0.5 text-2xs font-bold text-white/60">{student.brand_name}</div>}
        <div className="mt-1 flex gap-1.5 text-2xs font-black">
          {student.fail_count > 0 && <span className="rounded-pill bg-danger-bg px-2 py-0.5 text-danger">FAIL {student.fail_count}</span>}
          {student.unchecked_count > 0 && <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-warning">미확인 {student.unchecked_count}</span>}
          {student.pass_count === 4 && <span className="rounded-pill bg-success-bg px-2 py-0.5 text-success">ALL CLEAR</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {student.checks.map((check) => (
          <TeacherCheckChip key={check.check_id} check={check} canEdit={canEdit} onSet={onSet} />
        ))}
      </div>

      <div className="rounded-card-md border border-line bg-bg-deep p-2.5 xl:text-right">
        <div className="text-2xs font-black text-white/60">예상 지급</div>
        <div className="mt-1 text-xs font-black text-bv">+{formatNumber(student.expected_bv)} BV</div>
        <div className="mt-0.5 text-xs font-black text-gold">+{formatNumber(student.expected_gold_net)} GOLD <span className="text-white/60">(세 {formatNumber(student.expected_tax)})</span></div>
        {(student.attendance_bonus_gold > 0 || student.all_clear_bonus_gold > 0) && (
          <div className="mt-1 text-2xs font-bold text-success">
            컬렉션 +{formatNumber(student.attendance_bonus_gold + student.all_clear_bonus_gold)} GOLD
          </div>
        )}
      </div>
    </div>
  );
}

function TeacherCheckChip({
  check,
  canEdit,
  onSet,
}: {
  check: DailyQuestCheck;
  canEdit: boolean;
  onSet: (check: DailyQuestCheck, result: 'PASS' | 'FAIL') => void;
}) {
  const meta = QUEST_META[check.quest_code];
  return (
    <div className={cn(
      'rounded-card-md border p-1.5',
      check.result === 'PASS' ? 'border-success/30 bg-success-bg' :
      check.result === 'FAIL' ? 'border-danger/30 bg-danger-bg' : 'border-warning/30 bg-warning-bg',
    )}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate whitespace-nowrap text-[11px] font-black text-white">{meta.emoji} {meta.label}</span>
        {check.teacher_override && <span className="flex-none text-[9px] font-black text-gold">운영국</span>}
      </div>
      {check.quest_code === 'PRIMARY_JOB' && check.job_name && (
        <div className="mt-0.5 truncate text-[9px] font-bold text-white/60">{check.job_name} · {check.job_wage}</div>
      )}
      <div className="mt-1 grid grid-cols-2 gap-1">
        <button
          type="button"
          disabled={!canEdit || check.result === 'PASS'}
          onClick={() => onSet(check, 'PASS')}
          className={cn(
            'flex min-w-0 items-center justify-center whitespace-nowrap rounded-card-sm border px-1.5 py-1 text-[10px] font-black leading-none transition',
            check.result === 'PASS' ? 'border-success bg-success text-bg-base' : 'border-line bg-bg-card text-white/75 hover:border-success/50 hover:text-success',
            (!canEdit || check.result === 'PASS') && 'cursor-default',
          )}
        >PASS</button>
        <button
          type="button"
          disabled={!canEdit || check.result === 'FAIL'}
          onClick={() => onSet(check, 'FAIL')}
          className={cn(
            'flex min-w-0 items-center justify-center whitespace-nowrap rounded-card-sm border px-1.5 py-1 text-[10px] font-black leading-none transition',
            check.result === 'FAIL' ? 'border-danger bg-danger text-white' : 'border-line bg-bg-card text-white/75 hover:border-danger/50 hover:text-danger',
            (!canEdit || check.result === 'FAIL') && 'cursor-default',
          )}
        >FAIL</button>
      </div>
    </div>
  );
}

function TeacherActionBar({ board, busy, onReturn, onSettle }: {
  board: DailyQuestTeacherBoard;
  busy: boolean;
  onReturn: () => void;
  onSettle: () => void;
}) {
  const report = board.report!;
  const unchecked = board.summary.unchecked_student_count ?? 0;
  if (report.status === 'SETTLED') {
    return (
      <div className="rounded-card-xl border border-success/30 bg-success-bg p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
        <div className="mt-2 font-display text-lg text-white">정산 완료</div>
        <p className="mt-1 text-sm font-bold text-white/75">이 보고서는 이미 확정되었으며 중복 지급되지 않습니다.</p>
      </div>
    );
  }

  const managerSubmitted = report.status === 'SUBMITTED';
  return (
    <div className="sticky bottom-3 z-20 rounded-card-xl border border-line-brand bg-bg-overlay/95 p-4 shadow-card backdrop-blur-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-black text-white">{managerSubmitted ? '최종 확인 및 보상 지급' : '운영국 직접 입력 · 정산 모드'}</div>
          <p className="mt-1 text-xs font-bold text-white/75">
            {unchecked > 0
              ? `미확인 학생 ${unchecked}명이 남아 있습니다. 학생별 PASS/FAIL을 직접 입력할 수 있습니다.`
              : managerSubmitted
                ? `올클리어 ${board.summary.all_clear_student_count ?? 0}명 · 예상 GOLD 실수령 ${formatNumber(board.summary.expected_total_gold_net ?? 0)}`
                : `관리자 제출 없이 바로 정산 가능 · 예상 GOLD 실수령 ${formatNumber(board.summary.expected_total_gold_net ?? 0)}`}
          </p>
        </div>
        <div className="flex gap-2">
          {managerSubmitted && (
            <button type="button" disabled={busy} onClick={onReturn} className="btn-secondary flex min-w-[130px] items-center justify-center gap-2"><CornerUpLeft className="h-4 w-4" />수정 요청</button>
          )}
          <button type="button" disabled={busy || unchecked > 0} onClick={onSettle} className="btn-primary flex min-w-[190px] items-center justify-center gap-2 disabled:opacity-50"><Sparkles className="h-4 w-4" />{managerSubmitted ? '승인 및 보상 지급' : '직접 승인 및 보상 지급'}</button>
        </div>
      </div>
    </div>
  );
}

function TeacherLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const jobReadiness = message.includes('1인1역 준비가 완료되지 않았습니다') || message.includes('관리자 배정이 2명 이상');
  return (
    <div className="rounded-card-xl border border-warning/40 bg-warning-bg p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
      <h2 className="mt-3 font-display text-lg text-white">일일퀘스트 정산판을 준비할 수 없습니다</h2>
      <p className="mx-auto mt-2 max-w-2xl whitespace-pre-line text-sm font-bold leading-relaxed text-white/75">
        {jobReadiness ? '1인1역 운영 패널에서 학생별 역할과 일급, 중복 관리자 배정 여부를 확인해주세요.' : message}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {jobReadiness && <Link to="/teacher/primary-jobs" className="btn-primary">1인1역 설정으로 이동</Link>}
        <button type="button" onClick={onRetry} className="btn-secondary flex items-center gap-2"><RotateCcw className="h-4 w-4" />다시 확인</button>
      </div>
    </div>
  );
}

function statusMeta(status: NonNullable<DailyQuestTeacherBoard['report']>['status']) {
  switch (status) {
    case 'DRAFT': return { label: '작성 중 · 운영국 직접입력 가능', className: 'border-warning/30 bg-warning-bg text-warning' };
    case 'RETURNED': return { label: '수정 중 · 운영국 직접입력 가능', className: 'border-danger/30 bg-danger-bg text-danger' };
    case 'SUBMITTED': return { label: '정산 대기', className: 'border-bv/30 bg-bv/10 text-bv' };
    case 'SETTLED': return { label: '정산 완료', className: 'border-success/30 bg-success-bg text-success' };
  }
}

function seoulDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function shiftDate(value: string, deltaDays: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return date.toISOString().slice(0, 10);
}

function formatSigned(value: number) {
  const formatted = formatNumber(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return '0';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '잠시 후 다시 시도해주세요.';
}
