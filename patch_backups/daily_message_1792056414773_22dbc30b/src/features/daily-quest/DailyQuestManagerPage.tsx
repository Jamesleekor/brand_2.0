import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

import { EmptyState, LoadingSpinner, PageHeader, useRpcCall } from '@/components/shared/components';
import {
  dailyQuestS3Rpc,
  type DailyQuestCheck,
  type DailyQuestCode,
  type DailyQuestManagerBoard,
  type DailyQuestResult,
} from '@/lib/rpc/daily_quest_s3_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';

const ACCESS_KEY = ['daily-quest-s3-manager-access'] as const;
const BOARD_KEY = ['daily-quest-s3-manager-board'] as const;

const QUEST_META: Record<DailyQuestCode, { label: string; short: string; emoji: string }> = {
  ATTENDANCE: { label: '9시 이전 등교', short: '출석', emoji: '⏰' },
  PRIMARY_JOB: { label: '1인1역 1차 통과', short: '1인1역', emoji: '🧑‍💼' },
  LEARNING_MATERIALS: { label: '학습준비물', short: '준비물', emoji: '🎒' },
  CLEANING: { label: '자리 청소 1차 통과', short: '청소', emoji: '🧹' },
};

export default function DailyQuestManagerPage() {
  const queryClient = useQueryClient();
  const [onlyUnchecked, setOnlyUnchecked] = useState(false);
  const [savingCheckId, setSavingCheckId] = useState<number | null>(null);
  const { call, isLoading: mutationLoading } = useRpcCall();

  const accessQuery = useQuery({
    queryKey: ACCESS_KEY,
    queryFn: async () => {
      const result = await dailyQuestS3Rpc.getManagerAccess(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 5_000,
    refetchInterval: 20_000,
  });

  const boardQuery = useQuery({
    queryKey: BOARD_KEY,
    queryFn: async () => {
      const result = await dailyQuestS3Rpc.getManagerBoard(supabase);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: accessQuery.data?.can_operate === true,
    staleTime: 2_000,
    refetchInterval: 15_000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCESS_KEY }),
      queryClient.invalidateQueries({ queryKey: BOARD_KEY }),
    ]);
  };

  if (accessQuery.isLoading) {
    return <ManagerLoading />;
  }

  if (accessQuery.isError || !accessQuery.data) {
    return <ManagerError message={errorText(accessQuery.error)} onRetry={() => void accessQuery.refetch()} />;
  }

  if (!accessQuery.data.can_operate) {
    return (
      <div className="min-h-screen">
        <PageHeader title="일일퀘스트 관리자" emoji="📋" />
        <EmptyState
          emoji="🔒"
          title="일일퀘스트 관리자 전용 페이지입니다"
          description="현재 1인1역이 ‘일일퀘스트 관리자’인 학생만 체크리스트를 작성할 수 있습니다."
        />
      </div>
    );
  }

  // Error must be handled before the empty-data loading fallback.
  // React Query keeps `data` undefined when the RPC fails; checking `!data` first
  // traps genuine server errors on the loading screen forever.
  if (boardQuery.isError) {
    return (
      <ManagerError
        message={readinessMessage(errorText(boardQuery.error))}
        onRetry={() => void boardQuery.refetch()}
      />
    );
  }

  if (boardQuery.isLoading || !boardQuery.data) {
    return <ManagerLoading />;
  }

  const board = boardQuery.data;
  const editable = board.report.status === 'DRAFT' || board.report.status === 'RETURNED';

  const setCheck = async (check: DailyQuestCheck, next: 'PASS' | 'FAIL') => {
    if (!editable || check.teacher_override) return;
    let reason: string | null = null;
    if (check.result !== 'UNCHECKED' && check.result !== next) {
      reason = window.prompt('이미 판정한 결과를 수정합니다. 수정 사유를 2자 이상 입력하세요.')?.trim() || null;
      if (!reason) return;
    }
    setSavingCheckId(check.check_id);
    try {
      const result = await call(
        () => dailyQuestS3Rpc.setManagerCheck(supabase, check.check_id, next, reason),
        { silent: true },
      );
      if (result) await refresh();
    } finally {
      setSavingCheckId(null);
    }
  };

  const submit = async () => {
    if (!editable || board.summary.unchecked_count > 0) return;
    if (!window.confirm('오늘 일일퀘스트 결과를 선생님께 제출할까요? 제출 후에는 반려되기 전까지 수정할 수 없습니다.')) return;
    const result = await call(
      () => dailyQuestS3Rpc.submitManagerReport(supabase, board.report.id),
      {
        successTitle: '오늘 결과를 제출했어요',
        successDescription: '이제 선생님의 최종 확인과 보상 지급을 기다리면 됩니다.',
      },
    );
    if (result) await refresh();
  };

  return (
    <div className="min-h-screen pb-8">
      <PageHeader
        title="일일퀘스트 관리자"
        emoji="📋"
        right={
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-9 items-center gap-1.5 rounded-pill border border-line bg-bg-card px-3 text-xs font-black text-text-secondary hover:text-white"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', boardQuery.isFetching && 'animate-spin')} />
            새로고침
          </button>
        }
      />

      <main className="mx-auto max-w-6xl space-y-4 px-4 pt-4">
        <ManagerHero board={board} jobName={accessQuery.data.job_name} />
        <ManagerSummary board={board} />

        {board.report.status === 'RETURNED' && board.report.return_reason && (
          <div className="rounded-card-lg border border-warning/40 bg-warning-bg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warning" />
              <div>
                <div className="text-sm font-black text-text-primary">선생님이 수정을 요청했습니다</div>
                <div className="mt-1 text-sm font-bold text-text-secondary">{board.report.return_reason}</div>
              </div>
            </div>
          </div>
        )}

        <section className="glass-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <h2 className="font-display text-lg text-white">오늘의 전자 체크리스트</h2>
              <p className="mt-1 text-xs font-bold text-text-muted">출석은 출석 기록을 먼저 반영하며, 필요하면 관리자도 직접 수정할 수 있습니다. 4종 모두 첫 확인 결과를 기록하세요.</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-pill border border-line bg-bg-deep px-3 py-2 text-xs font-black text-text-secondary">
              <input type="checkbox" checked={onlyUnchecked} onChange={(e) => setOnlyUnchecked(e.target.checked)} />
              미확인 학생만 보기
            </label>
          </div>
          <ManagerMatrix
            board={board}
            editable={editable}
            onlyUnchecked={onlyUnchecked}
            savingCheckId={savingCheckId}
            onSet={setCheck}
          />
        </section>

        <SubmitPanel
          board={board}
          editable={editable}
          busy={mutationLoading}
          onSubmit={() => void submit()}
        />
      </main>
    </div>
  );
}

function ManagerHero({ board, jobName }: { board: DailyQuestManagerBoard; jobName: string | null }) {
  const status = statusMeta(board.report.status);
  return (
    <section className="relative overflow-hidden rounded-card-xl border border-line-brand bg-gradient-to-br from-brand-primary/20 via-bg-card to-gold/10 p-5">
      <div className="absolute -right-6 -top-8 text-[110px] opacity-[0.07]">📋</div>
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('rounded-pill border px-2.5 py-1 text-2xs font-black', status.className)}>{status.label}</span>
            <span className="text-xs font-bold text-text-muted">{board.report.quest_date}</span>
          </div>
          <h1 className="font-display text-xl text-white">오늘의 일일퀘스트 기록</h1>
          <p className="mt-1 text-sm font-bold text-text-secondary">{jobName ?? '일일퀘스트 관리자'} · 체크는 즉시 저장되지만 보상은 선생님 승인 후 지급됩니다.</p>
        </div>
        <div className="rounded-card-lg border border-line bg-bg-deep/80 px-4 py-3 text-right">
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted">진행률</div>
          <div className="mt-1 font-display text-2xl text-gold">{board.summary.total_checks - board.summary.unchecked_count} / {board.summary.total_checks}</div>
        </div>
      </div>
    </section>
  );
}

function ManagerSummary({ board }: { board: DailyQuestManagerBoard }) {
  const items = [
    { label: '성공', value: board.summary.pass_count, icon: CheckCircle2, cls: 'text-success' },
    { label: '실패', value: board.summary.fail_count, icon: X, cls: 'text-danger' },
    { label: '미확인', value: board.summary.unchecked_count, icon: Clock3, cls: 'text-warning' },
    { label: '출석 성공', value: board.summary.attendance_pass, icon: ShieldCheck, cls: 'text-bv' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-card-lg border border-line bg-bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-black text-text-muted"><item.icon className={cn('h-4 w-4', item.cls)} />{item.label}</div>
          <div className={cn('mt-1 font-display text-2xl', item.cls)}>{formatNumber(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function ManagerMatrix({
  board,
  editable,
  onlyUnchecked,
  savingCheckId,
  onSet,
}: {
  board: DailyQuestManagerBoard;
  editable: boolean;
  onlyUnchecked: boolean;
  savingCheckId: number | null;
  onSet: (check: DailyQuestCheck, result: 'PASS' | 'FAIL') => Promise<void>;
}) {
  const students = useMemo(() => board.students.filter((student) => {
    if (!onlyUnchecked) return true;
    return student.checks.some((check) => check.result === 'UNCHECKED');
  }), [board.students, onlyUnchecked]);

  if (students.length === 0) {
    return <EmptyState emoji="✅" title="미확인 학생이 없습니다" description="오늘 확인할 항목을 모두 기록했습니다." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[940px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-bg-card">
          <tr className="border-b border-line text-2xs font-black uppercase tracking-wide text-text-muted">
            <th className="sticky left-0 z-20 min-w-[150px] bg-bg-card px-4 py-2.5">학생</th>
            {(Object.keys(QUEST_META) as DailyQuestCode[]).map((code) => (
              <th key={code} className="min-w-[180px] px-2.5 py-2.5 text-center">
                <div className="text-sm">{QUEST_META[code].emoji}</div>
                <div>{QUEST_META[code].short}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.student_id} className="border-b border-line/70 last:border-0">
              <td className="sticky left-0 z-[5] bg-bg-card px-4 py-2">
                <div className="text-sm font-black text-white">{student.student_name}</div>
                {student.brand_name && <div className="mt-0.5 text-2xs font-bold text-text-muted">{student.brand_name}</div>}
              </td>
              {(Object.keys(QUEST_META) as DailyQuestCode[]).map((code) => {
                const check = student.checks.find((row) => row.quest_code === code)!;
                return (
                  <td key={code} className="px-2.5 py-1.5 align-middle">
                    <QuestCell
                      check={check}
                      editable={editable}
                      saving={savingCheckId === check.check_id}
                      onSet={(result) => onSet(check, result)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestCell({
  check,
  editable,
  saving,
  onSet,
}: {
  check: DailyQuestCheck;
  editable: boolean;
  saving: boolean;
  onSet: (result: 'PASS' | 'FAIL') => void;
}) {
  const locked = !editable || check.teacher_override || saving;
  const reward = check.quest_code === 'PRIMARY_JOB' ? check.job_wage : check.reward_bv;

  return (
    <div className={cn(
      'rounded-card-md border p-1.5',
      check.result === 'PASS' ? 'border-success/30 bg-success-bg' :
      check.result === 'FAIL' ? 'border-danger/30 bg-danger-bg' : 'border-line bg-bg-deep',
    )}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={cn(
          'text-2xs font-black',
          check.result === 'PASS' ? 'text-success' : check.result === 'FAIL' ? 'text-danger' : 'text-warning',
        )}>
          {check.result === 'PASS' ? 'PASS' : check.result === 'FAIL' ? 'FAIL' : '미확인'}
        </span>
        <span className="text-2xs font-bold text-text-muted">+{formatNumber(reward ?? 0)} BV/G</span>
      </div>
      {check.quest_code === 'PRIMARY_JOB' && check.job_name && (
        <div className="mb-1 truncate text-2xs font-bold text-text-secondary" title={check.job_name}>{check.job_name}</div>
      )}
      {check.teacher_override ? (
        <div className="rounded-card-sm bg-bg-card px-2 py-1 text-center text-2xs font-black text-gold">교사 확정</div>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            disabled={locked}
            onClick={() => onSet('PASS')}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-card-sm border px-2 py-1 text-[11px] font-black leading-none transition',
              check.result === 'PASS' ? 'border-success bg-success text-bg-base' : 'border-line bg-bg-card text-text-secondary hover:border-success/50 hover:text-success',
              locked && 'cursor-not-allowed opacity-60',
            )}
          ><Check className="h-3 w-3 flex-none" /><span className="whitespace-nowrap">통과</span></button>
          <button
            type="button"
            disabled={locked}
            onClick={() => onSet('FAIL')}
            className={cn(
              'flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-card-sm border px-2 py-1 text-[11px] font-black leading-none transition',
              check.result === 'FAIL' ? 'border-danger bg-danger text-white' : 'border-line bg-bg-card text-text-secondary hover:border-danger/50 hover:text-danger',
              locked && 'cursor-not-allowed opacity-60',
            )}
          ><X className="h-3 w-3 flex-none" /><span className="whitespace-nowrap">실패</span></button>
        </div>
      )}
    </div>
  );
}

function SubmitPanel({ board, editable, busy, onSubmit }: {
  board: DailyQuestManagerBoard;
  editable: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  const unchecked = board.summary.unchecked_count;
  if (board.report.status === 'SUBMITTED') {
    return (
      <div className="rounded-card-xl border border-bv/30 bg-bv/10 p-5 text-center">
        <Send className="mx-auto h-7 w-7 text-bv" />
        <div className="mt-2 font-display text-lg text-white">선생님께 제출했습니다</div>
        <p className="mt-1 text-sm font-bold text-text-secondary">최종 확인 후 보상이 지급됩니다. 반려되기 전에는 수정할 수 없습니다.</p>
      </div>
    );
  }
  if (board.report.status === 'SETTLED') {
    return (
      <div className="rounded-card-xl border border-success/30 bg-success-bg p-5 text-center">
        <Sparkles className="mx-auto h-7 w-7 text-success" />
        <div className="mt-2 font-display text-lg text-white">오늘 정산이 완료되었습니다</div>
        <p className="mt-1 text-sm font-bold text-text-secondary">선생님이 최종 승인하고 보상을 지급했습니다.</p>
      </div>
    );
  }
  return (
    <div className="sticky bottom-3 z-20 rounded-card-xl border border-line-brand bg-bg-overlay/95 p-4 shadow-card backdrop-blur-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-white"><ClipboardCheck className="h-5 w-5 text-gold" />오늘 결과 제출</div>
          <p className="mt-1 text-xs font-bold text-text-secondary">
            {unchecked > 0 ? `아직 ${unchecked}건이 미확인입니다.` : '모든 항목을 확인했습니다. 선생님께 제출할 수 있습니다.'}
          </p>
        </div>
        <button
          type="button"
          disabled={!editable || unchecked > 0 || busy}
          onClick={onSubmit}
          className="btn-primary min-w-[180px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '처리 중...' : '교사에게 제출'}
        </button>
      </div>
    </div>
  );
}

function ManagerLoading() {
  return (
    <div className="min-h-screen">
      <PageHeader title="일일퀘스트 관리자" emoji="📋" />
      <div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div>
    </div>
  );
}

function ManagerError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen">
      <PageHeader title="일일퀘스트 관리자" emoji="📋" />
      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="rounded-card-xl border border-warning/40 bg-warning-bg p-5 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
          <h2 className="mt-3 font-display text-lg text-white">체크리스트를 준비할 수 없습니다</h2>
          <p className="mt-2 whitespace-pre-line text-sm font-bold leading-relaxed text-text-secondary">{message}</p>
          <button type="button" onClick={onRetry} className="btn-secondary mt-4">다시 확인</button>
        </div>
      </div>
    </div>
  );
}

function statusMeta(status: DailyQuestManagerBoard['report']['status']) {
  switch (status) {
    case 'DRAFT': return { label: '작성 중', className: 'border-warning/30 bg-warning-bg text-warning' };
    case 'RETURNED': return { label: '수정 요청', className: 'border-danger/30 bg-danger-bg text-danger' };
    case 'SUBMITTED': return { label: '교사 확인 대기', className: 'border-bv/30 bg-bv/10 text-bv' };
    case 'SETTLED': return { label: '정산 완료', className: 'border-success/30 bg-success-bg text-success' };
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '잠시 후 다시 시도해주세요.';
}

function readinessMessage(message: string) {
  if (message.includes('1인1역 준비가 완료되지 않았습니다')) {
    return '오늘 체크리스트를 만들기 전에 모든 학생의 1인1역과 일급이 저장되어 있어야 합니다.\n선생님이 1인1역 운영 패널에서 배정을 완료한 뒤 다시 열어주세요.';
  }
  if (message.includes('일일퀘스트 관리자는 정확히 1명')) {
    return '1인1역에 “일일퀘스트 관리자”가 정확히 1명 지정되어 있어야 합니다.\n선생님에게 1인1역 설정을 확인해달라고 알려주세요.';
  }
  return message;
}
